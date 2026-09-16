import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  SectionList,
  ScrollView,
  TouchableOpacity,
  Animated,
  Modal,
  Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fonts } from '../theme';
import { getClassInputs, getNotes, getUser, getLessonMinutes } from '../storage/storage';
import {
  getPendingClasses,
  addPendingClass,
  updatePendingClass,
  removePendingClass,
} from '../storage/pendingClasses';
import { getMyCouple } from '../storage/coupleStorage';
import { supabase } from '../services/supabase/client';
import { processClassDraft } from '../services/classSubmission';
import LogModal from '../components/LogModal';
import TabHeader, { useIsParentAccount, HeaderIconButton } from '../components/TabHeader';
import StyleTitle from '../components/StyleTitle';
import { useTabBarSpace } from '../components/CustomTabBar';
import PullLogo, { usePullRefresh } from '../components/PullLogo';
import LogSkeleton from '../components/LogSkeleton';

const LOG_CACHE_KEY = '@cache_log';
const SKIP_ADD_REMINDER_KEY = '@skip_add_class_reminder';

// ─── Lessons palette (docs/design/lesson-log.html) ────────────────────────────
const PAGE = '#F2F0EB';
const INK = '#0A0A0A';
const INK_2 = 'rgba(10,10,10,0.65)';
const INK_55 = 'rgba(10,10,10,0.55)';
const INK_50 = 'rgba(10,10,10,0.5)';
const INK_45 = 'rgba(10,10,10,0.45)';
const INK_42 = 'rgba(10,10,10,0.42)';
const INK_34 = 'rgba(10,10,10,0.34)';
const LINE = 'rgba(10,10,10,0.12)';
const HAIR = 'rgba(10,10,10,0.07)';
const GOLD = '#E8B530';
const GOLD_100 = '#FCEFC9';
const GOLD_INK = '#8A6414';
const NAVY = '#22314D';
const TILE = '#F4F2EC';
const DANGER = '#C0392B';
const SIDE = 20;

const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isPrivateLesson(lessonType) {
  // 'group' or 'public' = group; everything else (private or null/legacy) = private
  return lessonType !== 'group' && lessonType !== 'public';
}

function formatCountdown(isoDeadline) {
  const ms = new Date(isoDeadline) - Date.now();
  if (ms <= 0) return null;
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pad2 = (n) => String(n).padStart(2, '0');
const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`;

// Days between the item's calendar day and today (0 = today, 1 = yesterday).
function daysAgo(iso) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(iso);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((today - day) / 86400000);
}

function lessonTitle(item) {
  return item.title
    || item.ai_primary_focus
    || (item.practice_point_1 || '').split(' ').slice(0, 6).join(' ')
    || 'Untitled lesson';
}

// Month sections, newest first: [{ key, title, data }]
function byMonth(items, dateField) {
  const map = new Map();
  for (const it of items) {
    const d = new Date(it[dateField] || it.created_at);
    const key = monthKey(d);
    if (!map.has(key)) map.set(key, { key, title: `${MONTH_FULL[d.getMonth()]} ${d.getFullYear()}`, data: [] });
    map.get(key).data.push(it);
  }
  return Array.from(map.values());
}

// What a lesson row says under its title — or, while it isn't ready, why.
function lessonStatus(item) {
  if (item._failed) return { text: 'Didn’t save — tap to try again', tone: 'danger' };
  if (item._localPending) return { text: 'Saving…', tone: 'muted' };
  if (item._pendingDeadline) {
    const left = formatCountdown(item._pendingDeadline);
    return { text: left ? `Focus points on the way · ready in ${left}` : 'Pending coach approval', tone: 'gold' };
  }
  if (item.status === 'processing' || item.status === 'extracted' || item.status === 'pending') {
    return { text: 'Analysing the lesson…', tone: 'gold' };
  }
  if (item._hasPendingFPs) return { text: 'Pending coach approval', tone: 'gold' };
  return null;
}

function lessonMeta(item, minutes) {
  const parts = [isPrivateLesson(item.lesson_type) ? 'Private' : 'Group'];
  if (minutes) parts.push(`${minutes} min`);
  parts.push(item._corrections > 0 ? plural(item._corrections, 'correction') : 'no corrections');
  return parts.join(' · ');
}

// ─── Pieces ───────────────────────────────────────────────────────────────────
function SeasonTile({ value, unit, label }) {
  return (
    <View style={st.tile}>
      <Text style={st.value} allowFontScaling={false}>
        {value}{unit ? <Text style={st.unit}>{unit}</Text> : null}
      </Text>
      <Text style={st.label} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function FilterTabs({ value, onChange, count }) {
  return (
    <View style={ft.row}>
      {[['all', 'All'], ['group', 'Group'], ['private', 'Private']].map(([key, label]) => {
        const on = value === key;
        return (
          <TouchableOpacity
            key={key}
            style={[ft.tab, on && ft.tabOn]}
            onPress={() => onChange(key)}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Text style={[ft.label, on && ft.labelOn]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
      <Text style={ft.count} numberOfLines={1}>{count}</Text>
    </View>
  );
}

function DateTile({ iso }) {
  const d = new Date(iso);
  const ago = daysAgo(iso);
  const hot = ago === 0 || ago === 1;
  return (
    <View style={[rw.date, hot && rw.dateHot]}>
      <Text style={rw.dateNum} allowFontScaling={false}>{pad2(d.getDate())}</Text>
      <Text style={rw.dateDay} allowFontScaling={false}>
        {ago === 0 ? 'Today' : ago === 1 ? 'Yest' : WEEKDAY_SHORT[d.getDay()]}
      </Text>
    </View>
  );
}

// One lesson in a month card. `first` / `last` round the card's corners.
function LessonRow({ item, minutes, first, last, onPress }) {
  const status = lessonStatus(item);
  return (
    <TouchableOpacity
      style={[rw.row, first && rw.rowFirst, last && rw.rowLast, !first && rw.rowSep, item._localPending && !item._failed && { opacity: 0.6 }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <DateTile iso={item.created_at} />
      <View style={rw.body}>
        <Text style={rw.title} numberOfLines={2}>{lessonTitle(item)}</Text>
        <Text
          style={[rw.meta, status?.tone === 'danger' && { color: DANGER }, status?.tone === 'gold' && { color: GOLD_INK }]}
          numberOfLines={1}
        >
          {status ? status.text : lessonMeta(item, minutes)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={13} color={INK_34} />
    </TouchableOpacity>
  );
}

function NoteRow({ item, first, last, onPress }) {
  const clips = item.video_clips?.length || 0;
  const meta = [
    clips ? plural(clips, 'clip') : null,
    item.linked_class_input_id ? 'Linked to a lesson' : null,
  ].filter(Boolean).join(' · ') || (item.content || '').split('\n')[0] || 'Note';
  return (
    <TouchableOpacity
      style={[rw.row, first && rw.rowFirst, last && rw.rowLast, !first && rw.rowSep]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <DateTile iso={item.updated_at || item.created_at} />
      <View style={rw.body}>
        <Text style={rw.title} numberOfLines={2}>{item.title || 'Untitled note'}</Text>
        <Text style={rw.meta} numberOfLines={1}>{meta}</Text>
      </View>
      <Ionicons name="chevron-forward" size={13} color={INK_34} />
    </TouchableOpacity>
  );
}

function MonthMarker({ title, count, noun = 'lesson' }) {
  return (
    <View style={rw.marker}>
      <Text style={rw.markerTitle}>{title}</Text>
      <Text style={rw.markerCount}>{plural(count, noun)}</Text>
    </View>
  );
}

// ─── Calendar ─────────────────────────────────────────────────────────────────
function LessonCalendar({ month, canPrev, canNext, onPrev, onNext, lessons, day, onDay, minutesById, onOpen }) {
  const year = month.getFullYear();
  const m = month.getMonth();
  const daysIn = new Date(year, m + 1, 0).getDate();
  const lead = (new Date(year, m, 1).getDay() + 6) % 7; // Monday first
  const now = new Date();
  const isThisMonth = now.getFullYear() === year && now.getMonth() === m;

  const byDay = new Map();
  for (const l of lessons) {
    const d = new Date(l.created_at).getDate();
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(l);
  }
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const shown = day == null ? lessons : (byDay.get(day) || []);

  return (
    <View>
      <View style={cal.head}>
        <Text style={cal.title}>{MONTH_FULL[m]} <Text style={cal.year}>{year}</Text></Text>
        <TouchableOpacity style={[cal.nav, !canPrev && cal.navOff]} onPress={onPrev} disabled={!canPrev} accessibilityLabel="Previous month">
          <Ionicons name="chevron-back" size={14} color={INK} />
        </TouchableOpacity>
        <TouchableOpacity style={[cal.nav, !canNext && cal.navOff]} onPress={onNext} disabled={!canNext} accessibilityLabel="Next month">
          <Ionicons name="chevron-forward" size={14} color={INK} />
        </TouchableOpacity>
      </View>

      <View style={cal.dow}>
        {DOW.map((d, i) => <Text key={i} style={cal.dowTxt}>{d}</Text>)}
      </View>

      <View style={cal.grid}>
        {cells.map((d, i) => {
          if (d == null) return <View key={`e${i}`} style={cal.cellSlot} />;
          const items = byDay.get(d) || [];
          const has = items.length > 0;
          const priv = items.some((l) => isPrivateLesson(l.lesson_type));
          const on = day === d;
          const today = isThisMonth && d === now.getDate();
          return (
            <View key={d} style={cal.cellSlot}>
              <TouchableOpacity
                style={[cal.cell, has && cal.cellHas, on && cal.cellOn]}
                disabled={!has}
                onPress={() => onDay(on ? null : d)}
                activeOpacity={0.7}
                accessibilityLabel={`${MONTH_FULL[m]} ${d}${has ? `, ${plural(items.length, 'lesson')}` : ''}`}
              >
                <Text style={[cal.cellNum, has && cal.cellNumHas, on && { color: '#FFFFFF' }]}>{d}</Text>
                {today ? <View style={cal.todayBar} /> : null}
                <View style={[cal.dot, has && { backgroundColor: on ? GOLD : priv ? NAVY : GOLD }]} />
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      <View style={cal.key}>
        <View style={cal.keyItem}><View style={[cal.keyDot, { backgroundColor: GOLD }]} /><Text style={cal.keyTxt}>Group</Text></View>
        <View style={cal.keyItem}><View style={[cal.keyDot, { backgroundColor: NAVY }]} /><Text style={cal.keyTxt}>Private</Text></View>
        {day != null ? (
          <TouchableOpacity onPress={() => onDay(null)} style={cal.whole} hitSlop={{ top: 8, bottom: 8, left: 8 }}>
            <Text style={cal.wholeTxt}>Show whole month</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Text style={cal.listHead}>{day == null ? `All of ${MONTH_FULL[m]}` : `${MONTH_FULL[m]} ${day}`}</Text>
      {shown.length === 0 ? (
        <Text style={cal.empty}>
          Nothing logged {day == null ? `in ${MONTH_FULL[m]}` : `on ${MONTH_FULL[m]} ${day}`}. Tap a marked day to see its lesson.
        </Text>
      ) : shown.map((l) => {
        const d = new Date(l.created_at);
        const status = lessonStatus(l);
        return (
          <TouchableOpacity key={l.id} style={cal.drow} onPress={() => onOpen(l)} activeOpacity={0.7}>
            <View style={cal.dcol}>
              <Text style={cal.dnum}>{pad2(d.getDate())}</Text>
              <Text style={cal.dday}>{WEEKDAY_SHORT[d.getDay()]}</Text>
            </View>
            <View style={rw.body}>
              <Text style={rw.title} numberOfLines={2}>{lessonTitle(l)}</Text>
              <Text style={[rw.meta, { color: INK_2 }]} numberOfLines={1}>
                {status ? status.text : lessonMeta(l, minutesById[l.id])}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={13} color={INK_34} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function LogScreen({ navigation }) {
  const [inputs, setInputs] = useState([]);
  const [notes, setNotes] = useState([]);
  const [pending, setPending] = useState([]);
  const [minutesById, setMinutesById] = useState({});
  const [coupleCorrections, setCoupleCorrections] = useState({}); // couple lessons: { classInputId: count }
  // Header: the dancer (the child, on a parent's account) and their partner.
  const [dancer, setDancer] = useState(null);
  const [partnerName, setPartnerName] = useState(null);
  const isParent = useIsParentAccount();
  // Lessons' foot button sits above the floating tab bar.
  const tabBarSpace = useTabBarSpace();

  const [view, setView] = useState('list');          // 'list' | 'calendar' | 'notes'
  const [filter, setFilter] = useState('all');       // 'all' | 'group' | 'private'
  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [calDay, setCalDay] = useState(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [reminderVisible, setReminderVisible] = useState(false);
  const [dontRemind, setDontRemind] = useState(false);
  const [retryDraft, setRetryDraft] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const hasLoadedRef = useRef(false);
  const processingIdsRef = useRef(new Set());
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Pull to refresh on whichever view is showing: the InBetween mark in the gap
  // the pull opens (iOS; Android keeps its native spinner).
  const viewScrollRef = useRef(null);
  const pull = usePullRefresh({
    refreshing,
    onRefresh: () => handleRefresh(),
    scrollToTop: () => {
      const r = viewScrollRef.current;
      if (r?.scrollTo) r.scrollTo({ y: 0, animated: true });
      else r?.getScrollResponder?.()?.scrollTo({ y: 0, animated: true });
    },
  });

  // Paint the header at once from Train's caches; load() refreshes them.
  useEffect(() => {
    AsyncStorage.multiGet(['@cache_home', '@cache_home_couple'])
      .then(([[, home], [, couple]]) => {
        const u = home && JSON.parse(home)?.user;
        if (u) setDancer((d) => d || u);
        const p = couple && JSON.parse(couple)?.couple?.partner?.name;
        if (p) setPartnerName((n) => n || p);
      })
      .catch(() => {});
  }, []);

  async function load() {
    const [allInputs, allNotes, pendingList] = await Promise.all([
      getClassInputs(),
      getNotes(),
      getPendingClasses(),
    ]);
    setInputs(allInputs);
    setNotes(allNotes);
    setPending(pendingList);
    AsyncStorage.setItem(LOG_CACHE_KEY, JSON.stringify({ inputs: allInputs, notes: allNotes })).catch(() => {});

    // Secondary, non-blocking: durations, couple corrections, header names.
    getLessonMinutes(allInputs.map((i) => i.id)).then(setMinutesById).catch(() => {});
    const coupleIds = allInputs.filter((i) => i.couple_id).map((i) => i.id);
    if (coupleIds.length) {
      supabase
        .from('couple_focus_points')
        .select('class_input_id')
        .in('class_input_id', coupleIds)
        .eq('is_deleted', false)
        .eq('is_other', false)
        .then(({ data }) => {
          const counts = {};
          for (const r of data || []) counts[r.class_input_id] = (counts[r.class_input_id] || 0) + 1;
          setCoupleCorrections(counts);
        }, () => {});
    }
    getUser().then((u) => { if (u) setDancer(u); }).catch(() => {});
    getMyCouple().then((c) => setPartnerName(c?.partner?.name || null)).catch(() => {});
  }

  function draftToDisplayItem(draft) {
    return {
      id: draft._pendingId,
      created_at: draft.createdAt,
      practice_point_1: draft.practicePoint1,
      practice_point_2: draft.showSecond ? draft.practicePoint2 : null,
      teacher_name: draft.teacherName || null,
      lesson_type: draft.lessonType || null,
      dance: draft.selectedDances?.length ? draft.selectedDances.join(', ') : null,
      title: (draft.practicePoint1 || '').split(' ').slice(0, 6).join(' '),
      _localPending: true,
      _failed: !!draft._failed,
      _draft: draft,
    };
  }

  function startProcessing(draft) {
    processClassDraft(draft)
      .then(async () => {
        await removePendingClass(draft._pendingId);
        await load();
      })
      .catch(async (err) => {
        console.warn('[LogScreen] class submit failed:', err);
        await updatePendingClass(draft._pendingId, { _failed: true });
        const list = await getPendingClasses();
        setPending(list);
      });
  }

  async function handleModalSubmit(draft) {
    if (retryDraft) {
      await removePendingClass(retryDraft._pendingId);
    }
    const clean = { ...draft, _failed: false };
    await addPendingClass(clean);
    const list = await getPendingClasses();
    setPending(list);
    setModalVisible(false);
    setRetryDraft(null);
    startProcessing(clean);
  }

  function handleRetry(draft) {
    setRetryDraft(draft);
    setModalVisible(true);
  }

  function handleModalClose() {
    setModalVisible(false);
    setRetryDraft(null);
  }

  async function handleRefresh() {
    setRefreshing(true);
    try { await load(); } catch {}
    setRefreshing(false);
  }

  useFocusEffect(useCallback(() => {
    const isFirst = !hasLoadedRef.current;
    if (isFirst) setIsLoading(true);
    const reveal = () => {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    };
    async function init() {
      let revealed = false;
      if (isFirst) {
        try {
          const raw = await AsyncStorage.getItem(LOG_CACHE_KEY);
          if (raw) {
            const { inputs: ci, notes: cn } = JSON.parse(raw);
            setInputs(ci || []);
            setNotes(cn || []);
            setIsLoading(false);
            reveal(); // fade cached content in NOW — don't wait on the network
            revealed = true;
          }
        } catch {}
      }
      try { await load(); } catch {}
      hasLoadedRef.current = true;
      setIsLoading(false);
      if (isFirst) {
        if (!revealed) reveal(); // no cache: skeleton was showing, fade in after load
        try {
          const orphans = await getPendingClasses();
          orphans.filter((d) => !d._failed && !processingIdsRef.current.has(d._pendingId))
            .forEach((d) => {
              processingIdsRef.current.add(d._pendingId);
              startProcessing(d);
            });
        } catch {}
      }
    }
    init();
  }, []));

  async function handleLogLesson() {
    const skip = await AsyncStorage.getItem(SKIP_ADD_REMINDER_KEY);
    if (skip === 'true') {
      setModalVisible(true);
    } else {
      setDontRemind(false);
      setReminderVisible(true);
    }
  }

  async function handleReminderContinue() {
    if (dontRemind) {
      await AsyncStorage.setItem(SKIP_ADD_REMINDER_KEY, 'true');
    }
    setReminderVisible(false);
    setModalVisible(true);
  }

  // A lesson that isn't ready says why instead of opening an empty summary.
  function openLesson(item) {
    if (item._failed) { handleRetry(item._draft); return; }
    if (item._localPending) {
      Alert.alert('Saving lesson', 'Your lesson is being processed. It will appear fully in a moment.', [{ text: 'OK' }]);
      return;
    }
    if (!item._pendingDeadline && (item.status === 'processing' || item.status === 'extracted' || item.status === 'pending')) {
      Alert.alert('Being analysed', "Your coach's notes are being processed. Focus points will appear shortly.", [{ text: 'OK' }]);
      return;
    }
    if (item._hasPendingFPs) {
      Alert.alert('Coach review in progress', 'Your coach is reviewing the focus points from this lesson before they’re shared with you.', [{ text: 'OK' }]);
      return;
    }
    navigation.navigate('ClassDetail', { inputId: item.id });
  }

  // ─── Data for the views ────────────────────────────────────────────────────
  const lessons = useMemo(() => {
    const merged = [...pending.map(draftToDisplayItem), ...inputs]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return merged.map((l) => ({
      ...l,
      _corrections: l.couple_id
        ? (coupleCorrections[l.id] || 0)
        : (l.focus_points || []).filter((fp) => !fp.is_other && !fp.is_deleted).length,
    }));
  }, [pending, inputs, coupleCorrections]); // eslint-disable-line react-hooks/exhaustive-deps

  const recorded = lessons.filter((l) => !l._localPending);
  const totalCorrections = recorded.reduce((n, l) => n + l._corrections, 0);
  const floorMinutes = recorded.reduce((n, l) => n + (minutesById[l.id] || 0), 0);
  const floor = floorMinutes >= 60
    ? { value: String(Math.round(floorMinutes / 60)), unit: 'h' }
    : { value: String(floorMinutes), unit: floorMinutes ? 'm' : '' };

  const inFilter = (l) => filter === 'all' || (filter === 'private') === isPrivateLesson(l.lesson_type);
  const filtered = lessons.filter(inFilter);
  const sections = byMonth(filtered, 'created_at');

  // Calendar: from the first lesson's month to this month.
  const firstLesson = recorded[recorded.length - 1];
  const firstMonth = firstLesson
    ? new Date(new Date(firstLesson.created_at).getFullYear(), new Date(firstLesson.created_at).getMonth(), 1)
    : calMonth;
  const nowMonth = (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); })();
  const monthLessons = filtered.filter((l) => monthKey(new Date(l.created_at)) === monthKey(calMonth));
  const noteSections = byMonth(notes, 'updated_at');

  const countLabel = view === 'calendar'
    ? `${plural(monthLessons.length, 'lesson')} in ${MONTH_FULL[calMonth.getMonth()]}`
    : view === 'notes'
      ? plural(notes.length, 'note')
      : plural(filtered.length, 'lesson');

  // Header: the dancer's style(s) — Lessons lists every style, so it names them
  // rather than offering a switch — and who, since when.
  const dancerStyle = dancer?.dance_style || '';
  const styleLabel = dancerStyle.includes('Latin') && dancerStyle.includes('Ballroom') ? 'Latin & Ballroom'
    : dancerStyle.includes('Ballroom') ? 'Ballroom'
    : dancerStyle.includes('Latin') ? 'Latin'
    : 'Lessons';
  const first = (name) => (name || '').trim().split(/\s+/)[0] || '';
  const dancers = [first(dancer?.name), first(partnerName)].filter(Boolean).join(' & ');
  const since = firstLesson
    ? `since ${MONTH_FULL[new Date(firstLesson.created_at).getMonth()]} ${new Date(firstLesson.created_at).getFullYear()}`
    : null;
  const headerSub = [dancers, isParent ? 'parent’s account' : since].filter(Boolean).join(' · ') || null;

  if (isLoading) {
    return <LogSkeleton />;
  }

  // Tiles + tabs head every view and scroll with it, so a pull opens the gap —
  // and shows the mark — above them.
  const pageHead = (
    <View>
      <View style={s.season}>
        <SeasonTile value={String(recorded.length)} label="Lessons" />
        <SeasonTile value={String(totalCorrections)} label="Corrections" />
        <SeasonTile value={floor.value} unit={floor.unit} label="On the floor" />
      </View>
      {view === 'notes' ? (
        <View style={[ft.row, { justifyContent: 'space-between' }]}>
          <Text style={[ft.label, ft.labelOn, ft.notesLabel]}>Notes</Text>
          <Text style={ft.count}>{countLabel}</Text>
        </View>
      ) : (
        <FilterTabs value={filter} onChange={(f) => { setFilter(f); setCalDay(null); }} count={countLabel} />
      )}
    </View>
  );

  const pullLogo = pull.ios ? (
    <View pointerEvents="none" style={s.pullLogo}>
      <PullLogo ref={pull.logoRef} refreshing={refreshing} />
    </View>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: PAGE }}>
      <SafeAreaView style={s.safe} edges={['top']}>
        <Animated.View style={{ flex: 1, opacity: fadeAnim, paddingBottom: tabBarSpace }}>
          <TabHeader
            navigation={navigation}
            style={s.header}
            lead={<StyleTitle label={styleLabel} sub={headerSub} />}
            actions={(
              <>
                <HeaderIconButton
                  icon="calendar-clear-outline"
                  on={view === 'calendar'}
                  label="Calendar view"
                  onPress={() => { setCalDay(null); setView(view === 'calendar' ? 'list' : 'calendar'); }}
                />
                <HeaderIconButton
                  icon="document-text-outline"
                  on={view === 'notes'}
                  label={`Notes, ${plural(notes.length, 'note')}`}
                  onPress={() => setView(view === 'notes' ? 'list' : 'notes')}
                />
              </>
            )}
          />

          <View style={{ flex: 1 }}>
            {pullLogo}
            {view === 'list' ? (
              <SectionList
                key="list"
                ref={viewScrollRef}
                sections={sections}
                keyExtractor={(item) => item.id}
                stickySectionHeadersEnabled={false}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={s.feed}
                ListHeaderComponent={pageHead}
                renderSectionHeader={({ section }) => (
                  <MonthMarker title={section.title} count={section.data.length} />
                )}
                renderItem={({ item, index, section }) => (
                  <LessonRow
                    item={item}
                    minutes={minutesById[item.id]}
                    first={index === 0}
                    last={index === section.data.length - 1}
                    onPress={() => openLesson(item)}
                  />
                )}
                ListEmptyComponent={(
                  <View style={s.empty}>
                    <Text style={s.emptyTitle}>
                      {filter === 'all' ? 'Your lessons will appear here' : `No ${filter} lessons yet`}
                    </Text>
                    <Text style={s.emptyBody}>
                      Once your coach records a lesson, it shows up here — even while its focus points are still on the way.
                    </Text>
                  </View>
                )}
                {...pull.scrollProps}
                refreshing={pull.ios ? undefined : refreshing}
                onRefresh={pull.ios ? undefined : handleRefresh}
              />
            ) : view === 'calendar' ? (
              <ScrollView
                key="calendar"
                ref={viewScrollRef}
                contentContainerStyle={s.calScroll}
                showsVerticalScrollIndicator={false}
                {...pull.scrollProps}
              >
                {pageHead}
                <LessonCalendar
                  month={calMonth}
                  canPrev={calMonth > firstMonth}
                  canNext={calMonth < nowMonth}
                  onPrev={() => { setCalDay(null); setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1)); }}
                  onNext={() => { setCalDay(null); setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1)); }}
                  lessons={monthLessons}
                  day={calDay}
                  onDay={setCalDay}
                  minutesById={minutesById}
                  onOpen={openLesson}
                />
              </ScrollView>
            ) : (
              <SectionList
                key="notes"
                ref={viewScrollRef}
                sections={noteSections}
                keyExtractor={(item) => item.id}
                stickySectionHeadersEnabled={false}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={s.feed}
                ListHeaderComponent={pageHead}
                renderSectionHeader={({ section }) => (
                  <MonthMarker title={section.title} count={section.data.length} noun="note" />
                )}
                renderItem={({ item, index, section }) => (
                  <NoteRow
                    item={item}
                    first={index === 0}
                    last={index === section.data.length - 1}
                    onPress={() => navigation.navigate('NoteDetail', { noteId: item.id })}
                  />
                )}
                ListEmptyComponent={(
                  <View style={s.empty}>
                    <Text style={s.emptyTitle}>No notes yet</Text>
                    <Text style={s.emptyBody}>Write down what you want to remember from a lesson or a practice.</Text>
                  </View>
                )}
                {...pull.scrollProps}
                refreshing={pull.ios ? undefined : refreshing}
                onRefresh={pull.ios ? undefined : handleRefresh}
              />
            )}
          </View>

          {/* Log a lesson (or, on Notes, write one): a round + in the corner. */}
          <TouchableOpacity
            style={[s.fab, { bottom: tabBarSpace + 14 }]}
            onPress={view === 'notes' ? () => navigation.navigate('NoteDetail', {}) : handleLogLesson}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={view === 'notes' ? 'Write a note' : 'Log a lesson'}
          >
            <Ionicons name="add" size={28} color={INK} />
          </TouchableOpacity>

          <LogModal
            visible={modalVisible}
            onClose={handleModalClose}
            onSubmitted={handleModalSubmit}
            initialDraft={retryDraft}
          />

          <Modal visible={reminderVisible} transparent animationType="fade" onRequestClose={() => setReminderVisible(false)}>
            <TouchableOpacity style={s.reminderOverlay} activeOpacity={1} onPress={() => setReminderVisible(false)}>
              <TouchableOpacity style={s.reminderSheet} activeOpacity={1} onPress={() => {}}>
                <View style={s.reminderIconWrap}>
                  <Ionicons name="information-circle-outline" size={28} color={INK} />
                </View>
                <Text style={s.reminderTitle}>Lessons are added automatically</Text>
                <Text style={s.reminderBody}>
                  Your coach records lessons directly from their sessions. Only log a lesson yourself if your coach is not on InBetween yet.
                </Text>
                <TouchableOpacity
                  style={s.reminderToggleRow}
                  onPress={() => setDontRemind((v) => !v)}
                  activeOpacity={0.7}
                >
                  <Text style={s.reminderToggleLabel}>Don't remind me again</Text>
                  <Switch
                    value={dontRemind}
                    onValueChange={setDontRemind}
                    trackColor={{ false: '#E0E0E0', true: GOLD }}
                    thumbColor="#fff"
                  />
                </TouchableOpacity>
                <TouchableOpacity style={s.reminderBtn} onPress={handleReminderContinue} activeOpacity={0.85}>
                  <Text style={s.reminderBtnText}>Log it myself anyway</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setReminderVisible(false)} activeOpacity={0.7} style={{ marginTop: 10 }}>
                  <Text style={s.reminderCancel}>Cancel</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  // Same header rhythm as Train and Stats, so switching tabs doesn't shift it.
  header: { paddingTop: 6, paddingBottom: 0 },
  season: { flexDirection: 'row', gap: 8, paddingTop: 16, paddingBottom: 14 },
  // Bottom room so the last row clears the round + button.
  feed: { paddingHorizontal: SIDE, paddingBottom: 88 },
  calScroll: { paddingHorizontal: SIDE, paddingBottom: 88 },
  pullLogo: { position: 'absolute', top: 14, left: 0, right: 0, alignItems: 'center' },
  empty: { paddingTop: 36, paddingHorizontal: 12, alignItems: 'center' },
  emptyTitle: { fontFamily: Fonts.ttDemiBold, fontSize: 15.5, letterSpacing: -0.2, color: INK, textAlign: 'center' },
  emptyBody: { fontFamily: Fonts.ttRegular, fontSize: 13, lineHeight: 19, color: INK_2, textAlign: 'center', marginTop: 6 },

  fab: {
    position: 'absolute',
    right: SIDE,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7A5710',
    shadowOpacity: 0.28,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 6,
  },

  reminderOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 },
  reminderSheet: { width: '100%', backgroundColor: '#FFFFFF', borderRadius: 22, padding: 22, alignItems: 'center' },
  reminderIconWrap: { width: 52, height: 52, borderRadius: 26, backgroundColor: TILE, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  reminderTitle: { fontFamily: Fonts.ttBold, fontSize: 17, color: INK, textAlign: 'center', marginBottom: 8 },
  reminderBody: { fontFamily: Fonts.ttRegular, fontSize: 13.5, lineHeight: 20, color: INK_2, textAlign: 'center', marginBottom: 16 },
  reminderToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', paddingVertical: 8, marginBottom: 12 },
  reminderToggleLabel: { fontFamily: Fonts.ttMedium, fontSize: 14, color: INK },
  reminderBtn: { alignSelf: 'stretch', height: 48, borderRadius: 999, backgroundColor: INK, alignItems: 'center', justifyContent: 'center' },
  reminderBtnText: { fontFamily: Fonts.ttDemiBold, fontSize: 15, color: '#FFFFFF' },
  reminderCancel: { fontFamily: Fonts.ttMedium, fontSize: 14, color: INK_2, paddingVertical: 6 },
});

// Season tiles
const st = StyleSheet.create({
  tile: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 13, borderWidth: 1, borderColor: HAIR, paddingVertical: 12, paddingHorizontal: 13 },
  value: { fontFamily: Fonts.ttBold, fontSize: 24, letterSpacing: -0.96, lineHeight: 26, color: INK, fontVariant: ['tabular-nums'] },
  unit: { fontFamily: Fonts.ttBold, fontSize: 16, letterSpacing: 0, color: INK_50 },
  label: { fontFamily: Fonts.ttDemiBold, fontSize: 9, letterSpacing: 1.17, textTransform: 'uppercase', color: INK_50, marginTop: 6 },
});

// All | Group | Private
const ft = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 22, borderBottomWidth: 1, borderBottomColor: LINE },
  tab: { paddingBottom: 9, marginBottom: -1, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: GOLD },
  label: { fontFamily: Fonts.ttDemiBold, fontSize: 15, letterSpacing: -0.3, color: INK_2 },
  labelOn: { color: INK },
  notesLabel: { paddingBottom: 9 },
  count: { marginLeft: 'auto', paddingBottom: 11, fontFamily: Fonts.ttRegular, fontSize: 11.5, color: INK_2 },
});

// Month markers and rows
const rw = StyleSheet.create({
  marker: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, paddingTop: 18, paddingBottom: 8, paddingHorizontal: 2 },
  markerTitle: { fontFamily: Fonts.ttDemiBold, fontSize: 9.5, letterSpacing: 1.6, textTransform: 'uppercase', color: INK_45 },
  markerCount: { fontFamily: Fonts.ttMedium, fontSize: 9.5, letterSpacing: 0.57, textTransform: 'uppercase', color: INK_45 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 13, paddingHorizontal: 15, backgroundColor: '#FFFFFF', borderLeftWidth: 1, borderRightWidth: 1, borderColor: HAIR },
  rowFirst: { borderTopWidth: 1, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  rowLast: { borderBottomWidth: 1, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  rowSep: { borderTopWidth: 1, borderTopColor: HAIR },
  date: { width: 36, height: 36, borderRadius: 10, backgroundColor: TILE, alignItems: 'center', justifyContent: 'center', gap: 1 },
  dateHot: { backgroundColor: GOLD_100 },
  dateNum: { fontFamily: Fonts.ttBold, fontSize: 15, letterSpacing: -0.6, lineHeight: 16, color: INK, fontVariant: ['tabular-nums'] },
  dateDay: { fontFamily: Fonts.ttDemiBold, fontSize: 8, letterSpacing: 0.64, textTransform: 'uppercase', color: INK_50 },
  body: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontFamily: Fonts.ttDemiBold, fontSize: 14.5, lineHeight: 19, letterSpacing: -0.22, color: INK },
  meta: { fontFamily: Fonts.ttRegular, fontSize: 11.5, color: INK_55 },
});

// Calendar
const cal = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 14 },
  title: { flex: 1, fontFamily: Fonts.ttBold, fontSize: 20, letterSpacing: -0.6, color: INK },
  year: { fontFamily: Fonts.ttMedium, color: INK_42 },
  nav: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: INK, shadowOpacity: 0.07, shadowOffset: { width: 0, height: 1 }, shadowRadius: 2, elevation: 1 },
  navOff: { opacity: 0.35 },
  dow: { flexDirection: 'row', paddingTop: 13, paddingBottom: 6 },
  dowTxt: { flex: 1, textAlign: 'center', fontFamily: Fonts.ttDemiBold, fontSize: 9, letterSpacing: 1.26, color: INK_50 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -2 },
  cellSlot: { width: `${100 / 7}%`, padding: 2 },
  cell: { height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center', gap: 3 },
  cellHas: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(10,10,10,0.09)' },
  cellOn: { backgroundColor: INK, borderColor: INK },
  cellNum: { fontFamily: Fonts.ttMedium, fontSize: 12.5, lineHeight: 14, color: INK_42, fontVariant: ['tabular-nums'] },
  cellNumHas: { fontFamily: Fonts.ttDemiBold, color: INK },
  todayBar: { position: 'absolute', bottom: 9, width: 12, height: 2, borderRadius: 1, backgroundColor: GOLD },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'transparent' },
  key: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 11, paddingBottom: 9, paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: LINE },
  keyItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  keyDot: { width: 5, height: 5, borderRadius: 2.5 },
  keyTxt: { fontFamily: Fonts.ttRegular, fontSize: 10.5, color: INK_2 },
  whole: { marginLeft: 'auto' },
  wholeTxt: { fontFamily: Fonts.ttDemiBold, fontSize: 11, color: GOLD_INK },
  listHead: { paddingTop: 13, paddingBottom: 5, fontFamily: Fonts.ttDemiBold, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: INK_2 },
  empty: { paddingTop: 16, fontFamily: Fonts.ttRegular, fontSize: 13, lineHeight: 19, color: INK_2 },
  drow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(10,10,10,0.08)' },
  dcol: { width: 30, gap: 2 },
  dnum: { fontFamily: Fonts.ttBold, fontSize: 17, letterSpacing: -0.5, lineHeight: 18, color: INK, fontVariant: ['tabular-nums'] },
  dday: { fontFamily: Fonts.ttDemiBold, fontSize: 9.5, letterSpacing: 0.76, color: INK_50 },
});
