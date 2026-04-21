import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Animated,
  Image,
  Modal,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { Colors, Fonts, Spacing } from '../../theme';
import { useCoachData } from '../../context/CoachDataContext';
import { getStudentFocusPoints, getStudentQuestions, getStudentRecentActivity } from '../../storage/coachStorage';
import {
  getActiveCoachClass,
  setActiveCoachClass,
  clearActiveCoachClass,
} from '../../storage/activeCoachClass';
import { supabase } from '../../services/supabase/client';
import { presentAudioRoutePicker } from 'audio-route-picker';

const ASSEMBLYAI_API_KEY = process.env.EXPO_PUBLIC_ASSEMBLYAI_API_KEY;

// Universal 3 Pro supports a free-form prompt (BETA). This is passed as the
// `prompt` field on the create-transcript request.
const DANCE_PROMPT = `You are transcribing a professional DanceSport class led by a Latin and Ballroom teacher.

Your primary objective is absolute transcription accuracy. The transcript will be used by another system to extract technical dance information, so any incorrect word may cause data extraction errors.

This is a highly specialized domain. You must prioritise dance terminology over common English interpretations.

The class may include:
- Latin dances: Cha Cha, Samba, Rumba, Paso Doble, Jive
- Ballroom dances: Waltz, Tango, Viennese Waltz, Foxtrot, Quickstep

You must accurately transcribe:
- Step names (e.g. New York, Alemana, Fan, Natural Turn, Reverse Turn)
- Technique terms (e.g. Cuban motion, contra body movement, CBM, CBMP, frame, connection)
- Alignment terms (e.g. line of dance, diagonal wall, centre, wall)
- Teacher shorthand and abbreviations
- Rhythm and timing counts (e.g. one, two, three, cha-cha-cha, quick quick slow)

Important rules:
1. Always produce a verbatim transcript. Do not summarise, interpret, or rewrite.
2. Do not replace unfamiliar dance words with more common English words.
3. If a word sounds unusual but fits dance terminology, keep it exactly as spoken.
4. Preserve all repetition, corrections, restarts, and filler words when they affect meaning.
5. Preserve timing counts exactly as spoken, including repeated counts.
6. When the teacher speaks while demonstrating, still transcribe the spoken content as normal.
7. Do not normalise shorthand. If the teacher says "Alemana into fan", keep it exactly like that.

Step sequence formatting:
When a teacher lists multiple steps in sequence, keep them in the same order and separate them with commas or line breaks to make sequences clearly readable.

Example:
New York, spot turn, shoulder to shoulder, Alemana

If there is uncertainty between:
- a common English word
- and a known DanceSport term

You must prefer the DanceSport term.

Never autocorrect technical dance vocabulary into more common words.`;

// ~14 MB/hour audio — mono 16kHz/32kbps keeps files small for upload
function getCoachRecordingOptions() {
  const base = Audio.RecordingOptionsPresets.HIGH_QUALITY;
  return {
    ...base,
    android: { ...base.android, numberOfChannels: 1, bitRate: 32000, sampleRate: 16000 },
    ios: { ...base.ios, numberOfChannels: 1, bitRate: 32000, sampleRate: 16000 },
  };
}

function fmtTs(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

// Format utterances as `[MM:SS - MM:SS] Speaker X: text` blocks
function formatUtterances(utterances) {
  if (!Array.isArray(utterances) || utterances.length === 0) return '';
  return utterances
    .map((u) => `[${fmtTs(u.start / 1000)} - ${fmtTs(u.end / 1000)}] Speaker ${u.speaker}: ${String(u.text || '').trim()}`)
    .join('\n\n');
}

async function transcribeAudio(uri) {
  if (!ASSEMBLYAI_API_KEY) throw new Error('NO_ASSEMBLYAI_KEY');

  // 1. Upload audio file as raw binary (FileSystem.uploadAsync handles file:// URIs natively)
  const upResult = await FileSystem.uploadAsync('https://api.assemblyai.com/v2/upload', uri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      authorization: ASSEMBLYAI_API_KEY,
      'content-type': 'application/octet-stream',
    },
  });
  if (upResult.status !== 200) {
    throw new Error(`AssemblyAI upload ${upResult.status}: ${upResult.body?.slice(0, 200) || ''}`);
  }
  const { upload_url } = JSON.parse(upResult.body);

  // 2. Create transcript job with DanceSport keyterms biasing
  const createRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      authorization: ASSEMBLYAI_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: upload_url,
      speech_models: ['universal-3-pro'],
      prompt: DANCE_PROMPT,
      speaker_labels: true,
      punctuate: true,
      format_text: true,
    }),
  });
  if (!createRes.ok) throw new Error(`AssemblyAI create ${createRes.status}: ${await createRes.text().catch(() => '')}`);
  const { id: jobId } = await createRes.json();

  // 3. Poll until completed (max ~10 min)
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${jobId}`, {
      headers: { authorization: ASSEMBLYAI_API_KEY },
    });
    if (!pollRes.ok) throw new Error(`AssemblyAI poll ${pollRes.status}`);
    const job = await pollRes.json();
    if (job.status === 'completed') {
      const formatted = formatUtterances(job.utterances);
      return formatted || job.text || '';
    }
    if (job.status === 'error') throw new Error(`AssemblyAI: ${job.error || 'unknown error'}`);
  }
  throw new Error('AssemblyAI transcription timed out');
}

// ── Palette ────────────────────────────────────────────────────────────────
const C = {
  bg: '#FAFAFA',
  surface: '#F0F0F0',
  card: '#FFFFFF',
  dark: '#141414',
  orange: '#E8A838',
  green: '#4AAF52',
  red: '#D44545',
  gray: '#999',
  lightGray: '#E5E5E5',
  text: '#0E0E0E',
};

const FEELING_EMOJI = { Hard: '😤', Struggled: '😰', Okay: '😐', Good: '🙂', Great: '🔥' };

// ── Helpers ────────────────────────────────────────────────────────────────
function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();
}

function relativeShort(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const days = Math.floor((now - d) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function gaugeColor(v) {
  return v > 70 ? C.green : v >= 40 ? C.orange : C.red;
}

// ── Mini gauge ─────────────────────────────────────────────────────────────
function MiniGauge({ value, label }) {
  const size = 50;
  const r = 20;
  const sw = 3.5;
  const circumference = 2 * Math.PI * r;
  const arc = circumference * 0.75;
  const offset = arc * (1 - (value || 0) / 100);
  const color = gaugeColor(value);

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.1)"
            strokeWidth={sw} strokeDasharray={`${arc} ${circumference}`} strokeLinecap="round"
            transform={`rotate(135 ${size / 2} ${size / 2})`} />
          <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color}
            strokeWidth={sw} strokeDasharray={`${arc} ${circumference}`} strokeDashoffset={offset}
            strokeLinecap="round" transform={`rotate(135 ${size / 2} ${size / 2})`} />
        </Svg>
        <View style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={g.gaugeVal}>{value || 0}%</Text>
        </View>
      </View>
      <Text style={g.gaugeLabel}>{label}</Text>
    </View>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ── Main Component ─────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════
export default function StartClassScreen({ navigation }) {
  const { students } = useCoachData();

  const [view, setView] = useState('select');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Audio device picker modal + running class state
  const [audioModalOpen, setAudioModalOpen] = useState(false);
  const [classStartedAt, setClassStartedAt] = useState(null);
  const [chronoMs, setChronoMs] = useState(0);

  // Microphone recording
  const recordingRef = useRef(null);
  const [recordingUri, setRecordingUri] = useState(null);
  const [micPermGranted, setMicPermGranted] = useState(null);
  const [classRecorded, setClassRecorded] = useState(false);

  // End-of-class debrief modal
  const [debriefOpen, setDebriefOpen] = useState(false);
  const [debriefDurationMs, setDebriefDurationMs] = useState(0);
  const [debriefNote, setDebriefNote] = useState('');
  const [validatedFpIds, setValidatedFpIds] = useState([]);

  useEffect(() => {
    if (!classStartedAt) return;
    const id = setInterval(() => {
      setChronoMs(Date.now() - classStartedAt);
    }, 500);
    return () => clearInterval(id);
  }, [classStartedAt]);

  // On first mount, restore a class that was started before the coach
  // navigated away. We need to land on the right briefing view and, for
  // private classes, re-fetch the student detail so the hero stats and
  // focus point lists render correctly.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    const active = getActiveCoachClass();
    if (!active) return;
    restoredRef.current = true;
    setClassStartedAt(active.startedAt);
    setChronoMs(Date.now() - active.startedAt);
    if (active.kind === 'private' && active.studentId) {
      const match = students.find((s) => s.id === active.studentId);
      if (match) {
        // Reuse the existing loader so detail data is consistent with a
        // fresh pick (focus points, questions, last class).
        loadStudentDetail(match);
      } else {
        // Fallback: at least land on the briefing view with what we have.
        setSelectedStudent({
          id: active.studentId,
          name: active.studentName,
          global: 0,
          status: 'on_track',
        });
        setView('private-briefing');
      }
    } else if (active.kind === 'group') {
      loadGroupData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students]);

  async function openAudioModal() {
    const { granted } = await Audio.requestPermissionsAsync();
    setMicPermGranted(granted);
    setAudioModalOpen(true);
  }
  async function startClassNow() {
    setAudioModalOpen(false);
    setRecordingUri(null);

    // Start recording if permission was granted
    if (micPermGranted) {
      try {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording } = await Audio.Recording.createAsync(getCoachRecordingOptions());
        recordingRef.current = recording;
      } catch (err) {
        console.warn('[StartClass] Could not start recording:', err);
      }
    }

    const now = Date.now();
    setClassStartedAt(now);
    setChronoMs(0);
    setActiveCoachClass({
      kind: view === 'private-briefing' ? 'private' : 'group',
      startedAt: now,
      studentId: selectedStudent?.id ?? null,
      studentName: selectedStudent?.name ?? null,
    });
  }
  async function stopClass() {
    // Stop recording and keep the URI for transcription in finishDebrief
    if (recordingRef.current) {
      try {
        await recordingRef.current.stopAndUnloadAsync();
        const uri = recordingRef.current.getURI();
        setRecordingUri(uri);
      } catch (err) {
        console.warn('[StartClass] Could not stop recording:', err);
      }
      recordingRef.current = null;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    }

    setDebriefDurationMs(chronoMs);
    setDebriefNote('');
    setValidatedFpIds([]);
    setClassStartedAt(null);
    setChronoMs(0);
    setDebriefOpen(true);
  }
  function toggleValidateFp(id) {
    setValidatedFpIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }
  function transcribeAndSubmit(uri, isPrivate, studentId, allStudents) {
    const run = async () => {
      try {
        // Capture user.id BEFORE transcription — a long upload/poll can outlive the session
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not signed in — cannot save transcript.');
        const userId = user.id;

        const transcript = await transcribeAudio(uri);
        if (!transcript?.trim()) return;
        const { data: classInput, error: insertErr } = await supabase
          .from('class_inputs')
          .insert({
            user_id: userId,
            transcript,
            lesson_type: isPrivate ? 'private' : 'group',
            student_id: isPrivate ? (studentId ?? null) : null,
            status: 'pending',
          })
          .select('id')
          .single();
        if (insertErr) throw insertErr;
        if (!isPrivate && classInput?.id && allStudents.length > 0) {
          await supabase.from('class_input_students').insert(
            allStudents.map((s) => ({ class_input_id: classInput.id, student_id: s.id }))
          );
        }
      } catch (err) {
        console.warn('[StartClass] Background transcription failed:', err);
        Alert.alert('Transcription failed', String(err?.message || err));
      }
    };
    run();
  }

  function finishDebrief() {
    const uri = recordingUri;
    const isPrivate = view === 'private-briefing';
    setDebriefOpen(false);
    setRecordingUri(null);
    clearActiveCoachClass();

    if (uri) {
      transcribeAndSubmit(uri, isPrivate, selectedStudent?.id, students);
      setClassRecorded(true);
      setTimeout(() => {
        setClassRecorded(false);
        navigation.popToTop();
      }, 2500);
    } else {
      navigation.popToTop();
    }
  }

  // Detail data loaded when student is picked
  const [focusPoints, setFocusPoints] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [lastClass, setLastClass] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Group data
  const [groupFPs, setGroupFPs] = useState([]);
  const [groupStats, setGroupStats] = useState({ avgSessions: 0, totalQuestions: 0 });
  const [attentionStudents, setAttentionStudents] = useState([]);
  const [groupLoading, setGroupLoading] = useState(false);

  // Load student detail when picked
  const loadStudentDetail = useCallback(async (student) => {
    setSelectedStudent(student);
    setDetailLoading(true);
    setView('private-briefing');
    try {
      const [fps, qs, activity] = await Promise.all([
        getStudentFocusPoints(student.id).catch(() => []),
        getStudentQuestions(student.id).catch(() => []),
        getStudentRecentActivity(student.id, 40).catch(() => []),
      ]);
      setFocusPoints(fps || []);
      setQuestions(qs || []);

      // Find most recent class logged with THIS coach (has a summary)
      const lastCls = (activity || []).find(
        (ev) => ev.type === 'class' && ev.withCurrentCoach && ev.classSummary
      );
      if (lastCls) {
        const clsTime = new Date(lastCls.date).getTime();
        const trainCounts = {};
        for (const ev of activity || []) {
          if (ev.type === 'training' && ev.focusPointId && new Date(ev.date).getTime() > clsTime) {
            trainCounts[ev.focusPointId] = (trainCounts[ev.focusPointId] || 0) + 1;
          }
        }
        setLastClass({
          ...lastCls,
          focusPoints: (lastCls.focusPoints || []).slice(0, 3).map((fp) => ({
            ...fp,
            trainedCount: trainCounts[fp.id] || 0,
          })),
        });
      } else {
        setLastClass(null);
      }
    } catch {}
    setDetailLoading(false);
  }, []);

  // Load group focus data
  const loadGroupData = useCallback(async () => {
    setGroupLoading(true);
    setView('group-briefing');
    try {
      const [allFPs, allQs] = await Promise.all([
        Promise.all(
          students.map(async (s) => {
            const fps = await getStudentFocusPoints(s.id).catch(() => []);
            return fps.map(fp => ({ ...fp, studentId: s.id, studentName: s.name }));
          })
        ),
        Promise.all(
          students.map((s) => getStudentQuestions(s.id).catch(() => []))
        ),
      ]);

      // Aggregate by focus name. `assigned` = students who have this FP;
      // `practiced` = students who practiced it this week (weekCount > 0).
      const map = {};
      let totalSessions = 0;
      for (const fps of allFPs) {
        for (const fp of fps) {
          totalSessions += fp.weekCount || 0;
          if (!map[fp.name]) {
            map[fp.name] = { name: fp.name, assigned: 0, practiced: 0, pastCandidateCount: 0 };
          }
          map[fp.name].assigned += 1;
          if ((fp.weekCount || 0) > 0) map[fp.name].practiced += 1;
          if (fp.status === 'past_candidate') map[fp.name].pastCandidateCount += 1;
        }
      }
      const sorted = Object.values(map).sort(
        (a, b) => b.practiced - a.practiced || b.assigned - a.assigned
      );
      setGroupFPs(sorted);

      const totalStudents = students.length || 1;
      const avgSessions = Math.round(totalSessions / totalStudents);
      const totalQuestions = allQs.reduce((a, qs) => a + (qs?.length || 0), 0);
      setGroupStats({ avgSessions, totalQuestions });

      // Students needing attention — sorted: silent first, then attention
      const att = students
        .filter((s) => s.status !== 'on_track')
        .map((s) => {
          const isSilent = s.status === 'silent';
          const days = s.daysSincePractice;
          let reason = '';
          if (isSilent) {
            reason = days != null ? `No sessions in ${days}d` : 'No sessions yet';
          } else {
            reason = 'Only 1 focus practiced';
          }
          return {
            id: s.id,
            name: s.name,
            photoUrl: s.photoUrl,
            reason,
            severity: isSilent ? 'high' : 'watch',
          };
        })
        .sort((a, b) => (a.severity === 'high' ? -1 : 1));
      setAttentionStudents(att);
    } catch {}
    setGroupLoading(false);
  }, [students]);

  // Collapsing hero for private/group briefing views
  const HERO_FULL = 236;
  const HERO_COLLAPSED = 92;
  const pbScrollY = useRef(new Animated.Value(0)).current;
  const heroAnimHeight = pbScrollY.interpolate({
    inputRange: [0, HERO_FULL - HERO_COLLAPSED],
    outputRange: [HERO_FULL, HERO_COLLAPSED],
    extrapolate: 'clamp',
  });
  const heroDetailsOpacity = pbScrollY.interpolate({
    inputRange: [0, 60],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const gbScrollY = useRef(new Animated.Value(0)).current;
  const gbHeroHeight = gbScrollY.interpolate({
    inputRange: [0, HERO_FULL - HERO_COLLAPSED],
    outputRange: [HERO_FULL, HERO_COLLAPSED],
    extrapolate: 'clamp',
  });
  const gbDetailsOpacity = gbScrollY.interpolate({
    inputRange: [0, 60],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  function formatChrono(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(sec).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  async function handleOpenRoutePicker() {
    try {
      await presentAudioRoutePicker();
    } catch (e) {
      console.warn('[StartClass] Route picker unavailable:', e);
    }
  }

  function renderBottomBar() {
    if (classStartedAt) {
      return (
        <View style={s.bottomBar}>
          <View style={s.runningRow}>
            <View style={s.runningDot} />
            <Text style={s.runningTime}>{formatChrono(chronoMs)}</Text>
            <TouchableOpacity
              style={s.stopBtn}
              activeOpacity={0.88}
              onPress={stopClass}
            >
              <Ionicons name="stop" size={14} color="#fff" />
              <Text style={s.stopBtnText}>Stop</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    return (
      <View style={s.bottomBar}>
        <TouchableOpacity
          style={s.startBtn}
          activeOpacity={0.88}
          onPress={openAudioModal}
        >
          <Text style={s.startBtnText}>Start</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderDebriefModal() {
    // Only past_candidate focus points need coach validation at class end.
    const list =
      view === 'private-briefing'
        ? focusPoints
            .filter((fp) => fp.status === 'past_candidate')
            .map((fp) => ({
              id: fp.id,
              name: fp.name,
              weekCount: fp.weekCount || 0,
            }))
        : groupFPs
            .filter((fp) => (fp.pastCandidateCount || 0) > 0)
            .map((fp) => ({
              id: fp.name,
              name: fp.name,
              weekCount: fp.practiced || 0,
            }));

    const totalMin = Math.max(1, Math.round(debriefDurationMs / 60000));
    const validatedCount = validatedFpIds.length;

    return (
      <Modal
        visible={debriefOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setDebriefOpen(false)}
      >
        <Pressable style={db.overlay} onPress={() => setDebriefOpen(false)}>
          <Pressable style={db.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={db.handle} />
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 8 }}
            >
            <View style={db.header}>
              <View style={db.headerIcon}>
                <Ionicons name="checkmark" size={22} color={C.green} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={db.headerTitle}>Class ended</Text>
                <Text style={db.headerSub}>Wrap up with a quick debrief</Text>
              </View>
            </View>

            <View style={db.durationBar}>
              <Ionicons name="time-outline" size={16} color={C.text} />
              <Text style={db.durationText}>
                Duration{' '}
                <Text style={db.durationDim}>
                  · {totalMin} min
                  {list.length > 0 ? ` · ${validatedCount}/${list.length} focus validated` : ''}
                </Text>
              </Text>
            </View>

            <Text style={db.secLabel}>Class note</Text>
            <View style={db.noteArea}>
              <TextInput
                style={db.noteInput}
                placeholder="What did you cover? Any breakthroughs or blockers?"
                placeholderTextColor="#CCC"
                value={debriefNote}
                onChangeText={setDebriefNote}
                multiline
                textAlignVertical="top"
              />
              <Text style={db.noteHint}>Optional — visible to the student after the class.</Text>
            </View>

            {list.length > 0 && (
              <>
                <Text style={db.secLabel}>Validate focus points covered</Text>
                <View style={db.fpList}>
                  {list.map((fp) => {
                    const selected = validatedFpIds.includes(fp.id);
                    return (
                      <TouchableOpacity
                        key={fp.id}
                        style={[db.fpItem, selected && db.fpItemSelected]}
                        activeOpacity={0.75}
                        onPress={() => toggleValidateFp(fp.id)}
                      >
                        <View style={[db.fpCheck, selected && db.fpCheckSelected]}>
                          {selected && <Ionicons name="checkmark" size={14} color="#fff" />}
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text
                            style={[db.fpName, selected && { color: C.green }]}
                            numberOfLines={1}
                          >
                            {fp.name}
                          </Text>
                          <Text style={db.fpMeta}>
                            {fp.weekCount > 0
                              ? `${fp.weekCount}x practiced this week`
                              : 'No practice this week'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {recordingUri && (
              <View style={db.recBanner}>
                <Ionicons name="mic" size={14} color={C.orange} />
                <Text style={db.recBannerText}>Recording ready — will be transcribed on Done</Text>
              </View>
            )}

            <View style={db.actions}>
              <TouchableOpacity style={db.btnDone} activeOpacity={0.88} onPress={finishDebrief}>
                <Text style={db.btnDoneText}>Done</Text>
              </TouchableOpacity>
              <TouchableOpacity style={db.btnLater} onPress={finishDebrief} activeOpacity={0.6}>
                <Text style={db.btnLaterText}>Save for later</Text>
              </TouchableOpacity>
            </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  function renderAudioModal() {
    return (
      <Modal
        visible={audioModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAudioModalOpen(false)}
      >
        <Pressable style={ad.overlay} onPress={() => setAudioModalOpen(false)}>
          <Pressable style={ad.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={ad.handle} />
            <View style={ad.iconWrap}>
              <Ionicons name="mic" size={24} color={micPermGranted === false ? C.red : C.orange} />
            </View>
            <Text style={ad.title}>Ready to record</Text>
            <Text style={ad.subtitle}>
              {micPermGranted === false
                ? 'Microphone access denied — enable it in Settings to record classes.'
                : 'The class will be recorded and transcribed automatically.'}
            </Text>

            <TouchableOpacity
              style={ad.routeBtn}
              activeOpacity={0.75}
              onPress={handleOpenRoutePicker}
            >
              <View style={ad.routeBtnIcon}>
                <Ionicons name="bluetooth" size={18} color={C.orange} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={ad.routeBtnLabel}>Audio output</Text>
                <Text style={ad.routeBtnSub}>AirPods, Bluetooth speaker…</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={C.gray} />
            </TouchableOpacity>

            <View style={ad.actions}>
              <TouchableOpacity style={ad.btnStart} activeOpacity={0.88} onPress={startClassNow}>
                <Text style={ad.btnStartText}>Start class</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return students;
    return students.filter(s => (s.name || '').toLowerCase().includes(q));
  }, [students, searchQuery]);

  // ── CLASS RECORDED SUCCESS SCREEN ─────────────────────────────────────
  if (classRecorded) {
    return (
      <SafeAreaView style={[s.safe, { alignItems: 'center', justifyContent: 'center' }]} edges={['top']}>
        <View style={cr.wrap}>
          <View style={cr.iconWrap}>
            <Ionicons name="mic" size={32} color={C.orange} />
          </View>
          <Text style={cr.title}>Class recorded</Text>
          <Text style={cr.sub}>
            We're processing the transcript in the background.{'\n'}
            You'll get a notification when the focus points are ready to review.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── VIEW 1: Select class type ──────────────────────────────────────────
  if (view === 'select') {
    const needAttention = students.filter((st) => st.status !== 'on_track').length;
    const onTrack = students.filter((st) => st.status === 'on_track').length;
    const totalStudents = students.length;

    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <ScrollView contentContainerStyle={s.selectScroll} showsVerticalScrollIndicator={false}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.selectBack} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={20} color={C.text} />
          </TouchableOpacity>

          <Text style={s.selectLabel}>PRIVATE OR GROUP</Text>
          <Text style={s.selectHeading}>Start a class</Text>

          {/* Private lesson card */}
          <TouchableOpacity
            style={s.selectPrivate}
            activeOpacity={0.9}
            onPress={() => setView('student-pick')}
          >
            <View style={s.selectIconRow}>
              <View style={s.selectIconDark}>
                <Ionicons name="person" size={22} color="#fff" />
              </View>
              <View style={s.selectArrowDark}>
                <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.55)" />
              </View>
            </View>
            <Text style={s.selectPrivateTitle}>Private lesson</Text>
            <Text style={s.selectPrivateSub}>One-on-one with personalized briefing</Text>
            <View style={s.selectContextBar}>
              <View style={s.selectTagDark}>
                <View style={[s.selectDot, { backgroundColor: C.red }]} />
                <Text style={s.selectTagDarkText}>
                  <Text style={s.selectTagStrongDark}>{needAttention}</Text> need attention
                </Text>
              </View>
              <View style={s.selectTagDark}>
                <View style={[s.selectDot, { backgroundColor: C.green }]} />
                <Text style={s.selectTagDarkText}>
                  <Text style={s.selectTagStrongDark}>{onTrack}</Text> on track
                </Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* Group class card */}
          <TouchableOpacity
            style={s.selectGroup}
            activeOpacity={0.9}
            onPress={loadGroupData}
          >
            <View style={s.selectIconRow}>
              <View style={s.selectIconLight}>
                <Ionicons name="people" size={22} color={C.text} />
              </View>
              <View style={s.selectArrowLight}>
                <Ionicons name="chevron-forward" size={18} color={C.gray} />
              </View>
            </View>
            <Text style={s.selectGroupTitle}>Group class</Text>
            <Text style={s.selectGroupSub}>Shared focus points across your squad</Text>
            <View style={s.selectContextBar}>
              <View style={s.selectTagLight}>
                <Ionicons name="people" size={11} color={C.gray} />
                <Text style={s.selectTagLightText}>
                  <Text style={s.selectTagStrongLight}>{totalStudents}</Text> students
                </Text>
              </View>
              <View style={s.selectTagLight}>
                <View style={[s.selectDot, { backgroundColor: C.orange }]} />
                <Text style={s.selectTagLightText}>Shared focuses</Text>
              </View>
            </View>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── VIEW 2: Student picker ─────────────────────────────────────────────
  if (view === 'student-pick') {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => setView('select')} style={s.backBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={22} color={C.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerLabel}>PRIVATE LESSON</Text>
            <Text style={s.headerTitle}>Select student</Text>
          </View>
        </View>

        {/* Search */}
        <View style={s.searchWrap}>
          <Ionicons name="search" size={18} color={C.gray} />
          <TextInput
            style={s.searchInput}
            placeholder="Search students..."
            placeholderTextColor={C.gray}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: Spacing.side, paddingBottom: 40 }}>
          {filteredStudents.map((st) => {
            const stuckCount = st.activeFocuses - st.fpSincePrivate;
            return (
              <TouchableOpacity
                key={st.id}
                style={s.studentRow}
                activeOpacity={0.7}
                onPress={() => loadStudentDetail(st)}
              >
                <View style={s.studentAvatar}>
                  <Text style={s.studentAvatarText}>{initials(st.name)}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.studentName}>{st.name}</Text>
                  <Text style={s.studentMeta}>{st.danceStyle || 'Dance'}{st.daysSincePractice != null ? ` · ${st.daysSincePractice}d ago` : ''}</Text>
                </View>
                {st.status === 'silent' && (
                  <View style={s.stuckBadge}>
                    <Text style={s.stuckBadgeText}>Silent</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={16} color={C.gray} />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── VIEW 3: Private briefing ───────────────────────────────────────────
  if (view === 'private-briefing' && selectedStudent) {
    const st = selectedStudent;
    const stuckPoints = focusPoints.filter(fp => fp.weekCount === 0);
    const trainedPoints = focusPoints.filter(fp => (fp.weekCount || 0) > 0);
    const sessionsCount = focusPoints.reduce((a, fp) => a + (fp.weekCount || 0), 0);
    const focusTrained = trainedPoints.length;
    const alertLabel = st.status === 'silent'
      ? 'No practice since last class'
      : st.status === 'attention'
      ? 'Watch engagement'
      : 'On track';
    const alertColor = st.status === 'silent' ? C.red : st.status === 'attention' ? C.orange : C.green;
    const seenLabel = st.daysSincePractice == null
      ? '—'
      : st.daysSincePractice === 0
      ? 'Seen today'
      : st.daysSincePractice === 1
      ? 'Seen yesterday'
      : `Seen ${st.daysSincePractice}d ago`;

    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={{ flex: 1 }}>
        <Animated.ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: HERO_FULL + 76, paddingBottom: 120 }}
          scrollEventThrottle={16}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: pbScrollY } } }],
            { useNativeDriver: false }
          )}
        >
          {/* AI Debrief */}
          {(trainedPoints.length > 0 || stuckPoints.length > 0) && (
            <View style={pb.debriefWrap}>
              <View style={pb.debriefEyebrow}>
                <View style={pb.debriefEyebrowIcon}>
                  <Ionicons name="flash" size={10} color={C.orange} />
                </View>
                <Text style={pb.debriefEyebrowText}>AI Debrief</Text>
              </View>
              <Text style={pb.debriefBody}>
                {focusTrained > 0 ? (
                  <Text>
                    {st.name.split(' ')[0]} completed{' '}
                    <Text style={pb.debriefStrong}>{sessionsCount} solo session{sessionsCount > 1 ? 's' : ''}</Text>
                    {' '}and practiced {focusTrained} of {focusPoints.length} assigned focus points.
                  </Text>
                ) : (
                  <Text>No focus points practiced since the last class. </Text>
                )}
                {stuckPoints.length > 0 && (
                  <Text>
                    {' '}
                    <Text style={pb.debriefEm}>"{stuckPoints[0].name}"</Text> has had zero practice despite being flagged.
                  </Text>
                )}
              </Text>
              {stuckPoints.length > 0 && (
                <View style={pb.reco}>
                  <View style={pb.recoBar} />
                  <View style={{ flex: 1 }}>
                    <Text style={pb.recoLabel}>Recommendation</Text>
                    <Text style={pb.recoText}>
                      Re-approach "{stuckPoints[0].name}" with a new drill — current approach isn't landing.
                    </Text>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Last class with you */}
          {lastClass && (
            <View style={pb.recapCard}>
              <View style={pb.recapHeader}>
                <View style={pb.recapBadge}>
                  <Text style={pb.recapBadgeText}>LAST CLASS WITH YOU</Text>
                </View>
                <Text style={pb.recapDate}>{relativeShort(lastClass.date)}</Text>
              </View>
              <Text style={pb.recapTitle}>
                {lastClass.title || lastClass.dance || 'Private lesson'}
              </Text>
              {!!lastClass.classSummary && (
                <Text style={pb.recapSummary}>{lastClass.classSummary}</Text>
              )}
              {lastClass.focusPoints && lastClass.focusPoints.length > 0 && (
                <View style={pb.recapFPs}>
                  <Text style={pb.recapFPLabel}>Focus points</Text>
                  {lastClass.focusPoints.map((fp, i) => (
                    <View key={fp.id || i} style={pb.recapFPRow}>
                      <View
                        style={[
                          pb.recapFPDot,
                          { backgroundColor: fp.trainedCount > 0 ? C.green : C.red },
                        ]}
                      />
                      <Text style={pb.recapFPName} numberOfLines={1}>{fp.name}</Text>
                      <View
                        style={[
                          pb.recapFPCount,
                          {
                            backgroundColor:
                              fp.trainedCount > 0 ? 'rgba(74,175,82,0.08)' : 'rgba(212,69,69,0.08)',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            pb.recapFPCountText,
                            { color: fp.trainedCount > 0 ? C.green : C.red },
                          ]}
                        >
                          {fp.trainedCount}x
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Questions */}
          {questions.length > 0 && (
            <>
              <Text style={pb.secLabel}>Student questions</Text>
              <View style={pb.questionsWrap}>
                {questions.map((q, i) => (
                  <View key={q.id} style={[pb.qRow, i > 0 && pb.qRowBorder]}>
                    <Text style={pb.qNum}>{String(i + 1).padStart(2, '0')}</Text>
                    <Text style={pb.qText}>{q.message}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Focus points trained */}
          {trainedPoints.length > 0 && (
            <>
              <Text style={pb.secLabel}>Focus points trained this week</Text>
              <View style={pb.focusWrap}>
                {trainedPoints.map((fp) => {
                  const metaParts = [];
                  if (fp.totalDurationMin > 0) metaParts.push(`${fp.totalDurationMin} min`);
                  if (fp.weekCount > 1) metaParts.push(`${fp.weekCount} sessions`);
                  return (
                    <View key={fp.id} style={pb.fpRow}>
                      <View style={pb.fpStatus}>
                        <Ionicons name="checkmark" size={14} color={C.green} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={pb.fpName} numberOfLines={1}>{fp.name}</Text>
                        {metaParts.length > 0 && (
                          <Text style={pb.fpMeta}>{metaParts.join(' · ')}</Text>
                        )}
                      </View>
                      {!!fp.lastFeeling && (
                        <Text style={pb.fpFeeling}>
                          {FEELING_EMOJI[fp.lastFeeling] || fp.lastFeeling}
                        </Text>
                      )}
                      <View style={pb.fpBadge}>
                        <Text style={pb.fpBadgeText}>{fp.weekCount}x</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          {/* Stuck focus points */}
          {stuckPoints.length > 0 && (
            <>
              <Text style={pb.secLabel}>Not practiced</Text>
              <View style={pb.focusWrap}>
                {stuckPoints.map((fp) => (
                  <View key={fp.id} style={pb.fpRow}>
                    <View style={[pb.fpStatus, { backgroundColor: 'rgba(212,69,69,0.08)' }]}>
                      <Ionicons name="alert" size={14} color={C.red} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={pb.fpName} numberOfLines={1}>{fp.name}</Text>
                      <Text style={pb.fpMeta}>No practice this week</Text>
                    </View>
                    <View style={[pb.fpBadge, { backgroundColor: 'rgba(212,69,69,0.08)' }]}>
                      <Text style={[pb.fpBadgeText, { color: C.red }]}>0x</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}
        </Animated.ScrollView>

        {/* Backdrop masking content as it scrolls up behind the hero */}
        <Animated.View
          pointerEvents="none"
          style={[
            pb.stickyBackdrop,
            { height: Animated.add(heroAnimHeight, 70) },
          ]}
        />

        {/* Floating back arrow */}
        <TouchableOpacity
          onPress={() => { setView('student-pick'); setSearchQuery(''); }}
          style={pb.floatingBack}
          activeOpacity={0.7}
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </TouchableOpacity>

        {/* Sticky collapsing hero */}
        <Animated.View
          pointerEvents="box-none"
          style={[pb.stickyHero, { height: heroAnimHeight }]}
        >
          <View style={pb.heroTop}>
            <View style={pb.heroAvatarWrap}>
              <Svg width={56} height={56} style={StyleSheet.absoluteFill}>
                <Circle cx={28} cy={28} r={25} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={3} />
                <Circle cx={28} cy={28} r={25} fill="none" stroke={C.orange}
                  strokeWidth={3}
                  strokeDasharray={`${2 * Math.PI * 25 * ((st.global || 0) / 100)} ${2 * Math.PI * 25}`}
                  strokeLinecap="round" transform="rotate(-90 28 28)" />
              </Svg>
              <View style={pb.heroAvatarInner}>
                <Text style={pb.heroAvatarText}>{initials(st.name)[0]}</Text>
              </View>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={pb.heroName} numberOfLines={1}>{st.name}</Text>
              <Text style={pb.heroSub}>
                Trained <Text style={pb.heroSubStrong}>{sessionsCount}x</Text> since last private lesson
              </Text>
            </View>
          </View>

          <Animated.View style={{ opacity: heroDetailsOpacity }} pointerEvents="none">
            <View style={pb.statsRow}>
              <View style={pb.stat}>
                <Text style={pb.statVal}>{sessionsCount}</Text>
                <Text style={pb.statLabel}>Sessions</Text>
              </View>
              <View style={pb.statDivider} />
              <View style={pb.stat}>
                <Text style={pb.statVal}>{focusTrained}</Text>
                <Text style={pb.statLabel}>Focus trained</Text>
              </View>
              <View style={pb.statDivider} />
              <View style={pb.stat}>
                <Text style={pb.statVal}>{questions.length}</Text>
                <Text style={pb.statLabel}>Questions</Text>
              </View>
            </View>

            <View style={pb.alert}>
              <View style={[pb.alertDot, { backgroundColor: alertColor }]} />
              <Text style={pb.alertText}>{alertLabel}</Text>
              <Text style={pb.alertTime}>{seenLabel}</Text>
            </View>
          </Animated.View>
        </Animated.View>
        </View>

        {renderBottomBar()}
        {renderAudioModal()}
        {renderDebriefModal()}
      </SafeAreaView>
    );
  }

  // ── VIEW 4: Group briefing ─────────────────────────────────────────────
  if (view === 'group-briefing') {
    const totalStudents = students.length;
    const topFocus = groupFPs[0] || null;
    const underPracticed = [...groupFPs]
      .sort((a, b) => a.practiced - b.practiced)[0];
    const firstTwoAvatars = students.slice(0, 2);
    const remaining = Math.max(0, totalStudents - 2);

    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={{ flex: 1 }}>
          <Animated.ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingTop: HERO_FULL + 76, paddingBottom: 120 }}
            scrollEventThrottle={16}
            onScroll={Animated.event(
              [{ nativeEvent: { contentOffset: { y: gbScrollY } } }],
              { useNativeDriver: false }
            )}
          >
            {/* AI Group Debrief */}
            {groupFPs.length > 0 && (
              <View style={pb.debriefWrap}>
                <View style={pb.debriefEyebrow}>
                  <View style={pb.debriefEyebrowIcon}>
                    <Ionicons name="flash" size={10} color={C.orange} />
                  </View>
                  <Text style={pb.debriefEyebrowText}>AI Group Debrief</Text>
                </View>
                <Text style={pb.debriefBody}>
                  The group logged{' '}
                  <Text style={pb.debriefStrong}>
                    {groupStats.avgSessions * Math.max(1, totalStudents)} sessions
                  </Text>{' '}
                  collectively this week.
                  {topFocus && (
                    <>
                      {' '}
                      <Text style={pb.debriefStrong}>{topFocus.name}</Text> was the most
                      practiced focus ({topFocus.practiced} of {totalStudents} students).
                    </>
                  )}
                  {underPracticed && underPracticed !== topFocus && underPracticed.practiced < totalStudents / 2 && (
                    <>
                      {' '}
                      <Text style={pb.debriefEm}>"{underPracticed.name}"</Text> was only worked on by {underPracticed.practiced} — it might need a group drill.
                    </>
                  )}
                </Text>
                {underPracticed && underPracticed.practiced < totalStudents / 2 && (
                  <View style={pb.reco}>
                    <View style={pb.recoBar} />
                    <View style={{ flex: 1 }}>
                      <Text style={pb.recoLabel}>Recommendation</Text>
                      <Text style={pb.recoText}>
                        Open with a group {underPracticed.name} exercise — most students skipped it in solo practice.
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            )}

            {/* Most common focus points */}
            {groupFPs.length > 0 && (
              <>
                <Text style={pb.secLabel}>Most common focus points</Text>
                <View style={pb.focusWrap}>
                  {groupFPs.slice(0, 6).map((fp, i) => {
                    const ratio = totalStudents > 0 ? fp.practiced / totalStudents : 0;
                    const barColor =
                      ratio >= 0.6 ? C.green : ratio >= 0.4 ? C.orange : C.red;
                    return (
                      <View key={fp.name} style={gb.fpItem}>
                        <Text style={gb.fpRank}>{i + 1}</Text>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={gb.fpName} numberOfLines={1}>{fp.name}</Text>
                          <Text style={gb.fpStudents}>
                            {fp.practiced} of {totalStudents} student{totalStudents > 1 ? 's' : ''} practiced
                          </Text>
                          <View style={gb.fpBarTrack}>
                            <View
                              style={[
                                gb.fpBarFill,
                                { width: `${Math.max(3, ratio * 100)}%`, backgroundColor: barColor },
                              ]}
                            />
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </>
            )}

            {/* Need attention */}
            {attentionStudents.length > 0 && (
              <>
                <Text style={pb.secLabel}>Need attention</Text>
                <View style={pb.focusWrap}>
                  {attentionStudents.map((st) => {
                    const isHigh = st.severity === 'high';
                    const color = isHigh ? C.red : C.orange;
                    return (
                      <View key={st.id} style={gb.attRow}>
                        {st.photoUrl ? (
                          <Image source={{ uri: st.photoUrl }} style={gb.attAvatar} />
                        ) : (
                          <View style={[gb.attAvatar, { backgroundColor: color, alignItems: 'center', justifyContent: 'center' }]}>
                            <Text style={gb.attAvatarText}>{initials(st.name)[0]}</Text>
                          </View>
                        )}
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={gb.attName} numberOfLines={1}>{st.name}</Text>
                          <Text style={gb.attReason}>{st.reason}</Text>
                        </View>
                        <View
                          style={[
                            gb.attBadge,
                            {
                              backgroundColor: isHigh ? 'rgba(212,69,69,0.08)' : 'rgba(232,168,56,0.10)',
                            },
                          ]}
                        >
                          <Text style={[gb.attBadgeText, { color }]}>
                            {isHigh ? 'High risk' : 'Watch'}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </>
            )}
          </Animated.ScrollView>

          {/* Backdrop */}
          <Animated.View
            pointerEvents="none"
            style={[pb.stickyBackdrop, { height: Animated.add(gbHeroHeight, 70) }]}
          />

          {/* Floating back arrow */}
          <TouchableOpacity
            onPress={() => setView('select')}
            style={pb.floatingBack}
            activeOpacity={0.7}
            hitSlop={12}
          >
            <Ionicons name="chevron-back" size={22} color={C.text} />
          </TouchableOpacity>

          {/* Sticky collapsing hero */}
          <Animated.View
            pointerEvents="box-none"
            style={[pb.stickyHero, { height: gbHeroHeight }]}
          >
            <View style={pb.heroTop}>
              <View style={gb.heroAvatars}>
                {firstTwoAvatars.map((st, i) => (
                  <View
                    key={st.id}
                    style={[
                      gb.heroAv,
                      { marginLeft: i === 0 ? 0 : -10, zIndex: 3 - i },
                    ]}
                  >
                    {st.photoUrl ? (
                      <Image source={{ uri: st.photoUrl }} style={gb.heroAvImg} />
                    ) : (
                      <Text style={gb.heroAvText}>{initials(st.name)[0]}</Text>
                    )}
                  </View>
                ))}
                {remaining > 0 && (
                  <View style={[gb.heroAv, gb.heroAvMore, { marginLeft: -10, zIndex: 1 }]}>
                    <Text style={gb.heroAvText}>+{remaining}</Text>
                  </View>
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={pb.heroName} numberOfLines={1}>Group class</Text>
                <Text style={pb.heroSub}>
                  <Text style={pb.heroSubStrong}>{totalStudents}</Text> student{totalStudents > 1 ? 's' : ''} · {groupFPs.length} shared focuses
                </Text>
              </View>
            </View>

            <Animated.View style={{ opacity: gbDetailsOpacity }} pointerEvents="none">
              <View style={pb.statsRow}>
                <View style={pb.stat}>
                  <Text style={pb.statVal}>{totalStudents}</Text>
                  <Text style={pb.statLabel}>Students</Text>
                </View>
                <View style={pb.statDivider} />
                <View style={pb.stat}>
                  <Text style={pb.statVal}>{groupStats.avgSessions}</Text>
                  <Text style={pb.statLabel}>Avg sessions</Text>
                </View>
                <View style={pb.statDivider} />
                <View style={pb.stat}>
                  <Text style={pb.statVal}>{groupStats.totalQuestions}</Text>
                  <Text style={pb.statLabel}>Questions</Text>
                </View>
              </View>

              <View style={pb.alert}>
                <View
                  style={[
                    pb.alertDot,
                    { backgroundColor: attentionStudents.length > 0 ? C.red : C.green },
                  ]}
                />
                <Text style={pb.alertText}>
                  {attentionStudents.length > 0
                    ? `${attentionStudents.length} student${attentionStudents.length > 1 ? 's' : ''} need attention`
                    : 'Group on track'}
                </Text>
              </View>
            </Animated.View>
          </Animated.View>
        </View>

        {renderBottomBar()}
        {renderAudioModal()}
        {renderDebriefModal()}
      </SafeAreaView>
    );
  }

  return null;
}

// ── Private briefing styles ────────────────────────────────────────────────
const pb = StyleSheet.create({
  hero: {
    backgroundColor: '#0E0E0E',
    borderRadius: 22,
    padding: 22,
    marginHorizontal: Spacing.side,
    marginBottom: 20,
  },
  stickyBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: C.bg,
    zIndex: 5,
  },
  floatingBack: {
    position: 'absolute',
    top: 14,
    left: Spacing.side,
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 15,
  },
  stickyHero: {
    position: 'absolute',
    top: 62,
    left: Spacing.side,
    right: Spacing.side,
    backgroundColor: '#0E0E0E',
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 14,
    overflow: 'hidden',
    zIndex: 10,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 20,
  },
  heroAvatarWrap: {
    width: 56,
    height: 56,
  },
  heroAvatarInner: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(232,168,56,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAvatarText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: '#E8A838',
  },
  heroName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
    color: '#fff',
    letterSpacing: -0.3,
    marginBottom: 3,
  },
  heroSub: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
  },
  heroSubStrong: {
    fontFamily: Fonts.jakartaExtraBold,
    color: '#fff',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statVal: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 28,
    color: '#fff',
    letterSpacing: -0.5,
    lineHeight: 32,
  },
  statLabel: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.3,
    marginTop: 4,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
  },
  alertDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  alertText: {
    flex: 1,
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.75)',
  },
  alertTime: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
  },

  debriefWrap: {
    marginHorizontal: Spacing.side,
    marginBottom: 22,
  },
  debriefEyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  debriefEyebrowIcon: {
    width: 18,
    height: 18,
    borderRadius: 5,
    backgroundColor: 'rgba(232,168,56,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  debriefEyebrowText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: '#E8A838',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  debriefBody: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: '#0E0E0E',
    lineHeight: 22,
  },
  debriefStrong: {
    fontFamily: Fonts.jakartaExtraBold,
  },
  debriefEm: {
    fontFamily: Fonts.jakartaBold,
    fontStyle: 'italic',
    color: '#D44545',
  },
  reco: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
    paddingVertical: 12,
    paddingRight: 12,
  },
  recoBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: '#E8A838',
  },
  recoLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: '#E8A838',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  recoText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: '#0E0E0E',
    lineHeight: 19,
  },

  secLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: '#999',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginHorizontal: Spacing.side,
    marginBottom: 10,
    marginTop: 4,
  },
  questionsWrap: {
    marginHorizontal: Spacing.side,
    marginBottom: 22,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  qRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingTop: 10,
    paddingBottom: 10,
  },
  qRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5E5',
  },
  qNum: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
    color: '#E8A838',
    letterSpacing: 0.5,
    minWidth: 22,
    marginTop: 2,
  },
  qText: {
    flex: 1,
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13.5,
    color: '#0E0E0E',
    lineHeight: 20,
  },

  focusWrap: {
    marginHorizontal: Spacing.side,
    marginBottom: 22,
    gap: 8,
  },
  fpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  fpStatus: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: 'rgba(74,175,82,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fpName: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: '#0E0E0E',
  },
  fpMeta: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  fpBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9,
    backgroundColor: 'rgba(74,175,82,0.1)',
  },
  fpBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
    color: '#4AAF52',
  },
  fpFeeling: {
    fontSize: 18,
    marginRight: 2,
  },

  // Last class recap card
  recapCard: {
    marginHorizontal: Spacing.side,
    marginBottom: 22,
    backgroundColor: '#F0F0F0',
    borderRadius: 16,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  recapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  recapBadge: {
    backgroundColor: 'rgba(232,168,56,0.14)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  recapBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9,
    letterSpacing: 0.8,
    color: '#E8A838',
  },
  recapDate: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 10.5,
    color: '#999',
  },
  recapTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
    color: '#0E0E0E',
    letterSpacing: -0.2,
    marginBottom: 6,
  },
  recapSummary: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12.5,
    color: '#666',
    lineHeight: 19,
    marginBottom: 12,
  },
  recapFPs: {
    gap: 6,
  },
  recapFPLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: '#999',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  recapFPRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  recapFPDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  recapFPName: {
    flex: 1,
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: '#0E0E0E',
  },
  recapFPCount: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  recapFPCountText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
  },
});

// ── Group briefing styles ──────────────────────────────────────────────────
const gb = StyleSheet.create({
  heroAvatars: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 78,
  },
  heroAv: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(232,168,56,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#0E0E0E',
    overflow: 'hidden',
  },
  heroAvMore: {
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  heroAvImg: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  heroAvText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#fff',
  },
  fpItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  fpRank: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
    color: '#999',
    minWidth: 20,
    letterSpacing: -0.3,
    marginTop: 1,
  },
  fpName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#0E0E0E',
    marginBottom: 3,
  },
  fpStudents: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11.5,
    color: '#999',
    marginBottom: 8,
  },
  fpBarTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: '#F0F0F0',
    overflow: 'hidden',
  },
  fpBarFill: {
    height: 5,
    borderRadius: 3,
  },
  attRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  attAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
  },
  attAvatarText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#fff',
  },
  attName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#0E0E0E',
  },
  attReason: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11.5,
    color: '#999',
    marginTop: 2,
  },
  attBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9,
  },
  attBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
  },
});

// ── Gauge styles ───────────────────────────────────────────────────────────
const g = StyleSheet.create({
  gaugeVal: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#fff',
  },
  gaugeLabel: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 4,
  },
});

// ── Main styles ────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: Spacing.side,
    paddingTop: 12,
    paddingBottom: 16,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: C.orange,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: C.text,
    letterSpacing: -0.3,
  },

  // Select view (Start a class)
  selectScroll: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  selectBack: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  selectLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  selectHeading: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 30,
    color: C.text,
    letterSpacing: -0.5,
    lineHeight: 33,
    marginBottom: 28,
  },
  selectIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  selectContextBar: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  selectDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  // Private (dark) card
  selectPrivate: {
    backgroundColor: '#0E0E0E',
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 24,
    marginBottom: 14,
  },
  selectIconDark: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectArrowDark: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectPrivateTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: '#fff',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  selectPrivateSub: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 18,
  },
  selectTagDark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  selectTagDarkText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },
  selectTagStrongDark: {
    fontFamily: Fonts.jakartaExtraBold,
    color: '#fff',
  },

  // Group (light) card
  selectGroup: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 24,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  selectIconLight: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectArrowLight: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectGroupTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: C.text,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  selectGroupSub: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: '#999',
    marginBottom: 18,
  },
  selectTagLight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#F0F0F0',
  },
  selectTagLightText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12,
    color: '#999',
  },
  selectTagStrongLight: {
    fontFamily: Fonts.jakartaExtraBold,
    color: C.text,
  },

  // Content
  content: { paddingHorizontal: Spacing.side },
  pageTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 28,
    color: C.text,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  pageSub: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: C.gray,
    marginBottom: 32,
  },

  // Type cards
  typeCardDark: {
    backgroundColor: C.dark,
    borderRadius: 22,
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    marginBottom: 14,
  },
  typeIconDark: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeCardDarkTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: '#fff',
    letterSpacing: -0.3,
  },
  typeCardDarkSub: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 3,
    lineHeight: 18,
  },
  typeCardLight: {
    backgroundColor: C.card,
    borderRadius: 22,
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    borderWidth: 1,
    borderColor: C.lightGray,
  },
  typeIconLight: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeCardLightTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: C.text,
    letterSpacing: -0.3,
  },
  typeCardLightSub: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: C.gray,
    marginTop: 3,
    lineHeight: 18,
  },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: Spacing.side,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: C.text,
    padding: 0,
  },

  // Student list
  studentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.lightGray,
  },
  studentAvatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  studentAvatarText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: C.text,
  },
  studentName: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: C.text,
  },
  studentMeta: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: C.gray,
    marginTop: 2,
  },
  stuckBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(212,69,69,0.08)',
  },
  stuckBadgeText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: C.red,
  },

  // Hero card (dark)
  heroCard: {
    backgroundColor: C.dark,
    borderRadius: 22,
    padding: 22,
    marginHorizontal: Spacing.side,
    marginBottom: 20,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 18,
  },
  heroAvatarWrap: {
    width: 52,
    height: 52,
  },
  heroAvatarInner: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: C.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAvatarText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: '#fff',
  },
  heroName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
    color: '#fff',
    letterSpacing: -0.3,
  },
  heroStyle: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
  },
  gaugeRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  activityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 16,
  },
  activityPillText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },

  // Sections
  section: {
    paddingHorizontal: Spacing.side,
    marginBottom: 20,
  },
  sectionLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: C.gray,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },

  // Questions
  questionsCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(232,168,56,0.2)',
  },
  questionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  questionBorder: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.lightGray,
    marginTop: 12,
  },
  questionIcon: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: 'rgba(232,168,56,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  questionMark: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
    color: C.orange,
  },
  questionText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: C.text,
    lineHeight: 19,
    flex: 1,
  },

  // Focus points
  fpCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  fpDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  fpName: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: C.text,
    flex: 1,
  },
  fpMeta: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: C.gray,
    marginTop: 2,
  },
  fpBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
  },
  fpBadgeText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 12,
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankNum: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
  },

  // AI Recommendation
  aiCard: {
    backgroundColor: 'rgba(232,168,56,0.06)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(232,168,56,0.25)',
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  aiHeaderText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: C.orange,
    letterSpacing: 0.5,
  },
  aiBody: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: C.text,
    lineHeight: 20,
  },

  // Group briefing hero
  groupHeroLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  groupHeroTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 26,
    color: '#fff',
    letterSpacing: -0.5,
    lineHeight: 32,
  },
  groupHeroSub: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 8,
  },
  groupStatsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  groupStatBox: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  groupStatNum: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
  },
  groupStatLabel: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: Spacing.side,
    paddingTop: 12,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: C.lightGray,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  startBtn: {
    backgroundColor: C.orange,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  startBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: C.text,
    letterSpacing: 1,
  },
  runningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0E0E0E',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  runningDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#D44545',
  },
  runningTime: {
    flex: 1,
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
    color: '#fff',
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
  },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#D44545',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  stopBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#fff',
    letterSpacing: 0.5,
  },
});

// ── Audio device modal styles ──────────────────────────────────────────────
const ad = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 40,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DDD',
    alignSelf: 'center',
    marginBottom: 20,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(232,168,56,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
    color: '#0E0E0E',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: '#999',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 24,
  },
  routeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#F8F8F8',
    marginBottom: 4,
  },
  routeBtnIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(232,168,56,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeBtnLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#0E0E0E',
  },
  routeBtnSub: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: '#999',
    marginTop: 1,
  },
  actions: {
    marginTop: 20,
    gap: 8,
  },
  btnStart: {
    backgroundColor: '#E8A838',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  btnStartText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: '#0E0E0E',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});

// ── End-of-class debrief sheet styles ──────────────────────────────────────
const db = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingBottom: 40,
    maxHeight: '92%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DDD',
    alignSelf: 'center',
    marginTop: 12,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 6,
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(74,175,82,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: '#0E0E0E',
    letterSpacing: -0.3,
  },
  headerSub: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: '#999',
    marginTop: 2,
  },
  durationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 24,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
  },
  durationText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#0E0E0E',
  },
  durationDim: {
    fontFamily: Fonts.jakartaMedium,
    color: '#999',
  },
  secLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: '#B0B0B0',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginHorizontal: 24,
    marginTop: 20,
    marginBottom: 10,
  },
  noteArea: {
    marginHorizontal: 24,
  },
  noteInput: {
    minHeight: 88,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E5E5E5',
    backgroundColor: '#FFFFFF',
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: '#0E0E0E',
    lineHeight: 20,
  },
  noteHint: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: '#CCC',
    marginTop: 6,
    paddingLeft: 2,
  },
  fpList: {
    marginHorizontal: 24,
    gap: 8,
  },
  fpItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#F8F8F8',
  },
  fpItemSelected: {
    backgroundColor: 'rgba(74,175,82,0.06)',
  },
  fpCheck: {
    width: 28,
    height: 28,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#DDD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fpCheckSelected: {
    borderColor: '#4AAF52',
    backgroundColor: '#4AAF52',
  },
  fpName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#0E0E0E',
  },
  fpMeta: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  actions: {
    marginHorizontal: 24,
    marginTop: 24,
    gap: 8,
  },
  btnDone: {
    backgroundColor: '#4AAF52',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  btnDoneText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  btnLater: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  btnLaterText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: '#999',
  },
  recBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 24,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(232,168,56,0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(232,168,56,0.2)',
  },
  recBannerText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: '#E8A838',
    flex: 1,
  },
});

const cr = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: 'rgba(232,168,56,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 24,
    color: '#0E0E0E',
    letterSpacing: -0.3,
    marginBottom: 12,
    textAlign: 'center',
  },
  sub: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    lineHeight: 22,
  },
});
