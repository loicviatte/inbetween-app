import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  Pressable,
  LayoutAnimation,
  Platform,
  UIManager,
  PanResponder,
} from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle } from 'react-native-svg';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import TabHeader from '../components/TabHeader';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../theme';
import {
  getUser,
  getTrainingSessionsThisWeek,
  getSessionsThisWeek,
  getFocusTrainedThisWeek,
  getWeekActivity,
  getRecentClassInputs,
  getTopFocusPointsWithCounts,
  getTeacherContextForAI,
} from '../storage/storage';
import { getSlots, getCoupleSlots, getSessionCountForFocus, startTrainingSession } from '../utils/algorithm';
import { getMyCouple, getCoupleReadiness, mostTrainedMode, getCoupleLock } from '../storage/coupleStorage';
import { supabase } from '../services/supabase/client';
import {
  getActiveSession,
  clearActiveSession,
  subscribeToActiveSession,
  getSessionTimeLeft,
} from '../storage/activeSession';
import { generateCoachShareSummary } from '../services/ai/anthropic';
import LogModal from '../components/LogModal';
import HomeSkeleton from '../components/HomeSkeleton';
import MetricGauge from '../components/MetricGauge';
import BottomSheet from '../components/BottomSheet';
import { getAllStudentMetrics } from '../utils/studentMetrics';

// Enable LayoutAnimation on Android (no-op on iOS where it's always on).
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Accordion swap animation — easeInEaseOut on the layout (position/size) while
// the inner content cross-fades (opacity on create/delete).
function animateAccordionSwap() {
  LayoutAnimation.configureNext({
    duration: 300,
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}

const SHARE_LOADING_MSGS = ['Gathering your notes...', 'Writing summary...', 'Almost ready...'];
const HOME_CACHE_KEY = '@cache_home';
const CATEGORY_STORAGE_KEY = 'train_category_filter';

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sc = (s % 60).toString().padStart(2, '0');
  return `${m}:${sc}`;
}

function ordinal(n) {
  if (!n) return '1st';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const FEELING_EMOJI = { Hard: '😤', Struggled: '😰', Okay: '😐', Good: '🙂', Great: '🔥' };

function fmtTime(iso) {
  const d = new Date(iso);
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function currentWeekRange() {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // 0 = Mon
  const mon = new Date(now);
  mon.setDate(now.getDate() - dow);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (mon.getMonth() === sun.getMonth()) {
    return `${months[mon.getMonth()]} ${mon.getDate()} – ${sun.getDate()}`;
  }
  return `${months[mon.getMonth()]} ${mon.getDate()} – ${months[sun.getMonth()]} ${sun.getDate()}`;
}

function CategoryToggle({ category, onPress }) {
  const label = category === 'latin' ? 'Latin' : 'Ballroom';
  return (
    <TouchableOpacity
      style={s.toggle}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <Text style={s.toggleLabel}>{label}</Text>
      <Ionicons name="chevron-down" size={16} color={Colors.black} />
    </TouchableOpacity>
  );
}

function SwitchBone({ width, height, radius = 8, color = 'rgba(17,12,17,0.06)', style }) {
  return (
    <View style={[{ width, height, borderRadius: radius, backgroundColor: color }, style]} />
  );
}

// Skeleton shown while a not-yet-prefetched style loads after a toggle.
// Mirrors the focus-card region + the "Get ready" dock (the only parts that
// change with the style); the This-week card above stays put.
function TrainSwitchSkeleton({ paired }) {
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
  const onDark = 'rgba(255,255,255,0.14)';
  return (
    <Animated.View style={{ opacity: pulse }}>
      <View style={[s.scroll, s.scrollContent]}>
        {/* Primary (expanded) focus card */}
        <View style={tk.bigCard}>
          <SwitchBone width={92} height={22} radius={999} color={onDark} />
          <SwitchBone width="80%" height={28} radius={7} color={onDark} style={{ marginTop: 16 }} />
          <SwitchBone width="55%" height={28} radius={7} color={onDark} style={{ marginTop: 8 }} />
          <SwitchBone width="100%" height={50} radius={13} color={onDark} style={{ marginTop: 24 }} />
        </View>
        {/* Secondary (collapsed) card — only when paired */}
        {paired ? (
          <View style={tk.smallCard}>
            <SwitchBone width={26} height={26} radius={13} color={onDark} />
            <View style={{ flex: 1, marginLeft: 11 }}>
              <SwitchBone width={70} height={9} radius={3} color={onDark} />
              <SwitchBone width="58%" height={16} radius={5} color={onDark} style={{ marginTop: 7 }} />
            </View>
          </View>
        ) : null}
      </View>
      {/* Get ready · next private */}
      <View style={s.bottomDock}>
        <View style={tk.readyCard}>
          <View style={tk.readyTop}>
            <SwitchBone width={120} height={9} radius={3} />
            <SwitchBone width={48} height={9} radius={3} />
          </View>
          {[0, 1, 2].map((i) => (
            <View key={i} style={tk.readyRow}>
              <SwitchBone width={26} height={26} radius={13} />
              <SwitchBone width={`${58 - i * 8}%`} height={13} radius={4} style={{ marginLeft: 12 }} />
            </View>
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

function CategoryPicker({ visible, current, onSelect, onClose }) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={s.pickerBackdrop} onPress={onClose}>
        <SafeAreaView edges={['top']} style={s.pickerAnchor} pointerEvents="box-none">
          <Pressable style={s.pickerSheet} onPress={(e) => e.stopPropagation()}>
            {[
              { key: 'latin', label: 'Latin' },
              { key: 'ballroom', label: 'Ballroom' },
            ].map((opt, i) => {
              const on = opt.key === current;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[s.pickerRow, i > 0 && s.pickerRowDivider]}
                  activeOpacity={0.65}
                  onPress={() => onSelect(opt.key)}
                >
                  <Text style={s.pickerLabel}>{opt.label}</Text>
                  {on && (
                    <Ionicons name="checkmark" size={18} color="#FFFFFF" style={s.pickerCheck} />
                  )}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </SafeAreaView>
      </Pressable>
    </Modal>
  );
}

// ─── Condensed "next class readiness" strip ──────────────────────────────────
// Mini version of the Profile readiness card — one glanceable line so the
// student sees their progress without leaving the Train tab. Taps through to
// the full breakdown on Profile.
function NextClassReadinessCard({ readiness, onPress }) {
  const hasData = !!readiness;
  const percent = hasData ? Math.max(0, Math.min(100, readiness.percent || 0)) : 0;
  const focusCount = hasData ? (readiness.focuses?.length || 0) : 0;
  const minutesRemaining = hasData ? readiness.minutesRemaining ?? 0 : 0;
  const focusLabel = focusCount === 1 ? 'focus point' : 'focus points';
  return (
    <TouchableOpacity
      style={s.readyCard}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={s.readyHeaderRow}>
        <Text style={s.readyLabel} numberOfLines={1}>Get ready for next private lesson</Text>
        <Ionicons name="chevron-forward" size={16} color="rgba(13,13,18,0.35)" />
      </View>
      {hasData ? (
        <View style={s.readyBodyRow}>
          <Text style={s.readyPct} allowFontScaling={false}>
            {percent}<Text style={s.readyPctSm}>%</Text>
          </Text>
          <View style={s.readyRightCol}>
            <View style={s.readyTrack}>
              <View style={[s.readyFill, { width: `${percent}%` }]} />
            </View>
            <Text style={s.readyMetaLine} numberOfLines={1}>
              {percent >= 100
                ? `All ${focusCount} ${focusLabel} trained`
                : `${focusCount} ${focusLabel} · ~${minutesRemaining} min to go`}
            </Text>
          </View>
        </View>
      ) : (
        <Text style={s.readyEmpty}>Log your last private to start tracking.</Text>
      )}
    </TouchableOpacity>
  );
}

function WeekHeatmap({ activity, onDayPress }) {
  const todayIdx = (new Date().getDay() + 6) % 7;
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return (
    <View style={h.row}>
      {labels.map((label, i) => {
        const day = activity[i];
        const hasSessions = (day?.sessions?.length ?? 0) > 0;
        const hasClasses = (day?.classes?.length ?? 0) > 0;
        const hasActivity = hasSessions || hasClasses;
        const isToday = i === todayIdx;
        return (
          <TouchableOpacity
            key={i}
            style={[h.cell, isToday && h.cellToday]}
            onPress={() => hasActivity && onDayPress(i)}
            activeOpacity={hasActivity ? 0.7 : 1}
          >
            <Text style={[h.label, isToday && h.labelToday]}>{label}</Text>
            <View style={h.dots}>
              {hasSessions && <View style={[h.dot, h.dotSession]} />}
              {hasClasses && <View style={[h.dot, h.dotClass]} />}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Couple feature theme ─────────────────────────────────────────────────────
const CBLUE = '#2E4670';
const CBLUE_DARK = '#16243C';
const CBLUE_DOT = '#8FB0DD';

// Small avatar — photo if available, else an initial chip.
function MiniAvatar({ uri, initial, variant }) {
  if (uri) return <Image source={{ uri }} style={cc.miniAv} contentFit="cover" />;
  return (
    <View style={[cc.miniAv, cc.miniAvFallback, variant === 'couple' && cc.miniAvCouple]}>
      <Text style={cc.miniAvTxt}>{(initial || '·').toUpperCase()}</Text>
    </View>
  );
}

// Pair stack: my avatar + partner chip, overlapping (couple cards).
function PairAvatars({ uri, partnerInitial }) {
  return (
    <View style={cc.pairStack}>
      <MiniAvatar uri={uri} initial="" />
      <View style={[cc.miniAv, cc.miniAvCouple, cc.pairSecond]}>
        <Text style={cc.miniAvTxt}>{(partnerInitial || 'P').toUpperCase()}</Text>
      </View>
    </View>
  );
}

// Tappable swipe dots; active dot is elongated. theme: 'solo' | 'couple'.
function SwipeDots({ count, active, onDot, theme }) {
  if (!count || count <= 1) return null;
  return (
    <View style={cc.dotsRow}>
      {Array.from({ length: count }).map((_, i) => (
        <TouchableOpacity key={i} onPress={() => onDot(i)} activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}>
          <View style={[cc.dot, i === active && cc.dotOn,
            i === active && (theme === 'couple' ? cc.dotOnCouple : cc.dotOnSolo)]} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

// Concentric readiness ring — outer blue = couple, inner gold = solo.
// couplePct null → single (solo-only) ring for unpaired users.
function ConcentricReadiness({ soloPct = 0, couplePct = null, size = 58 }) {
  const u = size / 68;
  const ro = 30 * u, ri = 20 * u, sw = 6 * u, ctr = size / 2;
  const co = 2 * Math.PI * ro, ci = 2 * Math.PI * ri;
  const clamp = (p) => Math.max(0, Math.min(100, p || 0));
  const sp = clamp(soloPct), cp = clamp(couplePct);
  const paired = couplePct != null;
  return (
    <Svg width={size} height={size}>
      {paired ? (
        <Circle cx={ctr} cy={ctr} r={ro} fill="none" stroke="rgba(10,10,10,0.08)" strokeWidth={sw} />
      ) : null}
      {paired ? (
        <Circle cx={ctr} cy={ctr} r={ro} fill="none" stroke={CBLUE} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={co} strokeDashoffset={co * (1 - cp / 100)} transform={`rotate(-90 ${ctr} ${ctr})`} />
      ) : null}
      <Circle cx={ctr} cy={ctr} r={ri} fill="none" stroke="rgba(10,10,10,0.07)" strokeWidth={sw} />
      <Circle cx={ctr} cy={ctr} r={ri} fill="none" stroke={Colors.orange} strokeWidth={sw} strokeLinecap="round"
        strokeDasharray={ci} strokeDashoffset={ci * (1 - sp / 100)} transform={`rotate(-90 ${ctr} ${ctr})`} />
    </Svg>
  );
}

// A 1-2 word focus title reads best stacked: when it's exactly two words, break
// the second onto its own line (fills the reserved 2-line title box cleanly).
function twoWordTitle(name) {
  const n = (name || '').trim();
  const parts = n.split(/\s+/);
  return parts.length === 2 ? parts.join('\n') : n;
}

// Small progress ring — fills to done/target. Track-only (no arc) when done is 0.
function ProgRing({ done = 0, target = 0, color = '#E8B530', size = 17, sw = 2.6 }) {
  const r = (size - sw) / 2, ctr = size / 2, circ = 2 * Math.PI * r;
  const pct = target > 0 ? Math.max(0, Math.min(1, done / target)) : 0;
  const has = done > 0;
  return (
    <Svg width={size} height={size}>
      <Circle cx={ctr} cy={ctr} r={r} fill="none" stroke={has ? 'rgba(10,10,10,0.13)' : 'rgba(10,10,10,0.18)'} strokeWidth={sw} />
      {has ? (
        <Circle cx={ctr} cy={ctr} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)} transform={`rotate(-90 ${ctr} ${ctr})`} />
      ) : null}
    </Svg>
  );
}

// Train focus card — solo (gold/black) or couple (blue); primary (expanded) or
// secondary (collapsed). Carousel via tappable dots. See docs/design.
function FocusCard({
  theme, expanded, focus, count, idx, onDot, pill, sub, progress, headerAvatar,
  onStart, starting, onExpand, sessionActive, onResume, timerNode, emptyText, lockedLabel,
}) {
  const isCouple = theme === 'couple';
  const empty = !focus;

  // Horizontal swipe to move between focus points (same as tapping the dots).
  // Latest idx/count/onDot live in a ref so the once-created PanResponder reads
  // current values; only claim clearly-horizontal drags so taps on the Start
  // button + dots still pass through.
  const swipeRef = useRef({ idx, count, onDot });
  swipeRef.current = { idx, count, onDot };
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderRelease: (_, g) => {
        const s = swipeRef.current;
        if (!s.count || s.count <= 1) return;
        if (g.dx <= -40) s.onDot(Math.min(s.idx + 1, s.count - 1));
        else if (g.dx >= 40) s.onDot(Math.max(s.idx - 1, 0));
      },
    })
  ).current;

  // Visible swipe feedback: replay a quick fade + horizontal slide on the info
  // block whenever the focus index changes (swipe or dot tap).
  const infoT = useRef(new Animated.Value(1)).current;
  const prevIdxRef = useRef(idx);
  useEffect(() => {
    if (prevIdxRef.current === idx) return;
    prevIdxRef.current = idx;
    infoT.setValue(0);
    Animated.timing(infoT, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [idx]);

  // The root <View> keeps the SAME element type whether expanded or collapsed,
  // so its native identity survives the accordion swap and LayoutAnimation can
  // morph its height + position smoothly. Padding lives on the inner wrappers
  // (colPad / expPad) so the whole collapsed card stays tappable, and the
  // expanded ↔ collapsed content cross-fades via the create/delete opacity.
  return (
    <View style={[
      cc.card,
      { backgroundColor: isCouple ? CBLUE : '#1C1C1E' },
      expanded
        ? (isCouple ? cc.cardCoupleExp : cc.cardSoloExp)
        : (isCouple ? cc.cardCouple : cc.cardSolo),
    ]}>
      {isCouple ? (
        <LinearGradient colors={[CBLUE, CBLUE_DARK]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFillObject, { borderRadius: 22 }]} pointerEvents="none" />
      ) : (
        // Solo: solid #1C1C1E base + a soft gold glow bottom-right — matches the
        // production "today's focus" hero card exactly.
        <LinearGradient colors={['transparent', 'transparent', 'rgba(242,185,64,0.18)']} locations={[0, 0.3, 1]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFillObject, { borderRadius: 22 }]} pointerEvents="none" />
      )}

      {!expanded ? (
        <TouchableOpacity activeOpacity={0.85} onPress={onExpand} style={cc.colPad}>
          <View style={cc.collapsedRow}>
            {headerAvatar}
            <View style={cc.collapsedMid}>
              <Text style={[cc.labelBare, isCouple ? cc.labelCouple : cc.labelSolo]} numberOfLines={1}>{pill}</Text>
              <Text style={cc.collapsedTitle} numberOfLines={1}>{empty ? (emptyText || '—') : focus.name}</Text>
            </View>
            <View style={cc.expandBtn}>
              <Ionicons name="chevron-expand" size={18} color="#fff" />
            </View>
          </View>
        </TouchableOpacity>
      ) : (
        <View style={cc.expPad} {...pan.panHandlers}>
          <View style={cc.expTopRow}>
            <View style={cc.expTopLeft}>
              <View style={[cc.pill, isCouple ? cc.pillCouple : cc.pillSolo]}>
                {!isCouple ? <View style={cc.pillDot} /> : null}
                <Text style={cc.pillTxt}>{pill}</Text>
              </View>
              {progress ? <Text style={cc.progressTxt}>{progress}<Text style={cc.progressUnit}> trained</Text></Text> : null}
            </View>
            {headerAvatar}
          </View>
          {empty ? (
            <Text style={cc.emptyTxt}>{emptyText}</Text>
          ) : (
            <View>
              <Animated.View style={{ opacity: infoT, transform: [{ translateX: infoT.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
                <Text style={cc.expTitle} numberOfLines={2}>{twoWordTitle(focus.name)}</Text>
                <View style={cc.expBodyBox}>
                  {!!focus.subtitle && <Text style={cc.expDesc} numberOfLines={2}>{focus.subtitle}</Text>}
                </View>
              </Animated.View>
              <View style={cc.expNavRow}>
                <SwipeDots count={count} active={idx} onDot={onDot} theme={theme} />
                {count > 1 && idx < count - 1 ? <Text style={cc.swipeHint}>SWIPE ›</Text> : null}
              </View>
              {lockedLabel ? (
                <View style={cc.lockBanner}>
                  <Ionicons name="lock-closed" size={14} color="rgba(255,255,255,0.85)" />
                  <Text style={cc.lockTxt}>{lockedLabel}</Text>
                </View>
              ) : sessionActive ? (
                <TouchableOpacity style={cc.inProgBtn} onPress={onResume} activeOpacity={0.8}>
                  <View style={cc.inProgLeft}><View style={cc.inProgDot} /><Text style={cc.inProgTxt}>In Progress</Text></View>
                  {timerNode}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[cc.startBtnSolo, starting && { opacity: 0.6 }]}
                  onPress={onStart} disabled={starting} activeOpacity={0.88}>
                  <Text style={cc.startTxt}>{starting ? 'Starting…' : 'Start Now'}</Text>
                  {!starting ? <Text style={cc.startArrow}>→</Text> : null}
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}
    </View>
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
    }, 600);
    return () => clearTimeout(t);
  }, [navigation]);

  const [user, setUser] = useState(null);
  const [slot1, setSlot1] = useState(null);
  const [slot2, setSlot2] = useState(null);
  const [slot3, setSlot3] = useState(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [slot2Count, setSlot2Count] = useState(0);
  const [comingUpModal, setComingUpModal] = useState(false);
  const [starting, setStarting] = useState(false);
  const [activeSession, setActiveSessionState] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const [homeOverTime, setHomeOverTime] = useState(0);
  const [sessionsThisWeek, setSessionsThisWeek] = useState(0);
  const [classesThisWeek, setClassesThisWeek] = useState(0);
  const [focusTrainedThisWeek, setFocusTrainedThisWeek] = useState(0);
  const [weekActivity, setWeekActivity] = useState({});
  const [readiness, setReadiness] = useState(null);
  const [metrics, setMetrics] = useState({ progression: 0, retention: 100, global: 0 });
  const [showFilter, setShowFilter] = useState(false);
  const [category, setCategory] = useState(null); // global: 'latin' | 'ballroom' | null
  const [categorySwitching, setCategorySwitching] = useState(false);
  // ── Couple feature ──
  const [couple, setCouple] = useState(null);
  const [coupleSlots, setCoupleSlots] = useState({ slot1: null, slot2: null, slot3: null });
  const [coupleReadiness, setCoupleReadiness] = useState(null);
  const [primaryMode, setPrimaryMode] = useState('solo'); // which Train card is large
  // Readiness card shows a LAGGED primary (rdlPrimary) so a swap can SLIDE the
  // old content out one side + fade, then slide the new in from the other side —
  // independent of the top cards, which swap immediately. Only user swaps slide
  // (load syncs silently). couple enters from the right, solo from the left.
  const [rdlPrimary, setRdlPrimary] = useState('solo');
  const rdlSlide = useRef(new Animated.Value(0)).current; // px horizontal offset; 0 = settled
  const slideDirRef = useRef(-1);
  const userSwapRef = useRef(false);
  const swapPrimary = (target) => {
    userSwapRef.current = true;
    slideDirRef.current = target === 'couple' ? -1 : 1;
    animateAccordionSwap();
    setPrimaryMode(target);
  };
  useEffect(() => {
    if (rdlPrimary === primaryMode) return;
    if (!userSwapRef.current) { setRdlPrimary(primaryMode); return; }
    userSwapRef.current = false;
    const out = slideDirRef.current * 90;
    Animated.timing(rdlSlide, { toValue: out, duration: 150, useNativeDriver: true }).start(() => {
      setRdlPrimary(primaryMode);
      rdlSlide.setValue(-out);
      Animated.timing(rdlSlide, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    });
  }, [primaryMode, rdlPrimary, rdlSlide]);
  const [soloIdx, setSoloIdx] = useState(0);
  const [coupleIdx, setCoupleIdx] = useState(0);
  const [coupleLock, setCoupleLock] = useState(null);
  const [myUserId, setMyUserId] = useState(null);
  const [lockRemaining, setLockRemaining] = useState(0);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [dayModal, setDayModal] = useState(null);
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [photoUri, setPhotoUri] = useState(null);
  const [shareState, setShareState] = useState('default');
  const [shareLoadingMsg, setShareLoadingMsg] = useState(SHARE_LOADING_MSGS[0]);
  const shareMsgRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [isLoading, setIsLoading] = useState(true);
  const hasLoadedRef = useRef(false);
  // Throttle background refreshes: if the user pops back to TRAIN within
  // FRESH_TTL ms of the last successful load, skip the network round-trip.
  const FRESH_TTL = 60000; // 60s
  const lastLoadRef = useRef(0);
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
  async function fetchCategoryData(cat, coupleIdArg) {
    const cid = coupleIdArg !== undefined ? coupleIdArg : (couple?.coupleId || null);
    const [slots, coupleData] = await Promise.all([
      getSlots(cat, true),
      cid ? getCoupleSlots(cid, cat).catch(() => null) : Promise.resolve(null),
    ]);
    const [c1, c2] = await Promise.all([
      slots.slot1?.id ? getSessionCountForFocus(slots.slot1.id) : Promise.resolve(0),
      slots.slot2?.id ? getSessionCountForFocus(slots.slot2.id) : Promise.resolve(0),
    ]);
    return {
      slot1: slots.slot1, slot2: slots.slot2, slot3: slots.slot3,
      readiness: slots.readiness ?? null,
      coupleSlots: coupleData
        ? { slot1: coupleData.slot1, slot2: coupleData.slot2, slot3: coupleData.slot3 }
        : { slot1: null, slot2: null, slot3: null },
      coupleReadiness: coupleData?.readiness ?? null,
      sessionCount: c1, slot2Count: c2,
    };
  }

  // Push a fetched bundle into the on-screen state.
  function applyCategoryData(d, hasCouple) {
    setSlot1(d.slot1);
    setSlot2(d.slot2);
    setSlot3(d.slot3);
    setReadiness(d.readiness);
    setSoloIdx(0);
    setCoupleIdx(0);
    if (hasCouple) {
      setCoupleSlots(d.coupleSlots || { slot1: null, slot2: null, slot3: null });
      setCoupleReadiness(d.coupleReadiness ?? null);
    }
    setSessionCount(d.sessionCount || 0);
    setSlot2Count(d.slot2Count || 0);
  }

  async function load(catOverride) {
    // A full refetch invalidates the per-style toggle cache; the prefetch
    // effect repopulates the other style once this lands.
    categoryCacheRef.current = {};
    // The Latin/Ballroom toggle is GLOBAL: one style applies to both the solo
    // and couple cards. It only appears when the union of what the dancer does
    // solo AND what the couple does spans BOTH styles — otherwise there's
    // nothing to toggle. A card is later hidden if its owner doesn't do the
    // selected style (handled in render). Couple is fetched up-front (parallel
    // with the user) because the toggle's default depends on it.
    const [u, coupleV] = await Promise.all([
      getUser(),
      getMyCouple().catch(() => null),
    ]);
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

    // Pre-warm the AI assistant context so the chat in FocusSessionScreen
    // has a warm cache. Deferred 2s so it doesn't compete with the
    // Supabase fetches that produce the first paint.
    setTimeout(() => { getTeacherContextForAI().catch(() => {}); }, 2000);

    // ─── Wave 1 (blocking): everything we need to paint the solo hero + cards ──
    const [slots, sessions, classes, focusTrained, wa, savedPhoto] = await Promise.all([
      getSlots(cat, true),
      getTrainingSessionsThisWeek(),
      getSessionsThisWeek(),
      getFocusTrainedThisWeek(),
      getWeekActivity(),
      AsyncStorage.getItem('@profile_photo'),
    ]);
    // getSlots already computes lesson readiness internally — reuse it instead
    // of firing a second identical query chain.
    const readinessValue = slots.readiness ?? null;
    setUser(u);
    setCouple(coupleV);
    setSlot1(slots.slot1);
    setSlot2(slots.slot2);
    setSlot3(slots.slot3);
    setSessionsThisWeek(sessions);
    setClassesThisWeek(classes);
    setFocusTrainedThisWeek(focusTrained);
    setWeekActivity(wa || {});
    setReadiness(readinessValue);
    setPhotoUri(savedPhoto || null);
    lastLoadRef.current = Date.now();

    // ─── Couple card data (non-blocking) ──
    setMyUserId(u?.id || null);
    const coupleId = coupleV?.coupleId || null;
    if (coupleId) {
      Promise.all([
        getCoupleSlots(coupleId, cat),
        mostTrainedMode(coupleId).catch(() => 'solo'),
      ]).then(([cs, primary]) => {
        setCoupleSlots(cs || { slot1: null, slot2: null, slot3: null });
        setCoupleReadiness(cs?.readiness ?? null);
        setPrimaryMode(primary);
      }).catch(() => {});
      getCoupleLock(coupleId).then(setCoupleLock).catch(() => setCoupleLock(null));
    } else {
      setCoupleSlots({ slot1: null, slot2: null, slot3: null });
      setCoupleReadiness(null);
      setPrimaryMode('solo');
      setCoupleLock(null);
    }

    // ─── Wave 2 (non-blocking): session counts + metrics fill in after ──
    // Kicked off in parallel and applied when they land, so the screen
    // renders immediately instead of waiting on a 2nd & 3rd serial wave.
    Promise.all([
      slots.slot1?.id ? getSessionCountForFocus(slots.slot1.id) : Promise.resolve(0),
      slots.slot2?.id ? getSessionCountForFocus(slots.slot2.id) : Promise.resolve(0),
      u?.id ? getAllStudentMetrics(u.id, cat).catch(() => null) : Promise.resolve(null),
    ]).then(([c1, c2, m]) => {
      setSessionCount(c1);
      setSlot2Count(c2);
      const metricsFinal = m || { progression: 0, retention: 100, global: 0 };
      if (m) setMetrics(metricsFinal);
      // Persist the FULL snapshot (with timestamp) once everything is in.
      AsyncStorage.setItem(HOME_CACHE_KEY, JSON.stringify({
        ts: Date.now(),
        user: u, slot1: slots.slot1, slot2: slots.slot2, slot3: slots.slot3,
        sessionCount: c1, slot2Count: c2,
        sessionsThisWeek: sessions, classesThisWeek: classes,
        focusTrainedThisWeek: focusTrained, weekActivity: wa || {}, metrics: metricsFinal,
        readiness: readinessValue,
        category: cat,
      })).catch(() => {});
    }).catch(() => {});
  }

  // Switching style only changes the focus slots + readiness — NOT the week
  // activity, metrics, etc. The other style is prefetched after load, so the
  // common back-and-forth toggle is instant (cache hit → swap now, refresh
  // quietly). Only an un-prefetched style shows the switch skeleton.
  async function handleSelectCategory(next) {
    setPickerVisible(false);
    if (next === category) return;
    AsyncStorage.setItem(CATEGORY_STORAGE_KEY, next).catch(() => {});

    const prev = category;
    const hasCouple = !!(couple?.coupleId);
    // Snapshot the style we're leaving so toggling back is instant.
    if (prev) {
      categoryCacheRef.current[prev] = {
        slot1, slot2, slot3, readiness,
        coupleSlots, coupleReadiness, sessionCount, slot2Count,
      };
    }

    setCategory(next); // optimistic — toggle label + card visibility flip now
    const seq = ++switchSeqRef.current;

    const cached = categoryCacheRef.current[next];
    if (cached) {
      // Instant swap from cache, then refresh in the background.
      applyCategoryData(cached, hasCouple);
      fetchCategoryData(next).then((d) => {
        categoryCacheRef.current[next] = d;
        if (switchSeqRef.current === seq) applyCategoryData(d, hasCouple);
      }).catch(() => {});
      return;
    }

    // No cache yet → show the skeleton while we fetch this style fresh.
    setCategorySwitching(true);
    try {
      const d = await fetchCategoryData(next);
      categoryCacheRef.current[next] = d;
      if (switchSeqRef.current === seq) applyCategoryData(d, hasCouple);
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
      fetchCategoryData(other, couple?.coupleId || null)
        .then((d) => { if (!cancelled) categoryCacheRef.current[other] = d; })
        .catch(() => {});
    }, 1200);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFilter, isLoading, category, couple?.coupleId]);

  useFocusEffect(useCallback(() => {
    setShareState('default');
    const isFirst = !hasLoadedRef.current;
    if (isFirst) setIsLoading(true);
    const reveal = () => {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    };
    async function init() {
      let hadCache = false;
      let cacheTs = 0;
      let revealed = false;
      if (isFirst) {
        try {
          const raw = await AsyncStorage.getItem(HOME_CACHE_KEY);
          if (raw) {
            const c = JSON.parse(raw);
            hadCache = true;
            cacheTs = c.ts || 0;
            setUser(c.user);
            setShowFilter(c.user?.dance_style === 'Latin & Ballroom');
            setCategory(c.category ?? null);
            setSlot1(c.slot1);
            setSlot2(c.slot2);
            setSlot3(c.slot3 || null);
            setSessionCount(c.sessionCount || 0);
            setSlot2Count(c.slot2Count || 0);
            setSessionsThisWeek(c.sessionsThisWeek || 0);
            setClassesThisWeek(c.classesThisWeek || 0);
            setFocusTrainedThisWeek(c.focusTrainedThisWeek || 0);
            setWeekActivity(c.weekActivity || {});
            setReadiness(c.readiness || null);
            if (c.metrics) setMetrics(c.metrics);
            // Seed lastLoadRef from cache so subsequent focuses honor freshness
            // and don't redundantly refetch.
            if (cacheTs) lastLoadRef.current = cacheTs;
            setIsLoading(false); // stale-while-revalidate: show cache instantly
            reveal(); // fade cached content in NOW, even while the refresh runs
            revealed = true;
          }
        } catch {}
      }
      // Skip the network refresh entirely if cache is fresh (< FRESH_TTL).
      // Tab switches & quick back-nav feel instant, no spinner flash.
      const fresh = isFirst
        ? hadCache && cacheTs && (Date.now() - cacheTs < FRESH_TTL)
        : (Date.now() - lastLoadRef.current < FRESH_TTL);
      if (!fresh) {
        try { await load(); } catch {}
      }
      hasLoadedRef.current = true;
      setIsLoading(false);
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

  async function handleShare() {
    if (shareState === 'loading') return;
    setShareState('loading');
    setShareLoadingMsg(SHARE_LOADING_MSGS[0]);
    let msgIdx = 0;
    shareMsgRef.current = setInterval(() => {
      msgIdx = (msgIdx + 1) % SHARE_LOADING_MSGS.length;
      setShareLoadingMsg(SHARE_LOADING_MSGS[msgIdx]);
    }, 1500);
    try {
      const [recentInputs, topFocusPoints] = await Promise.all([
        getRecentClassInputs(3),
        getTopFocusPointsWithCounts(3),
      ]);
      const summary = await generateCoachShareSummary({
        recentInputs,
        topFocusPoints,
        totalFocusWorked: user?.total_focus_worked || 0,
        lastActiveDate: user?.last_active_date || null,
      });
      clearInterval(shareMsgRef.current);
      await Clipboard.setStringAsync(summary);
      setShareState('success');
    } catch {
      clearInterval(shareMsgRef.current);
      setShareState('default');
      Alert.alert('Something went wrong', 'Try again.');
    }
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
    if (getActiveSession()) return;
    setStarting(true);
    const sessionId = await startTrainingSession(focusPoint.id, null);
    setStarting(false);
    navigation.navigate('FocusSession', {
      focusPointId: focusPoint.id,
      sessionId,
      rank: 0,
      sessionCount: 0,
      couple: true,
      coupleId: couple.coupleId,
    });
  }

  const isSessionActive = !!activeSession;
  const paired = !!couple;

  // Global Latin/Ballroom filter. A card is shown only if its owner actually
  // does the selected style — so picking Ballroom hides the solo card for a
  // Latin-only dancer whose couple does Ballroom (and vice-versa). When there's
  // no active filter (category null), everything shows as before.
  const soloDoesLatin = (user?.dance_style || '').includes('Latin');
  const soloDoesBallroom = (user?.dance_style || '').includes('Ballroom');
  const soloInStyle = !category || (category === 'latin' ? soloDoesLatin : soloDoesBallroom);
  const coupleInStyle = !category || (category === 'latin' ? !!couple?.doesLatin : !!couple?.doesBallroom);
  // An active solo session always keeps the solo card visible (can't hide a
  // running session behind a filter).
  const soloVisible = soloInStyle || isSessionActive;
  const coupleVisible = paired && coupleInStyle;

  // Couple lock — live mirror: when the partner holds the lock, show their
  // training in progress on the couple card and block starting.
  const partnerLock = (coupleLock && myUserId && coupleLock.lockedByUserId !== myUserId) ? coupleLock : null;

  useEffect(() => {
    const cid = couple?.coupleId;
    if (!cid) return;
    const ch = supabase
      .channel(`home-couple-${cid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'couple_focus_locks', filter: `couple_id=eq.${cid}` },
        () => { getCoupleLock(cid).then(setCoupleLock).catch(() => {}); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'couple_practice_logs', filter: `couple_id=eq.${cid}` },
        () => { getCoupleReadiness(cid, category).then(setCoupleReadiness).catch(() => {}); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [couple?.coupleId, category]);

  useEffect(() => {
    if (!partnerLock) { setLockRemaining(0); return; }
    const compute = () => {
      const end = new Date(partnerLock.startedAt).getTime() + (partnerLock.durationMinutes || 7) * 60000;
      setLockRemaining(Math.max(0, Math.floor((end - Date.now()) / 1000)));
    };
    compute();
    const id = setInterval(compute, 1000);
    return () => clearInterval(id);
  }, [partnerLock?.coupleFocusPointId, partnerLock?.startedAt]);
  const activeFocusName = isSessionActive
    ? (activeSession.focusPointName ?? slot1?.name)
    : slot1?.name;

  const heroMessage = slot1?.subtitle || null;

  if (isLoading) {
    return <HomeSkeleton />;
  }

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={['#F2F2EF', '#F8F2E2', '#F4EAD0', '#FFFFFF', '#FFFFFF']}
        locations={[0, 0.4, 0.7, 0.85, 1]}
        style={StyleSheet.absoluteFillObject}
      />
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>

      <TabHeader
        navigation={navigation}
        center={
          showFilter ? (
            <CategoryToggle
              category={category}
              onPress={() => setPickerVisible(true)}
            />
          ) : null
        }
      />

      {/* ── This Week — anchored at the top, right under the header ── */}
      <View style={w.card}>
        <View style={w.head}>
          <Text style={w.title}>This week</Text>
          <Text style={w.date}>{currentWeekRange()}</Text>
        </View>
        <View style={w.dayRow}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, i) => {
            const day = weekActivity[i];
            const classes = day?.classes ?? [];
            const hasTraining = (day?.sessions?.length ?? 0) > 0;
            const hasClass = classes.some((c) => c.lesson_type === 'group');
            const hasPrivate = classes.some((c) => c.lesson_type !== 'group');
            const hasActivity = hasTraining || classes.length > 0;
            const isToday = i === ((new Date().getDay() + 6) % 7);
            return (
              <TouchableOpacity
                key={i}
                style={w.dayCol}
                activeOpacity={hasActivity ? 0.6 : 1}
                onPress={() => hasActivity && setDayModal(i)}
              >
                <Text style={[w.dayLetter, isToday && w.dayLetterToday]}>{label}</Text>
                <View style={w.pillRow}>
                  {hasTraining ? <View style={[w.pill, w.pillTraining]} /> : null}
                  {hasClass ? <View style={[w.pill, w.pillClass]} /> : null}
                  {hasPrivate ? <View style={[w.pill, w.pillPrivate]} /> : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={w.statLine}>
          <View style={w.stat}><Text style={w.statNum}>{sessionsThisWeek}</Text><Text style={w.statLbl}>Training</Text></View>
          <View style={w.stat}><Text style={w.statNum}>{classesThisWeek}</Text><Text style={w.statLbl}>Class</Text></View>
          <View style={w.stat}><Text style={w.statNum}>{focusTrainedThisWeek}</Text><Text style={w.statLbl}>Focus trained</Text></View>
        </View>
      </View>

      {/* While a not-yet-prefetched style loads after a toggle, swap the focus
          cards + "Get ready" dock for a skeleton. The This-week card above is
          style-agnostic, so it stays put. */}
      {categorySwitching ? (
        <TrainSwitchSkeleton paired={paired} />
      ) : (
       <>
      {/* ── Top section ── */}
      <View style={[s.scroll, s.scrollContent]}>

        {/* Solo + Couple focus cards (accordion). Primary = large, the other
            collapses below; tapping the small card swaps which is primary. */}
        {(() => {
          const soloFocuses = [slot1, slot2, slot3].filter(Boolean);
          const sIdx = Math.min(soloIdx, Math.max(0, soloFocuses.length - 1));
          const curSolo = isSessionActive
            ? { name: activeFocusName, subtitle: heroMessage }
            : (soloFocuses[sIdx] || null);
          // An active session forces the solo card to stay expanded.
          const soloIsPrimary = isSessionActive ? true : (primaryMode === 'solo');

          const timerNode = (
            <View style={s.inProgressRight}>
              {countdown > 0 ? (
                <Text style={s.inProgressTimer}>{formatTime(countdown)}</Text>
              ) : (
                <Text style={[s.inProgressTimer, { color: Colors.orange }]}>+ {formatTime(homeOverTime)}</Text>
              )}
              <Text style={s.inProgressArrow}>›</Text>
            </View>
          );

          const soloProgress = (() => {
            const fp = soloFocuses[sIdx];
            const r = fp && readiness?.focuses?.find((f) => f.focusPointId === fp.id);
            return r ? `${r.done}/${r.target}` : null;
          })();
          const soloCard = (
            <FocusCard
              key="solo"
              theme="solo"
              expanded={soloIsPrimary || !paired || (soloVisible && !coupleVisible)}
              focus={curSolo}
              count={soloFocuses.length}
              idx={sIdx}
              onDot={setSoloIdx}
              pill="SOLO · FOCUS"
              sub={null}
              progress={soloProgress}
              headerAvatar={null}
              onStart={() => handleStartSession(soloFocuses[sIdx], sIdx, sessionCount)}
              starting={starting}
              onExpand={() => swapPrimary('solo')}
              sessionActive={isSessionActive}
              onResume={() => navigation.navigate('FocusSession', {
                focusPointId: activeSession?.focusPointId,
                sessionId: activeSession?.sessionId,
                rank: activeSession?.rank,
                sessionCount: activeSession?.sessionCount,
              })}
              timerNode={timerNode}
              emptyText="Log your next class to see your focus points appear."
            />
          );

          if (!paired) return soloCard;

          const coupleFocuses = [coupleSlots.slot1, coupleSlots.slot2, coupleSlots.slot3].filter(Boolean);
          const cIdx = Math.min(coupleIdx, Math.max(0, coupleFocuses.length - 1));
          const partnerFirst = (couple?.partner?.name || 'Partner').split(' ')[0];
          const lockedLabel = partnerLock ? `${partnerFirst} is training · ${formatTime(lockRemaining)}` : null;
          const coupleFocus = partnerLock ? { name: partnerLock.focusName } : (coupleFocuses[cIdx] || null);
          const coupleProgress = (() => {
            const fp = coupleFocuses[cIdx];
            const r = fp && coupleReadiness?.focuses?.find((f) => f.focusPointId === fp.id);
            return r ? `${r.done}/${r.target}` : null;
          })();
          const coupleCard = (
            <FocusCard
              key="couple"
              theme="couple"
              expanded={!soloIsPrimary || (coupleVisible && !soloVisible)}
              focus={coupleFocus}
              count={partnerLock ? 0 : coupleFocuses.length}
              idx={cIdx}
              onDot={setCoupleIdx}
              pill="COUPLE · FOCUS"
              sub={partnerLock ? 'training in progress' : null}
              progress={partnerLock ? null : coupleProgress}
              headerAvatar={<PairAvatars uri={photoUri} partnerInitial={partnerFirst.charAt(0)} />}
              onStart={() => handleStartCoupleSession(coupleFocuses[cIdx])}
              starting={starting}
              onExpand={() => swapPrimary('couple')}
              emptyText="Attend your couple private lesson to get shared focus points."
              lockedLabel={lockedLabel}
            />
          );

          // Global style filter hides whichever card's owner doesn't do the
          // selected style. If only one remains, show it solo (full-width).
          if (coupleVisible && !soloVisible) return coupleCard;
          if (soloVisible && !coupleVisible) return soloCard;
          if (!soloVisible && !coupleVisible) return null;

          return (
            <View style={cc.stack}>
              {soloIsPrimary ? soloCard : coupleCard}
              {soloIsPrimary ? coupleCard : soloCard}
            </View>
          );
        })()}

        {/* See all focus points */}
        <TouchableOpacity
          style={cc.allLink}
          onPress={() => navigation.navigate('AllFocusPoints')}
          activeOpacity={0.7}
        >
          <Text style={cc.allLinkText}>All focus points</Text>
          <Ionicons name="chevron-forward" size={14} color="rgba(13,13,18,0.4)" />
        </TouchableOpacity>
      </View>

      {/* ── Bottom dock ── */}
      <View style={s.bottomDock}>
        {/* Get ready — the PRIMARY card's focuses as a list (gold solo / blue couple);
            the SECONDARY shrinks to a column of rings (couple→right, solo→left). */}
        {(() => {
          const soloF = readiness?.focuses ?? [];
          const coupleF = coupleReadiness?.focuses ?? [];
          // Respect the global style filter: a hidden card's readiness drops too.
          const bothVisible = soloVisible && coupleVisible;
          const primaryCouple = paired && (
            (coupleVisible && !soloVisible) ? true
            : (soloVisible && !coupleVisible) ? false
            : rdlPrimary === 'couple'
          );
          const mainF = primaryCouple ? coupleF : soloF;
          const sideF = (paired && bothVisible) ? (primaryCouple ? soloF : coupleF) : [];
          const mainColor = primaryCouple ? CBLUE : '#E8B530';
          const sideColor = primaryCouple ? '#E8B530' : CBLUE;
          const sideOnLeft = primaryCouple; // solo (secondary) shrinks left; couple shrinks right
          const labelColor = primaryCouple ? CBLUE : '#A8801A';
          const completed = mainF.filter((f) => (f.target ?? 0) > 0 && (f.done ?? 0) >= f.target).length;
          const sideBox = primaryCouple
            ? { backgroundColor: 'rgba(232,181,48,0.08)', borderColor: 'rgba(232,181,48,0.22)' }
            : { backgroundColor: 'rgba(46,70,112,0.06)', borderColor: 'rgba(46,70,112,0.16)' };
          const sideEl = sideF.length > 0 ? (
            <TouchableOpacity
              style={[rdl.side, sideBox, sideOnLeft ? { marginRight: 12 } : { marginLeft: 12 }]}
              activeOpacity={0.7}
              onPress={() => swapPrimary(primaryCouple ? 'solo' : 'couple')}
            >
              {sideF.map((f) => (
                <View key={f.focusPointId} style={rdl.srow}>
                  <ProgRing done={f.done ?? 0} target={f.target ?? 0} color={sideColor} size={16} sw={2.4} />
                </View>
              ))}
            </TouchableOpacity>
          ) : null;
          return (
            <TouchableOpacity style={rdl.card} activeOpacity={0.85} onPress={() => navigation.navigate('PROFILE')}>
              <View style={rdl.topRow}>
                <Text style={rdl.eye}>Get ready · next private</Text>
                <View style={rdl.hd}>
                  <Text style={[rdl.lab, { color: labelColor }]}>{primaryCouple ? 'Couple' : 'Solo'}</Text>
                  <Text style={rdl.cnt}>{completed}/{mainF.length}</Text>
                </View>
              </View>
              <Animated.View style={[rdl.split, { opacity: rdlSlide.interpolate({ inputRange: [-90, 0, 90], outputRange: [0, 1, 0], extrapolate: 'clamp' }), transform: [{ translateX: rdlSlide }] }]}>
                {sideOnLeft ? sideEl : null}
                <View style={rdl.main}>
                  {mainF.length === 0 ? (
                    <Text style={rdl.empty}>Log your last private to start.</Text>
                  ) : mainF.map((f) => {
                    const todo = (f.done ?? 0) === 0;
                    return (
                      <View key={f.focusPointId} style={rdl.fp}>
                        <ProgRing done={f.done ?? 0} target={f.target ?? 0} color={mainColor} />
                        <Text style={[rdl.nm, todo && rdl.nmTodo]} numberOfLines={1}>{f.name}</Text>
                        <Text style={[rdl.fr, { color: todo ? 'rgba(13,13,18,0.45)' : labelColor }]}>{f.done ?? 0}/{f.target ?? 0}</Text>
                      </View>
                    );
                  })}
                </View>
                {!sideOnLeft ? sideEl : null}
              </Animated.View>
            </TouchableOpacity>
          );
        })()}

      </View>
       </>
      )}

      <LogModal
        visible={logModalVisible}
        onClose={() => setLogModalVisible(false)}
        onSubmitted={() => { setLogModalVisible(false); load(); }}
      />

      <CategoryPicker
        visible={pickerVisible}
        current={category}
        onSelect={handleSelectCategory}
        onClose={() => setPickerVisible(false)}
      />

      <Modal visible={comingUpModal} transparent animationType="fade" onRequestClose={() => setComingUpModal(false)}>
        <TouchableOpacity style={s.comingUpOverlay} activeOpacity={1} onPress={() => setComingUpModal(false)}>
          <TouchableOpacity style={s.comingUpSheet} activeOpacity={1} onPress={() => {}}>
            <Text style={s.comingUpEmoji}>🎯</Text>
            <Text style={s.comingUpTitle}>Work on the most important focus first</Text>
            <Text style={s.comingUpBody}>Complete your primary focus point before moving to the next one. Focused repetition builds mastery faster.</Text>
            <TouchableOpacity style={s.comingUpDismiss} onPress={() => setComingUpModal(false)} activeOpacity={0.8}>
              <Text style={s.comingUpDismissText}>Got it</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <BottomSheet visible={dayModal !== null} onClose={() => setDayModal(null)} sheetStyle={dm.sheet}>
            <View style={dm.handle} />
            <Text style={dm.dayName}>{dayModal !== null ? DAY_NAMES[dayModal] : ''}</Text>
            {(weekActivity[dayModal]?.sessions?.length ?? 0) > 0 && (
              <View style={dm.section}>
                <Text style={dm.sectionLabel}>Training Sessions</Text>
                {weekActivity[dayModal].sessions.map((s) => (
                  <View key={s.id} style={dm.row}>
                    <View style={[dm.dot, dm.dotSession]} />
                    <View style={{ flex: 1 }}>
                      <Text style={dm.rowText}>{fmtTime(s.started_at)}</Text>
                      {!!s.focusName && <Text style={dm.rowSub} numberOfLines={1}>{s.focusName}</Text>}
                    </View>
                    {!!s.feeling && <Text style={dm.feeling}>{FEELING_EMOJI[s.feeling] ?? s.feeling}</Text>}
                  </View>
                ))}
              </View>
            )}
            {(weekActivity[dayModal]?.classes?.length ?? 0) > 0 && (
              <View style={dm.section}>
                <Text style={dm.sectionLabel}>Class Logs</Text>
                {weekActivity[dayModal].classes.map((c) => (
                  <View key={c.id} style={dm.row}>
                    <View style={[dm.dot, dm.dotClass]} />
                    <View style={{ flex: 1 }}>
                      <Text style={dm.rowText}>{fmtTime(c.created_at)}</Text>
                      {!!(c.title || c.ai_primary_focus || c.practice_point_1) && (
                        <Text style={dm.rowSub} numberOfLines={1}>{c.title || c.ai_primary_focus || c.practice_point_1}</Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}
      </BottomSheet>
      </Animated.View>
    </SafeAreaView>
    </View>
  );
}

// ─── Heatmap styles ───────────────────────────────────────────────────────────
const h = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  cell: {
    flex: 1,
    aspectRatio: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellToday: { backgroundColor: '#0D0D12' },
  label: { fontFamily: Fonts.jakartaSemiBold, fontSize: 14, color: '#0D0D12' },
  labelToday: { color: Colors.orange },
  dots: { flexDirection: 'row', gap: 3, marginTop: 3, height: 5 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  dotSession: { backgroundColor: '#4A90D9' },
  dotClass: { backgroundColor: '#4CD964' },
});

// ─── Day modal styles ─────────────────────────────────────────────────────────
const dm = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 22,
    paddingBottom: 36,
    paddingTop: 12,
  },
  handle: {
    width: 36, height: 4,
    backgroundColor: 'rgba(17,12,17,0.12)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 18,
  },
  dayName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: '#111',
    marginBottom: 16,
  },
  section: { marginBottom: 16 },
  sectionLabel: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 10,
    color: '#ACADB9',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F2F2F2',
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  dotSession: { backgroundColor: '#4A90D9' },
  dotClass: { backgroundColor: '#4CD964' },
  rowText: { fontFamily: Fonts.jakartaMedium, fontSize: 14, color: '#111' },
  rowSub: { fontFamily: Fonts.jakartaRegular, fontSize: 12, color: '#ACADB9', marginTop: 2 },
  feeling: { fontSize: 16, marginLeft: 'auto' },
});

// ─── Main styles ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  scroll: {},
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  notifBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    fontFamily: Fonts.monument,
    fontSize: 20,
    color: Colors.black,
    letterSpacing: 1,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5E6C8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#8A6A2E',
  },
  avatarPhoto: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },

  // ── Latin / Ballroom toggle (centered in TabHeader, Instagram-style) ────
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  toggleLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: Colors.black,
    letterSpacing: -0.3,
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  pickerAnchor: {
    alignItems: 'center',
    paddingTop: 50,
  },
  pickerSheet: {
    minWidth: 220,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(28,28,30,0.96)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 22,
    elevation: 14,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    minWidth: 220,
  },
  pickerRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.15)',
  },
  pickerLabel: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 15,
    color: '#FFFFFF',
    flex: 1,
  },
  pickerCheck: {
    marginLeft: 12,
  },

  // Hero card
  hero: {
    backgroundColor: '#1C1C1E',
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'rgba(242,185,64,0.45)',
    padding: 20,
    paddingBottom: 18,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.09,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 12,
    elevation: 8,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.orange,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  heroCounter: {
    fontFamily: Fonts.ttLight,
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 0.6,
  },
  heroBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: '#fff',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  heroFocusName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 30,
    color: '#fff',
    letterSpacing: -0.8,
    lineHeight: 34,
    marginBottom: 4,
  },
  heroMessage: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: '#FFFFFF',
    lineHeight: 20,
    marginBottom: 18,
  },
  heroEmptyHint: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 19,
    marginBottom: 18,
  },
  startBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 13,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  startBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: '#fff',
  },
  startBtnArrow: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 17,
    color: '#fff',
    marginTop: -1,
  },
  inProgressBtn: {
    backgroundColor: '#1C1C1E',
    borderRadius: 13,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 10,
    elevation: 4,
  },
  inProgressLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inProgressRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inProgressDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#4CD964',
    shadowColor: '#4CD964',
    shadowOpacity: 0.8,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 5,
  },
  inProgressLabel: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: '#fff',
  },
  inProgressTimer: {
    fontFamily: Fonts.monument,
    fontSize: 14,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 1,
  },
  inProgressArrow: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 20,
    color: 'rgba(255,255,255,0.3)',
    lineHeight: 22,
  },

  // "or" divider
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  orLine: { flex: 1, height: 1, backgroundColor: '#EFEFEF' },
  orText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: '#C8C8C8',
  },

  // Alt row
  altRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 9,
    marginBottom: 4,
  },
  altCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 13,
    paddingHorizontal: 14,
  },
  altCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  altTryLabel: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 9,
    color: '#C8C8C8',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  altName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#111',
    letterSpacing: -0.3,
  },
  altCardLocked: {
    opacity: 0.4,
  },
  altLockIcon: {
    fontSize: 9,
    color: '#C8C8C8',
  },
  altCardComingUp: {
    opacity: 0.6,
  },
  allFocusBtn: {
    width: 64,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allFocusBtnText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: '#0D0D12',
    letterSpacing: -0.2,
  },

  // Coming up modal
  comingUpOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  comingUpSheet: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    width: '100%',
  },
  comingUpEmoji: {
    fontSize: 36,
    marginBottom: 14,
  },
  comingUpTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: '#111',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: 10,
  },
  comingUpBody: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  comingUpDismiss: {
    backgroundColor: '#111',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 32,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  comingUpDismissText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: '#fff',
  },

  // Bottom dock — flows naturally right after the hero / alt row. The empty
  // space below the stats cards is intentional (it preserves the layout that
  // existed when the metric gauges occupied that area).
  bottomDock: {
    flexShrink: 0,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 4,
    backgroundColor: 'transparent',
  },
  dockSep: {
    width: 72,
    height: 1,
    backgroundColor: '#D8D8D8',
    alignSelf: 'center',
    marginBottom: 14,
  },

  // Next class readiness (condensed)
  readyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 14,
    // Soft gold outline — ties the card to the yellow progress bar inside
    borderWidth: 1,
    borderColor: 'rgba(232,181,48,0.32)',
    // Subtle elevation — sits one layer above the page gradient
    shadowColor: '#E8B530',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 1,
  },
  readyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  readyLabel: {
    flex: 1,
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: '#0D0D12',
    letterSpacing: -0.1,
    marginRight: 8,
  },
  readyBodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  readyPct: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 34,
    color: '#0D0D12',
    letterSpacing: -1.4,
    // Bumped from 34 → 42 so the rounded bottoms of "100" aren't clipped
    // by a too-tight line box on iOS (Jakarta needs ~1.2× headroom).
    lineHeight: 42,
    includeFontPadding: false,
  },
  readyPctSm: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
    color: 'rgba(13,13,18,0.4)',
    letterSpacing: -0.3,
  },
  readyRightCol: {
    flex: 1,
    marginLeft: 16,
    justifyContent: 'center',
  },
  readyTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(13,13,18,0.06)',
    overflow: 'hidden',
    marginBottom: 8,
  },
  readyFill: {
    height: '100%',
    backgroundColor: '#E8B530',
    borderRadius: 3,
  },
  readyMetaLine: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 11.5,
    color: 'rgba(13,13,18,0.55)',
    letterSpacing: 0.1,
  },
  readyEmpty: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12,
    color: 'rgba(13,13,18,0.55)',
    paddingVertical: 4,
  },

  // This Week
  weekSection: { marginBottom: 14 },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionLabel: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: '#0D0D12',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionDate: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 11,
    color: 'rgba(13,13,18,0.5)',
    letterSpacing: 0.4,
  },

  // Stats cards
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },

  // Health gauges (stacked horizontal bars)
  gaugeRow: {
    flexDirection: 'column',
    paddingHorizontal: 6,
    marginBottom: 4,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 28,
    color: '#0D0D12',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  statLabel: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 9,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  // Share with Coach
  shareSection: { marginBottom: 5 },
  shareDesc: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11,
    color: '#C8C8C8',
    lineHeight: 16,
    textAlign: 'center',
    marginBottom: 9,
  },
  shareBtn: {
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#E8E8E8',
    backgroundColor: 'transparent',
  },
  shareBtnLoading: { borderColor: 'rgba(17,12,17,0.08)' },
  shareBtnSuccess: { borderColor: '#22a861', backgroundColor: 'rgba(34,168,97,0.06)' },
  shareInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shareIconArrow: { fontSize: 13, color: '#888' },
  shareBtnText: { fontFamily: Fonts.jakartaSemiBold, fontSize: 12, color: '#888' },
  shareBtnTextLoading: { fontFamily: Fonts.jakartaRegular, fontSize: 13, color: 'rgba(17,12,17,0.4)', marginLeft: 8 },
  shareBtnTextSuccess: { fontFamily: Fonts.jakartaBold, fontSize: 13, color: '#22a861' },
});

// ─── Couple feature: Train cards, dots, avatars, concentric readiness ─────────
const cc = StyleSheet.create({
  stack: { gap: 12 },

  // Single-layer card: clips the gradient + content to the radius and draws the
  // border. NO drop shadow on purpose — on iOS overflow:hidden clipped it away
  // anyway (so it was invisible), but a shadow on a clipped + animated view
  // forces an offscreen re-render every frame, which was the choppy-swap cause
  // AND made a heavy shadow slide up during the swap. Padding lives on
  // colPad/expPad so the root view stays a stable, morph-able container.
  card: { borderRadius: 22, overflow: 'hidden', position: 'relative' },
  expPad: { padding: 18, paddingBottom: 16 },
  colPad: { padding: 13 },
  cardSolo: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.13)' },
  cardCouple: { borderWidth: 1, borderColor: 'rgba(127,151,187,0.42)' },
  cardSoloExp: { borderWidth: 2, borderColor: 'rgba(242,185,64,0.45)' },
  cardCoupleExp: { borderWidth: 1, borderColor: 'rgba(127,151,187,0.5)' },

  // Expanded
  expTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  pillSolo: { backgroundColor: 'rgba(255,255,255,0.16)' },
  pillCouple: { backgroundColor: 'rgba(255,255,255,0.14)' },
  pillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.orange },
  pillTxt: { fontFamily: Fonts.jakartaExtraBold, fontSize: 9.5, letterSpacing: 1.2, color: '#fff', textTransform: 'uppercase' },
  expTopLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minWidth: 0 },
  progressTxt: { fontFamily: Fonts.jakartaExtraBold, fontSize: 13, color: 'rgba(255,255,255,0.92)', letterSpacing: 0.2 },
  progressUnit: { fontFamily: Fonts.jakartaSemiBold, fontSize: 11, color: 'rgba(255,255,255,0.55)', letterSpacing: 0.2 },
  expTitle: { fontFamily: Fonts.jakartaExtraBold, fontSize: 30, color: '#fff', letterSpacing: -0.8, lineHeight: 33, marginTop: 12, minHeight: 66 },
  expSub: { fontFamily: Fonts.ttLight, fontSize: 11.5, color: 'rgba(255,255,255,0.55)', marginTop: 5 },
  expBodyBox: { minHeight: 38, marginTop: 9 },
  expDesc: { fontFamily: Fonts.jakartaRegular, fontSize: 13, color: 'rgba(255,255,255,0.8)', lineHeight: 19 },
  expNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 12, minHeight: 18 },
  swipeHint: { fontFamily: Fonts.jakartaBold, fontSize: 9.5, letterSpacing: 1.4, color: 'rgba(255,255,255,0.45)' },
  emptyTxt: { fontFamily: Fonts.jakartaRegular, fontSize: 14, color: 'rgba(255,255,255,0.72)', lineHeight: 20, marginTop: 14, marginBottom: 6 },

  // Start
  startBtnSolo: { backgroundColor: Colors.orange, borderRadius: 13, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  startTxt: { fontFamily: Fonts.jakartaBold, fontSize: 15, color: '#fff' },
  startArrow: { fontFamily: Fonts.jakartaBold, fontSize: 17, color: '#fff', marginTop: -1 },
  lockBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.28)', borderRadius: 13, paddingVertical: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  lockTxt: { fontFamily: Fonts.jakartaBold, fontSize: 13.5, color: 'rgba(255,255,255,0.9)' },

  // In-progress (solo)
  inProgBtn: { backgroundColor: 'rgba(0,0,0,0.28)', borderRadius: 13, paddingVertical: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', marginTop: 4 },
  inProgLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inProgDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.orange },
  inProgTxt: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: '#fff' },

  // Collapsed
  collapsedRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  collapsedMid: { flex: 1, minWidth: 0 },
  labelBare: { fontFamily: Fonts.jakartaExtraBold, fontSize: 9, letterSpacing: 1.1, textTransform: 'uppercase' },
  labelSolo: { color: 'rgba(255,255,255,0.55)' },
  labelCouple: { color: '#A9C2E2' },
  collapsedTitle: { fontFamily: Fonts.jakartaBold, fontSize: 16.5, color: '#fff', letterSpacing: -0.3, marginTop: 3 },
  expandBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.26)', alignItems: 'center', justifyContent: 'center' },

  // Dots
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.25)' },
  dotOn: { width: 20, borderRadius: 4 },
  dotOnSolo: { backgroundColor: Colors.orange },
  dotOnCouple: { backgroundColor: CBLUE_DOT },

  // Mini avatars
  miniAv: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: '#F7F6F3', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: '#3A3A3A' },
  miniAvFallback: { backgroundColor: '#5A4A22' },
  miniAvCouple: { backgroundColor: CBLUE },
  miniAvTxt: { fontFamily: Fonts.jakartaExtraBold, fontSize: 10, color: '#fff' },
  pairStack: { flexDirection: 'row', alignItems: 'center' },
  pairSecond: { marginLeft: -10 },

  // Readiness card
  readyCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'rgba(255,255,255,0.7)', borderWidth: 1, borderColor: 'rgba(10,10,10,0.09)', borderRadius: 20, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 14 },
  readyRingWrap: { width: 58, height: 58 },
  readyMid: { flex: 1, minWidth: 0 },
  readyEye: { fontFamily: Fonts.jakartaExtraBold, fontSize: 9, letterSpacing: 0.8, color: '#A8801A', textTransform: 'uppercase' },
  readySub: { fontFamily: Fonts.jakartaSemiBold, fontSize: 12.5, color: 'rgba(10,10,10,0.7)', marginTop: 4 },
  readyStatRow: { flexDirection: 'row', alignItems: 'center', marginTop: 5 },
  readyDot: { width: 7, height: 7, borderRadius: 3.5, marginRight: 5 },
  readyDotCouple: { marginLeft: 14 },
  readyAvs: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  haloGold: { borderRadius: 999, padding: 2, borderWidth: 2, borderColor: Colors.orange },
  haloBlue: { borderWidth: 2, borderColor: CBLUE },

  // All focus points link
  allLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 12, marginTop: 2 },
  allLinkText: { fontFamily: Fonts.jakartaSemiBold, fontSize: 13, color: 'rgba(13,13,18,0.45)' },
});

// ─── This Week card (top of Train) ────────────────────────────────────────────
const w = StyleSheet.create({
  // Flush on the page background (no card box) with a hairline separating it
  // from the focus card below — matches the mockup.
  card: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(10,10,10,0.07)' },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontFamily: Fonts.ttExtraBold, fontSize: 15, color: '#0D0D12', letterSpacing: 1.4, textTransform: 'uppercase' },
  date: { fontFamily: Fonts.ttLight, fontSize: 15, color: 'rgba(13,13,18,0.4)', letterSpacing: 0.3 },
  dayRow: { flexDirection: 'row', marginBottom: 6 },
  dayCol: { flex: 1, alignItems: 'center' },
  dayLetter: { fontFamily: Fonts.jakartaExtraBold, fontSize: 20, color: 'rgba(13,13,18,0.3)', letterSpacing: 0.5 },
  dayLetterToday: { color: Colors.orange },
  pillRow: { flexDirection: 'row', gap: 3, marginTop: 7, height: 4 },
  pill: { width: 9, height: 4, borderRadius: 2 },
  pillTraining: { backgroundColor: Colors.orange },
  pillClass: { backgroundColor: '#4CD964' },
  pillPrivate: { backgroundColor: '#4A90D9' },
  statLine: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statNum: { fontFamily: Fonts.ttBold, fontSize: 17, color: '#0D0D12' },
  statLbl: { fontFamily: Fonts.ttLight, fontSize: 14, color: 'rgba(13,13,18,0.55)', letterSpacing: 0.2 },
});

// ─── Get ready · next private — readiness card (bottom of Train) ──────────────
const rdl = StyleSheet.create({
  card: { backgroundColor: 'rgba(255,255,255,0.5)', borderWidth: 1, borderColor: 'rgba(10,10,10,0.09)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 4, shadowColor: '#000', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 5 }, shadowRadius: 14, elevation: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  eye: { fontFamily: Fonts.jakartaExtraBold, fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase', color: '#A8801A' },
  hd: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lab: { fontFamily: Fonts.jakartaExtraBold, fontSize: 10, letterSpacing: 1.1, textTransform: 'uppercase' },
  cnt: { fontFamily: Fonts.jakartaBold, fontSize: 11, color: 'rgba(13,13,18,0.45)' },
  split: { flexDirection: 'row', alignItems: 'stretch' },
  main: { flex: 1, minWidth: 0 },
  fp: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 3.5 },
  nm: { flex: 1, fontFamily: Fonts.jakartaSemiBold, fontSize: 13, color: 'rgba(10,10,10,0.72)' },
  nmTodo: { color: 'rgba(13,13,18,0.45)', fontFamily: Fonts.jakartaMedium },
  fr: { fontFamily: Fonts.jakartaExtraBold, fontSize: 11.5 },
  empty: { fontFamily: Fonts.jakartaSemiBold, fontSize: 12.5, color: 'rgba(13,13,18,0.45)', paddingVertical: 4 },
  side: { width: 50, borderWidth: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'space-around', paddingVertical: 5 },
  srow: { alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
});

// ─── Train switch skeleton (Latin↔Ballroom toggle) ───────────────────────────
const tk = StyleSheet.create({
  bigCard: { backgroundColor: '#1C1C1E', borderRadius: 22, padding: 18, paddingBottom: 16 },
  smallCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1C1C1E', borderRadius: 22, padding: 13, marginTop: 12 },
  readyCard: { backgroundColor: 'rgba(255,255,255,0.5)', borderWidth: 1, borderColor: 'rgba(10,10,10,0.09)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 4 },
  readyTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  readyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
});
