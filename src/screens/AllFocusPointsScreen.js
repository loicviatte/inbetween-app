// Every focus point the dancer can train (docs/design/all-focus-points.html):
// one feed per side — what is active now, then what has been retired — in the
// dark cards of the Train page, with the practice button on each one. A group
// lesson's focus points retire when the same coach's next group lesson goes
// live, so the Group side shows the latest lesson per coach, then the rest.
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Fonts } from '../theme';
import {
  getAllFocusPointsBundle,
  getActiveSoloFocusPoints,
  getPastFocusPoints,
  getPastGroupFocusPoints,
  getSessionCountForFocus,
  startTrainingSession,
} from '../utils/algorithm';
import { getActiveSession } from '../storage/activeSession';
import { SkeletonBox } from '../components/Skeleton';
import { StyleMenu, MENU_W } from '../components/StyleTitle';
import { dayLabel } from '../utils/dates';
import { categoryFromDances } from '../utils/danceCategory';

const PAGE = '#F2F0EB';
const INK = '#0A0A0A';
const INK_62 = 'rgba(10,10,10,0.62)';
const INK_65 = 'rgba(10,10,10,0.65)';
const LINE = 'rgba(10,10,10,0.12)';
const GOLD = '#E8B530';
const GOLD_INK = '#8A6414';
const SALMON = '#F6A192';
const RED = '#A8412F';
const NAVY = '#22314D';
const SIDE = 20;
const EDGE_FADE = 14;
const CACHE_KEY = '@cache_all_focus_v2:'; // suffixed by dance category ('all' | 'latin' | 'ballroom')

// Tone on the dark card, then on the white one of a retired focus point.
const TIER = {
  critical:   { label: 'Critical',   dark: SALMON, light: RED },
  important:  { label: 'Important',  dark: GOLD,   light: GOLD_INK },
  supporting: { label: 'Supporting', dark: GOLD,   light: GOLD_INK },
};
const NO_TIER = { label: 'Focus', dark: GOLD, light: GOLD_INK };

const STYLE_OPTIONS = [
  { key: 'all', label: 'All styles' },
  { key: 'latin', label: 'Latin' },
  { key: 'ballroom', label: 'Ballroom' },
];

const EMPTY = {
  solo:   'Log a private lesson to get your next focus points.',
  couple: 'Your shared focus points from couple lessons show up here.',
  group:  'Focus points from your last group lessons show up here.',
};

const GROUP_HEAD = { latin: 'Latin group', ballroom: 'Ballroom group' };

// Where a focus point comes from: "Private · Sat 5 Jul", "Latin group · Today".
function sourceOf(item, kind) {
  const cls = item.class_inputs;
  const when = cls?.created_at || item.created_at;
  let head = 'Private';
  if (kind === 'couple') head = 'Couple';
  if (kind === 'group') head = GROUP_HEAD[categoryFromDances(item.dance)] || 'Group';
  return [head, when ? dayLabel(when) : null].filter(Boolean).join(' · ');
}

function Marker({ label, count, onLayout }) {
  return (
    <View style={s.mk} onLayout={onLayout}>
      <Text style={s.mkT}>{label}</Text>
      <View style={s.mkLine} />
      <Text style={s.mkN}>{count}</Text>
    </View>
  );
}

function FocusCard({ item, kind, past, live, busy, disabled, onPractice }) {
  const tier = TIER[item.tier] || NO_TIER;
  const tone = past ? tier.light : tier.dark;
  // Only the active set knows how many sessions each point asks for; a retired
  // one has no count worth showing.
  const target = !past && Number.isFinite(item._target) && item._target > 0 ? item._target : 0;
  const done = target ? Math.min(item._done || 0, target) : 0;
  const complete = target > 0 && done >= target;
  const label = live ? 'Resume' : past ? 'Again' : 'Practice';
  const ghost = past || complete;
  const ink = past ? INK : ghost ? '#FFFFFF' : INK;

  return (
    <View style={[c.card, { backgroundColor: kind === 'solo' ? INK : NAVY }, past && c.cardPast]}>
      <View style={c.cb}>
        <View style={c.tag}>
          <View style={[c.dot, { backgroundColor: tone }]} />
          <Text style={[c.tagT, { color: tone }]}>{tier.label}</Text>
        </View>
        <Text style={[c.src, past && c.srcPast]} numberOfLines={1}>{sourceOf(item, kind)}</Text>
      </View>

      <Text style={[c.name, past && c.namePast]}>{item.name}</Text>
      {!!item.subtitle && (
        <Text style={[c.cue, past && c.cuePast]} numberOfLines={4}>{item.subtitle}</Text>
      )}

      <View style={[c.foot, !target && c.footEnd]}>
        {target > 0 && (
          <>
            <View style={c.tk}>
              {Array.from({ length: target }).map((_, i) => (
                <View key={i} style={[c.seg, i < done && c.segOn]} />
              ))}
            </View>
            <Text style={c.count}>{done} of {target}</Text>
          </>
        )}
        <TouchableOpacity
          style={[c.go, complete && c.goDone, past && c.goPast, disabled && !busy && c.goIdle]}
          activeOpacity={0.85}
          disabled={disabled}
          onPress={() => onPractice(item)}
          accessibilityRole="button"
          accessibilityLabel={`${label} ${item.name}`}
        >
          {busy
            ? <ActivityIndicator size="small" color={ink} style={c.spin} />
            : <Ionicons name="play" size={11} color={ink} />}
          <Text style={[c.goT, { color: ink }, past && c.goTPast]}>{label}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function FeedSkeleton() {
  return (
    <View style={s.skel}>
      <SkeletonBox width={120} height={10} borderRadius={3} style={s.skelMk} />
      {[0, 1, 2].map((i) => (
        <SkeletonBox key={i} width="100%" height={i === 0 ? 184 : 168} borderRadius={20} style={s.skelCard} />
      ))}
    </View>
  );
}

export default function AllFocusPointsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  // Open on the same Latin/Ballroom style the user is viewing in Train. Train
  // passes its active `category` ('latin' | 'ballroom' | null) as a route param;
  // null (single-style or no filter) maps to 'all'.
  const trainCategory = route?.params?.category;
  const initialFilter =
    trainCategory === 'latin' ? 'latin' : trainCategory === 'ballroom' ? 'ballroom' : 'all';

  const [loading, setLoading] = useState(true);
  const [danceStyle, setDanceStyle] = useState(null);
  const [couple, setCouple] = useState(null);
  // Train's "See all" opens on the side (Solo | Couple) the user was viewing.
  const [tab, setTab] = useState(['couple', 'group'].includes(route?.params?.tab) ? route.params.tab : 'solo'); // 'solo' | 'couple' | 'group'
  const [filter, setFilter] = useState(initialFilter); // 'all' | 'latin' | 'ballroom'
  const [solo, setSolo] = useState([]);
  const [couplePts, setCouplePts] = useState([]);
  const [group, setGroup] = useState([]);
  const [startingId, setStartingId] = useState(null);
  // Retired focus points — still trainable, listed under the active ones on
  // the Solo and Group sides. Fetched apart from the bundle, so with their own
  // loading flag: the warm cache flips `loading` in ms, long before they land.
  const [past, setPast] = useState([]);
  const [pastGroup, setPastGroup] = useState([]);
  const [pastLoading, setPastLoading] = useState(true);
  const [styleMenu, setStyleMenu] = useState(null);
  const styleBtnRef = useRef(null);

  // Train deep-links here with view:'past' when a lesson under review leaves
  // the dancer nothing active: land on the retired ones, once.
  const scrollRef = useRef(null);
  const wantPast = useRef(route?.params?.view === 'past');
  const [pastAt, setPastAt] = useState(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    let freshPainted = false; // fresh network result already on screen → don't let the cache clobber it
    const cat = filter === 'all' ? null : filter;
    const key = CACHE_KEY + (cat || 'all');

    const apply = (b) => {
      setSolo(b.solo || []);
      setCouplePts(b.couple_pts || []);
      setGroup(b.group || []);
      setCouple(b.couple ?? null);        // { coupleId } | null — gates the Couple tab
      setDanceStyle(b.danceStyle ?? null);
    };

    // 1) Instant paint from the per-category cache (no skeleton on a warm cache).
    //    Cache miss → skeleton until the single RPC lands.
    AsyncStorage.getItem(key).then((raw) => {
      if (!active || freshPainted) return;
      if (raw) {
        try { apply(JSON.parse(raw)); setLoading(false); return; } catch {}
      }
      setLoading(true);
    }).catch(() => {});

    // 2) ONE round-trip — get_all_focus_points returns solo + couple_pts + group
    //    (category-scoped) + couple meta + dance_style.
    // Drop the previous category's retired rows so a style switch can't paint
    // stale content while the new query is in flight.
    setPast([]);
    setPastGroup([]);
    setPastLoading(true);

    getAllFocusPointsBundle(cat).then(async (b) => {
      if (!active) return;
      if (b) {
        freshPainted = true;
        apply(b);
        AsyncStorage.setItem(key, JSON.stringify(b)).catch(() => {});
        // The bundle's `solo` array is the last private's readiness CHECKLIST —
        // it INNER JOINs get_lesson_readiness, so it comes back EMPTY whenever
        // readiness collapses (newest lesson awaiting admin approval → its focus
        // points are RLS-hidden). The student still has active focus points;
        // fall back to them so they stay reachable.
        if (!(b.solo || []).length) {
          try {
            const fallback = await getActiveSoloFocusPoints(cat);
            if (active && fallback.length) setSolo(fallback);
          } catch { /* keep the empty list */ }
        }
      }
      setLoading(false);
    }).catch(() => { if (active) setLoading(false); });

    // 3) Retired focus points — separate light queries (the bundle RPC only
    //    returns active ones). Never block the first paint.
    Promise.all([
      getPastFocusPoints(cat).catch(() => []),
      getPastGroupFocusPoints(cat).catch(() => []),
    ]).then(([solo, group]) => {
      if (!active) return;
      setPast(solo || []);
      setPastGroup(group || []);
      setPastLoading(false);
    });

    return () => { active = false; };
  }, [filter]));

  // ── Derived ──
  // Train knows whether the dancer's styles and their couple's add up to both.
  const showDanceFilter = danceStyle === 'Latin & Ballroom' || !!route?.params?.canSwitch;
  const tabs = [{ key: 'solo', label: 'Solo' }];
  if (couple) tabs.push({ key: 'couple', label: 'Couple' });
  tabs.push({ key: 'group', label: 'Group' });
  const activeTab = (tab === 'couple' && !couple) ? 'solo' : tab;
  const list = activeTab === 'solo' ? solo : activeTab === 'couple' ? couplePts : group;
  // Couple focus points have no retired list here: that side shows its active set.
  const pastList = activeTab === 'solo' ? past : activeTab === 'group' ? pastGroup : [];
  const styleLabel = STYLE_OPTIONS.find((o) => o.key === filter)?.label || 'All styles';
  const liveId = getActiveSession()?.focusPointId || null;

  useEffect(() => {
    if (!wantPast.current || loading || pastLoading || activeTab !== 'solo') return;
    if (!pastList.length) { wantPast.current = false; return; }
    if (pastAt == null) return;
    wantPast.current = false;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: Math.max(0, pastAt - 6), animated: true }));
  }, [loading, pastLoading, activeTab, pastAt, pastList.length]);

  function openStyles() {
    styleBtnRef.current?.measureInWindow((x, y, w, h) => setStyleMenu({ x: x + w - MENU_W, y: y + h + 8 }));
  }

  // ── Practice launch ──
  async function handlePractice(item) {
    if (startingId || !item?.id) return;

    // A session is already running — resume it rather than starting a second one.
    const session = getActiveSession();
    if (session) {
      navigation.navigate('FocusSession', {
        focusPointId: session.focusPointId,
        sessionId: session.sessionId,
        rank: session.rank,
        sessionCount: session.sessionCount,
        couple: session.couple,
        coupleId: session.coupleId,
      });
      return;
    }

    setStartingId(item.id);
    try {
      const sessionId = await startTrainingSession(item.id, null);
      if (activeTab === 'couple' && couple) {
        // Couple FP: pass the full row + couple params, exactly like the Train
        // couple card — acquireCoupleLock inside FocusSession is the atomic gate.
        navigation.navigate('FocusSession', {
          focusPointId: item.id,
          focusPointData: item,
          sessionId,
          rank: 0,
          sessionCount: 0,
          couple: true,
          coupleId: couple.coupleId,
        });
      } else {
        const count = await getSessionCountForFocus(item.id);
        navigation.navigate('FocusSession', {
          focusPointId: item.id,
          sessionId,
          rank: 0,
          sessionCount: count,
        });
      }
    } finally {
      setStartingId(null);
    }
  }

  const card = (item, isPast) => (
    <FocusCard
      key={item.id}
      item={item}
      kind={activeTab}
      past={isPast}
      live={item.id === liveId}
      busy={item.id === startingId}
      disabled={!!startingId}
      onPractice={handlePractice}
    />
  );

  return (
    <View style={s.page}>
      <SafeAreaView style={s.page} edges={['top', 'left', 'right']}>
        <View style={s.top}>
          <TouchableOpacity
            style={s.back}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={19} color={INK} />
          </TouchableOpacity>
          <Text style={s.h1} numberOfLines={1}>Focus points</Text>
          {showDanceFilter && (
            <TouchableOpacity
              ref={styleBtnRef}
              style={s.style}
              onPress={openStyles}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${styleLabel}. Change style`}
            >
              <Text style={s.styleT}>{styleLabel}</Text>
              <Ionicons name="chevron-down" size={12} color={INK} />
            </TouchableOpacity>
          )}
        </View>

        <View style={s.tabs}>
          {tabs.map((t) => {
            const on = activeTab === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                style={[s.tab, on && s.tabOn]}
                activeOpacity={0.7}
                onPress={() => setTab(t.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[s.tabT, on && s.tabTOn]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
          {!loading && <Text style={s.count}>{list.length} active</Text>}
        </View>

        {loading ? (
          <FeedSkeleton />
        ) : (
          <MaskedView
            style={s.page}
            maskElement={
              <View style={s.page}>
                <LinearGradient colors={['transparent', '#000']} style={{ height: EDGE_FADE }} />
                <View style={s.maskFill} />
                <LinearGradient colors={['#000', 'rgba(0,0,0,0.5)', 'transparent']} locations={[0, 0.55, 1]} style={{ height: 34 }} />
              </View>
            }
          >
            <ScrollView
              ref={scrollRef}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[s.feed, { paddingBottom: insets.bottom + 30 }]}
            >
              <Marker label="Active now" count={list.length} />
              {list.length
                ? list.map((item) => card(item, false))
                : <Text style={s.none}>{EMPTY[activeTab]}</Text>}

              {pastList.length > 0 && (
                <Marker label="Past" count={pastList.length} onLayout={(e) => setPastAt(e.nativeEvent.layout.y)} />
              )}
              {pastList.map((item) => card(item, true))}
            </ScrollView>
          </MaskedView>
        )}
      </SafeAreaView>

      <StyleMenu
        at={styleMenu}
        options={STYLE_OPTIONS}
        value={filter}
        onSelect={setFilter}
        onClose={() => setStyleMenu(null)}
      />
    </View>
  );
}

// ─── Card (the Train page's focus card, in a list) ────────────────────────────
const c = StyleSheet.create({
  card: { borderRadius: 20, paddingVertical: 16, paddingHorizontal: 17, gap: 11 },
  cardPast: {
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(10,10,10,0.08)',
    paddingVertical: 14, paddingHorizontal: 16, gap: 8,
  },

  cb: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  tagT: { fontFamily: Fonts.semiBold, fontSize: 9.5, letterSpacing: 1.33, textTransform: 'uppercase' },
  src: { flex: 1, minWidth: 0, textAlign: 'right', fontFamily: Fonts.regular, fontSize: 10.5, color: 'rgba(255,255,255,0.62)' },
  srcPast: { color: 'rgba(10,10,10,0.68)' },

  name: { fontFamily: Fonts.bold, fontSize: 24, letterSpacing: -0.91, lineHeight: 25.5, color: '#FFFFFF' },
  namePast: { fontSize: 19, letterSpacing: -0.72, lineHeight: 21, color: INK },
  cue: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18.5, color: 'rgba(255,255,255,0.72)' },
  cuePast: { fontSize: 12.5, lineHeight: 17.75, color: INK_65 },

  foot: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  footEnd: { justifyContent: 'flex-end' },
  tk: { flex: 1, minWidth: 0, flexDirection: 'row', gap: 4 },
  seg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)' },
  segOn: { backgroundColor: GOLD },
  count: { fontFamily: Fonts.regular, fontSize: 11, color: 'rgba(255,255,255,0.75)', fontVariant: ['tabular-nums'] },

  go: {
    height: 36, paddingHorizontal: 17, borderRadius: 999, backgroundColor: GOLD,
    flexDirection: 'row', alignItems: 'center', gap: 7,
  },
  goDone: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  goPast: {
    height: 32, paddingHorizontal: 14, backgroundColor: 'transparent',
    borderWidth: 1, borderColor: 'rgba(10,10,10,0.16)',
  },
  goIdle: { opacity: 0.5 },
  goT: { fontFamily: Fonts.semiBold, fontSize: 13.5, letterSpacing: -0.1 },
  goTPast: { fontSize: 12.5 },
  spin: { width: 11, height: 11, transform: [{ scale: 0.6 }] },
});

// ─── Screen ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: PAGE },

  top: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingTop: 6, paddingHorizontal: SIDE },
  back: {
    width: 36, height: 36, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    shadowColor: INK, shadowOpacity: 0.07, shadowOffset: { width: 0, height: 1 }, shadowRadius: 2, elevation: 1,
  },
  h1: { flex: 1, minWidth: 0, fontFamily: Fonts.bold, fontSize: 26, letterSpacing: -1.04, color: INK },
  style: {
    height: 32, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#FFFFFF',
    flexDirection: 'row', alignItems: 'center', gap: 5,
    shadowColor: INK, shadowOpacity: 0.07, shadowOffset: { width: 0, height: 1 }, shadowRadius: 2, elevation: 1,
  },
  styleT: { fontFamily: Fonts.semiBold, fontSize: 12.5, letterSpacing: -0.1, color: INK },

  tabs: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 22, marginTop: 16, marginHorizontal: SIDE,
    borderBottomWidth: 1, borderBottomColor: LINE,
  },
  tab: { paddingBottom: 9, marginBottom: -1, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: GOLD },
  tabT: { fontFamily: Fonts.semiBold, fontSize: 15, letterSpacing: -0.3, color: INK_65 },
  tabTOn: { color: INK },
  count: { marginLeft: 'auto', paddingBottom: 11, fontFamily: Fonts.regular, fontSize: 11.5, color: INK_65 },

  maskFill: { flex: 1, backgroundColor: '#000' },
  feed: { paddingHorizontal: SIDE, gap: 10 },
  mk: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 20, paddingBottom: 2, paddingHorizontal: 2 },
  mkT: { fontFamily: Fonts.semiBold, fontSize: 9.5, letterSpacing: 1.6, textTransform: 'uppercase', color: INK_62 },
  mkLine: { flex: 1, height: 1, backgroundColor: LINE },
  mkN: { fontFamily: Fonts.bold, fontSize: 12, color: INK, fontVariant: ['tabular-nums'] },
  none: { marginTop: 4, marginHorizontal: 2, fontFamily: Fonts.regular, fontSize: 13.5, lineHeight: 19, color: INK_62 },

  skel: { paddingHorizontal: SIDE, paddingTop: 22 },
  skelMk: { marginBottom: 12, backgroundColor: 'rgba(10,10,10,0.08)' },
  skelCard: { marginBottom: 10, backgroundColor: 'rgba(10,10,10,0.07)' },
});
