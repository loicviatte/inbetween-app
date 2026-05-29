import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import HeroCardGradient from '../HeroCardGradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fonts } from '../../theme';

const GOLD = '#F6D27A';
const URGENT_BORDER = 'rgba(232,64,64,0.55)';
const DEFAULT_BORDER = 'rgba(240,194,74,0.28)';

export default function PendingFocusCard({
  fp,
  isExpanded,
  onToggle,
  studentName,
  onApprove,
  onEdit,
  onDelete,
  onShowContext,
}) {
  const hoursLeft = fp.coach_review_deadline
    ? Math.max(0, Math.ceil((new Date(fp.coach_review_deadline) - Date.now()) / 3600000))
    : null;
  const isUrgent = hoursLeft !== null && hoursLeft < 3;

  const src = Array.isArray(fp.source_class_input) ? fp.source_class_input[0] : fp.source_class_input;
  const classSummary = src?.class_summary || null;
  const fpNameLower = fp.name?.trim().toLowerCase();
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
      style={[s.card, { borderColor: isUrgent ? URGENT_BORDER : DEFAULT_BORDER }]}
      activeOpacity={0.92}
      onPress={onToggle}
    >
      <HeroCardGradient />

      {/* Top row: REVIEW (left) · student name (centered) · Xh left (right) */}
      <View style={s.metaRow}>
        <View style={s.metaSide}>
          <Text style={s.metaCategory}>REVIEW</Text>
        </View>
        {!!studentName && (
          <Text style={s.studentName} numberOfLines={1}>
            {studentName}
          </Text>
        )}
        <View style={[s.metaSide, s.metaSideRight]}>
          {hoursLeft !== null && (
            <Text style={[s.metaTime, isUrgent && s.metaTimeUrgent]}>
              {hoursLeft === 0 ? 'auto-publishing' : `${hoursLeft}h left`}
            </Text>
          )}
        </View>
      </View>

      {/* FP name */}
      <Text style={s.fpName}>{fp.name}</Text>

      {/* Subtitle */}
      {!!fp.subtitle && (
        <Text style={s.fpSubtitle} numberOfLines={isExpanded ? undefined : 2}>
          {fp.subtitle}
        </Text>
      )}

      {/* Context preview */}
      {!!fp.context && (
        <Text style={s.fpDetail} numberOfLines={isExpanded ? undefined : 2}>
          {fp.context}
        </Text>
      )}

      {/* Expanded */}
      {isExpanded && (
        <View style={s.expanded}>
          {!!studentNote && (
            <View style={s.quoteBlock}>
              <Text style={s.quoteLabel}>Student's note</Text>
              <View style={s.quoteRow}>
                <View style={s.quoteBar} />
                <Text style={s.quoteText}>{studentNote}</Text>
              </View>
            </View>
          )}
          {!!fp.drill && (
            <View style={s.quoteBlock}>
              <Text style={[s.quoteLabel, s.quoteLabelGold]}>Drill suggestion</Text>
              <View style={s.quoteRow}>
                <View style={[s.quoteBar, s.quoteBarGold]} />
                <Text style={s.quoteText}>{fp.drill}</Text>
              </View>
            </View>
          )}

          <View style={s.actions}>
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

          {!!src && !!onShowContext && (
            <TouchableOpacity style={s.contextBtn} onPress={() => onShowContext(fp)} activeOpacity={0.7}>
              <Ionicons name="book-outline" size={14} color="rgba(255,255,255,0.85)" />
              <Text style={s.contextBtnText}>Read class context</Text>
              <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.45)" />
            </TouchableOpacity>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
    marginBottom: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },

  // ── Top meta row ──
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  metaSide: {
    flex: 1,
  },
  metaSideRight: {
    alignItems: 'flex-end',
  },
  metaCategory: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: GOLD,
    textTransform: 'uppercase',
  },
  metaTime: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: GOLD,
    letterSpacing: 0.2,
  },
  metaTimeUrgent: {
    color: '#FF8C8C',
  },
  studentName: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 15,
    color: 'rgba(255,255,255,0.92)',
    letterSpacing: -0.2,
    textAlign: 'center',
    flexShrink: 1,
    paddingHorizontal: 8,
  },

  // ── Title / subtitle / body ──
  fpName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: -0.55,
    color: '#FFFFFF',
  },
  fpSubtitle: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 11.5,
    color: GOLD,
    lineHeight: 16,
    marginTop: 6,
  },
  fpDetail: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.78)',
    lineHeight: 19,
    marginTop: 8,
  },

  // ── Expanded ──
  expanded: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  quoteBlock: { marginBottom: 16 },
  quoteLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9.5,
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 7,
  },
  quoteLabelGold: { color: GOLD },
  quoteRow: { flexDirection: 'row', gap: 12 },
  quoteBar: {
    width: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 1,
  },
  quoteBarGold: { backgroundColor: GOLD },
  quoteText: {
    flex: 1,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 20,
  },

  // ── Actions ──
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 6,
  },
  approveBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingVertical: 12,
  },
  approveBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#0A0A0A',
    letterSpacing: 0.2,
  },
  textBtn: {
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  editBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
  rejectBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: '#FF8C8C',
    letterSpacing: 0.1,
  },
  contextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  contextBtnText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.1,
  },
});
