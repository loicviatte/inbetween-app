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
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Audio } from 'expo-av';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../theme';
import { getFocusPoints, getClassInputsForFocus, getClassInputs, getTrainingSessionsThisWeek } from '../storage/storage';
import { callClaudeChat } from '../services/ai/anthropic';
import { completeTrainingSession, getSessionLabel } from '../utils/algorithm';
import {
  setActiveSession,
  getActiveSession,
  clearActiveSession,
  getSessionTimeLeft,
  getChatMessages,
  setChatMessages as storeChatMessages,
  clearChatMessages,
} from '../storage/activeSession';

const DURATIONS = [5, 10, 15, 20, 25, 30, 45, 60, 90];
const ITEM_H = 52;
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

const DANCES = [
  { id: 'samba',     name: 'Samba',      bpm: 100, beats: 2, category: 'L' },
  { id: 'chacha',    name: 'Cha Cha',    bpm: 120, beats: 4, category: 'L' },
  { id: 'rumba',     name: 'Rumba',      bpm: 104, beats: 4, category: 'L' },
  { id: 'paso',      name: 'Paso',       bpm: 120, beats: 2, category: 'L' },
  { id: 'jive',      name: 'Jive',       bpm: 176, beats: 4, category: 'L' },
  { id: 'waltz',     name: 'Waltz',      bpm: 90,  beats: 3, category: 'S' },
  { id: 'tango',     name: 'Tango',      bpm: 132, beats: 4, category: 'S' },
  { id: 'vwaltz',    name: 'V.Waltz',    bpm: 180, beats: 3, category: 'S' },
  { id: 'foxtrot',   name: 'Foxtrot',    bpm: 120, beats: 4, category: 'S' },
  { id: 'quickstep', name: 'Quickstep',  bpm: 200, beats: 4, category: 'S' },
];

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

              {!!input.takeaway && (
                <View style={[modal.card, { marginBottom: 10 }]}>
                  <Text style={modal.cardInputLabel}>What you worked on</Text>
                  <Text style={modal.cardText}>{input.takeaway}</Text>
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

const MetronomeStrip = memo(function MetronomeStrip() {
  const [selectedDance, setSelectedDance] = useState(null);
  const [bpm, setBpm] = useState(120);
  const [beats, setBeats] = useState(4);
  const [running, setRunning] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const schedulerRef = useRef(null);   // setInterval handle for lookahead scheduler
  const tickTimeoutsRef = useRef([]);  // pending tick setTimeout IDs
  const nextTickAtRef = useRef(0);     // absolute ms timestamp of next tick to schedule
  const soundPoolRef = useRef([]);
  const poolIdxRef = useRef(0);
  const bpmRef = useRef(bpm);
  const dragStartBpm = useRef(bpm);
  const isDragging = useRef(false);

  // Keep bpmRef in sync (used by scheduler without needing restarts during drag)
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);

  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
    // 4 sound instances — lookahead may schedule multiple ticks simultaneously
    Promise.all([0, 1, 2, 3].map(() => Audio.Sound.createAsync(TICK_SOUND, { volume: 1.0 })))
      .then(results => { soundPoolRef.current = results.map(r => r.sound); });
    return () => {
      stopMetro();
      soundPoolRef.current.forEach(s => s.unloadAsync());
    };
  }, []);

  function playTick() {
    const pool = soundPoolRef.current;
    if (!pool.length) return;
    const sound = pool[poolIdxRef.current];
    poolIdxRef.current = (poolIdxRef.current + 1) % pool.length;
    sound.replayAsync().catch(() => {});
  }

  function pulse() {
    pulseAnim.setValue(1.4);
    Animated.timing(pulseAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }

  // Lookahead scheduler (Chris Wilson technique):
  // Runs every 50ms and pre-schedules all ticks within the next 300ms window.
  // 300ms buffer absorbs JS thread jitter from state updates / re-renders.
  function startMetro(overrideBpm) {
    const initialBpm = overrideBpm ?? bpmRef.current;

    // First tick fires immediately
    pulse();
    playTick();
    nextTickAtRef.current = Date.now() + (60000 / initialBpm);

    function scheduler() {
      const intervalMs = 60000 / bpmRef.current;
      const now = Date.now();
      while (nextTickAtRef.current < now + 300) {
        const delay = Math.max(0, nextTickAtRef.current - now);
        const id = setTimeout(() => { pulse(); playTick(); }, delay);
        tickTimeoutsRef.current.push(id);
        nextTickAtRef.current += intervalMs;
      }
      // Trim fired IDs to prevent unbounded array growth
      if (tickTimeoutsRef.current.length > 40) {
        tickTimeoutsRef.current = tickTimeoutsRef.current.slice(-20);
      }
    }

    schedulerRef.current = setInterval(scheduler, 50);
    setRunning(true);
  }

  function stopMetro() {
    if (schedulerRef.current) clearInterval(schedulerRef.current);
    schedulerRef.current = null;
    // Cancel all pre-scheduled ticks
    tickTimeoutsRef.current.forEach(id => clearTimeout(id));
    tickTimeoutsRef.current = [];
    pulseAnim.setValue(1);
    setRunning(false);
  }

  function toggleMetro() {
    running ? stopMetro() : startMetro();
  }

  function pickDance(dance) {
    setSelectedDance(dance.id);
    setBpm(dance.bpm);
    setBeats(dance.beats);
    setShowPicker(false);
    if (running) { stopMetro(); setTimeout(() => startMetro(dance.bpm), 50); }
  }

  // Pan responder: capture horizontal swipe on the BPM zone before parent ScrollView
  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: () => false,
    // Capture mode: claim gesture before the parent horizontal ScrollView
    onMoveShouldSetPanResponderCapture: (_, { dx, dy }) =>
      Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 5,
    onPanResponderGrant: () => {
      isDragging.current = true;
      dragStartBpm.current = bpmRef.current;
    },
    onPanResponderMove: (_, { dx }) => {
      const newBpm = Math.max(40, Math.min(260, dragStartBpm.current + Math.round(dx / 2.5)));
      bpmRef.current = newBpm;
      setBpm(newBpm);
    },
    onPanResponderRelease: () => {
      isDragging.current = false;
      if (running) { stopMetro(); setTimeout(() => startMetro(bpmRef.current), 50); }
    },
    onPanResponderTerminate: () => { isDragging.current = false; },
  })).current;

  const selected = DANCES.find(d => d.id === selectedDance);
  const bpmProgress = (bpm - 40) / 220;

  return (
    <View style={m.wrap}>
      <View style={m.topRow}>

        {/* Dance selector */}
        <TouchableOpacity style={m.dancePill} onPress={() => setShowPicker(v => !v)} activeOpacity={0.75}>
          <Text style={m.danceLabel} numberOfLines={1}>{selected ? selected.name : 'Select dance'}</Text>
          <Text style={m.chevron}>{showPicker ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {/* BPM wheel — swipe left/right to change tempo */}
        <View style={m.bpmDragWrap} {...panResponder.panHandlers}>
          {/* Number wheel: show -2 to +2 neighbours */}
          <View style={m.bpmWheel}>
            {[-2, -1, 0, 1, 2].map((offset) => {
              const val = Math.max(40, Math.min(260, bpm + offset));
              const dist = Math.abs(offset);
              const isCenter = dist === 0;
              return (
                <View key={offset} style={[m.bpmWheelCell, isCenter && m.bpmWheelCellCenter]}>
                  <Text
                    numberOfLines={1}
                    style={[
                      m.bpmWheelNum,
                      isCenter && m.bpmWheelNumCenter,
                      isCenter && running && m.bpmWheelNumActive,
                      { opacity: dist === 0 ? 1 : dist === 1 ? 0.28 : 0.12 },
                    ]}
                  >
                    {val}
                  </Text>
                </View>
              );
            })}
          </View>
          <Text style={m.bpmUnit}>BPM</Text>
          {/* Progress track */}
          <View style={m.bpmTrack}>
            <View style={[m.bpmFill, { width: `${Math.round(bpmProgress * 100)}%` }]} />
          </View>
        </View>

        {/* Play / Stop */}
        <TouchableOpacity
          style={[m.playBtn, running && m.playBtnActive]}
          onPress={toggleMetro}
          activeOpacity={0.8}
        >
          <Animated.View style={running && { transform: [{ scale: pulseAnim }] }}>
            <Text style={[m.playIcon, running && m.playIconActive]}>{running ? '■' : '▶'}</Text>
          </Animated.View>
        </TouchableOpacity>
      </View>

      {/* Dance picker */}
      {showPicker && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={m.picker}
          contentContainerStyle={m.pickerContent}
        >
          {DANCES.map(d => (
            <TouchableOpacity
              key={d.id}
              style={[m.pill, selectedDance === d.id && m.pillActive]}
              onPress={() => pickDance(d)}
              activeOpacity={0.75}
            >
              <Text style={[m.pillCat, selectedDance === d.id && m.pillCatActive]}>{d.category}</Text>
              <Text style={[m.pillName, selectedDance === d.id && m.pillNameActive]}>{d.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
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
    <Modal visible={visible} transparent animationType="none" onRequestClose={onSkip}>
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

function DurationPicker({ value, onChange }) {
  const defaultIdx = Math.max(0, DURATIONS.indexOf(value));
  const scrollY = useRef(new Animated.Value(defaultIdx * ITEM_H)).current;

  function onScrollEnd(e) {
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.max(0, Math.min(DURATIONS.length - 1, Math.round(y / ITEM_H)));
    onChange(DURATIONS[idx]);
  }

  return (
    <View style={dp.wrap}>
      {/* Selection band — two hairlines around the center slot */}
      <View pointerEvents="none" style={dp.band} />
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
            center - ITEM_H * 2,
            center - ITEM_H,
            center,
            center + ITEM_H,
            center + ITEM_H * 2,
          ];
          const opacity = scrollY.interpolate({
            inputRange,
            outputRange: [0.1, 0.28, 1, 0.28, 0.1],
            extrapolate: 'clamp',
          });
          const scale = scrollY.interpolate({
            inputRange,
            outputRange: [0.68, 0.82, 1, 0.82, 0.68],
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
  );
}

// ─── Chat Page ────────────────────────────────────────────────────────────────

function ChatPage({ focusPoint, focusPointId, sessionActive, timeLeft, duration, messages, setMessages }) {
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [userData, setUserData] = useState(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const scrollRef = useRef(null);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [classInputsList, focusPointsList, sessionsCount] = await Promise.all([
          getClassInputs(),
          getFocusPoints(),
          getTrainingSessionsThisWeek(),
        ]);
        setUserData({ classInputsList, focusPointsList, sessionsCount });
      } catch (e) {
        console.warn('[ChatPage] loadData error', e);
      }
    })();
  }, []);

  function buildSystemPrompt() {
    if (!userData) return '';
    const { classInputsList, focusPointsList, sessionsCount } = userData;

    const focusLines = focusPointsList.length
      ? focusPointsList.map(fp => `- ${fp.name}`).join('\n')
      : 'No focus points recorded.';

    const classLines = classInputsList.slice(0, 10).map(inp => {
      const date = new Date(inp.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
      const parts = [`Class on ${date}:`];
      if (inp.takeaway) parts.push(`Worked on: "${inp.takeaway}"`);
      if (inp.practice_point_1) parts.push(`To improve: "${inp.practice_point_1}" (priority ${inp.priority_score_1}/10)`);
      if (inp.practice_point_2) parts.push(`Also: "${inp.practice_point_2}" (priority ${inp.priority_score_2}/10)`);
      if (inp.ai_primary_focus) parts.push(`AI focus: ${inp.ai_primary_focus}`);
      return parts.join(' | ');
    }).join('\n') || 'No classes recorded.';

    return `You are a training tracking assistant for a dancer. You respond ONLY based on the data provided below.

Current session focus: ${focusPoint?.name ?? 'Not defined'}

User focus points:
${focusLines}

Class history (last 10):
${classLines}

Training sessions this week: ${sessionsCount}

STRICT RULES:
- Answer ONLY from the data above.
- If you cannot find the information, respond exactly: "I don't have that information in your data."
- Do not invent, extrapolate, or make any assumptions.
- Respond in English, concisely (2-3 sentences max unless asked for more).`;
  }

  async function handleSend() {
    const text = inputText.trim();
    if (!text || sending) return;
    setInputText('');
    Keyboard.dismiss();
    const newMessages = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    storeChatMessages(newMessages);
    setSending(true);

    // Classify student message → fire question event on current focus
    try {
      const { applyFocusEvent } = await import('../utils/algorithm');
      const { supabase } = await import('../services/supabase/client');
      const { data: { user } } = await supabase.auth.getUser();
      const msgLower = text.toLowerCase();
      const isConfusion = /\b(don't understand|not sure|confused|what does|what is|how do|i don't get|unclear)\b/.test(msgLower);
      const isConfirmation = /\b(right\??|correct\??|is that|so i should|did i|am i)\b/.test(msgLower);
      const hasQuestion = msgLower.includes('?') || isConfusion || isConfirmation;
      if (hasQuestion && focusPointId && user) {
        const eventType = isConfusion ? 'QUESTION_CONFUSION'
          : isConfirmation ? 'QUESTION_CONFIRMATION'
          : 'QUESTION_CLARIFICATION';
        await applyFocusEvent(focusPointId, eventType, user.id).catch(() => {});
      }
    } catch {}

    try {
      const reply = await callClaudeChat(buildSystemPrompt(), newMessages);
      setMessages(prev => {
        const updated = [...prev, { role: 'assistant', content: reply }];
        storeChatMessages(updated);
        return updated;
      });
    } catch {
      setMessages(prev => {
        const updated = [...prev, { role: 'assistant', content: "Sorry, an error occurred. Please try again." }];
        storeChatMessages(updated);
        return updated;
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={[chat.wrap, keyboardHeight > 0 && { paddingBottom: keyboardHeight }]}>
      {/* Session status bar */}
      {sessionActive && (
        <View style={chat.sessionBar}>
          <View style={chat.sessionDot} />
          <Text style={chat.sessionText}>
            In progress  ·  {formatTime(timeLeft)} / {duration} min
          </Text>
        </View>
      )}

      <View style={chat.header}>
        <Text style={chat.title}>AI Coach</Text>
        <Text style={chat.subtitle}>Ask questions about your training</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={chat.messageList}
        contentContainerStyle={chat.messageListContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 && !sending && (
          <View style={chat.emptyState}>
            <Text style={chat.emptyText}>
              Ask a question about your classes, focus points, or sessions this week.
            </Text>
          </View>
        )}
        {messages.map((msg, i) => (
          <View key={i} style={[chat.bubble, msg.role === 'user' ? chat.bubbleUser : chat.bubbleBot]}>
            <Text style={[chat.bubbleText, msg.role === 'user' ? chat.bubbleTextUser : chat.bubbleTextBot]}>
              {msg.content}
            </Text>
          </View>
        ))}
        {sending && (
          <View style={[chat.bubble, chat.bubbleBot]}>
            <ActivityIndicator size="small" color={Colors.secondary} />
          </View>
        )}
      </ScrollView>

      <View style={chat.inputBar}>
        <TextInput
          style={chat.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Ask a question..."
          placeholderTextColor={Colors.secondary}
          multiline
          maxLength={300}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          blurOnSubmit
        />
        <TouchableOpacity
          style={[chat.sendBtn, (!inputText.trim() || sending) && chat.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim() || sending}
          activeOpacity={0.8}
        >
          <Text style={chat.sendBtnIcon}>↑</Text>
        </TouchableOpacity>
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
  const [outerScrollEnabled, setOuterScrollEnabled] = useState(true);
  const [selectedInput, setSelectedInput] = useState(null);
  const [duration, setDuration] = useState(25);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionPaused, setSessionPaused] = useState(false);
  const [sessionDone, setSessionDone] = useState(false);
  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [showFeelingModal, setShowFeelingModal] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [chatMessages, setChatMessages] = useState(() => getChatMessages());
  const { width: screenW } = useWindowDimensions();
  const intervalRef = useRef(null);

  useEffect(() => {
    if (sessionDone) setShowFeelingModal(true);
  }, [sessionDone]);

  useEffect(() => {
    async function loadData() {
      const points = await getFocusPoints();
      const fp = points.find(p => p.id === focusPointId) || null;
      setFocusPoint(fp);
      if (fp) {
        const inputs = await getClassInputsForFocus(fp.name);
        setClassInputs(inputs);
      }
      setNotesLoading(false);
    }
    loadData();
  }, [focusPointId]);

  useFocusEffect(useCallback(() => {
    const existing = getActiveSession();
    if (existing && existing.sessionId === sessionId) {
      const remaining = Math.floor(getSessionTimeLeft());
      if (remaining > 0) {
        setDuration(existing.duration);
        setTimeLeft(remaining);
        setSessionActive(true);
        if (existing.pausedRemaining !== undefined) {
          setSessionPaused(true);
        } else {
          setSessionPaused(false);
          _startInterval(existing.startedAt, existing.duration);
        }
      }
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [sessionId]));

  function _startInterval(startedAt, dur) {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const totalSeconds = dur * 60;
    intervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const remaining = Math.max(0, totalSeconds - elapsed);
      setTimeLeft(Math.floor(remaining));
      if (remaining <= 0) {
        clearInterval(intervalRef.current);
        setSessionActive(false);
        setSessionDone(true);
        clearActiveSession();
      }
    }, 1000);
  }

  function startSession() {
    const startedAt = Date.now();
    setActiveSession({ sessionId, focusPointId, focusPointName: focusPoint?.name, rank, sessionCount, duration, startedAt });
    setSessionActive(true);
    setSessionDone(false);
    setTimeLeft(duration * 60);
    _startInterval(startedAt, duration);
  }

  function pauseSession() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setSessionPaused(true);
    // Freeze HomeScreen countdown by storing remaining seconds
    const existing = getActiveSession();
    if (existing) setActiveSession({ ...existing, pausedRemaining: timeLeft });
  }

  function resumeSession() {
    setSessionPaused(false);
    // Recalculate startedAt so elapsed math resumes from current timeLeft
    const newStartedAt = Date.now() - (duration * 60 - timeLeft) * 1000;
    const existing = getActiveSession();
    if (existing) setActiveSession({ ...existing, startedAt: newStartedAt, pausedRemaining: undefined });
    _startInterval(newStartedAt, duration);
  }

  function stopSession() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setSessionActive(false);
    setSessionPaused(false);
    setTimeLeft(duration * 60);
    clearActiveSession();
  }

  function handleEndSession() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setSessionActive(false);
    setSessionPaused(false);
    clearChatMessages();
    setChatMessages([]);
    setShowFeelingModal(true);
  }

  async function handleSave(feeling, note) {
    // Only Save marks the session as complete in Supabase
    await completeTrainingSession(sessionId, feeling, note, focusPointId);
    clearActiveSession();
    setShowFeelingModal(false);
    navigation.goBack();
  }

  async function handleSkip() {
    await completeTrainingSession(sessionId, null, null, focusPointId);
    clearActiveSession();
    setShowFeelingModal(false);
    navigation.goBack();
  }

  const progress = sessionActive ? 1 - timeLeft / (duration * 60) : sessionDone ? 1 : 0;
  const slotLabel = rank === 0 ? 'Main Focus' : 'Secondary Focus';

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

      {/* ── Horizontal pages ── */}
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={outerScrollEnabled}
      >
        {/* ── Page 1 : Training ── */}
        <View style={{ width: screenW, flex: 1 }}>

          {/* Focus Card — touching anywhere inside locks the outer page scroll */}
          <View
            style={styles.focusCard}
            onTouchStart={() => setOuterScrollEnabled(false)}
            onTouchEnd={() => setOuterScrollEnabled(true)}
            onTouchCancel={() => setOuterScrollEnabled(true)}
          >
            <Text style={styles.sessionLabel}>{getSessionLabel(sessionCount)}</Text>
            <Text style={styles.focusName}>{focusPoint?.name || '—'}</Text>
            <FocusPager
              focusPoint={focusPoint}
              inputs={classInputs}
              loading={notesLoading}
              onSelect={setSelectedInput}
            />
          </View>

          {/* Timer */}
          <View style={styles.timerSection}>
            {sessionDone ? (
              <View style={styles.doneWrap}>
                <Text style={styles.doneCheck}>✓</Text>
                <Text style={styles.doneTitle}>Session complete!</Text>
              </View>
            ) : sessionActive ? (
              <>
                <Text style={styles.timerText}>{formatTime(timeLeft)}</Text>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
                </View>
              </>
            ) : (
              <DurationPicker
                value={duration}
                onChange={(d) => { setDuration(d); setTimeLeft(d * 60); }}
              />
            )}
          </View>

          {/* Tools */}
          <View
            style={styles.tools}
            onTouchStart={() => setOuterScrollEnabled(false)}
            onTouchEnd={() => setOuterScrollEnabled(true)}
            onTouchCancel={() => setOuterScrollEnabled(true)}
          >
            <MetronomeStrip />
          </View>

          {/* CTA */}
          <View style={styles.ctaWrap}>
            {!sessionActive && !sessionDone && (
              <TouchableOpacity style={styles.startBtn} onPress={startSession} activeOpacity={0.88}>
                <Text style={styles.startBtnText}>START SESSION</Text>
              </TouchableOpacity>
            )}

            {sessionActive && !sessionPaused && (
              <TouchableOpacity style={styles.pauseBtn} onPress={pauseSession} activeOpacity={0.85}>
                <Text style={styles.pauseBtnText}>⏸  Pause</Text>
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
              <TouchableOpacity style={styles.validateBtn} onPress={handleEndSession} activeOpacity={0.85}>
                <Text style={styles.validateBtnText}>END SESSION</Text>
              </TouchableOpacity>
            )}

            {/* Page indicator */}
            <View style={styles.pageIndicator}>
              <View style={[styles.pageDot, styles.pageDotActive]} />
              <View style={styles.pageDot} />
            </View>
          </View>
        </View>

        {/* ── Page 2 : AI Coach ── */}
        <View style={{ width: screenW, flex: 1 }}>
          <ChatPage
            focusPoint={focusPoint}
            focusPointId={focusPointId}
            sessionActive={sessionActive}
            timeLeft={timeLeft}
            duration={duration}
            messages={chatMessages}
            setMessages={setChatMessages}
          />
        </View>
      </ScrollView>

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
  slotBadge: {
    borderWidth: 1, borderColor: 'rgba(17,12,17,0.15)',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4,
  },
  slotBadgeText: { fontFamily: Fonts.jakartaMedium, fontSize: 12, color: Colors.secondary },

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
  ctaWrap: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 8,
    gap: 10,
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
    borderWidth: 1,
    borderColor: 'rgba(17,12,17,0.15)',
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
  },
  stopBtnText: { fontFamily: Fonts.jakartaMedium, fontSize: 14, color: Colors.secondary },

  validateBtn: { backgroundColor: Colors.black, borderRadius: 14, paddingVertical: 17, alignItems: 'center' },
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
    borderWidth: 1,
    borderColor: 'rgba(17,12,17,0.15)',
  },
  stopConfirmCancelText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: Colors.secondary,
  },
  stopConfirmConfirm: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: Colors.black,
  },
  stopConfirmConfirmText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: Colors.white,
  },

  pageIndicator: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
  },
  pageDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(17,12,17,0.15)',
  },
  pageDotActive: {
    backgroundColor: Colors.black,
  },
});

// ─── Duration Picker styles ───────────────────────────────────────────────────

const dp = StyleSheet.create({
  wrap: {
    height: ITEM_H * 5,
    width: 200,
    alignSelf: 'center',
    overflow: 'hidden',
  },
  band: {
    position: 'absolute',
    top: ITEM_H * 2,
    left: 0,
    right: 0,
    height: ITEM_H,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(17,12,17,0.18)',
    zIndex: 1,
  },
  content: {
    paddingVertical: ITEM_H * 2,
  },
  item: {
    height: ITEM_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  num: {
    fontFamily: Fonts.monument,
    fontSize: 36,
    color: Colors.black,
    letterSpacing: 1,
    lineHeight: 44,
  },
  unit: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    marginTop: 10,
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

const m = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingVertical: 10 },

  topRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },

  // Dance pill (fixed width, left)
  dancePill: {
    width: 110,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: 'rgba(17,12,17,0.05)',
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
  },
  danceLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: Colors.black,
    flex: 1,
  },
  chevron: { fontSize: 8, color: Colors.secondary },

  // BPM wheel zone
  bpmDragWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(17,12,17,0.05)',
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    overflow: 'hidden',
  },
  bpmWheel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    width: '100%',
    marginBottom: 1,
  },
  bpmWheelCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bpmWheelCellCenter: {
    flex: 1.6,
  },
  bpmWheelNum: {
    fontFamily: Fonts.monument,
    fontSize: 11,
    color: Colors.black,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  bpmWheelNumCenter: {
    fontSize: 18,
    lineHeight: 22,
  },
  bpmWheelNumActive: { color: Colors.orange },
  bpmUnit: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 7,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  // Progress bar at the bottom (40–260 BPM range)
  bpmTrack: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(17,12,17,0.07)',
  },
  bpmFill: {
    height: 2,
    backgroundColor: Colors.orange,
    borderRadius: 1,
  },

  // Play button
  playBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.black,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  playBtnActive: {
    backgroundColor: Colors.orange,
    shadowColor: Colors.orange,
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 10,
    elevation: 4,
  },
  playIcon: { fontSize: 12, color: Colors.white },
  playIconActive: { color: Colors.black },

  // Dance picker
  picker: {},
  pickerContent: { gap: 6, paddingBottom: 2 },
  pill: {
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 6,
    backgroundColor: Colors.background,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
  },
  pillActive: { backgroundColor: Colors.black, borderColor: Colors.black },
  pillCat: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 9,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  pillCatActive: { color: 'rgba(255,255,255,0.5)' },
  pillName: { fontFamily: Fonts.jakartaBold, fontSize: 12, color: Colors.black },
  pillNameActive: { color: Colors.white },
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
