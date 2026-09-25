import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  AppState,
  Animated,
  Easing,
} from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { Fonts, Spacing } from '../../theme';
import { useCoachData } from '../../context/CoachDataContext';
import { useCoachTabView } from '../../context/CoachTabView';
import { markFirstScreenReady } from '../../utils/firstPaint';
import { guardStudent, isAwaitingVerification } from '../../utils/studentLock';
import { getStudentsReadiness } from '../../storage/storage';
import { getStartClassRoster } from '../../storage/coachStorage';
import { getMyCouples } from '../../storage/coupleStorage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getActiveCoachClass, subscribeToActiveCoachClass } from '../../storage/activeCoachClass';
import { supabase } from '../../services/supabase/client';
import { isLocalRecordingMode } from '../../services/featureFlags';
import * as DjiFiles from 'local-recording-files';
import * as Notifications from 'expo-notifications';
import { registerPushToken } from '../../services/notifications';
import { useDjiSync } from '../../context/DjiSyncContext';
import PullLogo from '../../components/PullLogo';
import usePullDown, { PULL_REST } from '../../components/usePullDown';
import { useGroupSwitch, Pulse, Bone, FadeIn } from '../../components/GroupSwitchSkeleton';

// ─── Coach ▸ Home (docs/design/coach-dashboard.html) ────────────────────────
// Group readiness in one big number, ten weeks of group practice, what's
// waiting on the coach (to validate, questions, duplicates), Start class, then
// every student as a square — sortable by least practised, readiness or name.

const INK = '#0A0A0A';
const INK_62 = 'rgba(10,10,10,0.62)';
const LINE = 'rgba(10,10,10,0.12)';
const PAGE = '#F2F0EB';
const GOLD = '#E8B530';
const RED = '#A8412F';
const CHART_H = 74;
const EDGE_FADE = 14; // the squares fade out under the sort row as they scroll

const SORTS = [['need', 'Least practised'], ['ready', 'Readiness'], ['az', 'A–Z']];

function initialsOf(name) {
  const w = (name || '').trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '?') + (w[1]?.[0] || '')).toUpperCase();
}

function practisedLabel(iso) {
  if (!iso) return 'Never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

// A short word under the name: where the student stands.
function standing(s) {
  if (s.age_review_pending) return 'Tap to review';
  if (isAwaitingVerification(s)) return 'Awaiting verification';
  if (s.consent_status === 'pending') return 'Awaiting parent';
  if (s.status === 'on_track') return 'On track';
  if (!s.lastActiveDate) return 'Never practised';
  const days = Math.floor((Date.now() - new Date(s.lastActiveDate).getTime()) / 86400000);
  return `Silent ${days} day${days === 1 ? '' : 's'}`;
}

// ── Pieces ───────────────────────────────────────────────────────────────────

// Ten weeks of group practice; this week in gold, an average line across.
function PracticeChart({ weeks }) {
  const max = Math.max(1, ...weeks);
  const avg = weeks.reduce((a, b) => a + b, 0) / weeks.length;
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(rise, { toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [rise]);
  return (
    <View>
      <View style={st.chart}>
        <View style={st.bars}>
          {weeks.map((v, i) => {
            const now = i === weeks.length - 1;
            return (
              <Animated.View
                key={i}
                style={[
                  st.barCol,
                  {
                    height: Math.max(3, Math.round((v / max) * CHART_H)),
                    opacity: now ? 1 : 0.3 + 0.07 * i,
                    transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [CHART_H / 2, 0] }) }],
                  },
                  now && st.barNow,
                ]}
              />
            );
          })}
        </View>
        {avg > 0 && (
          <View style={[st.avgLine, { bottom: Math.round((avg / max) * CHART_H) }]}>
            <Text style={st.avgLabel}>AVG</Text>
          </View>
        )}
      </View>
      <View style={st.axis}>
        <Text style={st.axisT}>10 weeks ago</Text>
        <Text style={st.axisT}>Group practice</Text>
        <Text style={st.axisT}>This week</Text>
      </View>
    </View>
  );
}

// The chart while a group switch loads: the same frame, bars as bones.
const BONE_BARS = [0.34, 0.5, 0.42, 0.62, 0.46, 0.7, 0.52, 0.64, 0.5, 0.8];
function ChartBones() {
  return (
    <View>
      <Pulse style={st.chart}>
        <View style={st.bars}>
          {BONE_BARS.map((f, i) => (
            <View key={i} style={[st.barCol, st.boneFill, { height: Math.round(f * CHART_H) }]} />
          ))}
        </View>
      </Pulse>
      <View style={st.axis}>
        <Text style={st.axisT}>10 weeks ago</Text>
        <Text style={st.axisT}>Group practice</Text>
        <Text style={st.axisT}>This week</Text>
      </View>
    </View>
  );
}

function SquareBones() {
  return (
    <View style={st.square}>
      <Pulse style={{ gap: 9 }}>
        <View style={st.sqHead}>
          <Bone w={29} h={29} r={14.5} />
          <View style={{ flex: 1, gap: 6 }}>
            <Bone w="70%" h={11} r={4} />
            <Bone w="45%" h={8} r={4} />
          </View>
        </View>
        <Bone w={54} h={26} r={6} />
        <Bone w="100%" h={2} r={2} />
        <View style={[st.sqFoot, { justifyContent: 'space-between' }]}>
          <Bone w={52} h={8} r={4} />
          <Bone w={40} h={8} r={4} />
        </View>
      </Pulse>
    </View>
  );
}

function StudentSquare({ s, readiness, onPress }) {
  const hi = s.status === 'on_track';
  const cold = !hi;
  const reviewing = !!s.age_review_pending;
  const waiting = isAwaitingVerification(s) && !reviewing;
  const photo = s.photoUrl || s.photo_url;
  const pct = readiness == null ? null : Math.max(0, Math.min(100, readiness));
  return (
    <TouchableOpacity
      style={[st.square, reviewing && st.squareReview, waiting && { opacity: 0.5 }]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${s.name}, ${pct == null ? 'no lesson yet' : `${pct}% ready`}`}
    >
      <View style={st.sqHead}>
        <View style={st.sqAv}>
          {photo ? (
            <Image source={{ uri: photo }} style={st.sqAvImg} />
          ) : hi ? (
            <LinearGradient colors={['#F6D27A', GOLD]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.sqAvFill}>
              <Text style={[st.sqAvT, { color: INK }]}>{initialsOf(s.name)}</Text>
            </LinearGradient>
          ) : (
            <Text style={st.sqAvT}>{initialsOf(s.name)}</Text>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.sqName} numberOfLines={1}>{s.name}</Text>
          <Text style={[st.sqSub, reviewing && { color: '#8A6414', fontFamily: Fonts.bold }]} numberOfLines={1}>{standing(s)}</Text>
        </View>
      </View>
      <View style={st.sqPctRow}>
        <Text style={st.sqPct}>{pct == null ? '—' : pct}</Text>
        {pct != null && <Text style={st.sqPctSign}>%</Text>}
        <Text style={st.sqPctLabel}>ready</Text>
      </View>
      <View style={st.sqBar}>
        <View style={[st.sqBarFill, { width: `${Math.max(pct ?? 0, 3)}%` }, cold && { backgroundColor: 'rgba(10,10,10,0.28)' }]} />
      </View>
      <View style={st.sqFoot}>
        <Text style={st.sqFootL}>Practised</Text>
        <Text style={st.sqFootV}>{practisedLabel(s.lastActiveDate)}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function DashboardScreen({ navigation }) {
  // Everything below is for the header's group (Latin / Ballroom).
  const { user, students: allStudents, styleStudents: students, styleFilter, styleCategory, actionCounts, requests, refresh, initialLoading: loading } = useCoachData();
  const { setLinksOpen } = useCoachTabView();

  // Whether this coach has taught yet: a lesson on record, or a couple coached.
  // Read once; unknown (offline) counts as taught — never hold a lesson back.
  const [taught, setTaught] = useState(null);
  useEffect(() => {
    if (!user?.id || taught) return undefined;
    let alive = true;
    Promise.all([
      supabase.from('class_inputs').select('id', { count: 'exact', head: true })
        .eq('user_id', user.id).not('is_deleted', 'is', true),
      getMyCouples().catch(() => []),
    ])
      .then(([cls, couples]) => {
        if (!alive) return;
        if (cls.error) { setTaught(true); return; }
        setTaught((cls.count ?? 0) > 0 || (couples || []).length > 0);
      })
      .catch(() => { if (alive) setTaught(true); });
    return () => { alive = false; };
    // A coach who adds a student and comes back is re-read then.
  }, [user?.id, taught, allStudents.length]);

  // Cold-start: once the coach dashboard's initial data has loaded, let App.js
  // drop the logo overlay (mirrors HomeScreen's reveal() on the student side).
  useEffect(() => {
    if (!loading) markFirstScreenReady();
  }, [loading]);

  // Pre-mount sibling tabs (STUDENTS + CLASS) shortly after Home settles, so a
  // tap on either feels instant; warm the student sheet's module too.
  useEffect(() => {
    const t = setTimeout(() => {
      try { navigation.preload?.('STUDENTS'); } catch {}
      try { navigation.preload?.('CLASS'); } catch {}
      try { require('./StudentDetailScreen'); } catch {}
    }, 600);
    return () => clearTimeout(t);
  }, [navigation]);

  // The running class turns Start class into a "Class in progress" pill.
  const [activeClass, setActiveClass] = useState(getActiveCoachClass());
  const [chronoTick, setChronoTick] = useState(0);

  // Local-recording mode: release the audio-route monitor before a class starts.
  const [authUser, setAuthUser] = useState(null);
  useEffect(() => {
    supabase.auth.getUser()
      .then(({ data: { user } }) => setAuthUser(user))
      .catch(() => setAuthUser(null));
  }, []);
  const isLocalMode = isLocalRecordingMode(authUser);

  // ── Notifications-off nudge ──────────────────────────────────────────────
  // A denied iOS permission is invisible: the nightly sync-reminder rows are
  // still created server-side, but no push can ever be delivered. Surface it
  // only when it matters: permission not granted AND a class waiting for audio.
  const { pendingUploadCount, hasFolderAccess, requestMicSetup } = useDjiSync() ?? {};
  const [notifPerm, setNotifPerm] = useState('granted'); // optimistic — no flash
  const notifPermRef = useRef('granted');
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (!alive) return;
        const prev = notifPermRef.current;
        notifPermRef.current = status;
        setNotifPerm(status);
        if (status === 'granted' && prev !== 'granted' && authUser?.id) {
          registerPushToken(authUser.id).catch(() => {});
        }
      } catch { /* keep the last known state */ }
    };
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => { alive = false; sub.remove(); };
  }, [authUser?.id]);

  const showNotifNudge = notifPerm !== 'granted' && (pendingUploadCount ?? 0) > 0;
  const onNotifNudgePress = async () => {
    if (notifPerm === 'undetermined') {
      if (authUser?.id) await registerPushToken(authUser.id).catch(() => {});
      try {
        const { status } = await Notifications.getPermissionsAsync();
        notifPermRef.current = status;
        setNotifPerm(status);
      } catch { /* recheck happens on next foreground */ }
    } else {
      Linking.openSettings();
    }
  };

  useEffect(() => subscribeToActiveCoachClass(setActiveClass), []);
  // Warm the Start-class roster cache so the first open of Start Class is instant.
  useEffect(() => {
    (async () => {
      try {
        const { students: roster } = await getStartClassRoster();
        await AsyncStorage.setItem('startClassRoster.v1', JSON.stringify(roster || []));
      } catch {}
    })();
  }, []);
  useEffect(() => {
    if (!activeClass) return;
    const id = setInterval(() => setChronoTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [activeClass]);
  const chronoLabel = useMemo(() => {
    if (!activeClass) return '';
    const total = Math.floor((Date.now() - activeClass.startedAt) / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(sec).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClass, chronoTick]);

  // ── Readiness ────────────────────────────────────────────────────────────
  // One batch for the roster. null = no private lesson yet (nothing to be
  // ready for); the group number averages the students who have one.
  const [readinessByStudent, setReadinessByStudent] = useState({});
  const [readinessFor, setReadinessFor] = useState(null); // the roster + group it was read for
  const lastSigRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const readinessSig = `${styleCategory}:${students.map((s) => s.id).sort().join('|')}`;
  useEffect(() => {
    const signature = readinessSig;
    if (!students || students.length === 0) {
      setReadinessByStudent({});
      setReadinessFor(signature);
      lastSigRef.current = null; // an empty group, then back: read it again
      return;
    }
    if (signature === lastSigRef.current) return;
    lastSigRef.current = signature;
    // A newer read (another group, a refresh) supersedes this one.
    const current = () => mountedRef.current && lastSigRef.current === signature;
    getStudentsReadiness(students.map((s) => s.id), styleCategory)
      .then((map) => {
        if (!current()) return;
        const byStudent = {};
        for (const s of students) byStudent[s.id] = map[s.id] ? (map[s.id].percent ?? 0) : null;
        setReadinessByStudent(byStudent);
        setReadinessFor(signature);
      })
      .catch(() => { if (current()) { setReadinessByStudent({}); setReadinessFor(signature); } });
  }, [students, styleCategory]);
  // Bones in the screen's own layout — on the first load, until the roster and
  // its readiness are in, and for a second when the group switches.
  const firstDone = useRef(false);
  if (!loading && readinessFor === readinessSig) firstDone.current = true;
  const bones = useGroupSwitch(styleFilter, readinessFor === readinessSig) || !firstDone.current;

  const withLesson = students.filter((s) => readinessByStudent[s.id] != null);
  const groupReadiness = withLesson.length
    ? Math.round(withLesson.reduce((n, s) => n + readinessByStudent[s.id], 0) / withLesson.length)
    : 0;
  const groupWeeks = useMemo(() => {
    const w = new Array(10).fill(0);
    for (const s of students) (s.weeklyMinutes || []).forEach((m, i) => { w[i] += m; });
    return w.map((m) => Math.round(m));
  }, [students]);

  const questions = students.reduce((n, s) => n + (s.pendingQuestions || 0), 0);
  const toValidate = actionCounts?.focus || 0;
  const duplicates = actionCounts?.merge || 0;

  // ── The squares ──────────────────────────────────────────────────────────
  const [sort, setSort] = useState('need');
  const sorted = useMemo(() => {
    const rows = [...students];
    const lastMs = (s) => (s.lastActiveDate ? new Date(s.lastActiveDate).getTime() : 0);
    if (sort === 'need') rows.sort((a, b) => lastMs(a) - lastMs(b));
    if (sort === 'ready') rows.sort((a, b) => (readinessByStudent[b.id] ?? -1) - (readinessByStudent[a.id] ?? -1));
    if (sort === 'az') rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return rows;
  }, [students, sort, readinessByStudent]);

  // "Scroll down" shows while more squares sit below the fold.
  const [more, setMore] = useState(false);
  const gridRef = useRef(null);
  const gridMetrics = useRef({ h: 0, content: 0, y: 0 });
  const updateMore = () => {
    const m = gridMetrics.current;
    setMore(m.content - m.h - m.y > 8);
  };
  useEffect(() => { gridRef.current?.scrollTo({ y: 0, animated: false }); gridMetrics.current.y = 0; updateMore(); }, [sort, styleFilter]);

  const openStudent = (s) =>
    guardStudent(s, () => navigation.navigate('StudentDetail', { studentId: s.id, studentName: s.name }), () => refresh());

  // Pulling the top of the page down (anything above the sort) reloads it.
  const pull = usePullDown(async () => {
    lastSigRef.current = null;   // readiness is re-read even if the roster is the same
    await refresh();
  });

  // What stands between a new coach and a first lesson: a studio (students find
  // their coach through it), then a student. Requests already waiting count as
  // the way in. Only before a coach has taught: one who records lessons with
  // couples or a studio's group, with no student linked, keeps Start.
  const openStudents = () => { setLinksOpen(false); navigation.navigate('STUDENTS'); };
  // The mic comes before the first lesson, not after it. Until the coach has
  // linked the folder once, nothing they record can be imported — so that step
  // takes the main button rather than sitting in a pill they may never notice,
  // and it is the only thing offered here: a lesson started before the mic is
  // linked is a lesson whose audio has nowhere to go. The + on Lessons still
  // reaches Start a lesson for a coach who has to teach anyway.
  const micSetup = isLocalMode && hasFolderAccess === false;
  const setup = !user || taught !== false ? null
    : !(user.studio_id || user.studio?.id)
      ? { icon: 'business-outline', label: 'Add your studio', hint: 'Your students find you through your studio.',
          onPress: () => navigation.navigate('CoachSettings', { open: 'studio' }) }
      : allStudents.length > 0 ? null
        : requests?.length
          ? { icon: 'person-add-outline', label: `Review ${requests.length} request${requests.length === 1 ? '' : 's'}`,
              hint: 'Students asked to join you. Accept them to record their lessons.', onPress: openStudents }
          : { icon: 'person-add-outline', label: 'Add a student', hint: 'Share your invite code — a student links to you with it.',
              onPress: () => { setLinksOpen(true); navigation.navigate('STUDENTS'); } };

  return (
    <View style={st.page}>
      <Animated.View pointerEvents="none" style={[st.pullLogo, { opacity: pull.logoOpacity }]}>
        <PullLogo ref={pull.logoRef} refreshing={pull.refreshing} />
      </Animated.View>
      <Animated.View style={{ flex: 1, transform: [{ translateY: pull.pullY }] }}>
      <View {...pull.panHandlers}>
      {showNotifNudge && (
        <TouchableOpacity style={st.nudge} onPress={onNotifNudgePress} activeOpacity={0.85}>
          <Ionicons name="notifications-off-outline" size={15} color="#F6D27A" />
          <Text style={st.nudgeT} numberOfLines={1}>
            Notifications off. <Text style={st.nudgeA}>Enable upload reminders</Text>
          </Text>
          <Ionicons name="chevron-forward" size={14} color={GOLD} />
        </TouchableOpacity>
      )}


      {/* ── Group readiness, practice, what's waiting, Start class ── */}
      <View style={st.att}>
        <View style={st.big}>
          {bones ? (
            <Pulse><Bone w={96} h={52} r={12} /></Pulse>
          ) : (
            <FadeIn style={st.bigNum}>
              <Text style={st.bigN}>{groupReadiness}</Text>
              <Text style={st.bigPct}>%</Text>
            </FadeIn>
          )}
          <View style={st.bigSide}>
            <Text style={st.bigLabel}>Group readiness</Text>
            {bones ? (
              <Pulse><Bone w={112} h={10} r={4} style={{ marginVertical: 3 }} /></Pulse>
            ) : (
              <Text style={st.bigSub}>
                {students.length === 0 ? 'No students yet'
                  : `across ${students.length} student${students.length === 1 ? '' : 's'}`}
              </Text>
            )}
          </View>
        </View>

        {bones ? <ChartBones /> : <PracticeChart weeks={groupWeeks} />}

        <View style={st.chips}>
          {bones
            ? [0, 1, 2].map((i) => (
                <Pulse key={i} style={st.chip}>
                  <Bone w={26} h={19} r={5} />
                  <Bone w="72%" h={8} r={4} />
                </Pulse>
              ))
            : [
                { n: toValidate, label: 'To validate', red: toValidate > 0, tab: 'focus' },
                { n: questions, label: 'Questions', tab: 'questions' },
                { n: duplicates, label: 'Duplicates', tab: 'merge' },
              ].map((c) => (
                <TouchableOpacity key={c.label} style={[st.chip, c.red && st.chipRed]}
                  onPress={() => navigation.navigate('ActionNeeded', { tab: c.tab })} activeOpacity={0.8}>
                  <Text style={[st.chipN, c.red && { color: RED }, !c.n && { color: 'rgba(10,10,10,0.34)' }]}>{c.n}</Text>
                  <Text style={[st.chipL, c.red && { color: '#8E3627' }]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
        </View>

        {/* A running class isn't tied to the style being shown: its pill stays
            put while the rest swaps. Before the first lesson, the same pill
            walks a new coach through what a lesson needs: a studio, then a
            student. */}
        {activeClass ? (
          <TouchableOpacity style={[st.start, st.startLive]} onPress={() => navigation.navigate('StartClass')} activeOpacity={0.88}>
            <View style={st.liveDot} />
            <Text style={[st.startT, { color: '#FFFFFF' }]}>Lesson in progress</Text>
            <Text style={st.liveTimer}>{chronoLabel}</Text>
          </TouchableOpacity>
        ) : bones || (!!user && taught === null) ? (
          <Pulse style={[st.start, st.startBones]}><Bone w={128} h={17} r={6} /></Pulse>
        ) : setup ? (
          <View style={st.setup}>
            <TouchableOpacity style={st.start} onPress={setup.onPress} activeOpacity={0.88} accessibilityRole="button">
              <Ionicons name={setup.icon} size={18} color={INK} />
              <Text style={st.startT}>{setup.label}</Text>
            </TouchableOpacity>
            <Text style={st.setupHint}>{setup.hint}</Text>
          </View>
        ) : micSetup ? (
          <View style={st.setup}>
            <TouchableOpacity
              style={[st.start, st.startMic]}
              onPress={() => requestMicSetup?.()}
              activeOpacity={0.88}
              accessibilityRole="button"
              accessibilityLabel="Set up your mic"
            >
              <Ionicons name="flash" size={18} color="#FFFFFF" />
              <Text style={[st.startT, { color: '#FFFFFF' }]}>SET UP YOUR MIC</Text>
            </TouchableOpacity>
            <Text style={st.setupHint}>Two minutes, once. After that your lessons import themselves.</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={st.start}
            activeOpacity={0.88}
            onPress={async () => {
              // Local-recording mode: no audio session active during the class.
              if (isLocalMode) {
                try { await DjiFiles.stopAudioRouteMonitor?.(); } catch {}
              }
              navigation.navigate('StartClass');
            }}
          >
            <Ionicons name="play" size={17} color={INK} />
            <Text style={st.startT}>Start a lesson</Text>
          </TouchableOpacity>
        )}
      </View>

      </View>

      {/* ── Sort ── */}
      <View style={st.sort}>
        {bones
          ? <Pulse style={st.sortCount}><Bone w={74} h={9} r={3} /></Pulse>
          : <Text style={st.sortCount}>{students.length} student{students.length === 1 ? '' : 's'}</Text>}
        {SORTS.map(([key, label]) => (
          <TouchableOpacity key={key} style={[st.sortBtn, sort === key && st.sortBtnOn]} onPress={() => setSort(key)} activeOpacity={0.75}>
            <Text style={[st.sortBtnT, sort === key && { color: '#FFFFFF' }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Students ── */}
      <View style={st.gridWrap}>
        <MaskedView
          style={{ flex: 1 }}
          maskElement={
            <View style={{ flex: 1 }}>
              <LinearGradient colors={['transparent', '#000']} style={{ height: EDGE_FADE }} />
              <View style={{ flex: 1, backgroundColor: '#000' }} />
            </View>
          }
        >
        <ScrollView
          ref={gridRef}
          contentContainerStyle={st.grid}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={32}
          onLayout={(e) => { gridMetrics.current.h = e.nativeEvent.layout.height; updateMore(); }}
          onContentSizeChange={(_, h) => { gridMetrics.current.content = h; updateMore(); }}
          onScroll={(e) => { gridMetrics.current.y = e.nativeEvent.contentOffset.y; updateMore(); }}
        >
          {bones ? (
            [0, 1, 2, 3].map((i) => <View key={i} style={st.cell}><SquareBones /></View>)
          ) : sorted.length === 0 ? (
            <Text style={st.empty}>
              {allStudents.length > 0
                ? `No ${styleFilter === 'ballroom' ? 'Ballroom' : 'Latin'} students yet.`
                : 'No students yet. Share your invite code from Students ▸ Links to add them.'}
            </Text>
          ) : (
            <FadeIn style={st.gridFade}>
              {sorted.map((s) => (
                <View key={s.id} style={st.cell}>
                  <StudentSquare s={s} readiness={readinessByStudent[s.id] ?? null} onPress={() => openStudent(s)} />
                </View>
              ))}
            </FadeIn>
          )}
        </ScrollView>
        </MaskedView>
        {more && (
          <View pointerEvents="none" style={st.moreWrap}>
            <LinearGradient colors={['rgba(242,240,235,0)', 'rgba(242,240,235,0.8)', PAGE]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
            <View style={st.moreHint}>
              <Text style={st.moreT}>Scroll down</Text>
              <Ionicons name="arrow-down" size={11} color={INK_62} />
            </View>
          </View>
        )}
      </View>
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  page: { flex: 1, backgroundColor: PAGE },
  setup: { gap: 9 },
  setupHint: { fontFamily: Fonts.regular, fontSize: 12, lineHeight: 16, color: INK_62, textAlign: 'center', paddingHorizontal: 12 },
  pullLogo: { position: 'absolute', top: (PULL_REST - 27) / 2, left: 0, right: 0, alignItems: 'center' },

  nudge: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: Spacing.side, marginBottom: 6,
    paddingVertical: 9, paddingHorizontal: 12, backgroundColor: '#000000', borderRadius: 12,
  },
  nudgeT: { flex: 1, fontFamily: Fonts.medium, fontSize: 12, color: 'rgba(255,255,255,0.8)' },
  nudgeA: { fontFamily: Fonts.bold, color: GOLD },

  att: { marginHorizontal: Spacing.side, gap: 16, paddingTop: 12, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: LINE },
  big: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  bigNum: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  bigN: { fontFamily: Fonts.extraBold, fontSize: 56, letterSpacing: -3, lineHeight: 52, color: INK, fontVariant: ['tabular-nums'] },
  bigPct: { fontFamily: Fonts.bold, fontSize: 32, lineHeight: 34, color: 'rgba(10,10,10,0.4)', paddingBottom: 2 },
  bigSide: { flex: 1, marginLeft: 8, paddingBottom: 6 },
  bigLabel: { fontFamily: Fonts.semiBold, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: INK, paddingBottom: 3 },
  bigSub: { fontFamily: Fonts.regular, fontSize: 12, lineHeight: 16, color: INK_62 },

  chart: { height: CHART_H },
  bars: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  barCol: { flex: 1, backgroundColor: INK, borderRadius: 3 },
  barNow: { backgroundColor: GOLD },
  boneFill: { backgroundColor: 'rgba(10,10,10,0.08)' },
  avgLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1, borderTopColor: 'rgba(10,10,10,0.16)' },
  avgLabel: {
    position: 'absolute', left: 0, top: -7, paddingRight: 6, backgroundColor: PAGE,
    fontFamily: Fonts.semiBold, fontSize: 8.5, letterSpacing: 1.2, color: 'rgba(10,10,10,0.6)',
  },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 },
  axisT: { fontFamily: Fonts.semiBold, fontSize: 9.5, letterSpacing: 0.95, textTransform: 'uppercase', color: INK_62 },

  chips: { flexDirection: 'row', gap: 9 },
  chip: {
    flex: 1, backgroundColor: '#FFFFFF', borderRadius: 15, paddingVertical: 9, paddingHorizontal: 11, gap: 5,
    borderWidth: 1, borderColor: 'rgba(10,10,10,0.06)',
  },
  chipRed: { backgroundColor: '#FCF1EE', borderColor: 'rgba(168,65,47,0.28)' },
  chipN: { fontFamily: Fonts.bold, fontSize: 20, letterSpacing: -1, lineHeight: 21, color: INK },
  chipL: { fontFamily: Fonts.semiBold, fontSize: 9, letterSpacing: 1.1, textTransform: 'uppercase', color: 'rgba(10,10,10,0.58)' },

  start: {
    height: 58, borderRadius: 999, backgroundColor: GOLD, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 11,
  },
  startT: { fontFamily: Fonts.bold, fontSize: 19, letterSpacing: -0.4, color: INK },
  startLive: { backgroundColor: INK },
  // The one CTA that isn't gold: linking the mic is the only thing that can
  // quietly cost a coach a whole lesson's audio.
  startMic: { backgroundColor: '#C93838' },
  startBones: { backgroundColor: 'rgba(10,10,10,0.06)' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D06A5A' },
  liveTimer: { fontFamily: Fonts.bold, fontSize: 15, color: GOLD, fontVariant: ['tabular-nums'] },

  sort: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: Spacing.side, paddingTop: 16 },
  sortCount: { flex: 1, fontFamily: Fonts.semiBold, fontSize: 9.5, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(10,10,10,0.6)' },
  sortBtn: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, borderWidth: 1, borderColor: 'rgba(10,10,10,0.14)' },
  sortBtnOn: { backgroundColor: INK, borderColor: INK },
  sortBtnT: { fontFamily: Fonts.semiBold, fontSize: 10.5, color: 'rgba(10,10,10,0.6)' },

  gridWrap: { flex: 1 },
  // paddingTop keeps the first row clear of the fade at rest (same gap under the sort row as before).
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: Spacing.side - 4.5, paddingTop: 10, paddingBottom: 16 },
  cell: { width: '50%', padding: 4.5 },
  gridFade: { width: '100%', flexDirection: 'row', flexWrap: 'wrap' },
  square: {
    minHeight: 130, gap: 9, backgroundColor: '#FFFFFF', borderRadius: 17, paddingTop: 12, paddingHorizontal: 13, paddingBottom: 11,
    borderWidth: 1, borderColor: 'rgba(10,10,10,0.07)',
  },
  squareReview: { backgroundColor: '#FDF3D6', borderColor: GOLD, borderWidth: 1.5 },
  sqHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  sqAv: { width: 29, height: 29, borderRadius: 14.5, overflow: 'hidden', backgroundColor: '#F4F2EC', alignItems: 'center', justifyContent: 'center' },
  sqAvImg: { width: 29, height: 29 },
  sqAvFill: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  sqAvT: { fontFamily: Fonts.bold, fontSize: 11, color: 'rgba(10,10,10,0.6)' },
  sqName: { fontFamily: Fonts.semiBold, fontSize: 13.5, letterSpacing: -0.2, color: INK },
  sqSub: { fontFamily: Fonts.regular, fontSize: 10.5, color: 'rgba(10,10,10,0.6)', marginTop: 2 },
  sqPctRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  sqPct: { fontFamily: Fonts.bold, fontSize: 25, letterSpacing: -1.1, lineHeight: 26, color: INK },
  sqPctSign: { fontFamily: Fonts.semiBold, fontSize: 13, color: 'rgba(10,10,10,0.42)' },
  sqPctLabel: { marginLeft: 'auto', fontFamily: Fonts.semiBold, fontSize: 9.5, letterSpacing: 0.95, textTransform: 'uppercase', color: 'rgba(10,10,10,0.6)' },
  sqBar: { height: 2, borderRadius: 2, backgroundColor: 'rgba(10,10,10,0.1)', overflow: 'hidden' },
  sqBarFill: { height: '100%', borderRadius: 2, backgroundColor: GOLD },
  sqFoot: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: 'rgba(10,10,10,0.07)', paddingTop: 8 },
  sqFootL: { fontFamily: Fonts.semiBold, fontSize: 9.5, letterSpacing: 0.95, textTransform: 'uppercase', color: 'rgba(10,10,10,0.6)' },
  sqFootV: { marginLeft: 'auto', fontFamily: Fonts.semiBold, fontSize: 10.5, color: INK },

  moreWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 46, justifyContent: 'flex-end' },
  moreHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 4 },
  moreT: { fontFamily: Fonts.semiBold, fontSize: 9.5, letterSpacing: 1.5, textTransform: 'uppercase', color: INK_62 },

  empty: { width: '100%', paddingTop: 24, textAlign: 'center', fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19, color: 'rgba(10,10,10,0.6)' },
});
