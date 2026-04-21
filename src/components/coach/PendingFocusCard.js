import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Fonts } from '../../theme';

const C = {
  card: '#FFFFFF',
  dark: '#141414',
  text: '#0E0E0E',
  gray: '#999',
  orange: '#E8A838',
  red: '#D44545',
};

export default function PendingFocusCard({
  fp,
  isExpanded,
  onToggle,
  studentName,
  onApprove,
  onEdit,
  onDelete,
}) {
  const hoursLeft = fp.coach_review_deadline
    ? Math.max(0, Math.ceil((new Date(fp.coach_review_deadline) - Date.now()) / 3600000))
    : null;
  const isUrgent = hoursLeft !== null && hoursLeft < 3;

  const src = Array.isArray(fp.source_class_input) ? fp.source_class_input[0] : fp.source_class_input;
  const classSummary = src?.class_summary || null;
  const fpNameLower = fp.name?.trim().toLowerCase();
  // Student's note only makes sense for private lessons — practice_point_1/2 on class_inputs
  // is populated from a single student's focus points and has no meaning in a group context.
  const isGroup = src?.lesson_type === 'public' || src?.lesson_type === 'group' || !!fp.group_fp;
  const studentNote = isGroup
    ? null
    : src?.ai_primary_focus && fpNameLower && src.ai_primary_focus.trim().toLowerCase() === fpNameLower
      ? src?.practice_point_1
      : src?.ai_secondary_focus && fpNameLower && src.ai_secondary_focus.trim().toLowerCase() === fpNameLower
        ? src?.practice_point_2
        : src?.practice_point_1 || null;

  return (
    <TouchableOpacity
      style={[s.fpCard, isExpanded && s.fpCardExpanded]}
      activeOpacity={0.92}
      onPress={onToggle}
    >
      {isUrgent && <View style={s.urgentAccent} />}

      {/* Meta header */}
      <View style={s.metaRow}>
        <Text style={s.metaCategory}>REVIEW</Text>
        {!!studentName && (
          <>
            <Text style={s.metaSep}>·</Text>
            <Text style={s.metaStudent} numberOfLines={1}>{studentName}</Text>
          </>
        )}
        <View style={{ flex: 1 }} />
        {hoursLeft !== null && (
          <Text style={[s.metaTime, isUrgent && s.metaTimeUrgent]}>
            {hoursLeft}h left
          </Text>
        )}
      </View>

      {/* FP name */}
      <Text style={s.fpName} numberOfLines={2}>{fp.name}</Text>

      {/* Context preview */}
      {!!fp.context && (
        <Text style={s.fpDetail} numberOfLines={isExpanded ? undefined : 2}>
          {fp.context}
        </Text>
      )}

      {/* Expanded */}
      {isExpanded && (
        <View style={s.fpExpanded}>
          {!!studentNote && (
            <View style={s.quoteBlock}>
              <Text style={s.quoteLabel}>Student's note</Text>
              <View style={s.quoteRow}>
                <View style={s.quoteBar} />
                <Text style={s.quoteText}>{studentNote}</Text>
              </View>
            </View>
          )}
          {!!classSummary && (
            <View style={s.quoteBlock}>
              <Text style={s.quoteLabel}>Class summary</Text>
              <View style={s.quoteRow}>
                <View style={s.quoteBar} />
                <Text style={s.quoteText}>{classSummary}</Text>
              </View>
            </View>
          )}
          {!!fp.drill && (
            <View style={s.quoteBlock}>
              <Text style={[s.quoteLabel, { color: C.orange }]}>Drill suggestion</Text>
              <View style={s.quoteRow}>
                <View style={[s.quoteBar, { backgroundColor: C.orange }]} />
                <Text style={s.quoteText}>{fp.drill}</Text>
              </View>
            </View>
          )}

          <View style={s.fpActions}>
            <TouchableOpacity style={s.approveBtn} onPress={() => onApprove(fp.id)} activeOpacity={0.85}>
              <Text style={s.approveBtnText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.textBtn} onPress={() => onEdit(fp)} activeOpacity={0.7}>
              <Text style={s.editBtnText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.textBtn} onPress={() => onDelete(fp)} activeOpacity={0.7}>
              <Text style={s.rejectBtnText}>Reject</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  fpCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 18,
    marginBottom: 10,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.035,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 1,
  },
  fpCardExpanded: {
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 3,
  },
  urgentAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2.5,
    backgroundColor: C.red,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  metaCategory: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: C.orange,
    textTransform: 'uppercase',
  },
  metaSep: {
    fontSize: 10,
    color: '#C8C8C8',
    marginHorizontal: -2,
  },
  metaStudent: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: C.gray,
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  metaTime: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: C.orange,
    letterSpacing: 0.1,
  },
  metaTimeUrgent: {
    color: C.red,
  },
  fpName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.3,
    color: C.text,
  },
  fpDetail: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13.5,
    color: '#5C6370',
    lineHeight: 20,
    marginTop: 8,
  },
  fpExpanded: {
    marginTop: 18,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E8E8E8',
  },
  quoteBlock: { marginBottom: 16 },
  quoteLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: C.gray,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 7,
  },
  quoteRow: { flexDirection: 'row', gap: 12 },
  quoteBar: {
    width: 2,
    backgroundColor: '#E0E0E0',
    borderRadius: 1,
  },
  quoteText: {
    flex: 1,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13.5,
    color: C.text,
    lineHeight: 20,
  },
  fpActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 6,
  },
  approveBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.dark,
    borderRadius: 999,
    paddingVertical: 12,
  },
  approveBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#fff',
    letterSpacing: 0.2,
  },
  textBtn: {
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  editBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: C.text,
    letterSpacing: 0.1,
  },
  rejectBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: C.red,
    letterSpacing: 0.1,
  },
});
