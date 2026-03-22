import React, { useState, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Colors, Typography, Spacing, Fonts } from '../theme';

// expo-av may not be available in Expo Go — load lazily
let Audio = null;
try {
  Audio = require('expo-av').Audio;
} catch (_) {}
import { extractFocusPoints, normalizeLabel } from '../services/anthropic';
import {
  saveClassInput,
  saveFocusPoint,
  saveFocusProgress,
  getFocusPoints,
} from '../services/storage';

function UrgencySelector({ value, onChange }) {
  return (
    <View style={styles.urgencyRow}>
      {[1, 2, 3, 4, 5].map((n) => (
        <TouchableOpacity
          key={n}
          onPress={() => onChange(n)}
          style={[styles.urgencyBtn, value === n && styles.urgencyBtnActive]}
          activeOpacity={0.7}
        >
          <Text style={[styles.urgencyText, value === n && styles.urgencyTextActive]}>{n}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function MicButton({ onTranscript, targetSetter }) {
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(null);

  async function startRecording() {
    if (!Audio) {
      targetSetter((prev) => prev + (prev ? ' ' : '') + '[voice not available in Expo Go]');
      return;
    }
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = rec;
      setRecording(true);
    } catch (e) {
      console.warn('Recording start error:', e);
    }
  }

  async function stopRecording() {
    if (!recordingRef.current) return;
    setRecording(false);
    try {
      await recordingRef.current.stopAndUnloadAsync();
      // Indicate recording happened — transcription would require a speech API
      targetSetter((prev) => prev + (prev ? ' ' : '') + '[voice note recorded]');
    } catch (e) {
      console.warn('Recording stop error:', e);
    }
    recordingRef.current = null;
  }

  function handlePress() {
    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  return (
    <TouchableOpacity
      style={[styles.micBtn, recording && styles.micBtnActive]}
      onPress={handlePress}
      activeOpacity={0.75}
    >
      <Text style={styles.micIcon}>{recording ? '⏹' : '🎙'}</Text>
    </TouchableOpacity>
  );
}

export default function LogModal({ visible, onClose, onSubmitted }) {
  const [step, setStep] = useState(1);
  const [input1, setInput1] = useState('');
  const [urgency1, setUrgency1] = useState(3);
  const [showSecond, setShowSecond] = useState(false);
  const [input2, setInput2] = useState('');
  const [urgency2, setUrgency2] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setStep(1);
    setInput1('');
    setUrgency1(3);
    setShowSecond(false);
    setInput2('');
    setUrgency2(3);
    setSubmitting(false);
    setError('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleNext() {
    if (!input1.trim()) {
      setError('Please describe what you want to work on.');
      return;
    }
    setError('');
    setStep(2);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError('');
    try {
      const existingPoints = await getFocusPoints();
      const existingLabels = existingPoints.map((p) => p.label);

      const result = await extractFocusPoints({
        input1,
        urgency1,
        input2: showSecond && input2.trim() ? input2 : null,
        urgency2: showSecond ? urgency2 : null,
        existingLabels,
      });

      const now = Date.now();
      const classInputId = `ci_${now}`;

      let primaryFpId = null;
      let secondaryFpId = null;

      async function resolveFocusPoint(label, urgency) {
        if (!label) return null;
        const norm = normalizeLabel(label);
        const existing = existingPoints.find((p) => p.nameNormalized === norm);
        if (existing) {
          const updated = { ...existing, count: existing.count + 1 };
          await saveFocusPoint(updated);
          return updated.id;
        } else {
          const newFp = {
            id: `fp_${now}_${norm}`,
            userId: 'user_1',
            nameNormalized: norm,
            label,
            description: '',
            count: 1,
          };
          await saveFocusPoint(newFp);
          existingPoints.push(newFp);
          return newFp.id;
        }
      }

      primaryFpId = await resolveFocusPoint(result.primary_focus, urgency1);
      if (showSecond && result.secondary_focus) {
        secondaryFpId = await resolveFocusPoint(result.secondary_focus, urgency2);
      }

      const classInput = {
        id: classInputId,
        userId: 'user_1',
        input1,
        urgency1,
        input2: showSecond && input2.trim() ? input2 : null,
        urgency2: showSecond ? urgency2 : null,
        ai_primary_focus: primaryFpId,
        ai_secondary_focus: secondaryFpId,
        createdAt: now,
      };
      await saveClassInput(classInput);

      if (primaryFpId) {
        await saveFocusProgress({
          id: `fpr_${now}_1`,
          userId: 'user_1',
          focusPointId: primaryFpId,
          classInputId,
          priorityScore: urgency1 * 10,
          createdAt: now,
        });
      }
      if (secondaryFpId) {
        await saveFocusProgress({
          id: `fpr_${now}_2`,
          userId: 'user_1',
          focusPointId: secondaryFpId,
          classInputId,
          priorityScore: urgency2 * 10,
          createdAt: now,
        });
      }

      reset();
      onSubmitted();
    } catch (e) {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.kvContainer}
        >
          <View style={styles.sheet}>
            {/* Header */}
            <View style={styles.sheetHeader}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>New class log</Text>
              <TouchableOpacity onPress={handleClose} style={styles.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
              {step === 1 ? (
                <>
                  <Text style={styles.label}>What do you want to work on?</Text>
                  <View style={styles.inputRow}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      value={input1}
                      onChangeText={setInput1}
                      placeholder="e.g. My hip rotation was stiff..."
                      placeholderTextColor={Colors.secondary}
                      multiline
                      numberOfLines={3}
                    />
                    <MicButton targetSetter={setInput1} />
                  </View>

                  <Text style={[styles.label, { marginTop: 16 }]}>Urgency</Text>
                  <UrgencySelector value={urgency1} onChange={setUrgency1} />

                  {/* Second point toggle */}
                  <TouchableOpacity
                    style={styles.toggleBtn}
                    onPress={() => setShowSecond(!showSecond)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.toggleDot, showSecond && { backgroundColor: Colors.green }]} />
                    <Text style={styles.toggleText}>Add a second point</Text>
                  </TouchableOpacity>

                  {showSecond && (
                    <>
                      <View style={styles.inputRow}>
                        <TextInput
                          style={[styles.input, { flex: 1 }]}
                          value={input2}
                          onChangeText={setInput2}
                          placeholder="e.g. Need more power in jumps..."
                          placeholderTextColor={Colors.secondary}
                          multiline
                          numberOfLines={3}
                        />
                        <MicButton targetSetter={setInput2} />
                      </View>
                      <Text style={[styles.label, { marginTop: 12 }]}>Urgency</Text>
                      <UrgencySelector value={urgency2} onChange={setUrgency2} />
                    </>
                  )}

                  {!!error && <Text style={styles.error}>{error}</Text>}

                  <TouchableOpacity style={styles.primaryBtn} onPress={handleNext} activeOpacity={0.85}>
                    <Text style={styles.primaryBtnText}>NEXT</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.label}>Review your log</Text>

                  <View style={styles.reviewCard}>
                    <Text style={styles.reviewLabel}>Point 1</Text>
                    <Text style={styles.reviewText}>{input1}</Text>
                    <Text style={styles.reviewUrgency}>Urgency: {urgency1}/5</Text>
                  </View>

                  {showSecond && input2.trim() ? (
                    <View style={[styles.reviewCard, { marginTop: 12 }]}>
                      <Text style={styles.reviewLabel}>Point 2</Text>
                      <Text style={styles.reviewText}>{input2}</Text>
                      <Text style={styles.reviewUrgency}>Urgency: {urgency2}/5</Text>
                    </View>
                  ) : null}

                  {!!error && <Text style={styles.error}>{error}</Text>}

                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={handleSubmit}
                    disabled={submitting}
                    activeOpacity={0.85}
                  >
                    {submitting ? (
                      <ActivityIndicator color={Colors.white} />
                    ) : (
                      <Text style={styles.primaryBtnText}>SUBMIT</Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => setStep(1)} style={styles.backBtn} activeOpacity={0.7}>
                    <Text style={styles.backBtnText}>← Back</Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  kvContainer: { justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingBottom: 32,
  },
  sheetHeader: {
    alignItems: 'center',
    paddingTop: 12,
    paddingHorizontal: Spacing.side,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    position: 'relative',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
    marginBottom: 12,
  },
  sheetTitle: { ...Typography.sectionTitle },
  closeBtn: { position: 'absolute', right: Spacing.side, top: 16 },
  closeBtnText: { fontSize: 18, color: Colors.secondary },
  body: { paddingHorizontal: Spacing.side, paddingTop: 20 },
  label: { ...Typography.body, fontWeight: '600', marginBottom: 8 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    padding: 12,
    ...Typography.body,
    textAlignVertical: 'top',
    minHeight: 80,
  },
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  micBtnActive: {
    backgroundColor: '#FFE0E0',
  },
  micIcon: { fontSize: 20 },
  urgencyRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  urgencyBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  urgencyBtnActive: { borderColor: Colors.green, backgroundColor: Colors.green },
  urgencyText: { fontWeight: '600', fontSize: 16, color: Colors.secondary },
  urgencyTextActive: { color: Colors.white },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', marginTop: 20, marginBottom: 16 },
  toggleDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.green,
    marginRight: 10,
  },
  toggleText: { ...Typography.body, color: Colors.green, fontWeight: '600' },
  primaryBtn: {
    backgroundColor: Colors.green,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  primaryBtnText: {
    color: Colors.white,
    fontWeight: 'bold',
    fontSize: 16,
    letterSpacing: 1,
  },
  backBtn: { alignItems: 'center', marginTop: 14 },
  backBtnText: { ...Typography.body, color: Colors.secondary },
  reviewCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
  },
  reviewLabel: { ...Typography.secondary, fontWeight: '700', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  reviewText: { ...Typography.body, marginBottom: 4 },
  reviewUrgency: { ...Typography.secondary },
  error: { color: 'red', fontSize: 13, marginTop: 10 },
});
