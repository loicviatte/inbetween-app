import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  Easing,
  LayoutAnimation,
  UIManager,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { SkeletonBox } from '../../components/Skeleton';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle, Path } from 'react-native-svg';
import { Colors, Fonts, Spacing } from '../../theme';
import { supabase } from '../../services/supabase/client';
import {
  getStudentProfile,
  getStudentFocusPoints,
  getStudentRecentActivity,
  getStudentQuestions,
  getStudentArchivedFocusPoints,
  replyToQuestion,
  dismissQuestion,
  getPendingFocusPoints,
  getStudentLastClassDate,
  approveFocusPoint,
  deletePendingFocusPoint,
  editAndApproveFocusPoint,
  rejectPendingFocusPoint,
  updateFocusPoint,
} from '../../storage/coachStorage';
import PendingFocusCard from '../../components/coach/PendingFocusCard';
import RejectFocusSheet from '../../components/coach/RejectFocusSheet';
import QuestionCard from '../../components/coach/QuestionCard';
import MergeCompareCard from '../../components/coach/MergeCompareCard';
import NameMatchCard from '../../components/coach/NameMatchCard';
import { getNotifications, deleteNotification } from '../../storage/notificationsStorage';
import { getUser, getLessonReadiness } from '../../storage/storage';
import { getAllStudentMetrics } from '../../utils/studentMetrics';
import { categoryFromStyle } from '../../utils/danceCategory';
import FocusPointEditSheet from '../../components/FocusPointEditSheet';
import { useCoachData } from '../../context/CoachDataContext';

// ── Palette ─────────────────────────────────────────────────────────────────
const C = {
  bg: '#FFFFFF',
  surface: '#F5F5F5',
  surfaceAlt: '#FAFAFA',
  dark: '#0E0E0E',
  orange: '#E8A838',
  green: '#4AAF52',
  red: '#D44545',
  text: '#0E0E0E',
  sub: '#8A8A8A',
  muted: '#B0B0B0',
  white: '#FFFFFF',
  cardBorder: 'rgba(0,0,0,0.05)',
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function initialOf(name) {
  if (!name) return '?';
  return name.trim()[0].toUpperCase();
}

function relativeDateShort(date) {
  const d = new Date(date);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) {
    return d.toLocaleDateString('en-US', { weekday: 'short' }) +
      ' ' + d.getDate();
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function joinedLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// ── Activity Ring ───────────────────────────────────────────────────────────
function ActivityRing({ progress = 0, size = 62, strokeWidth = 3.5, color = C.orange, track = 'rgba(255,255,255,0.1)' }) {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const off = circ - (Math.max(0, Math.min(100, progress)) / 100) * circ;
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={strokeWidth} />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={`${circ}`}
        strokeDashoffset={off}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// ── Gauge (semi-circle) ─────────────────────────────────────────────────────
function Gauge({ value = 0, color, label, dark = false, dashWhenZero = false }) {
  const size = 64;
  const strokeW = 5;
  const r = size / 2 - strokeW;
  const cx = size / 2;
  const cy = size / 2;
  const startX = cx - r;
  const startY = cy;
  const endX = cx + r;
  const endY = cy;
  const d = `M ${startX} ${startY} A ${r} ${r} 0 0 1 ${endX} ${endY}`;
  const arcLen = Math.PI * r;
  const pct = Math.max(0, Math.min(100, value)) / 100;

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={size} height={size / 2 + 6}>
        <Path
          d={d}
          stroke={dark ? 'rgba(255,255,255,0.1)' : C.surface}
          strokeWidth={strokeW}
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d={d}
          stroke={color}
          strokeWidth={strokeW}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${pct * arcLen} ${arcLen}`}
        />
      </Svg>
      <Text style={{ fontFamily: Fonts.jakartaExtraBold, fontSize: 16, color: dark ? C.white : C.text, marginTop: -4 }}>
        {dashWhenZero && value === 0 ? '—%' : `${Math.round(value)}%`}
      </Text>
      <Text style={{ fontFamily: Fonts.jakartaMedium, fontSize: 10, color: dark ? 'rgba(255,255,255,0.45)' : C.sub, marginTop: 2, letterSpacing: 0.3 }}>
        {label}
      </Text>
    </View>
  );
}

// ── Card wrapper ────────────────────────────────────────────────────────────
function Card({ style, children }) {
  return (
    <View style={[styles.card, style]}>
      {children}
    </View>
  );
}

// ── Readiness ring (mirrors the student-side ProfileScreen meter) ──────────
const TIER_LABEL = {
  critical: 'Critical focus',
  important: 'Important focus',
  supporting: 'Supporting focus',
};

function ReadinessRing({ percent = 0, size = 72, stroke = 5 }) {
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, percent)) / 100) * circumference;
  const remainder = circumference - filled;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }], position: 'absolute' }}>
        <Circle cx={cx} cy={cy} r={r} stroke="rgba(255,255,255,0.10)" strokeWidth={stroke} fill="none" />
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke="#E8B530"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${filled} ${remainder}`}
          strokeLinecap="round"
        />
      </Svg>
      <Text style={styles.readyPct}>
        {Math.round(percent)}<Text style={styles.readyPctSm}>%</Text>
      </Text>
    </View>
  );
}

function FocusReadyRow({ row, isLast }) {
  if (!row) return null;
  const partial = row.done > 0;
  const labelText = `${TIER_LABEL[row.tier] || 'Focus'} · from last private`;
  return (
    <View style={[styles.readyFocusRow, !isLast && styles.readyFocusRowBorder]}>
      <View style={[styles.readyCheck, partial && styles.readyCheckPartial]}>
        {partial && <Ionicons name="checkmark" size={11} color="#F6D27A" />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.readyFocusName} numberOfLines={1}>{row.name}</Text>
        <Text style={styles.readyFocusMeta} numberOfLines={1}>{labelText}</Text>
      </View>
      <Text style={styles.readyFocusProgress}>
        {row.done}<Text style={styles.readyFocusProgressOf}>/{row.target}</Text>
      </Text>
    </View>
  );
}

// ── Skeleton for the initial load ───────────────────────────────────────────
function StudentDetailSkeleton({ onBack }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.navHeader}>
        <Pressable onPress={onBack} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </Pressable>
      </View>

      {/* Hero card skeleton */}
      <View
        style={[
          styles.stickyOverlay,
          {
            position: 'relative',
            top: 0,
            left: 0,
            right: 0,
            height: 256,
            marginTop: 16,
            marginHorizontal: 24,
          },
        ]}
      >
        <View style={{ flex: 1, overflow: 'hidden' }}>
          <View style={styles.heroTop}>
            <SkeletonBox width={62} height={62} borderRadius={31} style={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />
            <View style={{ flex: 1, marginLeft: 14, gap: 8 }}>
              <SkeletonBox width={160} height={20} borderRadius={6} style={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />
              <SkeletonBox width={220} height={12} borderRadius={4} style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
            </View>
          </View>

          <View style={[styles.gaugeRow, { marginTop: 24, gap: 16 }]}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ alignItems: 'center', gap: 8, flex: 1 }}>
                <SkeletonBox width={64} height={36} borderRadius={6} style={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />
                <SkeletonBox width={56} height={10} borderRadius={4} style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
              </View>
            ))}
          </View>

          <View style={[styles.heroFooter, { marginTop: 18 }]}>
            <SkeletonBox width={140} height={13} borderRadius={4} style={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />
            <SkeletonBox width={70} height={12} borderRadius={4} style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
          </View>
        </View>
      </View>

      {/* Tab row skeleton */}
      <View style={[styles.tabsRow, { marginHorizontal: 24, marginTop: 18 }]}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.tabBtn, { alignItems: 'center' }]}>
            <SkeletonBox width={72} height={14} borderRadius={4} />
          </View>
        ))}
      </View>

      {/* Content skeleton */}
      <View style={{ paddingHorizontal: 24, paddingTop: 18, gap: 12 }}>
        <SkeletonBox width="100%" height={140} borderRadius={16} />
        <SkeletonBox width="100%" height={72} borderRadius={14} />
        <SkeletonBox width="100%" height={72} borderRadius={14} />
      </View>
    </SafeAreaView>
  );
}

// ── Timeline row ────────────────────────────────────────────────────────────
function timelineCfg(type) {
  switch (type) {
    case 'training':
      return { bg: 'rgba(232,168,56,0.08)', border: 'rgba(232,168,56,0.3)', icon: 'flame', color: C.orange };
    case 'question':
      return { bg: 'rgba(232,168,56,0.08)', border: 'rgba(232,168,56,0.3)', icon: 'chatbubble-outline', color: C.orange };
    case 'class':
      return { bg: 'rgba(14,14,14,0.04)', border: 'rgba(14,14,14,0.12)', icon: 'book-outline', color: C.dark };
    case 'ai_focus':
      return { bg: 'rgba(74,175,82,0.08)', border: 'rgba(74,175,82,0.3)', icon: 'star', color: C.green };
    default:
      return { bg: C.surfaceAlt, border: C.cardBorder, icon: 'ellipse', color: C.sub };
  }
}

function TimelineRow({ item }) {
  const cfg = timelineCfg(item.type);
  return (
    <View style={styles.tlRow}>
      <View style={[styles.tlCircle, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
        <Ionicons name={cfg.icon} size={13} color={cfg.color} />
      </View>
      <Card style={styles.tlCard}>
        <View style={styles.tlHeader}>
          <Text style={styles.tlDate}>{relativeDateShort(item.date)}</Text>
          {item.completed && (
            <View style={styles.tlDoneRow}>
              <Ionicons name="checkmark" size={11} color={C.green} />
              <Text style={styles.tlDoneText}>Done</Text>
            </View>
          )}
        </View>
        <Text style={styles.tlTitle}>{item.title}</Text>
        {!!item.detail && <Text style={styles.tlDetail}>{item.detail}</Text>}
        {!!item.notes && (
          <View style={styles.tlNotes}>
            <Text style={styles.tlNotesText}>{item.notes}</Text>
          </View>
        )}
      </Card>
    </View>
  );
}

// ── Question sheet (reply modal) ────────────────────────────────────────────
function QuestionSheet({ visible, question, onClose, onDone }) {
  const insets = useSafeAreaInsets();
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible) setReply('');
  }, [visible]);

  async function handleReply() {
    if (!reply.trim()) return;
    setSending(true);
    await replyToQuestion(question.id, reply.trim());
    setSending(false);
    setReply('');
    onDone();
  }

  async function handleDismiss() {
    await dismissQuestion(question.id);
    onDone();
  }

  if (!question) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <Pressable style={qs.overlay} onPress={onClose}>
          <Pressable style={[qs.sheet, { paddingBottom: insets.bottom + 20 }]} onPress={() => {}}>
            <View style={qs.handle} />
            <Text style={qs.title}>Question from student</Text>
            <View style={qs.bubble}>
              <Text style={qs.bubbleText}>{question.message}</Text>
            </View>
            <View style={qs.inputRow}>
              <TextInput
                style={qs.input}
                value={reply}
                onChangeText={setReply}
                placeholder="Type your reply…"
                placeholderTextColor={C.sub}
                multiline
                maxLength={500}
              />
              <TouchableOpacity
                style={[qs.sendBtn, !reply.trim() && qs.sendBtnDisabled]}
                onPress={handleReply}
                disabled={sending || !reply.trim()}
                activeOpacity={0.85}
              >
                {sending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Ionicons name="arrow-up" size={18} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={qs.dismissBtn} onPress={handleDismiss} activeOpacity={0.7}>
              <Text style={qs.dismissText}>I'll explain in person</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Main Screen ─────────────────────────────────────────────────────────────
export default function StudentDetailScreen({ route, navigation }) {
  const { studentId, studentName } = route.params;
  const { refresh: refreshCoachData, getOrFetch, invalidateCache } = useCoachData();
  const [profile, setProfile] = useState(null);
  const [focusPoints, setFocusPoints] = useState([]);
  const [activity, setActivity] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [pendingFPs, setPendingFPs] = useState([]);
  const [mergeRequests, setMergeRequests] = useState([]);
  const [nameMatches, setNameMatches] = useState([]);
  const [lastClassDate, setLastClassDate] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [metrics, setMetrics] = useState({ progression: 0, retention: 100, global: 0 });
  // Coach's dance category, used to filter metrics. Held in a ref because the
  // realtime subscription closure (set up once per studentId) needs the latest
  // value, but stateful re-renders wouldn't re-bind that closure.
  const coachCategoryRef = useRef(null);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState('activity'); // information | activity | actions
  const [expandedAction, setExpandedAction] = useState(null);
  const [expandedPendingFpId, setExpandedPendingFpId] = useState(null);
  const [editingPendingFp, setEditingPendingFp] = useState(null);
  const [rejectingPendingFp, setRejectingPendingFp] = useState(null);

  async function handleApprovePendingFp(fpId) {
    try {
      await approveFocusPoint(fpId);
      setPendingFPs((prev) => prev.filter((fp) => fp.id !== fpId));
      // Sync the global coach context so the dashboard's badge / red action
      // button / per-student dot all reflect the approval immediately.
      refreshCoachData();
    } catch {}
  }

  function handleRejectPendingFp(fp) {
    setRejectingPendingFp(fp);
  }

  async function handleConfirmRejectPendingFp(reason) {
    if (!rejectingPendingFp) return;
    try {
      await rejectPendingFocusPoint({
        fpId: rejectingPendingFp.id,
        studentId: rejectingPendingFp.user_id ?? studentId,
        fpName: rejectingPendingFp.name,
        reason,
      });
      setPendingFPs((prev) => prev.filter((fp) => fp.id !== rejectingPendingFp.id));
      setRejectingPendingFp(null);
      refreshCoachData();
    } catch {}
  }

  async function handleSavePendingFpEdit(fpId, updates) {
    try {
      await editAndApproveFocusPoint(fpId, updates);
      setPendingFPs((prev) => prev.filter((fp) => fp.id !== fpId));
      setEditingPendingFp(null);
    } catch {}
  }

  const [activeQuestion, setActiveQuestion] = useState(null);
  const [questionSheetVisible, setQuestionSheetVisible] = useState(false);

  const [editingFocus, setEditingFocus] = useState(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let channel = null;

      async function load() {
        setLoading(true);
        try {
          // Coach-side metrics are scoped to the coach's own dance_style:
          // a Latin coach sees Latin metrics, a Ballroom coach sees Ballroom.
          // 'Latin & Ballroom' coaches (no filter) see everything.
          const me = await getUser().catch(() => null);
          const cat = categoryFromStyle(me?.dance_style);
          coachCategoryRef.current = cat;

          // All per-student reads go through the context cache so a
          // back→tap→back round-trip is instant (60s TTL). Mutations on
          // this screen call invalidateCache(`student:${studentId}:`) to
          // force a re-fetch on the next visit.
          const sk = `student:${studentId}`;
          const [p, fp, act, qs, pfp, lcd, m, notifs, mergesRes, rd] = await Promise.all([
            getOrFetch(`${sk}:profile`, () => getStudentProfile(studentId)),
            getOrFetch(`${sk}:fps`, () => getStudentFocusPoints(studentId)),
            getOrFetch(`${sk}:activity:30`, () => getStudentRecentActivity(studentId, 30)),
            getOrFetch(`${sk}:questions`, () => getStudentQuestions(studentId)),
            getOrFetch(`${sk}:pendingFps`, () => getPendingFocusPoints(studentId)),
            getOrFetch(`${sk}:lastClass`, () => getStudentLastClassDate(studentId)),
            getOrFetch(`${sk}:metrics:${cat || 'all'}`, () => getAllStudentMetrics(studentId, cat)),
            getOrFetch('coach:notifications', () => getNotifications().catch(() => [])),
            getOrFetch(`${sk}:merges`, () =>
              supabase
                .from('merge_requests')
                .select('id, student_id, focus_a, focus_b, status, created_at')
                .eq('student_id', studentId)
                .eq('status', 'pending_coach')
                .order('created_at', { ascending: false })
            ),
            getOrFetch(`${sk}:readiness`, () => getLessonReadiness(studentId).catch(() => null)),
          ]);
          const { data: merges } = mergesRes || {};
          if (active) {
            setProfile(p);
            setFocusPoints(fp);
            setActivity(act);
            setQuestions(qs);
            setPendingFPs(pfp);
            // Prefer the readiness reference (most recent private with active
            // focus points) so the activity timeline filter matches the
            // "LAST CLASS WITH YOU" recap card. Falls back to the raw
            // last-private date if readiness has no reference yet.
            setLastClassDate(rd?.lastClassDate ?? lcd);
            setReadiness(rd);
            setMetrics(m);
            setNameMatches(
              (notifs || []).filter(n =>
                n.type === 'name_match_confirm' &&
                n.data?.student_id === studentId
              )
            );
            // Enrich merge requests with full focus point objects so
            // <MergeCompareCard> can render the side-by-side compare layout
            // (needs name, subtitle, context, drill, tier, created_at).
            const mrList = merges || [];
            if (mrList.length > 0) {
              const fpIds = [...new Set(mrList.flatMap(mr => [mr.focus_a, mr.focus_b]))];
              const { data: fpRows } = await supabase
                .from('focus_points')
                .select('id, name, user_id, subtitle, context, dance, drill, tier, category, created_at')
                .in('id', fpIds);
              const fpMap = {};
              for (const f of fpRows || []) fpMap[f.id] = f;
              setMergeRequests(mrList.map(mr => ({
                ...mr,
                focusA: fpMap[mr.focus_a] || null,
                focusB: fpMap[mr.focus_b] || null,
                focusAName: fpMap[mr.focus_a]?.name || '?',
                focusBName: fpMap[mr.focus_b]?.name || '?',
              })));
            } else {
              setMergeRequests([]);
            }
          }
        } catch (e) {
          console.error('StudentDetailScreen load error:', e);
        }
        if (active) setLoading(false);
      }

      async function reload() {
        // Bust the cache for this student before refetching so the
        // realtime subscription's "things changed" signal actually pulls
        // fresh data instead of the cached snapshot.
        invalidateCache(`student:${studentId}:`);
        // A focus_points change can affect the activity timeline too
        // (a class's focusPoints array is derived from focus_points.class_input_id).
        // Re-fetch activity + readiness alongside so the "Last class with you"
        // recap card stays in sync with the focus-point list.
        const [fp, qsD, act, rd] = await Promise.all([
          getStudentFocusPoints(studentId),
          getStudentQuestions(studentId),
          getStudentRecentActivity(studentId, 30),
          getLessonReadiness(studentId).catch(() => null),
        ]);
        if (active) {
          setFocusPoints(fp);
          setQuestions(qsD);
          setActivity(act);
          setReadiness(rd);
        }
      }

      async function setup() {
        await load();
        if (!active) return;
        channel = supabase
          .channel(`student-detail-${studentId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'coach_messages', filter: `student_id=eq.${studentId}` },
            () => active && reload()
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'focus_points', filter: `user_id=eq.${studentId}` },
            () => active && reload()
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'practice_logs', filter: `student_id=eq.${studentId}` },
            async () => {
              if (!active) return;
              invalidateCache(`student:${studentId}:`);
              const [act, lcd, m, rd] = await Promise.all([
                getStudentRecentActivity(studentId, 30),
                getStudentLastClassDate(studentId),
                getAllStudentMetrics(studentId, coachCategoryRef.current),
                getLessonReadiness(studentId).catch(() => null),
              ]);
              if (active) {
                setActivity(act);
                setLastClassDate(rd?.lastClassDate ?? lcd);
                setReadiness(rd);
                setMetrics(m);
              }
            }
          )
          .subscribe();
      }

      setup();
      return () => {
        active = false;
        if (channel) supabase.removeChannel(channel);
      };
    }, [studentId])
  );

  // ── Derived data ──────────────────────────────────────────────────────────
  const displayName = profile?.name || studentName || 'Student';
  const avatarLetter = initialOf(displayName);

  // Floor for "since last class" filtering. If the student has never had
  // a class, fall back to the last 14 days.
  const sinceMs = useMemo(() => {
    if (lastClassDate) return new Date(lastClassDate).getTime();
    return Date.now() - 14 * 86400000;
  }, [lastClassDate]);

  const stats = useMemo(() => {
    const nowMs = Date.now();
    const trainingEvents = activity.filter((e) => e.type === 'training');
    const sessionsSince = trainingEvents.filter(
      (e) => new Date(e.date).getTime() >= sinceMs
    );
    const totalMinSince = sessionsSince.reduce(
      (acc, e) => acc + (e.durationMin || 0),
      0
    );

    // Trend: compare count since last class vs the SAME-length window before it
    const windowMs = Math.max(1, nowMs - sinceMs);
    const priorFloor = sinceMs - windowMs;
    const sessionsPrior = trainingEvents.filter((e) => {
      const ts = new Date(e.date).getTime();
      return ts >= priorFloor && ts < sinceMs;
    }).length;
    const trend =
      sessionsPrior === 0
        ? sessionsSince.length > 0
          ? 100
          : 0
        : Math.round(
            ((sessionsSince.length - sessionsPrior) / sessionsPrior) * 100
          );

    const focusesPracticed = focusPoints.filter((f) => f.weekCount > 0).length;
    const totalFocuses = focusPoints.length;
    const struggling = focusPoints.filter((f) => f.weekCount === 0);
    const topFocus = focusPoints.slice().sort((a, b) => b.weekCount - a.weekCount)[0];

    // Engagement: a sensible target = 3 sessions per week-equivalent of the window
    const windowDays = windowMs / 86400000;
    const expected = Math.max(1, (windowDays / 7) * 3);
    const engagement = Math.min(
      100,
      Math.round((sessionsSince.length / expected) * 100)
    );
    const practice = totalFocuses > 0
      ? Math.round((focusesPracticed / totalFocuses) * 100)
      : 0;
    const freshDays = trainingEvents[0]
      ? (nowMs - new Date(trainingEvents[0].date).getTime()) / 86400000
      : 999;
    const motivation = Math.max(
      0,
      Math.min(100, Math.round(100 - freshDays * 10 + (questions.length > 0 ? 10 : 0)))
    );

    return {
      sessionsSince: sessionsSince.length,
      totalMinSince,
      trend,
      focusesPracticed,
      totalFocuses,
      struggling,
      topFocus,
      engagement,
      practice,
      motivation,
    };
  }, [activity, focusPoints, questions, sinceMs]);

  const churnLow = stats.engagement >= 60 && stats.motivation >= 50;
  const lastSeen = useMemo(() => {
    const t = activity.find((e) => e.type === 'training');
    return t ? relativeDateShort(t.date) : 'A while ago';
  }, [activity]);

  // ── Actions (derived) ────────────────────────────────────────────────────
  const actions = useMemo(() => {
    const list = [];
    pendingFPs.forEach((fp) => {
      list.push({ kind: 'review', id: `review_${fp.id}`, focus: fp });
    });
    questions.forEach((q) => {
      list.push({ kind: 'question', id: `q_${q.id}`, question: q });
    });
    mergeRequests.forEach((mr) => {
      list.push({ kind: 'merge', id: `merge_${mr.id}`, merge: mr });
    });
    nameMatches.forEach((nm) => {
      list.push({ kind: 'name', id: `name_${nm.id}`, notif: nm });
    });
    return list;
  }, [pendingFPs, questions, mergeRequests, nameMatches]);

  const hasUrgent = questions.length > 0;
  const badgeColor = hasUrgent ? C.red : C.orange;

  // ── Timeline events (mapped to UI shape) ─────────────────────────────────
  // Only show events from (and including) the last class with this coach.
  // Training events display the practised focus point name when known.
  const timelineEvents = useMemo(() => {
    const events = [];
    activity.forEach((ev, i) => {
      if (ev.type === 'training') {
        events.push({
          id: `t_${ev.id || i}`,
          date: ev.date,
          type: 'training',
          title: ev.focusName
            ? `Practiced "${ev.focusName}"`
            : 'Practice session',
          detail: ev.durationMin ? `${ev.durationMin} min` : null,
        });
      }
    });
    questions.forEach((q) => {
      events.push({
        id: `q_${q.id}`,
        date: q.created_at,
        type: 'question',
        title: 'Question asked',
        detail: `"${q.message}"`,
      });
    });
    // Filter to "since last class" (inclusive) and sort newest first
    const filtered = events.filter(
      (e) => new Date(e.date).getTime() >= sinceMs
    );
    return filtered
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 20);
  }, [activity, questions, sinceMs]);

  // ── Last private with this coach (for recap card in Activity tab) ───────
  // Matches the readiness reference: most recent PRIVATE class with at least
  // one active focus point (excluding deleted / past / is_other). Falls back
  // to the older private when the most recent one has no usable focus points
  // (e.g. transcript failed and all focus points were marked past/deleted).
  const lastCoachClass = useMemo(() => {
    const cls = activity.find(
      (ev) =>
        ev.type === 'class' &&
        ev.withCurrentCoach &&
        ev.classSummary &&
        ev.lessonType !== 'group' &&
        (ev.focusPoints?.length ?? 0) > 0,
    );
    if (!cls) return null;

    // Count practice sessions per focus point since this class
    const classDate = new Date(cls.date).getTime();
    const trainCounts = {};
    for (const ev of activity) {
      if (ev.type === 'training' && ev.focusPointId && new Date(ev.date).getTime() > classDate) {
        trainCounts[ev.focusPointId] = (trainCounts[ev.focusPointId] || 0) + 1;
      }
    }

    return {
      ...cls,
      focusPoints: (cls.focusPoints || []).slice(0, 3).map(fp => ({
        ...fp,
        trainedCount: trainCounts[fp.id] || 0,
      })),
    };
  }, [activity]);

  // ── Recommendations (Information tab) ────────────────────────────────────
  const recommendations = useMemo(() => {
    const recs = [];
    if (questions[0]) {
      recs.push(`Answer ${questions[0].studentName || 'their'} question: "${questions[0].message.slice(0, 60)}${questions[0].message.length > 60 ? '…' : ''}"`);
    }
    if (stats.struggling[0]) {
      recs.push(`Re-approach "${stats.struggling[0].name}" with a new drill — current approach isn't landing.`);
    }
    if (stats.topFocus && stats.topFocus.weekCount >= 2) {
      recs.push(`Validate their progress on "${stats.topFocus.name}" — reinforce the confidence.`);
    }
    if (stats.sessionsSince === 0) {
      recs.push('Encourage a practice check-in — no sessions since the last private lesson.');
    }
    if (recs.length === 0) {
      recs.push('All clear — keep the momentum going.');
    }
    return recs.slice(0, 3);
  }, [questions, stats]);

  // Briefing sentence (Information tab)
  const briefingParts = useMemo(() => {
    const parts = [];
    const sinceLabel = lastClassDate ? 'since your last private lesson' : 'in the last 14 days';
    if (stats.sessionsSince > 0) {
      parts.push({ bold: true, text: `${stats.sessionsSince} session${stats.sessionsSince > 1 ? 's' : ''} ${sinceLabel}` });
    } else {
      parts.push({ color: C.red, bold: true, text: `No sessions ${sinceLabel}` });
    }
    if (stats.struggling.length > 0) {
      parts.push({ text: '. ' });
      parts.push({ color: C.red, bold: true, text: `"${stats.struggling[0].name}"` });
      parts.push({ text: ' remains stuck — no practice logged.' });
    } else if (stats.topFocus && stats.topFocus.weekCount >= 2) {
      parts.push({ text: '. Strongest on ' });
      parts.push({ color: C.green, bold: true, text: `"${stats.topFocus.name}"` });
      parts.push({ text: `.` });
    } else {
      parts.push({ text: '.' });
    }
    if (questions.length > 0) {
      parts.push({ text: ' ' });
      parts.push({ color: C.orange, bold: true, text: `${questions.length} pending question${questions.length > 1 ? 's' : ''}` });
      parts.push({ text: ' waiting for a reply.' });
    }
    return parts;
  }, [stats, questions]);

  // ── Collapsing hero animation ─────────────────────────────────────────────
  // Two discrete states only: open (0) → closed (1). Crossing the scroll
  // threshold downward triggers a snap-close; returning to scrollY<=0 snaps
  // back open. No intermediate interpolation during the scroll itself.
  const HERO_FULL = 256;
  const HERO_COLLAPSED = 120;
  const COLLAPSE_THRESHOLD = 24; // pixels before the snap-close fires
  const TABS_H = 46;

  // One vertical scroll ref per tab (their scroll positions are independent)
  // plus the horizontal pager ref and the x offset driving the underline.
  const scrollRefInfo = useRef(null);
  const scrollRefActivity = useRef(null);
  const scrollRefActions = useRef(null);
  const pagerRef = useRef(null);
  const { width: screenWidth } = useWindowDimensions();
  const horizontalScrollX = useRef(new Animated.Value(0)).current;
  const collapsedAnim = useRef(new Animated.Value(0)).current; // 0 open, 1 closed
  const collapsedState = useRef(false); // latched boolean for threshold logic
  // When collapsed, the card stays closed even after the user scrolls all the
  // way back to y=0. It only re-expands on the NEXT scroll gesture started at
  // the top — this ref flags that we're "waiting at the top" for that gesture.
  const armedToReopen = useRef(false);
  // Flag set on drag-begin while armed-at-top; resolved on the first scroll
  // tick that tells us the drag direction. Prevents an upward scroll from
  // accidentally triggering a reopen.
  const pendingReopenCheck = useRef(false);

  function animateTo(openClosed) {
    // openClosed: 0 = open, 1 = closed
    // Only drive `collapsedAnim` here — the spacer, heroHeight, tabs translate
    // and gauge opacity are all interpolations of this single value, so they
    // stay perfectly in sync. Adding a parallel `scrollTo(animated:true)`
    // caused a sub-frame mismatch (native scroll animation duration ≠ 260ms),
    // which showed up as a tiny jump at the end of the transition.
    Animated.timing(collapsedAnim, {
      toValue: openClosed,
      duration: 260,
      useNativeDriver: false,
    }).start();
  }


  function handleScroll(e) {
    const y = e.nativeEvent.contentOffset.y;

    // Resolve a pending reopen check: we're armed-at-top and a drag just
    // started; use the first non-zero scroll tick to figure out direction.
    if (pendingReopenCheck.current) {
      if (y > 0) {
        // User scrolled UP into the content — cancel the reopen.
        pendingReopenCheck.current = false;
      } else if (y < 0) {
        // iOS bounce: user scrolled DOWN past the top → commit reopen.
        pendingReopenCheck.current = false;
        collapsedState.current = false;
        armedToReopen.current = false;
        animateTo(0);
      }
      // y === 0: wait for the next tick.
    }

    if (!collapsedState.current && y > COLLAPSE_THRESHOLD) {
      collapsedState.current = true;
      armedToReopen.current = false;
      pendingReopenCheck.current = false;
      animateTo(1);
    } else if (collapsedState.current && y <= 0) {
      // Reached the top while closed — do NOT auto-reopen. Arm the next
      // gesture to handle the re-expand.
      armedToReopen.current = true;
    }
  }

  // Fires at the start of a new drag. If we're sitting closed-at-top, arm a
  // direction check — we'll commit (or cancel) the reopen in handleScroll.
  function handleScrollBeginDrag(e) {
    const y = e.nativeEvent.contentOffset.y;
    if (collapsedState.current && armedToReopen.current && y <= 0) {
      pendingReopenCheck.current = true;
    }
  }

  // Android fallback: if scrollY never changed during the drag (no bounce),
  // the first-tick direction check can't fire. On release, if we still had a
  // pending reopen, commit it — the user definitely made a down-gesture at
  // the top since scrollY never went up.
  function handleScrollEndDrag(e) {
    if (pendingReopenCheck.current) {
      pendingReopenCheck.current = false;
      const y = e.nativeEvent.contentOffset.y;
      if (collapsedState.current && armedToReopen.current && y <= 0) {
        collapsedState.current = false;
        armedToReopen.current = false;
        animateTo(0);
      }
    }
  }

  const heroHeight = collapsedAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [HERO_FULL, HERO_COLLAPSED],
  });
  const gaugesOpacity = collapsedAnim.interpolate({
    inputRange: [0, 0.6],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  // Nudge the heroTop row down when collapsing so the avatar visually
  // centres in the smaller card (the gauges+footer below stay in layout
  // but are invisible/clipped, which otherwise leaves extra space at the
  // bottom).
  const heroTopTranslate = collapsedAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 9],
  });

  const tabs = ['information', 'activity', 'actions'];
  const tabIndex = tabs.indexOf(activeTab);
  const actionCount = actions.length;

  // First mount: jump without animation (needed on Android — contentOffset
  // only honours the initial x on iOS). Subsequent changes are driven by
  // `smoothScrollToTab` below (manual frame-by-frame animation so both the
  // underline AND the page glide together with an explicit easing curve).
  const pagerFirstMount = useRef(true);
  useEffect(() => {
    if (!screenWidth) return;
    if (pagerFirstMount.current) {
      const targetX = tabIndex * screenWidth;
      horizontalScrollX.setValue(targetX);
      pagerRef.current?.scrollTo({ x: targetX, animated: false });
      pagerFirstMount.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenWidth]);

  // Single animated value that drives both the pager scroll position AND
  // the underline. We listen to it frame-by-frame and call scrollTo with
  // `animated:false` so each frame is a snapshot — this guarantees the page
  // slides in lock-step with the trait, regardless of whether ScrollView's
  // own animated scrollTo behaves consistently across RN versions.
  const tapAnim = useRef(new Animated.Value(0)).current;
  const tapAnimListenerRef = useRef(null);
  const smoothScrollToTab = useCallback((nextTab) => {
    const nextIndex = tabs.indexOf(nextTab);
    if (nextIndex < 0 || !screenWidth) {
      setActiveTab(nextTab);
      return;
    }
    const currentIndex = tabs.indexOf(activeTab);
    const fromX = currentIndex * screenWidth;
    const toX = nextIndex * screenWidth;
    setActiveTab(nextTab);
    if (fromX === toX) return;
    if (tapAnimListenerRef.current != null) {
      tapAnim.removeListener(tapAnimListenerRef.current);
    }
    tapAnim.setValue(fromX);
    tapAnimListenerRef.current = tapAnim.addListener(({ value }) => {
      pagerRef.current?.scrollTo({ x: value, animated: false });
      horizontalScrollX.setValue(value);
    });
    Animated.timing(tapAnim, {
      toValue: toX,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      if (tapAnimListenerRef.current != null) {
        tapAnim.removeListener(tapAnimListenerRef.current);
        tapAnimListenerRef.current = null;
      }
    });
  }, [activeTab, screenWidth, tabs, tapAnim, horizontalScrollX]);

  if (loading) {
    return <StudentDetailSkeleton onBack={() => navigation.goBack()} />;
  }

  // Each tab's vertical ScrollView has a tight paddingTop (enough for the
  // collapsed hero + tabs) plus an animated spacer that shrinks from
  // (HERO_FULL - HERO_COLLAPSED) → 0 as the hero collapses. That keeps the
  // first content block glued to the bottom of the hero+tabs strip at both
  // sizes, for all three tab pages.
  const heroSpacerHeight = collapsedAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [HERO_FULL - HERO_COLLAPSED, 0],
  });

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Fixed nav header (always visible, never scrolls) ── */}
      <View style={styles.navHeader}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </Pressable>
      </View>

      <View style={{ flex: 1 }}>
        {/* ── Horizontal pager: one vertical ScrollView per tab, finger-synced
            with the underline below the tab labels. ── */}
        <Animated.ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          contentOffset={{ x: tabIndex * screenWidth, y: 0 }}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: horizontalScrollX } } }],
            { useNativeDriver: false }
          )}
          onMomentumScrollEnd={(e) => {
            const page = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, screenWidth));
            const next = tabs[page];
            if (next && next !== activeTab) setActiveTab(next);
          }}
        >

        {/* ══════════════════════════════════════════════ */}
        {/* ── INFORMATION TAB ── */}
        {/* ══════════════════════════════════════════════ */}
        <View style={{ width: screenWidth, flex: 1 }}>
          <ScrollView
            ref={scrollRefInfo}
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingTop: 16 + HERO_COLLAPSED + TABS_H,
              paddingBottom: 40,
            }}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={handleScroll}
            onScrollBeginDrag={handleScrollBeginDrag}
            onScrollEndDrag={handleScrollEndDrag}
          >
          <Animated.View style={{ height: heroSpacerHeight }} pointerEvents="none" />
          <View style={styles.tabContent}>
            {/* Lesson readiness — mirrors the student's profile card. Same
                 data source, same dark-brown styling so the coach sees
                 exactly what the student sees. */}
            <Card style={styles.readyCardOverride}>
              <Text style={styles.readyEyebrow}>Student's readiness for next class</Text>
              <View style={styles.readyHeaderRow}>
                <ReadinessRing percent={readiness?.percent ?? 0} />
                <View style={{ flex: 1, minWidth: 0, marginLeft: 14 }}>
                  <Text style={styles.readyTitle}>
                    {!readiness
                      ? 'No private logged yet.'
                      : readiness.percent >= 100
                        ? 'Ready for next private.'
                        : readiness.percent >= 50
                          ? 'Almost ready.'
                          : 'Building up.'}
                  </Text>
                  <Text style={styles.readySubtitle}>
                    {!readiness
                      ? 'Focuses will appear here once a private is processed.'
                      : readiness.minutesRemaining === 0
                        ? `All ${readiness.focuses.length} focus points trained.`
                        : `${readiness.focuses.length} focus point${readiness.focuses.length > 1 ? 's' : ''} · ~${readiness.minutesRemaining} min to go`}
                  </Text>
                </View>
              </View>
              {(readiness?.focuses?.length || 0) > 0 && (
                <>
                  <View style={styles.readyDivider} />
                  {readiness.focuses.map((f, i, arr) => (
                    <FocusReadyRow key={f.focusPointId} row={f} isLast={i === arr.length - 1} />
                  ))}
                </>
              )}
            </Card>

            {/* Working on */}
            {focusPoints.length > 0 && (
              <View style={{ marginTop: 16 }}>
                <Text style={styles.sectionLabel}>ACTIVE FOCUS</Text>
                {focusPoints.slice(0, 5).map((f) => (
                  <TouchableOpacity
                    key={f.id}
                    style={styles.focusRow}
                    activeOpacity={0.8}
                    onPress={() => setEditingFocus(f)}
                  >
                    <View style={styles.focusDot} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.focusName}>{f.name}</Text>
                      {!!f.subtitle && (
                        <Text style={styles.focusSub} numberOfLines={1}>
                          {f.subtitle}
                        </Text>
                      )}
                    </View>
                    <View
                      style={[
                        styles.focusCount,
                        f.weekCount === 0 && styles.focusCountStuck,
                      ]}
                    >
                      <Text
                        style={[
                          styles.focusCountText,
                          f.weekCount === 0 && styles.focusCountTextStuck,
                        ]}
                      >
                        {f.weekCount}×
                      </Text>
                    </View>
                    <View style={styles.focusEditBtn}>
                      <Ionicons name="pencil" size={13} color={C.muted} />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
          </ScrollView>
        </View>

        {/* ══════════════════════════════════════════════ */}
        {/* ── ACTIVITY TAB ── */}
        {/* ══════════════════════════════════════════════ */}
        <View style={{ width: screenWidth, flex: 1 }}>
          <ScrollView
            ref={scrollRefActivity}
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingTop: 16 + HERO_COLLAPSED + TABS_H,
              paddingBottom: 40,
            }}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={handleScroll}
            onScrollBeginDrag={handleScrollBeginDrag}
            onScrollEndDrag={handleScrollEndDrag}
          >
          <Animated.View style={{ height: heroSpacerHeight }} pointerEvents="none" />
          <View style={styles.activityHeader}>
            <View style={{ flexShrink: 1, paddingRight: 10 }}>
              <Text style={styles.weekTitle}>
                {stats.sessionsSince} session{stats.sessionsSince !== 1 ? 's' : ''}
                {stats.totalMinSince > 0 ? ` · ${stats.totalMinSince} min` : ''}
              </Text>
              <Text style={styles.weekSub}>
                Since last private lesson{lastClassDate ? ` · ${relativeDateShort(lastClassDate)}` : ''}
              </Text>
            </View>
          </View>
          <View style={styles.tabContent}>
            <View style={styles.tlContainer}>
              <View style={styles.tlSpine} />
              {timelineEvents.length === 0 ? (
                <Text style={styles.emptyTl}>No activity yet.</Text>
              ) : (
                timelineEvents.map((item) => <TimelineRow key={item.id} item={item} />)
              )}
            </View>

            {/* ── Last class recap card ── */}
            {lastCoachClass && (
              <View style={styles.classRecap}>
                <View style={styles.classRecapHeader}>
                  <View style={styles.classRecapBadge}>
                    <Text style={styles.classRecapBadgeText}>LAST CLASS WITH YOU</Text>
                  </View>
                  <Text style={styles.classRecapDate}>
                    {relativeDateShort(lastCoachClass.date)}
                  </Text>
                </View>
                <Text style={styles.classRecapTitle}>
                  {lastCoachClass.title || lastCoachClass.dance || 'Private lesson'}
                </Text>
                {!!lastCoachClass.classSummary && (
                  <Text style={styles.classRecapSummary}>
                    {lastCoachClass.classSummary}
                  </Text>
                )}
                {lastCoachClass.focusPoints && lastCoachClass.focusPoints.length > 0 && (
                  <View style={styles.classRecapFPs}>
                    <Text style={styles.classRecapFPLabel}>Focus points</Text>
                    {lastCoachClass.focusPoints.map((fp, i) => (
                      <View key={fp.id || i} style={styles.classRecapFPRow}>
                        <View style={[styles.classRecapFPDot, { backgroundColor: fp.trainedCount > 0 ? C.green : C.red }]} />
                        <Text style={styles.classRecapFPName} numberOfLines={1}>{fp.name}</Text>
                        <View style={[styles.classRecapFPCount, {
                          backgroundColor: fp.trainedCount > 0 ? 'rgba(74,175,82,0.08)' : 'rgba(212,69,69,0.08)',
                        }]}>
                          <Text style={[styles.classRecapFPCountText, {
                            color: fp.trainedCount > 0 ? C.green : C.red,
                          }]}>{fp.trainedCount}x</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>
          </ScrollView>
        </View>

        {/* ══════════════════════════════════════════════ */}
        {/* ── ACTIONS TAB ── */}
        {/* ══════════════════════════════════════════════ */}
        <View style={{ width: screenWidth, flex: 1 }}>
          <ScrollView
            ref={scrollRefActions}
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingTop: 16 + HERO_COLLAPSED + TABS_H,
              paddingBottom: 40,
            }}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={handleScroll}
            onScrollBeginDrag={handleScrollBeginDrag}
            onScrollEndDrag={handleScrollEndDrag}
          >
          <Animated.View style={{ height: heroSpacerHeight }} pointerEvents="none" />
          <View style={styles.tabContent}>
            {actions.length === 0 ? (
              <View style={styles.actionsEmpty}>
                <Ionicons name="checkmark-circle" size={40} color={C.green} />
                <Text style={styles.actionsEmptyTitle}>All clear</Text>
                <Text style={styles.actionsEmptyText}>
                  No open actions for {displayName.split(' ')[0]} right now.
                </Text>
              </View>
            ) : (
              <>
                {/* 1. Focus points pending validation after a class */}
                {pendingFPs.length > 0 && (
                  <>
                    <Text style={styles.actionsSectionLabel}>
                      FOCUS POINTS TO REVIEW
                    </Text>
                    {pendingFPs.map((fp) => {
                      const isExpanded = expandedPendingFpId === fp.id;
                      return (
                        <PendingFocusCard
                          key={`review_${fp.id}`}
                          fp={fp}
                          isExpanded={isExpanded}
                          onToggle={() => {
                            LayoutAnimation.configureNext({
                              duration: 220,
                              update: { type: LayoutAnimation.Types.easeInEaseOut },
                              create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
                              delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
                            });
                            setExpandedPendingFpId(isExpanded ? null : fp.id);
                          }}
                          studentName={null}
                          onApprove={handleApprovePendingFp}
                          onEdit={setEditingPendingFp}
                          onDelete={handleRejectPendingFp}
                        />
                      );
                    })}
                  </>
                )}

                {/* 2. Pending student questions */}
                {questions.length > 0 && (
                  <>
                    <Text
                      style={[
                        styles.actionsSectionLabel,
                        pendingFPs.length > 0 && { marginTop: 16 },
                      ]}
                    >
                      QUESTIONS TO ANSWER
                    </Text>
                    {questions.map((q) => (
                      <QuestionCard
                        key={`q_${q.id}`}
                        question={q}
                        onReply={() => {
                          setActiveQuestion(q);
                          setQuestionSheetVisible(true);
                        }}
                        onDismiss={async () => {
                          await dismissQuestion(q.id);
                          setQuestions((prev) => prev.filter((x) => x.id !== q.id));
                        }}
                      />
                    ))}
                  </>
                )}

                {/* 3. Merge requests */}
                {mergeRequests.length > 0 && (
                  <>
                    <Text style={[styles.actionsSectionLabel, { marginTop: 16 }]}>
                      MERGE SUGGESTIONS
                    </Text>
                    {mergeRequests.map((mr) => (
                      <MergeCompareCard
                        key={`merge_${mr.id}`}
                        mr={mr}
                        studentName={null}
                        onMerge={async () => {
                          await supabase.from('focus_points').update({ is_deleted: true, status: 'past' }).eq('id', mr.focus_b);
                          await supabase.from('merge_requests').update({ status: 'merged', resolved_at: new Date().toISOString(), resolved_by: 'coach' }).eq('id', mr.id);
                          setMergeRequests(prev => prev.filter(m => m.id !== mr.id));
                        }}
                        onKeepBoth={async () => {
                          // Match ActionNeededScreen behavior: send the newer
                          // FP into pending_coach so it goes through normal
                          // review instead of vanishing silently.
                          const a = mr.focusA;
                          const b = mr.focusB;
                          const olderFirst = a && b && new Date(a.created_at) <= new Date(b.created_at);
                          const incoming = olderFirst ? b : a;
                          if (incoming) {
                            const deadline = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
                            await supabase
                              .from('focus_points')
                              .update({ status: 'pending_coach', coach_review_deadline: deadline })
                              .eq('id', incoming.id);
                          }
                          await supabase.from('merge_requests').update({ status: 'rejected', resolved_at: new Date().toISOString(), resolved_by: 'coach' }).eq('id', mr.id);
                          setMergeRequests(prev => prev.filter(m => m.id !== mr.id));
                        }}
                      />
                    ))}
                  </>
                )}

                {/* 4. Name matching */}
                {nameMatches.length > 0 && (
                  <>
                    <Text style={[styles.actionsSectionLabel, { marginTop: 16 }]}>
                      NAME MATCHING
                    </Text>
                    {nameMatches.map((notif) => (
                      <NameMatchCard
                        key={`name_${notif.id}`}
                        notif={notif}
                        onConfirm={async () => {
                          const { focus_point_ids } = notif.data || {};
                          if (focus_point_ids?.length > 0) {
                            await supabase.from('focus_points').update({ status: 'pending_coach' }).in('id', focus_point_ids);
                          }
                          await deleteNotification(notif.id);
                          setNameMatches(prev => prev.filter(n => n.id !== notif.id));
                        }}
                        onReject={async () => {
                          const { focus_point_ids } = notif.data || {};
                          if (focus_point_ids?.length > 0) {
                            await supabase.from('focus_points').update({ user_id: null, status: 'active' }).in('id', focus_point_ids);
                          }
                          await deleteNotification(notif.id);
                          setNameMatches(prev => prev.filter(n => n.id !== notif.id));
                        }}
                      />
                    ))}
                  </>
                )}
              </>
            )}
          </View>
          </ScrollView>
        </View>

        </Animated.ScrollView>

        {/* White backdrop so scrolling content stays hidden behind the floating hero card */}
        <Animated.View
          pointerEvents="none"
          style={[styles.heroBackdrop, { height: Animated.add(heroHeight, 16) }]}
        />

        {/* ── Sticky overlay: animated hero + tabs + (section head) ── */}
        <Animated.View
          pointerEvents="box-none"
          style={[styles.stickyOverlay, { height: heroHeight }]}
        >
          <View style={{ flex: 1, overflow: 'hidden' }}>
            <Animated.View
              style={[styles.heroTop, { transform: [{ translateY: heroTopTranslate }] }]}
            >
              <View style={styles.avatarWrap}>
                <ActivityRing
                  progress={readiness?.percent ?? 0}
                  size={62}
                  strokeWidth={3.5}
                  color={
                    (readiness?.percent ?? 0) >= 100 ? C.green
                      : (readiness?.percent ?? 0) >= 50 ? C.orange
                        : '#E8B530'
                  }
                />
                <View style={styles.avatarBadge}>
                  {profile?.photo_url ? (
                    <Image source={{ uri: profile.photo_url }} style={styles.avatarImg} />
                  ) : (
                    <Text style={styles.avatarText}>{avatarLetter}</Text>
                  )}
                </View>
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={styles.heroName} numberOfLines={1}>
                  {displayName}
                </Text>
                <Text style={styles.heroMeta} numberOfLines={1}>
                  Trained{' '}
                  <Text
                    style={[
                      styles.heroMetaCount,
                      {
                        color:
                          stats.sessionsSince >= 3
                            ? C.green
                            : stats.sessionsSince >= 1
                              ? C.orange
                              : C.red,
                      },
                    ]}
                  >
                    {stats.sessionsSince}x
                  </Text>
                  {' time'}
                  {stats.sessionsSince === 1 ? '' : 's'}
                  {' since last private lesson'}
                </Text>
              </View>
            </Animated.View>

            <Animated.View style={{ opacity: gaugesOpacity }} pointerEvents="box-none">
              {/* Readiness summary — replaces the old Progression/Retention/
                   Global gauges. Tap → jumps to the Information tab where
                   the full readiness card (focus rows + targets) lives. */}
              <TouchableOpacity
                style={styles.heroReadyBlock}
                activeOpacity={0.85}
                onPress={() => {
                  smoothScrollToTab('information');
                  // Make sure the readiness card is at the top of the Info tab.
                  scrollRefInfo.current?.scrollTo?.({ y: 0, animated: true });
                }}
              >
                <Text style={styles.heroReadyPct}>
                  {readiness?.percent ?? 0}<Text style={styles.heroReadyPctSm}>%</Text>
                </Text>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  {(() => {
                    const p = readiness?.percent ?? 0;
                    const statusColor = p >= 100 ? C.green : p >= 50 ? C.orange : C.red;
                    const statusText = !readiness
                      ? 'No private logged yet'
                      : p >= 100
                        ? 'Ready for next private'
                        : p >= 50
                          ? 'Almost ready for next private'
                          : 'Not ready for next private';
                    return (
                      <Text style={[styles.heroReadyLabel, { color: statusColor }]}>
                        {statusText}
                      </Text>
                    );
                  })()}
                  <Text style={styles.heroReadyDetail}>
                    {!readiness
                      ? 'Log a private to start tracking'
                      : readiness.percent >= 100
                        ? `All ${readiness.focuses.length} focus points trained`
                        : `${readiness.focuses.length} focus point${readiness.focuses.length > 1 ? 's' : ''} · ~${readiness.minutesRemaining} min to go`}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color="rgba(255,255,255,0.4)"
                  style={{ marginLeft: 6 }}
                />
              </TouchableOpacity>

              <View style={styles.heroFooter}>
                <View style={styles.heroFooterLeft}>
                  <View
                    style={[
                      styles.heroFooterDot,
                      { backgroundColor: churnLow ? C.green : C.orange },
                    ]}
                  />
                  <Text style={styles.heroFooterBold}>
                    {churnLow ? 'Low churn risk' : 'Watch engagement'}
                  </Text>
                </View>
                <Text style={styles.heroFooterMuted}>Seen {lastSeen}</Text>
              </View>
            </Animated.View>
          </View>
        </Animated.View>

        {/* Pinned tab switcher below the (collapsing) hero */}
        <Animated.View
          style={[
            styles.stickyTabs,
            { transform: [{ translateY: heroHeight }] },
          ]}
        >
          <View style={styles.tabsRow}>
            {tabs.map((tab) => {
              const isActive = activeTab === tab;
              const isActions = tab === 'actions';
              const label = tab === 'information' ? 'Information' : tab === 'activity' ? 'Activity' : 'Actions';
              const activeColor = isActions && actionCount > 0 ? badgeColor : C.text;
              const color = isActive ? activeColor : C.muted;
              return (
                <TouchableOpacity
                  key={tab}
                  style={styles.tabBtn}
                  onPress={() => smoothScrollToTab(tab)}
                  activeOpacity={0.7}
                >
                  <View style={styles.tabLabelRow}>
                    <Text
                      style={[
                        styles.tabLabel,
                        { color, fontFamily: isActive ? Fonts.jakartaBold : Fonts.jakartaMedium },
                      ]}
                    >
                      {label}
                    </Text>
                    {isActions && actionCount > 0 && (
                      <View style={[styles.tabBadge, { backgroundColor: badgeColor }]}>
                        <Text style={styles.tabBadgeText}>{actionCount}</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.tabSlidingUnderline,
                {
                  backgroundColor:
                    activeTab === 'actions' && actionCount > 0 ? badgeColor : C.dark,
                  left: horizontalScrollX.interpolate({
                    inputRange: [0, Math.max(1, screenWidth), Math.max(2, 2 * screenWidth)],
                    outputRange: ['5%', '38.333%', '71.667%'],
                    extrapolate: 'clamp',
                  }),
                },
              ]}
            />
          </View>
        </Animated.View>

      </View>

      <QuestionSheet
        visible={questionSheetVisible}
        question={activeQuestion}
        onClose={() => setQuestionSheetVisible(false)}
        onDone={() => {
          setQuestionSheetVisible(false);
          setActiveQuestion(null);
          setQuestions((prev) => prev.filter((x) => x.id !== activeQuestion?.id));
          refreshCoachData();
        }}
      />

      <Modal
        visible={!!editingFocus}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingFocus(null)}
      >
        {editingFocus && (
          <FocusPointEditSheet
            fp={editingFocus}
            saveLabel="Save"
            onSave={async (fpId, updates) => {
              await updateFocusPoint(fpId, updates);
              setFocusPoints((prev) =>
                prev.map((f) => (f.id === fpId ? { ...f, ...updates } : f))
              );
              setEditingFocus(null);
            }}
            onClose={() => setEditingFocus(null)}
          />
        )}
      </Modal>

      <Modal
        visible={!!editingPendingFp}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingPendingFp(null)}
      >
        {editingPendingFp && (
          <FocusPointEditSheet
            fp={editingPendingFp}
            saveLabel="Save & Approve"
            onSave={handleSavePendingFpEdit}
            onClose={() => setEditingPendingFp(null)}
          />
        )}
      </Modal>

      <Modal
        visible={!!rejectingPendingFp}
        transparent
        animationType="slide"
        onRequestClose={() => setRejectingPendingFp(null)}
      >
        {rejectingPendingFp && (
          <RejectFocusSheet
            fp={rejectingPendingFp}
            onConfirm={handleConfirmRejectPendingFp}
            onClose={() => setRejectingPendingFp(null)}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Header
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingTop: 8,
    paddingBottom: 2,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 2,
  },

  // Hero
  hero: {
    marginHorizontal: 24,
    marginTop: 16,
    backgroundColor: C.dark,
    borderRadius: 22,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 6,
    borderWidth: 1,
    borderColor: 'rgba(232,168,56,0.18)',
  },
  // ── Sticky collapsing overlay (new) ──
  stickyBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: C.bg,
  },
  heroBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: C.bg,
    zIndex: 1,
  },
  stickyOverlay: {
    position: 'absolute',
    top: 16,
    left: 24,
    right: 24,
    zIndex: 2,
    backgroundColor: C.dark,
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(232,168,56,0.18)',
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 3,
  },
  stickyTabs: {
    position: 'absolute',
    top: 16, // then translated by heroHeight
    left: 0,
    right: 0,
    height: 46,
    backgroundColor: C.bg,
    paddingHorizontal: 24,
    zIndex: 2,
    overflow: 'visible',
  },
  // In-flow header for the Activity tab — sits at the top of the page's
  // vertical ScrollView, so it slides horizontally with the rest of the tab
  // content instead of floating above the pager.
  activityHeader: {
    height: 76,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: C.bg,
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 6,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center' },
  avatarWrap: {
    width: 62,
    height: 62,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBadge: {
    position: 'absolute',
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: C.orange,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: 46, height: 46 },
  avatarText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 19,
    color: C.white,
  },
  heroName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: C.white,
    letterSpacing: -0.6,
  },
  heroMeta: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 4,
  },
  heroMetaCount: {
    fontFamily: Fonts.jakartaExtraBold,
  },
  gaugeRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    marginTop: 20,
    paddingVertical: 4,
  },
  heroReadyBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    backgroundColor: 'rgba(232,181,48,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(232,181,48,0.32)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  heroReadyPct: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 36,
    color: '#fff',
    letterSpacing: -1.5,
    lineHeight: 38,
    includeFontPadding: false,
  },
  heroReadyPctSm: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: -0.4,
  },
  heroReadyLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13.5,
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  heroReadyDetail: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12,
    color: 'rgba(255,255,255,0.78)',
    letterSpacing: 0.1,
    lineHeight: 16,
  },
  heroFooter: {
    marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroFooterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  heroFooterDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  heroFooterBold: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: C.white,
    letterSpacing: -0.1,
  },
  heroFooterMuted: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    marginLeft: 10,
  },

  // Tab switcher
  tabSwitcher: { marginHorizontal: 24, marginTop: 22 },
  tabsRow: { flexDirection: 'row', position: 'relative' },
  tabLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabBtn: {
    flex: 1,
    paddingTop: 14,
    paddingBottom: 10.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  tabLabel: {
    fontSize: 13,
    letterSpacing: -0.1,
  },
  tabBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: C.white,
  },
  tabUnderlineTrack: {
    height: 1,
    backgroundColor: C.surface,
  },
  tabUnderline: {
    height: 2.5,
    width: '70%',
    borderRadius: 2,
    marginTop: 8,
  },
  tabSlidingUnderline: {
    position: 'absolute',
    bottom: 0,
    width: '23.333%',
    height: 2.5,
    borderRadius: 2,
  },

  // Tab content
  tabContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
  },

  // Card
  card: {
    backgroundColor: C.white,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: C.cardBorder,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 1,
  },

  // Briefing
  briefHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  briefIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: 'rgba(232,168,56,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  briefTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
    color: C.text,
    letterSpacing: -0.4,
  },
  briefingText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: C.sub,
    lineHeight: 21,
  },

  // Readiness card — dark brown, mirrors the student-profile card exactly.
  readyCardOverride: {
    backgroundColor: '#1F1810',
    borderWidth: 1,
    borderColor: 'rgba(240,194,74,0.28)',
    borderRadius: 20,
    paddingBottom: 6,
    overflow: 'hidden',
    shadowColor: '#0A0A0A',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 22,
    elevation: 8,
  },
  readyEyebrow: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: '#fff',
    letterSpacing: -0.1,
    marginBottom: 14,
  },
  readyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  readyPct: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: '#fff',
    letterSpacing: -0.6,
  },
  readyPctSm: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
  },
  readyTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14.5,
    color: '#fff',
    letterSpacing: -0.2,
    lineHeight: 19,
  },
  readySubtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 5,
    lineHeight: 16,
  },
  readyDivider: {
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.10)',
    marginHorizontal: -18,
  },
  readyFocusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  readyFocusRowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  readyCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyCheckPartial: {
    borderColor: '#E8B530',
    backgroundColor: 'rgba(232,181,48,0.18)',
  },
  readyFocusName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13.5,
    color: '#fff',
    letterSpacing: -0.05,
    lineHeight: 16,
  },
  readyFocusMeta: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 3,
  },
  readyFocusProgress: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#F6D27A',
    letterSpacing: -0.2,
  },
  readyFocusProgressOf: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 11,
    color: 'rgba(246,210,122,0.5)',
  },

  // Brief stats row
  briefStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceAlt,
    borderRadius: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  briefStat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  briefStatNum: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
    color: C.text,
    letterSpacing: -0.5,
  },
  briefStatLabel: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 10,
    color: C.muted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  briefStatDivider: {
    width: StyleSheet.hairlineWidth,
    height: 26,
    backgroundColor: C.cardBorder,
  },

  // Brief sections
  briefSection: {
    marginBottom: 14,
  },
  briefSectionLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: C.muted,
    letterSpacing: 1,
    marginBottom: 8,
  },
  briefPracticedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  briefPracticedText: {
    flex: 1,
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: C.text,
  },
  briefPracticedCount: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
    color: C.green,
  },
  briefQuestionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(232,168,56,0.06)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
  },
  briefQuestionText: {
    flex: 1,
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: C.text,
    lineHeight: 17,
    fontStyle: 'italic',
    marginTop: 1,
  },

  // Focus row edit icon
  focusEditBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: C.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },

  recBlock: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 14,
    padding: 14,
    marginTop: 16,
  },
  recLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: C.orange,
    letterSpacing: 1,
    marginBottom: 10,
  },
  recRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  recNum: {
    width: 20,
    height: 20,
    borderRadius: 7,
    backgroundColor: C.dark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recNumText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: C.white,
  },
  recText: {
    flex: 1,
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: C.text,
    lineHeight: 19,
  },

  // Focus rows (Info tab)
  sectionLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: C.muted,
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 4,
  },
  focusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.white,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: C.cardBorder,
    marginBottom: 8,
    gap: 12,
  },
  focusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.orange,
  },
  focusName: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: C.text,
  },
  focusSub: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: C.sub,
    marginTop: 2,
  },
  focusCount: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(74,175,82,0.1)',
  },
  focusCountStuck: { backgroundColor: 'rgba(212,69,69,0.1)' },
  focusCountText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
    color: C.green,
  },
  focusCountTextStuck: { color: C.red },

  // Activity tab
  weekHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 22,
  },
  weekTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 24,
    color: C.text,
    letterSpacing: -0.8,
  },
  weekSub: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: C.sub,
    marginTop: 2,
  },
  trendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  trendText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
  },
  tlContainer: {
    position: 'relative',
  },
  tlSpine: {
    position: 'absolute',
    left: 13,
    top: 6,
    bottom: 6,
    width: 1.5,
    backgroundColor: C.surface,
    borderRadius: 1,
  },
  tlRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
  },
  tlCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tlCard: {
    flex: 1,
    padding: 12,
  },
  tlHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tlDate: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 10,
    color: C.muted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  tlDoneRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tlDoneText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 10,
    color: C.green,
  },
  tlTitle: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: C.text,
    marginTop: 4,
    letterSpacing: -0.2,
  },
  tlDetail: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: C.sub,
    marginTop: 3,
    lineHeight: 17,
  },
  tlFocusPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(232,168,56,0.08)',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    marginTop: 8,
  },
  tlFocusText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: C.orange,
    maxWidth: 200,
  },
  tlNotes: {
    marginTop: 10,
    padding: 10,
    backgroundColor: C.surfaceAlt,
    borderRadius: 10,
    borderLeftWidth: 2,
    borderLeftColor: C.orange,
  },
  tlNotesText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: C.sub,
    fontStyle: 'italic',
    lineHeight: 17,
  },
  emptyTl: {
    marginLeft: 50,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: C.sub,
    paddingVertical: 20,
  },

  // Actions tab
  actionsSectionLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: C.muted,
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: C.surfaceAlt,
    borderRadius: 14,
    marginBottom: 14,
  },
  summaryNum: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryNumText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
  },
  summaryTitle: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: C.text,
    letterSpacing: -0.2,
  },
  summarySub: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: C.sub,
    marginTop: 2,
  },
  actionCard: {
    backgroundColor: C.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.cardBorder,
    borderLeftWidth: 3,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 1,
  },
  actionCardRed: { borderLeftColor: C.red },
  actionCardOrange: { borderLeftColor: C.orange },
  actionCardGreen: { borderLeftColor: C.green },
  actionCardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionCardLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  actionCardLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  actionCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionCardPill: {
    backgroundColor: 'rgba(212,69,69,0.08)',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  actionCardPillText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
    color: C.red,
  },
  actionCardTitle: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: C.text,
    marginTop: 8,
    letterSpacing: -0.2,
  },
  actionCardSub: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: C.sub,
    marginTop: 4,
    lineHeight: 17,
  },
  actionCardDate: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: C.muted,
  },
  actionCardMsg: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: C.text,
    marginTop: 8,
    lineHeight: 20,
    letterSpacing: -0.1,
  },
  actionCardExpanded: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: C.surface,
  },
  actionCardMiniLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: C.muted,
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  actionCardDetail: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: C.sub,
    lineHeight: 17,
    marginBottom: 12,
  },
  ideaBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(232,168,56,0.05)',
    borderRadius: 12,
    padding: 12,
  },
  ideaIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(232,168,56,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ideaLabel: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: C.orange,
    marginBottom: 3,
  },
  ideaText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: C.text,
    lineHeight: 17,
  },
  actionBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  replyBtn: {
    flex: 1,
    backgroundColor: C.dark,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  replyBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: C.white,
  },
  inClassBtn: {
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.white,
  },
  inClassBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: C.sub,
  },

  actionsEmpty: {
    alignItems: 'center',
    paddingVertical: 50,
    gap: 10,
  },
  actionsEmptyTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: C.text,
  },
  actionsEmptyText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: C.sub,
    textAlign: 'center',
    paddingHorizontal: 30,
  },

  // Last class recap card
  classRecap: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    marginTop: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.cardBorder,
  },
  classRecapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  classRecapBadge: {
    backgroundColor: 'rgba(232,168,56,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  classRecapBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9,
    letterSpacing: 0.8,
    color: C.orange,
  },
  classRecapDate: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 10,
    color: C.sub,
  },
  classRecapTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
    color: C.dark,
    letterSpacing: -0.2,
    marginBottom: 6,
  },
  classRecapSummary: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: C.sub,
    lineHeight: 18,
    marginBottom: 12,
  },
  classRecapFPs: {
    gap: 6,
  },
  classRecapFPLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: C.muted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  classRecapFPRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.white,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  classRecapFPDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  classRecapFPName: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: C.dark,
    flex: 1,
  },
  classRecapFPCount: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  classRecapFPCountText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
  },
});

// Question sheet styles
const qs = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.surface,
    marginBottom: 16,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: C.text,
    marginBottom: 14,
  },
  bubble: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderLeftWidth: 3,
    borderLeftColor: C.orange,
  },
  bubbleText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: C.text,
    lineHeight: 20,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 12,
  },
  input: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: C.text,
    maxHeight: 120,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.dark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: C.muted,
  },
  dismissBtn: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  dismissText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: C.sub,
  },
});
