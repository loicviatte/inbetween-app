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
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Fonts, Spacing } from '../../theme';
import { supabase } from '../../services/supabase/client';
import { showVerificationPopup, showAgeReviewPopup } from '../../utils/studentLock';
import { coachReviewPending } from '../../services/ageCheck';
import {
  getCoachStudentDetail,
  getStudentFocusPoints,
  getStudentRecentActivity,
  getStudentQuestions,
  replyToQuestion,
  dismissQuestion,
  getStudentLastClassDate,
  approveFocusPoint,
  editAndApproveFocusPoint,
  rejectPendingFocusPoint,
  updateFocusPoint,
  getReconcileNeeded,
  applyReconcile,
} from '../../storage/coachStorage';
import PendingFocusCard from '../../components/coach/PendingFocusCard';
import RejectFocusSheet from '../../components/coach/RejectFocusSheet';
import ReconcileFocusSheet from '../../components/coach/ReconcileFocusSheet';
import MergeCompareCard from '../../components/coach/MergeCompareCard';
import NameMatchCard from '../../components/coach/NameMatchCard';
import { getNotifications, deleteNotification } from '../../storage/notificationsStorage';
import { getUser, getLessonReadiness } from '../../storage/storage';
import { categoryFromStyle } from '../../utils/danceCategory';
import FocusPointEditSheet from '../../components/FocusPointEditSheet';
import StyleTitle from '../../components/StyleTitle';
import { Pulse, Bone, FadeIn } from '../../components/GroupSwitchSkeleton';
import { useCoachData } from '../../context/CoachDataContext';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Coach ▸ Student (docs/design/coach-student-card.html) ──────────────────
// One page: how ready they are for the next private (the number, a notched
// gauge, sessions since and minutes left), what's waiting on the coach
// (questions, focus points to validate, duplicates, a name to confirm, too many
// focus points), the focus points from the last private, and every practice
// since that lesson down to the lesson itself.

const INK = '#0A0A0A';
const INK_62 = 'rgba(10,10,10,0.62)';
const LINE = 'rgba(10,10,10,0.12)';
const PAGE = '#F2F0EB';
const GOLD = '#E8B530';
const GOLD_INK = '#8A6414';
const RED = '#A8412F';

const STYLE_NAME = { latin: 'Latin', ballroom: 'Ballroom' };
const TIER_LABEL = { critical: 'Critical focus', important: 'Important focus', supporting: 'Supporting focus' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Helpers ─────────────────────────────────────────────────────────────────

// A question asked while training carries the focus it came from, as a tag
// FocusSessionScreen appends: "… [Focus: Staccato footwork]".
function splitFocusTag(message) {
  const m = /\s*\[Focus:\s*([^\]]+)\]\s*$/i.exec(message || '');
  if (!m) return { text: (message || '').trim(), focusName: null };
  return { text: (message || '').slice(0, m.index).trim(), focusName: m[1].trim() };
}

function initialsOf(name) {
  const w = (name || '').trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '?') + (w[1]?.[0] || '')).toUpperCase();
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const daysAgo = (date) => Math.round((startOfDay(new Date()) - startOfDay(new Date(date))) / 86400000);

// "Today", "Yesterday", "Mon 14" this week, "14 Sep" this year, else "14 Sep 2025".
function dayLabel(date) {
  const d = new Date(date);
  const n = daysAgo(d);
  if (n === 0) return 'Today';
  if (n === 1) return 'Yesterday';
  if (n < 7) return `${DAYS[d.getDay()]} ${d.getDate()}`;
  const md = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? md : `${md} ${d.getFullYear()}`;
}

function agoLabel(date) {
  const n = daysAgo(date);
  return n === 0 ? 'Today' : n === 1 ? 'Yesterday' : `${n} days ago`;
}

function animateNext() {
  LayoutAnimation.configureNext({
    duration: 220,
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}

// ── Pieces ──────────────────────────────────────────────────────────────────

// The readiness gauge: an exact gold fill with notches every 10%, cut in the page colour.
function Gauge({ percent }) {
  const p = Math.max(0, Math.min(100, percent || 0));
  return (
    <View style={st.gauge}>
      <View style={[st.gaugeFill, { width: `${p}%` }]} />
      {Array.from({ length: 9 }).map((_, i) => (
        <View key={i} style={[st.gaugeNotch, { left: `${(i + 1) * 10}%` }]} />
      ))}
    </View>
  );
}

// What's waiting on the coach: a badge, a title and a line, folding open onto
// its rows — or, with onPress and no rows, a single tap.
function ActionCard({ count, tone = 'gold', title, sub, open, onToggle, onPress, children }) {
  const foldable = !onPress;
  return (
    <View style={st.act}>
      <Pressable
        onPress={foldable ? onToggle : onPress}
        style={({ pressed }) => [st.actHead, pressed && { backgroundColor: '#FBFAF7' }]}
        accessibilityRole="button"
        accessibilityState={foldable ? { expanded: !!open } : undefined}
      >
        {tone === 'red' ? (
          <View style={[st.actBadge, { backgroundColor: RED }]}>
            <Text style={[st.actBadgeT, { color: '#FFFFFF' }]}>{count}</Text>
          </View>
        ) : (
          <LinearGradient colors={['#F6D27A', GOLD]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.actBadge}>
            <Text style={st.actBadgeT}>{count}</Text>
          </LinearGradient>
        )}
        <View style={st.actBody}>
          <Text style={st.actTitle} numberOfLines={1}>{title}</Text>
          {!!sub && <Text style={st.actSub} numberOfLines={1}>{sub}</Text>}
        </View>
        <View style={st.actChev}>
          <Ionicons
            name={foldable ? (open ? 'chevron-up' : 'chevron-down') : 'chevron-forward'}
            size={12}
            color="rgba(10,10,10,0.6)"
          />
        </View>
      </Pressable>
      {foldable && open ? children : null}
    </View>
  );
}

function QuestionRow({ q, onAnswer }) {
  // The focus it was asked from reads better as a line of its own than as a
  // tag trailing the question.
  const { text, focusName } = splitFocusTag(q.message);
  return (
    <Pressable onPress={onAnswer} style={({ pressed }) => [st.qRow, pressed && { backgroundColor: '#FBFAF7' }]}
      accessibilityRole="button" accessibilityLabel={`Question: ${q.message}. Answer`}>
      <Text style={st.qMark}>“</Text>
      <View style={st.qBody}>
        <Text style={st.qText}>{text || q.message}</Text>
        <Text style={st.qMeta}>{[agoLabel(q.created_at), focusName].filter(Boolean).join(' · ')}</Text>
      </View>
      <View style={st.qBtn}><Text style={st.qBtnT}>Answer</Text></View>
    </Pressable>
  );
}

function FocusRow({ f, first, onPress }) {
  const done = f.done || 0;
  const target = f.target || 0;
  const complete = target > 0 && done >= target;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.fp, !first && st.fpLine, pressed && { backgroundColor: '#FBFAF7' }]}
      accessibilityRole="button">
      <View style={[st.tick, done > 0 && st.tickOn, complete && st.tickDone]}>
        {done > 0 && <Ionicons name="checkmark" size={12} color={complete ? INK : GOLD_INK} />}
      </View>
      <View style={st.fpBody}>
        <Text style={st.fpName} numberOfLines={2}>{f.name}</Text>
        <Text style={st.fpMeta} numberOfLines={1}>
          <Text style={f.tier === 'critical' ? st.fpCritical : null}>{TIER_LABEL[f.tier] || 'Focus'}</Text>
          {f.fromLastPrivate === false ? ' · this week' : ' · from last private'}
        </Text>
      </View>
      {f.progress != null ? <Text style={st.fpProgress}>{f.progress}</Text> : null}
      <Ionicons name="chevron-forward" size={13} color="rgba(10,10,10,0.28)" />
    </Pressable>
  );
}

function TimelineRow({ first, last, label, title, detail, lesson, onPress }) {
  const body = (
    <>
      <View style={st.tlLine}>
        <View style={[st.tlSeg, first && { backgroundColor: 'transparent' }]} />
        {lesson ? <View style={st.tlHalo}><View style={st.tlDotLesson} /></View> : <View style={st.tlDot} />}
        <View style={[st.tlSeg, (last || lesson) && { backgroundColor: 'transparent' }]} />
      </View>
      <View style={[st.tlBody, lesson && { paddingBottom: 6 }]}>
        <Text style={[st.tlLabel, lesson && { color: GOLD_INK }]}>{label}</Text>
        <Text style={lesson ? st.tlTitleLesson : st.tlTitle}>{title}</Text>
        {!!detail && <Text style={st.tlDetail}>{detail}</Text>}
      </View>
    </>
  );
  if (!onPress) return <View style={st.tlRow}>{body}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.tlRow, pressed && { opacity: 0.7 }]} accessibilityRole="button">
      {body}
      <Ionicons name="chevron-forward" size={13} color="rgba(10,10,10,0.28)" style={{ alignSelf: 'center' }} />
    </Pressable>
  );
}

function StudentDetailSkeleton({ name, onBack }) {
  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.top}>
        <TouchableOpacity style={st.ib} onPress={onBack} accessibilityLabel="Back to students">
          <Ionicons name="chevron-back" size={18} color={INK} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}><Pulse><Bone w={70} h={14} r={4} /></Pulse></View>
        <Pulse><Bone w={36} h={36} r={18} /></Pulse>
      </View>
      <View style={st.scroll}>
        <Text style={st.name} numberOfLines={1}>{name || ' '}</Text>
        <Pulse style={[st.rd, { gap: 17 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 15 }}>
            <Bone w={96} h={46} r={10} />
            <Bone w={110} h={24} r={4} />
          </View>
          <Bone w="100%" h={11} r={4} />
          <View style={{ flexDirection: 'row', gap: 40 }}>
            <Bone w={70} h={30} r={5} />
            <Bone w={70} h={30} r={5} />
          </View>
        </Pulse>
        <Pulse style={{ gap: 9, paddingTop: 20 }}>
          <Bone w={90} h={9} r={4} />
          <Bone w="100%" h={150} r={17} />
        </Pulse>
      </View>
    </SafeAreaView>
  );
}

// ── Question sheet (reply modal) ────────────────────────────────────────────
// The draft lives in the screen so leaving for the focus point or the lesson
// doesn't throw away what the coach had started typing.
function QuestionSheet({ visible, question, reply, onReplyChange, focusPoints, studentId, onOpenFocus, onOpenClass, onClose, onDone }) {
  const insets = useSafeAreaInsets();
  const [sending, setSending] = useState(false);
  const [context, setContext] = useState(null); // { focus, cls } | null while loading
  const [expanded, setExpanded] = useState(false);

  const { text: questionText, focusName } = splitFocusTag(question?.message);

  // What the question is about: the focus point by name, and the lesson it was
  // set in. Looked up when the sheet opens — questions carry no foreign key.
  useEffect(() => {
    if (!visible || !question) { setContext(null); setExpanded(false); return undefined; }
    if (!focusName) { setContext({ focus: null, cls: null }); return undefined; }
    let alive = true;
    setContext(null);
    (async () => {
      let focus = null;
      try {
        const { data } = await supabase
          .from('focus_points')
          .select('id, name, subtitle, drill, tier, status, created_at, class_input_id, source_class_input_id')
          .eq('user_id', studentId)
          .eq('is_deleted', false)
          .ilike('name', focusName)
          .order('created_at', { ascending: false })
          .limit(1);
        focus = data?.[0] || null;
      } catch {}
      if (!focus) {
        focus = (focusPoints || []).find((f) => (f.name || '').trim().toLowerCase() === focusName.toLowerCase()) || null;
      }
      let cls = null;
      const classId = focus?.class_input_id || focus?.source_class_input_id || null;
      if (classId) {
        try {
          const { data } = await supabase
            .from('class_inputs')
            .select('id, title, dance, class_summary, created_at')
            .eq('id', classId)
            .maybeSingle();
          cls = data || null;
        } catch {}
      }
      if (alive) setContext({ focus, cls });
    })();
    return () => { alive = false; };
  }, [visible, question?.id, focusName, studentId]);

  async function handleReply() {
    if (!reply.trim()) return;
    setSending(true);
    await replyToQuestion(question.id, reply.trim());
    setSending(false);
    onReplyChange('');
    onDone();
  }

  async function handleDismiss() {
    await dismissQuestion(question.id);
    onDone();
  }

  if (!question) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={qs.overlay} onPress={onClose}>
          <Pressable style={[qs.sheet, { paddingBottom: insets.bottom + 20 }]} onPress={() => {}}>
            <View style={qs.handle} />
            <Text style={qs.eyebrow}>From your student</Text>
            <Text style={qs.title}>Their question</Text>
            <View style={qs.bubble}>
              <Text style={qs.qm}>“</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={qs.bubbleText}>{questionText || question.message}</Text>
                <Text style={qs.bubbleMeta}>{agoLabel(question.created_at)}</Text>
              </View>
            </View>

            {!!focusName && (
              <View style={qs.ctx}>
                <Pressable
                  onPress={() => setExpanded((e) => !e)}
                  style={({ pressed }) => [qs.ctxHead, pressed && { backgroundColor: '#FBFAF7' }]}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  accessibilityLabel={`About ${context?.focus?.name || focusName}`}
                >
                  <View style={qs.ctxDot} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={qs.ctxName} numberOfLines={1}>{context?.focus?.name || focusName}</Text>
                    <Text style={qs.ctxMeta} numberOfLines={1}>
                      {context == null
                        ? 'Looking it up…'
                        : [TIER_LABEL[context.focus?.tier] || 'Focus point',
                           context.cls ? `set ${dayLabel(context.cls.created_at)}` : null].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color="rgba(10,10,10,0.4)" />
                </Pressable>

                {expanded && context != null && (
                  <View style={qs.ctxBody}>
                    {!!context.focus?.subtitle && <Text style={qs.ctxText}>{context.focus.subtitle}</Text>}
                    {!!context.focus?.drill && (
                      <>
                        <Text style={qs.ctxLabel}>How they train it</Text>
                        <Text style={qs.ctxText}>{context.focus.drill}</Text>
                      </>
                    )}
                    {!!context.cls?.class_summary && (
                      <>
                        <Text style={qs.ctxLabel}>From the lesson</Text>
                        <Text style={qs.ctxText} numberOfLines={5}>{context.cls.class_summary}</Text>
                      </>
                    )}
                    {!context.focus?.subtitle && !context.focus?.drill && !context.cls?.class_summary && (
                      <Text style={qs.ctxText}>No notes were written on this focus point.</Text>
                    )}
                    <View style={qs.ctxActions}>
                      {!!context.focus?.id && (
                        <TouchableOpacity style={qs.ctxBtn} activeOpacity={0.8} onPress={() => onOpenFocus(context.focus)}
                          accessibilityRole="button">
                          <Ionicons name="locate-outline" size={13} color={INK} />
                          <Text style={qs.ctxBtnT}>The focus point</Text>
                        </TouchableOpacity>
                      )}
                      {!!context.cls?.id && (
                        <TouchableOpacity style={qs.ctxBtn} activeOpacity={0.8} onPress={() => onOpenClass(context.cls.id)}
                          accessibilityRole="button">
                          <Ionicons name="document-text-outline" size={13} color={INK} />
                          <Text style={qs.ctxBtnT}>The lesson</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                )}
              </View>
            )}
            <Text style={qs.label}>Your reply</Text>
            <View style={qs.inputRow}>
              <TextInput
                style={qs.input}
                value={reply}
                onChangeText={onReplyChange}
                placeholder="Type your reply…"
                placeholderTextColor="rgba(10,10,10,0.38)"
                multiline
                maxLength={500}
              />
              <TouchableOpacity
                style={[qs.sendBtn, !reply.trim() && qs.sendBtnDisabled]}
                onPress={handleReply}
                disabled={sending || !reply.trim()}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Send the reply"
              >
                {sending
                  ? <ActivityIndicator color={INK} size="small" />
                  : <Ionicons name="arrow-up" size={19} color={reply.trim() ? INK : 'rgba(10,10,10,0.35)'} />}
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

// ── Screen ──────────────────────────────────────────────────────────────────
export default function StudentDetailScreen({ route, navigation }) {
  const { studentId, studentName } = route.params;
  // Every other way in (a feed, a notification, a deep link) lands here: a
  // student still waiting on their age check turns the coach straight back.
  useEffect(() => {
    let alive = true;
    supabase.from('users').select('age_check').eq('id', studentId).maybeSingle().then(({ data }) => {
      if (!alive || data?.age_check !== 'minor_pending') return;
      const back = () => { if (navigation.canGoBack()) navigation.goBack(); };
      coachReviewPending(studentId).catch(() => false).then((pending) => {
        if (!alive) return;
        if (pending) showAgeReviewPopup({ id: studentId, name: studentName }, (r) => { if (r !== 'unlocked') back(); });
        else showVerificationPopup(studentName, back);
      });
    });
    return () => { alive = false; };
  }, [studentId]);

  const { refresh: refreshCoachData, getOrFetch, invalidateCache, styleFilter } = useCoachData();
  const [profile, setProfile] = useState(null);
  const [focusPoints, setFocusPoints] = useState([]);
  const [activity, setActivity] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [pendingFPs, setPendingFPs] = useState([]);
  const [reconcileGroup, setReconcileGroup] = useState(null);
  const [showReconcile, setShowReconcile] = useState(false);
  const [mergeRequests, setMergeRequests] = useState([]);
  const [nameMatches, setNameMatches] = useState([]);
  const [lastClassDate, setLastClassDate] = useState(null);
  const [readiness, setReadiness] = useState(null);
  // The style readiness is read for. A one-style coach is fixed to theirs; a
  // coach who teaches both starts on the header group they had picked and can
  // switch from the title (for a student who dances both).
  const [viewCategory, setViewCategory] = useState(null);
  const [isDualCoach, setIsDualCoach] = useState(false);
  const viewCategoryRef = useRef(null);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(null); // which action card is unfolded
  const [expandedPendingFpId, setExpandedPendingFpId] = useState(null);
  const [editingPendingFp, setEditingPendingFp] = useState(null);
  const [rejectingPendingFp, setRejectingPendingFp] = useState(null);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [questionSheetVisible, setQuestionSheetVisible] = useState(false);
  const [questionReply, setQuestionReply] = useState(''); // kept while the coach goes looking for context
  const [editingFocus, setEditingFocus] = useState(null);
  const [lessonMinutes, setLessonMinutes] = useState(null);
  const [lessonCount, setLessonCount] = useState(null); // every lesson logged for them

  const toggle = (key) => { animateNext(); setOpen((o) => (o === key ? null : key)); };

  async function handleApprovePendingFp(fpId) {
    try {
      await approveFocusPoint(fpId);
      animateNext();
      setPendingFPs((prev) => prev.filter((fp) => fp.id !== fpId));
      refreshCoachData();
    } catch {}
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
      animateNext();
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
      refreshCoachData();
    } catch {}
  }

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let channel = null;

      async function load() {
        try {
          const me = await getUser().catch(() => null);
          const cat = categoryFromStyle(me?.dance_style);
          const initialView = cat || styleFilter || 'latin';
          viewCategoryRef.current = initialView;

          // Per-student reads go through the context cache so back → tap → back
          // is instant (60 s); the core pieces come from one bundled RPC.
          const sk = `student:${studentId}`;
          const [bundle, act, notifs, mergesRes, rdScoped] = await Promise.all([
            getOrFetch(`${sk}:bundle`, () => getCoachStudentDetail(studentId)),
            getOrFetch(`${sk}:activity:40`, () => getStudentRecentActivity(studentId, 40)),
            getOrFetch('coach:notifications', () => getNotifications().catch(() => [])),
            getOrFetch(`${sk}:merges`, () =>
              supabase
                .from('merge_requests')
                .select('id, student_id, focus_a, focus_b, status, created_at')
                .eq('student_id', studentId)
                .eq('status', 'pending_coach')
                .order('created_at', { ascending: false })
            ),
            getOrFetch(`${sk}:readiness:${initialView}`, () => getLessonReadiness(studentId, initialView).catch(() => null)),
          ]);
          const b = bundle || {};
          const { data: merges } = mergesRes || {};
          if (!active) return;
          setProfile(b.profile ?? null);
          supabase
            .from('class_inputs')
            .select('id', { count: 'exact', head: true })
            .or(`user_id.eq.${studentId},student_id.eq.${studentId}`)
            .eq('is_deleted', false)
            .then(({ count }) => { if (active && count != null) setLessonCount(count); });
          setFocusPoints(b.focusPoints ?? []);
          setActivity(act || []);
          setQuestions(b.questions ?? []);
          setPendingFPs(b.pendingFps ?? []);
          getReconcileNeeded([studentId]).then((g) => { if (active) setReconcileGroup(g[0] || null); }).catch(() => {});
          setViewCategory(initialView);
          setIsDualCoach(cat == null);
          setLastClassDate(rdScoped?.lastClassDate ?? b.lastClassDate ?? null);
          setReadiness(rdScoped ?? null);
          setNameMatches((notifs || []).filter((n) => n.type === 'name_match_confirm' && n.data?.student_id === studentId));
          // Merge requests carry both focus points in full for the side-by-side card.
          const mrList = merges || [];
          if (mrList.length > 0) {
            const fpIds = [...new Set(mrList.flatMap((mr) => [mr.focus_a, mr.focus_b]))];
            const { data: fpRows } = await supabase
              .from('focus_points')
              .select('id, name, user_id, subtitle, context, dance, drill, tier, category, created_at, class_input_id, source_class_input_id')
              .in('id', fpIds);
            const fpMap = Object.fromEntries((fpRows || []).map((f) => [f.id, f]));
            if (active) {
              setMergeRequests(mrList.map((mr) => ({
                ...mr,
                focusA: fpMap[mr.focus_a] || null,
                focusB: fpMap[mr.focus_b] || null,
                focusAName: fpMap[mr.focus_a]?.name || '?',
                focusBName: fpMap[mr.focus_b]?.name || '?',
              })));
            }
          } else {
            setMergeRequests([]);
          }
        } catch (e) {
          console.error('StudentDetailScreen load error:', e);
        }
        if (active) setLoading(false);
      }

      async function reload() {
        invalidateCache(`student:${studentId}:`);
        const [fp, qsD, act, rd] = await Promise.all([
          getStudentFocusPoints(studentId),
          getStudentQuestions(studentId),
          getStudentRecentActivity(studentId, 40),
          getLessonReadiness(studentId, viewCategoryRef.current).catch(() => null),
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
          .on('postgres_changes', { event: '*', schema: 'public', table: 'coach_messages', filter: `student_id=eq.${studentId}` },
            () => active && reload())
          .on('postgres_changes', { event: '*', schema: 'public', table: 'focus_points', filter: `user_id=eq.${studentId}` },
            () => active && reload())
          .on('postgres_changes', { event: '*', schema: 'public', table: 'practice_logs', filter: `student_id=eq.${studentId}` },
            async () => {
              if (!active) return;
              invalidateCache(`student:${studentId}:`);
              const [act, lcd, rd] = await Promise.all([
                getStudentRecentActivity(studentId, 40),
                getStudentLastClassDate(studentId),
                getLessonReadiness(studentId, viewCategoryRef.current).catch(() => null),
              ]);
              if (active) {
                setActivity(act);
                setLastClassDate(rd?.lastClassDate ?? lcd);
                setReadiness(rd);
              }
            })
          .subscribe();
      }

      setup();
      return () => {
        active = false;
        if (channel) supabase.removeChannel(channel);
      };
    }, [studentId]) // eslint-disable-line react-hooks/exhaustive-deps
  );

  const switchCategory = useCallback((c) => {
    if (c === viewCategoryRef.current) return;
    viewCategoryRef.current = c;
    setViewCategory(c);
    getLessonReadiness(studentId, c)
      .then((rd) => {
        if (viewCategoryRef.current !== c) return;
        setReadiness(rd);
        if (rd?.lastClassDate) setLastClassDate(rd.lastClassDate);
      })
      .catch(() => {});
  }, [studentId]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const displayName = profile?.name || studentName || 'Student';
  const first = displayName.split(' ')[0];
  const dancesBoth = !profile?.dance_style || profile.dance_style === 'Latin & Ballroom';
  const canSwitch = isDualCoach && dancesBoth;
  const styleLabel = STYLE_NAME[viewCategory] || 'Student';

  // Since the last private (or the last 14 days before any).
  const sinceMs = useMemo(
    () => (lastClassDate ? new Date(lastClassDate).getTime() : Date.now() - 14 * 86400000),
    [lastClassDate],
  );
  const sessions = useMemo(
    () => activity.filter((e) => e.type === 'training' && new Date(e.date).getTime() >= sinceMs),
    [activity, sinceMs],
  );
  const sessionMinutes = sessions.reduce((n, e) => n + (e.durationMin || 0), 0);

  // The last private with this coach: the readiness reference.
  const lastLesson = useMemo(() => activity.find(
    (ev) => ev.type === 'class' && ev.withCurrentCoach && ev.lessonType !== 'group' && (ev.focusPoints?.length ?? 0) > 0,
  ) || null, [activity]);

  useEffect(() => {
    setLessonMinutes(null);
    if (!lastLesson?.id) return undefined;
    let alive = true;
    supabase
      .from('class_recordings')
      .select('started_at, ended_at, mic_file_duration_sec')
      .eq('class_input_id', lastLesson.id)
      .then(({ data }) => {
        if (!alive) return;
        let min = 0;
        for (const r of data || []) {
          if (r.mic_file_duration_sec > 0) min += r.mic_file_duration_sec / 60;
          else if (r.started_at && r.ended_at) min += Math.max(0, (new Date(r.ended_at) - new Date(r.started_at)) / 60000);
        }
        setLessonMinutes(min > 0 ? Math.max(1, Math.round(min)) : null);
      });
    return () => { alive = false; };
  }, [lastLesson?.id]);

  // Focus rows: the last private's, with progress; before any private, the active ones.
  const focusRows = useMemo(() => {
    if (readiness?.focuses?.length) {
      return readiness.focuses.map((f) => ({
        id: f.focusPointId, name: f.name, tier: f.tier, done: f.done, target: f.target,
        progress: `${f.done}/${f.target}`, fromLastPrivate: true,
      }));
    }
    return focusPoints.slice(0, 5).map((f) => ({
      id: f.id, name: f.name, tier: f.tier, done: f.weekCount, target: 0,
      progress: `${f.weekCount}×`, fromLastPrivate: false,
    }));
  }, [readiness, focusPoints]);

  const openFocus = (row) => {
    const fp = focusPoints.find((f) => f.id === row.id);
    setEditingFocus(fp || { id: row.id, name: row.name, tier: row.tier });
  };

  const oldestQuestion = questions.length ? questions[questions.length - 1] : null;
  const oldestDays = oldestQuestion ? daysAgo(oldestQuestion.created_at) : 0;

  if (loading) {
    return <StudentDetailSkeleton name={studentName} onBack={() => navigation.goBack()} />;
  }

  const pct = readiness?.percent;
  const hasReadiness = readiness != null;

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      {/* ── Top bar: back, the style (a menu for a coach teaching both), the avatar ── */}
      <View style={st.top}>
        <TouchableOpacity style={st.ib} onPress={() => navigation.goBack()} activeOpacity={0.7}
          accessibilityRole="button" accessibilityLabel="Back to students">
          <Ionicons name="chevron-back" size={18} color={INK} />
        </TouchableOpacity>
        <StyleTitle
          label={styleLabel}
          category={viewCategory}
          canSwitch={canSwitch}
          onSelect={switchCategory}
          sub={lessonCount == null ? null : lessonCount === 0 ? 'No lessons yet' : `${lessonCount} lesson${lessonCount === 1 ? '' : 's'}`}
        />
        <View style={st.me}>
          {profile?.photo_url ? (
            <Image source={{ uri: profile.photo_url }} style={StyleSheet.absoluteFill} />
          ) : (
            <LinearGradient colors={['#F6D27A', GOLD]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.meFill}>
              <Text style={st.meT}>{initialsOf(displayName)}</Text>
            </LinearGradient>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        <FadeIn>
          <Text style={st.name} numberOfLines={2}>{displayName}</Text>

          {/* ── Readiness ── */}
          <View style={st.rd}>
            <View style={st.l1}>
              <View style={st.big}>
                <Text style={st.bigN}>{hasReadiness ? pct : '—'}</Text>
                {hasReadiness && <Text style={st.bigPct}>%</Text>}
              </View>
              <Text style={st.lb}>
                {hasReadiness ? 'Ready for\n' : 'No private\n'}
                <Text style={st.lbB}>{hasReadiness ? 'next private' : 'logged yet'}</Text>
              </Text>
            </View>
            <Gauge percent={pct} />
            <View style={st.fig}>
              <View style={st.figCell}>
                <Text style={st.figN}>{sessions.length}×</Text>
                <Text style={st.figL}>{lastClassDate ? 'Since last private' : 'Last 14 days'}</Text>
              </View>
              <View style={[st.figCell, st.figCellLine]}>
                <Text style={st.figN}>{hasReadiness ? readiness.minutesRemaining : '—'}</Text>
                <Text style={st.figL}>Minutes left</Text>
              </View>
            </View>
          </View>

          {/* ── Waiting on the coach ── */}
          {reconcileGroup && (
            <ActionCard
              count={1 + reconcileGroup.candidates.length}
              tone="red"
              title="Too many focus points"
              sub="Keep 3 — pick one to drop"
              onPress={() => setShowReconcile(true)}
            />
          )}

          {pendingFPs.length > 0 && (
            <ActionCard
              count={pendingFPs.length}
              tone="red"
              title={pendingFPs.length === 1 ? 'Focus point to validate' : 'Focus points to validate'}
              sub={`From the last class, before ${first} sees ${pendingFPs.length === 1 ? 'it' : 'them'}`}
              open={open === 'validate'}
              onToggle={() => toggle('validate')}
            >
              <View style={st.actInner}>
                {pendingFPs.map((fp) => {
                  const isExpanded = expandedPendingFpId === fp.id;
                  return (
                    <PendingFocusCard
                      key={`review_${fp.id}`}
                      fp={fp}
                      isExpanded={isExpanded}
                      onToggle={() => { animateNext(); setExpandedPendingFpId(isExpanded ? null : fp.id); }}
                      studentName={null}
                      onApprove={handleApprovePendingFp}
                      onEdit={setEditingPendingFp}
                      onDelete={setRejectingPendingFp}
                    />
                  );
                })}
              </View>
            </ActionCard>
          )}

          {questions.length > 0 && (
            <ActionCard
              count={questions.length}
              title={questions.length === 1 ? 'Question to answer' : 'Questions to answer'}
              sub={oldestDays === 0 ? 'Asked today' : `Oldest waiting ${oldestDays} day${oldestDays === 1 ? '' : 's'}`}
              open={open === 'questions'}
              onToggle={() => toggle('questions')}
            >
              {questions.map((q) => (
                <QuestionRow
                  key={q.id}
                  q={q}
                  onAnswer={() => {
                    if (q.id !== activeQuestion?.id) setQuestionReply('');
                    setActiveQuestion(q);
                    setQuestionSheetVisible(true);
                  }}
                />
              ))}
            </ActionCard>
          )}

          {mergeRequests.length > 0 && (
            <ActionCard
              count={mergeRequests.length}
              title={mergeRequests.length === 1 ? 'Possible duplicate' : 'Possible duplicates'}
              sub="Two focus points that may be the same"
              open={open === 'merge'}
              onToggle={() => toggle('merge')}
            >
              <View style={st.actInner}>
                {mergeRequests.map((mr) => (
                  <MergeCompareCard
                    key={`merge_${mr.id}`}
                    mr={mr}
                    studentName={null}
                    onMerge={async () => {
                      // Re-anchor focus_a to focus_b's class so readiness sees the
                      // merge in the current private (mirrors ActionNeededScreen).
                      const a = mr.focusA;
                      const b = mr.focusB;
                      if (a && b?.class_input_id) {
                        await supabase
                          .from('focus_points')
                          .update({
                            class_input_id: b.class_input_id,
                            source_class_input_id: a.source_class_input_id ?? a.class_input_id ?? b.class_input_id,
                          })
                          .eq('id', mr.focus_a);
                      }
                      await supabase.from('focus_points').update({ is_deleted: true, status: 'past' }).eq('id', mr.focus_b);
                      await supabase.from('merge_requests').update({ status: 'merged', resolved_at: new Date().toISOString(), resolved_by: 'coach' }).eq('id', mr.id);
                      animateNext();
                      setMergeRequests((prev) => prev.filter((m) => m.id !== mr.id));
                      refreshCoachData();
                    }}
                    onKeepBoth={async () => {
                      // The newer one goes through normal review instead of vanishing.
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
                      animateNext();
                      setMergeRequests((prev) => prev.filter((m) => m.id !== mr.id));
                      refreshCoachData();
                    }}
                  />
                ))}
              </View>
            </ActionCard>
          )}

          {nameMatches.length > 0 && (
            <ActionCard
              count={nameMatches.length}
              title={nameMatches.length === 1 ? 'Name to confirm' : 'Names to confirm'}
              sub={`Is this ${first} in the recording?`}
              open={open === 'names'}
              onToggle={() => toggle('names')}
            >
              <View style={st.actInner}>
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
                      animateNext();
                      setNameMatches((prev) => prev.filter((n) => n.id !== notif.id));
                      refreshCoachData();
                    }}
                    onReject={async () => {
                      const { focus_point_ids } = notif.data || {};
                      if (focus_point_ids?.length > 0) {
                        await supabase.from('focus_points').update({ user_id: null, status: 'active' }).in('id', focus_point_ids);
                      }
                      await deleteNotification(notif.id);
                      animateNext();
                      setNameMatches((prev) => prev.filter((n) => n.id !== notif.id));
                      refreshCoachData();
                    }}
                  />
                ))}
              </View>
            </ActionCard>
          )}

          {/* ── Focus points ── */}
          <View style={st.sh}>
            <Text style={st.shT}>Focus points</Text>
            <Text style={st.shR} numberOfLines={1}>
              {focusRows[0]?.fromLastPrivate === false ? 'active · this week' : `from last private · ${styleLabel}`}
            </Text>
          </View>
          {focusRows.length === 0 ? (
            <Text style={st.empty}>No focus points yet. They appear after a private lesson is processed.</Text>
          ) : (
            <View style={st.card}>
              {focusRows.map((f, i) => <FocusRow key={f.id} f={f} first={i === 0} onPress={() => openFocus(f)} />)}
            </View>
          )}

          {/* ── Practice since the last private, down to the lesson ── */}
          <View style={st.sh}>
            <Text style={st.shT}>Practice</Text>
            <Text style={st.shR} numberOfLines={1}>
              {`${sessions.length} session${sessions.length === 1 ? '' : 's'}`}
              {sessionMinutes > 0 ? ` · ${sessionMinutes} min` : ''}
              {lastClassDate ? ` since ${dayLabel(lastClassDate)}` : ' · last 14 days'}
            </Text>
          </View>
          <View>
            {sessions.length === 0 && (
              <TimelineRow
                first
                last={!lastLesson}
                label={lastClassDate ? `Since ${dayLabel(lastClassDate)}` : 'Last 14 days'}
                title="No practice logged"
              />
            )}
            {sessions.slice(0, 12).map((e, i) => (
              <TimelineRow
                key={e.id || i}
                first={i === 0}
                last={!lastLesson && i === Math.min(sessions.length, 12) - 1}
                label={dayLabel(e.date)}
                title={e.focusName || 'Practice session'}
                detail={e.durationMin ? `${e.durationMin} min` : null}
              />
            ))}
            {lastLesson && (
              <TimelineRow
                lesson
                first={false}
                last
                label={`${dayLabel(lastLesson.date)} · last private with you`}
                title={lastLesson.title || lastLesson.dance || 'Private lesson'}
                detail={[
                  lessonMinutes ? `${lessonMinutes} min` : null,
                  `${lastLesson.focusPoints.length} correction${lastLesson.focusPoints.length === 1 ? '' : 's'}`,
                ].filter(Boolean).join(' · ')}
                onPress={() => navigation.navigate('CoachClassDetail', { classId: lastLesson.id })}
              />
            )}
          </View>
        </FadeIn>
      </ScrollView>

      <QuestionSheet
        visible={questionSheetVisible}
        question={activeQuestion}
        reply={questionReply}
        onReplyChange={setQuestionReply}
        focusPoints={focusPoints}
        studentId={studentId}
        // Two sheets can't be on screen at once: let this one dismiss first.
        onOpenFocus={(fp) => {
          setQuestionSheetVisible(false);
          setTimeout(() => setEditingFocus(fp), 320);
        }}
        onOpenClass={(classId) => {
          setQuestionSheetVisible(false);
          setTimeout(() => navigation.navigate('CoachClassDetail', { classId }), 320);
        }}
        onClose={() => setQuestionSheetVisible(false)}
        onDone={() => {
          setQuestionSheetVisible(false);
          setActiveQuestion(null);
          setQuestionReply('');
          animateNext();
          setQuestions((prev) => prev.filter((x) => x.id !== activeQuestion?.id));
          refreshCoachData();
        }}
      />

      <Modal visible={!!editingFocus} transparent animationType="slide" onRequestClose={() => setEditingFocus(null)}>
        {editingFocus && (
          <FocusPointEditSheet
            fp={editingFocus}
            saveLabel="Save"
            onSave={async (fpId, updates) => {
              await updateFocusPoint(fpId, updates);
              setFocusPoints((prev) => prev.map((f) => (f.id === fpId ? { ...f, ...updates } : f)));
              if (updates?.name) {
                setReadiness((r) => (r ? { ...r, focuses: r.focuses.map((f) => (f.focusPointId === fpId ? { ...f, name: updates.name } : f)) } : r));
              }
              setEditingFocus(null);
            }}
            onClose={() => setEditingFocus(null)}
          />
        )}
      </Modal>

      <Modal visible={!!editingPendingFp} transparent animationType="slide" onRequestClose={() => setEditingPendingFp(null)}>
        {editingPendingFp && (
          <FocusPointEditSheet
            fp={editingPendingFp}
            saveLabel="Save & Approve"
            onSave={handleSavePendingFpEdit}
            onClose={() => setEditingPendingFp(null)}
          />
        )}
      </Modal>

      <Modal visible={!!rejectingPendingFp} transparent animationType="slide" onRequestClose={() => setRejectingPendingFp(null)}>
        {rejectingPendingFp && (
          <RejectFocusSheet
            fp={rejectingPendingFp}
            onConfirm={handleConfirmRejectPendingFp}
            onClose={() => setRejectingPendingFp(null)}
          />
        )}
      </Modal>

      <Modal visible={showReconcile} transparent animationType="slide" onRequestClose={() => setShowReconcile(false)}>
        {reconcileGroup && (
          <ReconcileFocusSheet
            student={{ name: displayName, initials: initialsOf(displayName) }}
            kept={reconcileGroup.kept}
            candidates={reconcileGroup.candidates}
            onConfirm={async (removedId) => {
              await applyReconcile(removedId);
              setShowReconcile(false);
              refreshCoachData();
              getReconcileNeeded([studentId]).then((g) => setReconcileGroup(g[0] || null)).catch(() => {});
            }}
            onClose={() => setShowReconcile(false)}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAGE },

  top: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: Spacing.side, paddingTop: 6, paddingBottom: 4 },
  ib: {
    width: 36, height: 36, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    shadowColor: INK, shadowOpacity: 0.07, shadowOffset: { width: 0, height: 1 }, shadowRadius: 2, elevation: 1,
  },
  me: { width: 36, height: 36, borderRadius: 18, overflow: 'hidden', backgroundColor: '#F4F2EC' },
  meFill: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  meT: { fontFamily: Fonts.ttBold, fontSize: 12.5, color: INK },

  scroll: { paddingHorizontal: Spacing.side, paddingBottom: 40 },
  name: { fontFamily: Fonts.ttBold, fontSize: 28, letterSpacing: -1.1, lineHeight: 32, color: INK, paddingTop: 16 },

  // Readiness: the figure, the gauge, two numbers
  rd: { gap: 17, paddingTop: 22, paddingBottom: 19, borderBottomWidth: 1, borderBottomColor: LINE },
  l1: { flexDirection: 'row', alignItems: 'flex-end', gap: 15 },
  big: { flexDirection: 'row', alignItems: 'flex-start' },
  bigN: { fontFamily: Fonts.ttExtraBold, fontSize: 58, letterSpacing: -3.5, lineHeight: 50, color: INK, fontVariant: ['tabular-nums'] },
  bigPct: { fontFamily: Fonts.ttBold, fontSize: 20, lineHeight: 22, color: 'rgba(10,10,10,0.55)', paddingLeft: 3, marginTop: 1 },
  lb: {
    flex: 1, paddingBottom: 2, fontFamily: Fonts.ttDemiBold, fontSize: 10.5, letterSpacing: 1.5, lineHeight: 16,
    textTransform: 'uppercase', color: INK_62,
  },
  lbB: { color: INK },
  gauge: { height: 11, borderRadius: 4, overflow: 'hidden', backgroundColor: 'rgba(10,10,10,0.09)' },
  gaugeFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: GOLD, borderRadius: 4 },
  gaugeNotch: { position: 'absolute', top: 0, bottom: 0, width: 4, marginLeft: -2, backgroundColor: PAGE },
  fig: { flexDirection: 'row', alignItems: 'stretch' },
  figCell: { flex: 1 },
  figCellLine: { paddingLeft: 14, borderLeftWidth: 1, borderLeftColor: 'rgba(10,10,10,0.14)' },
  figN: { fontFamily: Fonts.ttBold, fontSize: 19, letterSpacing: -0.85, lineHeight: 20, color: INK, fontVariant: ['tabular-nums'] },
  figL: { fontFamily: Fonts.ttDemiBold, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: INK_62, marginTop: 6 },

  // Action cards
  act: {
    marginTop: 16, backgroundColor: '#FFFFFF', borderRadius: 17, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(10,10,10,0.07)',
  },
  actHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
  actBadge: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actBadgeT: { fontFamily: Fonts.ttBold, fontSize: 14, color: INK },
  actBody: { flex: 1, minWidth: 0, gap: 2 },
  actTitle: { fontFamily: Fonts.ttDemiBold, fontSize: 13.5, letterSpacing: -0.25, color: INK },
  actSub: { fontFamily: Fonts.ttRegular, fontSize: 10.5, color: INK_62 },
  actChev: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#F4F2EC', alignItems: 'center', justifyContent: 'center' },
  actInner: { borderTopWidth: 1, borderTopColor: 'rgba(10,10,10,0.07)', padding: 10, gap: 8 },

  qRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingVertical: 12, paddingLeft: 15, paddingRight: 14,
    borderTopWidth: 1, borderTopColor: 'rgba(10,10,10,0.07)',
  },
  qMark: { width: 17, fontFamily: Fonts.ttBold, fontSize: 24, lineHeight: 24, color: GOLD },
  qBody: { flex: 1, minWidth: 0, gap: 3 },
  qText: { fontFamily: Fonts.ttDemiBold, fontSize: 13, letterSpacing: -0.2, lineHeight: 18, color: INK },
  qMeta: { fontFamily: Fonts.ttRegular, fontSize: 10.5, color: INK_62 },
  qBtn: { height: 28, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(10,10,10,0.16)', alignItems: 'center', justifyContent: 'center' },
  qBtnT: { fontFamily: Fonts.ttDemiBold, fontSize: 11, color: 'rgba(10,10,10,0.68)' },

  // Section heads
  sh: { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingTop: 20, paddingBottom: 9 },
  shT: { fontFamily: Fonts.ttDemiBold, fontSize: 9.5, letterSpacing: 1.6, textTransform: 'uppercase', color: INK_62 },
  shR: { flex: 1, textAlign: 'right', fontFamily: Fonts.ttRegular, fontSize: 11, color: INK_62 },
  empty: { fontFamily: Fonts.ttRegular, fontSize: 13, lineHeight: 19, color: INK_62 },

  // Focus points
  card: { backgroundColor: '#FFFFFF', borderRadius: 17, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(10,10,10,0.06)' },
  fp: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  fpLine: { borderTopWidth: 1, borderTopColor: 'rgba(10,10,10,0.07)' },
  tick: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: 'rgba(10,10,10,0.18)', alignItems: 'center', justifyContent: 'center' },
  tickOn: { borderColor: GOLD },
  tickDone: { backgroundColor: GOLD },
  fpBody: { flex: 1, minWidth: 0, gap: 2 },
  fpName: { fontFamily: Fonts.ttDemiBold, fontSize: 14, letterSpacing: -0.25, lineHeight: 18, color: INK },
  fpMeta: { fontFamily: Fonts.ttRegular, fontSize: 10.5, color: INK_62 },
  fpCritical: { fontFamily: Fonts.ttDemiBold, color: RED },
  fpProgress: { fontFamily: Fonts.ttBold, fontSize: 13, letterSpacing: -0.26, color: GOLD_INK, fontVariant: ['tabular-nums'] },

  // Practice timeline
  tlRow: { flexDirection: 'row', gap: 13 },
  tlLine: { width: 22, alignItems: 'center' },
  tlSeg: { width: 1, flex: 1, backgroundColor: 'rgba(10,10,10,0.14)' },
  tlDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: GOLD, marginVertical: 5 },
  // The lesson: a black dot in a faint ring.
  tlHalo: { width: 17, height: 17, borderRadius: 8.5, backgroundColor: 'rgba(10,10,10,0.1)', alignItems: 'center', justifyContent: 'center', marginVertical: 2 },
  tlDotLesson: { width: 11, height: 11, borderRadius: 5.5, backgroundColor: INK },
  tlBody: { flex: 1, minWidth: 0, gap: 3, paddingTop: 2, paddingBottom: 16 },
  tlLabel: { fontFamily: Fonts.ttDemiBold, fontSize: 9.5, letterSpacing: 1.2, textTransform: 'uppercase', color: INK_62 },
  tlTitle: { fontFamily: Fonts.ttDemiBold, fontSize: 14, letterSpacing: -0.25, lineHeight: 18, color: INK },
  tlTitleLesson: { fontFamily: Fonts.ttBold, fontSize: 15, letterSpacing: -0.4, lineHeight: 19, color: INK },
  tlDetail: { fontFamily: Fonts.ttRegular, fontSize: 11, color: INK_62 },
});

// Question sheet styles
const qs = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(10,10,10,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: PAGE, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: Spacing.side, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(10,10,10,0.16)', marginBottom: 16 },
  eyebrow: { fontFamily: Fonts.ttDemiBold, fontSize: 9.5, letterSpacing: 1.6, textTransform: 'uppercase', color: GOLD_INK },
  title: { fontFamily: Fonts.ttBold, fontSize: 24, letterSpacing: -0.8, color: INK, marginTop: 6, marginBottom: 14 },

  bubble: {
    flexDirection: 'row', gap: 10, backgroundColor: '#FFFFFF', borderRadius: 17, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: 'rgba(10,10,10,0.06)',
  },
  qm: { width: 15, fontFamily: Fonts.ttBold, fontSize: 24, lineHeight: 24, color: GOLD },
  bubbleText: { fontFamily: Fonts.ttDemiBold, fontSize: 14.5, letterSpacing: -0.25, lineHeight: 20, color: INK },
  bubbleMeta: { fontFamily: Fonts.ttRegular, fontSize: 11, color: INK_62, marginTop: 5 },

  ctx: { backgroundColor: '#FFFFFF', borderRadius: 17, borderWidth: 1, borderColor: 'rgba(10,10,10,0.06)', overflow: 'hidden', marginBottom: 16 },
  ctxHead: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, paddingVertical: 12 },
  ctxDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: GOLD },
  ctxName: { fontFamily: Fonts.ttDemiBold, fontSize: 14, letterSpacing: -0.25, color: INK },
  ctxMeta: { fontFamily: Fonts.ttRegular, fontSize: 10.5, color: INK_62, marginTop: 2 },
  ctxBody: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 11, gap: 5, borderTopWidth: 1, borderTopColor: 'rgba(10,10,10,0.07)' },
  ctxLabel: { fontFamily: Fonts.ttBold, fontSize: 9, letterSpacing: 1.35, textTransform: 'uppercase', color: INK_62, marginTop: 5 },
  ctxText: { fontFamily: Fonts.ttRegular, fontSize: 12.5, lineHeight: 18, color: 'rgba(10,10,10,0.75)' },
  ctxActions: { flexDirection: 'row', gap: 8, marginTop: 11 },
  ctxBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 13, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(10,10,10,0.16)',
  },
  ctxBtnT: { fontFamily: Fonts.ttDemiBold, fontSize: 12, color: INK },

  label: { fontFamily: Fonts.ttDemiBold, fontSize: 9.5, letterSpacing: 1.6, textTransform: 'uppercase', color: INK_62, marginBottom: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 9 },
  input: {
    flex: 1, minHeight: 50, maxHeight: 130, backgroundColor: '#FFFFFF', borderRadius: 17, paddingHorizontal: 15, paddingVertical: 14,
    borderWidth: 1, borderColor: 'rgba(10,10,10,0.1)', fontFamily: Fonts.ttRegular, fontSize: 14, lineHeight: 19, color: INK,
  },
  sendBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: 'rgba(10,10,10,0.08)' },
  dismissBtn: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  dismissText: { fontFamily: Fonts.ttDemiBold, fontSize: 13.5, color: 'rgba(10,10,10,0.7)' },
});
