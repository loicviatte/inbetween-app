import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import HeroCardGradient from '../HeroCardGradient';
import { Ionicons } from '@expo/vector-icons';
import { Fonts } from '../../theme';

const GOLD = '#F6D27A';

export default function NameMatchCard({ notif, onConfirm, onReject }) {
  const d = notif?.data || {};
  const extracted = d.extracted_name || '?';
  const student = d.student_name || '?';
  const fpCount = Array.isArray(d.focus_point_ids) ? d.focus_point_ids.length : 0;

  return (
    <View style={s.card}>
      <HeroCardGradient />

      {/* Top meta */}
      <View style={s.topRow}>
        <Text style={s.topLabel}>NAME MATCH</Text>
        {fpCount > 0 && (
          <Text style={s.topCount}>
            {fpCount} FOCUS POINT{fpCount === 1 ? '' : 'S'} WAITING
          </Text>
        )}
      </View>

      {/* Compare row: extracted name → your student */}
      <View style={s.compareRow}>
        <View style={s.side}>
          <Text style={s.sideLabel}>FROM AUDIO</Text>
          <Text style={s.sideName} numberOfLines={2}>{extracted}</Text>
        </View>

        <View style={s.arrowWrap}>
          <Ionicons name="arrow-forward" size={16} color={GOLD} />
        </View>

        <View style={s.side}>
          <Text style={s.sideLabel}>YOUR STUDENT</Text>
          <Text style={s.sideName} numberOfLines={2}>{student}</Text>
        </View>
      </View>

      {/* Question */}
      <Text style={s.question}>Is this the same person?</Text>

      {/* Actions */}
      <View style={s.actions}>
        <TouchableOpacity style={s.confirmBtn} onPress={onConfirm} activeOpacity={0.85}>
          <Ionicons name="checkmark" size={15} color="#0A0A0A" />
          <Text style={s.confirmBtnText}>Yes, it's a match</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.rejectBtn} onPress={onReject} activeOpacity={0.7}>
          <Text style={s.rejectBtnText}>Not a match</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(240,194,74,0.28)',
    overflow: 'hidden',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 22,
  },
  topLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: GOLD,
  },
  topCount: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 9.5,
    letterSpacing: 0.6,
    color: 'rgba(255,255,255,0.55)',
  },

  // ── Compare row ──
  compareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  side: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  sideLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.50)',
    letterSpacing: 1.1,
    marginBottom: 8,
  },
  sideName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: '#FFFFFF',
    letterSpacing: -0.4,
    lineHeight: 22,
    textAlign: 'center',
  },
  arrowWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(240,194,74,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(240,194,74,0.40)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Question ──
  question: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: 'rgba(255,255,255,0.72)',
    textAlign: 'center',
    marginTop: 18,
    marginBottom: 16,
  },

  // ── Actions ──
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  confirmBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 12,
  },
  confirmBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#0A0A0A',
    letterSpacing: 0.1,
  },
  rejectBtn: {
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  rejectBtnText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: 'rgba(255,255,255,0.65)',
    letterSpacing: 0.1,
  },
});
