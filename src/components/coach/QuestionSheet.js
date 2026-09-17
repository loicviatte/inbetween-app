// The coach answering a question a student asked — from the student's card, or
// from Action needed. Under the question sits what it was asked about: the
// focus point and the lesson it was set in, so the coach can answer with the
// context in front of them (or go read it, and come back to their draft).

import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import BottomSheet from '../BottomSheet';
import { supabase } from '../../services/supabase/client';
import { replyToQuestion, dismissQuestion } from '../../storage/coachStorage';
import { Fonts, Spacing } from '../../theme';
import { L, dayLabel, daysAgo } from './LessonUI';

const TIER_LABEL = { critical: 'Critical focus', important: 'Important focus', supporting: 'Supporting focus' };

// A question asked while training carries the focus it came from, as a tag
// FocusSessionScreen appends: "… [Focus: Staccato footwork]".
export function splitFocusTag(message) {
  const m = /\s*\[Focus:\s*([^\]]+)\]\s*$/i.exec(message || '');
  if (!m) return { text: (message || '').trim(), focusName: null };
  return { text: (message || '').slice(0, m.index).trim(), focusName: m[1].trim() };
}

function agoLabel(date) {
  const n = daysAgo(date);
  return n <= 0 ? 'Today' : n === 1 ? 'Yesterday' : `${n} days ago`;
}

/**
 * Props: visible, question (coach_messages row), studentId, focusPoints (what
 * the caller already has, used when the lookup finds nothing), reply +
 * onReplyChange (the draft lives in the caller so leaving for context doesn't
 * lose it), onOpenFocus(fp), onOpenClass(classId), onClose, onDone.
 */
export default function QuestionSheet({
  visible, question, studentId, focusPoints, reply, onReplyChange,
  onOpenFocus, onOpenClass, onClose, onDone,
}) {
  const insets = useSafeAreaInsets();
  const [sending, setSending] = useState(false);
  const [context, setContext] = useState(null); // { focus, cls }, null while loading
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
    <BottomSheet
      visible={visible}
      onClose={onClose}
      avoidKeyboard
      overlayColor="rgba(10,10,10,0.45)"
      sheetStyle={[qs.sheet, { paddingBottom: insets.bottom + 16 }]}
    >
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
                {!!context.focus?.id && !!onOpenFocus && (
                  <TouchableOpacity style={qs.ctxBtn} activeOpacity={0.8} onPress={() => onOpenFocus(context.focus)}
                    accessibilityRole="button">
                    <Ionicons name="locate-outline" size={13} color={L.INK} />
                    <Text style={qs.ctxBtnT}>The focus point</Text>
                  </TouchableOpacity>
                )}
                {!!context.cls?.id && !!onOpenClass && (
                  <TouchableOpacity style={qs.ctxBtn} activeOpacity={0.8} onPress={() => onOpenClass(context.cls.id)}
                    accessibilityRole="button">
                    <Ionicons name="document-text-outline" size={13} color={L.INK} />
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
            ? <ActivityIndicator color={L.INK} size="small" />
            : <Ionicons name="arrow-up" size={19} color={reply.trim() ? L.INK : 'rgba(10,10,10,0.35)'} />}
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={qs.dismissBtn} onPress={handleDismiss} activeOpacity={0.7}>
        <Text style={qs.dismissText}>I'll explain in person</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

const qs = StyleSheet.create({
  sheet: { backgroundColor: L.PAGE, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: Spacing.side, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(10,10,10,0.16)', marginBottom: 16 },
  eyebrow: { fontFamily: Fonts.ttDemiBold, fontSize: 9.5, letterSpacing: 1.6, textTransform: 'uppercase', color: L.GOLD_INK },
  title: { fontFamily: Fonts.ttBold, fontSize: 24, letterSpacing: -0.8, color: L.INK, marginTop: 6, marginBottom: 14 },

  bubble: {
    flexDirection: 'row', gap: 10, backgroundColor: '#FFFFFF', borderRadius: 17, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: 'rgba(10,10,10,0.06)',
  },
  qm: { width: 15, fontFamily: Fonts.ttBold, fontSize: 24, lineHeight: 24, color: L.GOLD },
  bubbleText: { fontFamily: Fonts.ttDemiBold, fontSize: 14.5, letterSpacing: -0.25, lineHeight: 20, color: L.INK },
  bubbleMeta: { fontFamily: Fonts.ttRegular, fontSize: 11, color: L.INK_62, marginTop: 5 },

  ctx: { backgroundColor: '#FFFFFF', borderRadius: 17, borderWidth: 1, borderColor: 'rgba(10,10,10,0.06)', overflow: 'hidden', marginBottom: 16 },
  ctxHead: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, paddingVertical: 12 },
  ctxDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: L.GOLD },
  ctxName: { fontFamily: Fonts.ttDemiBold, fontSize: 14, letterSpacing: -0.25, color: L.INK },
  ctxMeta: { fontFamily: Fonts.ttRegular, fontSize: 10.5, color: L.INK_62, marginTop: 2 },
  ctxBody: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 11, gap: 5, borderTopWidth: 1, borderTopColor: 'rgba(10,10,10,0.07)' },
  ctxLabel: { fontFamily: Fonts.ttBold, fontSize: 9, letterSpacing: 1.35, textTransform: 'uppercase', color: L.INK_62, marginTop: 5 },
  ctxText: { fontFamily: Fonts.ttRegular, fontSize: 12.5, lineHeight: 18, color: 'rgba(10,10,10,0.75)' },
  ctxActions: { flexDirection: 'row', gap: 8, marginTop: 11 },
  ctxBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 13, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(10,10,10,0.16)',
  },
  ctxBtnT: { fontFamily: Fonts.ttDemiBold, fontSize: 12, color: L.INK },

  label: { fontFamily: Fonts.ttDemiBold, fontSize: 9.5, letterSpacing: 1.6, textTransform: 'uppercase', color: L.INK_62, marginBottom: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 9 },
  input: {
    flex: 1, minHeight: 50, maxHeight: 130, backgroundColor: '#FFFFFF', borderRadius: 17, paddingHorizontal: 15, paddingVertical: 14,
    borderWidth: 1, borderColor: 'rgba(10,10,10,0.1)', fontFamily: Fonts.ttRegular, fontSize: 14, lineHeight: 19, color: L.INK,
  },
  sendBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: L.GOLD, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: 'rgba(10,10,10,0.08)' },
  dismissBtn: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  dismissText: { fontFamily: Fonts.ttDemiBold, fontSize: 13.5, color: 'rgba(10,10,10,0.7)' },
});
