import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Spacing } from '../theme';
import { getFocusPoints, saveSessionCompletion } from '../services/storage';

const SESSION_DURATION = 25 * 60;

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const RANK_LABELS = ['#1 Priority', '#2 Priority', '#3 Priority'];

export default function FocusSessionScreen({ route, navigation }) {
  const { focusPointId, rank = 0 } = route.params;
  const [focusPoint, setFocusPoint] = useState(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionDone, setSessionDone] = useState(false);
  const [timeLeft, setTimeLeft] = useState(SESSION_DURATION);
  const [validated, setValidated] = useState(false);
  const intervalRef = useRef(null);
  const successOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    getFocusPoints().then((points) => {
      setFocusPoint(points.find((p) => p.id === focusPointId) || null);
    });
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [focusPointId]);

  function startSession() {
    setSessionActive(true);
    setSessionDone(false);
    setTimeLeft(SESSION_DURATION);
    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current);
          setSessionActive(false);
          setSessionDone(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function stopSession() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setSessionActive(false);
    setTimeLeft(SESSION_DURATION);
  }

  async function handleValidate() {
    if (validated) return;
    setValidated(true);
    await saveSessionCompletion(focusPointId);
    Animated.sequence([
      Animated.timing(successOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.delay(1200),
      Animated.timing(successOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => navigation.goBack());
  }

  const exerciseText = focusPoint?.description ||
    `This session focuses on intentional repetition and body awareness to build lasting muscle memory. Work through each set with full attention on quality of movement over speed.`;

  const progress = sessionActive ? 1 - timeLeft / SESSION_DURATION : sessionDone ? 1 : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backLabel}>Focus</Text>
        </TouchableOpacity>
        <View style={styles.rankBadge}>
          <Text style={styles.rankBadgeText}>{RANK_LABELS[rank] || `#${rank + 1}`}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Black focus card */}
        <View style={styles.focusCard}>
          <Text style={styles.focusCardLabel}>Focus</Text>
          <Text style={styles.focusCardName}>{focusPoint?.label || '—'}</Text>
        </View>

        {/* Exercise section */}
        <Text style={styles.sectionHeading}>Exercise</Text>
        <Text style={styles.sectionBody}>{exerciseText}</Text>

        {/* Structure section */}
        <Text style={styles.sectionHeading}>Structure</Text>
        <View style={styles.structureRow}>
          <View style={styles.structureCol}>
            <Text style={styles.structureLabel}>Total</Text>
            <Text style={styles.structureValue}>25min</Text>
          </View>
          <View style={styles.structureDivider} />
          <View style={styles.structureCol}>
            <Text style={styles.structureLabel}>Sets</Text>
            <Text style={styles.structureValue}>3 × 5min</Text>
          </View>
          <View style={styles.structureDivider} />
          <View style={styles.structureCol}>
            <Text style={styles.structureLabel}>Rest</Text>
            <Text style={styles.structureValue}>2min</Text>
          </View>
        </View>

        {/* Timer / Start / Done */}
        {sessionActive ? (
          <>
            {/* Progress bar */}
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
            <TouchableOpacity style={styles.timerBox} onPress={stopSession} activeOpacity={0.9}>
              <Text style={styles.timerHint}>Tap to stop</Text>
              <Text style={styles.timerText}>{formatTime(timeLeft)}</Text>
            </TouchableOpacity>
          </>
        ) : sessionDone ? (
          <View style={styles.doneBox}>
            <Text style={styles.doneIcon}>✓</Text>
            <Text style={styles.doneTitle}>Session complete!</Text>
            <Text style={styles.doneSubtitle}>Ready to validate your work?</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.startBtn} onPress={startSession} activeOpacity={0.88}>
            <Text style={styles.startBtnText}>START SESSION</Text>
          </TouchableOpacity>
        )}

        {/* Validate button — visible once timer started or session done */}
        {(sessionActive || sessionDone) && (
          <TouchableOpacity
            style={[styles.validateBtn, validated && styles.validateBtnDone]}
            onPress={handleValidate}
            activeOpacity={0.85}
            disabled={validated}
          >
            <Text style={styles.validateBtnText}>
              {validated ? 'Saved ✓' : 'VALIDATE SESSION'}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Success overlay */}
      <Animated.View style={[styles.successOverlay, { opacity: successOpacity }]} pointerEvents="none">
        <Text style={styles.successText}>Session validated ✓</Text>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.side,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(17,12,17,0.08)',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backArrow: { fontSize: 18, color: Colors.activeFocus },
  backLabel: { fontFamily: Fonts.jakartaMedium, fontSize: 15, color: Colors.activeFocus },
  rankBadge: {
    borderWidth: 1,
    borderColor: 'rgba(17,12,17,0.15)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  rankBadgeText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: Colors.secondary,
  },

  content: {
    paddingHorizontal: Spacing.side,
    paddingTop: 20,
    paddingBottom: 40,
  },

  // Black focus card
  focusCard: {
    backgroundColor: Colors.focusCard,
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 20,
    marginBottom: 28,
  },
  focusCardLabel: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    marginBottom: 8,
  },
  focusCardName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 26,
    color: Colors.white,
  },

  // Sections
  sectionHeading: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: Colors.black,
    marginBottom: 10,
  },
  sectionBody: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    lineHeight: 20,
    marginBottom: 24,
  },

  // Structure
  structureRow: {
    flexDirection: 'row',
    marginBottom: 28,
  },
  structureCol: { flex: 1 },
  structureLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: Colors.secondary,
    marginBottom: 4,
  },
  structureValue: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: Colors.black,
  },
  structureDivider: {
    width: 1,
    backgroundColor: 'rgba(17,12,17,0.1)',
    marginHorizontal: 16,
    marginVertical: 4,
  },

  // Progress bar
  progressTrack: {
    height: 4,
    backgroundColor: 'rgba(17,12,17,0.08)',
    borderRadius: 2,
    marginBottom: 14,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.orange,
    borderRadius: 2,
  },

  // Timer
  timerBox: {
    backgroundColor: Colors.timerBg,
    borderRadius: 14,
    paddingVertical: 24,
    alignItems: 'center',
    marginBottom: 14,
  },
  timerHint: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11,
    color: 'rgba(17,12,17,0.4)',
    marginBottom: 4,
  },
  timerText: {
    fontFamily: Fonts.monument,
    fontSize: 52,
    color: Colors.black,
    letterSpacing: 2,
  },

  // Start button
  startBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 14,
  },
  startBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
    color: Colors.white,
    letterSpacing: 1,
  },

  // Done box
  doneBox: {
    backgroundColor: Colors.timerBg,
    borderRadius: 14,
    paddingVertical: 24,
    alignItems: 'center',
    marginBottom: 14,
  },
  doneIcon: { fontSize: 32, marginBottom: 8 },
  doneTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: Colors.black,
    marginBottom: 4,
  },
  doneSubtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
  },

  // Validate
  validateBtn: {
    backgroundColor: Colors.black,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
  },
  validateBtnDone: {
    backgroundColor: Colors.activeLog,
  },
  validateBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
    color: Colors.white,
    letterSpacing: 1,
  },

  // Success overlay
  successOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
    color: Colors.white,
    letterSpacing: 0.5,
  },
});
