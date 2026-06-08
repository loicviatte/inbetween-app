import React, { useState, useRef, useEffect } from 'react';
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
import Ionicons from '@expo/vector-icons/Ionicons';
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
  getFocusPoints,
  getRecentClassInputs,
  updateUserSummary,
} from '../storage/storage';
import { urgencyToTier } from '../utils/algorithm';
import { supabase } from '../services/supabase/client';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';

const LATIN_DANCES    = ['Cha Cha', 'Samba', 'Rumba', 'Paso Doble', 'Jive'];
const STANDARD_DANCES = ['Waltz', 'Tango', 'V. Waltz', 'Foxtrot', 'Quickstep'];

const DANCE_ABBR = {
  'Cha Cha':    'CCC',
  'Samba':      'S',
  'Rumba':      'R',
  'Paso Doble': 'PD',
  'Jive':       'J',
  'Waltz':      'W',
  'Tango':      'T',
  'V. Waltz':   'VW',
  'Foxtrot':    'F',
  'Quickstep':  'Q',
};

function getDancesForStyle(danceStyle) {
  const ds = (danceStyle || '').toLowerCase();
  if (ds.includes('latin') && !ds.includes('ballroom') && !ds.includes('standard')) return LATIN_DANCES;
  if ((ds.includes('ballroom') || ds.includes('standard')) && !ds.includes('latin')) return STANDARD_DANCES;
  return [...LATIN_DANCES, ...STANDARD_DANCES];
}

// ─── Whisper transcription ────────────────────────────────────────────────────

const WHISPER_PROMPT =
  'You are transcribing a personal voice note recorded by a DanceSport student after a private lesson. ' +
  'The student is summarising what they learned and what they need to practice. They may mention key points covered during the lesson, specific things to work on before the next class, and drills or exercises given by their coach. ' +
  'Your only job is to produce a clean, verbatim transcript. Do not summarise, interpret, rewrite, or restructure anything. ' +
  'Cleaning rules: Remove filler sounds: "uh", "uhh", "um", "mhh", "hmm", "err", and similar hesitation sounds. Remove only when they carry no meaning. Do not remove repeated words if the student clearly meant to repeat them. Do not add punctuation that was not implied by natural speech pauses. Do not capitalise words mid-sentence unless they are proper nouns or dance names. ' +
  'Domain rules: This is a DanceSport context — Latin and Ballroom. Always prefer DanceSport terminology over common English words when there is ambiguity. Accurately transcribe step names, technique terms, and coaching cues exactly as spoken. Preserve timing counts exactly as spoken (e.g. "one two three, cha-cha-cha, quick quick slow"). Do not autocorrect or normalise dance vocabulary. ' +
  'Latin dances: Cha Cha, Samba, Rumba, Paso Doble, Jive. Ballroom dances: Waltz, Tango, Viennese Waltz, Foxtrot, Quickstep. ' +
  'Common terms: Cuban motion, CBM, CBMP, frame, connection, contra body, line of dance, diagonal wall, centre, New York, Alemana, Fan, Natural Turn, Reverse Turn, spot turn, shoulder to shoulder. ' +
  'Output: plain text only, one paragraph per natural topic shift, no headers, no bullet points, no timestamps, no added commentary.';

// Whisper transcription via the server-side proxy at
// supabase/functions/whisper-transcribe. The OpenAI key stays server-side
// and every call lands in ai_call_logs for cost tracking.
async function transcribeAudio(uri) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('NO_AUTH_SESSION');
  const formData = new FormData();
  formData.append('file', { uri, type: 'audio/m4a', name: 'recording.m4a' });
  formData.append('prompt', WHISPER_PROMPT);
  const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/whisper-transcribe`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: formData,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Whisper ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.text || '';
}

// ─── Mic button ───────────────────────────────────────────────────────────────

function MicButton({ targetSetter }) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  async function startRecording() {
    try {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert('Microphone permission denied', 'Go to Settings → InBetween → allow Microphone.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch (e) {
      console.warn('[MicButton] startRecording error:', e);
      Alert.alert('Recording error', e.message);
    }
  }

  async function stopRecording() {
    if (!recorder.isRecording) return;
    setRecording(false);
    setTranscribing(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('No audio file recorded');
      const text = await transcribeAudio(uri);
      if (text) targetSetter((prev) => (prev ? prev + ' ' : '') + text);
    } catch (e) {
      console.warn('[MicButton] stopRecording error:', e);
      if (e.message === 'NO_AUTH_SESSION') {
        Alert.alert('Not signed in', 'Sign in to transcribe voice notes.');
      } else {
        Alert.alert('Transcription failed', e.message);
      }
    } finally {
      // Tear down the audio session so a 2nd tap of the mic on this screen
      // (or playback in another component) isn't blocked by a still-active
      // recording session. Without this, on iOS prepareToRecordAsync()
      // throws on the next attempt and the mic silently fails.
      try {
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        });
      } catch {}
      setTranscribing(false);
    }
  }

  return (
    <TouchableOpacity
      style={[styles.micBtn, recording && styles.micBtnActive]}
      onPress={recording ? stopRecording : startRecording}
      activeOpacity={0.7}
      disabled={transcribing}
    >
      {transcribing
        ? <ActivityIndicator size="small" color={Colors.secondary} />
        : <Ionicons name={recording ? 'stop-circle' : 'mic'} size={18} color={recording ? '#E84040' : Colors.secondary} />
      }
    </TouchableOpacity>
  );
}

// ─── Input with embedded mic ──────────────────────────────────────────────────

function VoiceInput({ value, onChangeText, placeholder, numberOfLines = 3, style }) {
  return (
    <View style={[styles.voiceInputWrap, style]}>
      <TextInput
        style={[styles.filledInput, { paddingRight: 44 }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.secondary}
        multiline
        numberOfLines={numberOfLines}
        textAlignVertical="top"
      />
      <View style={styles.micOverlay}>
        <MicButton targetSetter={onChangeText} />
      </View>
    </View>
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

// ─── Pill toggle (Private / Group) ───────────────────────────────────────────

function PillToggle({ options, value, onChange }) {
  return (
    <View style={styles.pillToggleRow}>
      {options.map((opt) => (
        <TouchableOpacity
          key={opt.value}
          style={[styles.pillToggleItem, value === opt.value && styles.pillToggleItemActive]}
          onPress={() => onChange(opt.value)}
          activeOpacity={0.7}
        >
          <Text style={[styles.pillToggleText, value === opt.value && styles.pillToggleTextActive]}>
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Dance selector (multi-select) ───────────────────────────────────────────

function DanceSelector({ dances, values, onChange }) {
  function toggle(d) {
    if (values.includes(d)) onChange(values.filter(x => x !== d));
    else onChange([...values, d]);
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.danceScroll}
      contentContainerStyle={styles.danceScrollContent}
    >
      {dances.map((d) => {
        const active = values.includes(d);
        return (
          <TouchableOpacity
            key={d}
            style={[styles.dancePill, active && styles.dancePillActive]}
            onPress={() => toggle(d)}
            activeOpacity={0.7}
          >
            <Text style={[styles.dancePillText, active && styles.dancePillTextActive]}>{d}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export default function LogModal({ visible, onClose, onSubmitted, initialDraft }) {
  // Content fields
  const [step, setStep]                     = useState(1);
  const [class_summary, setClassSummary]          = useState('');
  const [practicePoint1, setPracticePoint1] = useState('');
  const [priorityScore1, setPriorityScore1] = useState(5);
  const [showDrill, setShowDrill]           = useState(false);
  const [drill, setDrill]                   = useState('');
  const [showSecond, setShowSecond]         = useState(false);
  const [practicePoint2, setPracticePoint2] = useState('');
  const [priorityScore2, setPriorityScore2] = useState(5);
  const [showDrill2, setShowDrill2]         = useState(false);
  const [drill2, setDrill2]                 = useState('');

  // Class metadata
  const [lessonType, setLessonType]           = useState('private');
  const [selectedDances, setSelectedDances]   = useState([]);
  const [teacherName, setTeacherName]         = useState('');
  const [teacherEditing, setTeacherEditing]   = useState(false);
  const [teacherSuggestions, setTeacherSuggestions] = useState([]);
  const searchTimeout = useRef(null);

  // Profile-loaded
  const [linkedCoachName, setLinkedCoachName] = useState(null);
  const [availableDances, setAvailableDances] = useState([...LATIN_DANCES, ...STANDARD_DANCES]);

  // Date / UI
  const [classDate, setClassDate]           = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [submitting, setSubmitting]         = useState(false);
  const [error, setError]                   = useState('');
  const [hasScrolled, setHasScrolled]       = useState(false);

  // Clear any pending teacher search on unmount
  useEffect(() => {
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, []);

  // Load user profile once when modal opens. The async chain has multiple
  // awaits — if the user dismisses the modal before they all resolve, the
  // setState calls below would land on an unmounted (or now-hidden) modal
  // and stomp on a freshly-opened one. The `cancelled` guard short-circuits
  // them.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (cancelled || !user) return;

        const { data: profile, error: profileErr } = await supabase
          .from('users')
          .select('dance_style, latin_coach_id, ballroom_coach_id, latinCoach:latin_coach_id(name), ballroomCoach:ballroom_coach_id(name)')
          .eq('id', user.id)
          .single();
        if (cancelled) return;

        if (profileErr) console.warn('[LogModal] profile fetch error:', profileErr.message);

        setAvailableDances(getDancesForStyle(profile?.dance_style));

        const latinName =
          (Array.isArray(profile?.latinCoach) ? profile.latinCoach[0]?.name : profile?.latinCoach?.name) || null;
        const ballroomName =
          (Array.isArray(profile?.ballroomCoach) ? profile.ballroomCoach[0]?.name : profile?.ballroomCoach?.name) || null;

        let defaultCoachName = null;
        const { data: lastClass } = await supabase
          .from('class_inputs')
          .select('dance')
          .eq('user_id', user.id)
          .not('is_deleted', 'is', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled) return;

        if (lastClass?.dance?.length > 0) {
          const lastWasLatin = lastClass.dance.some(d => LATIN_DANCES.includes(d));
          defaultCoachName = lastWasLatin ? ballroomName : latinName;
        }
        defaultCoachName = defaultCoachName ?? latinName ?? ballroomName;

        if (!cancelled && defaultCoachName) {
          setLinkedCoachName(defaultCoachName);
          setTeacherName(defaultCoachName);
          setTeacherEditing(false);
        }
      } catch (e) {
        if (!cancelled) console.warn('[LogModal] profile load error:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [visible]);

  // Pre-fill form state when retrying a failed draft
  useEffect(() => {
    if (!visible || !initialDraft) return;
    setClassSummary(initialDraft.class_summary || '');
    setPracticePoint1(initialDraft.practicePoint1 || '');
    setPriorityScore1(initialDraft.priorityScore1 ?? 5);
    setShowDrill(!!initialDraft.showDrill);
    setDrill(initialDraft.drill || '');
    setShowSecond(!!initialDraft.showSecond);
    setPracticePoint2(initialDraft.practicePoint2 || '');
    setPriorityScore2(initialDraft.priorityScore2 ?? 5);
    setShowDrill2(!!initialDraft.showDrill2);
    setDrill2(initialDraft.drill2 || '');
    setLessonType(initialDraft.lessonType || 'private');
    setSelectedDances(initialDraft.selectedDances || []);
    if (initialDraft.teacherName) {
      setTeacherName(initialDraft.teacherName);
      setTeacherEditing(false);
    }
    if (initialDraft.createdAt) setClassDate(new Date(initialDraft.createdAt));
  }, [visible, initialDraft]);

  const translateY  = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef(null);

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

  const hasInput = class_summary.trim().length > 0 || practicePoint1.trim().length > 0 || practicePoint2.trim().length > 0;

  function reset() {
    setStep(1);
    setClassSummary('');
    setPracticePoint1('');
    setPriorityScore1(5);
    setShowDrill(false);
    setDrill('');
    setShowSecond(false);
    setPracticePoint2('');
    setPriorityScore2(5);
    setShowDrill2(false);
    setDrill2('');
    setLessonType('private');
    setSelectedDances([]);
    setTeacherName(linkedCoachName || '');
    setTeacherEditing(!linkedCoachName);
    setTeacherSuggestions([]);
    setClassDate(new Date());
    setHasScrolled(false);
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

  function handleSubmit() {
    setError('');
    const now = new Date(classDate);
    const current = new Date();
    now.setHours(current.getHours(), current.getMinutes(), current.getSeconds(), 0);
    const createdAt = now.toISOString();

    const draft = {
      _pendingId:
        initialDraft?._pendingId ||
        `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      class_summary,
      practicePoint1,
      priorityScore1,
      showDrill,
      drill,
      showSecond,
      practicePoint2,
      priorityScore2,
      showDrill2,
      drill2,
      lessonType,
      selectedDances,
      teacherName,
      createdAt,
    };

    reset();
    onSubmitted(draft);
  }

  function handleTeacherChange(text) {
    setTeacherName(text);
    setTeacherSuggestions([]);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!text.trim() || text.trim().length < 2) return;
    searchTimeout.current = setTimeout(async () => {
      try {
        const { data } = await supabase
          .from('users')
          .select('id, name')
          .eq('role', 'coach')
          .ilike('name', `%${text.trim()}%`)
          .limit(5);
        setTeacherSuggestions(data || []);
      } catch {}
    }, 300);
  }

  function selectSuggestion(name) {
    setTeacherName(name);
    setTeacherSuggestions([]);
    setTeacherEditing(false);
  }

  function confirmRemoveDrill(value, onConfirm) {
    if (value.trim()) {
      const preview = value.trim();
      Alert.alert(
        'Remove drill?',
        `Are you sure you want to delete "${preview.slice(0, 60)}${preview.length > 60 ? '…' : ''}"?`,
        [
          { text: 'Keep it', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: onConfirm },
        ]
      );
    } else {
      onConfirm();
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.kvContainer}>
          <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>

            {/* ── Header ─────────────────────────────────────────── */}
            <View style={styles.sheetHeader} {...panResponder.panHandlers}>
              <View style={styles.handle} />
              <View style={styles.headerRow}>
                <View>
                  <Text style={styles.headerTitle}>Log a class</Text>
                  <Text style={styles.headerStep}>Step {step} of 2</Text>
                </View>
                <TouchableOpacity onPress={handleClose} style={styles.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                  <Text style={styles.closeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView
              ref={scrollViewRef}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.body}
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={e => { if (!hasScrolled && e.nativeEvent.contentOffset.y > 60) setHasScrolled(true); }}
              style={{ flex: 1 }}
            >
              {step === 1 ? (
                <>
                  {/* ── Class details ─────────────────────────────── */}
                  <Text style={styles.sectionTitle}>Class details</Text>
                  <View style={styles.metaCard}>

                    {/* Type */}
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Type</Text>
                      <PillToggle
                        options={[
                          { label: 'Private', value: 'private' },
                          { label: 'Group', value: 'group' },
                        ]}
                        value={lessonType}
                        onChange={setLessonType}
                      />
                    </View>

                    <View style={styles.metaDivider} />

                    {/* Teacher */}
                    <View>
                      <View style={styles.metaRow}>
                        <Text style={styles.metaLabel}>Teacher</Text>
                        {!teacherEditing && teacherName ? (
                          <View style={styles.teacherChip}>
                            <Text style={styles.teacherChipText}>{teacherName}</Text>
                            <TouchableOpacity
                              onPress={() => { setTeacherName(''); setTeacherEditing(true); setTeacherSuggestions([]); }}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              style={styles.teacherClear}
                            >
                              <Text style={styles.teacherClearText}>✕</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View style={styles.teacherInputWrap}>
                            <TextInput
                              style={styles.teacherInput}
                              value={teacherName}
                              onChangeText={handleTeacherChange}
                              onBlur={() => setTimeout(() => setTeacherSuggestions([]), 150)}
                              placeholder="Search or type a name…"
                              placeholderTextColor={Colors.secondary}
                              returnKeyType="done"
                              autoFocus={teacherEditing}
                            />
                          </View>
                        )}
                      </View>
                      {teacherEditing && teacherSuggestions.length > 0 && (
                        <View style={styles.suggestionBox}>
                          {teacherSuggestions.map((s) => (
                            <TouchableOpacity
                              key={s.id}
                              style={styles.suggestionItem}
                              onPress={() => selectSuggestion(s.name)}
                              activeOpacity={0.7}
                            >
                              <Text style={styles.suggestionText}>{s.name}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>

                    <View style={styles.metaDivider} />

                    {/* Dance */}
                    <View>
                      <View style={[styles.metaRow, { marginBottom: 10 }]}>
                        <Text style={styles.metaLabel}>Dance</Text>
                        {selectedDances.length > 0
                          ? <Text style={styles.metaValueSelected}>{selectedDances.map(d => DANCE_ABBR[d] ?? d).join(' · ')}</Text>
                          : <Text style={styles.metaValuePlaceholder}>Optional</Text>
                        }
                      </View>
                      <DanceSelector
                        dances={availableDances}
                        values={selectedDances}
                        onChange={setSelectedDances}
                      />
                    </View>
                  </View>

                  {/* ── Class Summary ─────────────────────────────── */}
                  <Text style={styles.sectionTitleBold}>Class Summary</Text>
                  <VoiceInput
                    value={class_summary}
                    onChangeText={setClassSummary}
                    placeholder="What did you work on in this class?"
                  />

                  {/* ── Focus 1 ───────────────────────────────────── */}
                  <View style={styles.focusHeader}>
                    <View style={styles.focusBadge}><Text style={styles.focusBadgeText}>01</Text></View>
                    <Text style={styles.focusTitle}>Focus point</Text>
                  </View>
                  <VoiceInput
                    value={practicePoint1}
                    onChangeText={setPracticePoint1}
                    placeholder="What do you need to work on?"
                  />
                  <View style={styles.urgencyRow}>
                    <Text style={styles.urgencyLabel}>Urgency</Text>
                    <Text style={styles.urgencyBadge}>{priorityScore1}/10</Text>
                  </View>
                  <UrgencySlider value={priorityScore1} onChange={setPriorityScore1} />

                  {showDrill ? (
                    <>
                      <View style={styles.removableHeader}>
                        <Text style={styles.removableLabel}>Drill</Text>
                        <TouchableOpacity
                          onPress={() => confirmRemoveDrill(drill, () => { setShowDrill(false); setDrill(''); })}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                          <Text style={styles.removableX}>− Remove</Text>
                        </TouchableOpacity>
                      </View>
                      <VoiceInput
                        value={drill}
                        onChangeText={setDrill}
                        placeholder="Describe the drill…"
                        numberOfLines={2}
                        style={{ marginBottom: 4 }}
                      />
                    </>
                  ) : (
                    <TouchableOpacity style={styles.addLink} onPress={() => setShowDrill(true)} activeOpacity={0.6}>
                      <Text style={styles.addLinkText}>+ Add a drill</Text>
                    </TouchableOpacity>
                  )}

                  {/* ── Focus 2 ───────────────────────────────────── */}
                  {showSecond ? (
                    <>
                      <View style={[styles.focusHeader, { marginTop: 8 }]}>
                        <View style={styles.focusBadge}><Text style={styles.focusBadgeText}>02</Text></View>
                        <Text style={styles.focusTitle}>Second focus point</Text>
                        <TouchableOpacity
                          style={styles.removeBlock}
                          onPress={() => {
                            const hasContent = practicePoint2.trim() || drill2.trim();
                            if (hasContent) {
                              const preview = practicePoint2.trim() || drill2.trim();
                              Alert.alert(
                                'Remove second focus?',
                                `Are you sure you want to delete "${preview.slice(0, 60)}${preview.length > 60 ? '…' : ''}"?`,
                                [
                                  { text: 'Keep it', style: 'cancel' },
                                  { text: 'Delete', style: 'destructive', onPress: () => { setShowSecond(false); setPracticePoint2(''); setPriorityScore2(5); setShowDrill2(false); setDrill2(''); } },
                                ]
                              );
                            } else {
                              setShowSecond(false);
                              setPracticePoint2('');
                              setPriorityScore2(5);
                              setShowDrill2(false);
                              setDrill2('');
                            }
                          }}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                          <Text style={styles.removableX}>− Remove</Text>
                        </TouchableOpacity>
                      </View>
                      <VoiceInput
                        value={practicePoint2}
                        onChangeText={setPracticePoint2}
                        placeholder="What else do you need to work on?"
                      />
                      <View style={styles.urgencyRow}>
                        <Text style={styles.urgencyLabel}>Urgency</Text>
                        <Text style={styles.urgencyBadge}>{priorityScore2}/10</Text>
                      </View>
                      <UrgencySlider value={priorityScore2} onChange={setPriorityScore2} />

                      {showDrill2 ? (
                        <>
                          <View style={styles.removableHeader}>
                            <Text style={styles.removableLabel}>Drill</Text>
                            <TouchableOpacity
                              onPress={() => confirmRemoveDrill(drill2, () => { setShowDrill2(false); setDrill2(''); })}
                              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            >
                              <Text style={styles.removableX}>− Remove</Text>
                            </TouchableOpacity>
                          </View>
                          <VoiceInput
                            value={drill2}
                            onChangeText={setDrill2}
                            placeholder="Describe the drill…"
                            numberOfLines={2}
                            style={{ marginBottom: 4 }}
                          />
                        </>
                      ) : (
                        <TouchableOpacity style={styles.addLink} onPress={() => setShowDrill2(true)} activeOpacity={0.6}>
                          <Text style={styles.addLinkText}>+ Add a drill</Text>
                        </TouchableOpacity>
                      )}
                    </>
                  ) : (
                    <TouchableOpacity style={[styles.addLink, { marginTop: 4 }]} onPress={() => setShowSecond(true)} activeOpacity={0.6}>
                      <Text style={styles.addLinkText}>+ Add a second focus point</Text>
                    </TouchableOpacity>
                  )}

                  {/* ── Date ──────────────────────────────────────── */}
                  <View style={styles.dateSeparator} />
                  <TouchableOpacity style={styles.dateBtn} onPress={() => setShowDatePicker(!showDatePicker)} activeOpacity={0.75}>
                    <Text style={styles.dateBtnLabel}>Class date</Text>
                    <Text style={styles.dateBtnValue}>{formatDateLabel(classDate)} ▾</Text>
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

                  <View style={{ height: 100 }} />
                </>
              ) : (
                <>
                  {/* ── Review ────────────────────────────────────── */}
                  <Text style={styles.sectionTitle}>Looks good?</Text>

                  {/* Meta row */}
                  <View style={styles.reviewMetaBar}>
                    <View style={styles.reviewMetaChip}>
                      <Text style={styles.reviewMetaChipText}>{lessonType === 'private' ? 'Private' : 'Group'}</Text>
                    </View>
                    {teacherName.trim() ? (
                      <View style={styles.reviewMetaChip}>
                        <Text style={styles.reviewMetaChipText}>{teacherName.trim()}</Text>
                      </View>
                    ) : null}
                    {selectedDances.map(d => (
                      <View key={d} style={styles.reviewMetaChip}>
                        <Text style={styles.reviewMetaChipText}>{d}</Text>
                      </View>
                    ))}
                    <View style={styles.reviewMetaChip}>
                      <Text style={styles.reviewMetaChipText}>{formatDateLabel(classDate)}</Text>
                    </View>
                  </View>

                  {class_summary.trim() ? (
                    <View style={styles.reviewBlock}>
                      <Text style={styles.reviewBlockLabel}>Summary</Text>
                      <Text style={styles.reviewBlockText}>{class_summary}</Text>
                    </View>
                  ) : null}

                  <View style={styles.reviewBlock}>
                    <View style={styles.reviewBlockHeader}>
                      <View style={[styles.focusBadge, { backgroundColor: '#F0F0F0' }]}>
                        <Text style={[styles.focusBadgeText, { color: Colors.black }]}>01</Text>
                      </View>
                      <Text style={styles.reviewBlockLabel}>Focus · urgency {priorityScore1}/10</Text>
                    </View>
                    <Text style={styles.reviewBlockText}>{practicePoint1}</Text>
                    {showDrill && drill.trim() ? (
                      <View style={styles.reviewDrillRow}>
                        <Text style={styles.reviewDrillLabel}>Drill</Text>
                        <Text style={styles.reviewDrillText}>{drill}</Text>
                      </View>
                    ) : null}
                  </View>

                  {showSecond && practicePoint2.trim() ? (
                    <View style={styles.reviewBlock}>
                      <View style={styles.reviewBlockHeader}>
                        <View style={[styles.focusBadge, { backgroundColor: '#F0F0F0' }]}>
                          <Text style={[styles.focusBadgeText, { color: Colors.black }]}>02</Text>
                        </View>
                        <Text style={styles.reviewBlockLabel}>Focus · urgency {priorityScore2}/10</Text>
                      </View>
                      <Text style={styles.reviewBlockText}>{practicePoint2}</Text>
                      {showDrill2 && drill2.trim() ? (
                        <View style={styles.reviewDrillRow}>
                          <Text style={styles.reviewDrillLabel}>Drill</Text>
                          <Text style={styles.reviewDrillText}>{drill2}</Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  {!!error && <Text style={styles.error}>{error}</Text>}

                  <TouchableOpacity style={[styles.primaryBtn, { marginTop: 24 }]} onPress={handleSubmit} disabled={submitting} activeOpacity={0.85}>
                    {submitting ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <ActivityIndicator color={Colors.white} />
                        <Text style={styles.primaryBtnText}>Generating…</Text>
                      </View>
                    ) : (
                      <Text style={styles.primaryBtnText}>Save class</Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => setStep(1)} style={styles.backBtn} activeOpacity={0.7}>
                    <Text style={styles.backBtnText}>← Edit</Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>

            {/* ── Fixed bottom button (step 1 only) ──────────── */}
            {step === 1 && (
              <View style={styles.fixedBottom}>
                {!!error && <Text style={styles.errorAboveBtn}>{error}</Text>}
                <TouchableOpacity
                  style={[styles.primaryBtn, hasScrolled && styles.primaryBtnContinue]}
                  onPress={() => {
                    if (!hasScrolled) {
                      scrollViewRef.current?.scrollToEnd({ animated: true });
                    } else {
                      handleNext();
                    }
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.primaryBtnText}>
                    {hasScrolled ? 'Continue →' : 'Scroll down ↓'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // ── Shell ─────────────────────────────────────────────
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  kvContainer: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#FAFAFA',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    height: '92%',
    paddingBottom: 0,
    overflow: 'hidden',
  },

  // ── Header ────────────────────────────────────────────
  sheetHeader: {
    alignItems: 'center',
    paddingTop: 12,
    paddingHorizontal: Spacing.side,
    paddingBottom: 16,
  },
  handle: {
    width: 36, height: 4,
    backgroundColor: 'rgba(17,12,17,0.12)',
    borderRadius: 2, marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    width: '100%',
  },
  headerTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: Colors.black,
    letterSpacing: -0.3,
  },
  headerStep: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: Colors.secondary,
    marginTop: 3,
  },
  closeBtn:     { padding: 4 },
  closeBtnText: { fontSize: 16, color: Colors.secondary },

  body: { paddingHorizontal: Spacing.side, paddingTop: 4, paddingBottom: 24 },

  // ── Section title ──────────────────────────────────────
  sectionTitle: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 20,
  },
  sectionTitleBold: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: Colors.black,
    marginBottom: 10,
    marginTop: 20,
  },

  // ── Meta card ──────────────────────────────────────────
  metaCard: {
    backgroundColor: Colors.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EFEFEF',
    paddingHorizontal: 16,
    paddingVertical: 2,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    minHeight: 48,
  },
  metaLabel: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: Colors.black,
    width: 72,
  },
  metaValuePlaceholder: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: '#BDBDBD',
  },
  metaValueSelected: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: Colors.black,
    flexShrink: 1,
    textAlign: 'right',
  },
  metaDivider: { height: 1, backgroundColor: '#F5F5F5', marginHorizontal: -16 },

  // ── Pill toggle ────────────────────────────────────────
  pillToggleRow: {
    flexDirection: 'row',
    backgroundColor: '#F3F3F3',
    borderRadius: 12,
    padding: 3,
    gap: 0,
  },
  pillToggleItem: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 10,
  },
  pillToggleItemActive: { backgroundColor: Colors.white, shadowColor: '#000', shadowOpacity: 0.08, shadowOffset: { width: 0, height: 1 }, shadowRadius: 3, elevation: 2 },
  pillToggleText:       { fontFamily: Fonts.jakartaMedium, fontSize: 13, color: Colors.secondary },
  pillToggleTextActive: { fontFamily: Fonts.jakartaBold, color: Colors.black },

  // ── Teacher ────────────────────────────────────────────
  teacherChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.black,
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 7,
    gap: 8,
  },
  teacherChipText:  { fontFamily: Fonts.jakartaBold, fontSize: 13, color: Colors.white },
  teacherClear:     { opacity: 0.6 },
  teacherClearText: { fontSize: 11, color: Colors.white, fontFamily: Fonts.jakartaBold },
  teacherInputWrap: {
    borderBottomWidth: 1.5,
    borderBottomColor: Colors.black,
    minWidth: 160,
  },
  teacherInput: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: Colors.black,
    paddingVertical: 5,
    paddingHorizontal: 2,
    textAlign: 'right',
  },
  suggestionBox: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    marginTop: 2,
    marginBottom: 6,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  suggestionItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#F5F5F5',
  },
  suggestionText: { fontFamily: Fonts.jakartaMedium, fontSize: 14, color: Colors.black },

  // ── Dance selector ─────────────────────────────────────
  danceScroll:        { marginHorizontal: -16 },
  danceScrollContent: { paddingHorizontal: 16, gap: 7, paddingBottom: 14 },
  dancePill: {
    paddingHorizontal: 15,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F3F3F3',
  },
  dancePillActive:     { backgroundColor: Colors.black },
  dancePillText:       { fontFamily: Fonts.jakartaMedium, fontSize: 13, color: Colors.secondary },
  dancePillTextActive: { color: Colors.white, fontFamily: Fonts.jakartaBold },

  // ── Focus block ────────────────────────────────────────
  focusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 20,
    marginBottom: 10,
  },
  focusBadge: {
    width: 22, height: 22, borderRadius: 6,
    backgroundColor: Colors.black,
    alignItems: 'center', justifyContent: 'center',
  },
  focusBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: Colors.white,
    letterSpacing: 0.5,
  },
  focusTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
    color: Colors.black,
  },

  // ── Voice input ────────────────────────────────────────
  voiceInputWrap: {
    position: 'relative',
    marginBottom: 12,
  },
  micOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 1,
  },

  // ── Inputs ─────────────────────────────────────────────
  inputBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 12,
  },
  filledInput: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 14,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.black,
    textAlignVertical: 'top',
    minHeight: 88,
    borderWidth: 1,
    borderColor: '#EFEFEF',
    lineHeight: 21,
  },
  drillInput: { minHeight: 64, backgroundColor: '#F9F9F9' },
  micWrap: { paddingTop: 2 },
  micBtn:       { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  micBtnActive: {},
  micIcon:      { fontSize: 18 },

  // ── Urgency ────────────────────────────────────────────
  urgencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
    marginTop: 4,
  },
  urgencyLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: Colors.secondary,
    letterSpacing: 0.3,
  },
  urgencyBadge: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 12,
    color: Colors.black,
    backgroundColor: '#F3F3F3',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
  },
  urgencyValue: { fontFamily: Fonts.jakartaMedium, fontSize: 11, color: Colors.secondary, textAlign: 'right', marginTop: -4 },
  sliderWrap:   { marginBottom: 12 },
  slider:       { width: '100%', height: 40 },

  // ── Removable section header ───────────────────────────
  removableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    marginTop: 4,
  },
  removableLabel: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: Colors.secondary,
  },
  removeBlock: {
    marginLeft: 'auto',
  },
  removableX: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: '#E84040',
  },

  // ── Add link ───────────────────────────────────────────
  addLink: {
    paddingVertical: 10,
    marginBottom: 4,
  },
  addLinkText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 14,
    color: Colors.activeLog,
  },

  // ── Date ───────────────────────────────────────────────
  dateSeparator: { height: 1, backgroundColor: '#F0F0F0', marginVertical: 20 },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EFEFEF',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dateBtnLabel: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: Colors.black },
  dateBtnValue: { fontFamily: Fonts.jakartaMedium, fontSize: 14, color: Colors.secondary },
  datePicker:   { width: '100%' },

  // ── Review ─────────────────────────────────────────────
  reviewMetaBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginBottom: 16,
  },
  reviewMetaChip: {
    backgroundColor: '#F3F3F3',
    borderRadius: 20,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  reviewMetaChipText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: Colors.black,
  },
  reviewBlock: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#EFEFEF',
  },
  reviewBlockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  reviewBlockLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  reviewBlockText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.black,
    lineHeight: 21,
  },
  reviewDrillRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F5F5F5',
  },
  reviewDrillLabel: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  reviewDrillText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.black,
    lineHeight: 19,
  },

  // ── Fixed bottom bar ───────────────────────────────────
  fixedBottom: {
    paddingHorizontal: Spacing.side,
    paddingTop: 12,
    paddingBottom: 28,
    backgroundColor: '#FAFAFA',
    borderTopWidth: 1,
    borderTopColor: '#EFEFEF',
  },

  // ── Actions ────────────────────────────────────────────
  primaryBtn: {
    backgroundColor: Colors.black,
    borderRadius: 18,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: 0,
  },
  primaryBtnContinue: {
    backgroundColor: '#FF6B00',
  },
  primaryBtnText: {
    color: Colors.white,
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    letterSpacing: 0.3,
  },
  backBtn:     { alignItems: 'center', marginTop: 16 },
  backBtnText: { fontFamily: Fonts.jakartaMedium, fontSize: 14, color: Colors.secondary },
  error:          { color: '#E84040', fontSize: 13, marginTop: 8 },
  errorAboveBtn:  { color: '#E84040', fontSize: 13, fontFamily: Fonts.jakartaMedium, textAlign: 'center', marginBottom: 8 },
});
