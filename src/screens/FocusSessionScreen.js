import React, { useState, useRef, useEffect } from 'react';
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
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Audio } from 'expo-av';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Spacing } from '../theme';
import { getFocusPoints, getClassInputsForFocus } from '../services/storage';
import { completeTrainingSession, getSessionLabel } from '../services/algorithm';
import {
  setActiveSession,
  getActiveSession,
  clearActiveSession,
  getSessionTimeLeft,
} from '../services/activeSession';

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

function ClassInputModal({ input, onClose }) {
  if (!input) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={modal.overlay} onPress={onClose}>
        <Pressable style={modal.sheet} onPress={() => {}}>
          <View style={modal.handle} />

          <View style={modal.header}>
            <Text style={modal.date}>{formatDate(input.created_at)}</Text>
            <TouchableOpacity onPress={onClose} style={modal.closeBtn} activeOpacity={0.7}>
              <Text style={modal.closeIcon}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={modal.row}>
            <Text style={modal.rowLabel}>Practice point 1</Text>
            <Text style={modal.rowValue}>{input.practice_point_1 || '—'}</Text>
            {!!input.priority_score_1 && (
              <View style={modal.badge}>
                <Text style={modal.badgeText}>Urgency {input.priority_score_1}/10</Text>
              </View>
            )}
          </View>

          {!!input.practice_point_2 && (
            <View style={modal.row}>
              <Text style={modal.rowLabel}>Practice point 2</Text>
              <Text style={modal.rowValue}>{input.practice_point_2}</Text>
              {!!input.priority_score_2 && (
                <View style={modal.badge}>
                  <Text style={modal.badgeText}>Urgency {input.priority_score_2}/10</Text>
                </View>
              )}
            </View>
          )}

          {(!!input.ai_primary_focus || !!input.ai_secondary_focus) && (
            <View style={modal.focusRow}>
              {!!input.ai_primary_focus && (
                <View style={modal.focusChip}>
                  <Text style={modal.focusChipText}>{input.ai_primary_focus}</Text>
                </View>
              )}
              {!!input.ai_secondary_focus && (
                <View style={[modal.focusChip, modal.focusChipSecondary]}>
                  <Text style={[modal.focusChipText, modal.focusChipTextSecondary]}>
                    {input.ai_secondary_focus}
                  </Text>
                </View>
              )}
            </View>
          )}

          {!!input.takeaway && (
            <View style={modal.takeawayRow}>
              <Text style={modal.rowLabel}>Takeaway</Text>
              <Text style={modal.takeawayText}>{input.takeaway}</Text>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Linked Class Notes ───────────────────────────────────────────────────────

function LinkedNotes({ inputs, loading, onSelect }) {
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

// ─── Metronome ────────────────────────────────────────────────────────────────

function MetronomeStrip() {
  const [selectedDance, setSelectedDance] = useState(null);
  const [bpm, setBpm] = useState(120);
  const [beats, setBeats] = useState(4);
  const [running, setRunning] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const metroRef = useRef(null);        // setTimeout handle
  const soundPoolRef = useRef([]);      // 3 pre-loaded sound instances
  const poolIdxRef = useRef(0);
  const bpmRef = useRef(bpm);

  useEffect(() => { bpmRef.current = bpm; }, [bpm]);

  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
    // Pre-load 3 instances so ticks never block on the same in-flight seek
    Promise.all([0, 1, 2].map(() => Audio.Sound.createAsync(TICK_SOUND, { volume: 1.0 })))
      .then(results => { soundPoolRef.current = results.map(r => r.sound); });
    return () => {
      if (metroRef.current) clearTimeout(metroRef.current);
      soundPoolRef.current.forEach(s => s.unloadAsync());
    };
  }, []);

  function playTick() {
    const pool = soundPoolRef.current;
    if (!pool.length) return;
    const sound = pool[poolIdxRef.current];
    poolIdxRef.current = (poolIdxRef.current + 1) % pool.length;
    // replayAsync rewinds + plays in one atomic call — no double-await lag
    sound.replayAsync().catch(() => {});
  }

  function pulse() {
    pulseAnim.setValue(1.4);
    Animated.timing(pulseAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }

  function startMetro(overrideBpm) {
    const b = overrideBpm ?? bpmRef.current;
    const intervalMs = Math.round(60000 / b);
    const origin = Date.now();
    let tick = 0;

    function schedule() {
      tick++;
      // Calculate exact delay to next beat, compensating for any JS event-loop drift
      const delay = Math.max(0, origin + tick * intervalMs - Date.now());
      metroRef.current = setTimeout(() => {
        pulse();
        playTick();
        schedule();
      }, delay);
    }

    // Fire first beat immediately, then schedule the rest
    pulse();
    playTick();
    schedule();
    setRunning(true);
  }

  function stopMetro() {
    if (metroRef.current) clearTimeout(metroRef.current);
    metroRef.current = null;
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
    if (running) {
      stopMetro();
      setTimeout(() => startMetro(dance.bpm), 50);
    }
  }

  function adjustBpm(delta) {
    const v = Math.max(40, Math.min(260, bpm + delta));
    setBpm(v);
    if (running) { stopMetro(); setTimeout(() => startMetro(v), 50); }
  }

  const selected = DANCES.find(d => d.id === selectedDance);

  return (
    <View style={m.wrap}>
      {/* Row 1: dance selector + play button */}
      <View style={m.topRow}>
        <TouchableOpacity style={m.dancePill} onPress={() => setShowPicker(v => !v)} activeOpacity={0.75}>
          <Text style={m.danceLabel} numberOfLines={1}>{selected ? selected.name : 'Select dance'}</Text>
          <Text style={m.chevron}>{showPicker ? '▲' : '▼'}</Text>
        </TouchableOpacity>

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

      {/* Row 2: BPM stepper */}
      <View style={m.bpmRow}>
        <TouchableOpacity style={m.stepBtn} onPress={() => adjustBpm(-5)} activeOpacity={0.7}>
          <Text style={m.stepBtnText}>−−</Text>
        </TouchableOpacity>
        <TouchableOpacity style={m.stepBtn} onPress={() => adjustBpm(-1)} activeOpacity={0.7}>
          <Text style={m.stepBtnText}>−</Text>
        </TouchableOpacity>

        <View style={m.bpmDisplay}>
          <Text style={[m.bpmVal, running && m.bpmValActive]}>{bpm}</Text>
          <Text style={m.bpmUnit}>bpm</Text>
        </View>

        <TouchableOpacity style={m.stepBtn} onPress={() => adjustBpm(1)} activeOpacity={0.7}>
          <Text style={m.stepBtnText}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity style={m.stepBtn} onPress={() => adjustBpm(5)} activeOpacity={0.7}>
          <Text style={m.stepBtnText}>++</Text>
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
}

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
  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [showFeelingModal, setShowFeelingModal] = useState(false);
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

    // Resume if returning to an in-progress session
    const existing = getActiveSession();
    if (existing && existing.sessionId === sessionId) {
      const remaining = Math.floor(getSessionTimeLeft());
      if (remaining > 0) {
        setDuration(existing.duration);
        setTimeLeft(remaining);
        setSessionActive(true);
        _startInterval(existing.startedAt, existing.duration);
      }
    }

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [focusPointId]);

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
    setShowFeelingModal(true);
  }

  async function handleSave(feeling, note) {
    // Only Save marks the session as complete in Supabase
    await completeTrainingSession(sessionId, feeling, note);
    clearActiveSession();
    setShowFeelingModal(false);
    navigation.goBack();
  }

  async function handleSkip() {
    await completeTrainingSession(sessionId);
    clearActiveSession();
    setShowFeelingModal(false);
    navigation.goBack();
  }

  const progress = sessionActive ? 1 - timeLeft / (duration * 60) : sessionDone ? 1 : 0;
  const slotLabel = rank === 0 ? 'Main Focus' : 'Secondary Focus';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backLabel}>Focus</Text>
        </TouchableOpacity>
        <View style={styles.slotBadge}>
          <Text style={styles.slotBadgeText}>{slotLabel}</Text>
        </View>
      </View>

      {/* ── Focus Card ── */}
      <View style={styles.focusCard}>
        <Text style={styles.sessionLabel}>{getSessionLabel(sessionCount)}</Text>
        <Text style={styles.focusName}>{focusPoint?.name || '—'}</Text>
        <LinkedNotes
          inputs={classInputs}
          loading={notesLoading}
          onSelect={setSelectedInput}
        />
      </View>

      <ClassInputModal input={selectedInput} onClose={() => setSelectedInput(null)} />

      {/* ── Timer ── */}
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

      {/* ── Tools ── */}
      <View style={styles.tools}>
        <MetronomeStrip />
      </View>

      {/* ── CTA ── */}
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
            <TouchableOpacity style={styles.stopBtn} onPress={stopSession} activeOpacity={0.85}>
              <Text style={styles.stopBtnText}>Stop</Text>
            </TouchableOpacity>
          </View>
        )}

        {sessionActive && (
          <TouchableOpacity style={styles.validateBtn} onPress={handleEndSession} activeOpacity={0.85}>
            <Text style={styles.validateBtnText}>END SESSION</Text>
          </TouchableOpacity>
        )}
      </View>

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
});

// ─── Modal styles ─────────────────────────────────────────────────────────────

const modal = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 12,
  },
  handle: {
    width: 36, height: 4,
    backgroundColor: 'rgba(17,12,17,0.15)',
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
  },
  closeBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(17,12,17,0.07)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeIcon: { fontSize: 13, color: Colors.black },

  row: {
    marginBottom: 18,
  },
  rowLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  rowValue: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.black,
    lineHeight: 20,
  },
  badge: {
    alignSelf: 'flex-start',
    marginTop: 6,
    borderWidth: 1,
    borderColor: 'rgba(17,12,17,0.15)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11,
    color: Colors.secondary,
  },

  focusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 18,
  },
  focusChip: {
    backgroundColor: Colors.black,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  focusChipSecondary: { backgroundColor: 'rgba(17,12,17,0.08)' },
  focusChipText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: Colors.white,
  },
  focusChipTextSecondary: { color: Colors.black },

  takeawayRow: { marginBottom: 8 },
  takeawayText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.black,
    lineHeight: 20,
    fontStyle: 'italic',
  },
});

// ─── Metronome styles ─────────────────────────────────────────────────────────

const m = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14, gap: 12 },

  // Row 1: dance + play
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  dancePill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(17,12,17,0.05)',
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
  },
  danceLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: Colors.black,
    flex: 1,
  },
  chevron: { fontSize: 9, color: Colors.secondary },

  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnActive: {
    backgroundColor: Colors.orange,
    shadowColor: Colors.orange,
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 10,
    elevation: 4,
  },
  playIcon: { fontSize: 13, color: Colors.white },
  playIconActive: { color: Colors.black },

  // Row 2: BPM stepper
  bpmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  stepBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(17,12,17,0.06)',
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: Colors.secondary,
    lineHeight: 16,
  },
  bpmDisplay: {
    alignItems: 'center',
    minWidth: 90,
  },
  bpmVal: {
    fontFamily: Fonts.monument,
    fontSize: 30,
    color: Colors.black,
    letterSpacing: 1,
    lineHeight: 36,
  },
  bpmValActive: { color: Colors.orange },
  bpmUnit: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 10,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 1,
  },

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
