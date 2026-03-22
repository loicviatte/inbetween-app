import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Linking,
  ActivityIndicator,
  Modal,
  Pressable,
} from 'react-native';
import { Audio } from 'expo-av';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Spacing } from '../theme';
import { getFocusPoints, getClassInputsForFocus } from '../services/storage';
import { completeTrainingSession, getSessionLabel } from '../services/algorithm';

const SESSION_DURATION = 25 * 60;
const TICK_SOUND = require('../../assets/metronome_tick.wav');

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

const SPOTIFY_PLAYLISTS = [
  { label: 'Latin',    uri: 'spotify:playlist:37i9dQZF1DX3LDIBRoaCDQ', fallback: 'https://open.spotify.com/playlist/37i9dQZF1DX3LDIBRoaCDQ' },
  { label: 'Standard', uri: 'spotify:playlist:37i9dQZF1DX4sWSpwq3LiO', fallback: 'https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO' },
  { label: 'Training', uri: 'spotify:playlist:37i9dQZF1DX76Wlfdnj7AP', fallback: 'https://open.spotify.com/playlist/37i9dQZF1DX76Wlfdnj7AP' },
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
      <Text style={ln.heading}>Linked class notes</Text>
      {inputs.map((inp) => (
        <TouchableOpacity key={inp.id} style={ln.row} onPress={() => onSelect(inp)} activeOpacity={0.7}>
          <Text style={ln.date}>{formatDate(inp.created_at)}</Text>
          <Text style={ln.text} numberOfLines={1}>{inp.practice_point_1}</Text>
          <Text style={ln.arrow}>›</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Spotify Strip ────────────────────────────────────────────────────────────

function SpotifyStrip() {
  const [playing, setPlaying] = useState(false);
  const [activePlaylist, setActivePlaylist] = useState(null);

  async function openPlaylist(pl) {
    setActivePlaylist(pl.label);
    setPlaying(true);
    const canOpen = await Linking.canOpenURL(pl.uri);
    Linking.openURL(canOpen ? pl.uri : pl.fallback);
  }

  function handlePrev() {
    Linking.openURL('spotify:').catch(() => {});
  }
  function handleNext() {
    Linking.openURL('spotify:').catch(() => {});
  }
  function handlePlayPause() {
    setPlaying(v => !v);
    Linking.openURL('spotify:').catch(() => {});
  }

  return (
    <View style={sp.wrap}>
      <View style={sp.topRow}>
        <Text style={sp.label}><Text style={sp.icon}>♪ </Text>Spotify</Text>
        <View style={sp.controls}>
          <TouchableOpacity style={sp.ctrlBtn} onPress={handlePrev} activeOpacity={0.7}>
            <Text style={sp.ctrlIcon}>⏮</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[sp.ctrlBtn, sp.playPauseBtn]} onPress={handlePlayPause} activeOpacity={0.75}>
            <Text style={sp.playPauseIcon}>{playing ? '⏸' : '▶'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={sp.ctrlBtn} onPress={handleNext} activeOpacity={0.7}>
            <Text style={sp.ctrlIcon}>⏭</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={sp.pills}>
        {SPOTIFY_PLAYLISTS.map(pl => (
          <TouchableOpacity
            key={pl.label}
            style={[sp.pill, activePlaylist === pl.label && sp.pillActive]}
            onPress={() => openPlaylist(pl)}
            activeOpacity={0.75}
          >
            <Text style={[sp.pillText, activePlaylist === pl.label && sp.pillTextActive]}>
              {pl.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ─── Compact Metronome ────────────────────────────────────────────────────────

function MetronomeStrip() {
  const [selectedDance, setSelectedDance] = useState(null);
  const [bpm, setBpm] = useState(120);
  const [beats, setBeats] = useState(4);
  const [running, setRunning] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const beatOpacity = useRef(new Animated.Value(1)).current;
  const metroRef = useRef(null);
  const soundRef = useRef(null);
  const bpmRef = useRef(bpm);
  const beatsRef = useRef(beats);

  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { beatsRef.current = beats; }, [beats]);

  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
    Audio.Sound.createAsync(TICK_SOUND, { volume: 1.0 }).then(({ sound }) => {
      soundRef.current = sound;
    });
    return () => {
      if (metroRef.current) clearInterval(metroRef.current);
      soundRef.current?.unloadAsync();
    };
  }, []);

  async function playTick() {
    if (!soundRef.current) return;
    try {
      await soundRef.current.setPositionAsync(0);
      await soundRef.current.playAsync();
    } catch {}
  }

  function flash() {
    beatOpacity.setValue(1);
    Animated.timing(beatOpacity, { toValue: 0.2, duration: 100, useNativeDriver: true }).start();
  }

  function startMetro(overrideBpm, overrideBeats) {
    const b = overrideBpm ?? bpmRef.current;
    const ms = Math.round(60000 / b);
    metroRef.current = setInterval(() => {
      flash();
      playTick();
    }, ms);
    setRunning(true);
  }

  function stopMetro() {
    if (metroRef.current) clearInterval(metroRef.current);
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
      setTimeout(() => startMetro(dance.bpm, dance.beats), 50);
    }
  }

  function adjustBpm(delta) {
    const v = Math.max(40, Math.min(260, bpm + delta));
    setBpm(v);
    if (running) { stopMetro(); setTimeout(() => startMetro(v, beats), 50); }
  }

  const selected = DANCES.find(d => d.id === selectedDance);

  return (
    <View style={m.wrap}>
      <View style={m.row}>
        <TouchableOpacity style={m.dancePill} onPress={() => setShowPicker(v => !v)} activeOpacity={0.75}>
          <Animated.View style={[m.beatDot, running && { opacity: beatOpacity, backgroundColor: Colors.orange }]} />
          <Text style={m.danceName}>{selected ? selected.name : 'Select dance'}</Text>
          <Text style={m.chevron}>{showPicker ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        <View style={m.bpmRow}>
          <TouchableOpacity style={m.bpmBtn} onPress={() => adjustBpm(-1)} activeOpacity={0.7}>
            <Text style={m.bpmBtnText}>−</Text>
          </TouchableOpacity>
          <Text style={m.bpmVal}>{bpm}</Text>
          <TouchableOpacity style={m.bpmBtn} onPress={() => adjustBpm(1)} activeOpacity={0.7}>
            <Text style={m.bpmBtnText}>+</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[m.playBtn, running && m.playBtnActive]}
            onPress={toggleMetro}
            activeOpacity={0.8}
          >
            <Text style={m.playBtnText}>{running ? '⏹' : '▶'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {showPicker && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={m.picker} contentContainerStyle={m.pickerContent}>
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

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function FocusSessionScreen({ route, navigation }) {
  const { focusPointId, sessionId, rank = 0, sessionCount = 0 } = route.params;
  const [focusPoint, setFocusPoint] = useState(null);
  const [classInputs, setClassInputs] = useState([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [selectedInput, setSelectedInput] = useState(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionDone, setSessionDone] = useState(false);
  const [timeLeft, setTimeLeft] = useState(SESSION_DURATION);
  const [validated, setValidated] = useState(false);
  const intervalRef = useRef(null);
  const successOpacity = useRef(new Animated.Value(0)).current;

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
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [focusPointId]);

  function startSession() {
    setSessionActive(true);
    setSessionDone(false);
    setTimeLeft(SESSION_DURATION);
    intervalRef.current = setInterval(() => {
      setTimeLeft(prev => {
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
    await completeTrainingSession(sessionId);
    Animated.sequence([
      Animated.timing(successOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.delay(1000),
      Animated.timing(successOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => navigation.goBack());
  }

  const progress = sessionActive ? 1 - timeLeft / SESSION_DURATION : sessionDone ? 1 : 0;
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
        ) : (
          <>
            <Text style={[styles.timerText, !sessionActive && styles.timerIdle]}>
              {formatTime(timeLeft)}
            </Text>
            {sessionActive && (
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
              </View>
            )}
            {!sessionActive && (
              <Text style={styles.timerHint}>25 min session</Text>
            )}
          </>
        )}
      </View>

      {/* ── Tools ── */}
      <View style={styles.tools}>
        <SpotifyStrip />
        <View style={styles.toolDivider} />
        <MetronomeStrip />
      </View>

      {/* ── CTA ── */}
      <View style={styles.ctaWrap}>
        {!sessionActive && !sessionDone && (
          <TouchableOpacity style={styles.startBtn} onPress={startSession} activeOpacity={0.88}>
            <Text style={styles.startBtnText}>START SESSION</Text>
          </TouchableOpacity>
        )}

        {sessionActive && (
          <TouchableOpacity style={styles.stopBtn} onPress={stopSession} activeOpacity={0.85}>
            <Text style={styles.stopBtnText}>Stop</Text>
          </TouchableOpacity>
        )}

        {(sessionActive || sessionDone) && (
          <TouchableOpacity
            style={[styles.validateBtn, validated && styles.validateBtnDone]}
            onPress={handleValidate}
            activeOpacity={0.85}
            disabled={validated}
          >
            <Text style={styles.validateBtnText}>{validated ? 'Saved ✓' : 'VALIDATE SESSION'}</Text>
          </TouchableOpacity>
        )}
      </View>

      <Animated.View style={[styles.overlay, { opacity: successOpacity }]} pointerEvents="none">
        <Text style={styles.overlayText}>Session validated ✓</Text>
      </Animated.View>

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
  toolDivider: { height: 0.5, backgroundColor: Colors.statCardBorder, marginHorizontal: 14 },

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

  stopBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(17,12,17,0.2)',
  },
  stopBtnText: { fontFamily: Fonts.jakartaMedium, fontSize: 14, color: Colors.secondary },

  validateBtn: { backgroundColor: Colors.black, borderRadius: 14, paddingVertical: 17, alignItems: 'center' },
  validateBtnDone: { backgroundColor: Colors.activeLog },
  validateBtnText: { fontFamily: Fonts.jakartaExtraBold, fontSize: 15, color: Colors.white, letterSpacing: 1 },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayText: { fontFamily: Fonts.jakartaExtraBold, fontSize: 20, color: Colors.white, letterSpacing: 0.5 },
});

// ─── Spotify styles ───────────────────────────────────────────────────────────

const sp = StyleSheet.create({
  wrap: { paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  icon: { color: '#1DB954' },
  label: { fontFamily: Fonts.jakartaMedium, fontSize: 13, color: Colors.black },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ctrlBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(17,12,17,0.07)',
    alignItems: 'center', justifyContent: 'center',
  },
  ctrlIcon: { fontSize: 13, color: Colors.black },
  playPauseBtn: { backgroundColor: '#1DB954', width: 34, height: 34, borderRadius: 17 },
  playPauseIcon: { fontSize: 13, color: '#000' },
  pills: { flexDirection: 'row', gap: 7 },
  pill: {
    flex: 1, alignItems: 'center', paddingVertical: 7,
    borderRadius: 8, borderWidth: 1, borderColor: 'rgba(29,185,84,0.3)',
  },
  pillActive: { backgroundColor: '#1DB954', borderColor: '#1DB954' },
  pillText: { fontFamily: Fonts.jakartaBold, fontSize: 12, color: '#1DB954' },
  pillTextActive: { color: '#000' },
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
  wrap: { paddingHorizontal: 14, paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dancePill: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  beatDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(17,12,17,0.2)' },
  danceName: { fontFamily: Fonts.jakartaMedium, fontSize: 13, color: Colors.black, flex: 1 },
  chevron: { fontSize: 9, color: Colors.secondary },
  bpmRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bpmBtn: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(17,12,17,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  bpmBtnText: { fontSize: 16, color: Colors.black, lineHeight: 20 },
  bpmVal: { fontFamily: Fonts.jakartaExtraBold, fontSize: 15, color: Colors.black, minWidth: 36, textAlign: 'center' },
  playBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.black,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 4,
  },
  playBtnActive: { backgroundColor: Colors.orange },
  playBtnText: { fontSize: 13, color: Colors.white },
  picker: { marginTop: 10 },
  pickerContent: { gap: 6, paddingBottom: 2 },
  pill: {
    alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: Colors.background,
    borderRadius: 8, borderWidth: 0.5, borderColor: Colors.statCardBorder,
  },
  pillActive: { backgroundColor: Colors.black, borderColor: Colors.black },
  pillCat: { fontFamily: Fonts.jakartaMedium, fontSize: 9, color: Colors.secondary, textTransform: 'uppercase' },
  pillCatActive: { color: 'rgba(255,255,255,0.5)' },
  pillName: { fontFamily: Fonts.jakartaBold, fontSize: 12, color: Colors.black },
  pillNameActive: { color: Colors.white },
});
