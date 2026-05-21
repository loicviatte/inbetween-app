import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import HeroCardGradient from './HeroCardGradient';
import { Fonts } from '../theme';

const GOLD = '#F6D27A';

/**
 * Tap-on-question detail modal — dark hero card matching the rest of the
 * app's question surface. Shared between the student profile readiness
 * card and the coach pre-class briefing.
 *
 * Status drives the body:
 *   pending    → "Waiting for your coach to respond…"
 *   dismissed  → "Coach will cover this question in your next class."
 *   replied    → COACH'S REPLY + reply text
 *
 * @param {object} question         coach_messages row (id, message, reply, status)
 * @param {'student'|'coach'} role  copy switches between 1st-person and
 *                                  3rd-person framing
 * @param {function} onClose
 */
export default function QuestionDetailSheet({ question, role = 'student', onClose }) {
  if (!question) return null;
  const status = question.status;
  const isReplied = status === 'replied';
  const isInClass = status === 'dismissed';
  const isCoach = role === 'coach';

  const eyebrowQ = isCoach ? 'STUDENT QUESTION' : 'YOUR QUESTION';
  const eyebrowR = isCoach ? 'YOUR REPLY' : "COACH'S REPLY";
  const eyebrowC = isCoach ? "YOUR RESPONSE" : "COACH'S RESPONSE";
  const inClassText = isCoach
    ? 'You will cover this question in the next class.'
    : 'Your coach will cover this question in your next class.';
  const pendingText = isCoach
    ? 'Pending — reply, or commit to covering it in class.'
    : 'Waiting for your coach to respond…';

  return (
    <Pressable style={s.backdrop} onPress={onClose}>
      <Pressable style={s.card} onPress={() => { /* swallow */ }}>
        <HeroCardGradient />

        <View style={s.headerRow}>
          <Text style={s.eyebrow}>{eyebrowQ}</Text>
          {isInClass && (
            <View style={s.inClassBadge}>
              <Text style={s.inClassBadgeText}>IN CLASS</Text>
            </View>
          )}
          {isReplied && (
            <View style={s.repliedBadge}>
              <Text style={s.repliedBadgeText}>REPLIED</Text>
            </View>
          )}
        </View>

        <Text style={s.message}>{question.message}</Text>

        {isReplied && !!question.reply && (
          <>
            <View style={s.divider} />
            <Text style={s.eyebrow}>{eyebrowR}</Text>
            <Text style={s.reply}>{question.reply}</Text>
          </>
        )}

        {isInClass && (
          <>
            <View style={s.divider} />
            <Text style={s.eyebrow}>{eyebrowC}</Text>
            <Text style={s.reply}>{inClassText}</Text>
          </>
        )}

        {!isReplied && !isInClass && (
          <>
            <View style={s.divider} />
            <Text style={s.pending}>{pendingText}</Text>
          </>
        )}

        <TouchableOpacity onPress={onClose} style={s.closeBtn} activeOpacity={0.85}>
          <Text style={s.closeBtnText}>Close</Text>
        </TouchableOpacity>
      </Pressable>
    </Pressable>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(240,194,74,0.28)',
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  eyebrow: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: GOLD,
    letterSpacing: 1.2,
  },
  message: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: -0.2,
    lineHeight: 23,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginTop: 18,
    marginBottom: 14,
  },
  reply: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 20,
    marginTop: 8,
  },
  pending: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.60)',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
  closeBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  closeBtnText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.1,
  },
  inClassBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(240,194,74,0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(240,194,74,0.40)',
  },
  inClassBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 8.5,
    color: GOLD,
    letterSpacing: 0.8,
  },
  repliedBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(76,175,80,0.18)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(76,175,80,0.40)',
  },
  repliedBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 8.5,
    color: '#8BD98F',
    letterSpacing: 0.8,
  },
});
