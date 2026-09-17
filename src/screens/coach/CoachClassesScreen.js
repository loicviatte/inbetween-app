import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable, Animated, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { useFocusEffect } from '@react-navigation/native';
import { Fonts, Spacing } from '../../theme';
import { useCoachData } from '../../context/CoachDataContext';
import { useClassesView } from '../../context/CoachClassesView';
import { getMyClasses } from '../../storage/coachStorage';
import { categoryFromDances } from '../../utils/danceCategory';
import { useTabBarSpace } from '../../components/CustomTabBar';
import PullLogo from '../../components/PullLogo';
import usePullDown, { PULL_REST } from '../../components/usePullDown';
import useSlideSwap from '../../components/useSlideSwap';
import { Pulse, Bone, FadeIn } from '../../components/GroupSwitchSkeleton';

// ─── Coach ▸ Class (docs/design/coach-classes.html) ─────────────────────────
// Every class logged, month by month, filtered All / Group / Private. The
// header's calendar button turns it into a month grid with the day's classes
// under it; its notes button shows the coach's notes. "Classes ▾" narrows it
// all to a style for a coach who teaches both. + starts a class (or a note).

const INK = '#0A0A0A';
const INK_62 = 'rgba(10,10,10,0.62)';
const LINE = 'rgba(10,10,10,0.12)';
const PAGE = '#F2F0EB';
const GOLD = '#E8B530';
const GOLD_INK = '#8A6414';
const NAVY = '#22314D';
const EDGE_FADE = 14;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const KINDS = [['all', 'All'], ['group', 'Group'], ['private', 'Private']];

// ─── Class facts ─────────────────────────────────────────────────────────────

const isGroup = (c) => c.lesson_type === 'group' || c.lesson_type === 'public';
const kindLabel = (c) => (isGroup(c) ? 'Group' : c.lesson_type === 'couple' ? 'Couple' : 'Private');
const isProcessing = (c) => ['processing', 'pending', 'extracted'].includes(c.status);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 'es'}`;

function titleOf(c) {
  return c.title || c.ai_primary_focus || (isProcessing(c) ? 'Processing class…' : 'Untitled class');
}

// `dance` is "Rumba", "Cha Cha, Rumba" or a JSON list.
function dancesOf(c) {
  const raw = (c.dance || '').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try { return JSON.parse(raw).map((d) => String(d).trim()).filter(Boolean); } catch { return []; }
  }
  return raw.split(',').map((d) => d.trim()).filter(Boolean);
}

// Latin or Ballroom: the dances when the class names them, otherwise the one
// style its students are coached in here. null (unknown) shows under both.
function styleOf(c, stylesByStudent) {
  const fromDances = categoryFromDances(dancesOf(c));
  if (fromDances) return fromDances;
  const styles = new Set();
  for (const s of c.students || []) for (const st of stylesByStudent[s.id] || []) styles.add(st);
  return styles.size === 1 ? [...styles][0] : null;
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function initialsOf(name) {
  const w = (name || '').trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '?') + (w[1]?.[0] || '')).toUpperCase();
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function Who({ people, goldIds }) {
  if (!people.length) return null;
  const shown = people.slice(0, 2);
  const extra = people.length - shown.length;
  return (
    <View style={st.who}>
      {shown.map((p) => (
        <View key={p.id} style={st.whoAv}>
          {p.photoUrl ? (
            <Image source={{ uri: p.photoUrl }} style={StyleSheet.absoluteFill} />
          ) : goldIds.has(p.id) ? (
            <LinearGradient colors={['#F6D27A', GOLD]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.whoFill}>
              <Text style={[st.whoT, { color: INK }]}>{initialsOf(p.name)}</Text>
            </LinearGradient>
          ) : (
            <Text style={st.whoT}>{initialsOf(p.name)}</Text>
          )}
        </View>
      ))}
      {extra > 0 && (
        <View style={[st.whoAv, st.whoMore]}>
          <Text style={[st.whoT, { fontSize: 8 }]}>+{extra}</Text>
        </View>
      )}
    </View>
  );
}

function ClassRow({ c, first, goldIds, onPress }) {
  const d = new Date(c.created_at);
  const priv = !isGroup(c);
  const n = c.students?.length || 0;
  const meta = [
    isProcessing(c) ? 'Processing' : null,
    c.durationMin != null ? `${c.durationMin} min` : null,
    n ? `${n} student${n === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [st.cl, !first && st.clLine, pressed && { backgroundColor: '#FBFAF7' }]}
      accessibilityRole="button"
      accessibilityLabel={`${kindLabel(c)} class, ${MONTHS[d.getMonth()]} ${d.getDate()}: ${titleOf(c)}`}
    >
      <View style={[st.dt, priv && st.dtPriv]}>
        <Text style={[st.dtD, priv && { color: NAVY }]}>{d.getDate()}</Text>
        <Text style={st.dtM}>{MONTHS[d.getMonth()].slice(0, 3)}</Text>
      </View>
      <View style={st.bd}>
        <Text style={st.clT} numberOfLines={2}>{titleOf(c)}</Text>
        <View style={st.mt}>
          <Text style={[st.tp, priv && { color: NAVY }]}>{kindLabel(c)}</Text>
          {meta.map((m) => (
            <React.Fragment key={m}>
              <View style={st.mtDot} />
              <Text style={st.mtT} numberOfLines={1}>{m}</Text>
            </React.Fragment>
          ))}
        </View>
      </View>
      <Who people={c.students || []} goldIds={goldIds} />
    </Pressable>
  );
}

function Rows({ list, goldIds, onOpen }) {
  return (
    <View style={st.rows}>
      {list.map((c, i) => <ClassRow key={c.id} c={c} first={i === 0} goldIds={goldIds} onPress={() => onOpen(c)} />)}
    </View>
  );
}

function NoteCard({ note, onPress }) {
  const d = new Date(note.updated_at || note.created_at);
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const when = sameDay(d, now) ? 'Today' : sameDay(d, yesterday) ? 'Yesterday'
    : `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''}`;
  const clips = note.video_clips?.length || 0;
  const link = [note.linkedStudent?.name, note.linkedClass?.title].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [st.note, pressed && { borderColor: 'rgba(10,10,10,0.24)' }]}
      accessibilityRole="button"
    >
      <Text style={st.noteWhen}>{when}{clips ? ` · ${clips} clip${clips === 1 ? '' : 's'}` : ''}</Text>
      <Text style={[st.noteT, !note.title && { color: 'rgba(10,10,10,0.4)' }]} numberOfLines={2}>{note.title || 'Untitled note'}</Text>
      {!!note.content && <Text style={st.noteB} numberOfLines={2}>{note.content}</Text>}
      {!!link && (
        <View style={st.noteLink}>
          <Ionicons name="link" size={12} color="rgba(10,10,10,0.4)" />
          <Text style={st.noteLinkT} numberOfLines={1}>{link}</Text>
        </View>
      )}
    </Pressable>
  );
}

// "This week", "Earlier in September", "August", "December 2025".
function noteGroupOf(iso) {
  const d = new Date(iso);
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  if (d >= monday) return 'This week';
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return `Earlier in ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? MONTHS[d.getMonth()] : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function Empty({ text }) {
  return <Text style={st.empty}>{text}</Text>;
}

function ListBones() {
  return (
    <View>
      {[3, 2].map((count, s) => (
        <View key={s}>
          <Pulse style={st.mk}>
            <Bone w={70} h={9} r={4} />
            <Bone w={52} h={9} r={4} />
          </Pulse>
          <View style={st.rows}>
            {Array.from({ length: count }).map((_, i) => (
              <View key={i} style={[st.cl, i > 0 && st.clLine]}>
                <Pulse style={st.boneRow}>
                  <Bone w={44} h={44} r={13} />
                  <View style={{ flex: 1, gap: 8 }}>
                    <Bone w={i % 2 ? '58%' : '76%'} h={12} r={4} />
                    <Bone w="50%" h={9} r={4} />
                  </View>
                  <Bone w={23} h={23} r={11.5} />
                </Pulse>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function CoachClassesScreen({ navigation }) {
  const { notes, students, refresh } = useCoachData();
  const { view, style, setLogged } = useClassesView();
  const tabBarSpace = useTabBarSpace();
  const { width } = useWindowDimensions();

  const [classes, setClasses] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [kind, setKind] = useState('all');

  // Fresh on every visit: a class recorded elsewhere shows up when the coach comes back.
  const load = useCallback(async () => {
    try { setClasses(await getMyClasses()); } catch {}
    setLoaded(true);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { if (loaded) setLogged(classes.length); }, [loaded, classes.length, setLogged]);

  const pull = usePullDown(() => Promise.all([load(), refresh()]));

  // The style each student is coached in here, and who's on track (gold initials).
  const stylesByStudent = useMemo(() => Object.fromEntries(students.map((s) => [s.id, s.coachStyles || []])), [students]);
  const goldIds = useMemo(() => new Set(students.filter((s) => s.status === 'on_track').map((s) => s.id)), [students]);

  const inStyle = useMemo(() => (
    style === 'all' ? classes : classes.filter((c) => {
      const cat = styleOf(c, stylesByStudent);
      return cat == null || cat === style;
    })
  ), [classes, style, stylesByStudent]);
  const filtered = useMemo(() => (
    kind === 'all' ? inStyle : inStyle.filter((c) => (kind === 'group') === isGroup(c))
  ), [inStyle, kind]);

  // Views and filters slide like the other tabs' toggles.
  const [shownView, viewSlide] = useSlideSwap(view, ['list', 'cal', 'notes']);
  const [shownKind, kindSlide] = useSlideSwap(kind, KINDS.map(([k]) => k));
  const shownList = shownKind === kind ? filtered
    : (shownKind === 'all' ? inStyle : inStyle.filter((c) => (shownKind === 'group') === isGroup(c)));

  // ── List: month by month ──
  const months = useMemo(() => {
    const out = [];
    const thisYear = new Date().getFullYear();
    for (const c of shownList) {
      const d = new Date(c.created_at);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!out.length || out[out.length - 1].key !== key) {
        out.push({ key, label: MONTHS[d.getMonth()] + (d.getFullYear() !== thisYear ? ` ${d.getFullYear()}` : ''), list: [] });
      }
      out[out.length - 1].list.push(c);
    }
    return out;
  }, [shownList]);

  // ── Calendar ──
  const now = new Date();
  const [month, setMonth] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [day, setDay] = useState(null);
  const earliest = useMemo(() => {
    const last = classes[classes.length - 1]; // newest first
    const d = last ? new Date(last.created_at) : now;
    return { y: d.getFullYear(), m: d.getMonth() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classes]);
  const monthIndex = (x) => x.y * 12 + x.m;
  const canPrev = monthIndex(month) > monthIndex(earliest);
  const canNext = monthIndex(month) < monthIndex({ y: now.getFullYear(), m: now.getMonth() });
  const stepMonth = (by) => {
    const i = monthIndex(month) + by;
    setMonth({ y: Math.floor(i / 12), m: i % 12 });
    setDay(null);
  };
  const monthClasses = useMemo(() => filtered.filter((c) => {
    const d = new Date(c.created_at);
    return d.getFullYear() === month.y && d.getMonth() === month.m;
  }), [filtered, month]);
  const byDay = useMemo(() => {
    const map = {};
    for (const c of monthClasses) {
      const n = new Date(c.created_at).getDate();
      const e = (map[n] ||= { group: false, private: false });
      e[isGroup(c) ? 'group' : 'private'] = true;
    }
    return map;
  }, [monthClasses]);
  const dayClasses = day == null ? monthClasses : monthClasses.filter((c) => new Date(c.created_at).getDate() === day);
  const cellW = Math.floor((width - Spacing.side * 2 - 6 * 4) / 7);
  const lead = (new Date(month.y, month.m, 1).getDay() + 6) % 7;
  const daysIn = new Date(month.y, month.m + 1, 0).getDate();
  const isThisMonth = month.y === now.getFullYear() && month.m === now.getMonth();

  // ── Notes ──
  const noteGroups = useMemo(() => {
    const out = [];
    for (const n of notes) {
      const label = noteGroupOf(n.updated_at || n.created_at);
      if (!out.length || out[out.length - 1].label !== label) out.push({ label, list: [] });
      out[out.length - 1].list.push(n);
    }
    return out;
  }, [notes]);

  // Back to the top whenever what's listed changes.
  const scrollRef = useRef(null);
  useEffect(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); }, [shownView, shownKind, style, month, day]);

  const openClass = (c) => navigation.navigate('CoachClassDetail', { classId: c.id });
  const onAdd = () => (view === 'notes' ? navigation.navigate('CoachNoteDetail', {}) : navigation.navigate('StartClass'));

  const count = shownView === 'notes' ? `${notes.length} note${notes.length === 1 ? '' : 's'}`
    : shownView === 'cal' ? `${plural(monthClasses.length, 'class')} in ${MONTHS[month.m]}`
    : plural(filtered.length, 'class');

  return (
    <View style={st.page}>
      <Animated.View pointerEvents="none" style={[st.pullLogo, { opacity: pull.logoOpacity }]}>
        <PullLogo ref={pull.logoRef} refreshing={pull.refreshing} />
      </Animated.View>
      <Animated.View style={{ flex: 1, transform: [{ translateY: pull.pullY }] }}>
        <Animated.View style={[{ flex: 1 }, viewSlide]}>
          {/* Fixed: the filters (or the notes line) and, in the calendar, the month.
              Pulling this part down refreshes. */}
          <View style={st.fixed} {...pull.panHandlers}>
            {shownView === 'notes' ? (
              <View style={st.tabs}>
                <View style={[st.tab, st.tabOn]}><Text style={[st.tabT, st.tabTOn]}>Notes</Text></View>
                <Text style={st.count}>{count}</Text>
              </View>
            ) : (
              <View style={st.tabs}>
                {KINDS.map(([k, label]) => (
                  <TouchableOpacity key={k} style={[st.tab, kind === k && st.tabOn]} onPress={() => setKind(k)} activeOpacity={0.7}
                    accessibilityRole="tab" accessibilityState={{ selected: kind === k }}>
                    <Text style={[st.tabT, kind === k && st.tabTOn]}>{label}</Text>
                  </TouchableOpacity>
                ))}
                <Text style={st.count}>{count}</Text>
              </View>
            )}

            {shownView === 'cal' && (
              <View>
                <View style={st.mh}>
                  <Text style={st.mhT}>{MONTHS[month.m]} <Text style={st.mhY}>{month.y}</Text></Text>
                  <TouchableOpacity style={[st.mhBtn, !canPrev && { opacity: 0.35 }]} disabled={!canPrev} onPress={() => stepMonth(-1)} accessibilityLabel="Previous month">
                    <Ionicons name="chevron-back" size={14} color={INK} />
                  </TouchableOpacity>
                  <TouchableOpacity style={[st.mhBtn, !canNext && { opacity: 0.35 }]} disabled={!canNext} onPress={() => stepMonth(1)} accessibilityLabel="Next month">
                    <Ionicons name="chevron-forward" size={14} color={INK} />
                  </TouchableOpacity>
                </View>
                <View style={st.dow}>
                  {DOW.map((d, i) => <Text key={i} style={[st.dowT, { width: cellW }]}>{d}</Text>)}
                </View>
                <View style={st.grid}>
                  {Array.from({ length: lead }).map((_, i) => <View key={`b${i}`} style={{ width: cellW, height: 40 }} />)}
                  {Array.from({ length: daysIn }).map((_, i) => {
                    const n = i + 1;
                    const has = byDay[n];
                    const on = day === n;
                    const today = isThisMonth && n === now.getDate();
                    return (
                      <TouchableOpacity
                        key={n}
                        disabled={!has}
                        onPress={() => setDay(on ? null : n)}
                        activeOpacity={0.75}
                        style={[st.cell, { width: cellW }, has && st.cellHas, on && st.cellOn]}
                        accessibilityLabel={has ? `${MONTHS[month.m]} ${n}` : undefined}
                      >
                        <Text style={[st.cellT, has && st.cellTHas, on && { color: '#FFFFFF' }, today && st.cellToday]}>{n}</Text>
                        <View style={st.cellDots}>
                          {has?.group && <View style={[st.cellDot, { backgroundColor: GOLD }]} />}
                          {has?.private && <View style={[st.cellDot, { backgroundColor: on ? '#FFFFFF' : NAVY }]} />}
                          {!has && <View style={st.cellDot} />}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={st.key}>
                  <View style={st.keyItem}><View style={[st.cellDot, { backgroundColor: GOLD }]} /><Text style={st.keyT}>Group</Text></View>
                  <View style={st.keyItem}><View style={[st.cellDot, { backgroundColor: NAVY }]} /><Text style={st.keyT}>Private</Text></View>
                  {day != null && (
                    <TouchableOpacity style={{ marginLeft: 'auto' }} onPress={() => setDay(null)} hitSlop={8}>
                      <Text style={st.keyBtn}>Show whole month</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}
          </View>

          <MaskedView
            style={{ flex: 1 }}
            maskElement={
              <View style={{ flex: 1 }}>
                <LinearGradient colors={['transparent', '#000']} style={{ height: EDGE_FADE }} />
                <View style={{ flex: 1, backgroundColor: '#000' }} />
                <LinearGradient colors={['#000', 'rgba(0,0,0,0.5)', 'transparent']} locations={[0, 0.55, 1]} style={{ height: tabBarSpace + 34 }} />
              </View>
            }
          >
            <ScrollView
              ref={scrollRef}
              style={{ flex: 1 }}
              contentContainerStyle={[st.scroll, { paddingBottom: tabBarSpace + 96 }]}
              showsVerticalScrollIndicator={false}
            >
              {shownView === 'notes' ? (
                noteGroups.length === 0 ? (
                  <Empty text="No notes yet. Tap + to write your first one." />
                ) : (
                  <FadeIn>
                    {noteGroups.map((g) => (
                      <View key={g.label}>
                        <View style={st.ng}>
                          <Text style={st.ngT}>{g.label}</Text>
                          <View style={st.ngRule} />
                        </View>
                        {g.list.map((n) => (
                          <NoteCard key={n.id} note={n} onPress={() => navigation.navigate('CoachNoteDetail', { noteId: n.id })} />
                        ))}
                      </View>
                    ))}
                  </FadeIn>
                )
              ) : !loaded ? (
                <ListBones />
              ) : shownView === 'cal' ? (
                <View style={{ paddingTop: 12 }}>
                  {dayClasses.length === 0 ? (
                    <Empty text={day != null ? `Nothing logged on ${MONTHS[month.m]} ${day}.` : `Nothing logged in ${MONTHS[month.m]}.`} />
                  ) : (
                    <Rows list={dayClasses} goldIds={goldIds} onOpen={openClass} />
                  )}
                </View>
              ) : (
                <Animated.View style={kindSlide}>
                  {months.length === 0 ? (
                    <Empty text={classes.length === 0 ? 'No classes yet. Tap + to start recording one.' : 'No class matches this filter.'} />
                  ) : (
                    <FadeIn>
                      {months.map((mo) => (
                        <View key={mo.key}>
                          <View style={st.mk}>
                            <Text style={st.mkT}>{mo.label}</Text>
                            <Text style={st.mkN}>{plural(mo.list.length, 'class')}</Text>
                          </View>
                          <Rows list={mo.list} goldIds={goldIds} onOpen={openClass} />
                        </View>
                      ))}
                    </FadeIn>
                  )}
                </Animated.View>
              )}
            </ScrollView>
          </MaskedView>
        </Animated.View>
      </Animated.View>

      <TouchableOpacity
        style={[st.add, { bottom: tabBarSpace + 14 }]}
        onPress={onAdd}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={view === 'notes' ? 'Add a note' : 'Start a class'}
      >
        <Ionicons name="add" size={28} color={INK} />
      </TouchableOpacity>
    </View>
  );
}

const st = StyleSheet.create({
  page: { flex: 1, backgroundColor: PAGE },
  pullLogo: { position: 'absolute', top: (PULL_REST - 27) / 2, left: 0, right: 0, alignItems: 'center' },
  fixed: { paddingHorizontal: Spacing.side },
  scroll: { paddingHorizontal: Spacing.side },

  // All · Group · Private, and the count
  tabs: { flexDirection: 'row', alignItems: 'flex-end', gap: 22, marginTop: 6, borderBottomWidth: 1, borderBottomColor: LINE },
  tab: { paddingBottom: 9, marginBottom: -1, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: GOLD },
  tabT: { fontFamily: Fonts.ttDemiBold, fontSize: 15, letterSpacing: -0.3, color: 'rgba(10,10,10,0.6)' },
  tabTOn: { color: INK },
  count: { marginLeft: 'auto', paddingBottom: 11, fontFamily: Fonts.ttRegular, fontSize: 11.5, color: INK_62 },

  // Month label over a card of rows
  mk: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 18, paddingBottom: 8, paddingHorizontal: 2 },
  mkT: { fontFamily: Fonts.ttDemiBold, fontSize: 9.5, letterSpacing: 1.6, textTransform: 'uppercase', color: INK_62 },
  mkN: { fontFamily: Fonts.ttMedium, fontSize: 11, color: INK_62 },
  rows: {
    backgroundColor: '#FFFFFF', borderRadius: 18, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(10,10,10,0.06)',
  },
  cl: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 13, paddingHorizontal: 15 },
  clLine: { borderTopWidth: 1, borderTopColor: 'rgba(10,10,10,0.07)' },
  boneRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 13 },
  dt: { width: 44, height: 44, borderRadius: 13, backgroundColor: '#FCEFC9', alignItems: 'center', justifyContent: 'center', gap: 2 },
  dtPriv: { backgroundColor: 'rgba(34,49,77,0.08)' },
  dtD: { fontFamily: Fonts.ttBold, fontSize: 19, letterSpacing: -0.95, lineHeight: 20, color: GOLD_INK, fontVariant: ['tabular-nums'] },
  dtM: { fontFamily: Fonts.ttBold, fontSize: 8, letterSpacing: 0.7, textTransform: 'uppercase', color: INK_62 },
  bd: { flex: 1, minWidth: 0, gap: 4 },
  clT: { fontFamily: Fonts.ttDemiBold, fontSize: 14.5, letterSpacing: -0.3, lineHeight: 19, color: INK },
  mt: { flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0 },
  tp: { fontFamily: Fonts.ttBold, fontSize: 8.5, letterSpacing: 0.85, textTransform: 'uppercase', color: GOLD_INK },
  mtDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(10,10,10,0.22)' },
  mtT: { flexShrink: 1, fontFamily: Fonts.ttRegular, fontSize: 11, color: INK_62 },
  who: { flexDirection: 'row', gap: 3 },
  whoAv: { width: 23, height: 23, borderRadius: 11.5, overflow: 'hidden', backgroundColor: '#F4F2EC', alignItems: 'center', justifyContent: 'center' },
  whoFill: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  whoMore: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(10,10,10,0.16)' },
  whoT: { fontFamily: Fonts.ttBold, fontSize: 9, color: 'rgba(10,10,10,0.62)' },

  // Calendar
  mh: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 14 },
  mhT: { flex: 1, fontFamily: Fonts.ttBold, fontSize: 20, letterSpacing: -0.6, lineHeight: 22, color: INK },
  mhY: { fontFamily: Fonts.ttMedium, color: 'rgba(10,10,10,0.42)' },
  mhBtn: {
    width: 30, height: 30, borderRadius: 9, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    shadowColor: INK, shadowOpacity: 0.07, shadowOffset: { width: 0, height: 1 }, shadowRadius: 2, elevation: 1,
  },
  dow: { flexDirection: 'row', gap: 4, paddingTop: 13, paddingBottom: 6 },
  dowT: { textAlign: 'center', fontFamily: Fonts.ttDemiBold, fontSize: 9, letterSpacing: 1.26, color: 'rgba(10,10,10,0.6)' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  cell: { height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center', gap: 4 },
  cellHas: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(10,10,10,0.09)' },
  cellOn: { backgroundColor: INK, borderColor: INK },
  cellT: { fontFamily: Fonts.ttMedium, fontSize: 12.5, lineHeight: 14, color: 'rgba(10,10,10,0.42)', fontVariant: ['tabular-nums'] },
  cellTHas: { fontFamily: Fonts.ttDemiBold, color: INK },
  cellToday: { textDecorationLine: 'underline', textDecorationColor: GOLD },
  cellDots: { flexDirection: 'row', gap: 3, height: 5 },
  cellDot: { width: 5, height: 5, borderRadius: 2.5 },
  key: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 11, paddingBottom: 9, paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: LINE },
  keyItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  keyT: { fontFamily: Fonts.ttRegular, fontSize: 10.5, color: INK_62 },
  keyBtn: { fontFamily: Fonts.ttDemiBold, fontSize: 11, color: GOLD_INK },

  // Notes
  ng: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 18, paddingBottom: 9 },
  ngT: { fontFamily: Fonts.ttDemiBold, fontSize: 9.5, letterSpacing: 1.6, textTransform: 'uppercase', color: INK_62 },
  ngRule: { flex: 1, height: 1, backgroundColor: LINE },
  note: {
    gap: 5, backgroundColor: '#FFFFFF', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 8,
    borderWidth: 1, borderColor: 'rgba(10,10,10,0.06)',
  },
  noteWhen: { fontFamily: Fonts.ttRegular, fontSize: 11, color: INK_62 },
  noteT: { fontFamily: Fonts.ttBold, fontSize: 16.5, letterSpacing: -0.4, lineHeight: 20, color: INK },
  noteB: { fontFamily: Fonts.ttRegular, fontSize: 13, lineHeight: 19, color: INK_62 },
  noteLink: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 3 },
  noteLinkT: { flexShrink: 1, fontFamily: Fonts.ttDemiBold, fontSize: 11, color: INK },

  empty: { paddingTop: 20, fontFamily: Fonts.ttRegular, fontSize: 13, lineHeight: 19, color: INK_62 },

  add: {
    position: 'absolute', right: Spacing.side, width: 56, height: 56, borderRadius: 28, backgroundColor: GOLD,
    alignItems: 'center', justifyContent: 'center',
  },
});
