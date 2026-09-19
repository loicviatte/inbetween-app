import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ScrollView,
  RefreshControl,
  Platform,
  PanResponder,
  Dimensions,
  Easing,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import TabHeader, { useIsParentAccount, HeaderIconButton } from '../components/TabHeader';
import StyleTitle from '../components/StyleTitle';
import { useTabBarSpace } from '../components/CustomTabBar';
import ModeTabs, { COUPLE_BLUE } from '../components/ModeTabs';
import PullLogo, { usePullRefresh } from '../components/PullLogo';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Fonts } from '../theme';
import {
  getUser,
  getTrainingSessionsThisWeek,
  getSessionsThisWeek,
  getFocusTrainedThisWeek,
  getWeekActivity,
  getTeacherContextForAI,
  getClassInputs,
  invalidateCache,
  subjectVersion,
  getMyCoach,
  getMyCoachForCategory,
} from '../storage/storage';
import {
  getTrainFocus,
  startTrainingSession,
  getClassPendingValidation,
  getSoloFocusCounts,
} from '../utils/algorithm';
import { markFirstScreenReady } from '../utils/firstPaint';
import { getMyCouple, getCoupleReadiness, getCoupleLock } from '../storage/coupleStorage';
import { supabase } from '../services/supabase/client';
import {
  getActiveSession,
  subscribeToActiveSession,
  getSessionTimeLeft,
} from '../storage/activeSession';
import HomeSkeleton from '../components/HomeSkeleton';
import { getAllStudentMetrics } from '../utils/studentMetrics';
import { getStudentDashboard } from '../storage/dashboardStorage';

const HOME_CACHE_KEY = '@cache_home';
// Couple card is fetched non-blocking (separate from the solo HOME_CACHE), so it
// gets its own cache slice — lets the couple focus paint instantly on reopen
// instead of waiting on the cold-start couple fetch.
const COUPLE_CACHE_KEY = '@cache_home_couple';
const CATEGORY_STORAGE_KEY = 'train_category_filter';
// Per-style snapshot of fetchCategoryData (solo+couple slots/readiness/counts),
// persisted so the FIRST Latin↔Ballroom toggle after a cold start paints
// instantly from disk instead of waiting on a round-trip (the in-memory
// categoryCacheRef prefetch is lost across launches). Suffixed by category.
const STYLE_CACHE_KEY = '@cache_train_style:';
function persistStyleData(cat, d) {
  if (d && !d.error && (d.slot1 || d.coupleSlots?.slot1)) {
    AsyncStorage.setItem(STYLE_CACHE_KEY + (cat || 'all'), JSON.stringify(d)).catch(() => {});
  }
}

// ─── Train palette (docs/design/train-screen.html) ────────────────────────────
const PAGE = '#F2F0EB';
const INK = '#0A0A0A';
const INK_2 = 'rgba(10,10,10,0.65)';
const INK_3 = 'rgba(10,10,10,0.34)';
const LINE = 'rgba(10,10,10,0.12)';
const GOLD = '#E8B530';
const GOLD_300 = '#F6D27A';
const GOLD_INK = '#8A6414';
const NAVY = '#22314D';
const SIDE = 20;
const CARD_GAP = 11;
// Pull to refresh on a page that doesn't scroll: how far the page must be
// pulled (after the rubber-band damping) to refresh, and where it rests while
// the refresh runs.
const PULL_TRIGGER = 64;
const PULL_REST = 52;
const pullDamp = (dy) => Math.min(Math.max(0, dy) * 0.5, 120);
// How much of the next focus card shows at the right edge, inviting the swipe.
const CARD_PEEK = 46;

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sc = (s % 60).toString().padStart(2, '0');
  return `${m}:${sc}`;
}

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function currentWeekRange() {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // 0 = Mon
  const mon = new Date(now);
  mon.setDate(now.getDate() - dow);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  if (mon.getMonth() === sun.getMonth()) {
    return `${MONTHS[mon.getMonth()]} ${mon.getDate()}–${sun.getDate()}`;
  }
  return `${MONTHS[mon.getMonth()]} ${mon.getDate()} – ${MONTHS[sun.getMonth()]} ${sun.getDate()}`;
}

const firstName = (name) => (name || '').trim().split(/\s+/)[0] || '';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The weekly session goal, from how often the dancer said they practise solo.
// Accepts both the stored keys ('3_4_per_week') and the onboarding labels
// ('3 to 4 times a week'). Unknown → no goal, the rail just counts.
function weeklySessionGoal(freq) {
  const f = (freq || '').toLowerCase();
  if (!f) return null;
  if (f.includes('daily')) return 6;
  if (/3.{0,4}4/.test(f)) return 4;
  if (/1.{0,4}2/.test(f)) return 2;
  if (f.includes('few') || f.includes('month')) return 1;
  return null;
}

// "Fri 11 Jul · with Marc · 6 corrections"
function lessonMeta(lesson) {
  if (!lesson) return '';
  const d = new Date(lesson.created_at);
  const parts = [`${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`];
  if (lesson.lesson_type === 'group') parts.push('group lesson');
  else {
    const teacher = firstName(lesson.teacher_name || lesson._teacher_fallback);
    if (teacher) parts.push(`with ${teacher}`);
  }
  if (lesson.corrections > 0) parts.push(plural(lesson.corrections, 'correction'));
  return parts.join(' · ');
}

// ─── This week: one segment per day, gold once a session is done ─────────────
// The whole rail opens Trend, where each week breaks down in detail.
function WeekRail({ activity, goal, onPress, accent = GOLD, accentInk = GOLD_INK }) {
  const today = (new Date().getDay() + 6) % 7;
  const done = Object.values(activity || {}).reduce((n, d) => n + (d?.sessions?.length ?? 0), 0);
  const count = goal ? `${done} of ${plural(goal, 'session')}` : plural(done, 'session');
  return (
    <TouchableOpacity
      style={wk.wrap}
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={`This week, ${count}. Open your trend`}
    >
      <View style={wk.top}>
        <Text style={wk.title}>This week</Text>
        <View style={wk.metaRow}>
          <Text style={wk.meta} numberOfLines={1}>{count} · {currentWeekRange()}</Text>
          <Ionicons name="chevron-forward" size={11} color={INK_3} />
        </View>
      </View>
      <View style={wk.days}>
        {DAY_LETTERS.map((letter, i) => {
          const trained = (activity?.[i]?.sessions?.length ?? 0) > 0;
          const isToday = i === today;
          return (
            <View key={i} style={wk.day}>
              <View style={[wk.seg, trained ? { backgroundColor: accent } : isToday && wk.segNow]} />
              <Text style={[wk.letter, isToday && [wk.letterNow, { color: accentInk }]]}>{letter}</Text>
            </View>
          );
        })}
      </View>
    </TouchableOpacity>
  );
}

// ─── Readiness dial: a 270° arc open at the bottom, with a gold head ──────────
const DIAL_ARC = 'M 18.18 81.82 A 45 45 0 1 1 81.82 81.82';
const DIAL_LEN = 212.06;
const DIAL_SIZE = 132;

function ReadyDial({ percent, color = GOLD }) {
  const pc = Math.max(0, Math.min(100, Math.round(percent || 0)));
  const th = ((135 + 2.7 * pc) * Math.PI) / 180;
  return (
    <View style={rd.dial}>
      <Svg width={DIAL_SIZE} height={DIAL_SIZE} viewBox="0 0 100 100">
        <Path d={DIAL_ARC} fill="none" stroke={LINE} strokeWidth={3} strokeLinecap="round" />
        {pc > 0 ? (
          <Path
            d={DIAL_ARC}
            fill="none"
            stroke={color}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={[DIAL_LEN, DIAL_LEN]}
            strokeDashoffset={DIAL_LEN * (1 - pc / 100)}
          />
        ) : null}
        <Circle cx={50 + 45 * Math.cos(th)} cy={50 + 45 * Math.sin(th)} r={4.4} fill={color} />
      </Svg>
      <View style={rd.center} pointerEvents="none">
        <Text style={rd.pct} allowFontScaling={false}>
          {pc}<Text style={rd.pctUnit}>%</Text>
        </Text>
        <Text style={rd.ready} allowFontScaling={false}>Ready</Text>
      </View>
    </View>
  );
}

// ─── A focus point in the carousel ────────────────────────────────────────────
function FocusSlide({ width, couple, tag, index, count, who, focus, done, target, action }) {
  const full = target > 0 && done >= target;
  return (
    <View style={[fc.card, { width, backgroundColor: couple ? NAVY : INK }]}>
      <View style={fc.body}>
        <View style={fc.top}>
          <Text style={fc.tag}>{tag}</Text>
          {count > 1 ? (
            <View style={fc.ix}>
              <Text style={fc.ixTxt}>Focus <Text style={fc.ixNum}>{index + 1}</Text> of {count}</Text>
            </View>
          ) : null}
          {who ? (
            <View style={fc.who}>
              <View style={[fc.av, { borderColor: couple ? NAVY : INK }]}>
                <Text style={fc.avTxt}>{who[0]}</Text>
              </View>
              <LinearGradient
                colors={[GOLD_300, GOLD]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[fc.av, fc.avPartner, { borderColor: couple ? NAVY : INK }]}
              >
                <Text style={[fc.avTxt, { color: INK }]}>{who[1]}</Text>
              </LinearGradient>
            </View>
          ) : null}
        </View>
        <Text style={fc.title} numberOfLines={2}>{focus.name}</Text>
        {focus.subtitle ? <Text style={fc.desc} numberOfLines={2}>{focus.subtitle}</Text> : null}
      </View>

      <View style={fc.foot}>
        {target > 0 ? (
          <View style={fc.steps}>
            <View style={fc.ticks}>
              {Array.from({ length: target }).map((_, i) => (
                <View key={i} style={[fc.tick, i < done && fc.tickOn]} />
              ))}
            </View>
            <Text style={fc.stepsTxt}>{done} of {target} drilled</Text>
          </View>
        ) : null}
        <SlideAction action={action} full={full} />
      </View>
    </View>
  );
}

function SlideAction({ action, full }) {
  if (action.kind === 'progress' || action.kind === 'partner') {
    const partner = action.kind === 'partner';
    return (
      <TouchableOpacity style={fc.live} onPress={action.onPress} activeOpacity={0.8}>
        <View style={fc.liveLeft}>
          {partner
            ? <Ionicons name="lock-closed" size={13} color="rgba(255,255,255,0.85)" />
            : <View style={fc.liveDot} />}
          <Text style={fc.liveTxt} numberOfLines={1}>{action.label}</Text>
        </View>
        <View style={fc.liveLeft}>
          <Text style={[fc.liveTimer, action.over && { color: GOLD }]}>{action.timer}</Text>
          <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.5)" />
        </View>
      </TouchableOpacity>
    );
  }
  const idle = action.kind === 'locked' || action.kind === 'starting';
  const again = full && !idle;
  const label = action.kind === 'locked' ? 'Finish your session first'
    : action.kind === 'starting' ? 'Starting…'
    : again ? 'Drill again' : 'Start now';
  return (
    <TouchableOpacity
      style={[fc.go, again && fc.goAgain, idle && { opacity: 0.5 }]}
      onPress={action.onPress}
      disabled={idle}
      activeOpacity={0.85}
    >
      <Text style={[fc.goTxt, again && { color: '#FFFFFF' }]}>{label}</Text>
      {!idle ? <Ionicons name="arrow-forward" size={16} color={again ? '#FFFFFF' : INK} /> : null}
    </TouchableOpacity>
  );
}

function CarouselDots({ count, active, onDot }) {
  if (count <= 1) return null;
  return (
    <View style={dt.row}>
      {Array.from({ length: count }).map((_, i) => (
        <TouchableOpacity
          key={i}
          onPress={() => onDot(i)}
          hitSlop={{ top: 10, bottom: 10, left: 3, right: 3 }}
          accessibilityLabel={`Focus point ${i + 1}`}
        >
          <View style={[dt.dot, i === active && dt.dotOn]} />
        </TouchableOpacity>
      ))}
      <Text style={dt.label}>{active === count - 1 ? 'Last' : 'Swipe'} · {active + 1} of {count}</Text>
    </View>
  );
}

function LessonSummaryCard({ lesson, onPress }) {
  return (
    <TouchableOpacity style={ls.card} onPress={onPress} activeOpacity={0.8}>
      <View style={ls.icon}>
        <Ionicons name="document-text-outline" size={17} color={GOLD_INK} />
      </View>
      <View style={ls.text}>
        <Text style={ls.title} numberOfLines={1}>Read last lesson summary</Text>
        <Text style={ls.meta} numberOfLines={1}>{lessonMeta(lesson)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={INK_3} />
    </TouchableOpacity>
  );
}

function Bone({ width, height, radius = 8, color = 'rgba(10,10,10,0.07)', style }) {
  return (
    <View style={[{ width, height, borderRadius: radius, backgroundColor: color }, style]} />
  );
}

// Skeleton shown while a not-yet-prefetched style loads after a toggle. Mirrors
// the style-dependent part (dial + focus cards); the week rail above stays put.
function TrainSwitchSkeleton({ cardWidth }) {
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => { try { loop.stop(); } catch {} };
  }, []);
  const onDark = 'rgba(255,255,255,0.12)';
  return (
    <Animated.View style={{ opacity: pulse }}>
      <View style={rd.head}>
        <Bone width={DIAL_SIZE} height={DIAL_SIZE} radius={DIAL_SIZE / 2} />
        <View style={[rd.copy, { gap: 10 }]}>
          <Bone width="90%" height={16} radius={5} />
          <Bone width="60%" height={16} radius={5} />
          <Bone width="75%" height={11} radius={4} />
        </View>
      </View>
      <View style={fp.head}>
        <Bone width={90} height={10} radius={3} />
      </View>
      <View style={{ flexDirection: 'row', paddingHorizontal: SIDE, gap: CARD_GAP }}>
        <View style={[fc.card, { width: cardWidth, height: 292, backgroundColor: INK }]}>
          <Bone width={96} height={10} radius={3} color={onDark} />
          <Bone width="80%" height={26} radius={6} color={onDark} style={{ marginTop: 16 }} />
          <Bone width="100%" height={13} radius={4} color={onDark} style={{ marginTop: 16 }} />
          <Bone width="100%" height={46} radius={23} color={onDark} style={{ marginTop: 'auto' }} />
        </View>
        <View style={[fc.card, { width: cardWidth, height: 292, backgroundColor: INK }]} />
      </View>
    </Animated.View>
  );
}

export default function HomeScreen({ navigation }) {
  // Pre-mount sibling tabs (LOG + PROFILE) shortly after TRAIN settles, so
  // a tap on either feels instant instead of paying parse + first-fetch
  // cost. Idempotent: subsequent calls are no-ops once the screen renders.
  useEffect(() => {
    const t = setTimeout(() => {
      try { navigation.preload?.('LOG'); } catch {}
      try { navigation.preload?.('PROFILE'); } catch {}
      // Warm the (lazy, heavy) FocusSession screen so the first "Start" tap
      // doesn't pay its dev-time module-resolution + first-render cost (~seconds
      // in dev with Metro; free in a release bundle). require() loads the
      // module; preload() also pre-mounts it off-screen so the render is paid.
      try { require('../screens/FocusSessionScreen'); } catch {}
      try { navigation.preload?.('FocusSession'); } catch {}
    }, 600);
    return () => clearTimeout(t);
  }, [navigation]);

  const [user, setUser] = useState(null);
  const [slot1, setSlot1] = useState(null);
  const [slot2, setSlot2] = useState(null);
  const [slot3, setSlot3] = useState(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [slot2Count, setSlot2Count] = useState(0);
  const [starting, setStarting] = useState(false);
  const [activeSession, setActiveSessionState] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const [homeOverTime, setHomeOverTime] = useState(0);
  const [sessionsThisWeek, setSessionsThisWeek] = useState(0);
  const [classesThisWeek, setClassesThisWeek] = useState(0);
  const [focusTrainedThisWeek, setFocusTrainedThisWeek] = useState(0);
  const [weekActivity, setWeekActivity] = useState({});
  const [readiness, setReadiness] = useState(null);
  // Latest class still awaiting admin validation. Its focus points are hidden
  // by RLS until approved, so the Train cards would otherwise fall into the
  // misleading "log your next class" empty state. `soloCounts` says whether we
  // can offer anything to train meanwhile — and which tab to send them to.
  const [pendingValidation, setPendingValidation] = useState(null);
  const [soloCounts, setSoloCounts] = useState({ active: 0, past: 0 });
  const [metrics, setMetrics] = useState({ progression: 0, retention: 100, global: 0 });
  const [showFilter, setShowFilter] = useState(false);
  const isParent = useIsParentAccount();
  // Train doesn't scroll: it keeps clear of the floating tab bar.
  const tabBarSpace = useTabBarSpace();
  const [category, setCategory] = useState(null); // global: 'latin' | 'ballroom' | null

  // The dancer's coach for the style on screen: undefined until read, null when
  // there is none, else the coach ({ pending } while the request waits). With
  // nothing to train, it decides Train's first steps: a studio, then a coach.
  const [coachLink, setCoachLink] = useState(undefined);
  useFocusEffect(useCallback(() => {
    let alive = true;
    (category ? getMyCoachForCategory(category) : getMyCoach())
      .then((c) => { if (alive) setCoachLink(c || null); })
      .catch(() => { if (alive) setCoachLink(undefined); });
    return () => { alive = false; };
  }, [category]));
  const [categorySwitching, setCategorySwitching] = useState(false);
  // ── Couple feature ──
  const [couple, setCouple] = useState(null);
  const [coupleSlots, setCoupleSlots] = useState({ slot1: null, slot2: null, slot3: null });
  const [coupleReadiness, setCoupleReadiness] = useState(null);
  // Solo | Couple tab. Solo comes first and is the default; a running session
  // or a side with nothing to train moves it (effects below).
  const [mode, setMode] = useState('solo');
  const [soloIdx, setSoloIdx] = useState(0);
  const [coupleIdx, setCoupleIdx] = useState(0);
  const [coupleLock, setCoupleLock] = useState(null);
  const [myUserId, setMyUserId] = useState(null);
  const [lockRemaining, setLockRemaining] = useState(0);
  // Trend bundle for "This week", prefetched per style so the tap opens at once.
  const trendRef = useRef({ cat: undefined, data: null });
  // Latest reviewed lesson on each side, for "Read last lesson summary".
  const [lessons, setLessons] = useState({ solo: null, couple: null });
  const [refreshing, setRefreshing] = useState(false);
  // Train fits on the screen on most phones: then the page is fixed (nothing
  // to scroll up to) and only a pull down does something — it refreshes. When
  // the content is taller than the screen (small phones) it scrolls normally,
  // with the system pull to refresh.
  const [viewportH, setViewportH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const overflow = viewportH > 0 && contentH > viewportH + 1;
  const pullY = useRef(new Animated.Value(0)).current;
  const pullLogoRef = useRef(null);
  // When the page does scroll (small phones), the pull is read off the scroll.
  const pageScrollRef = useRef(null);
  const pagePull = usePullRefresh({
    refreshing,
    onRefresh: () => handleRefresh(),
    scrollToTop: () => pageScrollRef.current?.scrollTo({ y: 0, animated: true }),
    logoRef: pullLogoRef,
  });
  const pullRef = useRef({ enabled: false, busy: false, armed: false, refresh: null, logo: pullLogoRef });
  pullRef.current.enabled = !overflow;
  const pullResponder = useRef(PanResponder.create({
    // Capture: a pull that starts on a card or a button is still a pull.
    onMoveShouldSetPanResponderCapture: (_, g) => {
      const p = pullRef.current;
      return p.enabled && !p.busy && g.dy > 10 && g.dy > Math.abs(g.dx) * 1.5;
    },
    onPanResponderMove: (_, g) => {
      const y = pullDamp(g.dy);
      pullY.setValue(y);
      const p = pullRef.current;
      p.logo.current?.setProgress(y / PULL_TRIGGER);  // the mark draws itself as the page comes down
      if (!p.armed && y >= PULL_TRIGGER) {
        p.armed = true;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      } else if (p.armed && y < PULL_TRIGGER) {
        p.armed = false;
      }
    },
    onPanResponderRelease: (_, g) => {
      const p = pullRef.current;
      p.armed = false;
      if (pullDamp(g.dy) < PULL_TRIGGER) {
        Animated.spring(pullY, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 18 })
          .start(() => p.logo.current?.setProgress(0));
        return;
      }
      p.busy = true;
      Animated.spring(pullY, { toValue: PULL_REST, useNativeDriver: true, bounciness: 0, speed: 18 }).start();
      Promise.resolve(p.refresh?.()).finally(() => {
        Animated.timing(pullY, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
          p.busy = false;
          p.logo.current?.setProgress(0);
        });
      });
    },
    onPanResponderTerminate: () => {
      const p = pullRef.current;
      p.armed = false;
      Animated.spring(pullY, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 18 })
        .start(() => p.logo.current?.setProgress(0));
    },
    onPanResponderTerminationRequest: () => false,
  })).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const carouselRef = useRef(null);
  const carouselIdxRef = useRef(0);
  const [isLoading, setIsLoading] = useState(true);
  // True once the first load cycle has resolved the focus slots. Until then, an
  // empty focus area means "still loading" (show skeleton), not "no focus points"
  // (show the empty state) — avoids the misleading "log your next class" flash.
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const hasLoadedRef = useRef(false);
  // Throttle background refreshes: if the user pops back to TRAIN within
  // FRESH_TTL ms of the last successful load, skip the network round-trip.
  const FRESH_TTL = 60000; // 60s
  const lastLoadRef = useRef(0);
  // A parent who switched child: whatever this screen holds is the other child's.
  const subjectRef = useRef(subjectVersion());
  // Per-style data cache so the Latin/Ballroom toggle is instant. Keyed by
  // category ('latin' | 'ballroom'); each entry is a full bundle of the slots,
  // readiness, couple data and session counts for that style. We snapshot the
  // style we leave, prefetch the other style after load, and stale-while-
  // revalidate on every switch. Cleared whenever load() refetches everything.
  const categoryCacheRef = useRef({});
  // Monotonic guard so a slow background revalidate can't clobber the screen
  // after the user has toggled again.
  const switchSeqRef = useRef(0);

  // Fetch the complete per-style data bundle (solo slots + readiness, couple
  // slots + readiness, and the two solo session counts). Used by the toggle,
  // the background prefetch, and the revalidate-after-cache-hit path.
  // One round-trip for a style's solo + couple cards. Shape kept identical to the
  // old multi-query version so applyCategoryData / the toggle path are unchanged.
  // (The 2nd arg is now resolved server-side and ignored — kept for call sites.)
  async function fetchCategoryData(cat) {
    const b = await getTrainFocus(cat);
    if (!b) {
      return {
        slot1: null, slot2: null, slot3: null, readiness: null,
        coupleSlots: { slot1: null, slot2: null, slot3: null }, coupleReadiness: null,
        sessionCount: 0, slot2Count: 0,
        // error → callers keep the current cards rather than blanking them.
        error: true,
      };
    }
    const ss = b.solo?.slots || [];
    const cs = b.couple?.slots || [];
    return {
      slot1: ss[0] || null, slot2: ss[1] || null, slot3: ss[2] || null,
      readiness: b.solo?.readiness ?? null,
      coupleSlots: { slot1: cs[0] || null, slot2: cs[1] || null, slot3: cs[2] || null },
      coupleReadiness: b.couple?.readiness ?? null,
      sessionCount: b.sessionCounts?.slot1 ?? 0,
      slot2Count: b.sessionCounts?.slot2 ?? 0,
      error: false,
    };
  }

  // Push a fetched bundle into the on-screen state.
  function applyCategoryData(d, hasCouple) {
    setSlot1(d.slot1);
    setSlot2(d.slot2);
    setSlot3(d.slot3);
    setReadiness(d.readiness);
    if (hasCouple) {
      setCoupleSlots(d.coupleSlots || { slot1: null, slot2: null, slot3: null });
      setCoupleReadiness(d.coupleReadiness ?? null);
    }
    setSessionCount(d.sessionCount || 0);
    setSlot2Count(d.slot2Count || 0);
  }

  // The newest reviewed lesson on each side. Reuses getClassInputs (cached), the
  // same list ClassDetail opens from, so the summary opens instantly.
  async function loadLessons(coupleId) {
    const list = await getClassInputs();
    const reviewed = (c) => c.status === 'scored' && !c.admin_rejected_at;
    const solo = list.find((c) => reviewed(c) && !c.couple_id) || null;
    const coupleLesson = coupleId ? (list.find((c) => reviewed(c) && c.couple_id === coupleId) || null) : null;
    let coupleCorrections = 0;
    if (coupleLesson) {
      const { count } = await supabase
        .from('couple_focus_points')
        .select('id', { count: 'exact', head: true })
        .eq('class_input_id', coupleLesson.id)
        .eq('is_deleted', false)
        .eq('is_other', false);
      coupleCorrections = count || 0;
    }
    setLessons({
      solo: solo && {
        ...solo,
        corrections: (solo.focus_points || []).filter((fp) => !fp.is_other && !fp.is_deleted).length,
      },
      couple: coupleLesson && { ...coupleLesson, corrections: coupleCorrections },
    });
  }

  async function load(catOverride) {
    // A full refetch invalidates the per-style toggle cache; the prefetch
    // effect repopulates the other style once this lands.
    categoryCacheRef.current = {};
    // The Latin/Ballroom toggle is GLOBAL: one style applies to both the solo
    // and couple cards. It only appears when the union of what the dancer does
    // solo AND what the couple does spans BOTH styles — otherwise there's
    // nothing to toggle. A side is later hidden if its owner doesn't do the
    // selected style (handled in render). Couple is fetched up-front (parallel
    // with the user) because the toggle's default depends on it.
    const [u, coupleV, pendingCls] = await Promise.all([
      getUser(),
      getMyCouple().catch(() => null),
      getClassPendingValidation().catch(() => null),
    ]);
    setPendingValidation(pendingCls);
    const soloLatin = (u?.dance_style || '').includes('Latin');
    const soloBallroom = (u?.dance_style || '').includes('Ballroom');
    const availLatin = soloLatin || !!coupleV?.doesLatin;
    const availBallroom = soloBallroom || !!coupleV?.doesBallroom;
    const both = availLatin && availBallroom;
    let cat = catOverride;
    if (cat === undefined) {
      if (both) {
        const saved = await AsyncStorage.getItem(CATEGORY_STORAGE_KEY).catch(() => null);
        cat = saved === 'ballroom' ? 'ballroom' : 'latin';
      } else {
        cat = null; // single-style across the union → no filter needed
      }
    }
    setShowFilter(both);
    setCategory(cat);
    // Counts are category-scoped, so they can only be fetched once `cat` is
    // resolved. Non-blocking: they only gate the pending-validation CTA.
    getSoloFocusCounts(cat).then(setSoloCounts).catch(() => {});

    // Pre-warm the AI assistant context so the chat in FocusSessionScreen
    // has a warm cache. Deferred 2s so it doesn't compete with the
    // Supabase fetches that produce the first paint.
    setTimeout(() => { getTeacherContextForAI().catch(() => {}); }, 2000);

    // ─── First paint blocks ONLY on the hero focus (the get_train_focus bundle).
    // The week stats, metrics and last lessons aren't needed for it, so they
    // fill in just after (below) instead of adding round-trips to the
    // cold-start critical path.
    setMyUserId(u?.id || null);
    const coupleId = coupleV?.coupleId || null;
    const catData = await fetchCategoryData(cat);
    setUser(u);
    setCouple(coupleV);
    // A transient failure returns { error:true } with null slots — DON'T apply it,
    // or focus points already on screen vanish into the "log your next class"
    // empty state. Keep the current (cached) cards until a clean fetch lands.
    if (!catData.error) {
      applyCategoryData(catData, !!coupleId);
      persistStyleData(cat, catData);
    }
    lastLoadRef.current = Date.now();
    loadLessons(coupleId).catch(() => {});
    setTimeout(() => {
      getStudentDashboard(cat)
        .then((d) => { if (d) trendRef.current = { cat, data: d }; })
        .catch(() => {});
    }, 1500);

    // ─── Couple lock (category-independent) ──
    if (coupleId) {
      getCoupleLock(coupleId).then(setCoupleLock).catch(() => setCoupleLock(null));
      // Cache the couple slice for instant paint on reopen — only when there's
      // a focus to show (don't poison the next launch with an empty couple).
      if (catData.coupleSlots?.slot1) {
        AsyncStorage.setItem(COUPLE_CACHE_KEY, JSON.stringify({
          couple: coupleV, coupleSlots: catData.coupleSlots,
          coupleReadiness: catData.coupleReadiness ?? null, category: cat,
        })).catch(() => {});
      }
    } else {
      setCoupleSlots({ slot1: null, slot2: null, slot3: null });
      setCoupleReadiness(null);
      setCoupleLock(null);
      AsyncStorage.removeItem(COUPLE_CACHE_KEY).catch(() => {}); // unpaired → drop stale couple
    }

    // ─── Week stats + metrics (non-blocking) → fill in after the hero, then
    // persist the full cache snapshot once everything has landed. ──
    Promise.all([
      getTrainingSessionsThisWeek(),
      getSessionsThisWeek(),
      getFocusTrainedThisWeek(),
      getWeekActivity(),
      u?.id ? getAllStudentMetrics(u.id, cat).catch(() => null) : Promise.resolve(null),
    ]).then(([sessions, classes, focusTrained, wa, m]) => {
      setSessionsThisWeek(sessions);
      setClassesThisWeek(classes);
      setFocusTrainedThisWeek(focusTrained);
      setWeekActivity(wa || {});
      const metricsFinal = m || { progression: 0, retention: 100, global: 0 };
      if (m) setMetrics(metricsFinal);
      // Persist the FULL snapshot — only when there's a focus to show (caching an
      // empty/failed load would poison the next launch into the empty state).
      if (catData.slot1) {
        AsyncStorage.setItem(HOME_CACHE_KEY, JSON.stringify({
          ts: Date.now(),
          user: u, slot1: catData.slot1, slot2: catData.slot2, slot3: catData.slot3,
          sessionCount: catData.sessionCount, slot2Count: catData.slot2Count,
          sessionsThisWeek: sessions, classesThisWeek: classes,
          focusTrainedThisWeek: focusTrained, weekActivity: wa || {}, metrics: metricsFinal,
          readiness: catData.readiness ?? null,
          category: cat,
        })).catch(() => {});
      }
    }).catch(() => {});
  }

  // Switching style only changes the focus slots + readiness — NOT the week
  // activity, metrics, etc. The other style is prefetched after load, so the
  // common back-and-forth toggle is instant (cache hit → swap now, refresh
  // quietly). Only an un-prefetched style shows the switch skeleton.
  async function handleSelectCategory(next) {
    if (next === category) return;
    AsyncStorage.setItem(CATEGORY_STORAGE_KEY, next).catch(() => {});
    getSoloFocusCounts(next).then(setSoloCounts).catch(() => {});

    const prev = category;
    const hasCouple = !!(couple?.coupleId);
    // Snapshot the style we're leaving so toggling back is instant.
    if (prev) {
      categoryCacheRef.current[prev] = {
        slot1, slot2, slot3, readiness,
        coupleSlots, coupleReadiness, sessionCount, slot2Count,
      };
    }

    setCategory(next); // optimistic — title + side visibility flip now
    const seq = ++switchSeqRef.current;

    const cached = categoryCacheRef.current[next];
    if (cached) {
      // Instant swap from in-memory cache, then refresh in the background.
      applyCategoryData(cached, hasCouple);
      fetchCategoryData(next).then((d) => {
        if (d.error) return; // keep the cached view rather than blanking it
        categoryCacheRef.current[next] = d;
        persistStyleData(next, d);
        if (switchSeqRef.current === seq) applyCategoryData(d, hasCouple);
      }).catch(() => {});
      return;
    }

    // No in-memory cache → paint instantly from the persisted style cache if we
    // have it (covers the first toggle after a cold start, before the prefetch
    // warms it). Only show the skeleton when there's nothing cached at all.
    let paintedFromDisk = false;
    try {
      const raw = await AsyncStorage.getItem(STYLE_CACHE_KEY + (next || 'all'));
      if (raw && switchSeqRef.current === seq) {
        const d = JSON.parse(raw);
        categoryCacheRef.current[next] = d;
        applyCategoryData(d, hasCouple);
        paintedFromDisk = true;
      }
    } catch {}
    if (!paintedFromDisk && switchSeqRef.current === seq) setCategorySwitching(true);
    try {
      const d = await fetchCategoryData(next);
      if (!d.error) {
        categoryCacheRef.current[next] = d;
        persistStyleData(next, d);
        if (switchSeqRef.current === seq) applyCategoryData(d, hasCouple);
      }
    } catch {}
    if (switchSeqRef.current === seq) setCategorySwitching(false);
  }

  // Prefetch the OTHER style in the background once the screen has loaded, so
  // the first Latin↔Ballroom toggle is instant instead of a ~cold round-trip.
  // Re-runs after each switch to keep the newly-opposite style warm.
  useEffect(() => {
    if (!showFilter || isLoading || !category) return;
    const other = category === 'latin' ? 'ballroom' : 'latin';
    if (categoryCacheRef.current[other]) return;
    let cancelled = false;
    // Defer so the prefetch yields to the initial screen's own secondary
    // waves (session counts, metrics, AI pre-warm) on slow connections.
    const t = setTimeout(() => {
      fetchCategoryData(other)
        .then((d) => { if (!cancelled && !d.error) { categoryCacheRef.current[other] = d; persistStyleData(other, d); } })
        .catch(() => {});
    }, 1200);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFilter, isLoading, category, couple?.coupleId]);

  useFocusEffect(useCallback(() => {
    if (subjectRef.current !== subjectVersion()) {
      subjectRef.current = subjectVersion();
      lastLoadRef.current = 0;
      categoryCacheRef.current = {};
    }
    const isFirst = !hasLoadedRef.current;
    if (isFirst) setIsLoading(true);
    const reveal = () => {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      // First real content is on screen — let App.js drop the cold-start logo.
      markFirstScreenReady();
    };
    async function init() {
      let hadCache = false;
      let cacheTs = 0;
      let revealed = false;
      let cacheMatchesToggle = false;
      if (isFirst) {
        try {
          const [raw, savedCat] = await Promise.all([
            AsyncStorage.getItem(HOME_CACHE_KEY),
            AsyncStorage.getItem(CATEGORY_STORAGE_KEY),
          ]);
          if (raw) {
            const c = JSON.parse(raw);
            hadCache = true;
            cacheTs = c.ts || 0;
            const isBoth = c.user?.dance_style === 'Latin & Ballroom';
            // Single source of truth for the active style = the persisted toggle.
            // NEVER let a stale HOME_CACHE.category override it — that mismatch is
            // what made the Train toggle "revert on its own".
            const wantCat = isBoth ? (savedCat === 'ballroom' ? 'ballroom' : 'latin') : null;
            cacheMatchesToggle = (c.category ?? null) === wantCat;
            setUser(c.user);
            setShowFilter(isBoth);
            setCategory(wantCat);
            // Category-independent stats always paint from cache.
            setSessionCount(c.sessionCount || 0);
            setSlot2Count(c.slot2Count || 0);
            setSessionsThisWeek(c.sessionsThisWeek || 0);
            setClassesThisWeek(c.classesThisWeek || 0);
            setFocusTrainedThisWeek(c.focusTrainedThisWeek || 0);
            setWeekActivity(c.weekActivity || {});
            if (c.metrics) setMetrics(c.metrics);
            // Focus slots/readiness only paint when the cache is for the style the
            // toggle is on; otherwise they're the other style → keep the skeleton
            // until load() fetches the right one (now a single fast RPC).
            if (cacheMatchesToggle) {
              setSlot1(c.slot1);
              setSlot2(c.slot2);
              setSlot3(c.slot3 || null);
              setReadiness(c.readiness || null);
              if (cacheTs) lastLoadRef.current = cacheTs;
              setIsLoading(false); // stale-while-revalidate: show cache instantly
              reveal(); // fade cached content in NOW, even while the refresh runs
              revealed = true;
            }
          }
          // Couple slice — separate cache key, applied even if the solo cache
          // was empty, so the couple focus paints instantly on reopen instead
          // of waiting on the cold-start couple fetch.
          const rawC = await AsyncStorage.getItem(COUPLE_CACHE_KEY);
          if (rawC) {
            const cc = JSON.parse(rawC);
            if (cc.couple) setCouple(cc.couple);
            if (cc.coupleSlots) setCoupleSlots(cc.coupleSlots);
            setCoupleReadiness(cc.coupleReadiness ?? null);
          }
        } catch {}
      }
      // Skip the network refresh entirely if cache is fresh (< FRESH_TTL).
      // Tab switches & quick back-nav feel instant, no spinner flash.
      const fresh = isFirst
        ? hadCache && cacheTs && cacheMatchesToggle && (Date.now() - cacheTs < FRESH_TTL)
        : (Date.now() - lastLoadRef.current < FRESH_TTL);
      if (!fresh) {
        try { await load(); } catch {}
      } else if (isFirst) {
        // A fresh cache skips load(), but the last lessons aren't cached.
        getMyCouple()
          .then((cv) => loadLessons(cv?.coupleId || null))
          .catch(() => {});
      }
      hasLoadedRef.current = true;
      setIsLoading(false);
      setInitialLoadDone(true);
      // No cache → the skeleton was showing; fade the real content in now.
      if (isFirst && !revealed) reveal();
    }
    init();

    // Sync active session state
    const current = getActiveSession();
    setActiveSessionState(current);
    setCountdown(Math.floor(getSessionTimeLeft()));

    const unsub = subscribeToActiveSession((s) => {
      setActiveSessionState(s);
      setCountdown(s ? Math.floor(getSessionTimeLeft()) : 0);
    });

    const tick = setInterval(() => {
      const s = getActiveSession();
      if (s) {
        const tl = Math.floor(getSessionTimeLeft());
        setCountdown(tl);
        if (tl <= 0) {
          const over = Math.floor((Date.now() - s.startedAt) / 1000 - s.duration * 60);
          setHomeOverTime(Math.max(0, over));
        } else {
          setHomeOverTime(0);
        }
      }
    }, 1000);

    return () => {
      unsub();
      clearInterval(tick);
    };
  }, []));

  // Pull to refresh: everything Train shows is refetched — including the
  // lessons list and the Trend bundle, which otherwise ride their caches.
  async function handleRefresh() {
    setRefreshing(true);
    invalidateCache('classInputs');
    trendRef.current = { cat: undefined, data: null };
    try { await load(); } catch {}
    setRefreshing(false);
  }
  pullRef.current.refresh = handleRefresh;

  // The Profile dashboard bundle behind Trend and Readiness, for this style.
  async function dashboardBundle() {
    const cat = category;
    if (trendRef.current.cat === cat && trendRef.current.data) return trendRef.current.data;
    const data = await getStudentDashboard(cat).catch(() => null);
    if (data) trendRef.current = { cat, data };
    return data;
  }

  async function openTrend() {
    const data = await dashboardBundle();
    if (!data) return;
    navigation.navigate('StatsDetail', {
      kind: 'trend',
      data,
      scope: `${styleName}${paired ? ' · Solo' : ''}`,
    });
  }

  // Opens on the side on screen, with the very readiness the dial shows, so the
  // detail can't disagree with it.
  async function openReadiness() {
    const data = await dashboardBundle();
    if (!data) return;
    navigation.navigate('StatsDetail', {
      kind: 'readiness',
      data: { ...data, readiness: sideReadiness },
      scope: `${styleName}${paired ? (isCouple ? ' · Couple' : ' · Solo') : ''}`,
      coupleId: isCouple ? couple?.coupleId : undefined,
    });
  }

  async function handleStartSession(focusPoint, rank, count) {
    if (starting || !focusPoint?.id) return;
    if (getActiveSession()) return;
    setStarting(true);
    const sessionId = await startTrainingSession(slot1?.id, slot2?.id || null);
    setStarting(false);
    navigation.navigate('FocusSession', {
      focusPointId: focusPoint.id,
      sessionId,
      rank,
      sessionCount: count,
    });
  }

  // Couple training. The couple-wide lock + FocusSession couple handling land in
  // M5; for now this navigates with couple params (dormant until couple focus
  // points exist via a couple class).
  async function handleStartCoupleSession(focusPoint) {
    if (starting || !focusPoint?.id || !couple?.coupleId) return;
    if (getActiveSession() || partnerLock) return;
    // Navigate immediately, exactly like the solo path — no pre-nav network so
    // the screen opens instantly instead of stalling on a serialized-pooler
    // round-trip. The partnerLock guard above already blocks the known-busy
    // case, and acquireCoupleLock inside the session is the atomic gate that
    // bounces a genuine race (alert + goBack). We pass the full focus row
    // (getCoupleSlots already select('*')-ed it) so FocusSession skips its own
    // getCoupleFocusPointById fetch and paints from params.
    setStarting(true);
    const sessionId = await startTrainingSession(focusPoint.id, null);
    setStarting(false);
    navigation.navigate('FocusSession', {
      focusPointId: focusPoint.id,
      focusPointData: focusPoint,
      sessionId,
      rank: 0,
      sessionCount: 0,
      couple: true,
      coupleId: couple.coupleId,
    });
  }

  const isSessionActive = !!activeSession;
  // Which side is actually training — the chrono + lock must land on the right
  // card. activeSession carries `couple` (set by FocusSessionScreen on start).
  const coupleSessionActive = isSessionActive && activeSession.couple === true;
  const soloSessionActive = isSessionActive && !activeSession.couple;
  const paired = !!couple;

  // Global Latin/Ballroom filter. A side is shown only if its owner actually
  // does the selected style — so picking Ballroom hides the solo side for a
  // Latin-only dancer whose couple does Ballroom (and vice-versa). When there's
  // no active filter (category null), everything shows as before.
  const soloDoesLatin = (user?.dance_style || '').includes('Latin');
  const soloDoesBallroom = (user?.dance_style || '').includes('Ballroom');
  const soloInStyle = !category || (category === 'latin' ? soloDoesLatin : soloDoesBallroom);
  const coupleInStyle = !category || (category === 'latin' ? !!couple?.doesLatin : !!couple?.doesBallroom);
  // Couple lock — live mirror: when the partner holds the lock, the couple side
  // shows their training EXACTLY like training it yourself (tab forced + "is
  // training" on the card + every Start locked).
  const partnerLock = (coupleLock && myUserId && coupleLock.lockedByUserId !== myUserId) ? coupleLock : null;
  const coupleInProgress = coupleSessionActive || !!partnerLock;
  const anyInProgress = isSessionActive || !!partnerLock;
  const soloHasFocus = !!slot1;
  const coupleHasFocus = !!(coupleSlots && coupleSlots.slot1);
  // The side that's actually training stays visible regardless of the style
  // filter (can't hide a running session behind a filter); the idle side still
  // follows the filter.
  const soloVisible = soloInStyle || soloSessionActive;
  const coupleVisible = paired && (coupleInStyle || coupleInProgress);
  const showTabs = soloVisible && coupleVisible;
  const viewMode = showTabs ? mode : coupleVisible ? 'couple' : 'solo';

  // Solo ↔ Couple slide. The tabs answer the tap at once; everything below
  // them slides out towards the side being left, the other side's content is
  // swapped in (shownMode lags viewMode by the exit) and slides in from the
  // opposite edge. Only a tap slides — a mode set by a session or by the data
  // just swaps.
  const [shownMode, setShownMode] = useState(viewMode);
  const modeSlideX = useRef(new Animated.Value(0)).current;
  const modeSlideO = useRef(new Animated.Value(1)).current;
  const modeTapRef = useRef(false);
  const modeTargetRef = useRef(viewMode);
  modeTargetRef.current = viewMode;
  useEffect(() => {
    if (shownMode === viewMode) { modeTapRef.current = false; return; }
    if (!modeTapRef.current) { setShownMode(viewMode); return; }
    modeTapRef.current = false;
    // Couple sits to the right of Solo: going there pushes the page left.
    const dir = viewMode === 'couple' ? -1 : 1;
    const shift = Dimensions.get('window').width * 0.45;
    modeSlideX.stopAnimation();
    modeSlideO.stopAnimation();
    Animated.parallel([
      Animated.timing(modeSlideX, { toValue: dir * shift, duration: 150, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(modeSlideO, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (!finished) return;
      setShownMode(modeTargetRef.current);
      modeSlideX.setValue(-dir * shift);
      Animated.parallel([
        Animated.timing(modeSlideX, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(modeSlideO, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);
  const modeSlideStyle = { opacity: modeSlideO, transform: [{ translateX: modeSlideX }] };
  function tapMode(next) {
    if (next === viewMode) return;
    modeTapRef.current = true;
    setMode(next);
  }

  // A running session (yours or your partner's) opens its own tab.
  const forcedMode = soloSessionActive ? 'solo' : coupleInProgress ? 'couple' : null;
  useEffect(() => {
    if (forcedMode) setMode(forcedMode);
  }, [forcedMode]);
  // When only one side has focus points in progress, open that side.
  useEffect(() => {
    if (forcedMode) return;
    if (!soloHasFocus && coupleHasFocus) setMode('couple');
    else if (soloHasFocus && !coupleHasFocus) setMode('solo');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soloHasFocus, coupleHasFocus]);

  useEffect(() => {
    const cid = couple?.coupleId;
    if (!cid) return;
    const refetchLock = () => getCoupleLock(cid).then(setCoupleLock).catch(() => {});
    const ch = supabase
      .channel(`home-couple-${cid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'couple_focus_locks', filter: `couple_id=eq.${cid}` },
        (payload) => {
          // DELETE = partner cancelled / finished → clear instantly (skip the
          // re-fetch round-trip). INSERT/UPDATE → re-fetch for the focus name.
          if (payload.eventType === 'DELETE') setCoupleLock(null);
          else refetchLock();
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'couple_practice_logs', filter: `couple_id=eq.${cid}` },
        () => { getCoupleReadiness(cid, category).then(setCoupleReadiness).catch(() => {}); })
      .subscribe();
    // Always-on fallback poll (not just while a lock is shown): on free-tier,
    // realtime can drop the INSERT (partner starts → "X is training" never
    // appears) OR the DELETE (partner cancels/restarts → never clears). A light
    // 4s re-check guarantees BOTH directions reflect within a few seconds.
    const poll = setInterval(refetchLock, 4000);
    return () => { supabase.removeChannel(ch); clearInterval(poll); };
  }, [couple?.coupleId, category]);

  useEffect(() => {
    if (!partnerLock) { setLockRemaining(0); return; }
    const compute = () => {
      const end = new Date(partnerLock.startedAt).getTime() + (partnerLock.durationMinutes || 7) * 60000;
      setLockRemaining(Math.max(0, Math.floor((end - Date.now()) / 1000)));
    };
    compute();
    const id = setInterval(compute, 1000);
    // (Lock refresh is handled by the always-on poll in the subscription effect.)
    return () => { clearInterval(id); };
  }, [partnerLock?.coupleFocusPointId, partnerLock?.startedAt]);
  const activeFocusName = activeSession?.focusPointName ?? null;

  // ─── The side on screen ──────────────────────────────────────────────────
  const isCouple = shownMode === 'couple';
  const items = (isCouple
    ? [coupleSlots.slot1, coupleSlots.slot2, coupleSlots.slot3]
    : [slot1, slot2, slot3]).filter(Boolean);
  // A session started on a focus that isn't among the three cards (e.g. from All
  // focus points) still gets its card, first, so it can be resumed from here.
  const liveId = isCouple
    ? (coupleSessionActive ? activeSession?.focusPointId : partnerLock?.coupleFocusPointId)
    : (soloSessionActive ? activeSession?.focusPointId : null);
  if (liveId && !items.some((f) => f.id === liveId)) {
    items.unshift({
      id: liveId,
      name: (partnerLock && !coupleSessionActive && isCouple) ? partnerLock.focusName : (activeFocusName || 'Focus point'),
      subtitle: null,
    });
  }
  const sideReadiness = isCouple ? coupleReadiness : readiness;
  const focuses = sideReadiness?.focuses ?? [];
  const progressOf = (fp) => {
    const r = focuses.find((f) => f.focusPointId === fp.id);
    const target = r?.target ?? fp.train_target ?? (fp.tier ? (fp.tier === 'critical' ? 3 : 2) : 0);
    return { done: Math.min(r?.done ?? 0, target), target };
  };
  const doneN = focuses.filter((f) => (f.target ?? 0) > 0 && (f.done ?? 0) >= f.target).length;
  const openN = focuses.length - doneN;
  const drillsLeft = focuses.reduce((n, f) => n + Math.max(0, (f.target ?? 0) - (f.done ?? 0)), 0);
  const soloPending = !isCouple && !!pendingValidation;
  // Nothing to train and no coach yet: Train walks a new dancer to one — their
  // studio first (their coach and group lessons come through it), then the coach.
  const setupStep = (!isCouple && focuses.length === 0 && items.length === 0 && !soloPending && coachLink !== undefined)
    ? coachLink?.pending ? 'waiting'
      : coachLink ? null
        : !(user?.studio_id || user?.studio?.id) ? 'studio' : 'coach'
    : null;
  const coachFirst = firstName(coachLink?.name) || 'your coach';
  const SETUP = {
    studio: { lead: 'Add your studio to get started', sub: 'Your coach and your group lessons come through your studio.' },
    coach: { lead: 'Link your coach', sub: 'Their corrections become the focus points you train here.' },
    waiting: { lead: `Waiting for ${coachFirst} to accept`, sub: 'Your focus points arrive once they accept you.' },
  };
  const lead = setupStep ? SETUP[setupStep].lead : focuses.length === 0
    ? (soloPending ? 'Your latest lesson is being reviewed' : 'Nothing to prepare yet')
    : openN === 0
      ? 'You’re set for your next lesson'
      : `${plural(openN, 'focus point')} left before your next lesson`;
  const sub = setupStep ? SETUP[setupStep].sub : focuses.length === 0
    ? (isCouple
      ? 'Your couple private lesson brings shared focus points.'
      : soloPending
        ? 'Your new focus points appear once it’s approved.'
        // No lesson at all yet: a new dancer can start from a lesson they had.
        : !lessons.solo
          ? 'Attend or manually log your last lesson to get focus points.'
          : 'Log your next private lesson to get focus points.')
    : openN === 0
      ? `All ${focuses.length} fully drilled — nothing left to prepare`
      : `${doneN === 0 ? 'None fully drilled yet' : `${doneN} of ${focuses.length} fully drilled`} · ${plural(drillsLeft, 'drill')} to go`;
  // Only offer a way out of the pending state if there is genuinely something on
  // the other side — prefer active; fall back to Past; offer nothing if both are
  // empty.
  const emptyCta = (items.length === 0 && soloPending)
    ? soloCounts.active > 0
      ? { label: 'Train your current focus points', onPress: () => navigation.navigate('AllFocusPoints', { category, canSwitch: showFilter }) }
      : soloCounts.past > 0
        ? { label: 'Revisit your past focus points', onPress: () => navigation.navigate('AllFocusPoints', { category, view: 'past', canSwitch: showFilter }) }
        : null
    : null;
  const seeAllCount = Math.max(focuses.length, items.length);

  const partnerFirst = firstName(couple?.partner?.name) || 'Partner';
  const who = isCouple
    ? [(firstName(user?.name).charAt(0) || '·').toUpperCase(), partnerFirst.charAt(0).toUpperCase()]
    : null;

  function actionFor(fp, idx, full) {
    if (isCouple && partnerLock && fp.id === partnerLock.coupleFocusPointId && !coupleSessionActive) {
      return {
        kind: 'partner',
        label: `${partnerFirst} is training`,
        timer: formatTime(lockRemaining),
        onPress: () => navigation.navigate('FocusSession', {
          focusPointId: partnerLock.coupleFocusPointId,
          focusPointData: items.find((f) => f.id === partnerLock.coupleFocusPointId && f.couple_id) || undefined,
          couple: true,
          coupleId: couple.coupleId,
          partnerView: true,
          partnerStartedAt: new Date(partnerLock.startedAt).getTime(),
          partnerDuration: partnerLock.durationMinutes || 7,
        }),
      };
    }
    const mine = isCouple ? coupleSessionActive : soloSessionActive;
    if (mine && fp.id === activeSession?.focusPointId) {
      return {
        kind: 'progress',
        label: 'In progress',
        timer: countdown > 0 ? formatTime(countdown) : `+ ${formatTime(homeOverTime)}`,
        over: countdown <= 0,
        onPress: () => navigation.navigate('FocusSession', {
          focusPointId: activeSession?.focusPointId,
          sessionId: activeSession?.sessionId,
          rank: activeSession?.rank,
          sessionCount: activeSession?.sessionCount,
          ...(isCouple ? { couple: true, coupleId: activeSession?.coupleId } : {}),
        }),
      };
    }
    if (anyInProgress) return { kind: 'locked' };
    if (starting) return { kind: 'starting' };
    return {
      kind: full ? 'again' : 'start',
      onPress: () => (isCouple ? handleStartCoupleSession(fp) : handleStartSession(fp, idx, sessionCount)),
    };
  }

  const windowWidth = Dimensions.get('window').width;
  const cardWidth = items.length > 1 ? windowWidth - SIDE * 2 - CARD_PEEK : windowWidth - SIDE * 2;
  const interval = cardWidth + CARD_GAP;
  const carouselIdx = Math.min(isCouple ? coupleIdx : soloIdx, Math.max(0, items.length - 1));
  const setCarouselIdx = isCouple ? setCoupleIdx : setSoloIdx;
  const liveIdx = liveId ? items.findIndex((f) => f.id === liveId) : -1;
  const carouselKey = `${shownMode}:${category || 'all'}:${items.map((f) => f.id).join(',')}`;

  // The carousel remounts (back at the first card) whenever its set of cards
  // changes; a running session scrolls its own card into view.
  const prevCarouselKeyRef = useRef(carouselKey);
  useEffect(() => {
    const remounted = prevCarouselKeyRef.current !== carouselKey;
    prevCarouselKeyRef.current = carouselKey;
    if (liveIdx >= 0) {
      setCarouselIdx(liveIdx);
      carouselIdxRef.current = liveIdx;
      requestAnimationFrame(() => carouselRef.current?.scrollTo({ x: liveIdx * interval, animated: false }));
    } else if (remounted) {
      setCarouselIdx(0);
      carouselIdxRef.current = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveIdx, carouselKey]);

  const lesson = isCouple ? lessons.couple : lessons.solo;

  const styleName = category === 'ballroom' ? 'Ballroom'
    : category === 'latin' ? 'Latin'
    : soloDoesLatin && !soloDoesBallroom ? 'Latin'
    : soloDoesBallroom && !soloDoesLatin ? 'Ballroom'
    : couple?.doesLatin ? 'Latin'
    : couple?.doesBallroom ? 'Ballroom'
    : 'Train';

  if (isLoading) {
    return <HomeSkeleton />;
  }

  // Whose training is on screen: the dancer on Solo, the pair on Couple.
  const me = firstName(user?.name);
  const dancers = isCouple ? [me, partnerFirst].filter(Boolean).join(' & ') : me;
  const headerSub = isParent
    ? [dancers, 'parent’s account'].filter(Boolean).join(' · ')
    : (dancers || null);

  return (
    <View style={{ flex: 1, backgroundColor: PAGE }}>
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim, paddingBottom: tabBarSpace }}>

      <TabHeader
        navigation={navigation}
        style={s.header}
        // A parent follows what their child asks the coach, and the answers.
        actions={isParent ? (
          <HeaderIconButton icon="chatbubbles-outline" label="Questions to the coach"
            onPress={() => navigation.navigate('ChildQuestions')} />
        ) : null}
        lead={
          <StyleTitle
            label={styleName}
            category={category}
            canSwitch={showFilter}
            disabled={anyInProgress}
            onSelect={handleSelectCategory}
            sub={headerSub}
          />
        }
      />

      <View style={{ flex: 1 }} {...pullResponder.panHandlers}>
      {/* The InBetween mark: drawn by the pull, then a line runs round it while
          Train reloads. When the page scrolls (small phones) the system pull
          drives it through onScroll instead — iOS only; Android keeps its
          native spinner there. */}
      {!(overflow && Platform.OS === 'android') ? (
        <Animated.View
          style={[s.pullSpinner, overflow ? null : { opacity: pullY.interpolate({ inputRange: [0, 6], outputRange: [0, 1], extrapolate: 'clamp' }) }]}
          pointerEvents="none"
        >
          <PullLogo ref={pullLogoRef} refreshing={refreshing} />
        </Animated.View>
      ) : null}
      <Animated.View style={{ flex: 1, transform: [{ translateY: pullY }] }}>
      <ScrollView
        ref={pageScrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={overflow}
        onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}
        onContentSizeChange={(_, h) => setContentH(h)}
        {...(overflow ? pagePull.scrollProps : {})}
        refreshControl={overflow && !pagePull.ios ? (
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={GOLD_INK} colors={[GOLD]} />
        ) : undefined}
      >
        <WeekRail
          activity={weekActivity}
          goal={weeklySessionGoal(user?.solo_practice_frequency)}
          onPress={openTrend}
          accent={isCouple ? COUPLE_BLUE : GOLD}
          accentInk={isCouple ? COUPLE_BLUE : GOLD_INK}
        />

        {showTabs ? <ModeTabs mode={viewMode} onChange={tapMode} disabled={anyInProgress} style={s.tabs} /> : null}

        {/* Swap the dial + cards for a skeleton while they load — either a
            not-yet-prefetched style toggle, or the very first load before the
            slots resolve. After the first load resolves, an empty side is the
            genuine "no focus points" state, not loading. */}
        {(categorySwitching || (!initialLoadDone && !slot1 && !coupleSlots?.slot1)) ? (
          <TrainSwitchSkeleton cardWidth={windowWidth - SIDE * 2 - CARD_PEEK} />
        ) : (
          <Animated.View style={modeSlideStyle}>
            {/* Dial + copy open the readiness detail — once there is something
                to break down. */}
            <TouchableOpacity
              style={rd.head}
              onPress={openReadiness}
              disabled={focuses.length === 0}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${sideReadiness?.percent ?? 0}% ready. ${lead}. Open readiness`}
            >
              <ReadyDial percent={sideReadiness?.percent ?? 0} color={isCouple ? COUPLE_BLUE : GOLD} />
              <View style={rd.copy}>
                <Text style={rd.lead}>{lead}</Text>
                <Text style={rd.sub}>{sub}</Text>
                {emptyCta ? (
                  <TouchableOpacity onPress={emptyCta.onPress} activeOpacity={0.7} style={rd.cta}>
                    <Text style={rd.ctaTxt}>{emptyCta.label} →</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {focuses.length > 0 ? <Ionicons name="chevron-forward" size={13} color={INK_3} /> : null}
            </TouchableOpacity>

            {items.length > 0 ? (
              <>
                <View style={fp.head}>
                  <Text style={fp.label}>Focus points</Text>
                  <TouchableOpacity
                    onPress={() => navigation.navigate('AllFocusPoints', { category, tab: shownMode, canSwitch: showFilter })}
                    activeOpacity={0.6}
                    hitSlop={{ top: 8, bottom: 8, left: 12 }}
                  >
                    <Text style={fp.link}>See all {seeAllCount} →</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView
                  key={carouselKey}
                  ref={carouselRef}
                  horizontal
                  style={fp.carousel}
                  showsHorizontalScrollIndicator={false}
                  decelerationRate="fast"
                  snapToInterval={interval}
                  snapToAlignment="start"
                  disableIntervalMomentum
                  contentContainerStyle={fp.track}
                  scrollEventThrottle={16}
                  onScroll={(e) => {
                    const k = Math.max(0, Math.min(items.length - 1, Math.round(e.nativeEvent.contentOffset.x / interval)));
                    if (k !== carouselIdxRef.current) {
                      carouselIdxRef.current = k;
                      setCarouselIdx(k);
                    }
                  }}
                >
                  {items.map((f, i) => {
                    const { done, target } = progressOf(f);
                    return (
                      <FocusSlide
                        key={f.id}
                        width={cardWidth}
                        couple={isCouple}
                        tag={isCouple ? 'Couple focus' : 'Solo focus'}
                        index={i}
                        count={items.length}
                        who={who}
                        focus={f}
                        done={done}
                        target={target}
                        action={actionFor(f, i, target > 0 && done >= target)}
                      />
                    );
                  })}
                </ScrollView>

                <CarouselDots
                  count={items.length}
                  active={carouselIdx}
                  onDot={(k) => carouselRef.current?.scrollTo({ x: k * interval, animated: true })}
                />
              </>
            ) : null}

            {setupStep === 'studio' || setupStep === 'coach' ? (
              <View style={rd.setup}>
                <TouchableOpacity
                  style={rd.setupBtn}
                  activeOpacity={0.88}
                  accessibilityRole="button"
                  onPress={() => navigation.navigate('PROFILE', setupStep === 'studio'
                    ? { tab: 'settings', open: 'studio' }
                    : { tab: 'links', open: 'coach', category })}
                >
                  <Ionicons name={setupStep === 'studio' ? 'business-outline' : 'person-add-outline'} size={18} color={INK} />
                  <Text style={rd.setupT}>{setupStep === 'studio' ? 'Add your studio' : 'Add your coach'}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </Animated.View>
        )}

        {lesson ? (
          <Animated.View style={[s.foot, modeSlideStyle]}>
            <LessonSummaryCard
              lesson={lesson}
              onPress={() => navigation.navigate('ClassDetail', { inputId: lesson.id })}
            />
          </Animated.View>
        ) : null}
      </ScrollView>
      </Animated.View>
      </View>

      </Animated.View>
    </SafeAreaView>
    </View>
  );
}

// ─── Main styles ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: { paddingTop: 6, paddingBottom: 0 },
  tabs: { marginTop: 16, marginHorizontal: SIDE },
  pullSpinner: { position: 'absolute', top: (PULL_REST - 27) / 2, left: 0, right: 0, alignItems: 'center' },
  scrollContent: { flexGrow: 1, paddingBottom: 14 },
  // The summary card sits at the foot of the screen when there's room, and
  // simply follows the cards when there isn't.
  foot: { marginTop: 'auto', paddingTop: 18, paddingHorizontal: SIDE },
});

// ─── This week rail ───────────────────────────────────────────────────────────
const wk = StyleSheet.create({
  wrap: { paddingTop: 24, paddingHorizontal: SIDE },
  top: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  title: { fontFamily: Fonts.semiBold, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: INK },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  meta: { fontFamily: Fonts.regular, fontSize: 11.5, color: INK_2, flexShrink: 1 },
  days: { flexDirection: 'row', marginTop: 9, marginHorizontal: -2.5 },
  day: { flex: 1, paddingHorizontal: 2.5 },
  seg: { height: 3, borderRadius: 2, backgroundColor: LINE },
  segNow: { backgroundColor: INK_3 },
  letter: { fontFamily: Fonts.regular, fontSize: 9, letterSpacing: 0.9, color: INK_2, textAlign: 'center', paddingTop: 5 },
  letterNow: { fontFamily: Fonts.bold, color: GOLD_INK },
});

// ─── Readiness head ───────────────────────────────────────────────────────────
const rd = StyleSheet.create({
  // Train's first steps, as Home's Start pill is for a coach.
  setup: { paddingHorizontal: SIDE, paddingTop: 24 },
  setupBtn: { height: 58, borderRadius: 999, backgroundColor: GOLD, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 11 },
  setupT: { fontFamily: Fonts.bold, fontSize: 19, letterSpacing: -0.4, color: INK },
  head: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingTop: 16, paddingHorizontal: SIDE },
  dial: { width: DIAL_SIZE, height: DIAL_SIZE },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  pct: { fontFamily: Fonts.bold, fontSize: 40, letterSpacing: -1.8, color: INK, fontVariant: ['tabular-nums'], lineHeight: 45 },
  pctUnit: { fontFamily: Fonts.medium, fontSize: 17, letterSpacing: 0, color: INK_2 },
  ready: { fontFamily: Fonts.semiBold, fontSize: 9.5, letterSpacing: 1.52, textTransform: 'uppercase', color: INK_2, marginTop: 2 },
  copy: { flex: 1, minWidth: 0, gap: 6 },
  lead: { fontFamily: Fonts.semiBold, fontSize: 15.5, letterSpacing: -0.28, lineHeight: 20, color: INK },
  sub: { fontFamily: Fonts.regular, fontSize: 12.5, lineHeight: 18, color: INK_2 },
  cta: { alignSelf: 'flex-start', paddingVertical: 4 },
  ctaTxt: { fontFamily: Fonts.semiBold, fontSize: 12.5, color: GOLD_INK },
});

// ─── Focus points header + track ──────────────────────────────────────────────
const fp = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, paddingTop: 16, paddingHorizontal: SIDE, paddingBottom: 9 },
  label: { fontFamily: Fonts.semiBold, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: INK_2 },
  link: { fontFamily: Fonts.semiBold, fontSize: 12.5, color: GOLD_INK },
  // A ScrollView grows by default; the cards keep their own height instead of
  // filling the free space of the page.
  carousel: { flexGrow: 0 },
  track: { paddingHorizontal: SIDE, gap: CARD_GAP, alignItems: 'stretch' },
});

// ─── Focus card ───────────────────────────────────────────────────────────────
const fc = StyleSheet.create({
  card: { minHeight: 292, borderRadius: 20, paddingVertical: 16, paddingHorizontal: 18 },
  body: { gap: 10 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 27 },
  tag: { fontFamily: Fonts.semiBold, fontSize: 9.5, letterSpacing: 1.33, textTransform: 'uppercase', color: GOLD },
  ix: { paddingLeft: 9, borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.24)' },
  ixTxt: { fontFamily: Fonts.regular, fontSize: 11, letterSpacing: 0.11, color: 'rgba(255,255,255,0.7)' },
  ixNum: { fontFamily: Fonts.semiBold, color: '#FFFFFF' },
  who: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center' },
  // 23pt disc + a 2pt ring in the card colour, so the pair reads as cut out.
  av: { width: 27, height: 27, borderRadius: 13.5, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  avPartner: { marginLeft: -10 },
  avTxt: { fontFamily: Fonts.semiBold, fontSize: 9.5, color: '#FFFFFF' },
  title: { fontFamily: Fonts.bold, fontSize: 28, letterSpacing: -1.06, lineHeight: 30, color: '#FFFFFF' },
  desc: { fontFamily: Fonts.regular, fontSize: 13.5, lineHeight: 19, color: 'rgba(255,255,255,0.72)' },
  foot: { marginTop: 'auto', paddingTop: 14, gap: 12 },
  steps: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  ticks: { flex: 1, flexDirection: 'row', gap: 4 },
  tick: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)' },
  tickOn: { backgroundColor: GOLD },
  stepsTxt: { fontFamily: Fonts.regular, fontSize: 11.5, color: 'rgba(255,255,255,0.75)', fontVariant: ['tabular-nums'] },
  go: { height: 46, borderRadius: 999, backgroundColor: GOLD, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  goAgain: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  goTxt: { fontFamily: Fonts.semiBold, fontSize: 15, letterSpacing: -0.15, color: INK },
  live: { height: 46, borderRadius: 999, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  liveLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: GOLD },
  liveTxt: { fontFamily: Fonts.semiBold, fontSize: 14.5, color: '#FFFFFF', flexShrink: 1 },
  liveTimer: { fontFamily: Fonts.semiBold, fontSize: 14, color: 'rgba(255,255,255,0.7)', fontVariant: ['tabular-nums'] },
});

// ─── Carousel dots ────────────────────────────────────────────────────────────
const dt = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 12 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: 'rgba(10,10,10,0.2)' },
  dotOn: { width: 20, backgroundColor: GOLD },
  label: { fontFamily: Fonts.regular, fontSize: 10.5, letterSpacing: 0.63, color: INK_2, marginLeft: 7 },
});

// ─── Last lesson summary ──────────────────────────────────────────────────────
const ls = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 13, paddingHorizontal: 15, borderRadius: 15, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(10,10,10,0.09)' },
  icon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#FCEFC9', alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: Fonts.semiBold, fontSize: 15, letterSpacing: -0.22, color: INK },
  meta: { fontFamily: Fonts.regular, fontSize: 11.5, color: INK_2 },
});
