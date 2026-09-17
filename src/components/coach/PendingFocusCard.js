// A focus point waiting on the coach (docs/design/action-needed.html): the dark
// card of the student's own Train page — where it came from, whose it is, how
// long before it publishes itself, the cue, and the note and drill folded away
// until asked for. Approve fills the width; edit and reject sit beside it.

import React from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fonts } from '../../theme';
import { L, dateLabel } from './LessonUI';

const NAVY = '#22314D';

function lessonLabel(src, groupFp) {
  const kind = src?.lesson_type === 'group' || src?.lesson_type === 'public' || groupFp
    ? 'Group'
    : src?.lesson_type === 'couple' ? 'Couple' : 'Private';
  const style = Array.isArray(src?.dance) ? src.dance[0] : src?.dance;
  const when = src?.created_at ? dateLabel(src.created_at) : null;
  const head = kind === 'Group' && style ? `${style} group` : kind;
  return [head, when].filter(Boolean).join(' · ');
}

/**
 * Props: fp, isExpanded, onToggle, studentName, onApprove, onEdit, onDelete,
 * onShowContext. `fp._rows` marks an aggregate of one group focus across
 * several students — the screen passes the aggregate through unchanged.
 */
export default function PendingFocusCard({
  fp, isExpanded, onToggle, studentName, onApprove, onEdit, onDelete, onShowContext,
}) {
  const hoursLeft = fp.coach_review_deadline
    ? Math.max(0, Math.ceil((new Date(fp.coach_review_deadline) - Date.now()) / 3600000))
    : null;
  const left = hoursLeft == null ? null
    : hoursLeft === 0 ? 'publishing now'
    : hoursLeft < 24 ? `${hoursLeft}h left`
    : `${Math.round(hoursLeft / 24)}d left`;

  const src = Array.isArray(fp.source_class_input) ? fp.source_class_input[0] : fp.source_class_input;
  const isGroup = src?.lesson_type === 'public' || src?.lesson_type === 'group' || !!fp.group_fp;

  // The student's own words on this focus, when the lesson's AI kept them.
  const fpNameLower = fp.name?.trim().toLowerCase();
  const studentNote = isGroup
    ? null
    : src?.ai_primary_focus && fpNameLower && src.ai_primary_focus.trim().toLowerCase() === fpNameLower
      ? src?.practice_point_1
      : src?.ai_secondary_focus && fpNameLower && src.ai_secondary_focus.trim().toLowerCase() === fpNameLower
        ? src?.practice_point_2
        : src?.practice_point_1 || null;

  const name = (studentName || '').trim();
  const parts = name.split(/\s+/);

  return (
    <View style={[s.card, !isGroup && s.cardSolo]}>
      <View style={s.cb}>
        <Text style={s.tag} numberOfLines={1}>{lessonLabel(src, fp.group_fp)}</Text>
        {!!name && (
          <Text style={s.ix} numberOfLines={1}>
            {parts[0]}{parts.length > 1 ? <Text style={s.ixB}> {parts.slice(1).join(' ')}</Text> : null}
          </Text>
        )}
        {!!left && <Text style={s.lft}>{left}</Text>}
      </View>

      <Text style={s.name}>{fp.name}</Text>
      {!!fp.subtitle && <Text style={s.cue}>{fp.subtitle}</Text>}

      {(!!studentNote || !!fp.drill || !!fp.context || !!onShowContext) && (
        <View style={s.fold}>
          <Pressable onPress={onToggle} style={s.summary} accessibilityRole="button"
            accessibilityState={{ expanded: !!isExpanded }}>
            <Ionicons name={isExpanded ? 'chevron-down' : 'chevron-forward'} size={11} color="rgba(255,255,255,0.7)" />
            <Text style={s.summaryT}>Note and drill</Text>
          </Pressable>

          {isExpanded && (
            <View style={s.in}>
              {!!fp.context && (
                <View>
                  <Text style={s.dt}>What happened</Text>
                  <Text style={s.dd}>{fp.context}</Text>
                </View>
              )}
              {!!studentNote && (
                <View>
                  <Text style={s.dt}>Student's note</Text>
                  <Text style={s.dd}>{studentNote}</Text>
                </View>
              )}
              {!!fp.drill && (
                <View>
                  <Text style={s.dt}>Drill</Text>
                  <Text style={s.dd}>{fp.drill}</Text>
                </View>
              )}
              {!!src && !!onShowContext && (
                <TouchableOpacity onPress={() => onShowContext(fp)} activeOpacity={0.7} accessibilityRole="button">
                  <Text style={s.link}>Open the lesson →</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}

      <View style={s.act}>
        <TouchableOpacity style={s.go} activeOpacity={0.88} onPress={() => onApprove(fp.id)} accessibilityRole="button">
          <Text style={s.goT}>Approve</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.gh} activeOpacity={0.8} onPress={() => onEdit(fp)}
          accessibilityRole="button" accessibilityLabel="Edit this focus point">
          <Ionicons name="create-outline" size={17} color="rgba(255,255,255,0.8)" />
        </TouchableOpacity>
        <TouchableOpacity style={s.gh} activeOpacity={0.8} onPress={() => onDelete(fp)}
          accessibilityRole="button" accessibilityLabel="Reject this focus point">
          <Ionicons name="close" size={18} color="rgba(255,255,255,0.8)" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: NAVY, borderRadius: 20, paddingVertical: 17, paddingHorizontal: 18, gap: 12, marginBottom: 10 },
  cardSolo: { backgroundColor: L.INK },

  cb: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  tag: { flexShrink: 1, fontFamily: Fonts.semiBold, fontSize: 9.5, letterSpacing: 1.3, textTransform: 'uppercase', color: L.GOLD },
  ix: {
    flexShrink: 1, paddingLeft: 9, borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.24)',
    fontFamily: Fonts.regular, fontSize: 11, color: 'rgba(255,255,255,0.7)',
  },
  ixB: { fontFamily: Fonts.semiBold, color: '#FFFFFF' },
  lft: { marginLeft: 'auto', fontFamily: Fonts.semiBold, fontSize: 11, color: L.GOLD, fontVariant: ['tabular-nums'] },

  name: { fontFamily: Fonts.bold, fontSize: 28, letterSpacing: -1.05, lineHeight: 29, color: '#FFFFFF' },
  cue: { fontFamily: Fonts.regular, fontSize: 13.5, lineHeight: 19, color: 'rgba(255,255,255,0.72)' },

  fold: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.18)' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 11 },
  summaryT: { fontFamily: Fonts.semiBold, fontSize: 12, color: 'rgba(255,255,255,0.7)' },
  in: { paddingTop: 11, gap: 11 },
  dt: { fontFamily: Fonts.semiBold, fontSize: 9, letterSpacing: 1.35, textTransform: 'uppercase', color: 'rgba(255,255,255,0.58)' },
  dd: { fontFamily: Fonts.regular, fontSize: 13.5, lineHeight: 19.5, color: '#FFFFFF', marginTop: 4 },
  link: { fontFamily: Fonts.semiBold, fontSize: 12.5, color: L.GOLD },

  act: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  go: { flex: 1, height: 48, borderRadius: 999, backgroundColor: L.GOLD, alignItems: 'center', justifyContent: 'center' },
  goT: { fontFamily: Fonts.semiBold, fontSize: 15, letterSpacing: -0.15, color: L.INK },
  gh: {
    width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
});
