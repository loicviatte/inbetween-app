import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Animated,
  Modal,
  Pressable,
  Alert,
  AppState,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import HeroCardGradient from '../../components/HeroCardGradient';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle } from 'react-native-svg';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Fonts, Spacing } from '../../theme';
import { useCoachData } from '../../context/CoachDataContext';
import { getStudentFocusPoints, getStudentQuestions, getStudentOpenQuestions, getStudentRecentActivity, getStartClassRoster, markQuestionCovered, linkCoveredQuestionsToClass } from '../../storage/coachStorage';
import { getLessonReadiness } from '../../storage/storage';
import { getMyCouples, getCoupleReadiness, getCoupleFocusPoints, getCoupleActivity } from '../../storage/coupleStorage';
import QuestionDetailSheet from '../../components/QuestionDetailSheet';
import MicCueSheet from '../../components/MicCueSheet';
import {
  getActiveCoachClass,
  setActiveCoachClass,
  patchActiveCoachClass,
  clearActiveCoachClass,
} from '../../storage/activeCoachClass';
import { supabase } from '../../services/supabase/client';
import {
  presentAudioRoutePicker,
  getCurrentInputRoute,
  listAvailableInputs,
  setPreferredInput,
  addRouteChangeListener,
} from 'audio-route-picker';
import {
  startCoachRecording as laStartCoachRecording,
  updateCoachRecording as laUpdateCoachRecording,
  endCoachRecording as laEndCoachRecording,
  endAllCoachRecordings as laEndAllCoachRecordings,
} from 'live-activities';
import { isNewRecordingPipelineEnabled, isNativeRecorderEnabled, isLocalRecordingMode } from '../../services/featureFlags';
import { enqueueChunk } from '../../storage/recordingQueue';
import { pokeUploadWorker } from '../../services/uploadWorker';
import ContinuousAudioRecorder from 'continuous-audio-recorder';

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
  const base = RecordingPresets.HIGH_QUALITY;
  return {
    ...base,
    numberOfChannels: 1,
    bitRate: 32000,
    sampleRate: 16000,
    android: { ...base.android, numberOfChannels: 1, bitRate: 32000, sampleRate: 16000 },
    ios: { ...base.ios, numberOfChannels: 1, bitRate: 32000, sampleRate: 16000 },
  };
}

async function createAndStartRecording(options) {
  const recorder = new AudioModule.AudioRecorder(options);
  await recorder.prepareToRecordAsync(options);
  recorder.record();
  return recorder;
}

async function stopAndUnloadRecording(recorder) {
  if (!recorder) return null;
  let uri = null;
  try {
    await recorder.stop();
    uri = recorder.uri;
  } catch {}
  try { recorder.release?.(); } catch {}
  return uri;
}

// Best-effort error serializer for recording-event logs. Native errors
// (AVAudioRecorder, expo-audio) often surface non-Error objects with .code,
// .domain, .userInfo — we capture whichever exist so post-mortem analysis
// has the full picture.
function serializeRecordingError(err) {
  if (!err) return { message: 'unknown' };
  if (typeof err === 'string') return { message: err };
  const out = {
    message: err.message ?? String(err),
  };
  if (err.name) out.name = err.name;
  if (err.code != null) out.code = err.code;
  if (err.domain) out.domain = err.domain;
  if (err.userInfo) out.userInfo = err.userInfo;
  if (err.stack) out.stack = String(err.stack).slice(0, 2000);
  return out;
}

function fmtTs(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

// Format utterances as `[MM:SS - MM:SS] <Label>: text` blocks.
// `offsetMs` lets the caller shift all timestamps when stitching multiple
// chunks of the same recording so the final transcript reads as a single
// continuous timeline (each chunk natively starts at 00:00).
// `speakerLabels` maps an AssemblyAI speaker id (e.g. "A") to a human label
// like "Coach" / "Élève". Falls back to "Speaker A" if not provided.
function formatUtterances(utterances, offsetMs = 0, speakerLabels = null) {
  if (!Array.isArray(utterances) || utterances.length === 0) return '';
  return utterances
    .map((u) => {
      const startSec = (u.start + offsetMs) / 1000;
      const endSec = (u.end + offsetMs) / 1000;
      const label = (speakerLabels && speakerLabels[u.speaker]) || `Speaker ${u.speaker}`;
      return `[${fmtTs(startSec)} - ${fmtTs(endSec)}] ${label}: ${String(u.text || '').trim()}`;
    })
    .join('\n\n');
}

// Identify the "Coach" speaker per chunk by total speaking time. The speaker
// who spoke the most is labeled "Coach", everyone else "Élève". For 1-on-1
// classes this is ~99% reliable (coach speaks ~80%); for groups ~95% (coach
// still dominant at ~60%). Returns a {speakerId: label} map.
function identifyCoachSpeaker(utterances) {
  if (!Array.isArray(utterances) || utterances.length === 0) return {};
  const totals = {};
  for (const u of utterances) {
    const dur = Math.max(0, (u.end || 0) - (u.start || 0));
    totals[u.speaker] = (totals[u.speaker] || 0) + dur;
  }
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return {};
  const coachId = sorted[0][0];
  const labels = {};
  for (const id of Object.keys(totals)) {
    labels[id] = id === coachId ? 'Coach' : 'Élève';
  }
  return labels;
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
      // Return raw utterances + duration so the caller can stitch chunks
      // into a single continuous timeline with cumulative timestamp offsets
      // and per-chunk speaker re-labeling.
      // audio_duration is in seconds; convert to ms for consistency.
      const durationMs = Math.round((Number(job.audio_duration) || 0) * 1000);
      return {
        utterances: Array.isArray(job.utterances) ? job.utterances : [],
        text: typeof job.text === 'string' ? job.text : '',
        durationMs,
      };
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
// ─── StartClass landing — private student card ──────────────────────────────
//
// `st` is a roster entry from getStartClassRoster() with: id, name, photoUrl,
// lastPrivateClassDate, lastPrivateDurationMin, readiness (0-100), briefings
// (focus point summaries), status.
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function PrivateCard({ st, onPress }) {
  const isSilent = st.status === 'silent';
  const ringColor = isSilent ? '#E84545' : '#E8B530';
  const avBg = isSilent ? '#F7D8D8' : '#4E6A5C';
  const avTextColor = isSilent ? '#E84545' : '#FFFFFF';
  const initial = (st.name || 'S')[0]?.toUpperCase() || 'S';

  // "Last private · Apr 19 · 50 min" or "Last private · Apr 19", or fallback.
  const lastPrivate = st.lastPrivateClassDate ? new Date(st.lastPrivateClassDate) : null;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let metaLine;
  if (lastPrivate) {
    const datePart = `${months[lastPrivate.getMonth()]} ${lastPrivate.getDate()}`;
    metaLine = `Last private · ${datePart}`;
    if (st.lastPrivateDurationMin) metaLine += ` · ${st.lastPrivateDurationMin} min`;
  } else {
    metaLine = 'No private together yet';
  }

  return (
    <TouchableOpacity style={sc.card} onPress={onPress} activeOpacity={0.85}>
      <View style={[sc.avRing, { borderColor: ringColor }]}>
        {st.photoUrl ? (
          <Image source={{ uri: st.photoUrl }} style={sc.avPhoto} />
        ) : (
          <View style={[sc.avFallback, { backgroundColor: avBg }]}>
            <Text style={[sc.avText, { color: avTextColor }]}>{initial}</Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={sc.cardName} numberOfLines={1}>{st.name}</Text>
        <Text style={sc.cardMeta} numberOfLines={1}>{metaLine}</Text>
      </View>
      <View style={sc.right}>
        <View style={sc.readyWrap}>
          <Text style={sc.readyN}>{st.readiness}<Text style={sc.readyPct}>%</Text></Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="rgba(10,10,10,0.4)" />
      </View>
    </TouchableOpacity>
  );
}

export default function StartClassScreen({ navigation }) {
  const { students, getOrFetch } = useCoachData();

  const [view, setView] = useState('select');
  const [pickMode, setPickMode] = useState('solo'); // 'solo' | 'couple' — landing list toggle
  const modeSlide = useRef(new Animated.Value(0)).current; // 0 = solo, 1 = couple (sliding pill)
  const [toggleW, setToggleW] = useState(0);
  const selectMode = (m) => {
    setPickMode(m);
    Animated.spring(modeSlide, {
      toValue: m === 'couple' ? 1 : 0,
      useNativeDriver: true,
      friction: 9,
      tension: 90,
    }).start();
  };
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [selectedCouple, setSelectedCouple] = useState(null); // couple class context
  // Picked Latin/Ballroom style for the current private briefing. Read by
  // startClassNow when it stamps the active class (was referenced there via an
  // undeclared ref → threw and silently aborted setActiveCoachClass, so the
  // Dashboard never learned a class was running).
  const briefingCategoryRef = useRef(null);
  const [couples, setCouples] = useState([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cs = await getMyCouples();
        // Enrich with the same info as the solo roster: readiness % + last
        // couple-private date (getMyCouples itself returns neither).
        const enriched = await Promise.all((cs || []).map(async (c) => {
          const r = await getCoupleReadiness(c.coupleId, null).catch(() => null);
          return { ...c, readiness: r?.percent ?? null, lastPrivateClassDate: r?.lastClassDate ?? null };
        }));
        if (alive) setCouples(enriched);
      } catch {
        if (alive) setCouples([]);
      }
    })();
    return () => { alive = false; };
  }, []);
  const [searchQuery, setSearchQuery] = useState('');
  // Per-student readiness + focus briefings, loaded for the select view.
  const [roster, setRoster] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(false);

  // Audio device picker modal + running class state
  const [audioModalOpen, setAudioModalOpen] = useState(false);
  const [classStartedAt, setClassStartedAt] = useState(null);
  const [chronoMs, setChronoMs] = useState(0);
  // Mirror chronoMs in a ref. stopClass is called from places where the
  // closure captures an old render (e.g. an Alert.alert button shown when
  // the mic disconnected several minutes earlier — when the coach finally
  // taps "Stop class", the captured stopClass references chronoMs from
  // back then, not now). Reading from this ref inside stopClass gives us
  // the truthful elapsed time at stop moment.
  const chronoMsRef = useRef(0);
  const [audioRoute, setAudioRoute] = useState(null);

  // Mic picker (Prop 1) + live audio meter (Prop 3 badge)
  const [availableInputs, setAvailableInputs] = useState([]);
  const [selectedInputUid, setSelectedInputUid] = useState(null);
  const [inputLevel, setInputLevel] = useState(-160); // dBFS, -160 = silence
  const previewRecordingRef = useRef(null);
  const inputRefreshIntervalRef = useRef(null);
  const SOUND_GOOD_DBFS = -40;
  // Searching pulse for "no BT mic" empty state. Two staggered rings that
  // expand outward and fade — never travel back inward.
  const searchRing1 = useRef(new Animated.Value(0)).current;
  const searchRing2 = useRef(new Animated.Value(0)).current;
  // Live wave bars (per-bar Animated.Value, scaled with native driver for 60fps)
  const WAVE_BAR_COUNT = 24;
  const waveBars = useRef(Array.from({ length: WAVE_BAR_COUNT }, () => new Animated.Value(0.1))).current;
  // Debounced "sounds good" — only becomes true after the level stays above
  // the threshold for ≥500ms straight, to avoid flickering on edge cases.
  const aboveSinceRef = useRef(null);
  const [sustainedSoundsGood, setSustainedSoundsGood] = useState(false);
  // Custom in-app popup for "no mic selected" (replaces the native Alert)
  const [noMicPromptOpen, setNoMicPromptOpen] = useState(false);
  const phoneMicRef = useRef(null);

  // Local-recording mode: confirmation gates around the DJI mic's physical
  // REC / STOP buttons. The phone has no idea whether the coach actually
  // pressed REC on the mic (the mic records on its own storage, fully
  // independent), so without these prompts the coach can silently start
  // the class with the mic off and only discover the missing audio when
  // they plug in to sync. Forcing an explicit acknowledgement at start
  // AND stop cuts that class of mistake — the dismissal is non-cancellable
  // (no tap-out), so the coach can't accidentally skip past it.
  const [recStartConfirmOpen, setRecStartConfirmOpen] = useState(false);
  const [recStopConfirmOpen, setRecStopConfirmOpen] = useState(false);

  // One-time recording-consent gate. The very first time a coach starts a
  // class we make them acknowledge that they're responsible for having the
  // consent of everyone they record (see Terms / Privacy). Once accepted it
  // never shows again for that coach. We persist locally for an instant gate
  // and best-effort stamp users.recording_consent_at as evidence.
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const pendingPhoneMicRef = useRef(null);

  // Local-recording-mode gating (DJI mic on-device storage workflow).
  // When isLocalMode is true:
  //   - The phone NEVER captures audio during class (no setAudioModeAsync,
  //     no AudioRecorder, no chunk rotation). The coach starts/stops the
  //     DJI mic itself, which records to its own internal 8 GB storage.
  //   - The class_recordings row is marked local_recording_mode = true and
  //     starts with admin_review_status = 'pending'.
  //   - After the class, the coach plugs the mic via USB-C and uploads
  //     the WAV file through a separate flow (LocalUpload section, below).
  //   - Phone audio session stays untouched → Spotify on a BT speaker
  //     plays uninterrupted throughout the class.
  // Gated by email — only viatteloic@gmail.com for the beta. See
  // src/services/featureFlags.js.
  const [authUser, setAuthUser] = useState(null);
  useEffect(() => {
    supabase.auth.getUser()
      .then(({ data: { user } }) => setAuthUser(user))
      .catch(() => setAuthUser(null));
  }, []);
  const isLocalMode = isLocalRecordingMode(authUser);

  // Hydrate the recording-consent flag once we know who the coach is, so an
  // already-consented coach never sees the gate again.
  useEffect(() => {
    if (!authUser?.id) return;
    AsyncStorage.getItem(`coach.recordingConsent:${authUser.id}`)
      .then((v) => { if (v) setConsentGiven(true); })
      .catch(() => {});
  }, [authUser?.id]);

  // Microphone recording
  const recordingRef = useRef(null);
  // Chunked audio: every CHUNK_MS we stop the current AudioRecorder, push
  // its URI to the chunks list and start a fresh one. Each chunk is a
  // self-contained M4A so a corrupted segment never kills the whole class.
  const [audioUris, setAudioUris] = useState([]);
  const audioUrisRef = useRef([]);
  const chunkRotationIntervalRef = useRef(null);
  const rotatingChunkRef = useRef(false);
  // Guard against double-tap on the Stop button. Without this, two quick
  // taps both enter stopClass, race on recordingRef.current, push the same
  // chunk URI twice into audioUrisRef and double-trigger finalize-class
  // (idempotent server-side but messy locally).
  const stoppingRef = useRef(false);
  const CHUNK_MS = 3 * 60 * 1000; // 3 minutes
  // New server-side pipeline (feature-flagged per user). When enabled, each
  // chunk is uploaded to Supabase Storage during the class and a
  // `class_recordings` row tracks the session. At Done, we call the
  // `finalize-class` edge function and let the server orchestrate
  // transcription + class_inputs creation. Falls back to the legacy
  // client-side AssemblyAI flow when the flag is off.
  const newPipelineRef = useRef(false);     // captured at startClassNow
  const recordingIdRef = useRef(null);      // class_recordings.id when on new pipeline
  const userIdRef = useRef(null);           // captured at startClassNow

  // Screen-level back (iOS edge-swipe / hardware back) while in a sub-view but
  // NOT recording should return to the roster, not pop StartClass to the coach
  // home. Once a class is recording, let the default back happen so the coach
  // lands back on the Dashboard, where the running class shows as a live
  // "class in progress" chrono (tap it to jump back in). Depend on
  // view/classStartedAt so the listener closure always reads current values —
  // no refs that could go stale (which sent back to the roster mid-recording).
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (view !== 'select' && !classStartedAt) {
        e.preventDefault();
        setView('select');
        setSearchQuery('');
        setSelectedCouple(null);
      }
    });
    return unsub;
  }, [navigation, view, classStartedAt]);

  // Back arrow inside a briefing. If a class is recording, leave to the
  // Dashboard (where the running class lives as a "class in progress" chrono)
  // rather than dropping onto the roster — otherwise the coach lands on the
  // student list mid-recording and can start a SECOND class. Not recording →
  // return to the roster as before.
  function backFromBriefing() {
    if (classStartedAt) {
      navigation.goBack();
    } else {
      setView('select');
      setSearchQuery('');
      setSelectedCouple(null);
    }
  }

  // Append-only journal of session events (AppState transitions, rotation
  // failures, audio route changes) flushed into class_recordings.meta.events.
  // Lets us tell after the fact what really happened during a class that
  // dropped audio: the exact rotation that failed, with what error, while
  // the app was in what state and on what audio route.
  const recordingEventsRef = useRef([]);
  const lastAudioRouteNameRef = useRef(null);
  // Native iOS recorder (continuous-audio-recorder). When the per-user flag
  // is on, audio CAPTURE goes through a single AVAudioEngine that never
  // restarts — chunks are rotated natively (file-only swap) instead of by
  // stopping/starting expo-audio's AudioRecorder, which trips
  // expo/expo#21782 the moment the app is backgrounded at rotation time.
  // The downstream pipeline (enqueue → upload → finalize-class) is the same.
  const usingNativeRecorderRef = useRef(false);
  const nativeRecorderSubsRef = useRef([]);
  const nativeRecorderOutputDirRef = useRef(null);
  const [micPermGranted, setMicPermGranted] = useState(null);
  // Watchdog: when iOS suspends the app the recording stops even though
  // wall-clock time keeps advancing. We freeze the chrono at the moment of
  // interruption and prompt the coach to wrap up.
  const interruptedAtMsRef = useRef(null);
  const interruptAlertShownRef = useRef(false);
  const liveActivityIdRef = useRef(null);
  const routeChangeAlertShownRef = useRef(false);
  // True when the active class is recording through a Bluetooth mic (incl.
  // DJI mics whose name carries the brand). We add the class duration to a
  // cumulative counter and prompt every BT_MIC_REMIND_MS of total airtime.
  const usedBtMicRef = useRef(false);
  const [chargeReminderInDebrief, setChargeReminderInDebrief] = useState(false);
  const BT_MIC_REMIND_MS = 4 * 60 * 60 * 1000; // 4 hours
  const BT_CUMUL_KEY = 'coach.btMic.cumulativeMs';
  const BT_THRESHOLD_KEY = 'coach.btMic.reminderThresholdMs';

  // Append a structured event to the local journal AND best-effort flush
  // the journal to class_recordings.meta.events. Fire-and-forget DB write —
  // we never await this from the caller because we don't want logging to
  // block audio-pipeline code paths. Events logged before recordingId is
  // set are buffered locally and flushed on the next event after the id
  // becomes available (we always send the FULL events array, not deltas).
  const logRecordingEvent = useCallback((event) => {
    const fullEvent = { ...event, at: new Date().toISOString() };
    recordingEventsRef.current = [...recordingEventsRef.current, fullEvent];
    try { console.log('[StartClass:event]', JSON.stringify(fullEvent)); } catch {}
    const recordingId = recordingIdRef.current;
    if (!recordingId) return;
    const eventsSnapshot = recordingEventsRef.current;
    supabase
      .from('class_recordings')
      .update({ meta: { events: eventsSnapshot } })
      .eq('id', recordingId)
      .then(
        ({ error }) => {
          if (error) console.warn('[StartClass:event] DB write error:', error.message);
        },
        (err) => {
          console.warn('[StartClass:event] DB write threw:', err?.message);
        },
      );
  }, []);

  // Load the readiness roster (per-student focus briefings) whenever the select
  // view is shown. Cache-first: paint the last roster instantly from disk, then
  // refresh in the background. The full fetch is a slow sequential staircase on
  // the free-tier pooler (~15-25s), so without the cache the coach stares at a
  // spinner every single time they open Start Class.
  useEffect(() => {
    if (view !== 'select') return;
    let active = true;
    // Warm each student's briefing detail in the background so tapping one is
    // near-instant instead of another 20-30s cold staircase. Core (fps +
    // readiness) first so the briefing can render + the coach can start; the
    // rest fills in after. getOrFetch dedups in-flight, so a tap mid-prefetch
    // awaits the same request rather than firing a second one.
    const prefetchDetails = (students) => {
      for (const st of (students || [])) {
        if (!st?.id) continue;
        const sk = `student:${st.id}`;
        getOrFetch(`${sk}:fps`, () => getStudentFocusPoints(st.id).catch(() => []));
        getOrFetch(`${sk}:readiness:all`, () => getLessonReadiness(st.id, null).catch(() => null));
        getOrFetch(`${sk}:questions`, () => getStudentQuestions(st.id).catch(() => []));
        getOrFetch(`${sk}:openQuestions`, () => getStudentOpenQuestions(st.id).catch(() => []));
        getOrFetch(`${sk}:activity:40`, () => getStudentRecentActivity(st.id, 40).catch(() => []));
      }
    };
    (async () => {
      let hadCache = false;
      try {
        const raw = await AsyncStorage.getItem('startClassRoster.v1');
        const cached = raw ? JSON.parse(raw) : null;
        if (active && Array.isArray(cached) && cached.length) {
          setRoster(cached);
          setRosterLoading(false);
          hadCache = true;
          prefetchDetails(cached); // start warming immediately from cache
        }
      } catch {}
      if (active && !hadCache) setRosterLoading(true);
      try {
        const { students: list } = await getStartClassRoster();
        if (active) {
          setRoster(list || []);
          AsyncStorage.setItem('startClassRoster.v1', JSON.stringify(list || [])).catch(() => {});
          if (!hadCache) prefetchDetails(list); // no cache → warm from the fresh roster
        }
      } catch (err) {
        console.warn('[StartClass] roster load failed:', err);
        if (active && !hadCache) setRoster([]);
      } finally {
        if (active) setRosterLoading(false);
      }
    })();
    return () => { active = false; };
  }, [view]);

  // While a class is being recorded, listen for audio route changes. If the
  // selected mic disconnects mid-class, iOS silently falls back to the
  // built-in mic — the coach must be told so they can decide to keep going
  // on the iPhone or stop and reconnect.
  useEffect(() => {
    if (!classStartedAt) return;
    routeChangeAlertShownRef.current = false;
    const sub = addRouteChangeListener((e) => {
      logRecordingEvent({
        type: 'audio_route_event',
        reason: e?.reason,
        name: e?.name ?? null,
        appState: AppState.currentState,
      });
      if (e.reason !== 'oldDeviceUnavailable') return;
      if (routeChangeAlertShownRef.current) return;
      routeChangeAlertShownRef.current = true;
      const fallback = e.name ? ` (now using ${e.name})` : '';

      // System notification — surfaces on lock screen / when app is in
      // background. iOS hides this banner when the app is foregrounded, so
      // the in-app Alert below covers that case.
      try {
        const trigger = Notifications.SchedulableTriggerInputTypes
          ? { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1, repeats: false }
          : { seconds: 1 };
        Notifications.scheduleNotificationAsync({
          content: {
            title: '🎙️ Microphone disconnected',
            body: `Your mic disconnected mid-class${fallback}. Open InBetween to keep going or stop the class.`,
            sound: 'default',
            interruptionLevel: 'timeSensitive',
            badge: 1,
          },
          trigger,
        }).catch(() => {});
      } catch {}

      Alert.alert(
        '🎙️ Microphone disconnected',
        `Your microphone disconnected mid-class${fallback}. The recording is continuing on the next available source.`,
        [
          { text: 'Keep recording', style: 'cancel' },
          { text: 'Stop class', style: 'destructive', onPress: () => stopClass() },
        ],
      );
    });
    return () => { sub.remove(); };
  }, [classStartedAt, logRecordingEvent]);

  // Heartbeat: refreshes the Live Activity stale-date and persists
  // lastHeartbeatAt to AsyncStorage every few seconds while a class is
  // running. The previous "kill notification" mechanism that piggybacked
  // on this was removed in 1.5.4 — locking the phone (a normal user
  // action) was firing the notif because iOS suspended JS and the next
  // re-schedule never ran.
  const heartbeatIntervalRef = useRef(null);
  const [classRecorded, setClassRecorded] = useState(false);
  // Tracks the post-debrief popToTop timeout so we can cancel it if the
  // screen unmounts (or the coach navigates manually) during the 2.5s
  // success banner. Without this, popToTop fires on a stale navigation
  // ref and triggers a React warning / potential crash.
  const popToTopTimerRef = useRef(null);

  // End-of-class debrief modal
  const [debriefOpen, setDebriefOpen] = useState(false);
  const [debriefDurationMs, setDebriefDurationMs] = useState(0);
  const [debriefNote, setDebriefNote] = useState('');
  const [validatedFpIds, setValidatedFpIds] = useState([]);

  useEffect(() => {
    if (!classStartedAt) return;
    const id = setInterval(() => {
      const next = interruptedAtMsRef.current != null
        ? interruptedAtMsRef.current
        : (Date.now() - classStartedAt);
      setChronoMs(next);
      chronoMsRef.current = next;
    }, 500);
    return () => clearInterval(id);
  }, [classStartedAt]);

  // Cleanup the post-debrief popToTop timer if the screen unmounts before
  // the 2.5s success banner finishes (coach navigates away manually,
  // app backgrounded, etc.).
  useEffect(() => {
    return () => {
      if (popToTopTimerRef.current) {
        clearTimeout(popToTopTimerRef.current);
        popToTopTimerRef.current = null;
      }
    };
  }, []);

  // Poll the current audio input route while a class is running so the
  // coach sees which mic actually captures the audio (Bluetooth headset,
  // built-in mic, etc.). Updates every 2s. Also logs route changes to the
  // recording event journal so we can correlate audio dropouts with mic
  // disconnect/reconnect events post-mortem.
  useEffect(() => {
    if (!classStartedAt) {
      setAudioRoute(null);
      lastAudioRouteNameRef.current = null;
      return;
    }
    const tick = () => {
      try {
        const route = getCurrentInputRoute();
        setAudioRoute(route);
        const name = route?.name ?? null;
        if (name !== lastAudioRouteNameRef.current) {
          logRecordingEvent({
            type: 'audio_route_change',
            from: lastAudioRouteNameRef.current,
            to: name,
            isBluetooth: !!route?.isBluetooth,
          });
          lastAudioRouteNameRef.current = name;
        }
      } catch (err) {
        logRecordingEvent({ type: 'audio_route_query_failed', error: serializeRecordingError(err) });
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [classStartedAt, logRecordingEvent]);

  // Watch the recording status. If iOS killed the audio session while the app
  // was suspended (or if anything else interrupted it), freeze the chrono at
  // the real captured duration and let the coach decide whether to wrap up.
  useEffect(() => {
    if (!classStartedAt) return;
    let cancelled = false;

    const markInterrupted = (reason) => {
      if (interruptedAtMsRef.current != null) return;
      interruptedAtMsRef.current = Date.now() - classStartedAt;
      logRecordingEvent({
        type: 'interruption_detected',
        reason: reason ?? 'unknown',
        elapsedMs: interruptedAtMsRef.current,
      });
      if (liveActivityIdRef.current) {
        laUpdateCoachRecording(liveActivityIdRef.current, { isInterrupted: true }).catch(() => {});
      }
      if (interruptAlertShownRef.current) return;
      interruptAlertShownRef.current = true;
      Alert.alert(
        'Enregistrement interrompu',
        "L'enregistrement audio a été coupé (probablement parce que l'application a été fermée ou suspendue trop longtemps). Veux-tu arrêter le cours et utiliser ce qui a été capturé ?",
        [
          { text: 'Continuer le cours', style: 'cancel' },
          { text: 'Arrêter le cours', style: 'destructive', onPress: () => stopClass() },
        ],
      );
    };

    const check = async () => {
      if (cancelled) return;
      const rec = recordingRef.current;
      if (!rec) return;
      try {
        const status = rec.getStatus();
        if (cancelled) return;
        if (status.canRecord === false || status.isRecording === false) {
          markInterrupted(`status canRecord=${status.canRecord} isRecording=${status.isRecording}`);
        }
      } catch (err) {
        markInterrupted(`getStatus threw: ${err?.message ?? String(err)}`);
      }
    };

    const id = setInterval(check, 5000);
    const sub = AppState.addEventListener('change', (state) => {
      logRecordingEvent({ type: 'appstate_change', state });
      if (state === 'active') check();
    });
    return () => {
      cancelled = true;
      clearInterval(id);
      sub.remove();
    };
  }, [classStartedAt, logRecordingEvent]);

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
    const elapsed = Date.now() - active.startedAt;
    setChronoMs(elapsed);
    chronoMsRef.current = elapsed;
    if (active.kind === 'private' && active.studentId) {
      const match = students.find((s) => s.id === active.studentId);
      if (match) {
        // Reuse the existing loader so detail data is consistent with a fresh
        // pick (focus points, questions, last class). Use the style persisted
        // when the class started (so the debrief stays scoped to it); fall back
        // to the single coached style, else null.
        loadStudentDetail(
          match,
          active.category ?? ((match.coachStyles && match.coachStyles.length === 1) ? match.coachStyles[0] : null),
        );
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

  // The "kill notification" mechanism is removed entirely. Its purpose was
  // to alert the coach if the app process actually died mid-class — but the
  // way iOS schedules notifications doesn't let us tell the difference
  // between "app process died" and "phone is locked", so the notif fired
  // any time the user locked their phone, falsely claiming the recording
  // was stopped (the audio session keeps recording in background; locking
  // is a normal user action and should NOT trigger an alarming alert).
  //
  // Detection of an actual kill still works via App.js' mount-time check
  // for orphan Live Activities — the next time the user opens the app
  // after a process death, they get a "Recording interrupted" alert with
  // a Continue button. That's the right place for that UX.
  //
  // The heartbeat below is kept for two unrelated purposes:
  //   - LA staleSeconds: the lock-screen Live Activity dims itself if
  //     it stops getting refreshes, giving the coach a visual cue.
  //   - activeCoachClass.lastHeartbeatAt: persisted to AsyncStorage so
  //     the relaunch path knows when the kill happened.

  function startHeartbeat() {
    stopHeartbeat();
    if (liveActivityIdRef.current) {
      laUpdateCoachRecording(liveActivityIdRef.current, { staleSeconds: 10 }).catch(() => {});
    }
    patchActiveCoachClass({ lastHeartbeatAt: Date.now() });
    heartbeatIntervalRef.current = setInterval(() => {
      if (liveActivityIdRef.current) {
        laUpdateCoachRecording(liveActivityIdRef.current, { staleSeconds: 7 }).catch(() => {});
      }
      patchActiveCoachClass({ lastHeartbeatAt: Date.now() });
    }, 4000);
  }

  function stopHeartbeat() {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    // Defensive cleanup: previous builds (1.5.0 → 1.5.3) shipped the
    // self-firing "Recording interrupted" notif. Users who upgrade from
    // those builds may have a stack of already-delivered notifs; dismiss
    // them on every class end so the lock screen / notification center
    // is clean.
    Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
    Notifications.dismissAllNotificationsAsync().catch(() => {});
    Notifications.setBadgeCountAsync(0).catch(() => {});
  }

  // Auto-resume the recording after the coach killed the app and tapped
  // "Continue" on the relaunch alert. Restores audio + LA + heartbeat with
  // the original startedAt so the chrono picks up where it left off.
  const resumeStartedRef = useRef(false);
  useEffect(() => {
    if (resumeStartedRef.current) return;
    const active = getActiveCoachClass();
    if (!active?.pendingResume) return;
    resumeStartedRef.current = true;
    (async () => {
      try {
        // In local-recording mode the phone never captured audio in the
        // first place — the DJI mic kept recording to its internal storage
        // through the crash. Restore class state without touching the
        // audio session.
        if (!isLocalMode) {
          const { granted } = await AudioModule.requestRecordingPermissionsAsync();
          if (!granted) {
            patchActiveCoachClass({ pendingResume: false });
            return;
          }
          await setAudioModeAsync({
            allowsRecording: true,
            playsInSilentMode: true,
            allowsBackgroundRecording: true,
            shouldPlayInBackground: true,
            interruptionMode: 'mixWithOthers',
          });
          recordingRef.current = await createAndStartRecording(getCoachRecordingOptions());
        }

        interruptedAtMsRef.current = null;
        interruptAlertShownRef.current = false;
        setClassStartedAt(active.startedAt);
        const elapsed = Date.now() - active.startedAt;
        setChronoMs(elapsed);
        chronoMsRef.current = elapsed;

        const id = await laStartCoachRecording({
          kind: active.kind,
          studentName: active.studentName ?? null,
          startedAt: active.startedAt,
        });
        liveActivityIdRef.current = id;
        patchActiveCoachClass({ liveActivityId: id, pendingResume: false });
        // Always start heartbeat — even if the Live Activity didn't
        // start (e.g. user disabled them in iOS Settings), we still need
        // lastHeartbeatAt persistence for kill detection.
        startHeartbeat();
      } catch (err) {
        console.warn('[StartClass] Could not resume recording:', err);
        patchActiveCoachClass({ pendingResume: false });
      }
    })();
  }, [students]);

  async function refreshInputList() {
    try {
      const list = await listAvailableInputs();
      setAvailableInputs(list);
      // If the previously selected input has been disconnected, drop the
      // selection so the coach is forced to pick again.
      setSelectedInputUid((prev) => (prev && list.some((i) => i.uid === prev) ? prev : null));
    } catch (err) {
      console.warn('[StartClass] listAvailableInputs failed:', err);
    }
  }

  function isPhoneMic(input) {
    return input?.type === 'builtin';
  }

  function isExternalMic(input) {
    return input && input.type !== 'builtin';
  }

  const previewMeterIntervalRef = useRef(null);

  async function startPreviewMeter() {
    await stopPreviewMeter();
    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: 'mixWithOthers',
      });
      const previewOptions = { ...RecordingPresets.LOW_QUALITY, isMeteringEnabled: true };
      const recorder = await createAndStartRecording(previewOptions);
      previewRecordingRef.current = recorder;

      previewMeterIntervalRef.current = setInterval(() => {
        const r = previewRecordingRef.current;
        if (!r) return;
        let status;
        try { status = r.getStatus(); } catch { return; }
        if (!status?.isRecording || typeof status.metering !== 'number') return;

        const level = status.metering;
        setInputLevel(level);

        // Latched "sounds good": once the level stays above the threshold
        // for ≥200ms, flip to true and stay there until the coach picks a
        // different input (pickInput resets it).
        const now = Date.now();
        if (level > SOUND_GOOD_DBFS) {
          if (aboveSinceRef.current == null) aboveSinceRef.current = now;
          if (now - aboveSinceRef.current >= 200) {
            setSustainedSoundsGood(true);
          }
        } else {
          aboveSinceRef.current = null;
        }

        // Drive each bar's scaleY toward (level + per-bar wobble) with a
        // short timing → smooth 60fps interpolation between updates.
        const amp = Math.max(0, Math.min(1, (level + 60) / 60));
        for (let i = 0; i < waveBars.length; i++) {
          const phase = i * 0.85 + now / 180;
          const wobble = 0.5 + 0.5 * Math.sin(phase);
          const target = 0.1 + amp * wobble * 0.95;
          Animated.timing(waveBars[i], {
            toValue: target,
            duration: 90,
            useNativeDriver: true,
          }).start();
        }
      }, 50);
    } catch (err) {
      console.warn('[StartClass] preview meter start failed:', err);
    }
  }

  async function stopPreviewMeter() {
    if (previewMeterIntervalRef.current) {
      clearInterval(previewMeterIntervalRef.current);
      previewMeterIntervalRef.current = null;
    }
    const r = previewRecordingRef.current;
    previewRecordingRef.current = null;
    if (!r) return;
    const uri = await stopAndUnloadRecording(r);
    if (uri) {
      try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch {}
    }
  }

  async function pickInput(uid) {
    setSelectedInputUid(uid);
    setInputLevel(-160);
    aboveSinceRef.current = null;
    setSustainedSoundsGood(false);
    waveBars.forEach((b) => b.setValue(0.1));
    try {
      await setPreferredInput(uid);
    } catch (err) {
      console.warn('[StartClass] setPreferredInput failed:', err);
    }
    // Restart preview to pick up the new source's signal
    await startPreviewMeter();
  }

  async function openAudioModal() {
    // Local-recording mode: phone captures no audio, so the "Choose your
    // mic" modal is meaningless. Short-circuit through a "press REC on
    // your DJI mic" confirmation — we just need a timestamp + a
    // class_recordings row; the DJI mic file is imported later via USB-C.
    // The confirmation prevents the silent-failure case where the coach
    // starts the class in the app but never presses REC on the mic.
    if (isLocalMode) {
      setMicPermGranted(false);
      setRecStartConfirmOpen(true);
      return;
    }
    const { granted } = await AudioModule.requestRecordingPermissionsAsync();
    setMicPermGranted(granted);
    setSelectedInputUid(null);
    setInputLevel(-160);
    setAudioModalOpen(true);
    if (granted) {
      await refreshInputList();
      // Auto-refresh while modal stays open so newly connected BT devices
      // appear without user action.
      if (inputRefreshIntervalRef.current) clearInterval(inputRefreshIntervalRef.current);
      inputRefreshIntervalRef.current = setInterval(() => { refreshInputList().catch(() => {}); }, 1500);
      // Searching pulse — each ring goes 0→1 (expand + fade), then snaps
      // back to 0 invisibly to start over. Two rings staggered so one
      // is always mid-flight while the next emerges.
      const ringLoop = (val) => Animated.loop(
        Animated.timing(val, { toValue: 1, duration: 1800, useNativeDriver: true }),
      );
      searchRing1.setValue(0);
      searchRing2.setValue(0);
      ringLoop(searchRing1).start();
      setTimeout(() => { ringLoop(searchRing2).start(); }, 900);
    }
  }

  async function closeAudioModal() {
    setAudioModalOpen(false);
    if (inputRefreshIntervalRef.current) {
      clearInterval(inputRefreshIntervalRef.current);
      inputRefreshIntervalRef.current = null;
    }
    searchRing1.stopAnimation();
    searchRing2.stopAnimation();
    aboveSinceRef.current = null;
    setSustainedSoundsGood(false);
    await stopPreviewMeter();
  }
  async function bumpBtMicUsageAndMaybeRemind(durationMs) {
    if (!usedBtMicRef.current || !durationMs || durationMs <= 0) return false;
    try {
      const [cumStr, thrStr] = await Promise.all([
        AsyncStorage.getItem(BT_CUMUL_KEY),
        AsyncStorage.getItem(BT_THRESHOLD_KEY),
      ]);
      const cum = (Number(cumStr) || 0) + durationMs;
      const thr = Number(thrStr) || BT_MIC_REMIND_MS;
      await AsyncStorage.setItem(BT_CUMUL_KEY, String(cum));
      if (cum >= thr) {
        await AsyncStorage.setItem(BT_THRESHOLD_KEY, String(thr + BT_MIC_REMIND_MS));
        return true;
      }
    } catch (err) {
      console.warn('[StartClass] BT mic usage tracking failed:', err);
    }
    return false;
  }

  // Push a finalized chunk URI into the local list AND (when on the new
  // server-side pipeline) into the upload queue + heartbeat the recording.
  // Single source of truth used by:
  //   - legacy expo-audio rotateChunk (fires on stop/restart cycle)
  //   - native recorder chunkReady event (fires on rotated file close)
  //   - stopClass tail-chunk path
  async function recordChunkUri(chunkUri) {
    if (!chunkUri) return;
    audioUrisRef.current = [...audioUrisRef.current, chunkUri];
    setAudioUris(audioUrisRef.current);

    if (!newPipelineRef.current || !recordingIdRef.current || !userIdRef.current) return;
    const idx = audioUrisRef.current.length - 1;
    const recordingId = recordingIdRef.current;
    const userId = userIdRef.current;
    const storagePath = `${userId}/${recordingId}/${idx}.m4a`;
    try {
      await supabase.from('class_recording_chunks').upsert({
        recording_id: recordingId,
        idx,
        status: 'pending',
      });
      await enqueueChunk({ recordingId, idx, fileUri: chunkUri, storagePath });
      pokeUploadWorker();
      supabase
        .from('class_recordings')
        .update({ last_heartbeat_at: new Date().toISOString() })
        .eq('id', recordingId)
        .then(() => {}, () => {});
    } catch (err) {
      logRecordingEvent({
        type: 'chunk_enqueue_failed',
        idx,
        error: serializeRecordingError(err),
      });
      console.warn('[StartClass] chunk enqueue failed:', err);
    }
  }

  async function rotateChunk() {
    if (rotatingChunkRef.current) {
      logRecordingEvent({ type: 'rotation_skipped_concurrent' });
      return;
    }
    if (!recordingRef.current) {
      logRecordingEvent({ type: 'rotation_skipped_no_recorder' });
      return;
    }
    rotatingChunkRef.current = true;
    const idxAtStart = audioUrisRef.current.length;
    let routeAtStart = null;
    try { routeAtStart = getCurrentInputRoute(); } catch {}
    let recorderStatusAtStart = null;
    try {
      recorderStatusAtStart = recordingRef.current?.getStatus?.() ?? null;
    } catch (err) {
      recorderStatusAtStart = { _error: serializeRecordingError(err) };
    }
    logRecordingEvent({
      type: 'rotation_start',
      idx: idxAtStart,
      appState: AppState.currentState,
      route: routeAtStart ? { name: routeAtStart.name, isBluetooth: !!routeAtStart.isBluetooth } : null,
      recorderStatus: recorderStatusAtStart,
    });
    try {
      let chunkUri = null;
      try {
        chunkUri = await stopAndUnloadRecording(recordingRef.current);
        logRecordingEvent({ type: 'rotation_stop_ok', idx: idxAtStart, hasUri: !!chunkUri });
      } catch (err) {
        logRecordingEvent({
          type: 'rotation_stop_failed',
          idx: idxAtStart,
          error: serializeRecordingError(err),
        });
        console.warn('[StartClass] chunk rotation: stop failed:', err);
      }
      await recordChunkUri(chunkUri);
      try {
        recordingRef.current = await createAndStartRecording(getCoachRecordingOptions());
        let restartStatus = null;
        try {
          restartStatus = recordingRef.current?.getStatus?.() ?? null;
        } catch {}
        let routeAfter = null;
        try { routeAfter = getCurrentInputRoute(); } catch {}
        logRecordingEvent({
          type: 'rotation_restart_ok',
          idx: idxAtStart + 1,
          appState: AppState.currentState,
          recorderStatus: restartStatus,
          route: routeAfter ? { name: routeAfter.name, isBluetooth: !!routeAfter.isBluetooth } : null,
        });
      } catch (err) {
        logRecordingEvent({
          type: 'rotation_restart_failed',
          idx: idxAtStart + 1,
          appState: AppState.currentState,
          error: serializeRecordingError(err),
        });
        console.warn('[StartClass] chunk rotation: restart failed:', err);
      }
    } finally {
      rotatingChunkRef.current = false;
    }
  }

  function startChunkRotation() {
    stopChunkRotation();
    chunkRotationIntervalRef.current = setInterval(() => {
      rotateChunk().catch(() => {});
    }, CHUNK_MS);
  }

  function stopChunkRotation() {
    if (chunkRotationIntervalRef.current) {
      clearInterval(chunkRotationIntervalRef.current);
      chunkRotationIntervalRef.current = null;
    }
  }

  // Attempts to start the native iOS continuous recorder. On success, the
  // module rotates chunks every CHUNK_MS at the file layer and emits one
  // chunkReady event per finalized chunk; we route those into the same
  // pipeline (recordChunkUri) the legacy rotation feeds. On failure throws,
  // and the caller falls back to expo-audio.
  async function tryStartNativeRecorder() {
    // Per-class output dir so chunk files from different classes don't
    // collide and stay scoped for cleanup later.
    const dirSuffix = recordingIdRef.current || `local-${Date.now()}`;
    const dir = `${FileSystem.documentDirectory}coach-class-${dirSuffix}`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    nativeRecorderOutputDirRef.current = dir;

    const subs = [];
    subs.push(ContinuousAudioRecorder.addChunkReadyListener((e) => {
      // recordChunkUri pushes into audioUrisRef + enqueues for upload.
      // Native idx is for forensics; the JS path uses audioUrisRef.length-1
      // as the canonical idx (matches legacy ordering).
      recordChunkUri(e?.uri).catch((err) => {
        console.warn('[StartClass] native chunkReady handler failed:', err);
      });
    }));
    subs.push(ContinuousAudioRecorder.addErrorListener((e) => {
      console.warn('[StartClass] Native recorder error:', e);
    }));
    subs.push(ContinuousAudioRecorder.addMediaServicesResetListener((e) => {
      console.warn('[StartClass] Native recorder media services reset:', e);
    }));
    nativeRecorderSubsRef.current = subs;

    try {
      await ContinuousAudioRecorder.start({
        outputDir: dir,
        chunkDurationMs: CHUNK_MS,
      });
      usingNativeRecorderRef.current = true;
    } catch (err) {
      subs.forEach((s) => { try { s.remove(); } catch {} });
      nativeRecorderSubsRef.current = [];
      nativeRecorderOutputDirRef.current = null;
      throw err;
    }
  }

  async function stopNativeRecorder() {
    let stopResult = null;
    try {
      stopResult = await ContinuousAudioRecorder.stop();
    } catch (err) {
      console.warn('[StartClass] Could not stop native recorder:', err);
    }
    // Native stop() emits the final chunkReady event before resolving,
    // but JS event delivery is asynchronous — give the listener a tick to
    // land before we tear it down. Without this we'd lose the tail.
    await new Promise((r) => setTimeout(r, 150));
    (nativeRecorderSubsRef.current || []).forEach((s) => { try { s.remove(); } catch {} });
    nativeRecorderSubsRef.current = [];
    usingNativeRecorderRef.current = false;
    return stopResult;
  }

  // One-shot hint shown the first time a coach starts a class without a
  // working Live Activity — most commonly because iOS Settings has
  // disabled the LA permission for InBetween. Recording still works in
  // background; the LA is the lock-screen reassurance widget.
  const LA_HINT_SHOWN_KEY = 'coach.liveActivityHintShown.v1';
  async function maybeShowLiveActivityHint() {
    try {
      const seen = await AsyncStorage.getItem(LA_HINT_SHOWN_KEY);
      if (seen === '1') return;
      await AsyncStorage.setItem(LA_HINT_SHOWN_KEY, '1');
    } catch { return; }
    Alert.alert(
      'Lock-screen widget unavailable',
      "Recording will continue normally even if you lock your phone. To see a Live Activity on your lock screen showing the class is recording, enable Live Activities for InBetween: Settings → InBetween → Live Activities.",
      [{ text: 'Got it', style: 'default' }],
    );
  }

  async function startClassNow() {
    setAudioModalOpen(false);
    if (inputRefreshIntervalRef.current) {
      clearInterval(inputRefreshIntervalRef.current);
      inputRefreshIntervalRef.current = null;
    }
    searchRing1.stopAnimation();
    searchRing2.stopAnimation();
    aboveSinceRef.current = null;
    setSustainedSoundsGood(false);
    await stopPreviewMeter();
    audioUrisRef.current = [];
    setAudioUris([]);

    // Reset interruption watchdog state for the new class.
    interruptedAtMsRef.current = null;
    interruptAlertShownRef.current = false;

    // Decide upfront which pipeline this session will use, then capture
    // the recording id + user id into refs so chunk rotation (which runs
    // outside React state) has stable values to read.
    newPipelineRef.current = false;
    recordingIdRef.current = null;
    userIdRef.current = null;
    // Hoisted so the audio-recording block below can see it. Defaults to
    // false (legacy real-time recording path) if the user fetch fails.
    let localMode = false;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // Resolve local mode from the freshly-fetched user so we don't race
      // with the component-mount auth fetch.
      localMode = isLocalRecordingMode(user);
      if (user && isNewRecordingPipelineEnabled(user)) {
        const isPrivate = view === 'private-briefing';
        const isCouple = view === 'couple-briefing';
        const { data: rec, error: insertErr } = await supabase
          .from('class_recordings')
          .insert({
            user_id: user.id,
            lesson_type: isCouple ? 'couple' : (isPrivate ? 'private' : 'group'),
            student_id: isPrivate ? (selectedStudent?.id ?? null) : null,
            couple_id: isCouple ? (selectedCouple?.coupleId ?? null) : null,
            status: 'recording',
            audio_folder: null, // filled in below once we have the row id
            // Local-recording-mode metadata: phone records nothing during
            // the class; coach uploads the DJI mic file afterwards. Admin
            // must approve before focus points propagate to the student.
            local_recording_mode: localMode,
            admin_review_status: localMode ? 'pending' : null,
          })
          .select('id')
          .single();
        if (insertErr) throw insertErr;
        const recordingId = rec.id;
        await supabase
          .from('class_recordings')
          .update({ audio_folder: `${user.id}/${recordingId}/` })
          .eq('id', recordingId);
        // MUST check the error: supabase-js resolves a failed insert as
        // { error } (FK/RLS/DB error), it doesn't throw. If we swallowed it the
        // recording would proceed with an EMPTY class_recording_students set →
        // finalize_recording_atomic propagates zero students → yoda-extract
        // attributes the whole couple/group lesson to the COACH. Throw so the
        // catch resets newPipelineRef and we don't run a half-initialized class.
        if (isCouple && selectedCouple) {
          const { error: csErr } = await supabase
            .from('class_recording_students')
            .insert([
              { recording_id: recordingId, student_id: selectedCouple.dancerA.id },
              { recording_id: recordingId, student_id: selectedCouple.dancerB.id },
            ]);
          if (csErr) throw csErr;
        } else if (!isPrivate && Array.isArray(students) && students.length > 0) {
          const { error: csErr } = await supabase
            .from('class_recording_students')
            .insert(students.map((s) => ({ recording_id: recordingId, student_id: s.id })));
          if (csErr) throw csErr;
        }
        newPipelineRef.current = true;
        recordingIdRef.current = recordingId;
        userIdRef.current = user.id;
      }
    } catch (err) {
      console.warn('[StartClass] new pipeline init failed, falling back to legacy:', err);
      // Reset so we definitely don't try to use partial state.
      newPipelineRef.current = false;
      recordingIdRef.current = null;
      userIdRef.current = null;
    }

    // Start recording if permission was granted.
    // In local-recording mode (DJI on-device storage), we skip the phone
    // capture entirely — the mic records to its own internal storage, and
    // the file is imported via USB-C after the class. The phone audio
    // session stays untouched so Spotify can keep playing through a BT
    // speaker without any iOS audio-session arbitration killing it.
    if (micPermGranted && !localMode) {
      try {
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          allowsBackgroundRecording: true,
          shouldPlayInBackground: true,
          interruptionMode: 'mixWithOthers',
        });
        logRecordingEvent({ type: 'audio_mode_set', appState: AppState.currentState });

        // Native iOS recorder path (per-user flag). Captures via a single
        // AVAudioEngine that never restarts; chunk rotation is handled
        // natively. Falls through to the legacy expo-audio path on failure.
        let nativeStarted = false;
        try {
          const { data: { user: authUser } } = await supabase.auth.getUser();
          if (isNativeRecorderEnabled(authUser)) {
            await tryStartNativeRecorder();
            nativeStarted = true;
            logRecordingEvent({
              type: 'session_started',
              appState: AppState.currentState,
              recorder: 'native',
            });
          }
        } catch (err) {
          logRecordingEvent({
            type: 'native_recorder_start_failed',
            error: serializeRecordingError(err),
          });
          console.warn('[StartClass] Native recorder start failed, falling back to expo-audio:', err);
        }

        if (!nativeStarted) {
          recordingRef.current = await createAndStartRecording(getCoachRecordingOptions());
          let initialRoute = null;
          try { initialRoute = getCurrentInputRoute(); } catch {}
          let initialStatus = null;
          try { initialStatus = recordingRef.current?.getStatus?.() ?? null; } catch {}
          logRecordingEvent({
            type: 'session_started',
            appState: AppState.currentState,
            route: initialRoute ? { name: initialRoute.name, isBluetooth: !!initialRoute.isBluetooth } : null,
            recorderStatus: initialStatus,
            recorder: 'expo-audio',
          });
          startChunkRotation();
        }
        try {
          const route = getCurrentInputRoute();
          const name = (route?.name || '').toLowerCase();
          usedBtMicRef.current = !!route?.isBluetooth || /\bdji\b/.test(name);
        } catch { usedBtMicRef.current = false; }
      } catch (err) {
        logRecordingEvent({
          type: 'session_start_failed',
          appState: AppState.currentState,
          error: serializeRecordingError(err),
        });
        console.warn('[StartClass] Could not start recording:', err);
        // We just inserted a class_recordings row in the new-pipeline init
        // above, but we can't actually record any chunks. Mark it
        // discarded so it doesn't sit forever in the dashboard's "in
        // progress" list and so the cron sweep stops looking at it.
        if (newPipelineRef.current && recordingIdRef.current) {
          supabase
            .from('class_recordings')
            .update({
              status: 'discarded',
              error: `recorder start failed: ${err?.message ?? String(err)}`,
            })
            .eq('id', recordingIdRef.current)
            .then(() => {}, () => {});
          newPipelineRef.current = false;
          recordingIdRef.current = null;
          userIdRef.current = null;
        }
      }
    }

    const now = Date.now();
    const kind = view === 'private-briefing' ? 'private' : 'group';
    setClassStartedAt(now);
    setChronoMs(0);
    chronoMsRef.current = 0;
    setActiveCoachClass({
      kind,
      startedAt: now,
      studentId: selectedStudent?.id ?? null,
      studentName: selectedStudent?.name ?? null,
      // Persist the picked Latin/Ballroom style so a restore after app-kill
      // re-scopes the debrief to it (else default-retire could retire the OTHER
      // style's untouched focuses for a 2-style student).
      category: briefingCategoryRef.current ?? null,
    });

    try {
      const id = await laStartCoachRecording({
        kind,
        studentName: selectedStudent?.name ?? null,
        startedAt: now,
      });
      liveActivityIdRef.current = id;
      if (id) {
        patchActiveCoachClass({ liveActivityId: id });
        try {
          const perm = await Notifications.getPermissionsAsync();
          if (perm.status !== 'granted') {
            await Notifications.requestPermissionsAsync({
              ios: { allowAlert: true, allowSound: true, allowBadge: true },
            });
          }
        } catch {}
      } else {
        // LA didn't start (most often: Live Activities disabled in iOS
        // Settings, iOS < 16.2, or Low Power Mode). The recording itself
        // still works because background audio is independent of LA. We
        // don't show a blocking alert — just log so we have visibility
        // and so the heartbeat below can still run for state persistence.
        console.warn('[StartClass] Live Activity did not start (id=null). Recording continues without lock-screen widget.');
        await maybeShowLiveActivityHint();
      }
    } catch (err) {
      console.warn('[StartClass] Could not start live activity:', err);
      await maybeShowLiveActivityHint();
    }
    // Heartbeat runs regardless of LA success: it persists
    // lastHeartbeatAt to AsyncStorage which the App.js mount-time
    // recovery flow uses to detect orphan classes after a process kill.
    startHeartbeat();
  }
  async function stopClass() {
    // Idempotent: if a stop is already in progress, ignore re-entries.
    // The Stop button's onPress fires on every tap and there's nothing
    // disabling it during the async work below.
    if (stoppingRef.current) return;
    stoppingRef.current = true;

    // Tear down the "class in progress" surfaces FIRST — before the async
    // recorder teardown below — so quitting the app mid-stop (or before
    // finishing the debrief) never leaves a stale Live Activity widget or a
    // false "class interrupted, please try again" on next launch. Safe to do
    // now: the recording is over and its chunks upload independently of this
    // screen; finishDebrief's clearActiveCoachClass() then no-ops.
    stopHeartbeat();
    // End EVERY coach-recording Live Activity (not only the id we tracked) so a
    // stale/lost activity id can't leave a "class in progress" widget stuck on
    // the lock screen. Native, immediate dismissal.
    try { await laEndAllCoachRecordings(); } catch {}
    liveActivityIdRef.current = null;
    clearActiveCoachClass();

    logRecordingEvent({
      type: 'session_stopping',
      appState: AppState.currentState,
      chunkCount: audioUrisRef.current.length,
      wasInterrupted: interruptedAtMsRef.current != null,
    });

    if (usingNativeRecorderRef.current) {
      // Native path: no JS rotation interval to cancel and no busy-wait
      // to do. stopNativeRecorder triggers a final chunkReady event that
      // the listener routes through recordChunkUri (push + enqueue), then
      // the function waits 150 ms for the event to land before tearing
      // listeners down so we don't lose the tail.
      await stopNativeRecorder();
      await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false, shouldPlayInBackground: false });
    } else {
      stopChunkRotation();
      // If a chunk rotation is mid-flight (it's currently nulling
      // recordingRef.current and starting a new recorder), we MUST wait for
      // it to finish — otherwise we'd leak a still-recording AudioRecorder
      // and our chunk index would be off by one. The rotation completes
      // quickly (stop + create_async ≈ 100-300 ms), so a short busy-wait is
      // the simplest correct synchronization.
      const rotationDeadline = Date.now() + 5000;
      while (rotatingChunkRef.current && Date.now() < rotationDeadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      // Stop recording and keep all chunk URIs for transcription in finishDebrief.
      if (recordingRef.current) {
        try {
          const uri = await stopAndUnloadRecording(recordingRef.current);
          logRecordingEvent({ type: 'final_chunk_stop_ok', hasUri: !!uri });
          await recordChunkUri(uri);
        } catch (err) {
          logRecordingEvent({
            type: 'final_chunk_stop_failed',
            error: serializeRecordingError(err),
          });
          console.warn('[StartClass] Could not stop recording:', err);
        }
        recordingRef.current = null;
        await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false, shouldPlayInBackground: false });
      }
    }

    // If the recording was interrupted, the freeze duration is the truth.
    // Otherwise read from the ref (NOT from the captured chronoMs state)
    // so we get the latest tick — important when stopClass is called via
    // a stale Alert.alert closure created minutes earlier.
    const finalDurationMs = interruptedAtMsRef.current != null ? interruptedAtMsRef.current : chronoMsRef.current;
    interruptedAtMsRef.current = null;
    interruptAlertShownRef.current = false;

    setDebriefDurationMs(finalDurationMs);
    setDebriefNote('');
    setValidatedFpIds([]);
    setClassStartedAt(null);
    setChronoMs(0);
    chronoMsRef.current = 0;

    // Cumulative BT mic airtime: every 4h trigger a reminder both in-app
    // (banner inside the debrief sheet) and as a system notification.
    const shouldRemind = await bumpBtMicUsageAndMaybeRemind(finalDurationMs);
    setChargeReminderInDebrief(shouldRemind);
    if (shouldRemind) {
      try {
        const trigger = Notifications.SchedulableTriggerInputTypes
          ? { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1, repeats: false }
          : { seconds: 1 };
        Notifications.scheduleNotificationAsync({
          content: {
            title: '🔋 Time to charge your mic',
            body: "You've used your Bluetooth mic for 4h. Charge it before your next class.",
            sound: 'default',
            interruptionLevel: 'active',
          },
          trigger,
        }).catch(() => {});
      } catch {}
    }

    setDebriefOpen(true);
    // Stop is now committed (debrief modal up). Allow future stop attempts
    // (e.g. starting a new class then stopping that one).
    stoppingRef.current = false;
  }
  function toggleValidateFp(id) {
    setValidatedFpIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }
  function transcribeAndSubmit(uris, isPrivate, studentId, allStudents, coveredQuestionIds = [], coupleCtx = null) {
    const list = Array.isArray(uris) ? uris.filter(Boolean) : (uris ? [uris] : []);
    const run = async () => {
      try {
        // Capture user.id BEFORE transcription — a long upload/poll can outlive the session
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not signed in — cannot save transcript.');
        const userId = user.id;

        // Transcribe each chunk in order. A failed chunk is skipped (we keep
        // the rest of the class) instead of aborting the whole submission.
        // We accumulate `offsetMs` so the final transcript reads as a single
        // continuous timeline (each chunk natively starts at 00:00). Per-chunk
        // speaker re-labeling ("Coach"/"Élève" via dominant talker heuristic)
        // gives stable role labels even though AssemblyAI numbers speakers
        // independently in each chunk.
        const parts = [];
        let offsetMs = 0;
        for (let i = 0; i < list.length; i++) {
          try {
            const result = await transcribeAudio(list[i]);
            const utterances = result?.utterances || [];
            const speakerLabels = identifyCoachSpeaker(utterances);
            const formatted = formatUtterances(utterances, offsetMs, speakerLabels);
            const text = formatted || result?.text || '';
            if (text.trim()) parts.push(text.trim());
            // Advance the cumulative offset by the actual chunk duration.
            // Fallback to CHUNK_MS if AssemblyAI didn't report a duration —
            // keeps subsequent chunks roughly aligned even on degenerate input.
            offsetMs += result?.durationMs > 0 ? result.durationMs : CHUNK_MS;
          } catch (err) {
            console.warn(`[StartClass] chunk ${i + 1}/${list.length} transcription failed:`, err);
            // Even on failure, advance the offset by the expected chunk size
            // so the timeline of subsequent chunks doesn't collapse onto the
            // failed chunk's slot.
            offsetMs += CHUNK_MS;
          }
        }
        const transcript = parts.join('\n\n').trim();
        if (!transcript) return;
        const { data: classInput, error: insertErr } = await supabase
          .from('class_inputs')
          .insert({
            user_id: userId,
            transcript,
            lesson_type: coupleCtx ? 'couple' : (isPrivate ? 'private' : 'group'),
            student_id: isPrivate ? (studentId ?? null) : null,
            couple_id: coupleCtx?.coupleId ?? null,
            status: 'pending',
          })
          .select('id')
          .single();
        if (insertErr) throw insertErr;
        if (coupleCtx && classInput?.id && coupleCtx.dancerIds?.length > 0) {
          await supabase.from('class_input_students').insert(
            coupleCtx.dancerIds.map((sid) => ({ class_input_id: classInput.id, student_id: sid }))
          );
        } else if (!isPrivate && classInput?.id && allStudents.length > 0) {
          await supabase.from('class_input_students').insert(
            allStudents.map((s) => ({ class_input_id: classInput.id, student_id: s.id }))
          );
        }
        // Backfill the covered_class_input_id on the questions the coach
        // ticked off during the briefing — now that the class_input row
        // exists, ClassDetailScreen can list them under the summary.
        if (classInput?.id && coveredQuestionIds.length > 0) {
          await linkCoveredQuestionsToClass(coveredQuestionIds, classInput.id).catch(() => {});
        }
      } catch (err) {
        console.warn('[StartClass] Background transcription failed:', err);
        Alert.alert('Transcription failed', String(err?.message || err));
      }
    };
    run();
  }

  function finishDebrief() {
    const uris = audioUris;
    const isPrivate = view === 'private-briefing';
    const isNewPipeline = newPipelineRef.current;
    const recordingId = recordingIdRef.current;
    // Capture isLocalMode for the closure — state may shift between now
    // and the navigation callback below.
    const localMode = isLocalMode;

    // Persist coach verdicts on the readiness focuses (fire-and-forget).
    // Default-retire is the core of the rework: a focus point lives only until
    // the coach validates it at a debrief (or the student archives it).
    //   "not yet"  → held; carried over to be reconciled with the new class's
    //                focuses (+2 target on merge, server-side).
    //   everything else (marked "Good" OR left untouched) → status = past:
    //                retired by default, disappears from the student's plan.
    // Couple debriefs write to couple_focus_points (the verdict ids are couple
    // FP ids); the recording coach is the couple coach so RLS allows it.
    const verdictTable = view === 'couple-briefing' ? 'couple_focus_points' : 'focus_points';
    // The same carryover list the debrief UI built from readiness — the old
    // class's still-active, non-held focuses the coach just reviewed.
    const carryoverList =
      view === 'couple-briefing'
        ? (coupleReadinessDetail?.focuses || [])
        : (view === 'private-briefing' && studentReadiness)
          ? (studentReadiness.focuses || [])
          : [];
    const notYetIds = carryoverList
      .map((f) => f.focusPointId)
      .filter((id) => readinessVerdicts[id] === 'not_yet');
    const retireIds = carryoverList
      .map((f) => f.focusPointId)
      .filter((id) => readinessVerdicts[id] !== 'not_yet');
    if (notYetIds.length > 0) {
      supabase
        .from(verdictTable)
        .update({ is_held: true })
        .in('id', notYetIds)
        .then(() => {}, (err) => {
          console.warn('[StartClass] not-yet hold persist failed:', err);
        });
    }
    if (retireIds.length > 0) {
      supabase
        .from(verdictTable)
        .update({ status: 'past' })
        .in('id', retireIds)
        .then(() => {}, (err) => {
          console.warn('[StartClass] default-retire persist failed:', err);
        });
    }
    setReadinessVerdicts({});

    // "Validate focus points covered" — past_candidate focuses the coach
    // explicitly checked off as done during this lesson. Move them
    // straight to status='past' so they stop showing in the student's
    // active focus list. Private view only — the group debrief stores
    // names (not UUIDs) in validatedFpIds and would need a name-lookup
    // sweep across all attending students.
    if (isPrivate && validatedFpIds.length > 0) {
      supabase
        .from('focus_points')
        .update({ status: 'past' })
        .in('id', validatedFpIds)
        .then(() => {}, (err) => {
          console.warn('[StartClass] validated FP persist failed:', err);
        });
    }
    setValidatedFpIds([]);

    // Persist question verdicts (fire-and-forget). "covered" → mark replied
    // with an auto-text so the student sees positive closure. "not_yet" is
    // left as-is (still pending or still in_class for the next session).
    // The covered_class_input_id link is set later by transcribeAndSubmit
    // once the class_input row exists (legacy pipeline). NEW PIPELINE TODO:
    // finalize-class needs to receive coveredQIds (via class_recordings or
    // request body) and apply the same link server-side after creating the
    // class_input row.
    const coveredQIds = Object.entries(questionVerdicts)
      .filter(([, v]) => v === 'covered')
      .map(([id]) => id);
    if (coveredQIds.length > 0) {
      Promise.all(coveredQIds.map(qid => markQuestionCovered(qid).catch(() => {}))).then(() => {});
    }
    setQuestionVerdicts({});

    setDebriefOpen(false);
    setAudioUris([]);
    audioUrisRef.current = [];
    setChargeReminderInDebrief(false);
    usedBtMicRef.current = false;
    clearActiveCoachClass();

    // Reset captured pipeline state — the next class can use a different
    // pipeline if the user toggles the flag.
    newPipelineRef.current = false;
    recordingIdRef.current = null;
    userIdRef.current = null;

    if (localMode && recordingId) {
      // Local-recording mode: phone captured no audio. Just stamp the
      // ended_at so the upload UI can find this row as "awaiting audio
      // upload" (local_recording_mode=true AND ended_at IS NOT NULL AND
      // mic_file_name IS NULL). The coach will plug their DJI mic later
      // and pick the WAV file through the upload screen.
      supabase
        .from('class_recordings')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', recordingId)
        .then(() => {}, (err) => {
          console.warn('[StartClass] local mode ended_at update failed:', err);
        });
      setClassRecorded(true);
      if (popToTopTimerRef.current) clearTimeout(popToTopTimerRef.current);
      popToTopTimerRef.current = setTimeout(() => {
        popToTopTimerRef.current = null;
        setClassRecorded(false);
        try { navigation.popToTop(); } catch {}
      }, 2500);
      return;
    }

    if (uris.length > 0) {
      if (isNewPipeline && recordingId) {
        // New pipeline: chunks are already uploading / uploaded to Storage.
        // Mark the recording 'ready' with the expected chunk count and call
        // finalize-class. The edge function takes over from here. The coach
        // is free to navigate away or start another class immediately.
        finalizeNewPipelineRecording(recordingId, uris.length).catch((err) => {
          console.warn('[StartClass] finalize-class call failed (will be picked up by cron):', err);
        });
      } else {
        // Legacy path: client-side AssemblyAI per chunk.
        transcribeAndSubmit(
          uris, isPrivate, selectedStudent?.id, students, coveredQIds,
          view === 'couple-briefing' && selectedCouple
            ? { coupleId: selectedCouple.coupleId, dancerIds: [selectedCouple.dancerA?.id, selectedCouple.dancerB?.id].filter(Boolean) }
            : null,
        );
      }
      setClassRecorded(true);
      if (popToTopTimerRef.current) clearTimeout(popToTopTimerRef.current);
      popToTopTimerRef.current = setTimeout(() => {
        popToTopTimerRef.current = null;
        setClassRecorded(false);
        try { navigation.popToTop(); } catch {}
      }, 2500);
    } else {
      navigation.popToTop();
    }
  }

  // Mark a class_recordings ready and ask the server to finalize. Best-effort:
  // even if this call fails, the cron retry sweep (transcribe-class-retry)
  // will pick the recording up once chunks are fully uploaded.
  async function finalizeNewPipelineRecording(recordingId, expectedChunks) {
    try {
      const { error: updErr } = await supabase
        .from('class_recordings')
        .update({
          status: 'ready',
          expected_chunks: expectedChunks,
          ended_at: new Date().toISOString(),
          last_heartbeat_at: new Date().toISOString(),
        })
        .eq('id', recordingId);
      if (updErr) throw updErr;

      // Always re-poke the upload worker so any still-pending chunks get
      // attempted right away. finalize-class will return 202 "waiting" if
      // chunks are still uploading; the cron will retry.
      pokeUploadWorker();

      const { data: { session } } = await supabase.auth.getSession();
      const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/finalize-class`;
      // Fire-and-forget — we don't need to wait for the response.
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ recording_id: recordingId }),
      }).catch(() => {});
    } catch (err) {
      console.warn('[StartClass] finalizeNewPipelineRecording error:', err);
    }
  }

  // Detail data loaded when student is picked
  const [focusPoints, setFocusPoints] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [openQuestions, setOpenQuestions] = useState([]);
  const [viewingQuestion, setViewingQuestion] = useState(null);
  const [lastClass, setLastClass] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Couple detail (mirrors the solo briefing layout, driven by couple data).
  const [coupleReadinessDetail, setCoupleReadinessDetail] = useState(null);
  const [coupleFps, setCoupleFps] = useState([]);
  // Readiness pulled from the student's previous private (focuses + tiers).
  // Coach uses this as a "check during the lesson" list and a post-lesson
  // verdict capture (good / not yet).
  const [studentReadiness, setStudentReadiness] = useState(null);
  const [readinessVerdicts, setReadinessVerdicts] = useState({}); // { [fpId]: 'good' | 'not_yet' }
  const [questionVerdicts, setQuestionVerdicts] = useState({}); // { [qId]: 'covered' | 'not_yet' }
  const [confirmingNotYet, setConfirmingNotYet] = useState(null); // { focusPointId, name } | null

  // Group data
  const [groupFPs, setGroupFPs] = useState([]);
  const [groupStats, setGroupStats] = useState({ avgSessions: 0, totalQuestions: 0 });
  const [attentionStudents, setAttentionStudents] = useState([]);
  const [groupLoading, setGroupLoading] = useState(false);

  // Load student detail when picked. Per-student reads go through the
  // shared context cache so tapping the same student twice is instant
  // (60s TTL — long enough for a select→briefing→back→briefing trip).
  // When a coach teaches the SAME student both styles, they pick Latin/Ballroom
  // before the briefing opens — so the readiness AND the end-of-class debrief are
  // scoped to that style (the right focus points show, and default-retire only
  // touches that style's focuses).
  const [stylePicker, setStylePicker] = useState(null); // student awaiting style choice
  const loadStudentDetail = useCallback(async (student, category = null) => {
    setSelectedStudent(student);
    briefingCategoryRef.current = category ?? null; // read by startClassNow
    // Clear the previous student's secondary data so it doesn't flash while
    // this one's phase-2 loads.
    setQuestions([]);
    setOpenQuestions([]);
    setLastClass(null);
    setReadinessVerdicts({});
    setQuestionVerdicts({});
    setDetailLoading(true);
    setView('private-briefing');
    const sk = `student:${student.id}`;

    // Phase 1 — the core the coach needs to review + START the class: focus
    // points + readiness. Drop the loading gate as soon as these land (they're
    // prefetched on roster load, so usually already warm/in-flight) — the coach
    // can start without waiting on the secondary data below.
    try {
      const [fps, readiness] = await Promise.all([
        getOrFetch(`${sk}:fps`, () => getStudentFocusPoints(student.id).catch(() => [])),
        getOrFetch(`${sk}:readiness:${category || 'all'}`, () => getLessonReadiness(student.id, category).catch(() => null)),
      ]);
      setFocusPoints(fps || []);
      setStudentReadiness(readiness);
    } catch {}
    setDetailLoading(false);

    // Phase 2 — secondary detail (questions, open questions, recent activity →
    // last class). Fills in behind the already-usable briefing.
    try {
      const [qs, openQs, activity] = await Promise.all([
        getOrFetch(`${sk}:questions`, () => getStudentQuestions(student.id).catch(() => [])),
        getOrFetch(`${sk}:openQuestions`, () => getStudentOpenQuestions(student.id).catch(() => [])),
        getOrFetch(`${sk}:activity:40`, () => getStudentRecentActivity(student.id, 40).catch(() => [])),
      ]);
      setQuestions(qs || []);
      setOpenQuestions(openQs || []);

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
  }, []);

  // Open a student's briefing. If this coach teaches them BOTH styles, ask which
  // one first (so readiness/debrief are scoped to it); otherwise open directly
  // on the single style this coach coaches them in.
  const pickStudent = useCallback((student) => {
    const styles = student?.coachStyles || [];
    if (styles.includes('latin') && styles.includes('ballroom')) {
      setStylePicker(student);
    } else {
      loadStudentDetail(student, styles[0] || null);
    }
  }, [loadStudentDetail]);

  // "Latin or Ballroom?" picker — shown when the coach taps a student they teach
  // both styles. The choice scopes the briefing readiness AND the debrief focuses.
  function renderStylePicker() {
    return (
      <Modal
        visible={!!stylePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setStylePicker(null)}
      >
        {stylePicker && (
          <Pressable style={notYet.backdrop} onPress={() => setStylePicker(null)}>
            <Pressable style={notYet.card} onPress={() => { /* swallow */ }}>
              <HeroCardGradient />
              <View style={notYet.iconWrap}>
                <Ionicons name="albums-outline" size={22} color="#F6D27A" />
              </View>
              <Text style={notYet.title}>Latin or Ballroom?</Text>
              <Text style={notYet.body}>
                <Text>You coach </Text>
                <Text style={notYet.bodyAccent}>{stylePicker.name}</Text>
                <Text> in both — which class are you starting?</Text>
              </Text>
              <TouchableOpacity
                style={notYet.primaryBtn}
                activeOpacity={0.85}
                onPress={() => { const st = stylePicker; setStylePicker(null); loadStudentDetail(st, 'latin'); }}
              >
                <Text style={notYet.primaryBtnText}>Latin</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[notYet.primaryBtn, { marginTop: 8 }]}
                activeOpacity={0.85}
                onPress={() => { const st = stylePicker; setStylePicker(null); loadStudentDetail(st, 'ballroom'); }}
              >
                <Text style={notYet.primaryBtnText}>Ballroom</Text>
              </TouchableOpacity>
              <TouchableOpacity style={notYet.secondaryBtn} activeOpacity={0.7} onPress={() => setStylePicker(null)}>
                <Text style={notYet.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        )}
      </Modal>
    );
  }

  // Couple equivalent of loadStudentDetail — loads the same kinds of data so the
  // couple briefing can mirror the solo layout. (Couples have no "class recap"
  // or "questions" data, so those sections simply don't render.)
  const loadCoupleDetail = useCallback(async (couple) => {
    setSelectedCouple(couple);
    setDetailLoading(true);
    setView('couple-briefing');
    try {
      const ck = `couple:${couple.coupleId}`;
      const [readiness, fps, activity] = await Promise.all([
        getOrFetch(`${ck}:readiness`, () => getCoupleReadiness(couple.coupleId, null).catch(() => null)),
        getOrFetch(`${ck}:fps`, () => getCoupleFocusPoints(couple.coupleId).catch(() => [])),
        getOrFetch(`${ck}:activity`, () => getCoupleActivity(couple.coupleId, 80).catch(() => [])),
      ]);
      // Compute this-week practice counts per focus from the practice logs.
      const weekAgo = Date.now() - 7 * 86400000;
      const weekByName = {};
      for (const ev of activity || []) {
        if (ev.completedAt && new Date(ev.completedAt).getTime() >= weekAgo) {
          weekByName[ev.focusName] = (weekByName[ev.focusName] || 0) + 1;
        }
      }
      const enriched = (fps || []).map((fp) => ({ ...fp, weekCount: weekByName[fp.name] || 0 }));
      setCoupleReadinessDetail(readiness);
      setCoupleFps(enriched);
      setReadinessVerdicts({});
      setQuestionVerdicts({});
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
      const isBT = !!audioRoute?.isBluetooth;
      const routeName = audioRoute?.name || 'iPhone mic';
      return (
        <View style={s.bottomBar}>
          <View style={s.runningRow}>
            <View style={s.runningDot} />
            <Text style={s.runningTime}>{formatChrono(chronoMs)}</Text>
            {/* Audio-route badge is meaningless in local-recording mode —
                the phone holds no audio session so audioRoute would always
                be null and the fallback "iPhone mic" label would mislead
                the coach into thinking the phone is capturing audio. The
                DJI mic state is fully independent and surfaced via the
                separate REC/STOP confirmation modals. */}
            {!isLocalMode && (
              <View style={s.audioBadge}>
                <View style={[s.audioBadgeDot, { backgroundColor: isBT ? '#4AAF52' : '#D44545' }]} />
                <Text style={s.audioBadgeText} numberOfLines={1}>{routeName}</Text>
              </View>
            )}
            <TouchableOpacity
              style={s.stopBtn}
              activeOpacity={0.88}
              onPress={() => {
                // Local-recording mode: gate stopClass behind a "press STOP
                // on your DJI mic" confirmation. Pressing STOP on the mic
                // closes the WAV file's header (so its duration metadata is
                // valid for matching). Without the prompt the coach can end
                // the class in the app while the mic is still recording,
                // leaving an open file on the device until the next press.
                if (isLocalMode) setRecStopConfirmOpen(true);
                else stopClass();
              }}
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

    // Open questions to debrief — both pending (coach hadn't decided yet)
    // and dismissed (coach committed to addressing them in this class).
    // Tapping a row opens the detail popup; the inline "Answered" pill
    // toggles a verbal-resolution mark. Both are optional — questions
    // don't gate Done.
    const questionsToAddress = view === 'private-briefing' ? (openQuestions || []) : [];
    const coveredCount = Object.values(questionVerdicts).filter(v => v === 'covered').length;

    // Carryover focuses from the student's last class. Each can be marked
    // "Not yet" to keep training it (carried over, reconciled with the new
    // class's focuses). Anything left unmarked is retired by default on Done —
    // a focus point lives only until the coach validates it. Done is never gated.
    const carryoverFocuses =
      view === 'couple-briefing'
        ? (coupleReadinessDetail?.focuses || [])
        : (view === 'private-briefing' && studentReadiness)
          ? (studentReadiness.focuses || [])
          : [];

    return (
      <Modal
        visible={debriefOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setDebriefOpen(false)}
      >
        {/* SafeAreaProvider is required here because Modal renders into a
            separate React tree and doesn't inherit the host app's provider —
            without this, `edges={['top']}` would resolve to 0 on iPhones
            with a notch / dynamic island and the title bleeds into the
            status bar. */}
        <SafeAreaProvider>
          <SafeAreaView style={db.screen} edges={['top']}>
            <View style={db.topBar}>
              <View style={db.headerIcon}>
                <Ionicons name="checkmark" size={20} color={C.green} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={db.headerTitle}>Class ended</Text>
                <Text style={db.headerSub}>Wrap up with a quick debrief</Text>
              </View>
            </View>

          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            <View style={db.durationBar}>
              <Ionicons name="time-outline" size={16} color="#F6D27A" />
              <Text style={db.durationText}>
                Duration{' '}
                <Text style={db.durationDim}>
                  · {totalMin} min
                  {list.length > 0 ? ` · ${validatedCount}/${list.length} focus` : ''}
                  {questionsToAddress.length > 0 ? ` · ${coveredCount}/${questionsToAddress.length} questions` : ''}
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

            {/* Readiness verdicts — carryover focuses to validate. Solo and
                 couple alike: good → archive, not yet → held (15-min target). */}
            {carryoverFocuses.length > 0 && (
              <>
                <Text style={db.secLabel}>How did it go?</Text>
                <Text style={db.verdictHint}>
                  Tap “Not yet” to keep training a focus. Anything you leave
                  unmarked is retired when you tap Done.
                </Text>
                <View style={db.verdictList}>
                  {carryoverFocuses.map((f) => {
                    const verdict = readinessVerdicts[f.focusPointId];
                    return (
                      <View key={f.focusPointId} style={db.verdictRow}>
                        <Text style={db.verdictName} numberOfLines={1}>{f.name}</Text>
                        <View style={db.verdictBtns}>
                          <TouchableOpacity
                            style={[db.verdictBtn, verdict === 'good' && db.verdictBtnGood]}
                            activeOpacity={0.75}
                            onPress={() =>
                              setReadinessVerdicts((prev) => ({
                                ...prev,
                                [f.focusPointId]: prev[f.focusPointId] === 'good' ? null : 'good',
                              }))
                            }
                          >
                            <Ionicons
                              name="checkmark"
                              size={13}
                              color={verdict === 'good' ? '#fff' : C.green}
                            />
                            <Text
                              style={[
                                db.verdictBtnText,
                                { color: verdict === 'good' ? '#fff' : C.green },
                              ]}
                            >
                              Good
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[db.verdictBtn, verdict === 'not_yet' && db.verdictBtnNotYet]}
                            activeOpacity={0.75}
                            onPress={() => {
                              // Already "not yet"? toggle off without prompt.
                              if (verdict === 'not_yet') {
                                setReadinessVerdicts((prev) => ({ ...prev, [f.focusPointId]: null }));
                                return;
                              }
                              // First-time Not yet → confirm so the coach
                              // realises the focus rolls over into the next
                              // class instead of being archived.
                              setConfirmingNotYet({ focusPointId: f.focusPointId, name: f.name });
                            }}
                          >
                            <Text
                              style={[
                                db.verdictBtnText,
                                { color: verdict === 'not_yet' ? '#fff' : C.orange },
                              ]}
                            >
                              Not yet
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </>
            )}

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

            {/* Questions debrief — tap row to read the full question +
                reply in the popup. The inline "Answered" pill toggles a
                verbal-resolution mark (optional, doesn't gate Done). */}
            {questionsToAddress.length > 0 && (
              <>
                <Text style={db.secLabel}>Questions addressed</Text>
                <View style={db.verdictList}>
                  {questionsToAddress.map((q) => {
                    const verdict = questionVerdicts[q.id];
                    const isInClass = q.status === 'dismissed';
                    const isAnswered = verdict === 'covered';
                    return (
                      <TouchableOpacity
                        key={q.id}
                        style={db.verdictRow}
                        activeOpacity={0.75}
                        onPress={() => setViewingQuestion(q)}
                      >
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={db.verdictName} numberOfLines={2}>{q.message}</Text>
                          {isInClass && (
                            <Text style={db.verdictMeta}>Flagged for this class</Text>
                          )}
                        </View>
                        <TouchableOpacity
                          style={[db.verdictBtn, isAnswered && db.verdictBtnGood]}
                          activeOpacity={0.75}
                          onPress={(e) => {
                            e.stopPropagation();
                            setQuestionVerdicts((prev) => ({
                              ...prev,
                              [q.id]: prev[q.id] === 'covered' ? null : 'covered',
                            }));
                          }}
                        >
                          <Ionicons
                            name="checkmark"
                            size={13}
                            color={isAnswered ? '#fff' : C.green}
                          />
                          <Text
                            style={[
                              db.verdictBtnText,
                              { color: isAnswered ? '#fff' : C.green },
                            ]}
                          >
                            Answered
                          </Text>
                        </TouchableOpacity>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {audioUris.length > 0 && (
              <View style={db.recBanner}>
                <Ionicons name="mic" size={14} color={C.orange} />
                <Text style={db.recBannerText}>
                  {audioUris.length === 1
                    ? 'Recording ready, will be transcribed on Done'
                    : `${audioUris.length} segments captured, will be transcribed on Done`}
                </Text>
              </View>
            )}

            {chargeReminderInDebrief && (
              <View style={db.recBanner}>
                <Ionicons name="battery-charging" size={14} color={C.orange} />
                <Text style={db.recBannerText}>
                  Don't forget to charge your mic for next session
                </Text>
              </View>
            )}
          </ScrollView>

            <View style={db.bottomBar}>
              <TouchableOpacity
                style={db.btnDone}
                activeOpacity={0.88}
                onPress={finishDebrief}
              >
                <Text style={db.btnDoneText}>Done</Text>
              </TouchableOpacity>
            </View>

            {/* "Not yet" confirmation — clicking Not yet on a focus carries
                it over into the next class instead of archiving it. */}
            <Modal
              visible={!!confirmingNotYet}
              transparent
              animationType="fade"
              onRequestClose={() => setConfirmingNotYet(null)}
            >
              {confirmingNotYet && (
                <Pressable style={notYet.backdrop} onPress={() => setConfirmingNotYet(null)}>
                  <Pressable style={notYet.card} onPress={() => { /* swallow */ }}>
                    <HeroCardGradient />
                    <View style={notYet.iconWrap}>
                      <Ionicons name="refresh" size={22} color="#F6D27A" />
                    </View>
                    <Text style={notYet.title}>Keep training this?</Text>
                    <Text style={notYet.body}>
                      <Text style={notYet.bodyAccent}>{confirmingNotYet.name}</Text>
                      <Text> will stay on your student's plan and carry over into your next class.</Text>
                    </Text>
                    <TouchableOpacity
                      style={notYet.primaryBtn}
                      activeOpacity={0.85}
                      onPress={() => {
                        setReadinessVerdicts((prev) => ({
                          ...prev,
                          [confirmingNotYet.focusPointId]: 'not_yet',
                        }));
                        setConfirmingNotYet(null);
                      }}
                    >
                      <Text style={notYet.primaryBtnText}>Yes, keep training</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={notYet.secondaryBtn}
                      activeOpacity={0.7}
                      onPress={() => setConfirmingNotYet(null)}
                    >
                      <Text style={notYet.secondaryBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  </Pressable>
                </Pressable>
              )}
            </Modal>

            {/* Question detail popup — also rendered at the briefing
                level, but Modals are global so duplicating is fine. */}
            <Modal
              visible={!!viewingQuestion}
              transparent
              animationType="fade"
              onRequestClose={() => setViewingQuestion(null)}
            >
              {viewingQuestion && (
                <QuestionDetailSheet
                  question={viewingQuestion}
                  role="coach"
                  onClose={() => setViewingQuestion(null)}
                />
              )}
            </Modal>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    );
  }

  function renderAudioModal() {
    const soundsGood = inputLevel > SOUND_GOOD_DBFS;
    const externals = availableInputs.filter(isExternalMic);
    const phoneMic = availableInputs.find(isPhoneMic);
    return (
      <Modal
        visible={audioModalOpen}
        transparent
        animationType="slide"
        onRequestClose={closeAudioModal}
      >
        <Pressable style={ad.overlay} onPress={closeAudioModal}>
          <Pressable style={ad.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={ad.handle} />
            <View style={ad.iconWrap}>
              <Ionicons name="mic" size={24} color={micPermGranted === false ? C.red : C.orange} />
            </View>
            <Text style={ad.title}>Choose your mic</Text>
            <Text style={ad.subtitle}>
              {micPermGranted === false
                ? 'Microphone access denied. Enable it in Settings to record classes.'
                : 'Pick the audio source for this class. Speak to check the level.'}
            </Text>

            {micPermGranted !== false && externals.length === 0 && (
              <View style={ad.searching}>
                <View style={ad.searchingCoreWrap}>
                  <Animated.View
                    style={[
                      ad.searchingRing,
                      {
                        transform: [{ scale: searchRing1.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }],
                        opacity: searchRing1.interpolate({ inputRange: [0, 0.05, 1], outputRange: [0, 0.55, 0] }),
                      },
                    ]}
                  />
                  <Animated.View
                    style={[
                      ad.searchingRing,
                      {
                        transform: [{ scale: searchRing2.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }],
                        opacity: searchRing2.interpolate({ inputRange: [0, 0.05, 1], outputRange: [0, 0.55, 0] }),
                      },
                    ]}
                  />
                  <View style={ad.searchingCore}>
                    <Ionicons name="bluetooth" size={18} color={C.orange} />
                  </View>
                </View>
                <Text style={ad.searchingTitle}>Connect a Bluetooth mic</Text>
                <Text style={ad.searchingSub}>Searching for nearby devices…</Text>
              </View>
            )}

            {micPermGranted !== false && externals.length > 0 && (
              <View style={ad.chips}>
                {externals.map((input) => {
                  const selected = input.uid === selectedInputUid;
                  return (
                    <View
                      key={input.uid}
                      style={[
                        ad.chip,
                        selected && ad.chipSelected,
                        selected && sustainedSoundsGood && ad.chipSelectedGood,
                      ]}
                    >
                      <TouchableOpacity
                        style={ad.chipRow}
                        activeOpacity={0.85}
                        onPress={() => pickInput(input.uid)}
                      >
                        <View
                          style={[
                            ad.chipIcon,
                            selected && ad.chipIconSelected,
                            selected && sustainedSoundsGood && ad.chipIconSelectedGood,
                          ]}
                        >
                          <Ionicons
                            name={input.isBluetooth ? 'bluetooth' : input.type === 'wired' ? 'headset' : 'mic'}
                            size={16}
                            color={selected ? C.text : C.gray}
                          />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={ad.chipName}>{input.name}</Text>
                          <Text style={ad.chipMeta}>
                            {input.type === 'bluetooth' ? 'Bluetooth' : input.type === 'wired' ? 'Wired' : input.type}
                          </Text>
                        </View>
                        {selected && (
                          <View
                            style={[
                              ad.chipDot,
                              { backgroundColor: sustainedSoundsGood ? C.green : C.gray },
                            ]}
                          />
                        )}
                      </TouchableOpacity>
                      {selected && (
                        <View style={ad.waveBlock}>
                          <View style={ad.waveBars}>
                            {waveBars.map((anim, i) => (
                              <Animated.View
                                key={i}
                                style={[
                                  ad.waveBar,
                                  {
                                    backgroundColor: sustainedSoundsGood ? C.green : C.orange,
                                    transform: [{ scaleY: anim }],
                                  },
                                ]}
                              />
                            ))}
                          </View>
                          <Text style={[ad.waveLabel, sustainedSoundsGood && { color: C.green }]}>
                            {sustainedSoundsGood ? '● Sounds good' : '○ Listening…'}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            <View style={ad.actions}>
              <TouchableOpacity
                style={ad.btnStart}
                activeOpacity={0.88}
                onPress={() => handleStartTap(phoneMic)}
              >
                <Text style={ad.btnStartText}>Start class</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
          {renderNoMicPrompt()}
          {renderRecordingConsentPrompt()}
        </Pressable>
      </Modal>
    );
  }

  function handleStartTap(phoneMic) {
    // First class ever for this coach → consent gate before anything else.
    if (!consentGiven) {
      pendingPhoneMicRef.current = phoneMic ?? null;
      setConsentOpen(true);
      return;
    }
    proceedStartTap(phoneMic);
  }

  function proceedStartTap(phoneMic) {
    if (selectedInputUid) {
      startClassNow();
      return;
    }
    phoneMicRef.current = phoneMic ?? null;
    setNoMicPromptOpen(true);
  }

  function acceptRecordingConsent() {
    setConsentGiven(true);
    setConsentOpen(false);
    const uid = authUser?.id;
    if (uid) {
      const now = new Date().toISOString();
      // Local flag = instant gate next time; DB stamp = evidence of consent.
      // Both best-effort — neither blocks starting the class.
      AsyncStorage.setItem(`coach.recordingConsent:${uid}`, now).catch(() => {});
      supabase.from('users').update({ recording_consent_at: now }).eq('id', uid).then(
        () => {},
        () => {},
      );
    }
    proceedStartTap(pendingPhoneMicRef.current);
  }

  async function confirmUsePhoneMic() {
    setNoMicPromptOpen(false);
    const phoneMic = phoneMicRef.current;
    if (phoneMic) {
      try { await setPreferredInput(phoneMic.uid); } catch {}
      setSelectedInputUid(phoneMic.uid);
    }
    startClassNow();
  }

  function dismissNoMicPrompt() {
    setNoMicPromptOpen(false);
    refreshInputList().catch(() => {});
  }

  function renderRecordingConsentPrompt() {
    if (!consentOpen) return null;
    // Non-dismissible: the coach must explicitly accept or cancel.
    return (
      <Pressable style={ad.popupOverlay}>
        <Pressable style={ad.popupCard} onPress={(e) => e.stopPropagation()}>
          <View style={ad.popupIconWrap}>
            <Ionicons name="mic" size={22} color={C.orange} />
          </View>
          <Text style={ad.popupTitle}>Before you record</Text>
          <Text style={ad.popupBody}>
            You're responsible for getting everyone's agreement before you record them,
            including a parent or guardian for anyone under 18. InBetween stores the audio
            and transcript securely and uses them only to generate focus points.
          </Text>
          <View style={ad.popupActions}>
            <TouchableOpacity
              style={ad.popupBtnGhost}
              activeOpacity={0.8}
              onPress={() => setConsentOpen(false)}
            >
              <Text style={ad.popupBtnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={ad.popupBtnPrimary}
              activeOpacity={0.85}
              onPress={acceptRecordingConsent}
            >
              <Text style={ad.popupBtnPrimaryText}>I have consent</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    );
  }

  function renderNoMicPrompt() {
    if (!noMicPromptOpen) return null;
    return (
      <Pressable style={ad.popupOverlay} onPress={dismissNoMicPrompt}>
        <Pressable style={ad.popupCard} onPress={(e) => e.stopPropagation()}>
          <View style={ad.popupIconWrap}>
            <Ionicons name="mic-off" size={22} color={C.orange} />
          </View>
          <Text style={ad.popupTitle}>No microphone selected</Text>
          <Text style={ad.popupBody}>
            A Bluetooth microphone is recommended for the best transcription quality.
          </Text>
          <View style={ad.popupActions}>
            <TouchableOpacity
              style={ad.popupBtnGhost}
              activeOpacity={0.8}
              onPress={confirmUsePhoneMic}
            >
              <Text style={ad.popupBtnGhostText}>Use phone's mic</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={ad.popupBtnPrimary}
              activeOpacity={0.85}
              onPress={dismissNoMicPrompt}
            >
              <Text style={ad.popupBtnPrimaryText}>Connect</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    );
  }

  // Local-recording confirmations — high-stakes gates that get the coach to
  // physically press REC / STOP on the DJI mic before the in-app action
  // proceeds. Rendered as the dark MicCueSheet bottom sheet (non-dismissible:
  // the coach must Cancel or confirm).

  function renderRecStartConfirmPrompt() {
    return (
      <MicCueSheet
        visible={recStartConfirmOpen}
        mode="start"
        onCancel={() => setRecStartConfirmOpen(false)}
        onConfirm={() => {
          setRecStartConfirmOpen(false);
          startClassNow();
        }}
      />
    );
  }

  function renderRecStopConfirmPrompt() {
    return (
      <MicCueSheet
        visible={recStopConfirmOpen}
        mode="stop"
        onCancel={() => setRecStopConfirmOpen(false)}
        onConfirm={() => {
          setRecStopConfirmOpen(false);
          // Let the sheet's Modal finish dismissing before stopClass opens the
          // debrief Modal — iOS won't present a second modal while the first is
          // still animating out, so the debrief would silently fail to appear.
          setTimeout(() => stopClass(), 350);
        }}
      />
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

  // ── VIEW 1: Start class landing — readiness roster + group card ────────
  if (view === 'select') {
    const totalStudents = students.length;
    return (
      <View style={{ flex: 1 }}>
        <LinearGradient
          colors={['#F7F6F3', '#F4EFDC', '#F9DF9B']}
          locations={[0, 0.55, 1]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.95, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <View style={sc.topBar}>
            <TouchableOpacity
              style={sc.iconBtn}
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={18} color="#0A0A0A" />
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={sc.topLabel}>NEW CLASS</Text>
            </View>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView
            contentContainerStyle={sc.scroll}
            showsVerticalScrollIndicator={false}
          >
            <Text style={sc.heading}>Start a class</Text>
            <Text style={sc.subtitle}>
              Pick a student to see what they've worked on lately.
            </Text>

            {/* Solo / Couple toggle — sliding pill */}
            <View
              style={sc.modeToggle}
              onLayout={(e) => setToggleW(e.nativeEvent.layout.width)}
            >
              {toggleW > 0 && (
                <Animated.View
                  style={[
                    sc.modeThumb,
                    {
                      width: (toggleW - 10) / 2,
                      transform: [{
                        translateX: modeSlide.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, (toggleW - 10) / 2],
                        }),
                      }],
                    },
                  ]}
                />
              )}
              <TouchableOpacity
                style={sc.modeTab}
                onPress={() => selectMode('solo')}
                activeOpacity={0.85}
              >
                <View style={[sc.modeDot, { backgroundColor: '#E8B530' }]} />
                <Text style={[sc.modeTabTxt, pickMode === 'solo' && sc.modeTabTxtOn]}>Solo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={sc.modeTab}
                onPress={() => selectMode('couple')}
                activeOpacity={0.85}
              >
                <View style={[sc.modeDot, { backgroundColor: '#2E4670' }]} />
                <Text style={[sc.modeTabTxt, pickMode === 'couple' && sc.modeTabTxtOn]}>Couple</Text>
              </TouchableOpacity>
            </View>

            {pickMode === 'solo' ? (
              <>
            <View style={sc.eyebrowRow}>
              <View style={sc.eyebrowAccent} />
              <Text style={sc.eyebrowText}>PRIVATE WITH...</Text>
              <View style={sc.eyebrowRule} />
              <Text style={sc.eyebrowRight}>Sorted by readiness</Text>
            </View>

            {rosterLoading && roster.length === 0 ? (
              <View style={sc.loadingWrap}>
                <ActivityIndicator color="#E8B530" />
              </View>
            ) : roster.length === 0 ? (
              <Text style={sc.emptyText}>
                No students yet — share your invite code to connect students.
              </Text>
            ) : (
              roster.map((st) => (
                <PrivateCard
                  key={st.id}
                  st={st}
                  onPress={() => pickStudent(students.find(x => x.id === st.id) || st)}
                />
              ))
            )}
              </>
            ) : (
              <>
            <View style={sc.eyebrowRow}>
              <View style={[sc.eyebrowAccent, { backgroundColor: '#2E4670' }]} />
              <Text style={[sc.eyebrowText, { color: '#2E4670' }]}>COUPLES</Text>
              <View style={sc.eyebrowRule} />
            </View>

            {couples.length === 0 ? (
              <Text style={sc.emptyText}>
                No couples yet — pair two students from their profiles.
              </Text>
            ) : (
              couples.map((c) => {
                const lp = c.lastPrivateClassDate ? new Date(c.lastPrivateClassDate) : null;
                const meta = lp
                  ? `Last private · ${MONTHS[lp.getMonth()]} ${lp.getDate()}`
                  : 'No couple private yet';
                return (
                <TouchableOpacity
                  key={c.coupleId}
                  style={sc.card}
                  activeOpacity={0.85}
                  onPress={() => loadCoupleDetail(c)}
                >
                  <View style={sc.coupleAvWrap}>
                    {[c.dancerA, c.dancerB].map((d, i) => (
                      <View key={i} style={[sc.coupleAv, i === 1 && sc.coupleAv2]}>
                        {d?.avatarUrl ? (
                          <Image source={{ uri: d.avatarUrl }} style={sc.coupleAvPhoto} />
                        ) : (
                          <Text style={sc.coupleAvText}>{(d?.name || '?')[0]?.toUpperCase()}</Text>
                        )}
                      </View>
                    ))}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={sc.cardName} numberOfLines={1}>{c.name}</Text>
                    <Text style={sc.cardMeta} numberOfLines={1}>{meta}</Text>
                  </View>
                  <View style={sc.right}>
                    {c.readiness != null && (
                      <View style={sc.readyWrap}>
                        <Text style={sc.readyN}>{c.readiness}<Text style={sc.readyPct}>%</Text></Text>
                      </View>
                    )}
                    <Ionicons name="chevron-forward" size={16} color="rgba(10,10,10,0.4)" />
                  </View>
                </TouchableOpacity>
                );
              })
            )}
              </>
            )}

            <View style={sc.orRow}>
              <View style={sc.eyebrowAccent} />
              <Text style={sc.eyebrowText}>OR</Text>
              <View style={sc.eyebrowRule} />
            </View>

            <TouchableOpacity
              style={sc.groupCard}
              activeOpacity={0.88}
              onPress={loadGroupData}
            >
              <View style={sc.groupIconBtn}>
                <Ionicons name="people" size={20} color="#E8B530" />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={sc.groupTitle}>Group class</Text>
                <Text style={sc.groupSub}>
                  {totalStudents} student{totalStudents === 1 ? '' : 's'} · auto-included
                </Text>
              </View>
              <View style={sc.groupAvatars}>
                {students.slice(0, 2).map((st, i) => {
                  const isSilent = st.status === 'silent';
                  const initial = (st.name || 'S')[0]?.toUpperCase() || 'S';
                  return (
                    <View
                      key={st.id}
                      style={[
                        sc.groupAv,
                        i === 0 && { marginLeft: 0 },
                        isSilent
                          ? { backgroundColor: '#F7D8D8' }
                          : { backgroundColor: '#4E6A5C' },
                      ]}
                    >
                      {st.photoUrl ? (
                        <Image source={{ uri: st.photoUrl }} style={sc.groupAvPhoto} />
                      ) : (
                        <Text
                          style={[
                            sc.groupAvText,
                            isSilent && { color: '#E84545' },
                          ]}
                        >
                          {initial}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
            </TouchableOpacity>
          </ScrollView>
          {renderStylePicker()}
        </SafeAreaView>
      </View>
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
                onPress={() => pickStudent(st)}
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
        {renderStylePicker()}
      </SafeAreaView>
    );
  }

  // ── VIEW 3: Private briefing ───────────────────────────────────────────
  if (view === 'private-briefing' && selectedStudent) {
    const st = selectedStudent;
    const stuckPoints = focusPoints.filter(fp => fp.weekCount === 0);
    const trainedPoints = focusPoints.filter(fp => (fp.weekCount || 0) > 0);
    // Hero stats use the "since last private class with FPs" window
    // (same as the readiness ring) so the 3 numbers stay consistent with the
    // "X% ready" subtitle. Falls back to the 7-day window if readiness is
    // null (new student / unprocessed class).
    const readinessFocuses = studentReadiness?.focuses || [];
    const sessionsCount = studentReadiness
      ? readinessFocuses.reduce((a, f) => a + (f.done || 0), 0)
      : focusPoints.reduce((a, fp) => a + (fp.weekCount || 0), 0);
    const focusTrained = studentReadiness
      ? readinessFocuses.filter(f => (f.done || 0) > 0).length
      : trainedPoints.length;
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
          contentContainerStyle={{ paddingTop: HERO_FULL + 76, paddingBottom: 200 }}
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
            </View>
          )}

          {/* Carryover from last private — what to check during this lesson */}
          {(!!studentReadiness && (studentReadiness.focuses || []).length > 0) || openQuestions.length > 0 ? (
            <View style={pb.checkCard}>
              <View style={pb.checkHeader}>
                <View style={pb.checkBadge}>
                  <Text style={pb.checkBadgeText}>CHECK DURING THIS LESSON</Text>
                </View>
                {!!studentReadiness && (
                  <Text style={pb.checkPct}>{studentReadiness.percent}%</Text>
                )}
              </View>
              {!!studentReadiness && (studentReadiness.focuses || []).length > 0 && (
                <>
                  <Text style={pb.checkHint}>
                    Carryover from {st.name.split(' ')[0]}'s last private. Validate each at the end.
                  </Text>
                  <View style={pb.checkRows}>
                    {studentReadiness.focuses.map((f) => {
                      const tierColor =
                        f.tier === 'critical' ? C.red : f.tier === 'important' ? C.orange : C.gray;
                      return (
                        <View key={f.focusPointId} style={pb.checkRow}>
                          <View style={[pb.checkDot, { backgroundColor: tierColor }]} />
                          <Text style={pb.checkName} numberOfLines={1}>{f.name}</Text>
                          <Text style={[pb.checkTier, { color: tierColor }]}>{f.tier}</Text>
                          <View style={pb.checkProgress}>
                            <Text style={pb.checkProgressText}>
                              {f.done}<Text style={pb.checkProgressOf}>/{f.target}</Text>
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </>
              )}

              {openQuestions.length > 0 && (
                <>
                  <Text style={pb.checkSubLabel}>QUESTIONS · {openQuestions.length}</Text>
                  <View style={pb.checkRows}>
                    {openQuestions.map((q) => {
                      const isInClass = q.status === 'dismissed';
                      return (
                        <TouchableOpacity
                          key={q.id}
                          style={pb.checkRow}
                          activeOpacity={0.7}
                          onPress={() => setViewingQuestion(q)}
                        >
                          <View style={[pb.checkDot, { backgroundColor: isInClass ? '#F6D27A' : 'rgba(255,255,255,0.45)' }]} />
                          <Text style={pb.checkName} numberOfLines={2}>{q.message}</Text>
                          <Text style={[pb.checkTier, { color: isInClass ? '#F6D27A' : 'rgba(255,255,255,0.55)' }]}>
                            {isInClass ? 'in class' : 'open'}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
            </View>
          ) : null}

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
          onPress={backFromBriefing}
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
                  strokeDasharray={`${2 * Math.PI * 25 * ((studentReadiness?.percent || 0) / 100)} ${2 * Math.PI * 25}`}
                  strokeLinecap="round" transform="rotate(-90 28 28)" />
              </Svg>
              <View style={pb.heroAvatarInner}>
                {st.photoUrl ? (
                  <Image source={{ uri: st.photoUrl }} style={pb.heroAvatarImg} />
                ) : (
                  <Text style={pb.heroAvatarText}>{initials(st.name)[0]}</Text>
                )}
              </View>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={pb.heroName} numberOfLines={1}>{st.name}</Text>
              <Text style={pb.heroSub}>
                {studentReadiness?.percent != null
                  ? <><Text style={pb.heroSubStrong}>{studentReadiness.percent}%</Text> ready for this lesson</>
                  : <>Trained <Text style={pb.heroSubStrong}>{sessionsCount}x</Text> since last private lesson</>}
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
        {renderRecStartConfirmPrompt()}
        {renderRecStopConfirmPrompt()}

        <Modal
          visible={!!viewingQuestion}
          transparent
          animationType="fade"
          onRequestClose={() => setViewingQuestion(null)}
        >
          {viewingQuestion && (
            <QuestionDetailSheet
              question={viewingQuestion}
              role="coach"
              onClose={() => setViewingQuestion(null)}
            />
          )}
        </Modal>
      </SafeAreaView>
    );
  }

  // ── VIEW 4: Group briefing ─────────────────────────────────────────────
  // ── Couple briefing — record a couple lesson (reuses the shared
  // start/stop bottom bar + debrief; startClassNow/finishDebrief branch on
  // view === 'couple-briefing' + selectedCouple). ──────────────────────────
  if (view === 'couple-briefing' && selectedCouple) {
    const c = selectedCouple;
    const readiness = coupleReadinessDetail;
    const readinessFocuses = readiness?.focuses || [];
    const sessionsCount = readinessFocuses.reduce((a, f) => a + (f.done || 0), 0);
    const focusTrained = readinessFocuses.filter((f) => (f.done || 0) > 0).length;
    const trainedPoints = (coupleFps || []).filter((fp) => (fp.weekCount || 0) > 0);
    const stuckPoints = (coupleFps || []).filter((fp) => (fp.weekCount || 0) === 0);
    const totalFps = (coupleFps || []).length;
    const alertLabel = readiness == null
      ? 'No couple private yet'
      : readiness.percent >= 100 ? 'Ready for this lesson' : 'Carryover to review';
    const alertColor = readiness == null ? C.gray : readiness.percent >= 100 ? C.green : C.orange;
    const seenLabel = readiness?.lastClassDate ? relativeShort(readiness.lastClassDate) : '—';
    const dancers = [c.dancerA, c.dancerB];

    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={{ flex: 1 }}>
        <Animated.ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: HERO_FULL + 76, paddingBottom: 200 }}
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
                    {c.name} completed{' '}
                    <Text style={pb.debriefStrong}>{sessionsCount} couple session{sessionsCount > 1 ? 's' : ''}</Text>
                    {' '}and practiced {focusTrained} of {readinessFocuses.length} carryover focus points.
                  </Text>
                ) : (
                  <Text>No couple focus points practiced since the last lesson. </Text>
                )}
                {stuckPoints.length > 0 && (
                  <Text>
                    {' '}
                    <Text style={pb.debriefEm}>"{stuckPoints[0].name}"</Text> has had zero practice despite being flagged.
                  </Text>
                )}
              </Text>
            </View>
          )}

          {/* Carryover from last couple private — what to check this lesson */}
          {!!readiness && readinessFocuses.length > 0 ? (
            <View style={pb.checkCard}>
              <View style={pb.checkHeader}>
                <View style={pb.checkBadge}>
                  <Text style={pb.checkBadgeText}>CHECK DURING THIS LESSON</Text>
                </View>
                <Text style={pb.checkPct}>{readiness.percent}%</Text>
              </View>
              <Text style={pb.checkHint}>
                Carryover from the couple's last private. Validate each at the end.
              </Text>
              <View style={pb.checkRows}>
                {readinessFocuses.map((f) => {
                  const tierColor =
                    f.tier === 'critical' ? C.red : f.tier === 'important' ? C.orange : C.gray;
                  return (
                    <View key={f.focusPointId} style={pb.checkRow}>
                      <View style={[pb.checkDot, { backgroundColor: tierColor }]} />
                      <Text style={pb.checkName} numberOfLines={1}>{f.name}</Text>
                      <Text style={[pb.checkTier, { color: tierColor }]}>{f.tier}</Text>
                      <View style={pb.checkProgress}>
                        <Text style={pb.checkProgressText}>
                          {f.done}<Text style={pb.checkProgressOf}>/{f.target}</Text>
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* Focus points trained this week */}
          {trainedPoints.length > 0 && (
            <>
              <Text style={pb.secLabel}>Focus points trained this week</Text>
              <View style={pb.focusWrap}>
                {trainedPoints.map((fp) => (
                  <View key={fp.id} style={pb.fpRow}>
                    <View style={pb.fpStatus}>
                      <Ionicons name="checkmark" size={14} color={C.green} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={pb.fpName} numberOfLines={1}>{fp.name}</Text>
                    </View>
                    <View style={pb.fpBadge}>
                      <Text style={pb.fpBadgeText}>{fp.weekCount}x</Text>
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
          style={[pb.stickyBackdrop, { height: Animated.add(heroAnimHeight, 70) }]}
        />

        {/* Floating back arrow */}
        <TouchableOpacity
          onPress={backFromBriefing}
          style={pb.floatingBack}
          activeOpacity={0.7}
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </TouchableOpacity>

        {/* Sticky collapsing hero — pair avatars + couple readiness */}
        <Animated.View
          pointerEvents="box-none"
          style={[pb.stickyHero, { height: heroAnimHeight }]}
        >
          <View style={pb.heroTop}>
            <View style={sc.cbHeroPair}>
              {dancers.map((d, i) => (
                <View key={i} style={[sc.cbHeroAv, i === 1 && { marginLeft: -16 }]}>
                  {d?.avatarUrl ? (
                    <Image source={{ uri: d.avatarUrl }} style={sc.cbHeroAvImg} />
                  ) : (
                    <Text style={sc.cbHeroAvTxt}>{(d?.name || '?')[0]?.toUpperCase()}</Text>
                  )}
                </View>
              ))}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={pb.heroName} numberOfLines={1}>{c.name}</Text>
              <Text style={pb.heroSub}>
                {readiness?.percent != null
                  ? <><Text style={pb.heroSubStrong}>{readiness.percent}%</Text> ready for this lesson</>
                  : <>No couple private logged yet</>}
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
                <Text style={pb.statVal}>{totalFps}</Text>
                <Text style={pb.statLabel}>Focuses</Text>
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
        {renderRecStartConfirmPrompt()}
        {renderRecStopConfirmPrompt()}
      </SafeAreaView>
    );
  }

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
            contentContainerStyle={{ paddingTop: HERO_FULL + 76, paddingBottom: 200 }}
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
            onPress={backFromBriefing}
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
        {renderRecStartConfirmPrompt()}
        {renderRecStopConfirmPrompt()}
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
  heroAvatarImg: {
    width: 40,
    height: 40,
    borderRadius: 20,
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

  // Check-during-lesson card (readiness carryover)
  // Dark brown card matching the student-side lesson readiness panel
  // (ProfileScreen → ready.card). Same #1F1810 + gold border treatment so
  // coach and student see the same visual language for "what's left".
  checkCard: {
    marginHorizontal: Spacing.side,
    marginBottom: 22,
    backgroundColor: '#1F1810',
    borderRadius: 20,
    padding: 18,
    paddingBottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(240,194,74,0.28)',
    overflow: 'hidden',
    shadowColor: '#0A0A0A',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.5,
    shadowRadius: 22,
    elevation: 8,
  },
  checkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  checkBadge: {
    backgroundColor: 'rgba(240,194,74,0.14)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(240,194,74,0.30)',
  },
  checkBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9,
    letterSpacing: 0.8,
    color: '#F6D27A',
  },
  checkPct: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: '#FFFFFF',
    letterSpacing: -0.4,
  },
  checkHint: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 17,
    marginBottom: 14,
  },
  // Sub-section label between focus rows and questions inside the
  // brown "Check during this lesson" card.
  checkSubLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: '#F6D27A',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 4,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.10)',
  },
  checkRows: {
    marginHorizontal: -18,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.10)',
  },
  checkDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  checkName: {
    flex: 1,
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13.5,
    color: '#FFFFFF',
    letterSpacing: -0.05,
  },
  checkTier: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  checkProgress: {
    minWidth: 36,
    alignItems: 'flex-end',
  },
  checkProgressText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#F6D27A',
    letterSpacing: -0.2,
  },
  checkProgressOf: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 11,
    color: 'rgba(246,210,122,0.5)',
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
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
    color: '#fff',
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
  },
  audioBadge: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
  },
  audioBadgeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  audioBadgeText: {
    flex: 1,
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.78)',
    letterSpacing: 0.2,
  },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // Pushed to the right edge of the running row. In local-recording mode the
    // audio-route badge (which normally fills the space) is hidden, so without
    // this the Stop button sits glued to the timer digits.
    marginLeft: 'auto',
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
  chips: {
    gap: 8,
    marginBottom: 4,
  },
  chip: {
    borderRadius: 14,
    backgroundColor: '#F5F5F5',
    borderWidth: 1.5,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  chipSelected: {
    backgroundColor: '#FFF8E6',
    borderColor: '#E8A838',
  },
  chipSelectedGood: {
    backgroundColor: '#EEF8EE',
    borderColor: '#4AAF52',
  },
  chipIconSelectedGood: {
    backgroundColor: '#4AAF52',
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  waveBlock: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 4,
    gap: 8,
  },
  waveBars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 36,
  },
  waveBar: {
    flex: 1,
    height: 32,
    borderRadius: 999,
    minWidth: 0,
  },
  waveLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: '#888',
    letterSpacing: 0.4,
  },
  searching: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 14,
    backgroundColor: '#F5F5F5',
    borderRadius: 14,
  },
  searchingCoreWrap: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  searchingCore: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(232,168,56,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchingRing: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#E8A838',
  },
  searchingTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#0E0E0E',
    letterSpacing: -0.2,
  },
  searchingSub: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11.5,
    color: '#888',
    marginTop: 4,
  },
  popupOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
    zIndex: 999,
  },
  popupCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 22,
    alignItems: 'center',
  },
  popupIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(232,168,56,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  popupTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: '#0E0E0E',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  popupBody: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 18,
    lineHeight: 18,
  },
  popupActions: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  popupBtnGhost: {
    flex: 1,
    backgroundColor: '#F2F2F2',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  popupBtnGhostText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#666',
  },
  popupBtnPrimary: {
    flex: 1,
    backgroundColor: '#E8A838',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  popupBtnPrimaryText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#0E0E0E',
    letterSpacing: 0.4,
  },
  chipIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipIconSelected: {
    backgroundColor: '#E8A838',
  },
  chipName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#0E0E0E',
    letterSpacing: -0.2,
  },
  chipMeta: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
  chipDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: 8,
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
  // Full-screen container — no longer a bottom sheet. The debrief earns
  // its own view because the coach is doing real work (validating focus
  // points + questions + writing a class note), not just dismissing.
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(13,13,18,0.08)',
  },
  // Sticky action bar at the bottom — Done is always reachable, Save for
  // later sits underneath as a secondary out.
  bottomBar: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(13,13,18,0.08)',
    backgroundColor: '#FFFFFF',
    gap: 6,
  },
  // Legacy aliases — retained until the old overlay/sheet path is fully
  // removed elsewhere (e.g. group debrief which still uses Modal sheet).
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
  // Brown duration card — same family as "Check during this lesson" on
  // the briefing screen so the visual language carries through into the
  // debrief.
  durationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 24,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 13,
    backgroundColor: '#1F1810',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(240,194,74,0.28)',
  },
  durationText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#FFFFFF',
  },
  durationDim: {
    fontFamily: Fonts.jakartaMedium,
    color: 'rgba(255,255,255,0.55)',
  },
  // Gold uppercase eyebrow — matches the section labels used in the
  // student readiness card and the coach action-needed pillars.
  secLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: '#F6D27A',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginHorizontal: 24,
    marginTop: 24,
    marginBottom: 10,
  },
  noteArea: {
    marginHorizontal: 24,
  },
  noteInput: {
    minHeight: 88,
    padding: 16,
    borderRadius: 14,
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
  verdictHint: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: '#8A8A8A',
    marginHorizontal: 24,
    marginTop: -2,
    marginBottom: 10,
    lineHeight: 15,
  },
  // Focus point validation list — dark brown cards matching the rest of
  // the debrief surface.
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
    backgroundColor: '#1F1810',
    borderWidth: 1,
    borderColor: 'rgba(240,194,74,0.28)',
  },
  fpItemSelected: {
    backgroundColor: '#1F1810',
    borderColor: 'rgba(76,175,80,0.45)',
  },
  fpCheck: {
    width: 26,
    height: 26,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
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
    color: '#FFFFFF',
  },
  fpMeta: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 2,
  },

  // Verdict rows (Good / Not yet + Covered / Not yet) — same dark card
  // pattern as focus items, with translucent buttons that stay readable
  // on the brown surface until the coach picks one.
  verdictList: {
    gap: 8,
    marginHorizontal: 24,
    marginBottom: 6,
  },
  verdictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1F1810',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(240,194,74,0.28)',
  },
  verdictName: {
    flex: 1,
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: '#FFFFFF',
    lineHeight: 18,
  },
  verdictMeta: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 9.5,
    color: '#F6D27A',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  verdictBtns: {
    flexDirection: 'row',
    gap: 6,
  },
  verdictBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  verdictBtnGood: {
    backgroundColor: '#4AAF52',
    borderColor: '#4AAF52',
  },
  verdictBtnNotYet: {
    backgroundColor: '#E8A838',
    borderColor: '#E8A838',
  },
  verdictBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11.5,
    letterSpacing: 0.2,
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
  btnDoneDisabled: {
    backgroundColor: 'rgba(13,13,18,0.08)',
  },
  btnDoneText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  btnDoneTextDisabled: {
    color: 'rgba(13,13,18,0.40)',
    letterSpacing: 0.5,
    fontSize: 13,
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

// "Not yet" confirmation popup — same dark hero card pattern as
// ApproveConfirmSheet so the gesture feels consistent across the app.
const notYet = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    borderRadius: 22,
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(240,194,74,0.28)',
    overflow: 'hidden',
  },
  iconWrap: {
    alignSelf: 'center',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(240,194,74,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(240,194,74,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
    color: '#FFFFFF',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.78)',
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 22,
  },
  bodyAccent: {
    fontFamily: Fonts.jakartaBold,
    color: '#F6D27A',
  },
  primaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 13,
    marginBottom: 4,
  },
  primaryBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#0A0A0A',
    letterSpacing: 0.2,
  },
  secondaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  secondaryBtnText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.65)',
    letterSpacing: 0.1,
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

// ─── StartClass landing styles (the redesign) ───────────────────────────────
const sc = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 4,
    height: 52,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
    elevation: 1,
  },
  topLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: 'rgba(10,10,10,0.55)',
    letterSpacing: 1.6,
  },

  scroll: {
    paddingHorizontal: 22,
    paddingBottom: 60,
  },

  heading: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 36,
    color: '#0A0A0A',
    letterSpacing: -1,
    lineHeight: 40,
    marginTop: 16,
  },
  subtitle: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: 'rgba(10,10,10,0.55)',
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 26,
  },

  // Section eyebrow row: "PRIVATE WITH..." + "Sorted by readiness"
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  eyebrowAccent: {
    width: 16,
    height: 1.5,
    backgroundColor: '#E8B530',
    borderRadius: 1,
  },
  eyebrowText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: '#E8B530',
    letterSpacing: 1.6,
  },
  eyebrowRule: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(10,10,10,0.09)',
  },
  eyebrowRight: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11.5,
    color: 'rgba(10,10,10,0.55)',
    letterSpacing: 0.1,
  },

  // Per-student card
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: 'rgba(232,181,48,0.30)',
    marginBottom: 10,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avRing: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  avPhoto: { width: 38, height: 38, borderRadius: 19 },
  avFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
  },
  cardName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: '#0A0A0A',
    letterSpacing: -0.3,
  },
  cardMeta: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12.5,
    color: 'rgba(10,10,10,0.5)',
    marginTop: 2,
  },
  readyWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexShrink: 0,
  },
  readyN: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 19,
    color: '#0A0A0A',
    letterSpacing: -0.5,
  },
  readyPct: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 11.5,
    color: 'rgba(10,10,10,0.45)',
  },
  readyLbl: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9.5,
    color: 'rgba(10,10,10,0.55)',
    letterSpacing: 1.4,
    marginTop: 1,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },

  // Solo / Couple toggle
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 999,
    padding: 5,
    borderWidth: 1,
    borderColor: 'rgba(10,10,10,0.06)',
    marginTop: 2,
    marginBottom: 20,
  },
  modeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    borderRadius: 999,
  },
  modeThumb: {
    position: 'absolute',
    top: 5,
    bottom: 5,
    left: 5,
    borderRadius: 999,
    backgroundColor: '#0A0A0A',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    elevation: 2,
  },

  // Couple row — two dancers' avatars overlapping. Height matches the solo
  // avatar (avRing, 46) so couple + solo cards are exactly the same height.
  coupleAvWrap: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
  },
  coupleAv: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: '#4E6A5C',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coupleAv2: {
    marginLeft: -12,
  },
  coupleAvPhoto: {
    width: '100%',
    height: '100%',
  },
  coupleAvText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#FFFFFF',
  },

  // Couple briefing hero — pair avatars
  cbHeroPair: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cbHeroAv: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    backgroundColor: '#4E6A5C',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cbHeroAvImg: {
    width: '100%',
    height: '100%',
  },
  cbHeroAvTxt: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: '#FFFFFF',
  },
  modeDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  modeTabTxt: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: 'rgba(10,10,10,0.5)',
    letterSpacing: 0.2,
  },
  modeTabTxtOn: {
    color: '#FFFFFF',
  },

  cardDivider: {
    height: 1,
    backgroundColor: 'rgba(10,10,10,0.08)',
    marginTop: 12,
    marginBottom: 8,
  },

  // Focus-point row inside the card
  fpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  fpBullet: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#E8B530',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fpBulletInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E8B530',
  },
  fpName: {
    flex: 1,
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14.5,
    color: '#0A0A0A',
    letterSpacing: -0.2,
  },
  fpSince: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#3D9F4E',
    letterSpacing: -0.1,
  },
  fpSinceTarget: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 11,
    color: 'rgba(61,159,78,0.5)',
  },
  fpStale: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12.5,
    color: '#E84545',
    letterSpacing: 0.1,
  },

  loadingWrap: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: 'rgba(10,10,10,0.55)',
    textAlign: 'center',
    paddingVertical: 22,
  },

  // OR divider
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    marginBottom: 12,
  },

  // Group class card (dark)
  cbTitle: { flex: 1, textAlign: 'center', fontFamily: Fonts.jakartaBold, fontSize: 17, color: '#0E0E0E' },
  cbHero: { alignItems: 'center', paddingTop: 24, paddingHorizontal: 28 },
  cbIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(46,70,112,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  cbName: { fontFamily: Fonts.jakartaExtraBold, fontSize: 26, color: '#0E0E0E', letterSpacing: -0.6 },
  cbSub: { fontFamily: Fonts.jakartaSemiBold, fontSize: 15, color: '#444', marginTop: 6 },
  cbStyles: { fontFamily: Fonts.jakartaRegular, fontSize: 13, color: '#8A8A8A', marginTop: 4 },
  cbHint: { fontFamily: Fonts.jakartaRegular, fontSize: 13.5, color: '#6B6B6B', textAlign: 'center', lineHeight: 19, marginTop: 18 },
  groupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#0F0C0A',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(232,181,48,0.40)',
  },
  groupIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(232,181,48,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  groupSub: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 2,
  },
  groupAvatars: {
    flexDirection: 'row',
    paddingLeft: 10,
  },
  groupAv: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#0F0C0A',
    marginLeft: -8,
  },
  groupAvPhoto: {
    width: 25,
    height: 25,
    borderRadius: 12.5,
  },
  groupAvText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: '#FFFFFF',
  },
});
