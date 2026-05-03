import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
  Modal,
  Pressable,
  TextInput,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
  PanResponder,
  LayoutAnimation,
  UIManager,
  Alert,
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import Slider from '@react-native-community/slider';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  createAudioPlayer,
  useAudioRecorder,
} from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../theme';
import { getFocusPoints, getClassInputsForFocus, getClassInputs, getTrainingSessionsThisWeek, getTeacherContextForAI, askCoach } from '../storage/storage';
import { callClaudeChat } from '../services/ai/anthropic';
import { completeTrainingSession, getSessionLabel } from '../utils/algorithm';
import {
  setActiveSession,
  getActiveSession,
  clearActiveSession,
  getSessionTimeLeft,
} from '../storage/activeSession';
import {
  startFocusPoint as laStartFocusPoint,
  updateFocusPoint as laUpdateFocusPoint,
  endFocusPoint as laEndFocusPoint,
} from 'live-activities';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

async function transcribeAudio(uri) {
  if (!OPENAI_API_KEY || OPENAI_API_KEY.startsWith('sk-ant-')) {
    throw new Error('NO_OPENAI_KEY');
  }
  const formData = new FormData();
  formData.append('file', { uri, type: 'audio/m4a', name: 'recording.m4a' });
  formData.append('model', 'whisper-1');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Whisper ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.text || '';
}

const DURATIONS = [0.17, 5, 10, 15, 20, 25, 30, 45, 60, 90]; // 0.17 ≈ 10s for testing
const TICK_SOUND = require('../../assets/metronome_tick.wav');

const FEELINGS = [
  { emoji: '😤', label: 'Hard' },
  { emoji: '😰', label: 'Struggled' },
  { emoji: '😐', label: 'Okay' },
  { emoji: '🙂', label: 'Good' },
  { emoji: '🔥', label: 'Great' },
];

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// WDSF competition tempos — BPM = bars/min × beats/bar
const DANCES = [
  { id: 'chacha',    name: 'Cha Cha',    bpm: 120, beats: 4, category: 'L' }, // 30 bars/min × 4
  { id: 'samba',     name: 'Samba',      bpm: 100, beats: 2, category: 'L' }, // 50 bars/min × 2
  { id: 'rumba',     name: 'Rumba',      bpm: 100, beats: 4, category: 'L' }, // 25 bars/min × 4
  { id: 'paso',      name: 'Paso Doble', bpm: 124, beats: 2, category: 'L' }, // 62 bars/min × 2
  { id: 'jive',      name: 'Jive',       bpm: 176, beats: 4, category: 'L' }, // 44 bars/min × 4
  { id: 'waltz',     name: 'Waltz',      bpm: 90,  beats: 3, category: 'S' }, // 30 bars/min × 3
  { id: 'tango',     name: 'Tango',      bpm: 132, beats: 4, category: 'S' }, // 33 bars/min × 4
  { id: 'vwaltz',    name: 'V.Waltz',    bpm: 180, beats: 3, category: 'S' }, // 60 bars/min × 3
  { id: 'foxtrot',   name: 'Foxtrot',    bpm: 120, beats: 4, category: 'S' }, // 30 bars/min × 4
  { id: 'quickstep', name: 'Quickstep',  bpm: 200, beats: 4, category: 'S' }, // 50 bars/min × 4
];

// ─── Session Skeleton Bones (renders INSIDE the focus card) ──────────────────

function SessionSkeletonBones() {
  const pulse = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    // Hold the loop reference so we can stop it on unmount. Without this,
    // the animation keeps driving the native value (and any setState chains
    // attached to it) after the skeleton is replaced — every focus-session
    // open used to leak one of these.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.8, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => { try { loop.stop(); } catch {} };
  }, []);

  const Bone = ({ width, height, radius = 8, style }) => (
    <View style={[{ width, height, borderRadius: radius, backgroundColor: 'rgba(255,255,255,0.08)' }, style]} />
  );

  return (
    <Animated.View style={{ opacity: pulse }}>
      <Bone width={80} height={12} radius={4} style={{ marginBottom: 14 }} />
      <Bone width="75%" height={26} radius={6} style={{ marginBottom: 10 }} />
      <Bone width="100%" height={14} radius={4} style={{ marginBottom: 6 }} />
      <Bone width="65%" height={14} radius={4} style={{ marginBottom: 16 }} />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 4 }}>
        <Bone width={18} height={4} radius={2} />
        <Bone width={4} height={4} radius={2} />
        <Bone width={4} height={4} radius={2} />
      </View>
    </Animated.View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ─── Class Input Detail Modal ─────────────────────────────────────────────────

function UrgencyDots({ value }) {
  return (
    <View style={modal.urgencyDots}>
      {[1, 2, 3, 4, 5].map((n) => (
        <View key={n} style={[modal.urgencyDot, n <= value && { backgroundColor: Colors.activeLog }]} />
      ))}
    </View>
  );
}

function ClassInputModal({ input, onClose }) {
  if (!input) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={modal.overlay} onPress={onClose}>
        <Pressable style={modal.sheet} onPress={() => {}}>
          <View style={modal.handle} />

          {/* Header */}
          <View style={modal.header}>
            <Text style={modal.date}>{formatDate(input.created_at)}</Text>
            <TouchableOpacity onPress={onClose} style={modal.closeBtn} activeOpacity={0.7}>
              <Text style={modal.closeIcon}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Your Notes */}
            <View style={modal.section}>
              <Text style={modal.sectionLabel}>Your Notes</Text>

              {!!input.class_summary && (
                <View style={[modal.card, { marginBottom: 10 }]}>
                  <Text style={modal.cardInputLabel}>What you worked on</Text>
                  <Text style={modal.cardText}>{input.class_summary}</Text>
                </View>
              )}

              {!!input.practice_point_1 && (
                <View style={[modal.card, { marginBottom: input.practice_point_2 ? 10 : 0 }]}>
                  <Text style={modal.cardInputLabel}>To improve</Text>
                  <Text style={modal.cardText}>{input.practice_point_1}</Text>
                  {input.priority_score_1 != null && (
                    <View style={modal.urgencyRow}>
                      <Text style={modal.urgencyLabel}>Urgency</Text>
                      <UrgencyDots value={input.priority_score_1} />
                    </View>
                  )}
                </View>
              )}

              {!!input.practice_point_2 && (
                <View style={modal.card}>
                  <Text style={modal.cardInputLabel}>Also to improve</Text>
                  <Text style={modal.cardText}>{input.practice_point_2}</Text>
                  {input.priority_score_2 != null && (
                    <View style={modal.urgencyRow}>
                      <Text style={modal.urgencyLabel}>Urgency</Text>
                      <UrgencyDots value={input.priority_score_2} />
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* Linked Focus */}
            {(!!input.ai_primary_focus || !!input.ai_secondary_focus) && (
              <>
                <View style={modal.divider} />
                <View style={modal.section}>
                  <Text style={modal.sectionLabel}>Linked Focus</Text>
                  {!!input.ai_primary_focus && (
                    <View style={[modal.focusChip, { marginBottom: input.ai_secondary_focus ? 8 : 0 }]}>
                      <View style={modal.fpDot} />
                      <Text style={modal.focusChipText}>{input.ai_primary_focus}</Text>
                    </View>
                  )}
                  {!!input.ai_secondary_focus && (
                    <View style={modal.focusChip}>
                      <View style={[modal.fpDot, { backgroundColor: Colors.activeFocus }]} />
                      <Text style={modal.focusChipText}>{input.ai_secondary_focus}</Text>
                    </View>
                  )}
                </View>
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Linked Class Notes ───────────────────────────────────────────────────────

function LinkedClassPage({ inputs, loading, onSelect }) {
  if (loading) {
    return (
      <View style={ln.wrap}>
        <ActivityIndicator size="small" color="rgba(255,255,255,0.3)" />
      </View>
    );
  }
  if (!inputs.length) return null;
  return (
    <View style={ln.wrap}>
      <Text style={ln.heading}>Linked Class</Text>
      {inputs.slice(0, 3).map((inp) => (
        <TouchableOpacity key={inp.id} style={ln.row} onPress={() => onSelect(inp)} activeOpacity={0.7}>
          <Text style={ln.date}>{formatDate(inp.created_at)}</Text>
          <Text style={ln.text} numberOfLines={1}>{inp.practice_point_1}</Text>
          <Text style={ln.arrow}>›</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function FocusPager({ focusPoint, inputs, loading, onSelect }) {
  const hasNote = !!focusPoint?.coach_note;
  const hasClasses = loading || inputs.length > 0;
  const totalPages = hasNote && hasClasses ? 2 : 1;

  const [page, setPage] = useState(0);
  const totalPagesRef = useRef(totalPages);
  totalPagesRef.current = totalPages;

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, { dx, dy }) =>
      totalPagesRef.current > 1 && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8,
    onPanResponderRelease: (_, { dx }) => {
      if (dx < -30) setPage(p => Math.min(p + 1, totalPagesRef.current - 1));
      else if (dx > 30) setPage(p => Math.max(p - 1, 0));
    },
  })).current;

  if (!hasNote && !hasClasses) return null;

  if (totalPages === 1) {
    if (hasNote) return (
      <View style={ln.wrap}>
        <Text style={ln.heading}>Coach</Text>
        <Text style={ln.coachNoteText}>{focusPoint.coach_note}</Text>
      </View>
    );
    return <LinkedClassPage inputs={inputs} loading={loading} onSelect={onSelect} />;
  }

  return (
    <View {...panResponder.panHandlers}>
      {page === 0 ? (
        <View style={ln.wrap}>
          <View style={ln.pageHeader}>
            <Text style={ln.heading}>Coach</Text>
            <Text style={ln.swipeHint}>swipe ›</Text>
          </View>
          <Text style={ln.coachNoteText}>{focusPoint.coach_note}</Text>
        </View>
      ) : (
        <View style={ln.wrap}>
          <View style={ln.pageHeader}>
            <Text style={ln.heading}>Linked Class</Text>
            <Text style={ln.swipeHint}>‹ swipe</Text>
          </View>
          {inputs.slice(0, 3).map((inp) => (
            <TouchableOpacity key={inp.id} style={ln.row} onPress={() => onSelect(inp)} activeOpacity={0.7}>
              <Text style={ln.date}>{formatDate(inp.created_at)}</Text>
              <Text style={ln.text} numberOfLines={1}>{inp.practice_point_1}</Text>
              <Text style={ln.arrow}>›</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <View style={ln.dots}>
        <View style={[ln.dot, page === 0 && ln.dotActive]} />
        <View style={[ln.dot, page === 1 && ln.dotActive]} />
      </View>
    </View>
  );
}

// ─── Metronome ────────────────────────────────────────────────────────────────

const M_ITEM_H = 38;
const BPM_VALUES = Array.from({ length: 181 }, (_, i) => 40 + i); // 40–220 step 1

const MetronomeStrip = memo(function MetronomeStrip({ onRunningChange, onBeat, focusDances }) {
  const defaultBpmIdx = BPM_VALUES.indexOf(120);
  const [bpmIdx, setBpmIdx]   = useState(defaultBpmIdx);
  const [danceIdx, setDanceIdx] = useState(0);
  const [hasScrolledDance, setHasScrolledDance] = useState(false);
  const [running, setRunning]  = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0); // 0-based, 0 = downbeat

  // Resolve which dance to pick when BPM matches multiple dances
  // Priority: dance linked to the focus point > random pick
  const focusDanceNames = (Array.isArray(focusDances) ? focusDances : []).map(d => (d || '').toLowerCase());

  const bpmRef   = useRef(BPM_VALUES[defaultBpmIdx]);
  const beatsRef = useRef(DANCES[0].beats); // beats per bar
  const beatRef  = useRef(0);               // current beat counter
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const schedulerRef    = useRef(null);
  const tickTimeoutsRef = useRef([]);
  const nextTickAtRef   = useRef(0);
  const soundPoolRef    = useRef([]);
  const poolIdxRef      = useRef(0);
  const danceScrollRef  = useRef(null);
  const bpmScrollRef    = useRef(null);
  const bpmScrollIsAuto = useRef(false);

  useEffect(() => { bpmRef.current = BPM_VALUES[bpmIdx]; }, [bpmIdx]);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    // 6 players: 0-2 = accent (downbeat), 3-5 = soft (off-beats)
    soundPoolRef.current = [0, 1, 2, 3, 4, 5].map(() => createAudioPlayer(TICK_SOUND));
    return () => {
      stopMetro();
      soundPoolRef.current.forEach(p => { try { p.remove(); } catch {} });
      soundPoolRef.current = [];
    };
  }, []);

  function playTick(isDownbeat) {
    const pool = soundPoolRef.current;
    if (!pool.length) return;
    // Accent pool: 0-2, soft pool: 3-5
    const baseIdx = isDownbeat ? 0 : 3;
    const idx = baseIdx + (poolIdxRef.current % 3);
    const player = pool[idx];
    try {
      player.volume = isDownbeat ? 1.0 : 0.35;
      player.seekTo(0).catch(() => {});
      player.play();
    } catch {}
    poolIdxRef.current = (poolIdxRef.current + 1) % 3;
  }

  function fireBeat(beatNum) {
    const isDownbeat = beatNum === 0;
    pulseAnim.setValue(isDownbeat ? 1.5 : 1.2);
    Animated.timing(pulseAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    setCurrentBeat(beatNum);
    if (isDownbeat) onBeat?.();
    playTick(isDownbeat);
  }

  function startMetro(overrideBpm) {
    const initialBpm = overrideBpm ?? bpmRef.current;
    beatRef.current = 0;
    fireBeat(0);
    beatRef.current = 1;
    nextTickAtRef.current = Date.now() + (60000 / initialBpm);

    function scheduler() {
      const intervalMs = 60000 / bpmRef.current;
      const now = Date.now();
      while (nextTickAtRef.current < now + 300) {
        const delay = Math.max(0, nextTickAtRef.current - now);
        const capturedBeat = beatRef.current;
        const id = setTimeout(() => {
          fireBeat(capturedBeat);
        }, delay);
        tickTimeoutsRef.current.push(id);
        beatRef.current = (beatRef.current + 1) % beatsRef.current;
        nextTickAtRef.current += intervalMs;
      }
      if (tickTimeoutsRef.current.length > 40)
        tickTimeoutsRef.current = tickTimeoutsRef.current.slice(-20);
    }
    schedulerRef.current = setInterval(scheduler, 50);
    setRunning(true); onRunningChange?.(true);
  }

  function stopMetro() {
    if (schedulerRef.current) clearInterval(schedulerRef.current);
    schedulerRef.current = null;
    tickTimeoutsRef.current.forEach(id => clearTimeout(id));
    tickTimeoutsRef.current = [];
    pulseAnim.setValue(1);
    beatRef.current = 0;
    setCurrentBeat(0);
    setRunning(false); onRunningChange?.(false);
  }

  function toggleMetro() { running ? stopMetro() : startMetro(); }

  function onDanceScrollEnd(e) {
    const idx = Math.max(0, Math.min(DANCES.length - 1, Math.round(e.nativeEvent.contentOffset.y / M_ITEM_H)));
    setDanceIdx(idx);
    if (!hasScrolledDance) setHasScrolledDance(true);
    setIsCustomBpm(false);
    const dance = DANCES[idx];
    beatsRef.current = dance.beats;
    beatRef.current  = 0;
    const newBpmIdx = BPM_VALUES.reduce((best, b, i) =>
      Math.abs(b - dance.bpm) < Math.abs(BPM_VALUES[best] - dance.bpm) ? i : best, 0);
    setBpmIdx(newBpmIdx);
    bpmRef.current = BPM_VALUES[newBpmIdx];
    bpmScrollRef.current?.scrollTo({ y: newBpmIdx * M_ITEM_H, animated: false });
    if (running) { stopMetro(); setTimeout(() => startMetro(BPM_VALUES[newBpmIdx]), 50); }
  }

  const [isCustomBpm, setIsCustomBpm] = useState(false);

  function resolveDanceForBpm(bpm) {
    const matches = DANCES.map((d, i) => ({ ...d, idx: i })).filter(d => d.bpm === bpm);
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    // Multiple dances share this BPM — prefer the one linked to focus point
    const linked = matches.find(d => focusDanceNames.includes(d.name.toLowerCase()));
    return linked || matches[Math.floor(Math.random() * matches.length)];
  }

  function onBpmScrollEnd(e) {
    const idx = Math.max(0, Math.min(BPM_VALUES.length - 1, Math.round(e.nativeEvent.contentOffset.y / M_ITEM_H)));
    setBpmIdx(idx);
    bpmRef.current = BPM_VALUES[idx];

    const matched = resolveDanceForBpm(BPM_VALUES[idx]);
    if (matched) {
      setDanceIdx(matched.idx);
      beatsRef.current = matched.beats;
      beatRef.current = 0;
      setHasScrolledDance(true);
      setIsCustomBpm(false);
      danceScrollRef.current?.scrollTo({ y: matched.idx * M_ITEM_H, animated: false });
    } else {
      setIsCustomBpm(true);
    }

    if (running) { stopMetro(); setTimeout(() => startMetro(BPM_VALUES[idx]), 50); }
  }

  const beats = DANCES[danceIdx]?.beats ?? 4;

  return (
    <View style={m.wrap}>
      {/* Dance scroll */}
      <ScrollView
        ref={danceScrollRef}
        style={m.col}
        showsVerticalScrollIndicator={false}
        snapToInterval={M_ITEM_H}
        decelerationRate="fast"
        contentOffset={{ x: 0, y: danceIdx * M_ITEM_H }}
        onMomentumScrollEnd={onDanceScrollEnd}
        contentContainerStyle={m.scrollContent}
      >
        {DANCES.map((d, i) => {
          const dist = Math.abs(i - danceIdx);
          const isCenter = dist === 0;
          const label = isCenter && isCustomBpm
            ? 'Custom BPM'
            : (isCenter && !hasScrolledDance)
              ? 'Scroll to select'
              : d.name;
          const isPlaceholder = isCenter && (isCustomBpm || !hasScrolledDance);
          return (
            <View key={d.id} style={m.item}>
              <Text style={[
                m.danceText,
                isCenter && m.itemActive,
                isPlaceholder && m.itemPlaceholder,
              ]}>{label}</Text>
            </View>
          );
        })}
      </ScrollView>

      {/* Separator */}
      <View style={m.sep} />

      {/* BPM scroll */}
      <ScrollView
        ref={bpmScrollRef}
        style={m.colBpm}
        showsVerticalScrollIndicator={false}
        snapToInterval={M_ITEM_H}
        decelerationRate="fast"
        contentOffset={{ x: 0, y: bpmIdx * M_ITEM_H }}
        onMomentumScrollEnd={onBpmScrollEnd}
        contentContainerStyle={m.scrollContent}
      >
        {BPM_VALUES.map((b, i) => {
          const dist = Math.abs(i - bpmIdx);
          return (
            <View key={b} style={m.item}>
              <Text style={[m.bpmText, dist === 0 && m.itemActive]}>{b}</Text>
            </View>
          );
        })}
      </ScrollView>

      {/* Beat dots + play */}
      <View style={m.right}>
        <TouchableOpacity
          style={[m.playBtn, running && m.playBtnActive]}
          onPress={toggleMetro}
          activeOpacity={0.8}
        >
          <Animated.View style={running ? { transform: [{ scale: pulseAnim }] } : undefined}>
            <Text style={[m.playIcon, running && m.playIconActive]}>{running ? '■' : '▶'}</Text>
          </Animated.View>
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ─── Feeling Slider ───────────────────────────────────────────────────────────

function FeelingSlider({ value, onChange }) {
  const sliderValue = value !== null ? value : 2; // default center

  return (
    <View style={sl.wrap}>
      <Slider
        style={sl.slider}
        minimumValue={0}
        maximumValue={4}
        step={1}
        value={sliderValue}
        onValueChange={onChange}
        minimumTrackTintColor={Colors.orange}
        maximumTrackTintColor="rgba(17,12,17,0.12)"
        thumbTintColor={Colors.orange}
      />
      <View style={sl.row}>
        {FEELINGS.map((f, i) => (
          <Text key={i} style={[sl.label, value === i && sl.labelOn]}>{f.label}</Text>
        ))}
      </View>
    </View>
  );
}

// ─── Session Feeling Modal ────────────────────────────────────────────────────

function SessionFeelingModal({ visible, focusName, onSave, onSkip }) {
  const [feelingIdx, setFeelingIdx] = useState(2);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const slideAnim = useRef(new Animated.Value(600)).current;

  useEffect(() => {
    if (visible) {
      setFeelingIdx(2);
      setNote('');
      setSaving(false);
      slideAnim.setValue(600);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 60,
        friction: 14,
      }).start();
    }
  }, [visible]);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    const label = FEELINGS[feelingIdx].label;
    await onSave(label, note.trim() || null);
  }

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => {}}>
      <Animated.View style={[fm.container, { transform: [{ translateY: slideAnim }] }]} onStartShouldSetResponder={() => { Keyboard.dismiss(); return false; }}>

        <View style={fm.content}>
          <Text style={fm.focusLabel}>{focusName}</Text>
          <Text style={fm.title}>Session Complete ✓</Text>
          <Text style={fm.subtitle}>How did it go?</Text>

          <FeelingSlider value={feelingIdx} onChange={setFeelingIdx} />

          <TextInput
            style={fm.noteInput}
            placeholder="Any notes? (optional)"
            placeholderTextColor="rgba(17,12,17,0.25)"
            multiline
            numberOfLines={3}
            maxLength={300}
            value={note}
            onChangeText={setNote}
            textAlignVertical="top"
          />

        </View>

        <View style={fm.btnWrap}>
          <TouchableOpacity style={fm.saveBtn} onPress={handleSave} activeOpacity={0.88} disabled={saving}>
            <Text style={fm.saveBtnText}>{saving ? 'Saving…' : 'Save & Continue'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={fm.skipBtn} onPress={onSkip} activeOpacity={0.7}>
            <Text style={fm.skipBtnText}>Skip</Text>
          </TouchableOpacity>
        </View>

      </Animated.View>
    </Modal>
  );
}

// ─── Duration Picker ─────────────────────────────────────────────────────────

const ITEM_H = 40;

function DurationPicker({ value, onChange }) {
  const defaultIdx = Math.max(0, DURATIONS.indexOf(value));
  const scrollY = useRef(new Animated.Value(defaultIdx * ITEM_H)).current;

  function onScrollEnd(e) {
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.max(0, Math.min(DURATIONS.length - 1, Math.round(y / ITEM_H)));
    onChange(DURATIONS[idx]);
  }

  return (
    <View style={dp.row}>
      <View>
        <Text style={dp.labelSmall}>Focus training</Text>
        <Text style={dp.labelBig}>time</Text>
      </View>
      <View style={dp.wheel}>
        <View pointerEvents="none" style={dp.selectionLine} />
        <View pointerEvents="none" style={[dp.selectionLine, dp.selectionLineBottom]} />
        <ScrollView
          showsVerticalScrollIndicator={false}
          snapToInterval={ITEM_H}
          decelerationRate="fast"
          contentOffset={{ x: 0, y: defaultIdx * ITEM_H }}
          onMomentumScrollEnd={onScrollEnd}
          scrollEventThrottle={16}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: false }
          )}
          contentContainerStyle={dp.content}
        >
          {DURATIONS.map((d, i) => {
            const center = i * ITEM_H;
            const inputRange = [
              center - ITEM_H,
              center,
              center + ITEM_H,
            ];
            const opacity = scrollY.interpolate({
              inputRange,
              outputRange: [0.2, 1, 0.2],
              extrapolate: 'clamp',
            });
            const scale = scrollY.interpolate({
              inputRange,
              outputRange: [0.78, 1, 0.78],
              extrapolate: 'clamp',
            });
            return (
              <Animated.View key={d} style={[dp.item, { opacity, transform: [{ scale }] }]}>
                <Text style={dp.num}>{d}</Text>
                <Text style={dp.unit}>min</Text>
              </Animated.View>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function FocusSessionScreen({ route, navigation }) {
  const { focusPointId, sessionId, rank = 0, sessionCount = 0 } = route.params;
  const [focusPoint, setFocusPoint] = useState(null);
  const [classInputs, setClassInputs] = useState([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [selectedInput, setSelectedInput] = useState(null);
  const [duration, setDuration] = useState(25);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionPaused, setSessionPaused] = useState(false);
  const [sessionDone, setSessionDone] = useState(false);
  const [contextExpanded, setContextExpanded] = useState(false);
  const contextExpandedRef = useRef(false);
  const contextAnim = useRef(new Animated.Value(0)).current;
  const [contextHeight, setContextHeight] = useState(0);

  function toggleContext(forceTo) {
    // Use ref to avoid stale closure issues (onTouchEnd re-renders can cause stale contextExpanded)
    const next = forceTo !== undefined ? forceTo : !contextExpandedRef.current;
    contextExpandedRef.current = next;
    setContextExpanded(next);
    Animated.spring(contextAnim, {
      toValue: next ? 1 : 0,
      useNativeDriver: false,
      bounciness: 0,
      speed: 16,
    }).start();
  }

  const [metroOpen, setMetroOpen] = useState(false);
  const [metroRunning, setMetroRunning] = useState(false);
  const metroAnim = useRef(new Animated.Value(0)).current;
  const beatAnim  = useRef(new Animated.Value(0)).current;

  const [aiOpen, setAiOpen] = useState(false);
  const aiAnim = useRef(new Animated.Value(0)).current;
  const aiIsAnimatingRef = useRef(false);
  const [aiChatHeight, setAiChatHeight] = useState(0);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiMessages, setAiMessages] = useState([]);
  const [aiSending, setAiSending] = useState(false);
  const [aiContext, setAiContext] = useState(null);
  const aiScrollRef = useRef(null);
  const [aiRecording, setAiRecording] = useState(false);
  const [aiTranscribing, setAiTranscribing] = useState(false);
  const aiRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  function handleBeat() {
    beatAnim.setValue(1);
    Animated.timing(beatAnim, { toValue: 0, duration: 200, useNativeDriver: false }).start();
  }
  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [overTime, setOverTime] = useState(0);
  const overTimeRef = useRef(0);

  // Overrun protection: if the user lets the chrono run after the target
  // is reached we prompt them after 5 min, then auto-stop after another 5
  // min with a capped duration. See _startInterval for the trigger.
  const OVERRUN_FIRST_PROMPT_SEC = 5 * 60;
  const OVERRUN_EXTEND_SEC = 5 * 60;
  const OVERRUN_AUTO_STOP_MS = 5 * 60 * 1000;
  const [overrunModalOpen, setOverrunModalOpen] = useState(false);
  const overrunModalOpenRef = useRef(false);
  const overrunNextThresholdRef = useRef(OVERRUN_FIRST_PROMPT_SEC);
  const overrunTriggerSecRef = useRef(OVERRUN_FIRST_PROMPT_SEC);
  const overrunAutoStopTimerRef = useRef(null);
  const [showFeelingModal, setShowFeelingModal] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const sessionCompletedRef = useRef(false);
  const stopHoldAnim = useRef(new Animated.Value(0)).current;
  const stopHoldTimerRef = useRef(null);
  const { width: screenW } = useWindowDimensions();
  const intervalRef = useRef(null);
  const contentFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (sessionDone) setShowFeelingModal(true);
  }, [sessionDone]);

  useEffect(() => {
    async function loadData() {
      const points = await getFocusPoints();
      const fp = points.find(p => p.id === focusPointId) || null;
      if (fp) {
        // Smooth height transition from skeleton → real content
        LayoutAnimation.configureNext({
          duration: 300,
          update: { type: LayoutAnimation.Types.easeInEaseOut },
          create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
          delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
        });
        contentFade.setValue(0);
        setFocusPoint(fp);
        Animated.timing(contentFade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
        const inputs = await getClassInputsForFocus(fp.name);
        setClassInputs(inputs);
      }
      setNotesLoading(false);
    }
    loadData();
  }, [focusPointId]);

  useEffect(() => {
    (async () => {
      try {
        const [teacherContext, sessionsCount] = await Promise.all([
          getTeacherContextForAI().catch(() => null),
          getTrainingSessionsThisWeek(),
        ]);
        setAiContext({ teacherContext, sessionsCount });
      } catch {}
    })();
  }, []);

  useFocusEffect(useCallback(() => {
    const existing = getActiveSession();
    if (existing && existing.sessionId === sessionId) {
      const remaining = Math.floor(getSessionTimeLeft());
      setDuration(existing.duration);
      setTimeLeft(Math.max(0, remaining));
      setSessionActive(true);
      if (existing.pausedRemaining !== undefined) {
        setSessionPaused(true);
      } else {
        setSessionPaused(false);
        _startInterval(existing.startedAt, existing.duration);
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (overrunAutoStopTimerRef.current) {
        clearTimeout(overrunAutoStopTimerRef.current);
        overrunAutoStopTimerRef.current = null;
      }
    };
  }, [sessionId]));

  function _stopOverTime() {
    overTimeRef.current = 0;
    setOverTime(0);
  }

  function _startInterval(startedAt, dur) {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const totalSeconds = dur * 60;
    intervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const remaining = totalSeconds - elapsed;
      if (remaining > 0) {
        setTimeLeft(Math.floor(remaining));
        setOverTime(0);
      } else {
        setTimeLeft(0);
        const over = Math.floor(-remaining);
        overTimeRef.current = over;
        setOverTime(over);
        // Overrun safety net: when the user blows past their target by
        // overrunNextThresholdRef seconds, ask if they're still training.
        // If they don't answer within OVERRUN_AUTO_STOP_MS we auto-save
        // with the duration capped at that threshold so a forgotten chrono
        // never inflates a focus point's recorded practice time.
        if (
          over >= overrunNextThresholdRef.current &&
          !overrunModalOpenRef.current &&
          !sessionCompletedRef.current &&
          !showFeelingModal
        ) {
          openOverrunModal();
        }
      }
    }, 1000);
  }

  async function startSession() {
    const startedAt = Date.now();
    let liveActivityId = null;
    try {
      liveActivityId = await laStartFocusPoint({
        focusPointName: focusPoint?.name || 'Focus point',
        startedAt,
        targetSec: duration ? duration * 60 : null,
      });
    } catch (err) {
      console.warn('[FocusSession] Could not start live activity:', err);
    }
    setActiveSession({ sessionId, focusPointId, focusPointName: focusPoint?.name, rank, sessionCount, duration, startedAt, liveActivityId });
    setSessionActive(true);
    setSessionDone(false);
    setTimeLeft(duration * 60);
    _stopOverTime();
    overrunNextThresholdRef.current = OVERRUN_FIRST_PROMPT_SEC;
    overrunTriggerSecRef.current = OVERRUN_FIRST_PROMPT_SEC;
    cancelOverrunAutoStop();
    overrunModalOpenRef.current = false;
    setOverrunModalOpen(false);
    _startInterval(startedAt, duration);
  }

  function cancelOverrunAutoStop() {
    if (overrunAutoStopTimerRef.current) {
      clearTimeout(overrunAutoStopTimerRef.current);
      overrunAutoStopTimerRef.current = null;
    }
  }

  function openOverrunModal() {
    overrunTriggerSecRef.current = overrunNextThresholdRef.current;
    overrunModalOpenRef.current = true;
    setOverrunModalOpen(true);
    cancelOverrunAutoStop();
    overrunAutoStopTimerRef.current = setTimeout(() => {
      autoCompleteOverrun();
    }, OVERRUN_AUTO_STOP_MS);
  }

  function extendOverrun() {
    cancelOverrunAutoStop();
    overrunNextThresholdRef.current += OVERRUN_EXTEND_SEC;
    overrunModalOpenRef.current = false;
    setOverrunModalOpen(false);
  }

  function confirmStopOverrun() {
    cancelOverrunAutoStop();
    overrunModalOpenRef.current = false;
    setOverrunModalOpen(false);
    handleEndSession();
  }

  async function autoCompleteOverrun() {
    cancelOverrunAutoStop();
    overrunModalOpenRef.current = false;
    setOverrunModalOpen(false);
    if (sessionCompletedRef.current) return;
    sessionCompletedRef.current = true;
    if (intervalRef.current) clearInterval(intervalRef.current);
    _stopOverTime();
    setSessionActive(false);
    setSessionPaused(false);
    // Cap duration at target + the threshold that was active when the
    // modal opened (so first cycle = target + 5 min, after one extension
    // = target + 10 min, etc). We achieve the cap by faking startedAt so
    // the elapsed math in completeTrainingSession lands on capMinutes.
    const capMinutes = duration + Math.round(overrunTriggerSecRef.current / 60);
    const fakeStartedAt = Date.now() - capMinutes * 60_000;
    await completeTrainingSession(
      sessionId,
      null,
      'Auto stopped after no response to overtime check.',
      focusPointId,
      fakeStartedAt,
      null,
    );
    const active = getActiveSession();
    if (active?.liveActivityId) {
      laEndFocusPoint(active.liveActivityId, false).catch(() => {});
    }
    clearActiveSession();
    navigation.goBack();
  }

  function pauseSession() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setSessionPaused(true);
    // Freeze HomeScreen countdown by storing remaining seconds
    const existing = getActiveSession();
    if (existing) setActiveSession({ ...existing, pausedRemaining: timeLeft });
    if (existing?.liveActivityId) {
      laUpdateFocusPoint(existing.liveActivityId, { isPaused: true }).catch(() => {});
    }
  }

  function resumeSession() {
    setSessionPaused(false);
    // Recalculate startedAt so elapsed math resumes from current timeLeft
    const newStartedAt = Date.now() - (duration * 60 - timeLeft) * 1000;
    const existing = getActiveSession();
    if (existing) setActiveSession({ ...existing, startedAt: newStartedAt, pausedRemaining: undefined });
    if (existing?.liveActivityId) {
      laUpdateFocusPoint(existing.liveActivityId, { isPaused: false }).catch(() => {});
    }
    _startInterval(newStartedAt, duration);
  }

  function stopSession() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    _stopOverTime();
    cancelOverrunAutoStop();
    overrunModalOpenRef.current = false;
    setOverrunModalOpen(false);
    setSessionActive(false);
    setSessionPaused(false);
    setTimeLeft(duration * 60);
    const existing = getActiveSession();
    if (existing?.liveActivityId) {
      laEndFocusPoint(existing.liveActivityId, false).catch(() => {});
    }
    clearActiveSession();
  }

  function closeMetro() {
    if (!metroOpen) return;
    setMetroOpen(false);
    Animated.spring(metroAnim, { toValue: 0, useNativeDriver: false, bounciness: 4, speed: 14 }).start();
  }

  function toggleMetroPanel() {
    const toValue = metroOpen ? 0 : 1;
    if (!metroOpen) setAiOpen(false);
    setMetroOpen(!metroOpen);
    Animated.spring(metroAnim, { toValue, useNativeDriver: false, bounciness: 4, speed: 14 }).start();
  }

  function toggleAiPanel() {
    if (!aiOpen) closeMetro();
    const opening = !aiOpen;
    LayoutAnimation.configureNext({
      duration: 250,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
      delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    });
    setAiOpen(opening);
  }

  function buildAiSystemPrompt() {
    if (!aiContext) return '';
    const { teacherContext, sessionsCount } = aiContext;

    const studentName = teacherContext?.studentName ?? 'the student';
    const coachName = teacherContext?.coachName ?? null;
    const focusPoints = teacherContext?.focusPoints ?? [];
    const classInputs = teacherContext?.studentClassInputs ?? [];
    const coachKnowledge = teacherContext?.coachKnowledge ?? [];

    const focusLines = focusPoints.length
      ? focusPoints.map(fp => {
          const parts = [`• ${fp.name} [${fp.tier ?? 'important'} / ${fp.status ?? 'active'}]`];
          if (fp.coach_note) parts.push(`  Coach note: ${fp.coach_note}`);
          if (fp.drill) parts.push(`  Drill: ${fp.drill}`);
          return parts.join('\n');
        }).join('\n')
      : 'No focus points recorded.';

    const classLines = classInputs.slice(0, 8).map(inp => {
      const date = new Date(inp.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
      const lines = [`--- Class: ${inp.title ?? date} (${date}) ---`];
      if (inp.class_summary) lines.push(`Summary: ${inp.class_summary}`);
      if (inp.practice_point_1) lines.push(`Primary point: ${inp.practice_point_1} (priority ${inp.priority_score_1}/10)`);
      if (inp.practice_point_2) lines.push(`Secondary point: ${inp.practice_point_2} (priority ${inp.priority_score_2}/10)`);
      if (inp.ai_primary_focus) lines.push(`Focus extracted: ${inp.ai_primary_focus}${inp.ai_secondary_focus ? `, ${inp.ai_secondary_focus}` : ''}`);
      if (inp.dance) lines.push(`Dance: ${inp.dance}`);
      if (inp.raw_ai_json) {
        try {
          const parsed = typeof inp.raw_ai_json === 'string' ? JSON.parse(inp.raw_ai_json) : inp.raw_ai_json;
          const fps = parsed?.students?.[0]?.focus_points ?? [];
          if (fps.length) {
            lines.push('Extracted focus points:');
            fps.forEach((fp) => {
              lines.push(`  • ${fp.title}: ${fp.subtitle}`);
              if (fp.context) lines.push(`    Context: ${fp.context}`);
              if (fp.drill) lines.push(`    Drill: ${fp.drill}`);
            });
          }
        } catch {}
      }
      if (inp.transcript) {
        const t = inp.transcript.length > 1200 ? inp.transcript.slice(0, 1200) + '…' : inp.transcript;
        lines.push(`Transcript:\n${t}`);
      }
      return lines.join('\n');
    }).join('\n\n') || 'No classes recorded.';

    const groupedKnowledge = coachKnowledge.reduce((acc, k) => {
      if (!acc[k.type]) acc[k.type] = [];
      acc[k.type].push(k.content);
      return acc;
    }, {});
    const knowledgeBlock = Object.keys(groupedKnowledge).length
      ? Object.entries(groupedKnowledge).map(([type, items]) =>
          `${type.toUpperCase()}S:\n${items.map(c => `  - ${c}`).join('\n')}`
        ).join('\n\n')
      : null;

    const coachLine = coachName
      ? `You are the training assistant of ${coachName}, helping their student ${studentName}.`
      : `You are the training assistant helping ${studentName}.`;

    const currentFocusBlock = focusPoint ? [
      `Name: ${focusPoint.name}`,
      focusPoint.subtitle ? `Subtitle: ${focusPoint.subtitle}` : null,
      focusPoint.context  ? `Context: ${focusPoint.context}`   : null,
      focusPoint.coach_note ? `Coach note: ${focusPoint.coach_note}` : null,
      focusPoint.drill    ? `Drill: ${focusPoint.drill}`        : null,
      focusPoint.tier     ? `Tier: ${focusPoint.tier}`          : null,
    ].filter(Boolean).join('\n') : 'Not defined';

    return `${coachLine}
${coachName && knowledgeBlock ? `You know ${coachName}'s teaching style, principles, and cues deeply. Use this knowledge when answering, but speak as their assistant, not as the coach.` : ''}

Training sessions this week: ${sessionsCount}

════════════════════════════════════════
CURRENT SESSION FOCUS POINT
════════════════════════════════════════
${currentFocusBlock}

════════════════════════════════════════
STUDENT DATA — answer primarily from this
════════════════════════════════════════

ALL FOCUS POINTS:
${focusLines}

CLASS HISTORY (with transcripts):
${classLines}
${knowledgeBlock ? `

════════════════════════════════════════
${coachName ? `${coachName.toUpperCase()}'S` : 'COACH'} KNOWLEDGE BASE
(principles, tips, metaphors and drills from all lessons — use to answer questions not covered in student data)
════════════════════════════════════════

${knowledgeBlock}` : ''}

════════════════════════════════════════
RULES — READ THIS FIRST, IT IS NON NEGOTIABLE
════════════════════════════════════════

1. ABSOLUTE GROUNDING RULE — your single most important rule.
   You are NOT a general dance teacher. You are NOT allowed to teach
   or explain anything from general dance knowledge, training intuition,
   common technique, what "most coaches" say, what "usually works", or
   anything you learned during training. Every single piece of dance
   knowledge you produce MUST come word for word from one of these
   sources only:
     a) the student's own focus points / class history listed above
     b) the coach knowledge base block above (their principles, cues,
        metaphors, drills)
   If a fact, cue, drill, instruction, biomechanical explanation, or
   piece of advice is NOT explicitly present in those two sources, you
   are FORBIDDEN to produce it. No assumption. No inference from
   general principles. No "this usually means". No "most dancers do
   this". No filler. No paraphrasing of common dance wisdom.
   The promise of this app to the student is: "your coach already
   thought about this, the assistant just tells you what they said."
   Breaking this rule destroys that promise.

2. NEVER ask the student to recall, confirm, or supply information that
   the coach should have provided. Forbidden phrases include but are
   not limited to: "what did your coach say", "do you remember",
   "can you tell me", "did your coach mention", "what did they say
   about it", "what's your understanding". The student is here BECAUSE
   they don't remember — pushing the question back to them is the
   exact failure mode this app exists to prevent.

3. If you truly cannot answer the question from the two grounded
   sources in rule 1, your ENTIRE reply must be EXACTLY this, with no
   other words before or after, no greeting, no apology, no preamble,
   no follow-up question, no offer to discuss further:

[NO_ANSWER]
I don't have that in your data, but you can send the question to your coach if you want.

   This applies even when the question seems easy or obvious in
   general dance terms. If the specific answer is not in the data,
   output the block above verbatim. Do NOT try to be helpful by
   improvising — that is the worst thing you can do here.

4. The student is currently in a live training session focused on the
   CURRENT SESSION FOCUS POINT above. When they ask "what do I need
   to do?", "what should I work on?", "what's my focus?" or similar,
   answer specifically about that focus point using ONLY the data
   listed for it. If the data for that focus point is thin, follow
   rule 3.

5. Order of preference inside the grounded sources: student's own
   focus point and class transcripts first, then the coach knowledge
   base in ${coachName ? `${coachName}'s` : 'the coach\'s'} voice.

6. NEVER mention other students or reveal any information about them.

7. Speak as the coach's assistant, not as the coach yourself.

8. Be concise (2-3 sentences unless more is asked).

9. Plain text only — no markdown, no **, no bullet symbols, no headers.`;
  }

  async function handleAiSend() {
    const text = aiQuestion.trim();
    if (!text || aiSending) return;
    setAiQuestion('');
    Keyboard.dismiss();
    const newMessages = [...aiMessages, { role: 'user', content: text }];
    setAiMessages(newMessages);
    setAiSending(true);
    setTimeout(() => aiScrollRef.current?.scrollToEnd({ animated: true }), 50);

    try {
      const { applyFocusEvent } = await import('../utils/algorithm');
      const { supabase } = await import('../services/supabase/client');
      const { data: { user } } = await supabase.auth.getUser();
      const msgLower = text.toLowerCase();
      const isConfusion = /\b(don't understand|not sure|confused|what does|what is|how do|i don't get|unclear)\b/.test(msgLower);
      const isConfirmation = /\b(right\??|correct\??|is that|so i should|did i|am i)\b/.test(msgLower);
      const hasQuestion = msgLower.includes('?') || isConfusion || isConfirmation;
      if (hasQuestion && focusPointId && user) {
        const eventType = isConfusion ? 'QUESTION_CONFUSION' : isConfirmation ? 'QUESTION_CONFIRMATION' : 'QUESTION_CLARIFICATION';
        await applyFocusEvent(focusPointId, eventType, user.id).catch(() => {});
      }
    } catch {}

    try {
      const systemPrompt = buildAiSystemPrompt();
      console.log('[AI Coach] systemPrompt length:', systemPrompt.length, 'aiContext:', !!aiContext);
      const reply = await callClaudeChat(systemPrompt, newMessages);
      console.log('[AI Coach] reply received, length:', reply?.length);

      // Detect a "no answer" reply so we can show the "Send to coach" CTA.
      // Primary signal: the [NO_ANSWER] token from the prompt. Fallback
      // heuristics catch cases where the model improvised — either by
      // asking the student to recall, or by saying it doesn't have the
      // info in their data. In both cases we replace the body with the
      // canonical sentence so the student never sees a question pushed
      // back at them.
      const rawReply = reply || '';
      const hasToken = /\[NO_ANSWER\]/i.test(rawReply);
      const askedStudent = /(what did your coach|do you remember|can you tell me|did your coach|what did they say|what.+coach.+say)/i.test(rawReply);
      const saidNoData = /(don't have (that|this|specific|the (specific|exact))|don'?t have .{0,40}(in (your|the) data|details))/i.test(rawReply);
      const noAnswer = hasToken || askedStudent || saidNoData;
      const cleanReply = noAnswer
        ? "I don't have that in your data, but you can send the question to your coach if you want."
        : rawReply.replace(/\[NO_ANSWER\]\s*/i, '').trim();
      setAiMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: cleanReply,
          noAnswer,
          forQuestion: noAnswer ? text : undefined,
          coachAsked: false,
        },
      ]);
      setTimeout(() => aiScrollRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (err) {
      console.error('[AI Coach] send error:', err?.message || err);
      setAiMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err?.message || 'unknown'}` }]);
    } finally {
      setAiSending(false);
    }
  }

  async function handleAskCoach(messageIdx) {
    const msg = aiMessages[messageIdx];
    if (!msg?.forQuestion || msg.coachAsked) return;
    // Optimistically mark as sent so the buttons disappear immediately.
    setAiMessages(prev => prev.map((m, i) =>
      i === messageIdx ? { ...m, coachAsked: true, coachAskPending: true } : m
    ));
    try {
      // Build context: question + last few exchanges + current focus point name
      const fpName = focusPoint?.name ? ` [Focus: ${focusPoint.name}]` : '';
      const contextual = `${msg.forQuestion}${fpName}`;
      await askCoach(contextual, 'clarification', focusPointId || null);
      setAiMessages(prev => prev.map((m, i) =>
        i === messageIdx ? { ...m, coachAskPending: false, coachAskOk: true } : m
      ));
    } catch (e) {
      console.error('[AI Coach] askCoach failed:', e?.message || e);
      setAiMessages(prev => prev.map((m, i) =>
        i === messageIdx
          ? { ...m, coachAsked: false, coachAskPending: false, coachAskError: e?.message || 'Failed to send' }
          : m
      ));
    }
  }
  function dismissAskCoach(messageIdx) {
    setAiMessages(prev => prev.map((m, i) =>
      i === messageIdx ? { ...m, noAnswer: false } : m
    ));
  }

  async function startAiRecording() {
    try {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert('Microphone permission denied', 'Go to Settings → InBetween → allow Microphone.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await aiRecorder.prepareToRecordAsync();
      aiRecorder.record();
      setAiRecording(true);
    } catch (e) {
      Alert.alert('Recording error', e.message);
    }
  }

  async function stopAiRecording() {
    if (!aiRecorder.isRecording) return;
    setAiRecording(false);
    setAiTranscribing(true);
    try {
      await aiRecorder.stop();
      const uri = aiRecorder.uri;
      if (!uri) throw new Error('No audio file recorded');
      const text = await transcribeAudio(uri);
      if (text) setAiQuestion(prev => (prev ? prev + ' ' : '') + text);
    } catch (e) {
      if (e.message === 'NO_OPENAI_KEY') {
        Alert.alert('OpenAI key missing', 'Add EXPO_PUBLIC_OPENAI_API_KEY to your .env and restart.');
      } else {
        Alert.alert('Transcription failed', e.message);
      }
    } finally {
      // Release the audio session so a 2nd tap of the mic isn't blocked by
      // an already-active recording session on iOS. Without this,
      // prepareToRecordAsync() throws on the next attempt.
      try {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      } catch {}
      setAiTranscribing(false);
    }
  }

  function handleEndSession() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    _stopOverTime();
    cancelOverrunAutoStop();
    overrunModalOpenRef.current = false;
    setOverrunModalOpen(false);
    setSessionActive(false);
    setSessionPaused(false);
    setShowFeelingModal(true);
  }

  async function handleSave(feeling, note) {
    if (sessionCompletedRef.current) return;
    sessionCompletedRef.current = true;
    const active = getActiveSession();
    const startedAtMs = active?.startedAt ?? null;
    await completeTrainingSession(sessionId, feeling, note, focusPointId, startedAtMs);
    if (active?.liveActivityId) {
      laEndFocusPoint(active.liveActivityId, true).catch(() => {});
    }
    clearActiveSession();
    setShowFeelingModal(false);
    navigation.goBack();
  }

  async function handleSkip() {
    if (sessionCompletedRef.current) return;
    sessionCompletedRef.current = true;
    const active = getActiveSession();
    const startedAtMs = active?.startedAt ?? null;
    await completeTrainingSession(sessionId, null, null, focusPointId, startedAtMs, null);
    if (active?.liveActivityId) {
      laEndFocusPoint(active.liveActivityId, false).catch(() => {});
    }
    clearActiveSession();
    setShowFeelingModal(false);
    navigation.goBack();
  }

  const progress = sessionActive ? 1 - timeLeft / (duration * 60) : sessionDone ? 1 : 0;
  const slotLabel = rank === 0 ? 'Main Focus' : 'Secondary Focus';

  const dataReady = !!focusPoint;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>

      {/* ── Fixed header (shared across all pages) ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backLabel}>Train</Text>
        </TouchableOpacity>
        <View style={styles.slotBadge}>
          <Text style={styles.slotBadgeText}>{slotLabel}</Text>
        </View>
      </View>

      {/* ── Training screen ── */}
      <View style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

          {/* Focus Card — expands downward to include AI chat, same as "read more" */}
          <View style={styles.focusCard}>

            {/* "?" toggle — always visible, absolute positioned */}
            {dataReady && (
              <TouchableOpacity style={styles.aiToggleBtn} onPress={toggleAiPanel} activeOpacity={0.7} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Text style={styles.aiToggleIcon}>{aiOpen ? '✕' : 'Ask Assistant'}</Text>
              </TouchableOpacity>
            )}

            {/* Skeleton bones — visible while loading */}
            {!dataReady && <SessionSkeletonBones />}

            {/* Real content — fades in when data arrives */}
            {dataReady && (
            <Animated.View style={{ opacity: contentFade }}>

            <Text style={styles.sessionLabel}>{getSessionLabel(sessionCount)}</Text>
            <Text style={styles.focusName}>{focusPoint?.name || '—'}</Text>

            {/* Subtitle/pager — hidden when AI open */}
            {!aiOpen && (
            <View>
              {focusPoint?.subtitle ? (
                <View style={styles.subtitleWrap}>
                  <Text style={styles.focusSubtitle}>{focusPoint.subtitle}</Text>
                  {focusPoint?.context ? (
                    <TouchableOpacity onPress={() => { closeMetro(); toggleContext(); }} activeOpacity={0.7} style={styles.readMoreBtn}>
                      <Text style={styles.readMoreText}>{contextExpanded ? 'Read less ↑' : 'Read more ↓'}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {focusPoint?.context ? (
                    <>
                      <Text style={[styles.focusContext, { position: 'absolute', opacity: 0, zIndex: -1 }]} onLayout={e => { if (!contextHeight) setContextHeight(e.nativeEvent.layout.height + 4); }}>
                        {focusPoint.context}
                      </Text>
                      <Animated.View style={{ height: contextAnim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.min(contextHeight || 200, 200)], extrapolate: 'clamp' }), overflow: 'hidden' }}>
                        <ScrollView
                          style={{ flex: 1 }}
                          contentContainerStyle={{ paddingBottom: 4 }}
                          nestedScrollEnabled
                          showsVerticalScrollIndicator
                          scrollEnabled={contextExpanded}
                        >
                          <Text style={styles.focusContext}>{focusPoint.context}</Text>
                        </ScrollView>
                      </Animated.View>
                    </>
                  ) : null}
                </View>
              ) : null}
              <FocusPager focusPoint={focusPoint} inputs={classInputs} loading={notesLoading} onSelect={setSelectedInput} />
            </View>
            )}

            {/* AI chat — shown when AI panel open */}
            {aiOpen && (
            <View style={{ height: (aiChatHeight || 300) * 0.6 }}>
            <ScrollView
              ref={aiScrollRef}
              style={styles.aiCardMessages}
              contentContainerStyle={styles.aiCardMessagesContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              onContentSizeChange={() => aiScrollRef.current?.scrollToEnd({ animated: true })}
            >
              {aiMessages.length === 0 && !aiSending && (
                <Text style={styles.aiCardEmptyText}>Ask a question about your focus point or training.</Text>
              )}
              {aiMessages.map((msg, i) => (
                <View key={i}>
                  <View style={[styles.aiCardBubble, msg.role === 'user' ? styles.aiCardBubbleUser : styles.aiCardBubbleBot]}>
                    <Text style={[styles.aiCardBubbleText, msg.role === 'user' ? styles.aiCardBubbleTextUser : styles.aiCardBubbleTextBot]}>
                      {msg.content}
                    </Text>
                  </View>
                  {msg.role === 'assistant' && msg.noAnswer && !msg.coachAsked && (
                    <View style={styles.askCoachRow}>
                      <TouchableOpacity
                        style={styles.askCoachBtn}
                        activeOpacity={0.85}
                        onPress={() => handleAskCoach(i)}
                      >
                        <Ionicons name="paper-plane" size={12} color="#fff" />
                        <Text style={styles.askCoachBtnText}>Send to coach</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.askCoachDismiss}
                        activeOpacity={0.7}
                        onPress={() => dismissAskCoach(i)}
                      >
                        <Text style={styles.askCoachDismissText}>Not now</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {msg.role === 'assistant' && msg.coachAsked && (
                    <View style={styles.askCoachStatus}>
                      {msg.coachAskPending ? (
                        <>
                          <ActivityIndicator size="small" color="rgba(255,255,255,0.5)" />
                          <Text style={styles.askCoachStatusText}>Sending to your coach…</Text>
                        </>
                      ) : msg.coachAskError ? (
                        <Text style={[styles.askCoachStatusText, { color: '#E84040' }]}>
                          Couldn't send: {msg.coachAskError}
                        </Text>
                      ) : (
                        <>
                          <Ionicons name="checkmark-circle" size={13} color="#4AAF52" />
                          <Text style={styles.askCoachStatusText}>Sent to your coach</Text>
                        </>
                      )}
                    </View>
                  )}
                </View>
              ))}
              {aiSending && (
                <View style={[styles.aiCardBubble, styles.aiCardBubbleBot]}>
                  <ActivityIndicator size="small" color="rgba(255,255,255,0.5)" />
                </View>
              )}
            </ScrollView>
            <View style={styles.aiCardInputRow}>
              <TextInput
                style={styles.aiCardInput}
                value={aiQuestion}
                onChangeText={setAiQuestion}
                placeholder="Ask about focus point"
                placeholderTextColor="rgba(255,255,255,0.3)"
                returnKeyType="send"
                onSubmitEditing={handleAiSend}
                blurOnSubmit
              />
              <TouchableOpacity
                onPress={aiRecording ? stopAiRecording : startAiRecording}
                disabled={aiTranscribing}
                style={[styles.aiCardSendBtn, aiRecording && { backgroundColor: 'rgba(232,64,64,0.2)' }]}
                activeOpacity={0.7}
              >
                {aiTranscribing
                  ? <ActivityIndicator size="small" color="rgba(255,255,255,0.5)" />
                  : <Ionicons name={aiRecording ? 'stop-circle' : 'mic'} size={16} color={aiRecording ? '#E84040' : 'rgba(255,255,255,0.6)'} />
                }
              </TouchableOpacity>
              <TouchableOpacity onPress={handleAiSend} disabled={!aiQuestion.trim() || aiSending} style={[styles.aiCardSendBtn, (!aiQuestion.trim() || aiSending) && { opacity: 0.35 }]} activeOpacity={0.7}>
                <Text style={styles.aiCardSendIcon}>↑</Text>
              </TouchableOpacity>
            </View>
            </View>
            )}
            </Animated.View>
            )}
          </View>

          {/* Middle area: drill + timer — overflow:hidden clips as focusCard expands, same as "read more" */}
          <View
            style={{ flex: 1, overflow: 'hidden' }}
            pointerEvents={aiOpen ? 'none' : 'auto'}
            onLayout={e => { if (!aiOpen && e.nativeEvent.layout.height > 0) setAiChatHeight(e.nativeEvent.layout.height); }}
          >
            {!sessionDone && !aiOpen && focusPoint?.drill ? (() => {
              // Drills should read like a gym prescription: one short
              // imperative line + optional reps/counts on the next line(s).
              // Render the first non-empty line as the main action, and
              // every short following line as a chip (reps, time, sides).
              const drillLines = (focusPoint.drill || '')
                .split(/\n+/)
                .map((l) => l.trim())
                .filter(Boolean);
              const main = drillLines[0] || '';
              const chips = drillLines
                .slice(1)
                .filter((l) => l.length <= 40); // long extra lines aren't chip material
              return (
                <View style={styles.drillCard}>
                  <View style={styles.drillHeader}>
                    <View style={styles.drillPill}><Text style={styles.drillPillText}>DRILL</Text></View>
                  </View>
                  <Text style={styles.drillText}>{main}</Text>
                  {chips.length > 0 && (
                    <View style={styles.drillChipRow}>
                      {chips.map((c, i) => (
                        <View key={i} style={styles.drillChip}>
                          <Text style={styles.drillChipText}>{c}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })() : null}

            <View style={styles.timerSection}>
              {sessionDone ? (
                <View style={styles.doneWrap}>
                  <Text style={styles.doneCheck}>✓</Text>
                  <Text style={styles.doneTitle}>Session complete!</Text>
                </View>
              ) : sessionActive ? (
                <>
                  <Text style={styles.timerText}>{formatTime(timeLeft)}</Text>
                  {overTime > 0 && (
                    <Text style={styles.overTimeText}>+ {formatTime(overTime)}</Text>
                  )}
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
                  </View>
                </>
              ) : (
                <DurationPicker value={duration} onChange={(d) => { closeMetro(); setDuration(d); setTimeLeft(d * 60); }} />
              )}
            </View>
          </View>
        </KeyboardAvoidingView>

        {/* CTA — outside KAV, toujours collé en bas */}
        <View style={styles.ctaWrap}>
          {!sessionDone && (
            <Animated.View style={[styles.metroPill, {
              width: metroAnim.interpolate({ inputRange: [0, 1], outputRange: [48, screenW - Spacing.side * 2] }),
              borderRadius: metroAnim.interpolate({ inputRange: [0, 1], outputRange: [24, 16] }),
            }]}>
              <TouchableOpacity onPress={toggleMetroPanel} activeOpacity={0.8} style={styles.metroPillCircle}>
                <Animated.Text style={[styles.metroPillIcon, metroRunning && {
                  color: beatAnim.interpolate({ inputRange: [0, 1], outputRange: ['#FFFFFF', Colors.orange] }),
                }]}>♩</Animated.Text>
              </TouchableOpacity>
              <Animated.View style={[styles.metroPillContent, { opacity: metroAnim }]} pointerEvents={metroOpen ? 'auto' : 'none'}>
                <MetronomeStrip onRunningChange={setMetroRunning} onBeat={handleBeat} focusDances={focusPoint?.dance} />
              </Animated.View>
            </Animated.View>
          )}

          {!sessionActive && !sessionDone && (
            <TouchableOpacity style={styles.startBtn} onPress={startSession} activeOpacity={0.88}>
              <Text style={styles.startBtnText}>START SESSION</Text>
            </TouchableOpacity>
          )}

          {sessionActive && !sessionPaused && (
            <TouchableOpacity style={styles.pauseBtn} onPress={pauseSession} activeOpacity={0.85}>
              <View style={styles.pauseIcon}>
                <View style={styles.pauseBar} />
                <View style={styles.pauseBar} />
              </View>
              <Text style={styles.pauseBtnText}>Pause</Text>
            </TouchableOpacity>
          )}

          {sessionActive && sessionPaused && (
            <View style={styles.pausedRow}>
              <TouchableOpacity style={styles.resumeBtn} onPress={resumeSession} activeOpacity={0.88}>
                <Text style={styles.resumeBtnText}>▶  Resume</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.stopBtn} onPress={() => setShowStopConfirm(true)} activeOpacity={0.85}>
                <Text style={styles.stopBtnText}>Stop</Text>
              </TouchableOpacity>
            </View>
          )}

          {sessionActive && (
            <Pressable
              style={styles.validateBtn}
              onPressIn={() => {
                Animated.timing(stopHoldAnim, { toValue: 1, duration: 2000, useNativeDriver: false }).start(({ finished }) => {
                  if (finished) { handleEndSession(); stopHoldAnim.setValue(0); }
                });
              }}
              onPressOut={() => {
                stopHoldAnim.stopAnimation();
                Animated.timing(stopHoldAnim, { toValue: 0, duration: 200, useNativeDriver: false }).start();
              }}
            >
              <Animated.View style={[styles.validateBtnFill, { width: stopHoldAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
              <Text style={styles.validateBtnText}>Hold to end session</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* ── Modals (portal, position dans le tree sans importance) ── */}
      <ClassInputModal input={selectedInput} onClose={() => setSelectedInput(null)} />

      <Modal visible={showStopConfirm} transparent animationType="fade">
        <Pressable style={styles.stopConfirmOverlay} onPress={() => setShowStopConfirm(false)}>
          <Pressable style={styles.stopConfirmBox} onPress={() => {}}>
            <Text style={styles.stopConfirmTitle}>Restart the session?</Text>
            <Text style={styles.stopConfirmBody}>
              This will cancel the current session and reset the timer.
            </Text>
            <View style={styles.stopConfirmActions}>
              <TouchableOpacity
                style={styles.stopConfirmCancel}
                onPress={() => setShowStopConfirm(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.stopConfirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.stopConfirmConfirm}
                onPress={() => { setShowStopConfirm(false); stopSession(); }}
                activeOpacity={0.8}
              >
                <Text style={styles.stopConfirmConfirmText}>Restart</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <SessionFeelingModal
        visible={showFeelingModal}
        focusName={focusPoint?.name || ''}
        onSave={handleSave}
        onSkip={handleSkip}
      />

      {/* Overrun safety modal: shown when chrono runs OVERRUN_FIRST_PROMPT_SEC
          past target. If no answer in OVERRUN_AUTO_STOP_MS we auto-save
          with the duration capped (see autoCompleteOverrun). */}
      <Modal visible={overrunModalOpen} transparent animationType="fade">
        <View style={styles.overrunBackdrop}>
          <View style={styles.overrunCard}>
            <Text style={styles.overrunTitle}>Still training?</Text>
            <Text style={styles.overrunBody}>
              You've gone {Math.round((overrunTriggerSecRef.current || OVERRUN_FIRST_PROMPT_SEC) / 60)} min past your target.
              {'\n'}
              No answer in 5 min and we'll save the session with {duration + Math.round((overrunTriggerSecRef.current || OVERRUN_FIRST_PROMPT_SEC) / 60)} min so a forgotten chrono doesn't inflate your stats.
            </Text>
            <TouchableOpacity style={styles.overrunPrimary} activeOpacity={0.85} onPress={extendOverrun}>
              <Text style={styles.overrunPrimaryText}>Yes, give me 5 more min</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.overrunSecondary} activeOpacity={0.7} onPress={confirmStopOverrun}>
              <Text style={styles.overrunSecondaryText}>Done, end session</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.side,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(17,12,17,0.08)',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backArrow: { fontSize: 18, color: Colors.activeFocus },
  backLabel: { fontFamily: Fonts.jakartaMedium, fontSize: 15, color: Colors.activeFocus },
  slotBadge: {},
  slotBadgeText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 10,
    color: '#ACADB9',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  focusCard: {
    backgroundColor: '#1A1A1A',
    marginHorizontal: Spacing.side,
    marginTop: 16,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  sessionLabel: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    marginBottom: 6,
  },
  focusName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 24,
    color: Colors.white,
    lineHeight: 30,
  },
  subtitleWrap: {
    marginTop: 8,
  },
  focusSubtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: '#FFFFFF',
    lineHeight: 19,
  },
  readMoreBtn: {
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingRight: 16,
  },
  readMoreText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: 'rgba(255, 157, 0, 0.7)',
    letterSpacing: 0.3,
  },
  focusContext: {
    marginTop: 10,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 20,
  },
  drillCard: {
    marginHorizontal: Spacing.side,
    marginTop: 10,
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(17,12,17,0.1)',
    backgroundColor: '#FAFAFA',
  },
  drillHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  drillPill: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(17,12,17,0.12)',
  },
  drillPillText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9,
    color: Colors.black,
    letterSpacing: 1.5,
  },
  drillText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: Colors.black,
    lineHeight: 22,
  },
  drillChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  drillChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  drillChipText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11.5,
    color: Colors.black,
    letterSpacing: 0.2,
  },

  // Overrun safety modal
  overrunBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  overrunCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingVertical: 24,
  },
  overrunTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
    color: '#0E0E0E',
    letterSpacing: -0.3,
    marginBottom: 10,
  },
  overrunBody: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: '#666',
    lineHeight: 19,
    marginBottom: 20,
  },
  overrunPrimary: {
    backgroundColor: '#E8A838',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 8,
  },
  overrunPrimaryText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#0E0E0E',
    letterSpacing: 0.3,
  },
  overrunSecondary: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  overrunSecondaryText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: '#999',
  },

  timerSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.side,
  },
  timerText: {
    fontFamily: Fonts.monument,
    fontSize: 64,
    color: Colors.black,
    letterSpacing: 2,
  },
  overTimeText: {
    fontFamily: Fonts.monument,
    fontSize: 22,
    color: Colors.orange,
    letterSpacing: 1,
    marginTop: -8,
  },
  timerIdle: { color: 'rgba(17,12,17,0.2)' },
  timerHint: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    marginTop: 8,
  },
  progressTrack: {
    width: '100%',
    height: 4,
    backgroundColor: 'rgba(17,12,17,0.08)',
    borderRadius: 2,
    marginTop: 16,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: Colors.orange, borderRadius: 2 },

  doneWrap: { alignItems: 'center', gap: 8 },
  doneCheck: { fontSize: 48 },
  doneTitle: { fontFamily: Fonts.jakartaExtraBold, fontSize: 20, color: Colors.black },

  tools: {
    marginHorizontal: Spacing.side,
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderRadius: 14,
    paddingVertical: 4,
    marginBottom: 14,
  },
  metroPill: {
    backgroundColor: '#1A1A1A',
    height: 48,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  metroPillCircle: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  metroPillIcon: {
    fontSize: 20,
    color: '#FFFFFF',
  },
  metroPulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.orange,
  },
  metroPillContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  metroPillClose: {
    position: 'absolute',
    top: 8,
    right: 10,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metroPillCloseText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  ctaWrap: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 8,
    gap: 16,
  },
  startBtn: {
    backgroundColor: '#FF9D00',
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
  },
  startBtnText: { fontFamily: Fonts.jakartaExtraBold, fontSize: 15, color: '#000', letterSpacing: 1 },

  pauseBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(17,12,17,0.15)',
  },
  pauseIcon: {
    flexDirection: 'row',
    gap: 3,
    alignItems: 'center',
  },
  pauseBar: {
    width: 3,
    height: 13,
    borderRadius: 2,
    backgroundColor: Colors.secondary,
  },
  pauseBtnText: { fontFamily: Fonts.jakartaMedium, fontSize: 14, color: Colors.secondary },

  pausedRow: {
    flexDirection: 'row',
    gap: 10,
  },
  resumeBtn: {
    flex: 1,
    backgroundColor: Colors.orange,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  resumeBtnText: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: '#000' },

  stopBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(17,12,17,0.15)',
    overflow: 'hidden',
  },
  stopBtnFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: Colors.orange,
    borderRadius: 14,
  },
  stopBtnText: { fontFamily: Fonts.jakartaMedium, fontSize: 14, color: Colors.secondary },

  validateBtn: { backgroundColor: Colors.black, borderRadius: 14, paddingVertical: 17, alignItems: 'center', overflow: 'hidden' },
  validateBtnFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: Colors.orange, borderRadius: 14 },
  validateBtnText: { fontFamily: Fonts.jakartaExtraBold, fontSize: 15, color: Colors.white, letterSpacing: 1 },

  stopConfirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  stopConfirmBox: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 24,
    width: '100%',
  },
  stopConfirmTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: Colors.black,
    marginBottom: 8,
  },
  stopConfirmBody: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: 'rgba(17,12,17,0.55)',
    lineHeight: 20,
    marginBottom: 24,
  },
  stopConfirmActions: {
    flexDirection: 'row',
    gap: 10,
  },
  stopConfirmCancel: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: Colors.black,
  },
  stopConfirmCancelText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: Colors.white,
  },
  stopConfirmConfirm: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(17,12,17,0.15)',
  },
  stopConfirmConfirmText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: Colors.secondary,
  },

  // ── AI card (inside focusCard, inherits its padding/bg) ──
  aiCard: {
    paddingBottom: 8,
  },
  aiToggleBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  aiToggleIcon: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    fontFamily: Fonts.jakartaBold,
  },
  aiCardMessages: {
    flex: 1,
    marginTop: 12,
  },
  aiCardMessagesContent: {
    gap: 8,
    flexGrow: 1,
    paddingBottom: 4,
  },
  aiCardEmptyText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.3)',
    lineHeight: 20,
  },
  aiCardBubble: {
    maxWidth: '90%',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  aiCardBubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  aiCardBubbleBot: {
    alignSelf: 'flex-start',
  },
  aiCardBubbleText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    lineHeight: 20,
  },
  aiCardBubbleTextUser: {
    color: 'rgba(255,255,255,0.85)',
  },
  aiCardBubbleTextBot: {
    color: 'rgba(255,255,255,0.65)',
  },
  askCoachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
    marginBottom: 4,
    paddingLeft: 4,
  },
  askCoachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E8A838',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
  },
  askCoachBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11.5,
    color: '#fff',
    letterSpacing: 0.2,
  },
  askCoachDismiss: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  askCoachDismissText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.45)',
  },
  askCoachStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    paddingLeft: 4,
  },
  askCoachStatusText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
  },
  aiCardInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  aiCardInput: {
    flex: 1,
    minHeight: 36,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: '#FFFFFF',
  },
  aiCardSendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiCardSendIcon: {
    fontSize: 15,
    color: Colors.orange,
  },
});

// ─── Duration Picker styles ───────────────────────────────────────────────────

const dp = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.side,
    marginBottom: 10,
    overflow: 'hidden',
    gap: 80,
  },
  labelSmall: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.secondary,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  labelBig: {
    fontFamily: Fonts.monument,
    fontSize: 26,
    color: Colors.black,
    letterSpacing: -0.5,
    lineHeight: 30,
    textTransform: 'uppercase',
  },
  wheel: {
    height: ITEM_H * 3,
    width: 120,
    overflow: 'hidden',
  },
  selectionLine: {
    position: 'absolute',
    top: ITEM_H,
    left: 8,
    right: 8,
    height: 1,
    backgroundColor: Colors.orange,
    opacity: 0.7,
    zIndex: 1,
  },
  selectionLineBottom: {
    top: ITEM_H * 2 - 1,
  },
  content: {
    paddingVertical: ITEM_H,
  },
  item: {
    height: ITEM_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  num: {
    fontFamily: Fonts.monument,
    fontSize: 32,
    color: Colors.black,
    letterSpacing: 1,
    lineHeight: 40,
  },
  unit: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: Colors.secondary,
    marginTop: 8,
    letterSpacing: 0.5,
  },
});

// ─── Linked notes styles ──────────────────────────────────────────────────────

const ln = StyleSheet.create({
  wrap: { marginTop: 12, gap: 2 },
  heading: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 10,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 8,
    gap: 8,
    marginBottom: 4,
  },
  date: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
    minWidth: 44,
  },
  text: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    flex: 1,
  },
  arrow: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.3)',
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 0,
  },
  swipeHint: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 10,
    color: 'rgba(255,255,255,0.25)',
    letterSpacing: 0.3,
  },
  coachNoteText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 20,
    marginTop: 4,
  },
  dots: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 10,
    justifyContent: 'center',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  dotActive: {
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
});

// ─── Modal styles ─────────────────────────────────────────────────────────────

const modal = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.side,
    paddingBottom: 44,
    paddingTop: 12,
    maxHeight: '85%',
  },
  handle: {
    width: 36, height: 4,
    backgroundColor: 'rgba(17,12,17,0.12)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  date: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: Colors.secondary,
    letterSpacing: 0.3,
  },
  closeBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(17,12,17,0.07)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeIcon: { fontSize: 13, color: Colors.black },

  section: { marginBottom: 24 },
  sectionLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },

  card: {
    backgroundColor: Colors.statCardBg,
    borderRadius: 12,
    padding: 16,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
  },
  cardInputLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: Colors.black,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  cardText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: Colors.black,
    lineHeight: 23,
  },

  urgencyRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 10 },
  urgencyLabel: { fontFamily: Fonts.jakartaMedium, fontSize: 11, color: Colors.secondary },
  urgencyDots: { flexDirection: 'row', gap: 5 },
  urgencyDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(17,12,17,0.12)' },

  divider: {
    height: 1,
    backgroundColor: Colors.statCardBorder,
    marginBottom: 24,
  },
  focusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.statCardBg,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
  },
  focusChipText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: Colors.black,
    flex: 1,
  },
  fpDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.activeLog },
});

// ─── Metronome styles ─────────────────────────────────────────────────────────

const PILL_H_OPEN = M_ITEM_H * 3 + 20; // 134

const m = StyleSheet.create({
  wrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 12,
  },
  band: {
    display: 'none',
  },
  col: {
    flex: 2,
    height: M_ITEM_H * 3,
  },
  colBpm: {
    flex: 1,
    height: M_ITEM_H * 3,
  },
  scrollContent: {
    paddingVertical: M_ITEM_H,
  },
  item: {
    height: M_ITEM_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  danceText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.3,
  },
  bpmText: {
    fontFamily: Fonts.monument,
    fontSize: 18,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.5,
  },
  itemActive: {
    color: '#FFFFFF',
  },
  itemPlaceholder: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
    fontStyle: 'italic',
  },
  sep: {
    width: StyleSheet.hairlineWidth,
    height: M_ITEM_H * 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center',
    marginHorizontal: 4,
  },
  itemAdjacent: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.25)',
  },
  itemFar: {
    color: 'rgba(255,255,255,0)',
  },
  right: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingRight: 4,
    marginLeft: 8,
    flexShrink: 0,
  },
  beatDots: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  dotActive: {
    backgroundColor: '#FFFFFF',
  },
  dotAccent: {
    backgroundColor: Colors.orange,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  playBtnActive: {
    backgroundColor: Colors.orange,
    shadowColor: Colors.orange,
    shadowOpacity: 0.6,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    elevation: 4,
  },
  playIcon: { fontSize: 13, color: '#FFFFFF' },
  playIconActive: { color: '#000' },
});

// ─── Feeling slider styles ────────────────────────────────────────────────────

const sl = StyleSheet.create({
  wrap: { width: '100%', marginBottom: 28 },
  slider: { width: '100%', height: 40 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  label: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: 'rgba(17,12,17,0.3)',
  },
  labelOn: {
    color: Colors.orange,
    fontFamily: Fonts.jakartaBold,
  },
});

// ─── Feeling modal styles ─────────────────────────────────────────────────────

const fm = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 44,
    justifyContent: 'space-between',
  },
  content: {
    alignItems: 'center',
  },
  focusLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.secondary,
    letterSpacing: 0.3,
    marginBottom: 12,
    textAlign: 'center',
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 28,
    color: Colors.black,
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: Colors.secondary,
    textAlign: 'center',
    marginBottom: 44,
  },
  noteInput: {
    width: '100%',
    minHeight: 86,
    borderWidth: 1,
    borderColor: 'rgba(17,12,17,0.1)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.black,
    backgroundColor: Colors.statCardBg,
    lineHeight: 21,
  },
  btnWrap: { gap: 4 },
  saveBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
  },
  saveBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
    color: '#000',
    letterSpacing: 0.3,
  },
  skipBtn: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  skipBtnText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: Colors.secondary,
  },
  motivationRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
    width: '100%',
  },
  motivationBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(17,12,17,0.1)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    backgroundColor: Colors.statCardBg,
  },
  motivationBtnOn: {
    borderColor: Colors.orange,
    backgroundColor: 'rgba(232,168,56,0.1)',
  },
  motivationEmoji: {
    fontSize: 24,
    marginBottom: 4,
  },
  motivationLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.secondary,
  },
  motivationLabelOn: {
    fontFamily: Fonts.jakartaBold,
    color: Colors.black,
  },
});

// ─── Chat styles ─────────────────────────────────────────────────────────────

const chat = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  sessionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.side,
    paddingVertical: 8,
    backgroundColor: 'rgba(76,175,80,0.07)',
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(76,175,80,0.2)',
  },
  sessionDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.activeLog,
  },
  sessionText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: Colors.activeLog,
  },
  header: {
    paddingHorizontal: Spacing.side,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(17,12,17,0.08)",
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: Colors.black,
  },
  subtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
    marginTop: 2,
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    padding: Spacing.side,
    paddingBottom: 16,
    gap: 10,
  },
  emptyState: {
    paddingTop: 40,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  emptyText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.secondary,
    textAlign: "center",
    lineHeight: 22,
  },
  bubble: {
    maxWidth: "85%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: Colors.black,
    borderBottomRightRadius: 4,
  },
  bubbleBot: {
    alignSelf: "flex-start",
    backgroundColor: Colors.statCardBg,
    borderBottomLeftRadius: 4,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    minWidth: 60,
    alignItems: "center",
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: Fonts.jakartaRegular,
  },
  bubbleTextUser: {
    color: Colors.white,
  },
  bubbleTextBot: {
    color: Colors.black,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: Spacing.side,
    paddingVertical: 12,
    borderTopWidth: 0.5,
    borderTopColor: "rgba(17,12,17,0.08)",
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 100,
    backgroundColor: Colors.statCardBg,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 11,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.black,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.black,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    opacity: 0.3,
  },
  sendBtnIcon: {
    fontSize: 18,
    color: Colors.white,
    fontWeight: "bold",
  },
});
