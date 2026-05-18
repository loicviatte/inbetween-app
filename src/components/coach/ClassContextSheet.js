import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Pressable } from 'react-native';
import HeroCardGradient from '../HeroCardGradient';
import { Ionicons } from '@expo/vector-icons';
import { Fonts } from '../../theme';

const GOLD = '#F6D27A';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export default function ClassContextSheet({ fp, onClose }) {
  const src = Array.isArray(fp?.source_class_input) ? fp.source_class_input[0] : fp?.source_class_input;
  if (!src) return null;

  const title = src.title || src.ai_primary_focus || 'Class';
  const dateLabel = formatDate(src.created_at).toUpperCase();
  const isGroup = src.lesson_type === 'public' || src.lesson_type === 'group';
  const kindLabel = isGroup ? 'Group class' : 'Private lesson';
  const subtitle = src.teacher_name ? `${kindLabel} · ${src.teacher_name}` : kindLabel;

  return (
    <Pressable style={s.backdrop} onPress={onClose}>
      <Pressable style={s.sheet} onPress={() => { /* swallow taps on sheet */ }}>
        <HeroCardGradient />
        <View style={s.handle} />

        <View style={s.header}>
          <Text style={s.metaLabel} numberOfLines={1}>
            FROM CLASS{dateLabel ? ` · ${dateLabel}` : ''}
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} activeOpacity={0.7}>
            <Ionicons name="close" size={22} color="rgba(255,255,255,0.85)" />
          </TouchableOpacity>
        </View>

        <Text style={s.title}>{title}</Text>
        <Text style={s.subtitle}>{subtitle}</Text>

        {!!src.class_summary && (
          <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
            <Text style={s.summaryLabel}>CLASS SUMMARY</Text>
            <Text style={s.summaryText}>{src.class_summary}</Text>
          </ScrollView>
        )}
      </Pressable>
    </Pressable>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 36,
    borderTopWidth: 1,
    borderColor: 'rgba(240,194,74,0.28)',
    overflow: 'hidden',
    maxHeight: '85%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignSelf: 'center',
    marginBottom: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  metaLabel: {
    flex: 1,
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: GOLD,
    letterSpacing: 1.2,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 24,
    color: '#FFFFFF',
    letterSpacing: -0.6,
    lineHeight: 28,
    marginTop: 4,
  },
  subtitle: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 6,
    marginBottom: 20,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  summaryLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  summaryText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: 'rgba(255,255,255,0.88)',
    lineHeight: 21,
  },
});
