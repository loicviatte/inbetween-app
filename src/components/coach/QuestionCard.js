import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import HeroCardGradient from '../HeroCardGradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fonts } from '../../theme';

const GOLD = '#F6D27A';
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function relativeShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return 'TODAY';
  if (days === 1) return 'YESTERDAY';
  if (days < 7) return `${days}D AGO`;
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`.toUpperCase();
}

export default function QuestionCard({ question, studentName, onReply, onDismiss }) {
  const q = question || {};
  return (
    <View style={s.card}>
      <HeroCardGradient />

      <View style={s.topRow}>
        <View style={s.labelWrap}>
          <Ionicons name="chatbubble-outline" size={12} color={GOLD} />
          <Text style={s.label}>QUESTION</Text>
        </View>
        {!!q.created_at && <Text style={s.date}>{relativeShort(q.created_at)}</Text>}
      </View>

      {!!studentName && <Text style={s.studentName} numberOfLines={1}>{studentName}</Text>}

      <Text style={s.message}>"{q.message}"</Text>

      <View style={s.actions}>
        <TouchableOpacity style={s.replyBtn} onPress={onReply} activeOpacity={0.85}>
          <Ionicons name="send" size={14} color="#0A0A0A" />
          <Text style={s.replyBtnText}>Reply</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.dismissBtn} onPress={onDismiss} activeOpacity={0.7}>
          <Text style={s.dismissBtnText}>Answer in class</Text>
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
    marginBottom: 10,
  },
  labelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: GOLD,
  },
  date: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.5,
  },
  studentName: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    marginBottom: 8,
  },
  message: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 15,
    color: '#FFFFFF',
    letterSpacing: -0.2,
    lineHeight: 22,
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  replyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 12,
  },
  replyBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#0A0A0A',
    letterSpacing: 0.1,
  },
  dismissBtn: {
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  dismissBtnText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: 'rgba(255,255,255,0.65)',
    letterSpacing: 0.1,
  },
});
