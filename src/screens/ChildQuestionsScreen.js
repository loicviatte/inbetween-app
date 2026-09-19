// A parent's window on their child's questions to the coach (parent accounts
// only, from Train's header): every question the child asked, the ones still
// waiting first, and — tap one — the exchange as it happened. Read only: the
// parent sees, the child and the coach talk.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fonts } from '../theme';
import { getChildQuestions, getUser } from '../storage/storage';
import { dateLabel, dayLabel } from '../utils/dates';
import BottomSheet from '../components/BottomSheet';
import { Pulse, Bone } from '../components/GroupSwitchSkeleton';

const PAGE = '#F2F0EB';
const INK = '#0A0A0A';
const INK_62 = 'rgba(10,10,10,0.62)';
const INK_45 = 'rgba(10,10,10,0.45)';
const LINE = 'rgba(10,10,10,0.12)';
const HAIR = 'rgba(10,10,10,0.07)';
const TILE = '#F4F2EC';
const GOLD_100 = '#FCEFC9';
const GOLD_INK = '#8A6414';
const SIDE = 20;

// The session screen appends the focus point it was asked from: "… [Focus: X]".
function splitFocus(message) {
  const m = /\s*\[Focus:\s*([^\]]+)\]\s*$/i.exec(message || '');
  return m ? { text: message.slice(0, m.index).trim(), focus: m[1].trim() } : { text: (message || '').trim(), focus: null };
}

const firstName = (name) => (name || '').trim().split(/\s+/)[0] || '';

// What became of a question: a written answer, one given in a lesson, closed
// without one, or still waiting.
function outcomeOf(q) {
  if (q.status === 'replied' && q.covered_class_input_id) return 'lesson';
  if (q.status === 'replied' && q.reply === 'Covered in your last lesson.') return 'lesson';
  if (q.status === 'replied' && q.reply) return 'written';
  if (q.status === 'dismissed') return 'closed';
  return 'waiting';
}

function Marker({ label, count }) {
  return (
    <View style={s.mk}>
      <Text style={s.mkT}>{label}</Text>
      <View style={s.mkLine} />
      <Text style={s.mkN}>{count}</Text>
    </View>
  );
}

function Row({ q, first, onPress }) {
  const { text, focus } = splitFocus(q.message);
  const outcome = outcomeOf(q);
  const answered = outcome === 'written' || outcome === 'lesson';
  const meta = [`Asked ${dayLabel(q.created_at)}`, focus].filter(Boolean).join(' · ');
  return (
    <Pressable
      style={({ pressed }) => [s.row, !first && s.rowSep, pressed && { backgroundColor: '#FBFAF7' }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${text}. ${answered ? 'Answered' : outcome === 'closed' ? 'Closed' : 'Waiting for an answer'}`}
    >
      <View style={s.body}>
        <Text style={s.q} numberOfLines={3}>{text}</Text>
        <Text style={s.meta} numberOfLines={1}>{meta}</Text>
      </View>
      {answered ? (
        <View style={s.replied}>
          <Ionicons name="chatbubble-ellipses" size={15} color={GOLD_INK} />
        </View>
      ) : (
        <Text style={s.state}>{outcome === 'closed' ? 'Closed' : 'Waiting'}</Text>
      )}
      <Ionicons name="chevron-forward" size={13} color="rgba(10,10,10,0.3)" />
    </Pressable>
  );
}

function Thread({ q, child }) {
  if (!q) return null;
  const { text, focus } = splitFocus(q.message);
  const outcome = outcomeOf(q);
  const coach = firstName(q.coach?.name) || 'The coach';
  const lessonDay = q.lesson?.created_at ? dateLabel(q.lesson.created_at) : null;
  return (
    <View style={s.thread}>
      <Text style={s.sheetTitle}>Question to {coach}</Text>
      {!!focus && <Text style={s.sheetFocus}>About · {focus}</Text>}

      <View style={s.msg}>
        <Text style={s.who}>{child || 'Your child'} · {dayLabel(q.created_at)}</Text>
        <View style={s.bubble}><Text style={s.bubbleT}>{text}</Text></View>
      </View>

      {outcome === 'written' && (
        <View style={[s.msg, s.msgCoach]}>
          <Text style={[s.who, s.whoCoach]}>{coach}{q.replied_at ? ` · ${dayLabel(q.replied_at)}` : ''}</Text>
          <View style={[s.bubble, s.bubbleCoach]}><Text style={[s.bubbleT, s.bubbleCoachT]}>{q.reply}</Text></View>
        </View>
      )}
      {outcome === 'lesson' && (
        <View style={s.note}>
          <Ionicons name="school-outline" size={15} color={GOLD_INK} />
          <Text style={s.noteT}>
            {coach} answered it in person, in {lessonDay ? `the lesson of ${lessonDay}` : 'a lesson'}.
          </Text>
        </View>
      )}
      {outcome === 'closed' && (
        <View style={s.note}>
          <Ionicons name="close-circle-outline" size={15} color={INK_62} />
          <Text style={s.noteT}>{coach} closed it without a written answer.</Text>
        </View>
      )}
      {outcome === 'waiting' && (
        <View style={s.note}>
          <Ionicons name="time-outline" size={15} color={INK_62} />
          <Text style={s.noteT}>Waiting for {coach} to answer.</Text>
        </View>
      )}
    </View>
  );
}

export default function ChildQuestionsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [questions, setQuestions] = useState(null); // null while loading
  const [failed, setFailed] = useState(false);
  const [child, setChild] = useState('');
  const [open, setOpen] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [qs, u] = await Promise.all([getChildQuestions(), getUser().catch(() => null)]);
      setQuestions(qs);
      setChild(firstName(u?.name));
      setFailed(false);
    } catch {
      setFailed(true);
      setQuestions((prev) => prev || []);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const waiting = (questions || []).filter((q) => outcomeOf(q) === 'waiting');
  const done = (questions || []).filter((q) => outcomeOf(q) !== 'waiting');
  const coach = firstName(questions?.find((q) => q.coach?.name)?.coach?.name);

  return (
    <View style={s.page}>
      <SafeAreaView style={s.page} edges={['top', 'left', 'right']}>
        <View style={s.top}>
          <TouchableOpacity style={s.back} onPress={() => navigation.goBack()} activeOpacity={0.7}
            accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={19} color={INK} />
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.h1} numberOfLines={1}>Questions</Text>
            <Text style={s.sub} numberOfLines={1}>
              {child ? `${child} and ${coach || 'their coach'}` : 'Your child and their coach'}
            </Text>
          </View>
        </View>

        {questions === null ? (
          <Pulse style={s.list}>
            <View style={s.mk}><Bone w={70} h={9} r={3} /></View>
            <View style={s.card}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={[s.row, i > 0 && s.rowSep]}>
                  <View style={[s.body, { gap: 7 }]}>
                    <Bone w={i % 2 ? '70%' : '86%'} h={12} r={4} />
                    <Bone w="40%" h={9} r={4} />
                  </View>
                </View>
              ))}
            </View>
          </Pulse>
        ) : (
          <ScrollView
            contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 40 }]}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={INK_45} />}
          >
            {questions.length === 0 ? (
              <View style={s.empty}>
                <View style={s.emptyIcon}><Ionicons name="chatbubbles-outline" size={22} color={GOLD_INK} /></View>
                <Text style={s.emptyT}>{failed ? 'Couldn’t load the questions' : 'No questions yet'}</Text>
                <Text style={s.emptyB}>
                  {failed
                    ? 'Check your connection and pull to try again.'
                    : `When ${child || 'your child'} asks ${coach || 'their coach'} something while training, it shows up here with the answer.`}
                </Text>
              </View>
            ) : (
              <>
                {waiting.length > 0 && (
                  <>
                    <Marker label="Waiting for an answer" count={waiting.length} />
                    <View style={s.card}>
                      {waiting.map((q, i) => <Row key={q.id} q={q} first={i === 0} onPress={() => setOpen(q)} />)}
                    </View>
                  </>
                )}
                {done.length > 0 && (
                  <>
                    <Marker label="Answered" count={done.length} />
                    <View style={s.card}>
                      {done.map((q, i) => <Row key={q.id} q={q} first={i === 0} onPress={() => setOpen(q)} />)}
                    </View>
                  </>
                )}
                <Text style={s.foot}>You can read these; only {child || 'your child'} and {coach || 'the coach'} write them.</Text>
              </>
            )}
          </ScrollView>
        )}
      </SafeAreaView>

      <BottomSheet visible={!!open} onClose={() => setOpen(null)} sheetStyle={s.sheet}>
        <View style={s.handle} />
        <Thread q={open} child={child} />
        <TouchableOpacity style={s.close} onPress={() => setOpen(null)} activeOpacity={0.8} accessibilityRole="button">
          <Text style={s.closeT}>Close</Text>
        </TouchableOpacity>
      </BottomSheet>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: PAGE },
  top: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingTop: 6, paddingHorizontal: SIDE },
  back: {
    width: 36, height: 36, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    shadowColor: INK, shadowOpacity: 0.07, shadowOffset: { width: 0, height: 1 }, shadowRadius: 2, elevation: 1,
  },
  h1: { fontFamily: Fonts.bold, fontSize: 26, letterSpacing: -1.04, lineHeight: 30, color: INK },
  sub: { fontFamily: Fonts.regular, fontSize: 12, color: INK_62, marginTop: 1 },

  list: { paddingHorizontal: SIDE, paddingTop: 6 },
  mk: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 18, paddingBottom: 9, paddingHorizontal: 2 },
  mkT: { fontFamily: Fonts.semiBold, fontSize: 9.5, letterSpacing: 1.6, textTransform: 'uppercase', color: INK_62 },
  mkLine: { flex: 1, height: 1, backgroundColor: LINE },
  mkN: { fontFamily: Fonts.bold, fontSize: 12, color: INK, fontVariant: ['tabular-nums'] },

  card: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: HAIR, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 15, backgroundColor: '#FFFFFF' },
  rowSep: { borderTopWidth: 1, borderTopColor: HAIR },
  body: { flex: 1, minWidth: 0, gap: 4 },
  q: { fontFamily: Fonts.semiBold, fontSize: 14.5, lineHeight: 19.5, letterSpacing: -0.2, color: INK },
  meta: { fontFamily: Fonts.regular, fontSize: 11.5, color: INK_62 },
  replied: { width: 30, height: 30, borderRadius: 15, backgroundColor: GOLD_100, alignItems: 'center', justifyContent: 'center' },
  state: { fontFamily: Fonts.semiBold, fontSize: 11, color: INK_45 },
  foot: { fontFamily: Fonts.regular, fontSize: 11.5, lineHeight: 17, color: INK_45, textAlign: 'center', paddingTop: 16, paddingHorizontal: 12 },

  empty: { paddingTop: 60, paddingHorizontal: 20, alignItems: 'center', gap: 8 },
  emptyIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: GOLD_100, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyT: { fontFamily: Fonts.semiBold, fontSize: 16, color: INK, textAlign: 'center' },
  emptyB: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19, color: INK_62, textAlign: 'center' },

  sheet: { backgroundColor: PAGE, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: SIDE, paddingTop: 10, paddingBottom: 34 },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(10,10,10,0.18)', marginBottom: 16 },
  thread: { gap: 14 },
  sheetTitle: { fontFamily: Fonts.bold, fontSize: 21, letterSpacing: -0.7, color: INK },
  sheetFocus: { fontFamily: Fonts.semiBold, fontSize: 10, letterSpacing: 1.3, textTransform: 'uppercase', color: GOLD_INK, marginTop: -8 },
  msg: { gap: 5, alignItems: 'flex-start' },
  msgCoach: { alignItems: 'flex-end' },
  who: { fontFamily: Fonts.semiBold, fontSize: 10.5, color: INK_62, paddingHorizontal: 4 },
  whoCoach: { color: GOLD_INK },
  bubble: { maxWidth: '88%', backgroundColor: '#FFFFFF', borderRadius: 16, borderTopLeftRadius: 5, paddingVertical: 11, paddingHorizontal: 14, borderWidth: 1, borderColor: HAIR },
  bubbleCoach: { backgroundColor: INK, borderColor: INK, borderTopLeftRadius: 16, borderTopRightRadius: 5 },
  bubbleT: { fontFamily: Fonts.regular, fontSize: 14.5, lineHeight: 20.5, color: INK },
  bubbleCoachT: { color: '#FFFFFF' },
  note: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: TILE, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 13 },
  noteT: { flex: 1, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18, color: INK },
  close: { marginTop: 20, height: 48, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(10,10,10,0.16)', alignItems: 'center', justifyContent: 'center' },
  closeT: { fontFamily: Fonts.semiBold, fontSize: 14.5, color: INK },
});
