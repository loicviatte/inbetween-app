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
  Animated,
  PanResponder,
} from 'react-native';
import Slider from '@react-native-community/slider';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Colors, Typography, Spacing, Fonts } from '../theme';
import {
  extractPrimaryFocus,
  extractSecondaryFocus,
  generateClassTitle,
  generateCoachingSummary,
  normalizeLabel,
} from '../services/ai/anthropic';
import {
  saveClassInput,
  saveFocusPoint,
  saveFocusProgress,
  getFocusPoints,
  getRecentClassInputs,
  updateUserSummary,
} from '../storage/storage';
import { supabase } from '../services/supabase/client';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

// ─── Whisper transcription ────────────────────────────────────────────────────

async function transcribeAudio(uri) {
  const formData = new FormData();
  formData.append('file', { uri, type: 'audio/m4a', name: 'recording.m4a' });
  formData.append('model', 'whisper-1');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  });
  if (!res.ok) throw new Error('Whisper error');
  const data = await res.json();
  return data.text || '';
}

// ─── Mic button ───────────────────────────────────────────────────────────────

let Audio = null;
try { Audio = require('expo-av').Audio; } catch (_) {}

function MicButton({ targetSetter }) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recordingRef = useRef(null);

  async function startRecording() {
    if (!Audio) {
      targetSetter((prev) => prev + (prev ? ' ' : '') + '[voice not available]');
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
    setTranscribing(true);
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      if (OPENAI_API_KEY && uri) {
        const text = await transcribeAudio(uri);
        if (text) targetSetter((prev) => prev + (prev ? ' ' : '') + text);
      } else {
        targetSetter((prev) => prev + (prev ? ' ' : '') + '[voice note recorded]');
      }
    } catch (e) {
      console.warn(e);
      targetSetter((prev) => prev + (prev ? ' ' : '') + '[voice note recorded]');
    }
    setTranscribing(false);
  }

  return (
    <TouchableOpacity
      style={[styles.micBtn, (recording || transcribing) && styles.micBtnActive]}
      onPress={recording ? stopRecording : startRecording}
      activeOpacity={0.75}
      disabled={transcribing}
    >
      {transcribing ? (
        <ActivityIndicator size="small" color={Colors.secondary} />
      ) : (
        <Text style={styles.micIcon}>{recording ? '⏹' : '🎙'}</Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Urgency slider ───────────────────────────────────────────────────────────

function urgencyColor(v) {
  if (v <= 2) return '#A8D5A2';
  if (v <= 4) return '#F4D03F';
  if (v <= 6) return '#F0A500';
  if (v <= 8) return '#E87C3E';
  return '#E84040';
}

function UrgencySlider({ value, onChange }) {
  return (
    <View style={styles.sliderWrap}>
      <Slider
        style={styles.slider}
        minimumValue={1}
        maximumValue={10}
        step={1}
        value={value}
        onValueChange={onChange}
        minimumTrackTintColor={urgencyColor(value)}
        maximumTrackTintColor="rgba(17,12,17,0.12)"
        thumbTintColor={urgencyColor(value)}
      />
      <Text style={styles.urgencyValue}>{value}/10</Text>
    </View>
  );
}

// ─── Date button ──────────────────────────────────────────────────────────────

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateLabel(date) {
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export default function LogModal({ visible, onClose, onSubmitted }) {
  const [step, setStep] = useState(1);
  const [takeaway, setTakeaway] = useState('');
  const [practicePoint1, setPracticePoint1] = useState('');
  const [priorityScore1, setPriorityScore1] = useState(5);
  const [showSecond, setShowSecond] = useState(false);
  const [practicePoint2, setPracticePoint2] = useState('');
  const [priorityScore2, setPriorityScore2] = useState(5);
  const [classDate, setClassDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const translateY = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 5 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => { if (g.dy > 0) translateY.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 0.5) {
          Animated.timing(translateY, { toValue: 800, duration: 200, useNativeDriver: true }).start(() => {
            translateY.setValue(0);
            handleClose();
          });
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  const hasInput = takeaway.trim().length > 0 || practicePoint1.trim().length > 0 || practicePoint2.trim().length > 0;

  function reset() {
    setStep(1);
    setTakeaway('');
    setPracticePoint1('');
    setPriorityScore1(3);
    setShowSecond(false);
    setPracticePoint2('');
    setPriorityScore2(3);
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
    if (!practicePoint1.trim()) {
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
      const existingNames = existingPoints.map((p) => p.name);
      const pp2 = showSecond && practicePoint2.trim() ? practicePoint2 : null;

      const [primaryFocusName, secondaryFocusName, title] = await Promise.all([
        extractPrimaryFocus({ practicePoint1, priorityScore1, existingNames }),
        pp2 ? extractSecondaryFocus({ practicePoint2: pp2, priorityScore2: showSecond ? priorityScore2 : null, existingNames }) : Promise.resolve(null),
        generateClassTitle(takeaway, practicePoint1),
      ]);

      const now = new Date(classDate);
      const current = new Date();
      now.setHours(current.getHours(), current.getMinutes(), current.getSeconds(), 0);
      const createdAt = now.toISOString();

      async function resolveFp(name) {
        if (!name) return null;
        const norm = normalizeLabel(name);
        const existing = existingPoints.find((p) => p.normalized_name === norm);
        if (existing) {
          await saveFocusPoint({ ...existing, count: existing.count + 1 });
          return existing.id;
        }
        const newId = await saveFocusPoint({ name, normalized_name: norm, count: 1 });
        if (newId) existingPoints.push({ id: newId, name, normalized_name: norm, count: 1 });
        return newId;
      }

      const primaryFpId = await resolveFp(primaryFocusName);
      const secondaryFpId = await resolveFp(secondaryFocusName);

      await saveClassInput({
        title,
        takeaway: takeaway.trim() || null,
        practice_point_1: practicePoint1,
        priority_score_1: priorityScore1,
        practice_point_2: pp2,
        priority_score_2: showSecond ? priorityScore2 : null,
        ai_primary_focus: primaryFocusName || null,
        ai_secondary_focus: secondaryFocusName || null,
        created_at: createdAt,
      });

      // Retrieve the newly created class input ID
      const { data: { user } } = await supabase.auth.getUser();
      const { data: latestInput } = await supabase
        .from('class_inputs')
        .select('id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      const classInputId = latestInput?.id || null;

      if (primaryFpId) {
        await saveFocusProgress({ focus_point_id: primaryFpId, class_input_id: classInputId, priority_score: priorityScore1 });
      }
      if (secondaryFpId) {
        await saveFocusProgress({ focus_point_id: secondaryFpId, class_input_id: classInputId, priority_score: priorityScore2 });
      }

      // Background: coaching summary + nudge refresh
      getRecentClassInputs(3).then((recent) =>
        generateCoachingSummary(recent).then(updateUserSummary).catch(() => {})
      );
      import('../utils/algorithm').then(({ refreshNudgeMessage }) =>
        refreshNudgeMessage().catch(() => {})
      );

      reset();
      onSubmitted();
    } catch (e) {
      console.error(e);
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.kvContainer}>
          <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
            <View style={styles.sheetHeader} {...panResponder.panHandlers}>
              <View style={styles.handle} />
              <TouchableOpacity onPress={handleClose} style={styles.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
              {step === 1 ? (
                <>
                  <Text style={styles.question}>What did you work on in today's class?</Text>
                  <View style={[styles.inputRow, { marginBottom: 20 }]}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      value={takeaway}
                      onChangeText={setTakeaway}
                      placeholder="e.g. Worked on footwork in Samba, partnered exercises…"
                      placeholderTextColor={Colors.secondary}
                      multiline
                      numberOfLines={3}
                      textAlignVertical="top"
                    />
                    <MicButton targetSetter={setTakeaway} />
                  </View>

                  <Text style={styles.question}>What do you need to work on?</Text>

                  <View style={styles.inputRow}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      value={practicePoint1}
                      onChangeText={setPracticePoint1}
                      placeholder="e.g. My hip rotation was stiff on the left side…"
                      placeholderTextColor={Colors.secondary}
                      multiline
                      numberOfLines={3}
                      textAlignVertical="top"
                    />
                    <MicButton targetSetter={setPracticePoint1} />
                  </View>

                  <Text style={styles.label}>Urgency</Text>
                  <UrgencySlider value={priorityScore1} onChange={setPriorityScore1} />

                  <TouchableOpacity style={styles.toggleBtn} onPress={() => setShowSecond(!showSecond)} activeOpacity={0.7}>
                    <View style={[styles.toggleDot, showSecond && { backgroundColor: Colors.activeLog }]} />
                    <Text style={styles.toggleText}>Add a second observation</Text>
                  </TouchableOpacity>

                  {showSecond && (
                    <>
                      <View style={styles.inputRow}>
                        <TextInput
                          style={[styles.input, { flex: 1 }]}
                          value={practicePoint2}
                          onChangeText={setPracticePoint2}
                          placeholder="e.g. Need more power in jumps…"
                          placeholderTextColor={Colors.secondary}
                          multiline
                          numberOfLines={3}
                          textAlignVertical="top"
                        />
                        <MicButton targetSetter={setPracticePoint2} />
                      </View>
                      <Text style={styles.label}>Urgency</Text>
                      <UrgencySlider value={priorityScore2} onChange={setPriorityScore2} />
                    </>
                  )}

                  <View style={styles.dateSeparator} />
                  <TouchableOpacity style={styles.dateBtn} onPress={() => setShowDatePicker(!showDatePicker)} activeOpacity={0.75}>
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

                  <TouchableOpacity style={styles.primaryBtn} onPress={handleNext} activeOpacity={0.85}>
                    <Text style={styles.primaryBtnText}>NEXT →</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.question}>Review your log</Text>

                  {takeaway.trim() ? (
                    <View style={styles.reviewCard}>
                      <Text style={styles.reviewLabel}>What you worked on</Text>
                      <Text style={styles.reviewText}>{takeaway}</Text>
                    </View>
                  ) : null}

                  <View style={[styles.reviewCard, takeaway.trim() ? { marginTop: 10 } : {}]}>
                    <Text style={styles.reviewLabel}>Focus to work on · Urgency {priorityScore1}/5</Text>
                    <Text style={styles.reviewText}>{practicePoint1}</Text>
                  </View>

                  {showSecond && practicePoint2.trim() ? (
                    <View style={[styles.reviewCard, { marginTop: 10 }]}>
                      <Text style={styles.reviewLabel}>Observation 2 · Urgency {priorityScore2}/5</Text>
                      <Text style={styles.reviewText}>{practicePoint2}</Text>
                    </View>
                  ) : null}

                  <View style={[styles.reviewCard, { marginTop: 10 }]}>
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
          </Animated.View>
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
  closeBtn: { position: 'absolute', right: Spacing.side, top: 16 },
  closeBtnText: { fontSize: 18, color: Colors.secondary },
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
  sliderWrap: { marginBottom: 16 },
  urgencyValue: { fontFamily: Fonts.jakartaMedium, fontSize: 11, color: Colors.secondary, textAlign: 'right', marginTop: -4 },
  slider: { width: '100%', height: 40 },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, marginTop: 4 },
  toggleDot: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: Colors.activeLog, marginRight: 10,
  },
  toggleText: { ...Typography.body, color: Colors.activeLog, fontWeight: '600' },
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
  primaryBtn: {
    backgroundColor: Colors.black, borderRadius: 16,
    paddingVertical: 16, alignItems: 'center', marginTop: 20,
  },
  primaryBtnText: { color: Colors.white, fontFamily: Fonts.jakartaExtraBold, fontSize: 16, letterSpacing: 0.5 },
  backBtn: { alignItems: 'center', marginTop: 14 },
  backBtnText: { ...Typography.body, color: Colors.secondary },
  reviewCard: { backgroundColor: Colors.statCardBg, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: Colors.statCardBorder },
  reviewLabel: { fontFamily: Fonts.jakartaMedium, fontSize: 11, color: Colors.secondary, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 },
  reviewText: { ...Typography.body },
  error: { color: 'red', fontSize: 13, marginTop: 10 },
});
