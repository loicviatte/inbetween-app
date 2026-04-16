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
  Image,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
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
} from '../../storage/coachStorage';
import { getAllStudentMetrics } from '../../utils/studentMetrics';

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
function Gauge({ value = 0, color, label, dark = false }) {
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
        {Math.round(value)}%
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
  const [profile, setProfile] = useState(null);
  const [focusPoints, setFocusPoints] = useState([]);
  const [activity, setActivity] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [pendingFPs, setPendingFPs] = useState([]);
  const [lastClassDate, setLastClassDate] = useState(null);
  const [metrics, setMetrics] = useState({ retention: 0, motivation: 0, health: 0 });
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState('information'); // information | activity | actions
  const [expandedAction, setExpandedAction] = useState(null);

  const [activeQuestion, setActiveQuestion] = useState(null);
  const [questionSheetVisible, setQuestionSheetVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let channel = null;

      async function load() {
        setLoading(true);
        try {
          const [p, fp, act, qs, pfp, lcd, m] = await Promise.all([
            getStudentProfile(studentId),
            getStudentFocusPoints(studentId),
            getStudentRecentActivity(studentId, 30),
            getStudentQuestions(studentId),
            getPendingFocusPoints(studentId),
            getStudentLastClassDate(studentId),
            getAllStudentMetrics(studentId),
          ]);
          if (active) {
            setProfile(p);
            setFocusPoints(fp);
            setActivity(act);
            setQuestions(qs);
            setPendingFPs(pfp);
            setLastClassDate(lcd);
            setMetrics(m);
          }
        } catch (e) {
          console.error('StudentDetailScreen load error:', e);
        }
        if (active) setLoading(false);
      }

      async function reload() {
        const [fp, qsD] = await Promise.all([
          getStudentFocusPoints(studentId),
          getStudentQuestions(studentId),
        ]);
        if (active) {
          setFocusPoints(fp);
          setQuestions(qsD);
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
              const [act, lcd, m] = await Promise.all([
                getStudentRecentActivity(studentId, 30),
                getStudentLastClassDate(studentId),
                getAllStudentMetrics(studentId),
              ]);
              if (active) {
                setActivity(act);
                setLastClassDate(lcd);
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
    // Stuck corrections — focuses never practiced
    // 1. Focus points pending validation after a class
    pendingFPs.forEach((fp) => {
      list.push({ kind: 'review', id: `review_${fp.id}`, focus: fp });
    });
    // 2. Student questions awaiting a reply
    questions.forEach((q) => {
      list.push({ kind: 'question', id: `q_${q.id}`, question: q });
    });
    return list;
  }, [pendingFPs, questions]);

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
      } else if (ev.type === 'class') {
        // Privacy: only reveal "with you" when the class is actually ours.
        // For any other teacher, show a generic label — no name leakage.
        const withWhom = ev.withCurrentCoach ? 'with you' : 'with other teacher';
        const dancePart = ev.dance ? `${ev.dance}` : 'Class logged';
        events.push({
          id: `c_${ev.id || i}`,
          date: ev.date,
          type: 'class',
          title: ev.title || (ev.withCurrentCoach ? 'Private lesson with you' : 'Class logged'),
          detail: `${dancePart} — ${withWhom}`,
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
  const HERO_FULL = 240;
  const HERO_COLLAPSED = 120;
  const COLLAPSE_THRESHOLD = 24; // pixels before the snap-close fires
  const TABS_H = 46;
  const WEEK_HEAD_H = 76; // only when Activity tab is active
  const headerExtra = activeTab === 'activity' ? WEEK_HEAD_H : 0;

  const scrollRef = useRef(null);
  const collapsedAnim = useRef(new Animated.Value(0)).current; // 0 open, 1 closed
  const collapsedState = useRef(false); // latched boolean for threshold logic

  function animateTo(openClosed) {
    // openClosed: 0 = open, 1 = closed
    Animated.timing(collapsedAnim, {
      toValue: openClosed,
      duration: 260,
      useNativeDriver: false,
    }).start();
  }

  // On tab switch, preserve the current collapsed state:
  //   - open   → scroll the new tab back to y=0 (fully open at the top)
  //   - closed → jump the new tab to y = COLLAPSE_DISTANCE so its first item
  //              sits just under the collapsed header; the card stays closed.
  useEffect(() => {
    const targetY = collapsedState.current
      ? HERO_FULL - HERO_COLLAPSED
      : 0;
    scrollRef.current?.scrollTo({ y: targetY, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  function handleScroll(e) {
    const y = e.nativeEvent.contentOffset.y;
    if (!collapsedState.current && y > COLLAPSE_THRESHOLD) {
      collapsedState.current = true;
      animateTo(1);
    } else if (collapsedState.current && y <= 0) {
      collapsedState.current = false;
      animateTo(0);
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

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={C.sub} />
        </View>
      </SafeAreaView>
    );
  }

  const tabs = ['information', 'activity', 'actions'];
  const tabIndex = tabs.indexOf(activeTab);
  const actionCount = actions.length;

  // Sticky overlay height = 16 top offset + hero + tabs + (optional section head)
  const scrollPaddingTop = 16 + HERO_FULL + TABS_H + headerExtra;

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
        {/* ── Scrollable tab content (paddingTop reserves space for overlay) ── */}
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: scrollPaddingTop, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={handleScroll}
        >

        {/* ══════════════════════════════════════════════ */}
        {/* ── INFORMATION TAB ── */}
        {/* ══════════════════════════════════════════════ */}
        {activeTab === 'information' && (
          <View style={styles.tabContent}>
            <Card style={{ borderColor: 'rgba(232,168,56,0.12)' }}>
              <View style={styles.briefHead}>
                <View style={styles.briefIconWrap}>
                  <Ionicons name="flash" size={14} color={C.orange} />
                </View>
                <Text style={styles.briefTitle}>Next class briefing</Text>
              </View>

              <Text style={styles.briefingText}>
                {displayName.split(' ')[0]}{' '}
                {briefingParts.map((p, i) => (
                  <Text
                    key={i}
                    style={{
                      color: p.color || C.sub,
                      fontFamily: p.bold ? Fonts.jakartaBold : Fonts.jakartaRegular,
                    }}
                  >
                    {p.text}
                  </Text>
                ))}
              </Text>

              <View style={styles.recBlock}>
                <Text style={styles.recLabel}>RECOMMENDATIONS</Text>
                {recommendations.map((r, i) => (
                  <View key={i} style={styles.recRow}>
                    <View style={styles.recNum}>
                      <Text style={styles.recNumText}>{i + 1}</Text>
                    </View>
                    <Text style={styles.recText}>{r}</Text>
                  </View>
                ))}
              </View>
            </Card>

            {/* Working on */}
            {focusPoints.length > 0 && (
              <View style={{ marginTop: 16 }}>
                <Text style={styles.sectionLabel}>WORKING ON</Text>
                {focusPoints.slice(0, 5).map((f) => (
                  <View key={f.id} style={styles.focusRow}>
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
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* ══════════════════════════════════════════════ */}
        {/* ── ACTIVITY TAB ── */}
        {/* ══════════════════════════════════════════════ */}
        {activeTab === 'activity' && (
          <View style={styles.tabContent}>
            <View style={styles.tlContainer}>
              <View style={styles.tlSpine} />
              {timelineEvents.length === 0 ? (
                <Text style={styles.emptyTl}>No activity yet.</Text>
              ) : (
                timelineEvents.map((item) => <TimelineRow key={item.id} item={item} />)
              )}
            </View>
          </View>
        )}

        {/* ══════════════════════════════════════════════ */}
        {/* ── ACTIONS TAB ── */}
        {/* ══════════════════════════════════════════════ */}
        {activeTab === 'actions' && (
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
                    {pendingFPs.map((fp) => (
                      <TouchableOpacity
                        key={`review_${fp.id}`}
                        style={[styles.actionCard, styles.actionCardOrange]}
                        onPress={() =>
                          navigation.navigate('FocusValidation', {
                            studentId,
                            studentName: displayName,
                          })
                        }
                        activeOpacity={0.85}
                      >
                        <View style={styles.actionCardLabelRow}>
                          <Ionicons name="sparkles-outline" size={13} color={C.orange} />
                          <Text style={[styles.actionCardLabel, { color: C.orange }]}>
                            PENDING VALIDATION
                          </Text>
                        </View>
                        <Text style={styles.actionCardTitle}>{fp.name}</Text>
                        {!!fp.subtitle && (
                          <Text style={styles.actionCardSub}>{fp.subtitle}</Text>
                        )}
                      </TouchableOpacity>
                    ))}
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
                      <View
                        key={`q_${q.id}`}
                        style={[styles.actionCard, styles.actionCardRed]}
                      >
                        <View style={styles.actionCardHead}>
                          <View style={styles.actionCardLabelRow}>
                            <Ionicons name="chatbubble-outline" size={13} color={C.red} />
                            <Text style={[styles.actionCardLabel, { color: C.red }]}>
                              PENDING QUESTION
                            </Text>
                          </View>
                          <Text style={styles.actionCardDate}>
                            {relativeDateShort(q.created_at)}
                          </Text>
                        </View>
                        <Text style={styles.actionCardMsg}>"{q.message}"</Text>
                        <View style={styles.actionBtnRow}>
                          <TouchableOpacity
                            style={styles.replyBtn}
                            onPress={() => {
                              setActiveQuestion(q);
                              setQuestionSheetVisible(true);
                            }}
                            activeOpacity={0.85}
                          >
                            <Ionicons name="send" size={13} color="#fff" />
                            <Text style={styles.replyBtnText}>Reply</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.inClassBtn}
                            onPress={async () => {
                              await dismissQuestion(q.id);
                              setQuestions((prev) => prev.filter((x) => x.id !== q.id));
                            }}
                            activeOpacity={0.85}
                          >
                            <Text style={styles.inClassBtnText}>In class</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </>
                )}
              </>
            )}
          </View>
        )}
        </ScrollView>

        {/* ── Full-width white backdrop: masks scroll content behind the
            sticky header (sides + top strip) so cards never peek through. ── */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.stickyBackdrop,
            {
              height: Animated.add(
                heroHeight,
                new Animated.Value(16 + TABS_H + headerExtra)
              ),
            },
          ]}
        />

        {/* ── Sticky overlay: animated hero + tabs + (section head) ── */}
        <Animated.View
          pointerEvents="box-none"
          style={[styles.stickyOverlay, { height: heroHeight }]}
        >
          <View style={{ flex: 1, overflow: 'hidden' }}>
            <View style={styles.heroTop}>
              <View style={styles.avatarWrap}>
                <ActivityRing
                  progress={metrics.health}
                  size={62}
                  strokeWidth={3.5}
                  color={metrics.health >= 70 ? C.green : metrics.health >= 40 ? C.orange : C.red}
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
                  {[profile?.level, profile?.dance_style].filter(Boolean).join(' · ') || 'Student'}
                </Text>
              </View>
            </View>

            <Animated.View style={{ opacity: gaugesOpacity }} pointerEvents="none">
              <View style={styles.gaugeRow}>
                <Gauge
                  value={metrics.retention}
                  color={metrics.retention >= 70 ? C.green : metrics.retention >= 40 ? C.orange : C.red}
                  label="Retention"
                  dark
                />
                <Gauge
                  value={metrics.motivation}
                  color={metrics.motivation >= 70 ? C.green : metrics.motivation >= 40 ? C.orange : C.red}
                  label="Motivation"
                  dark
                />
                <Gauge
                  value={metrics.health}
                  color={metrics.health >= 70 ? C.green : metrics.health >= 40 ? C.orange : C.red}
                  label="Health"
                  dark
                />
              </View>

              <View style={styles.heroFooter}>
                <Ionicons
                  name="shield-checkmark-outline"
                  size={14}
                  color={churnLow ? C.green : C.orange}
                />
                <Text style={styles.heroFooterText}>
                  <Text style={styles.heroFooterBold}>
                    {churnLow ? 'Low churn risk' : 'Watch engagement'}
                  </Text>
                  {`  ·  Seen ${lastSeen}${profile?.created_at ? `  ·  Since ${joinedLabel(profile.created_at)}` : ''}`}
                </Text>
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
              const color = isActive
                ? isActions && actionCount > 0
                  ? badgeColor
                  : C.text
                : C.muted;
              return (
                <TouchableOpacity
                  key={tab}
                  style={styles.tabBtn}
                  onPress={() => setActiveTab(tab)}
                  activeOpacity={0.7}
                >
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
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.tabUnderlineTrack} />
          <View
            style={[
              styles.tabUnderline,
              {
                left: `${(tabIndex * 100) / 3}%`,
                backgroundColor: activeTab === 'actions' && actionCount > 0 ? badgeColor : C.dark,
              },
            ]}
          />
        </Animated.View>

        {/* Pinned "Since last private lesson" head (Activity tab only) */}
        {activeTab === 'activity' && (
          <Animated.View
            style={[
              styles.stickyWeekHead,
              { transform: [{ translateY: Animated.add(heroHeight, new Animated.Value(TABS_H)) }] },
            ]}
          >
            <View style={{ flexShrink: 1, paddingRight: 10 }}>
              <Text style={styles.weekTitle}>
                {stats.sessionsSince} session{stats.sessionsSince !== 1 ? 's' : ''}
                {stats.totalMinSince > 0 ? ` · ${stats.totalMinSince} min` : ''}
              </Text>
              <Text style={styles.weekSub}>
                Since last private lesson{lastClassDate ? ` · ${relativeDateShort(lastClassDate)}` : ''}
              </Text>
            </View>
            {stats.trend !== 0 && (
              <View
                style={[
                  styles.trendPill,
                  { backgroundColor: stats.trend > 0 ? 'rgba(74,175,82,0.08)' : 'rgba(212,69,69,0.08)' },
                ]}
              >
                <Ionicons
                  name={stats.trend > 0 ? 'trending-up' : 'trending-down'}
                  size={11}
                  color={stats.trend > 0 ? C.green : C.red}
                />
                <Text
                  style={[
                    styles.trendText,
                    { color: stats.trend > 0 ? C.green : C.red },
                  ]}
                >
                  {stats.trend > 0 ? '+' : ''}
                  {stats.trend}%
                </Text>
              </View>
            )}
          </Animated.View>
        )}
      </View>

      <QuestionSheet
        visible={questionSheetVisible}
        question={activeQuestion}
        onClose={() => setQuestionSheetVisible(false)}
        onDone={() => {
          setQuestionSheetVisible(false);
          setActiveQuestion(null);
          setQuestions((prev) => prev.filter((x) => x.id !== activeQuestion?.id));
        }}
      />
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
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: C.bg,
  },
  stickyOverlay: {
    position: 'absolute',
    top: 16,
    left: 24,
    right: 24,
    backgroundColor: C.dark,
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(232,168,56,0.18)',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 6,
  },
  stickyTabs: {
    position: 'absolute',
    top: 16, // then translated by heroHeight
    left: 24,
    right: 24,
    height: 46,
    backgroundColor: C.bg,
  },
  stickyWeekHead: {
    position: 'absolute',
    top: 16, // then translated by heroHeight + tabs
    left: 24,
    right: 24,
    height: 76,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: C.bg,
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
  gaugeRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    marginTop: 20,
    paddingVertical: 4,
  },
  heroFooter: {
    marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroFooterText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
    flex: 1,
  },
  heroFooterBold: {
    fontFamily: Fonts.jakartaBold,
    color: 'rgba(255,255,255,0.85)',
  },

  // Tab switcher
  tabSwitcher: { marginHorizontal: 24, marginTop: 22 },
  tabsRow: { flexDirection: 'row' },
  tabBtn: {
    flex: 1,
    paddingVertical: 14,
    flexDirection: 'row',
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
    position: 'absolute',
    bottom: 0,
    height: 2.5,
    width: '33.33%',
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
