// Answering a question a student asked while training (docs/design/answer-question.html).
// The sheet opens two-thirds up — the question in black, then Context (the focus
// point it came from and the lesson that set it) or History (what they've done
// about it since) — and the reply sits at the foot throughout. Pull the handle
// for the full screen; tap the lesson and it slides in over the sheet.

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Pressable, StyleSheet, ActivityIndicator,
  Animated, Dimensions, ScrollView, LayoutAnimation, Easing, Platform, UIManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import BottomSheet from '../BottomSheet';
import { replyToQuestion, dismissQuestion, getQuestionContext } from '../../storage/coachStorage';
import { Fonts, Spacing } from '../../theme';
import { L, dayLabel, daysAgo } from './LessonUI';

// The sheet grows to full screen with a layout animation; Android needs this on.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SCREEN_H = Dimensions.get('window').height;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TIER = { critical: 'Critical', important: 'Important', supporting: 'Supporting' };

// A question asked while training carries the focus it came from, as a tag
// FocusSessionScreen appends: "… [Focus: Staccato footwork]".
export function splitFocusTag(message) {
  const m = /\s*\[Focus:\s*([^\]]+)\]\s*$/i.exec(message || '');
  if (!m) return { text: (message || '').trim(), focusName: null };
  return { text: (message || '').slice(0, m.index).trim(), focusName: m[1].trim() };
}

function agoLabel(date) {
  const n = daysAgo(date);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}

function lessonKind(cls) {
  const t = cls?.lesson_type;
  return t === 'group' ? 'Group' : t === 'public' ? 'Public' : 'Private';
}

/**
 * Props: visible, question (coach_messages row), studentId, studentName,
 * focusPoints (what the caller already has, used if the lookup finds nothing),
 * reply + onReplyChange (the draft lives in the caller), onClose, onDone.
 */
export default function QuestionSheet({
  visible, question, studentId, studentName, focusPoints, reply, onReplyChange, onClose, onDone,
}) {
  const insets = useSafeAreaInsets();
  const [sending, setSending] = useState(false);
  const [full, setFull] = useState(false);
  const [tab, setTab] = useState('ctx');
  const [ctx, setCtx] = useState(null); // null while loading
  const lessonX = useRef(new Animated.Value(1)).current; // 1 = off to the right
  const [lessonOpen, setLessonOpen] = useState(false);

  const { text: questionText, focusName } = splitFocusTag(question?.message);
  const sheetH = full ? SCREEN_H : Math.round(SCREEN_H * 0.66);

  useEffect(() => {
    if (!visible || !question) { setCtx(null); return undefined; }
    setFull(false);
    setTab('ctx');
    closeLesson(false);
    if (!focusName) { setCtx({ focus: null, lesson: null, lessonFocuses: [], history: [], done: 0, target: 0 }); return undefined; }
    let alive = true;
    setCtx(null);
    getQuestionContext(studentId, focusName)
      .then((c) => {
        if (!alive) return;
        // Nothing found by name (renamed since?) — fall back to what the caller has.
        if (c && !c.focus) {
          const local = (focusPoints || []).find((f) => (f.name || '').trim().toLowerCase() === focusName.toLowerCase());
          if (local) c = { ...c, focus: local };
        }
        setCtx(c);
      })
      .catch(() => { if (alive) setCtx({ focus: null, lesson: null, lessonFocuses: [], history: [], done: 0, target: 0 }); });
    return () => { alive = false; };
  }, [visible, question?.id, focusName, studentId]);

  function openLesson() {
    setLessonOpen(true);
    Animated.timing(lessonX, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }
  function closeLesson(animate = true) {
    if (!animate) { lessonX.setValue(1); setLessonOpen(false); return; }
    Animated.timing(lessonX, { toValue: 1, duration: 260, easing: Easing.in(Easing.cubic), useNativeDriver: true })
      .start(({ finished }) => { if (finished) setLessonOpen(false); });
  }

  function toggleFull() {
    LayoutAnimation.configureNext({
      duration: 300,
      update: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.scaleXY },
    });
    setFull((f) => !f);
  }

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

  const focus = ctx?.focus || null;
  const lesson = ctx?.lesson || null;
  const history = ctx?.history || [];
  const who = (studentName || '').trim().split(/\s+/)[0] || 'Your student';

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      avoidKeyboard
      overlayColor="rgba(10,10,10,0.42)"
      sheetStyle={[qs.sheet, { height: sheetH, borderTopLeftRadius: full ? 0 : 26, borderTopRightRadius: full ? 0 : 26 }]}
    >
      <Pressable
        onPress={toggleFull}
        style={[qs.grab, full && { paddingTop: insets.top + 8 }]}
        accessibilityRole="button"
        accessibilityLabel={full ? 'Shrink the sheet' : 'Expand the sheet'}
      >
        <View style={[qs.grabBar, full && { width: 26 }]} />
      </Pressable>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
        <View style={qs.head}>
          <View style={qs.q}>
            <Text style={qs.qT}>{questionText || question.message}</Text>
            <Text style={qs.qS}>{who} · {agoLabel(question.created_at)}</Text>
          </View>
        </View>

        {!!focusName && (
          <View style={qs.tabs}>
            {[['ctx', 'Context'], ['hist', 'History']].map(([key, label]) => (
              <TouchableOpacity key={key} style={[qs.tab, tab === key && qs.tabOn]} onPress={() => setTab(key)} activeOpacity={0.7}
                accessibilityRole="tab" accessibilityState={{ selected: tab === key }}>
                <Text style={[qs.tabT, tab === key && { color: L.INK }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {!focusName ? (
          <Text style={qs.plain}>Asked on its own, without a focus point.</Text>
        ) : ctx == null ? (
          <View style={qs.loading}><ActivityIndicator color={L.GOLD} /></View>
        ) : tab === 'ctx' ? (
          <View style={qs.pane}>
            <View style={qs.blk}>
              <View style={qs.blkR1}>
                <View style={qs.dot} />
                <Text style={qs.blkName} numberOfLines={2}>{focus?.name || focusName}</Text>
                {!!focus?.tier && <Text style={qs.blkTier}>{TIER[focus.tier] || 'Focus'}</Text>}
              </View>
              {!!focus?.subtitle && <Text style={qs.blkP}>{focus.subtitle}</Text>}
              <Text style={qs.mini}>
                {ctx.done > 0
                  ? <><Text style={qs.miniB}>{ctx.done} of {ctx.target}</Text> sessions done</>
                  : 'No practice yet'}
              </Text>
            </View>

            {!!lesson && (
              <TouchableOpacity style={qs.lrow} activeOpacity={0.85} onPress={openLesson} accessibilityRole="button">
                <View style={qs.dt}>
                  <Text style={qs.dtN}>{new Date(lesson.created_at).getDate()}</Text>
                  <Text style={qs.dtM}>{MONTHS[new Date(lesson.created_at).getMonth()]}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <Text style={qs.lrowT} numberOfLines={2}>{lesson.title || lesson.dance || 'The lesson it was set in'}</Text>
                  <Text style={qs.lrowS} numberOfLines={1}>
                    {lessonKind(lesson)}{lesson.durationMin ? ` · ${lesson.durationMin} min` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={13} color="rgba(10,10,10,0.3)" />
              </TouchableOpacity>
            )}

            {!focus && <Text style={qs.plain}>“{focusName}” isn’t on their plan any more.</Text>}
          </View>
        ) : (
          <View style={qs.pane}>
            {history.length === 0 && !lesson ? (
              <Text style={qs.plain}>Nothing logged on this focus point yet.</Text>
            ) : (
              <View>
                {history.map((h, i) => (
                  <View key={h.id} style={qs.hr}>
                    <View style={qs.ln}>
                      <View style={[qs.seg, i === 0 && qs.segOff]} />
                      <View style={qs.lnDot} />
                      <View style={qs.seg} />
                    </View>
                    <View style={qs.hrBody}>
                      <Text style={qs.hrLabel}>{dayLabel(h.date)}</Text>
                      <Text style={qs.hrT}>Practised alone</Text>
                      {!!h.minutes && <Text style={qs.hrS}>{h.minutes} min</Text>}
                    </View>
                  </View>
                ))}
                {!!lesson && (
                  <Pressable onPress={openLesson} style={({ pressed }) => [qs.hr, pressed && { opacity: 0.7 }]} accessibilityRole="button">
                    <View style={qs.ln}>
                      <View style={[qs.seg, history.length === 0 && qs.segOff]} />
                      <View style={qs.lnHalo}><View style={qs.lnDotSet} /></View>
                      <View style={[qs.seg, qs.segOff]} />
                    </View>
                    <View style={[qs.hrBody, { paddingBottom: 6 }]}>
                      <Text style={[qs.hrLabel, { color: L.GOLD_INK }]}>{dayLabel(lesson.created_at)} · set here</Text>
                      <Text style={qs.hrTSet}>{lesson.title || lesson.dance || 'The lesson'}</Text>
                      <Text style={qs.hrS}>
                        {lessonKind(lesson)}{lesson.durationMin ? ` · ${lesson.durationMin} min` : ''}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={13} color="rgba(10,10,10,0.3)" style={{ alignSelf: 'center' }} />
                  </Pressable>
                )}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <View style={[qs.rep, { paddingBottom: insets.bottom + 10 }]}>
        <View style={qs.fld}>
          <TextInput
            style={qs.input}
            value={reply}
            onChangeText={onReplyChange}
            placeholder="Type your reply…"
            placeholderTextColor="rgba(10,10,10,0.45)"
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[qs.send, !reply.trim() && qs.sendOff]}
            onPress={handleReply}
            disabled={sending || !reply.trim()}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Send the reply"
          >
            {sending
              ? <ActivityIndicator color={L.INK} size="small" />
              : <Ionicons name="arrow-up" size={18} color={reply.trim() ? L.INK : 'rgba(10,10,10,0.35)'} />}
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={qs.alt} onPress={handleDismiss} activeOpacity={0.7}>
          <Text style={qs.altT}>I'll explain in person</Text>
        </TouchableOpacity>
      </View>

      {/* The lesson, over the sheet — back returns to the reply untouched. */}
      {lessonOpen && !!lesson && (
        <Animated.View
          style={[
            qs.lesson,
            { transform: [{ translateX: lessonX.interpolate({ inputRange: [0, 1], outputRange: [0, Dimensions.get('window').width] }) }] },
          ]}
        >
          <View style={[qs.lbar, { paddingTop: (full ? insets.top : 0) + 14 }]}>
            <TouchableOpacity style={qs.lback} onPress={() => closeLesson()} activeOpacity={0.8}
              accessibilityRole="button" accessibilityLabel="Back to the question">
              <Ionicons name="chevron-back" size={16} color={L.INK} />
            </TouchableOpacity>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={qs.lbarT} numberOfLines={1}>{lesson.title || lesson.dance || 'The lesson'}</Text>
              <Text style={qs.lbarS} numberOfLines={1}>
                {lessonKind(lesson)} · {dayLabel(lesson.created_at)}{lesson.durationMin ? ` · ${lesson.durationMin} min` : ''}
              </Text>
            </View>
          </View>
          <ScrollView contentContainerStyle={qs.lbody} showsVerticalScrollIndicator={false}>
            <View style={qs.lsec}>
              <Text style={qs.lsecH}>What we worked on</Text>
              <Text style={qs.lsecP}>{lesson.class_summary || 'No summary was written for this lesson.'}</Text>
            </View>
            {(ctx?.lessonFocuses || []).length > 0 && (
              <View style={qs.lsec}>
                <Text style={qs.lsecH}>Focus points set that day</Text>
                {ctx.lessonFocuses.map((f, i) => (
                  <View key={f.id} style={[qs.fp2, i > 0 && qs.fp2Line]}>
                    <View style={qs.dot} />
                    <Text style={qs.fp2T} numberOfLines={1}>{f.name}</Text>
                    {!!f.tier && <Text style={qs.fp2Tier}>{TIER[f.tier] || 'Focus'}</Text>}
                  </View>
                ))}
              </View>
            )}
            {!!lesson.ai_primary_focus && (
              <View style={qs.lsec}>
                <Text style={qs.lsecH}>The main thread</Text>
                <Text style={qs.lsecP}>{lesson.ai_primary_focus}</Text>
              </View>
            )}
          </ScrollView>
        </Animated.View>
      )}
    </BottomSheet>
  );
}

const qs = StyleSheet.create({
  sheet: { backgroundColor: L.PAGE, overflow: 'hidden' },
  grab: { alignItems: 'center', paddingTop: 9, paddingBottom: 3 },
  grabBar: { width: 46, height: 5, borderRadius: 3, backgroundColor: 'rgba(10,10,10,0.22)' },

  head: { paddingHorizontal: Spacing.side, paddingTop: 13 },
  q: { backgroundColor: L.INK, borderRadius: 18, paddingVertical: 15, paddingHorizontal: 16, gap: 6 },
  qT: { fontFamily: Fonts.ttDemiBold, fontSize: 16, letterSpacing: -0.3, lineHeight: 21, color: '#FFFFFF' },
  qS: { fontFamily: Fonts.ttRegular, fontSize: 11, color: 'rgba(255,255,255,0.7)' },

  tabs: { flexDirection: 'row', gap: 20, marginHorizontal: Spacing.side, marginTop: 13, borderBottomWidth: 1, borderBottomColor: L.LINE },
  tab: { paddingTop: 12, paddingBottom: 9, marginBottom: -1, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: L.GOLD },
  tabT: { fontFamily: Fonts.ttDemiBold, fontSize: 14, letterSpacing: -0.28, color: 'rgba(10,10,10,0.6)' },

  pane: { paddingHorizontal: Spacing.side, paddingTop: 14, gap: 9 },
  loading: { paddingVertical: 34, alignItems: 'center' },
  plain: { paddingHorizontal: Spacing.side, paddingTop: 16, fontFamily: Fonts.ttRegular, fontSize: 13, lineHeight: 19, color: L.INK_62 },

  blk: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(10,10,10,0.06)', paddingVertical: 14, paddingHorizontal: 15, gap: 7 },
  blkR1: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: L.GOLD },
  blkName: { flex: 1, minWidth: 0, fontFamily: Fonts.ttDemiBold, fontSize: 14.5, letterSpacing: -0.26, color: L.INK },
  blkTier: { fontFamily: Fonts.ttBold, fontSize: 10, letterSpacing: 0.9, textTransform: 'uppercase', color: L.GOLD_INK },
  blkP: { fontFamily: Fonts.ttRegular, fontSize: 12.5, lineHeight: 18, color: 'rgba(10,10,10,0.68)' },
  mini: { fontFamily: Fonts.ttRegular, fontSize: 11.5, color: L.INK_62 },
  miniB: { fontFamily: Fonts.ttDemiBold, color: L.INK },

  lrow: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: '#FFFFFF', borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(10,10,10,0.06)', paddingVertical: 13, paddingHorizontal: 15,
  },
  dt: { width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(34,49,77,0.08)', alignItems: 'center', justifyContent: 'center' },
  dtN: { fontFamily: Fonts.ttBold, fontSize: 15, letterSpacing: -0.6, lineHeight: 16, color: L.NAVY },
  dtM: { fontFamily: Fonts.ttBold, fontSize: 8, letterSpacing: 0.8, textTransform: 'uppercase', color: L.INK_62 },
  lrowT: { fontFamily: Fonts.ttDemiBold, fontSize: 14, letterSpacing: -0.25, color: L.INK },
  lrowS: { fontFamily: Fonts.ttRegular, fontSize: 10.5, color: L.INK_62 },

  hr: { flexDirection: 'row', gap: 13 },
  ln: { width: 20, alignItems: 'center' },
  seg: { width: 1, flex: 1, backgroundColor: 'rgba(10,10,10,0.14)' },
  segOff: { backgroundColor: 'transparent' },
  lnDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: L.GOLD, marginVertical: 5 },
  lnHalo: { width: 17, height: 17, borderRadius: 8.5, backgroundColor: 'rgba(10,10,10,0.1)', alignItems: 'center', justifyContent: 'center', marginVertical: 2 },
  lnDotSet: { width: 11, height: 11, borderRadius: 5.5, backgroundColor: L.INK },
  hrBody: { flex: 1, minWidth: 0, gap: 3, paddingTop: 1, paddingBottom: 15 },
  hrLabel: { fontFamily: Fonts.ttDemiBold, fontSize: 9.5, letterSpacing: 1.2, textTransform: 'uppercase', color: L.INK_62 },
  hrT: { fontFamily: Fonts.ttDemiBold, fontSize: 13.5, letterSpacing: -0.25, lineHeight: 18, color: L.INK },
  hrTSet: { fontFamily: Fonts.ttBold, fontSize: 14, letterSpacing: -0.35, lineHeight: 18, color: L.INK },
  hrS: { fontFamily: Fonts.ttRegular, fontSize: 11, color: L.INK_62 },

  rep: { paddingTop: 12, paddingHorizontal: Spacing.side, backgroundColor: L.PAGE },
  fld: { flexDirection: 'row', alignItems: 'flex-end', gap: 9 },
  input: {
    flex: 1, minWidth: 0, minHeight: 46, maxHeight: 110, borderRadius: 23, paddingHorizontal: 16, paddingVertical: 13,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(10,10,10,0.12)',
    fontFamily: Fonts.ttRegular, fontSize: 14.5, lineHeight: 19, color: L.INK,
  },
  send: { width: 46, height: 46, borderRadius: 23, backgroundColor: L.GOLD, alignItems: 'center', justifyContent: 'center' },
  sendOff: { backgroundColor: 'rgba(10,10,10,0.08)' },
  alt: { paddingTop: 12, paddingBottom: 2, alignItems: 'center' },
  altT: { fontFamily: Fonts.ttDemiBold, fontSize: 13, color: L.INK_62 },

  lesson: { ...StyleSheet.absoluteFillObject, backgroundColor: L.PAGE },
  lbar: {
    flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: Spacing.side, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: L.LINE,
  },
  lback: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(10,10,10,0.1)', alignItems: 'center', justifyContent: 'center' },
  lbarT: { fontFamily: Fonts.ttBold, fontSize: 17, letterSpacing: -0.5, color: L.INK },
  lbarS: { fontFamily: Fonts.ttRegular, fontSize: 11, color: L.INK_62, marginTop: 2 },
  lbody: { padding: Spacing.side, paddingBottom: 40, gap: 9 },
  lsec: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(10,10,10,0.06)', paddingVertical: 14, paddingHorizontal: 15, gap: 7 },
  lsecH: { fontFamily: Fonts.ttDemiBold, fontSize: 9.5, letterSpacing: 1.6, textTransform: 'uppercase', color: L.INK_62 },
  lsecP: { fontFamily: Fonts.ttRegular, fontSize: 14, lineHeight: 21, color: L.INK },
  fp2: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  fp2Line: { borderTopWidth: 1, borderTopColor: 'rgba(10,10,10,0.07)' },
  fp2T: { flex: 1, minWidth: 0, fontFamily: Fonts.ttRegular, fontSize: 13.5, color: L.INK },
  fp2Tier: { fontFamily: Fonts.ttDemiBold, fontSize: 11, color: L.INK_62 },
});
