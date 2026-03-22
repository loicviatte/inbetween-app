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
  Alert,
} from 'react-native';
import Slider from '@react-native-community/slider';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Colors, Typography, Spacing, Fonts } from '../theme';
import { extractFocusPoints, generateClassTitle, normalizeLabel } from '../services/anthropic';
import {
  saveClassInput,
  saveFocusPoint,
  saveFocusProgress,
  getFocusPoints,
} from '../services/storage';

// ─── Mic button ───────────────────────────────────────────────────────────────

let Audio = null;
try { Audio = require('expo-av').Audio; } catch (_) {}

function MicButton({ targetSetter }) {
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
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = rec;
      setRecording(true);
    } catch (e) { console.warn(e); }
  }

  async function stopRecording() {
    if (!recordingRef.current) return;
    setRecording(false);
    try {
      await recordingRef.current.stopAndUnloadAsync();
      targetSetter((prev) => prev + (prev ? ' ' : '') + '[voice note recorded]');
    } catch (e) { console.warn(e); }
    recordingRef.current = null;
  }

  return (
    <TouchableOpacity
      style={[styles.micBtn, recording && styles.micBtnActive]}
      onPress={recording ? stopRecording : startRecording}
      activeOpacity={0.75}
    >
      <Text style={styles.micIcon}>{recording ? '⏹' : '🎙'}</Text>
    </TouchableOpacity>
  );
}

// ─── Urgency slider ───────────────────────────────────────────────────────────

const URGENCY_LABELS = ['', 'Low', 'Moderate', 'Medium', 'High', 'Critical'];
const URGENCY_COLORS = ['', '#A8D5A2', '#F4D03F', '#F0A500', '#E87C3E', '#E84040'];

function UrgencySlider({ value, onChange }) {
  return (
    <View style={styles.sliderWrap}>
      <Slider
        style={styles.slider}
        minimumValue={1}
        maximumValue={5}
        step={1}
        value={value}
        onValueChange={onChange}
        minimumTrackTintColor={URGENCY_COLORS[value] || Colors.orange}
        maximumTrackTintColor="rgba(17,12,17,0.12)"
        thumbTintColor={URGENCY_COLORS[value] || Colors.orange}
      />
    </View>
  );
}

// ─── Date button ──────────────────────────────────────────────────────────────

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateLabel(date) {
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  if (isToday) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export default function LogModal({ visible, onClose, onSubmitted }) {
  const [step, setStep] = useState(1);
  const [classNote, setClassNote] = useState('');
  const [input1, setInput1] = useState('');
  const [urgency1, setUrgency1] = useState(3);
  const [showSecond, setShowSecond] = useState(false);
  const [input2, setInput2] = useState('');
  const [urgency2, setUrgency2] = useState(3);
  const [classDate, setClassDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const hasInput = classNote.trim().length > 0 || input1.trim().length > 0 || input2.trim().length > 0;

  function reset() {
    setStep(1);
    setClassNote('');
    setInput1('');
    setUrgency1(3);
    setShowSecond(false);
    setInput2('');
    setUrgency2(3);
    setClassDate(new Date());
    setShowDatePicker(false);
    setSubmitting(false);
    setError('');
  }

  function handleClose() {
    if (hasInput) {
      Alert.alert(
        'Discard changes?',
        'You have unsaved data. If you leave, it will be lost.',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => { reset(); onClose(); } },
        ]
      );
    } else {
      reset();
      onClose();
    }
  }

  function handleNext() {
    if (!input1.trim()) {
      setError('Please describe what you worked on.');
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
      const input2Val = showSecond && input2.trim() ? input2 : null;

      const [focusResult, title] = await Promise.all([
        extractFocusPoints({ input1, urgency1, input2: input2Val, urgency2: showSecond ? urgency2 : null, existingLabels }),
        generateClassTitle(input1, input2Val),
      ]);

      const ts = classDate.setHours(
        new Date().getHours(), new Date().getMinutes(), new Date().getSeconds(), 0
      );
      const now = typeof ts === 'number' ? ts : Date.now();
      const classInputId = `ci_${now}`;

      let primaryFpId = null;
      let secondaryFpId = null;

      async function resolveFp(label, urgency) {
        if (!label) return null;
        const norm = normalizeLabel(label);
        const existing = existingPoints.find((p) => p.nameNormalized === norm);
        if (existing) {
          const updated = { ...existing, count: existing.count + 1 };
          await saveFocusPoint(updated);
          return updated.id;
        }
        const newFp = { id: `fp_${now}_${norm}`, userId: 'user_1', nameNormalized: norm, label, description: '', count: 1 };
        await saveFocusPoint(newFp);
        existingPoints.push(newFp);
        return newFp.id;
      }

      primaryFpId = await resolveFp(focusResult.primary_focus, urgency1);
      if (showSecond && focusResult.secondary_focus) {
        secondaryFpId = await resolveFp(focusResult.secondary_focus, urgency2);
      }

      await saveClassInput({
        id: classInputId,
        userId: 'user_1',
        title,
        classNote: classNote.trim() || null,
        input1,
        urgency1,
        input2: input2Val,
        urgency2: showSecond ? urgency2 : null,
        ai_primary_focus: primaryFpId,
        ai_secondary_focus: secondaryFpId,
        createdAt: now,
      });

      if (primaryFpId) await saveFocusProgress({ id: `fpr_${now}_1`, userId: 'user_1', focusPointId: primaryFpId, classInputId, priorityScore: urgency1 * 10, createdAt: now });
      if (secondaryFpId) await saveFocusProgress({ id: `fpr_${now}_2`, userId: 'user_1', focusPointId: secondaryFpId, classInputId, priorityScore: urgency2 * 10, createdAt: now });

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
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.kvContainer}>
          <View style={styles.sheet}>
            {/* Header */}
            <View style={styles.sheetHeader}>
              <View style={styles.handle} />
              <TouchableOpacity onPress={handleClose} style={styles.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
              {step === 1 ? (
                <>
                  {/* Question 1 */}
                  <Text style={styles.question}>What did you work on in today's class?</Text>
                  <View style={[styles.inputRow, { marginBottom: 20 }]}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      value={classNote}
                      onChangeText={setClassNote}
                      placeholder="e.g. Worked on footwork in Samba, partnered exercises…"
                      placeholderTextColor={Colors.secondary}
                      multiline
                      numberOfLines={3}
                      textAlignVertical="top"
                    />
                    <MicButton targetSetter={setClassNote} />
                  </View>

                  {/* Question 2 */}
                  <Text style={styles.question}>What do you need to work on?</Text>

                  {/* Input 1 */}
                  <View style={styles.inputRow}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      value={input1}
                      onChangeText={setInput1}
                      placeholder="e.g. My hip rotation was stiff on the left side…"
                      placeholderTextColor={Colors.secondary}
                      multiline
                      numberOfLines={3}
                      textAlignVertical="top"
                    />
                    <MicButton targetSetter={setInput1} />
                  </View>

                  {/* Urgency 1 */}
                  <Text style={styles.label}>Urgency</Text>
                  <UrgencySlider value={urgency1} onChange={setUrgency1} />

                  {/* Second point toggle */}
                  <TouchableOpacity style={styles.toggleBtn} onPress={() => setShowSecond(!showSecond)} activeOpacity={0.7}>
                    <View style={[styles.toggleDot, showSecond && { backgroundColor: Colors.activeLog }]} />
                    <Text style={styles.toggleText}>Add a second observation</Text>
                  </TouchableOpacity>

                  {showSecond && (
                    <>
                      <View style={styles.inputRow}>
                        <TextInput
                          style={[styles.input, { flex: 1 }]}
                          value={input2}
                          onChangeText={setInput2}
                          placeholder="e.g. Need more power in jumps…"
                          placeholderTextColor={Colors.secondary}
                          multiline
                          numberOfLines={3}
                          textAlignVertical="top"
                        />
                        <MicButton targetSetter={setInput2} />
                      </View>
                      <Text style={styles.label}>Urgency</Text>
                      <UrgencySlider value={urgency2} onChange={setUrgency2} />
                    </>
                  )}

                  {/* Date */}
                  <View style={styles.dateSeparator} />
                  <TouchableOpacity
                    style={styles.dateBtn}
                    onPress={() => setShowDatePicker(!showDatePicker)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.dateCheckCircle}>
                      <Text style={styles.dateCheckIcon}>✓</Text>
                    </View>
                    <Text style={styles.dateBtnText}>{formatDateLabel(classDate)}</Text>
                    <Text style={styles.dateBtnArrow}>▾</Text>
                  </TouchableOpacity>

                  {showDatePicker && (
                    <DateTimePicker
                      value={classDate}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      maximumDate={new Date()}
                      onChange={(_, date) => {
                        if (date) setClassDate(date);
                        if (Platform.OS !== 'ios') setShowDatePicker(false);
                      }}
                      style={styles.datePicker}
                    />
                  )}

                  {!!error && <Text style={styles.error}>{error}</Text>}

                  {/* NEXT */}
                  <TouchableOpacity style={styles.primaryBtn} onPress={handleNext} activeOpacity={0.85}>
                    <Text style={styles.primaryBtnText}>NEXT →</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.question}>Review your log</Text>

                  {classNote.trim() ? (
                    <View style={styles.reviewCard}>
                      <Text style={styles.reviewLabel}>What you worked on</Text>
                      <Text style={styles.reviewText}>{classNote}</Text>
                    </View>
                  ) : null}

                  <View style={[styles.reviewCard, classNote.trim() ? { marginTop: 10 } : {}]}>
                    <Text style={styles.reviewLabel}>Focus to work on · Urgency {urgency1}/5</Text>
                    <Text style={styles.reviewText}>{input1}</Text>
                  </View>

                  {showSecond && input2.trim() ? (
                    <View style={[styles.reviewCard, { marginTop: 10 }]}>
                      <Text style={styles.reviewLabel}>Observation 2 · Urgency {urgency2}/5</Text>
                      <Text style={styles.reviewText}>{input2}</Text>
                    </View>
                  ) : null}

                  <View style={styles.reviewCard}>
                    <Text style={styles.reviewLabel}>Class date</Text>
                    <Text style={styles.reviewText}>{formatDateLabel(classDate)}</Text>
                  </View>

                  {!!error && <Text style={styles.error}>{error}</Text>}

                  <TouchableOpacity style={styles.primaryBtn} onPress={handleSubmit} disabled={submitting} activeOpacity={0.85}>
                    {submitting ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <ActivityIndicator color={Colors.white} />
                        <Text style={styles.primaryBtnText}>Generating…</Text>
                      </View>
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
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  kvContainer: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    height: '88%',
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
  handle: { width: 36, height: 4, backgroundColor: 'rgba(17,12,17,0.1)', borderRadius: 2, marginBottom: 12 },
  sheetTitle: { ...Typography.sectionTitle },
  closeBtn: { position: 'absolute', right: Spacing.side, top: 16 },
  closeBtnText: { fontSize: 18, color: Colors.secondary },

  stepRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  stepDot: { width: 24, height: 4, borderRadius: 2, backgroundColor: 'rgba(17,12,17,0.1)' },
  stepDotActive: { backgroundColor: Colors.black },

  body: { paddingHorizontal: Spacing.side, paddingTop: 4, paddingBottom: 20 },

  question: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: Colors.black,
    marginBottom: 16,
    lineHeight: 24,
  },
  label: { ...Typography.body, fontWeight: '600', marginBottom: 4, marginTop: 4 },

  inputRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12 },
  input: {
    borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 12,
    padding: 12, ...Typography.body, textAlignVertical: 'top', minHeight: 80,
  },
  micBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  micBtnActive: { backgroundColor: '#FFE0E0' },
  micIcon: { fontSize: 20 },

  // Urgency slider
  sliderWrap: { marginBottom: 16 },
  slider: { width: '100%', height: 40 },

  // Second point toggle
  toggleBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, marginTop: 4 },
  toggleDot: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: Colors.activeLog, marginRight: 10,
  },
  toggleText: { ...Typography.body, color: Colors.activeLog, fontWeight: '600' },

  // Date
  dateSeparator: { height: 1, backgroundColor: 'rgba(17,12,17,0.06)', marginVertical: 16 },
  dateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.statCardBg, borderRadius: 12,
    borderWidth: 0.5, borderColor: Colors.statCardBorder,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 4,
  },
  dateCheckCircle: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.activeLog, alignItems: 'center', justifyContent: 'center',
  },
  dateCheckIcon: { color: Colors.white, fontSize: 13, fontWeight: 'bold' },
  dateBtnText: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: Colors.black, flex: 1 },
  dateBtnArrow: { color: Colors.secondary, fontSize: 12 },
  datePicker: { width: '100%' },

  // Buttons
  primaryBtn: {
    backgroundColor: Colors.black, borderRadius: 16,
    paddingVertical: 16, alignItems: 'center', marginTop: 20,
  },
  primaryBtnText: { color: Colors.white, fontFamily: Fonts.jakartaExtraBold, fontSize: 16, letterSpacing: 0.5 },
  backBtn: { alignItems: 'center', marginTop: 14 },
  backBtnText: { ...Typography.body, color: Colors.secondary },

  // Review
  reviewCard: { backgroundColor: Colors.statCardBg, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: Colors.statCardBorder },
  reviewLabel: { fontFamily: Fonts.jakartaMedium, fontSize: 11, color: Colors.secondary, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 },
  reviewText: { ...Typography.body },

  error: { color: 'red', fontSize: 13, marginTop: 10 },
});
