import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Vibration,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Spacing } from '../theme';
import { getFocusPoints, saveSessionCompletion } from '../services/storage';

// ─── Constants ───────────────────────────────────────────────────────────────

const SESSION_DURATION = 25 * 60;

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const RANK_LABELS = ['#1 Priority', '#2 Priority', '#3 Priority'];

// Official competition tempos (WDSF/WDC)
const DANCES = [
  // Latin
  { id: 'samba',      name: 'Samba',           bpm: 100, beats: 2, category: 'Latin' },
  { id: 'chacha',     name: 'Cha Cha Cha',      bpm: 120, beats: 4, category: 'Latin' },
  { id: 'rumba',      name: 'Rumba',            bpm: 104, beats: 4, category: 'Latin' },
  { id: 'paso',       name: 'Paso Doble',       bpm: 120, beats: 2, category: 'Latin' },
  { id: 'jive',       name: 'Jive',             bpm: 176, beats: 4, category: 'Latin' },
  // Standard
  { id: 'waltz',      name: 'Waltz',            bpm: 90,  beats: 3, category: 'Standard' },
  { id: 'tango',      name: 'Tango',            bpm: 132, beats: 4, category: 'Standard' },
  { id: 'vwaltz',     name: 'Viennese Waltz',   bpm: 180, beats: 3, category: 'Standard' },
  { id: 'foxtrot',    name: 'Foxtrot',          bpm: 120, beats: 4, category: 'Standard' },
  { id: 'quickstep',  name: 'Quickstep',        bpm: 200, beats: 4, category: 'Standard' },
];

// ─── Train / Spotify Embedded Player ─────────────────────────────────────────

const PLAYLISTS = [
  { label: 'Latin',     id: '37i9dQZF1DX3LDIBRoaCDQ' },
  { label: 'Standard',  id: '37i9dQZF1DX4sWSpwq3LiO' },
  { label: 'Training',  id: '37i9dQZF1DX76Wlfdnj7AP' },
];

function TrainSection() {
  const [active, setActive] = useState(0);
  const embedUrl = `https://open.spotify.com/embed/playlist/${PLAYLISTS[active].id}?utm_source=generator&theme=0`;

  return (
    <View style={sp.card}>
      {/* Tab selector */}
      <View style={sp.tabs}>
        {PLAYLISTS.map((p, i) => (
          <TouchableOpacity
            key={p.id}
            style={[sp.tab, i === active && sp.tabActive]}
            onPress={() => setActive(i)}
            activeOpacity={0.75}
          >
            <Text style={[sp.tabText, i === active && sp.tabTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Embedded player */}
      <View style={sp.playerWrap}>
        <WebView
          source={{ uri: embedUrl }}
          style={sp.webview}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled
          scrollEnabled={false}
        />
      </View>
    </View>
  );
}

// ─── Metronome Section ────────────────────────────────────────────────────────

function MetronomeSection() {
  const [selectedDance, setSelectedDance] = useState(null);
  const [bpm, setBpm] = useState(120);
  const [beats, setBeats] = useState(4);
  const [running, setRunning] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0);
  const beatOpacity = useRef(new Animated.Value(1)).current;
  const metroRef = useRef(null);
  const bpmRef = useRef(bpm);
  const beatsRef = useRef(beats);

  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { beatsRef.current = beats; }, [beats]);

  function selectDance(dance) {
    setSelectedDance(dance.id);
    setBpm(dance.bpm);
    setBeats(dance.beats);
    if (running) restartMetro(dance.bpm, dance.beats);
  }

  function flash() {
    beatOpacity.setValue(1);
    Animated.timing(beatOpacity, { toValue: 0.15, duration: 120, useNativeDriver: true }).start();
  }

  function startMetro(overrideBpm, overrideBeats) {
    const b = overrideBpm ?? bpmRef.current;
    const ms = Math.round(60000 / b);
    let beat = 0;
    metroRef.current = setInterval(() => {
      beat = (beat % (overrideBeats ?? beatsRef.current)) + 1;
      setCurrentBeat(beat);
      flash();
      if (b <= 160) Vibration.vibrate(beat === 1 ? 30 : 15);
    }, ms);
    setRunning(true);
  }

  function stopMetro() {
    if (metroRef.current) clearInterval(metroRef.current);
    setRunning(false);
    setCurrentBeat(0);
  }

  function restartMetro(overrideBpm, overrideBeats) {
    stopMetro();
    setTimeout(() => startMetro(overrideBpm, overrideBeats), 50);
  }

  function toggleMetro() {
    if (running) { stopMetro(); } else { startMetro(); }
  }

  useEffect(() => () => { if (metroRef.current) clearInterval(metroRef.current); }, []);

  const latin = DANCES.filter((d) => d.category === 'Latin');
  const standard = DANCES.filter((d) => d.category === 'Standard');
  const selected = DANCES.find((d) => d.id === selectedDance);

  return (
    <View style={metro.card}>
      <View style={metro.header}>
        <Text style={metro.title}>Métronome</Text>
        {selectedDance && (
          <View style={metro.bpmRow}>
            <TouchableOpacity onPress={() => { const v = Math.max(40, bpm - 1); setBpm(v); if (running) restartMetro(v, beats); }} style={metro.bpmBtn}>
              <Text style={metro.bpmBtnText}>−</Text>
            </TouchableOpacity>
            <Text style={metro.bpmValue}>{bpm} <Text style={metro.bpmUnit}>BPM</Text></Text>
            <TouchableOpacity onPress={() => { const v = Math.min(260, bpm + 1); setBpm(v); if (running) restartMetro(v, beats); }} style={metro.bpmBtn}>
              <Text style={metro.bpmBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Dance selector */}
      <Text style={metro.catLabel}>LATIN</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={metro.scroll} contentContainerStyle={metro.scrollContent}>
        {latin.map((d) => (
          <TouchableOpacity
            key={d.id}
            style={[metro.dancePill, selectedDance === d.id && metro.dancePillActive]}
            onPress={() => selectDance(d)}
            activeOpacity={0.75}
          >
            <Text style={[metro.dancePillText, selectedDance === d.id && metro.dancePillTextActive]}>{d.name}</Text>
            <Text style={[metro.dancePillBpm, selectedDance === d.id && metro.dancePillBpmActive]}>{d.bpm}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={[metro.catLabel, { marginTop: 12 }]}>STANDARD</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={metro.scroll} contentContainerStyle={metro.scrollContent}>
        {standard.map((d) => (
          <TouchableOpacity
            key={d.id}
            style={[metro.dancePill, selectedDance === d.id && metro.dancePillActive]}
            onPress={() => selectDance(d)}
            activeOpacity={0.75}
          >
            <Text style={[metro.dancePillText, selectedDance === d.id && metro.dancePillTextActive]}>{d.name}</Text>
            <Text style={[metro.dancePillBpm, selectedDance === d.id && metro.dancePillBpmActive]}>{d.bpm}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Beat display + play */}
      {selectedDance && (
        <View style={metro.player}>
          {/* Beat dots */}
          <View style={metro.beatDots}>
            {Array.from({ length: beats }).map((_, i) => {
              const isActive = running && currentBeat === i + 1;
              return (
                <Animated.View
                  key={i}
                  style={[
                    metro.beatDot,
                    i === 0 && metro.beatDotAccent,
                    isActive && { opacity: beatOpacity },
                    isActive && metro.beatDotActive,
                    isActive && i === 0 && metro.beatDotAccentActive,
                  ]}
                />
              );
            })}
          </View>

          <View style={metro.playerRight}>
            <Text style={metro.timeSignature}>{beats}/4 · {selected?.name}</Text>
            <TouchableOpacity
              style={[metro.playBtn, running && metro.playBtnActive]}
              onPress={toggleMetro}
              activeOpacity={0.8}
            >
              <Text style={metro.playBtnText}>{running ? '⏹ Stop' : '▶ Start'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {!selectedDance && (
        <Text style={metro.hint}>Select a dance style to set the tempo</Text>
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

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
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
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
    'This session focuses on intentional repetition and body awareness to build lasting muscle memory. Work through each set with full attention on quality of movement over speed.';

  const progress = sessionActive ? 1 - timeLeft / SESSION_DURATION : sessionDone ? 1 : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
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

        {/* Exercise */}
        <Text style={styles.sectionHeading}>Exercise</Text>
        <Text style={styles.sectionBody}>{exerciseText}</Text>

        {/* Structure */}
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

        {/* Train */}
        <Text style={styles.sectionHeading}>Train</Text>
        <TrainSection />

        {/* Metronome */}
        <Text style={[styles.sectionHeading, { marginTop: 24 }]}>Métronome</Text>
        <MetronomeSection />

        {/* Timer / Start / Done */}
        <View style={{ marginTop: 24 }}>
          {sessionActive ? (
            <>
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
        </View>
      </ScrollView>

      <Animated.View style={[styles.successOverlay, { opacity: successOpacity }]} pointerEvents="none">
        <Text style={styles.successText}>Session validated ✓</Text>
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
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(17,12,17,0.08)',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backArrow: { fontSize: 18, color: Colors.activeFocus },
  backLabel: { fontFamily: Fonts.jakartaMedium, fontSize: 15, color: Colors.activeFocus },
  rankBadge: {
    borderWidth: 1, borderColor: 'rgba(17,12,17,0.15)',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4,
  },
  rankBadgeText: { fontFamily: Fonts.jakartaMedium, fontSize: 12, color: Colors.secondary },
  content: { paddingHorizontal: Spacing.side, paddingTop: 20, paddingBottom: 40 },

  focusCard: {
    backgroundColor: Colors.focusCard, borderRadius: 14,
    paddingHorizontal: 20, paddingVertical: 20, marginBottom: 28,
  },
  focusCardLabel: { fontFamily: Fonts.jakartaRegular, fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 8 },
  focusCardName: { fontFamily: Fonts.jakartaExtraBold, fontSize: 26, color: Colors.white },

  sectionHeading: { fontFamily: Fonts.jakartaExtraBold, fontSize: 18, color: Colors.black, marginBottom: 12 },
  sectionBody: { fontFamily: Fonts.jakartaRegular, fontSize: 13, color: Colors.secondary, lineHeight: 20, marginBottom: 24 },

  structureRow: { flexDirection: 'row', marginBottom: 24 },
  structureCol: { flex: 1 },
  structureLabel: { fontFamily: Fonts.jakartaMedium, fontSize: 12, color: Colors.secondary, marginBottom: 4 },
  structureValue: { fontFamily: Fonts.jakartaExtraBold, fontSize: 16, color: Colors.black },
  structureDivider: { width: 1, backgroundColor: 'rgba(17,12,17,0.1)', marginHorizontal: 16, marginVertical: 4 },

  progressTrack: { height: 4, backgroundColor: 'rgba(17,12,17,0.08)', borderRadius: 2, marginBottom: 14, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: Colors.orange, borderRadius: 2 },

  timerBox: { backgroundColor: Colors.timerBg, borderRadius: 14, paddingVertical: 24, alignItems: 'center', marginBottom: 14 },
  timerHint: { fontFamily: Fonts.jakartaRegular, fontSize: 11, color: 'rgba(17,12,17,0.4)', marginBottom: 4 },
  timerText: { fontFamily: Fonts.monument, fontSize: 52, color: Colors.black, letterSpacing: 2 },

  startBtn: { backgroundColor: Colors.orange, borderRadius: 14, paddingVertical: 18, alignItems: 'center', marginBottom: 14 },
  startBtnText: { fontFamily: Fonts.jakartaExtraBold, fontSize: 15, color: Colors.white, letterSpacing: 1 },

  doneBox: { backgroundColor: Colors.timerBg, borderRadius: 14, paddingVertical: 24, alignItems: 'center', marginBottom: 14 },
  doneIcon: { fontSize: 32, marginBottom: 8 },
  doneTitle: { fontFamily: Fonts.jakartaExtraBold, fontSize: 18, color: Colors.black, marginBottom: 4 },
  doneSubtitle: { fontFamily: Fonts.jakartaRegular, fontSize: 13, color: Colors.secondary },

  validateBtn: { backgroundColor: Colors.black, borderRadius: 14, paddingVertical: 18, alignItems: 'center' },
  validateBtnDone: { backgroundColor: Colors.activeLog },
  validateBtnText: { fontFamily: Fonts.jakartaExtraBold, fontSize: 15, color: Colors.white, letterSpacing: 1 },

  successOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  successText: { fontFamily: Fonts.jakartaExtraBold, fontSize: 20, color: Colors.white, letterSpacing: 0.5 },
});

// Train / Spotify embed styles
const sp = StyleSheet.create({
  card: {
    backgroundColor: '#0D1117',
    borderRadius: 14,
    overflow: 'hidden',
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 8,
  },
  tab: {
    flex: 1, alignItems: 'center', paddingVertical: 7,
    borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.07)',
  },
  tabActive: { backgroundColor: '#1DB954' },
  tabText: { fontFamily: Fonts.jakartaBold, fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  tabTextActive: { color: '#000000' },
  playerWrap: { height: 232 },
  webview: { flex: 1, backgroundColor: '#000000' },
});

// Metronome styles
const metro = StyleSheet.create({
  card: {
    backgroundColor: Colors.statCardBg,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    padding: 16,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { fontFamily: Fonts.jakartaExtraBold, fontSize: 15, color: Colors.black },
  bpmRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bpmBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.black, alignItems: 'center', justifyContent: 'center',
  },
  bpmBtnText: { color: Colors.white, fontSize: 18, lineHeight: 22, fontWeight: '600' },
  bpmValue: { fontFamily: Fonts.jakartaExtraBold, fontSize: 18, color: Colors.black, minWidth: 80, textAlign: 'center' },
  bpmUnit: { fontFamily: Fonts.jakartaRegular, fontSize: 12, color: Colors.secondary },

  catLabel: { fontFamily: Fonts.montserratMedium, fontSize: 10, color: Colors.secondary, letterSpacing: 1, marginBottom: 8 },
  scroll: { marginHorizontal: -16 },
  scrollContent: { paddingHorizontal: 16, gap: 8 },

  dancePill: {
    alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: Colors.background, borderRadius: 10,
    borderWidth: 0.5, borderColor: Colors.statCardBorder, marginBottom: 4,
  },
  dancePillActive: { backgroundColor: Colors.black, borderColor: Colors.black },
  dancePillText: { fontFamily: Fonts.jakartaBold, fontSize: 13, color: Colors.black },
  dancePillTextActive: { color: Colors.white },
  dancePillBpm: { fontFamily: Fonts.montserratMedium, fontSize: 11, color: Colors.secondary, marginTop: 2 },
  dancePillBpmActive: { color: 'rgba(255,255,255,0.6)' },

  player: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 0.5,
    borderTopColor: Colors.statCardBorder,
  },
  beatDots: { flexDirection: 'row', gap: 8 },
  beatDot: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: 'rgba(17,12,17,0.15)',
  },
  beatDotAccent: { backgroundColor: 'rgba(17,12,17,0.35)' },
  beatDotActive: { backgroundColor: Colors.orange },
  beatDotAccentActive: { backgroundColor: Colors.orange, width: 16, height: 16, borderRadius: 8, marginTop: -2 },

  playerRight: { alignItems: 'flex-end', gap: 8 },
  timeSignature: { fontFamily: Fonts.jakartaMedium, fontSize: 12, color: Colors.secondary },
  playBtn: {
    backgroundColor: Colors.black, borderRadius: 10,
    paddingHorizontal: 18, paddingVertical: 9,
  },
  playBtnActive: { backgroundColor: Colors.orange },
  playBtnText: { fontFamily: Fonts.jakartaExtraBold, fontSize: 13, color: Colors.white },

  hint: { fontFamily: Fonts.jakartaRegular, fontSize: 13, color: Colors.secondary, marginTop: 10, textAlign: 'center' },
});
