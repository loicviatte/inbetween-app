import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  Modal,
  Pressable,
  Alert,
  AppState,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
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
import { isAwaitingVerification, guardStudent } from '../../utils/studentLock';
import { useDjiSync } from '../../context/DjiSyncContext';
import { getStudentFocusPoints, getStudentQuestions, getStudentOpenQuestions, getStudentRecentActivity, getStartClassRoster, markQuestionCovered, linkCoveredQuestionsToClass, getCoachStudentDetailBundle } from '../../storage/coachStorage';
import { getLessonReadiness } from '../../storage/storage';
import { getMyCouples, getCoupleReadiness, getCoupleFocusPoints, getCoupleActivity } from '../../storage/coupleStorage';
import QuestionDetailSheet from '../../components/QuestionDetailSheet';
import MicCueSheet from '../../components/MicCueSheet';
import { Pulse, Bone, FadeIn } from '../../components/GroupSwitchSkeleton';
import {
  L, lessonStyles, dayLabel, sincePhrase, askedLabel, Avatar, PairAvatars, TopBar, Hero, HeroStrong, HeroAlert,
  SectionHead, Card, TierChip, CheckRow, QuestionRow, CardLabel, TimelineRow, PickRow, Percent, Tabs, StartFoot, RunningFoot,
  Popup, PopupStrong, PopupButton, VerdictPills, Empty,
} from '../../components/coach/LessonUI';
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

// AssemblyAI is proxied server-side (supabase/functions/assemblyai-transcribe)
// so the account key never ships in the app bundle.

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

async function transcribeAudio(uri, speakersExpected) {
  // Proxied through supabase/functions/assemblyai-transcribe so the AssemblyAI
  // key stays server-side. The job is created server-side; we then poll the
  // same function for status (a single call can't block for the whole
  // transcription without exceeding the edge wall-clock budget).
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('NO_AUTH_SESSION');
  const token = session.access_token;
  const fnUrl = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/assemblyai-transcribe`;

  // 1. Upload + create job. The DanceSport biasing prompt is sent as a field
  //    (not a secret) so the server-side create request keeps the same config.
  const formData = new FormData();
  formData.append('file', { uri, type: 'audio/m4a', name: 'chunk.m4a' });
  formData.append('prompt', DANCE_PROMPT);
  // Diarization hint (coach + dancers). Lets the server sharpen the
  // Coach/Élève split — AssemblyAI's default over/under-segments otherwise.
  if (speakersExpected && speakersExpected > 1) {
    formData.append('speakers_expected', String(speakersExpected));
  }
  const createRes = await fetch(fnUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!createRes.ok) {
    const body = await createRes.text().catch(() => '');
    throw new Error(`transcribe create ${createRes.status}: ${body.slice(0, 200)}`);
  }
  const { jobId } = await createRes.json();
  if (!jobId) throw new Error('transcribe create: missing jobId');

  // 2. Poll until completed (max ~10 min). Returns raw utterances + duration so
  //    the caller can stitch chunks into one continuous timeline with per-chunk
  //    speaker re-labeling.
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(fnUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jobId }),
    });
    if (!pollRes.ok) throw new Error(`transcribe poll ${pollRes.status}`);
    const job = await pollRes.json();
    if (job.status === 'completed') {
      return {
        utterances: Array.isArray(job.utterances) ? job.utterances : [],
        text: typeof job.text === 'string' ? job.text : '',
        durationMs: Number(job.durationMs) || 0,
      };
    }
    if (job.status === 'error') throw new Error(`AssemblyAI: ${job.error || 'unknown error'}`);
  }
  throw new Error('AssemblyAI transcription timed out');
}

// Run `fn` over `items` with at most `limit` in flight at once, preserving
// input order in the returned results. Avoids the N-parallel-request storm that
// starves the RN socket pool / free-tier Supabase pooler.
async function mapWithConcurrency(items, limit, fn) {
  const list = items || [];
  const results = new Array(list.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < list.length) {
      const i = cursor++;
      results[i] = await fn(list[i], i);
    }
  };
  const n = Math.max(1, Math.min(limit, list.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

// Consent states in which a student may not be recorded. The database refuses
// these too (refuse_unconsented_student); checking here stops the mic opening.
const CONSENT_BLOCKED = ['pending', 'withdrawn'];

// ════════════════════════════════════════════════════════════════════════════
// ── Main Component ─────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════
export default function StartClassScreen({ navigation }) {
  const { students, getOrFetch } = useCoachData();
  const insets = useSafeAreaInsets();
  // Lets us refresh the DJI awaiting-audio count the moment a local class ends,
  // so the sync pill / setup banner appears immediately instead of only on the
  // next app foreground.
  const { refreshPending: refreshDjiUploads } = useDjiSync() ?? {};

  const [view, setView] = useState('select');
  const [pickMode, setPickMode] = useState('solo'); // 'solo' | 'couple' — landing list tabs
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
    let cancelled = false;
    // Hydrate from the locally-cached session FIRST (synchronous read from
    // AsyncStorage, no network) so isLocalMode is correct on the very first
    // render — otherwise the legacy Bluetooth UI flashes during the cold-start
    // window while the network getUser() below is still resolving. Then refresh
    // from getUser() to validate the token / pick up any role change.
    supabase.auth.getSession()
      .then(({ data: { session } }) => { if (!cancelled && session?.user) setAuthUser(session.user); })
      .catch(() => {});
    supabase.auth.getUser()
      .then(({ data: { user } }) => { if (!cancelled && user) setAuthUser(user); })
      .catch(() => {});
    return () => { cancelled = true; };
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
  // Start is async (a consent re-read, then the recording rows): a second tap
  // before the first finishes would start a second recorder and orphan one.
  const startingRef = useRef(false);
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
  const localModeRef = useRef(false);       // captured at startClassNow — read by stopClass

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
    setEndConfirmOpen(false);
    setHighlightChecks(false);
    if (classStartedAt) {
      navigation.goBack();
    } else {
      setView('select');
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
      // Build the warm-up tasks, then drain them with a small concurrency cap.
      // Firing N×requests at once starves the coach's own tap of the RN socket
      // pool (~6-8 per host) — that self-inflicted storm is what turned a tap
      // into a 48s wait. getOrFetch still dedups, so a tap mid-prefetch shares
      // the in-flight request. NOTE: no readiness prefetch — the roster already
      // batch-loaded every student's readiness (getStudentsReadiness), and a tap
      // always requests a CONCRETE style key (readiness:latin/ballroom), so the
      // old `readiness:all` warmed a key no tap ever reads.
      const tasks = [];
      for (const st of (students || [])) {
        if (!st?.id) continue;
        const sk = `student:${st.id}`;
        // Warm the SAME bundle key the tap will use: pickStudent passes a
        // CONCRETE style (coachStyles[0], or the picked one for a 2-style
        // student), never 'all' for a coached style — so warm one bundle per
        // style the coach could open (both for 2-style students so either pick
        // is instant; 'all' only for a style-less student).
        const styles = (Array.isArray(st.coachStyles) && st.coachStyles.length) ? st.coachStyles : [null];
        for (const style of styles) {
          tasks.push(() => getOrFetch(`${sk}:bundle:${style || 'all'}`, () => getCoachStudentDetailBundle(st.id, style).catch(() => null)));
        }
      }
      let idx = 0;
      const PREFETCH_CONCURRENCY = 3;
      const worker = async () => {
        while (idx < tasks.length) {
          const task = tasks[idx++];
          try { await task(); } catch {}
        }
      };
      for (let w = 0; w < PREFETCH_CONCURRENCY; w++) worker();
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
    if (!active) {
      // No class to resume → clear any orphan "class in progress" Live Activity
      // left behind by a stop that was killed before it could tear down.
      laEndAllCoachRecordings().catch(() => {});
      return;
    }
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
    // Resolve local-recording mode as late as possible. The component-mount
    // auth fetch (supabase.auth.getUser, a NETWORK call) can still be in
    // flight on a cold free-tier start; if the coach taps Start before it
    // resolves, `isLocalMode` is stale-false and a DJI coach gets misrouted
    // into the legacy "Connect a Bluetooth mic" flow (the modal David Yates
    // wrongly saw). Fall back to the locally-cached session (no network, so
    // Start stays instant) to decide, and backfill authUser so the rest of
    // the screen agrees.
    let localMode = isLocalMode;
    if (!authUser?.id) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          localMode = isLocalRecordingMode(session.user);
          setAuthUser(session.user);
        }
      } catch {}
    }
    // Local-recording mode: phone captures no audio, so the "Choose your
    // mic" modal is meaningless. Short-circuit through a "press REC on
    // your DJI mic" confirmation — we just need a timestamp + a
    // class_recordings row; the DJI mic file is imported later via USB-C.
    // The confirmation prevents the silent-failure case where the coach
    // starts the class in the app but never presses REC on the mic.
    if (localMode) {
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

  // Who in this private or couple class can't be recorded yet, re-read from
  // their rows (the roster's copy can be minutes old). [title, message] or null.
  async function recordingBlock() {
    const people = view === 'private-briefing' && selectedStudent?.id ? [selectedStudent]
      : view === 'couple-briefing' && selectedCouple ? [selectedCouple.dancerA, selectedCouple.dancerB].filter((d) => d?.id)
      : [];
    if (!people.length) return null;
    const { data } = await supabase.from('users').select('id, consent_status, age_check').in('id', people.map((p) => p.id));
    for (const p of people) {
      const row = (data || []).find((r) => r.id === p.id);
      if (!row) continue;
      if (row.age_check === 'minor_pending') {
        return ['Waiting for verification',
          `You marked ${p.name || 'this student'} as under 18. Recording works once they confirm they’re 18 or over, or a parent gives permission.`];
      }
      if (CONSENT_BLOCKED.includes(row.consent_status)) {
        return ['Waiting for a parent', `${p.name || 'This student'} is under 18. Recording works as soon as their parent gives permission.`];
      }
    }
    return null;
  }

  async function startClassNow() {
    if (startingRef.current || classStartedAt) return;
    startingRef.current = true;
    const block = await recordingBlock().catch(() => null);
    if (block) {
      startingRef.current = false;
      setAudioModalOpen(false);
      Alert.alert(block[0], block[1]);
      return;
    }
    setAudioModalOpen(false);

    // Start the chrono + active-class store IMMEDIATELY — before the slow async
    // setup below (preview-meter stop, auth fetch, class_recordings insert) — so
    // the timer appears the instant the coach confirms Start instead of after a
    // cold DB round-trip that races the still-loading briefing (coach taps Start
    // and nothing happens for ~30s). The recording rows/refs are created below
    // in the background; nothing here depends on them.
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
      // Picked Latin/Ballroom style — a restore after app-kill re-scopes the
      // debrief to it (else default-retire could touch the OTHER style's
      // focuses for a 2-style student).
      category: briefingCategoryRef.current ?? null,
    });
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
    let createdRecordingId = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // Resolve local mode from the freshly-fetched user so we don't race
      // with the component-mount auth fetch.
      localMode = isLocalRecordingMode(user);
      localModeRef.current = localMode; // read by stopClass to stamp ended_at at Stop
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
        createdRecordingId = recordingId;
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
            .insert(students.filter((s) => !CONSENT_BLOCKED.includes(s.consent_status)).map((s) => ({ recording_id: recordingId, student_id: s.id })));
          if (csErr) throw csErr;
        }
        newPipelineRef.current = true;
        recordingIdRef.current = recordingId;
        userIdRef.current = user.id;
      }
    } catch (err) {
      // The database refused a dancer (no parent permission yet): stop here —
      // never fall back to recording on the phone for someone who can't be recorded.
      if (/parent must approve/i.test(err?.message || '')) {
        if (createdRecordingId) {
          supabase.from('class_recordings').update({ status: 'discarded' }).eq('id', createdRecordingId).then(() => {}, () => {});
        }
        clearActiveCoachClass();
        setClassStartedAt(null);
        setChronoMs(0);
        chronoMsRef.current = 0;
        newPipelineRef.current = false;
        recordingIdRef.current = null;
        userIdRef.current = null;
        startingRef.current = false;
        Alert.alert('Waiting for a parent', 'Someone in this class is under 18 and can’t be recorded until their parent gives permission.');
        return;
      }
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
    setValidatedFpIds([]);
    setClassStartedAt(null);
    setChronoMs(0);
    chronoMsRef.current = 0;
    startingRef.current = false;

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

    // Local-recording (DJI) mode: stamp ended_at NOW, at Stop — not only when
    // the debrief is finished. Otherwise a coach who stops but abandons the
    // debrief (closes the app, navigates away) leaves the row stuck in
    // status='recording' with ended_at=null forever, so the class never shows
    // in the upload list and never triggers a sync reminder. finishDebrief
    // re-stamps harmlessly. Non-local classes keep stamping at debrief-finish
    // (their audio + class_input are created there).
    if (localModeRef.current && recordingIdRef.current) {
      supabase
        .from('class_recordings')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', recordingIdRef.current)
        .then(() => {}, (err) => {
          console.warn('[StartClass] stop-time ended_at update failed:', err);
        });
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
        // Voices to expect for diarization: private = coach + 1, couple =
        // coach + 2, group = coach + N students. Mirrors the DJI/server path
        // (finalize-recording.ts) so both flows get the clean Coach/Élève split.
        const speakersExpected = isPrivate
          ? 2
          : coupleCtx
            ? 3
            : (Array.isArray(allStudents) && allStudents.length > 0 ? 1 + allStudents.length : null);
        for (let i = 0; i < list.length; i++) {
          try {
            const result = await transcribeAudio(list[i], speakersExpected);
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
        .then(() => {
          // Row is now "awaiting audio" — refresh the DJI context so the sync
          // pill / setup banner shows up right away (it otherwise only recounts
          // on app foreground, so a coach who just finished a class saw nothing).
          refreshDjiUploads?.();
        }, (err) => {
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
  const [activity, setActivity] = useState([]); // bundle activity: practice sessions + classes
  const [detailLoading, setDetailLoading] = useState(false);
  // Couple detail (mirrors the solo briefing layout, driven by couple data).
  const [coupleReadinessDetail, setCoupleReadinessDetail] = useState(null);
  const [coupleFps, setCoupleFps] = useState([]);
  const [coupleActivity, setCoupleActivity] = useState([]);
  // Readiness pulled from the student's previous private (focuses + tiers).
  // Coach uses this as a "check during the lesson" list and a post-lesson
  // verdict capture (good / not yet).
  const [studentReadiness, setStudentReadiness] = useState(null);
  const [readinessVerdicts, setReadinessVerdicts] = useState({}); // { [fpId]: 'good' | 'not_yet' }
  const [questionVerdicts, setQuestionVerdicts] = useState({}); // { [qId]: 'covered' | 'not_yet' }
  const [confirmingNotYet, setConfirmingNotYet] = useState(null); // { focusPointId, name } | null
  // Ending with checks left untouched: ask once, and point at the card meanwhile.
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [highlightChecks, setHighlightChecks] = useState(false);

  // Group data
  const [groupFPs, setGroupFPs] = useState([]);
  const [groupStats, setGroupStats] = useState({ avgSessions: 0, totalSessions: 0, totalQuestions: 0 });
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
    // Clear the previous student's data so it can't flash before this one's
    // bundle (cache or network) lands.
    setFocusPoints([]);
    setStudentReadiness(null);
    setQuestions([]);
    setOpenQuestions([]);
    setLastClass(null);
    setActivity([]);
    setReadinessVerdicts({});
    setQuestionVerdicts({});
    setDetailLoading(true);
    setView('private-briefing');
    const sk = `student:${student.id}`;
    const bkey = `startClass.bundle.v1:${student.id}:${category || 'all'}`;

    // Push a bundle into the briefing UI: focus points, readiness, questions,
    // then the last-class recap + per-focus "trained since last class" counts.
    // bundle.activity has the identical event shape as getStudentRecentActivity.
    const applyBundle = (b) => {
      setFocusPoints(b?.focusPoints || []);
      setStudentReadiness(b?.readiness ?? null);
      setQuestions(b?.questions || []);
      setOpenQuestions(b?.openQuestions || []);
      const activity = b?.activity || [];
      setActivity(activity);
      const lastCls = activity.find(
        (ev) => ev.type === 'class' && ev.withCurrentCoach && ev.classSummary
      );
      if (lastCls) {
        const clsTime = new Date(lastCls.date).getTime();
        const trainCounts = {};
        for (const ev of activity) {
          if (ev.type === 'training' && ev.focusPointId && new Date(ev.date).getTime() > clsTime) {
            trainCounts[ev.focusPointId] = (trainCounts[ev.focusPointId] || 0) + 1;
          }
        }
        setLastClass({
          ...lastCls,
          focusCount: (lastCls.focusPoints || []).length,
          focusPoints: (lastCls.focusPoints || []).slice(0, 3).map((fp) => ({
            ...fp,
            trainedCount: trainCounts[fp.id] || 0,
          })),
        });
      } else {
        setLastClass(null);
      }
    };

    // 1. Instant paint from the PERSISTED bundle (survives cold launch, unlike
    // the in-memory getOrFetch cache) so the coach sees the last-known briefing
    // immediately instead of the ~10s cold-connection wait. Refreshed below.
    try {
      const raw = await AsyncStorage.getItem(bkey);
      if (raw) { applyBundle(JSON.parse(raw)); setDetailLoading(false); }
    } catch {}

    // 2. Fresh fetch (ONE category-scoped bundle RPC — replaces the old ~8
    // round-trips). Refreshes the UI in place and re-persists for next launch.
    let bundle = null;
    try {
      bundle = await getOrFetch(
        `${sk}:bundle:${category || 'all'}`,
        () => getCoachStudentDetailBundle(student.id, category).catch(() => null),
      );
    } catch {}

    if (bundle) {
      applyBundle(bundle);
      AsyncStorage.setItem(bkey, JSON.stringify(bundle)).catch(() => {});
    }
    setDetailLoading(false);
  }, []);

  // Open a student's briefing. If this coach teaches them BOTH styles, ask which
  // one first (so readiness/debrief are scoped to it); otherwise open directly
  // on the single style this coach coaches them in.
  const pickStudent = useCallback((student) => {
    if (isAwaitingVerification(student)) return guardStudent(student, () => {});
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
    const pick = (category) => { const st = stylePicker; setStylePicker(null); loadStudentDetail(st, category); };
    return (
      <Modal
        visible={!!stylePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setStylePicker(null)}
      >
        {stylePicker && (
          <Popup
            icon="albums-outline"
            title="Latin or Ballroom?"
            onDismiss={() => setStylePicker(null)}
            actions={(
              <>
                <PopupButton label="Latin" tone="dark" onPress={() => pick('latin')} />
                <PopupButton label="Ballroom" tone="dark" onPress={() => pick('ballroom')} />
                <PopupButton label="Cancel" tone="ghost" onPress={() => setStylePicker(null)} />
              </>
            )}
          >
            You coach <PopupStrong>{stylePicker.name}</PopupStrong> in both. Which lesson is this?
          </Popup>
        )}
      </Modal>
    );
  }

  // Couple equivalent of loadStudentDetail — loads the same kinds of data so the
  // couple briefing can mirror the solo layout. (Couples have no "class recap"
  // or "questions" data, so those sections simply don't render.)
  const loadCoupleDetail = useCallback(async (couple) => {
    setSelectedCouple(couple);
    setCoupleReadinessDetail(null);
    setCoupleFps([]);
    setCoupleActivity([]);
    setReadinessVerdicts({});
    setQuestionVerdicts({});
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
      setCoupleActivity(activity || []);
    } catch {}
    setDetailLoading(false);
  }, []);

  // Load group focus data
  const loadGroupData = useCallback(async () => {
    setGroupLoading(true);
    setView('group-briefing');
    try {
      // Bounded concurrency: firing 2×N requests at once saturates the RN
      // socket pool (~6-8/host) and the free-tier Supabase pooler — the exact
      // request storm the roster prefetch was reworked to avoid (see
      // prefetchDetails' worker pool). Cap peak in-flight per phase instead.
      const GROUP_CONCURRENCY = 4;
      const allFPs = await mapWithConcurrency(students, GROUP_CONCURRENCY, async (s) => {
        const fps = await getStudentFocusPoints(s.id).catch(() => []);
        return fps.map(fp => ({ ...fp, studentId: s.id, studentName: s.name }));
      });
      const allQs = await mapWithConcurrency(students, GROUP_CONCURRENCY, (s) => getStudentQuestions(s.id).catch(() => []));

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
      setGroupStats({ avgSessions, totalSessions, totalQuestions });

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
        : view === 'group-briefing'
          ? groupFPs
              .filter((fp) => (fp.pastCandidateCount || 0) > 0)
              .map((fp) => ({
                id: fp.name,
                name: fp.name,
                weekCount: fp.practiced || 0,
              }))
          // A couple debrief validates couple focuses through "How did it go?"
          // only; it has no past_candidate list of its own.
          : [];

    const totalMin = Math.max(1, Math.round(debriefDurationMs / 60000));
    const validatedCount = validatedFpIds.length;

    // Open questions to debrief — both pending (coach hadn't decided yet)
    // and dismissed (coach committed to addressing them in this class).
    // Tapping a row opens the detail popup; the Answer pill marks it answered
    // in person. Both are optional — questions don't gate Done.
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
    const keptCount = carryoverFocuses.filter((f) => readinessVerdicts[f.focusPointId] === 'not_yet').length;

    const who = view === 'private-briefing' ? selectedStudent?.name
      : view === 'couple-briefing' ? selectedCouple?.name
      : 'Group class';
    const figures = [
      carryoverFocuses.length > 0 && { value: carryoverFocuses.length - keptCount, label: 'to retire' },
      carryoverFocuses.length > 0 && { value: keptCount, label: 'kept' },
      list.length > 0 && { value: `${validatedCount}/${list.length}`, label: 'validated' },
      questionsToAddress.length > 0 && { value: `${coveredCount}/${questionsToAddress.length}`, label: 'answered' },
    ].filter(Boolean).slice(0, 3);

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
          <SafeAreaView style={lessonStyles.page} edges={['top']}>
            <TopBar title="Lesson ended" sub={who ? `${who} · ${totalMin} min` : `${totalMin} min`} />

            <ScrollView
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[lessonStyles.scroll, { paddingBottom: 110 + insets.bottom }]}
            >
              <Hero
                big={totalMin}
                unit="min"
                title={who || 'Lesson'}
                label="Wrap up"
                figures={figures.length > 0 ? figures : null}
              >
                {carryoverFocuses.length > 0
                  ? <>Everything you leave unmarked is <HeroStrong>retired when you tap Done</HeroStrong>. Mark a focus <HeroStrong>Not yet</HeroStrong> to keep it on the plan.</>
                  : <>Nothing to validate from a previous lesson. Tap Done to send the recording off.</>}
              </Hero>

              {/* Readiness verdicts — carryover focuses to validate. Solo and
                  couple alike: good → archive, not yet → held (15-min target). */}
              {carryoverFocuses.length > 0 && (
                <>
                  <SectionHead title="How did it go?" right={plural(carryoverFocuses.length, 'focus point')} />
                  <Card>
                    {carryoverFocuses.map((f, i) => {
                      const verdict = readinessVerdicts[f.focusPointId];
                      return (
                        <View key={f.focusPointId} style={[ls.vRow, i > 0 && ls.rowLine]}>
                          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                            <Text style={ls.vName} numberOfLines={2}>{f.name}</Text>
                            {!!f.tier && <View style={{ flexDirection: 'row' }}><TierChip tier={f.tier} /></View>}
                          </View>
                          <VerdictPills
                            value={verdict}
                            onGood={() =>
                              setReadinessVerdicts((prev) => ({
                                ...prev,
                                [f.focusPointId]: prev[f.focusPointId] === 'good' ? null : 'good',
                              }))
                            }
                            onNotYet={() => {
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
                          />
                        </View>
                      );
                    })}
                  </Card>
                </>
              )}

              {list.length > 0 && (
                <>
                  <SectionHead title="Validate what you covered" right={`${validatedCount} of ${list.length}`} />
                  <Card>
                    {list.map((fp, i) => (
                      <CheckRow
                        key={fp.id}
                        first={i === 0}
                        name={fp.name}
                        meta={fp.weekCount > 0 ? `${plural(fp.weekCount, 'session')} this week` : 'no practice this week'}
                        done={validatedFpIds.includes(fp.id)}
                        onPress={() => toggleValidateFp(fp.id)}
                      />
                    ))}
                  </Card>
                </>
              )}

              {questionsToAddress.length > 0 && (
                <>
                  <SectionHead title="Questions" right={`${coveredCount} of ${questionsToAddress.length} answered`} />
                  <Card>
                    {questionsToAddress.map((q, i) => (
                      <QuestionRow
                        key={q.id}
                        first={i === 0}
                        text={q.message}
                        meta={q.status === 'dismissed' ? 'Kept for this lesson' : askedLabel(q.created_at)}
                        answered={questionVerdicts[q.id] === 'covered'}
                        onPress={() => setViewingQuestion(q)}
                        onAnswer={() => toggleAnswered(q.id)}
                      />
                    ))}
                  </Card>
                </>
              )}

              {(audioUris.length > 0 || chargeReminderInDebrief) && (
                <Card style={{ marginTop: 18 }}>
                  {audioUris.length > 0 && (
                    <View style={ls.noteRow}>
                      <Ionicons name="mic" size={15} color={L.GOLD_INK} />
                      <Text style={ls.noteText}>
                        {audioUris.length === 1
                          ? 'Recording ready. It’s transcribed when you tap Done.'
                          : `${audioUris.length} parts recorded. They’re transcribed when you tap Done.`}
                      </Text>
                    </View>
                  )}
                  {chargeReminderInDebrief && (
                    <View style={[ls.noteRow, audioUris.length > 0 && ls.rowLine]}>
                      <Ionicons name="battery-charging" size={15} color={L.GOLD_INK} />
                      <Text style={ls.noteText}>Charge your mic before the next lesson.</Text>
                    </View>
                  )}
                </Card>
              )}
            </ScrollView>

            <StartFoot label="Done" icon={null} bottom={insets.bottom} onPress={finishDebrief} />

            {/* "Not yet" confirmation — clicking Not yet on a focus carries
                it over into the next class instead of archiving it. */}
            <Modal
              visible={!!confirmingNotYet}
              transparent
              animationType="fade"
              onRequestClose={() => setConfirmingNotYet(null)}
            >
              {confirmingNotYet && (
                <Popup
                  icon="refresh"
                  title="Keep training this?"
                  onDismiss={() => setConfirmingNotYet(null)}
                  actions={(
                    <>
                      <PopupButton
                        label="Yes, keep training"
                        onPress={() => {
                          setReadinessVerdicts((prev) => ({
                            ...prev,
                            [confirmingNotYet.focusPointId]: 'not_yet',
                          }));
                          setConfirmingNotYet(null);
                        }}
                      />
                      <PopupButton label="Cancel" tone="ghost" onPress={() => setConfirmingNotYet(null)} />
                    </>
                  )}
                >
                  <PopupStrong>{confirmingNotYet.name}</PopupStrong> stays on the plan and carries over into your next lesson.
                </Popup>
              )}
            </Modal>

            {/* Question detail — the briefing's own sheet stands down while
                the debrief is open, so only this one presents. */}
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
    const externals = availableInputs.filter(isExternalMic);
    const phoneMic = availableInputs.find(isPhoneMic);
    const waiting = view === 'private-briefing' && selectedStudent?.age_check === 'minor_pending' ? 'Waiting for verification'
      : view === 'private-briefing' && CONSENT_BLOCKED.includes(selectedStudent?.consent_status) ? 'Waiting for parent approval'
      : null;
    return (
      <Modal
        visible={audioModalOpen}
        transparent
        animationType="slide"
        onRequestClose={closeAudioModal}
      >
        <Pressable style={au.overlay} onPress={closeAudioModal}>
          <Pressable style={[au.sheet, { paddingBottom: 18 + insets.bottom }]} onPress={(e) => e.stopPropagation()}>
            <View style={au.handle} />
            <Text style={au.eyebrow}>Before you start</Text>
            <Text style={au.title}>Choose your mic</Text>
            <Text style={au.sub}>
              {micPermGranted === false
                ? 'Microphone access is off. Turn it on in Settings to record lessons.'
                : 'Pick what records this lesson, then say a few words to check the level.'}
            </Text>

            {micPermGranted !== false && externals.length === 0 && (
              <View style={au.searching}>
                <View style={au.coreWrap}>
                  {[searchRing1, searchRing2].map((ring, i) => (
                    <Animated.View
                      key={i}
                      style={[
                        au.ring,
                        {
                          transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }],
                          opacity: ring.interpolate({ inputRange: [0, 0.05, 1], outputRange: [0, 0.55, 0] }),
                        },
                      ]}
                    />
                  ))}
                  <View style={au.core}>
                    <Ionicons name="bluetooth" size={18} color={L.GOLD} />
                  </View>
                </View>
                <Text style={au.searchTitle}>Connect a Bluetooth mic</Text>
                <Text style={au.searchSub}>Looking for nearby devices…</Text>
              </View>
            )}

            {micPermGranted !== false && externals.length > 0 && (
              <Card style={{ marginTop: 16 }}>
                {externals.map((input, i) => {
                  const selected = input.uid === selectedInputUid;
                  return (
                    <View key={input.uid} style={i > 0 && ls.rowLine}>
                      <TouchableOpacity style={au.inputRow} activeOpacity={0.8} onPress={() => pickInput(input.uid)}
                        accessibilityRole="radio" accessibilityState={{ checked: selected }}>
                        <View style={[au.inputIcon, selected && au.inputIconOn]}>
                          <Ionicons
                            name={input.isBluetooth ? 'bluetooth' : input.type === 'wired' ? 'headset' : 'mic'}
                            size={16}
                            color={selected ? L.GOLD : L.INK_62}
                          />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={au.inputName} numberOfLines={1}>{input.name}</Text>
                          <Text style={au.inputMeta}>
                            {input.type === 'bluetooth' ? 'Bluetooth' : input.type === 'wired' ? 'Wired' : input.type}
                          </Text>
                        </View>
                        <View style={[au.radio, selected && au.radioOn]}>
                          {selected && <View style={au.radioDot} />}
                        </View>
                      </TouchableOpacity>
                      {selected && (
                        <View style={au.wave}>
                          <View style={au.waveBars}>
                            {waveBars.map((anim, k) => (
                              <Animated.View
                                key={k}
                                style={[
                                  au.waveBar,
                                  { backgroundColor: sustainedSoundsGood ? L.GREEN : L.GOLD, transform: [{ scaleY: anim }] },
                                ]}
                              />
                            ))}
                          </View>
                          <Text style={[au.waveLabel, sustainedSoundsGood && { color: '#3F6B3E' }]}>
                            {sustainedSoundsGood ? 'Sounds good' : 'Listening…'}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </Card>
            )}

            <TouchableOpacity
              style={[au.go, !!waiting && { opacity: 0.45 }]}
              activeOpacity={0.88}
              onPress={() => handleStartTap(phoneMic)}
              accessibilityRole="button"
            >
              {!waiting && <Ionicons name="play" size={17} color={L.INK} />}
              <Text style={au.goT}>{waiting || 'Start lesson'}</Text>
            </TouchableOpacity>
          </Pressable>
          {renderNoMicPrompt()}
          {renderRecordingConsentPrompt()}
        </Pressable>
      </Modal>
    );
  }

  async function handleStartTap(phoneMic) {
    if (startingRef.current || classStartedAt) return;
    const block = await recordingBlock().catch(() => null);
    if (block) {
      Alert.alert(block[0], block[1]);
      return;
    }
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
      <Popup
        icon="mic"
        title="Before you record"
        actions={(
          <>
            <PopupButton label="I have their consent" onPress={acceptRecordingConsent} />
            <PopupButton label="Cancel" tone="ghost" onPress={() => setConsentOpen(false)} />
          </>
        )}
      >
        You're responsible for getting everyone's agreement before you record them,
        including a parent or guardian for anyone under 18. InBetween stores the audio
        and transcript securely and uses them only to generate focus points.
      </Popup>
    );
  }

  function renderNoMicPrompt() {
    if (!noMicPromptOpen) return null;
    return (
      <Popup
        icon="mic-off"
        title="No mic selected"
        onDismiss={dismissNoMicPrompt}
        actions={(
          <>
            <PopupButton label="Connect a mic" onPress={dismissNoMicPrompt} />
            <PopupButton label="Use the phone’s mic" tone="ghost" onPress={confirmUsePhoneMic} />
          </>
        )}
      >
        A Bluetooth mic gives the clearest transcript, so the focus points come out right.
      </Popup>
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

  // ── Start a lesson (docs/design/start-lesson.html) ─────────────────────
  // One page per lesson: the dark readiness hero, what to check during the
  // lesson, the activity since the last private. The foot holds Start, and once
  // the lesson runs, the timer with End lesson in its place — the rest of the
  // page stays as it was.

  // During the lesson a check marks the focus as seen ("Good"); the debrief opens
  // with it ticked. Not-yet stays a debrief decision (it asks for confirmation).
  function toggleCheck(focusPointId) {
    setReadinessVerdicts((prev) => ({
      ...prev,
      [focusPointId]: prev[focusPointId] === 'good' ? null : 'good',
    }));
  }
  function toggleAnswered(questionId) {
    setQuestionVerdicts((prev) => ({
      ...prev,
      [questionId]: prev[questionId] === 'covered' ? null : 'covered',
    }));
  }

  // What's still untouched in "Check during this lesson".
  function pendingChecks() {
    const checks = view === 'couple-briefing'
      ? (coupleReadinessDetail?.focuses || [])
      : view === 'private-briefing' ? (studentReadiness?.focuses || []) : [];
    const focus = checks.filter((f) => readinessVerdicts[f.focusPointId] !== 'good').length;
    const questions = view === 'private-briefing'
      ? (openQuestions || []).filter((q) => questionVerdicts[q.id] !== 'covered').length
      : 0;
    return { focus, questions, total: focus + questions };
  }

  function endLesson(fromPopup) {
    setEndConfirmOpen(false);
    setHighlightChecks(false);
    // Local recording: first get the coach to press STOP on the mic, so the
    // file's header closes and its duration can be matched. Either way a modal
    // opens, so let the popup finish dismissing — iOS won't present a second
    // modal while the first is still animating out.
    const end = () => {
      if (isLocalMode) setRecStopConfirmOpen(true);
      else stopClass();
    };
    if (fromPopup) setTimeout(end, 350);
    else end();
  }

  function renderFoot() {
    if (classStartedAt) {
      return (
        <RunningFoot
          time={formatChrono(chronoMs)}
          source={isLocalMode ? 'Recording on your mic' : `Recording · ${audioRoute?.name || 'iPhone mic'}`}
          bottom={insets.bottom}
          onEnd={() => {
            if (pendingChecks().total > 0) {
              setHighlightChecks(true);
              setEndConfirmOpen(true);
              return;
            }
            endLesson(false);
          }}
        />
      );
    }
    return <StartFoot bottom={insets.bottom} onPress={openAudioModal} />;
  }

  // "You haven't ticked everything" — asked once, on End. The card it talks
  // about is ringed in gold behind the popup so the coach sees what's meant.
  function renderEndConfirm() {
    const { focus, questions, total } = pendingChecks();
    return (
      <Modal
        visible={endConfirmOpen && total > 0}
        transparent
        animationType="fade"
        onRequestClose={() => setEndConfirmOpen(false)}
      >
        <Popup
          icon="ellipse-outline"
          title="Not everything is ticked"
          onDismiss={() => setEndConfirmOpen(false)}
          actions={(
            <>
              <PopupButton label="End the lesson anyway" onPress={() => endLesson(true)} />
              <PopupButton label="Keep the lesson going" tone="ghost" onPress={() => setEndConfirmOpen(false)} />
            </>
          )}
        >
          <PopupStrong>
            {[focus > 0 && plural(focus, 'focus point'), questions > 0 && plural(questions, 'question')]
              .filter(Boolean).join(' and ')}
          </PopupStrong>
          {total === 1 ? ' is' : ' are'} still untouched under “Check during this lesson”. You can end anyway — you get to validate everything in the debrief.
        </Popup>
      </Modal>
    );
  }

  function renderLessonModals() {
    return (
      <>
        {renderAudioModal()}
        {renderDebriefModal()}
        {renderEndConfirm()}
        {renderRecStartConfirmPrompt()}
        {renderRecStopConfirmPrompt()}
        <Modal
          visible={!!viewingQuestion && !debriefOpen}
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
      </>
    );
  }

  // Bones while a briefing has nothing to show yet (no cached bundle).
  function renderBriefingBones() {
    return (
      <Pulse>
        <View style={ls.boneHero}>
          <Bone w={120} h={40} r={8} style={ls.boneDark} />
          <Bone w="100%" h={8} r={4} style={ls.boneDark} />
          <Bone w="86%" h={12} style={ls.boneDark} />
          <Bone w="64%" h={12} style={ls.boneDark} />
        </View>
        <Bone w={150} h={10} style={{ marginTop: 26, marginBottom: 12 }} />
        <View style={ls.boneCard}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={ls.boneRow}>
              <Bone w={23} h={23} r={12} />
              <View style={{ flex: 1, gap: 6 }}>
                <Bone w="70%" h={12} />
                <Bone w="40%" h={9} />
              </View>
            </View>
          ))}
        </View>
      </Pulse>
    );
  }

  // Practice since the last private (or the last 7 days without one).
  function practiceSince(rows, since) {
    const from = since ? new Date(since).getTime() : Date.now() - 7 * 86400000;
    const list = rows.filter((r) => new Date(r.date).getTime() >= from);
    return { list, minutes: list.reduce((a, r) => a + (r.minutes || 0), 0) };
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function renderPracticeTimeline(list, kind, lesson) {
    const shown = list.slice(0, 5);
    const rest = list.slice(5);
    const rows = shown.map((r) => ({
      key: r.id,
      label: dayLabel(r.date),
      title: r.focusName || 'Free practice',
      detail: `${r.minutes ? `${r.minutes} min · ` : ''}${kind} session`,
    }));
    if (rest.length > 0) {
      const restMin = rest.reduce((a, r) => a + (r.minutes || 0), 0);
      rows.push({
        key: 'earlier',
        label: 'Earlier',
        title: `${plural(rest.length, 'more session')}`,
        detail: restMin ? `${restMin} min` : null,
      });
    }
    if (rows.length === 0 && !lesson) {
      return <Empty>Nothing logged yet.</Empty>;
    }
    return (
      <View>
        {rows.map((r, i) => (
          <TimelineRow key={r.key} first={i === 0} last={!lesson && i === rows.length - 1}
            label={r.label} title={r.title} detail={r.detail} />
        ))}
        {!!lesson && (
          <TimelineRow first={rows.length === 0} lesson {...lesson} />
        )}
      </View>
    );
  }

  // ── Lesson recorded ────────────────────────────────────────────────────
  if (classRecorded) {
    return (
      <SafeAreaView style={[lessonStyles.page, ls.center]} edges={['top']}>
        <View style={ls.doneIcon}>
          <Ionicons name="checkmark" size={30} color={L.GOLD} />
        </View>
        <Text style={ls.doneTitle}>Lesson recorded</Text>
        <Text style={ls.doneBody}>
          {isLocalMode
            ? 'Sync your mic when you can: the audio is matched to this lesson and its focus points follow.'
            : 'The transcript is processing. You’ll get a notification when the focus points are ready to review.'}
        </Text>
      </SafeAreaView>
    );
  }

  // ── Who is this lesson with? ───────────────────────────────────────────
  if (view === 'select') {
    const totalStudents = students.length;
    return (
      <SafeAreaView style={lessonStyles.page} edges={['top']}>
        <TopBar icon="close" backLabel="Close" onBack={() => navigation.goBack()}
          title="Start a lesson" sub="Pick who you’re teaching" />
        <ScrollView
          contentContainerStyle={[lessonStyles.scroll, { paddingBottom: 32 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        >
          <Tabs
            items={[['solo', 'Solo'], ['couple', 'Couple']]}
            value={pickMode}
            onChange={setPickMode}
            right={pickMode === 'solo' && roster.length > 1 ? 'By readiness' : null}
          />

          <SectionHead title={pickMode === 'solo' ? 'Private lesson with' : 'Couple lesson with'} />
          {pickMode === 'solo' ? (
            rosterLoading && roster.length === 0 ? (
              <Pulse>
                <View style={ls.boneCard}>
                  {[0, 1, 2, 3].map((i) => (
                    <View key={i} style={ls.boneRow}>
                      <Bone w={40} h={40} r={20} />
                      <View style={{ flex: 1, gap: 6 }}>
                        <Bone w="55%" h={12} />
                        <Bone w="38%" h={9} />
                      </View>
                      <Bone w={34} h={16} />
                    </View>
                  ))}
                </View>
              </Pulse>
            ) : roster.length === 0 ? (
              <Card><Empty>No students yet. Share your invite code from Links to connect them.</Empty></Card>
            ) : (
              <Card>
                {roster.map((st, i) => {
                  const reviewing = !!st.age_review_pending;
                  const waitLabel = reviewing ? 'Tap to review their age'
                    : st.age_check === 'minor_pending' ? 'Awaiting verification'
                    : CONSENT_BLOCKED.includes(st.consent_status) ? 'Awaiting parent approval' : null;
                  const lp = st.lastPrivateClassDate;
                  const meta = waitLabel || (lp
                    ? `Last private · ${dayLabel(lp)}${st.lastPrivateDurationMin ? ` · ${st.lastPrivateDurationMin} min` : ''}`
                    : 'No private together yet');
                  return (
                    <PickRow
                      key={st.id}
                      first={i === 0}
                      dim={!!waitLabel && !reviewing}
                      avatar={(
                        <View>
                          <Avatar name={st.name} photoUrl={st.photoUrl} size={40} />
                          {st.status === 'silent' && <View style={ls.silentDot} />}
                        </View>
                      )}
                      name={st.name}
                      meta={meta}
                      metaTone={reviewing ? 'gold' : null}
                      right={<Percent value={st.readiness} />}
                      onPress={() => pickStudent(students.find((x) => x.id === st.id) || st)}
                    />
                  );
                })}
              </Card>
            )
          ) : couples.length === 0 ? (
            <Card><Empty>No couples yet. Two of your students pair up from their profiles.</Empty></Card>
          ) : (
            <Card>
              {couples.map((c, i) => {
                const dancers = [c.dancerA, c.dancerB];
                const waitLabel = dancers.some((d) => d?.age_check === 'minor_pending') ? 'Awaiting verification'
                  : dancers.some((d) => CONSENT_BLOCKED.includes(d?.consent_status)) ? 'Awaiting parent approval' : null;
                const meta = waitLabel || (c.lastPrivateClassDate
                  ? `Last couple private · ${dayLabel(c.lastPrivateClassDate)}`
                  : 'No couple private yet');
                return (
                  <PickRow
                    key={c.coupleId}
                    first={i === 0}
                    dim={!!waitLabel}
                    avatar={<PairAvatars a={c.dancerA} b={c.dancerB} size={36} />}
                    name={c.name}
                    meta={meta}
                    right={<Percent value={c.readiness} />}
                    onPress={() => loadCoupleDetail(c)}
                  />
                );
              })}
            </Card>
          )}

          <SectionHead title="Or" />
          <Card>
            <PickRow
              first
              avatar={(
                <View style={ls.groupIcon}>
                  <Ionicons name="people" size={18} color={L.GOLD} />
                </View>
              )}
              name="Group class"
              meta={`${plural(totalStudents, 'student')} · everyone is included`}
              onPress={loadGroupData}
            />
          </Card>
        </ScrollView>
        {renderStylePicker()}
      </SafeAreaView>
    );
  }

  // ── Private lesson ─────────────────────────────────────────────────────
  if (view === 'private-briefing' && selectedStudent) {
    const st = selectedStudent;
    const readiness = studentReadiness;
    const checks = readiness?.focuses || [];
    const first = (st.name || '').trim().split(/\s+/)[0] || 'They';
    const since = readiness?.lastClassDate || lastClass?.date || null;
    const training = activity
      .filter((ev) => ev.type === 'training')
      .map((ev) => ({ id: ev.id, date: ev.date, minutes: ev.durationMin || 0, focusName: ev.focusName }));
    const { list: sessions, minutes } = practiceSince(training, since);
    const sinceText = sincePhrase(since);
    const touched = checks.filter((f) => (f.done || 0) > 0).length;
    const untouched = checks.find((f) => f.tier === 'critical' && !f.done) || checks.find((f) => !f.done);
    const waitLabel = st.age_check === 'minor_pending' ? 'Awaiting verification'
      : CONSENT_BLOCKED.includes(st.consent_status) ? 'Awaiting parent approval' : null;
    const nothingYet = detailLoading && !readiness && focusPoints.length === 0 && activity.length === 0;
    // Drops away on its own once the coach has ticked everything off.
    const showHighlight = highlightChecks && pendingChecks().total > 0;
    const checkCount = [
      checks.length > 0 && `${checks.length} focus`,
      openQuestions.length > 0 && plural(openQuestions.length, 'question'),
    ].filter(Boolean).join(' · ');

    return (
      <SafeAreaView style={lessonStyles.page} edges={['top']}>
        <TopBar
          onBack={backFromBriefing}
          title={st.name}
          sub={briefingCategoryRef.current ? (briefingCategoryRef.current === 'latin' ? 'Latin' : 'Ballroom') : null}
          right={<Avatar name={st.name} photoUrl={st.photoUrl} size={36} />}
        />
        <ScrollView
          contentContainerStyle={[lessonStyles.scroll, { paddingBottom: 110 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        >
          {nothingYet ? renderBriefingBones() : (
            <FadeIn>
              <Hero
                big={readiness?.percent ?? null}
                title={st.name}
                label={waitLabel || (readiness ? 'Ready for this lesson' : 'No carryover from a private yet')}
                gauge={readiness ? readiness.percent : null}
                figures={[
                  { value: sessions.length, label: sessions.length === 1 ? 'session' : 'sessions' },
                  { value: minutes, unit: 'min', label: 'practised' },
                  { value: openQuestions.length, label: openQuestions.length === 1 ? 'question' : 'questions' },
                ]}
              >
                {sessions.length > 0 ? (
                  <>
                    Practised <HeroStrong>{minutes > 0 ? `${minutes} min in ` : ''}{plural(sessions.length, 'session')}</HeroStrong> {sinceText}
                    {checks.length > 0
                      ? <> and touched <HeroStrong>{touched} of {checks.length}</HeroStrong> focus points.</>
                      : '.'}
                    {!!untouched && (untouched.tier === 'critical'
                      ? <> <HeroAlert>“{untouched.name}”</HeroAlert>, flagged critical, has had no practice.</>
                      : <> <HeroAlert>“{untouched.name}”</HeroAlert> hasn’t been practised yet.</>)}
                  </>
                ) : checks.length > 0 ? (
                  <>
                    No solo practice {sinceText}: <HeroAlert>none of the {checks.length} focus points</HeroAlert> from the last private has been worked on.
                  </>
                ) : (
                  <>No solo practice {sinceText}.</>
                )}
              </Hero>

              <SectionHead title="Check during this lesson" right={checkCount || null} />
              {checks.length === 0 && openQuestions.length === 0 ? (
                <Card>
                  <Empty>Nothing carried over from {first}’s last private, and no questions waiting.</Empty>
                </Card>
              ) : (
                <Card style={showHighlight && ls.cardHighlight}>
                  {checks.map((f, i) => {
                    const verdict = readinessVerdicts[f.focusPointId];
                    return (
                      <CheckRow
                        key={f.focusPointId}
                        first={i === 0}
                        name={f.name}
                        tier={f.tier}
                        meta={f.done ? `${f.done} of ${f.target} sessions done` : 'no practice yet'}
                        done={verdict === 'good'}
                        verdict={verdict}
                        disabled={!classStartedAt}
                        onPress={() => toggleCheck(f.focusPointId)}
                      />
                    );
                  })}
                  {checks.length > 0 && openQuestions.length > 0 && <CardLabel>Questions</CardLabel>}
                  {openQuestions.map((q, i) => (
                    <QuestionRow
                      key={q.id}
                      first={i === 0}
                      text={q.message}
                      meta={q.status === 'dismissed' ? 'Kept for this lesson' : askedLabel(q.created_at)}
                      answered={questionVerdicts[q.id] === 'covered'}
                      onPress={() => setViewingQuestion(q)}
                      onAnswer={() => toggleAnswered(q.id)}
                      disabled={!classStartedAt}
                    />
                  ))}
                </Card>
              )}

              <SectionHead
                title="Activity"
                right={sessions.length > 0 ? `${plural(sessions.length, 'session')} · ${minutes} min ${sinceText}` : null}
              />
              {renderPracticeTimeline(sessions, 'solo', lastClass ? {
                label: `${dayLabel(lastClass.date)} · last private with you`,
                title: lastClass.title || lastClass.dance || 'Private lesson',
                detail: lastClass.focusCount ? `${plural(lastClass.focusCount, 'focus point')} set` : null,
                onPress: lastClass.id ? () => navigation.navigate('CoachClassDetail', { classId: lastClass.id }) : null,
              } : null)}
            </FadeIn>
          )}
        </ScrollView>

        {renderFoot()}
        {renderLessonModals()}
      </SafeAreaView>
    );
  }

  // ── Couple lesson ──────────────────────────────────────────────────────
  // Same page as a private; couples have no questions or class recap.
  if (view === 'couple-briefing' && selectedCouple) {
    const c = selectedCouple;
    const readiness = coupleReadinessDetail;
    const checks = readiness?.focuses || [];
    const since = readiness?.lastClassDate || null;
    const training = coupleActivity.map((ev) => ({
      id: ev.id, date: ev.completedAt, minutes: ev.durationMinutes || 0, focusName: ev.focusName,
    }));
    const { list: sessions, minutes } = practiceSince(training, since);
    const sinceText = sincePhrase(since);
    const touched = checks.filter((f) => (f.done || 0) > 0).length;
    const untouched = checks.find((f) => f.tier === 'critical' && !f.done) || checks.find((f) => !f.done);
    const nothingYet = detailLoading && !readiness && coupleFps.length === 0;
    const showHighlight = highlightChecks && pendingChecks().total > 0;

    return (
      <SafeAreaView style={lessonStyles.page} edges={['top']}>
        <TopBar
          onBack={backFromBriefing}
          title={c.name}
          sub="Couple lesson"
          right={<PairAvatars a={c.dancerA} b={c.dancerB} size={32} ring={L.PAGE} />}
        />
        <ScrollView
          contentContainerStyle={[lessonStyles.scroll, { paddingBottom: 110 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        >
          {nothingYet ? renderBriefingBones() : (
            <FadeIn>
              <Hero
                big={readiness?.percent ?? null}
                title={c.name}
                label={readiness ? 'Ready for this lesson' : 'No couple private yet'}
                gauge={readiness ? readiness.percent : null}
                figures={[
                  { value: sessions.length, label: sessions.length === 1 ? 'session' : 'sessions' },
                  { value: minutes, unit: 'min', label: 'practised' },
                  { value: coupleFps.length, label: 'focus points' },
                ]}
              >
                {sessions.length > 0 ? (
                  <>
                    Practised together <HeroStrong>{minutes > 0 ? `${minutes} min in ` : ''}{plural(sessions.length, 'session')}</HeroStrong> {sinceText}
                    {checks.length > 0
                      ? <> and touched <HeroStrong>{touched} of {checks.length}</HeroStrong> focus points.</>
                      : '.'}
                    {!!untouched && (untouched.tier === 'critical'
                      ? <> <HeroAlert>“{untouched.name}”</HeroAlert>, flagged critical, has had no practice.</>
                      : <> <HeroAlert>“{untouched.name}”</HeroAlert> hasn’t been practised yet.</>)}
                  </>
                ) : checks.length > 0 ? (
                  <>
                    No couple practice {sinceText}: <HeroAlert>none of the {checks.length} focus points</HeroAlert> from the last couple private has been worked on.
                  </>
                ) : (
                  <>No couple practice {sinceText}.</>
                )}
              </Hero>

              <SectionHead title="Check during this lesson" right={checks.length > 0 ? `${checks.length} focus` : null} />
              {checks.length === 0 ? (
                <Card><Empty>Nothing carried over from a couple private yet.</Empty></Card>
              ) : (
                <Card style={showHighlight && ls.cardHighlight}>
                  {checks.map((f, i) => {
                    const verdict = readinessVerdicts[f.focusPointId];
                    return (
                      <CheckRow
                        key={f.focusPointId}
                        first={i === 0}
                        name={f.name}
                        tier={f.tier}
                        meta={f.done ? `${f.done} of ${f.target} sessions done` : 'no practice yet'}
                        done={verdict === 'good'}
                        verdict={verdict}
                        disabled={!classStartedAt}
                        onPress={() => toggleCheck(f.focusPointId)}
                      />
                    );
                  })}
                </Card>
              )}

              <SectionHead
                title="Activity"
                right={sessions.length > 0 ? `${plural(sessions.length, 'session')} · ${minutes} min ${sinceText}` : null}
              />
              {renderPracticeTimeline(sessions, 'couple', since ? {
                label: `${dayLabel(since)} · last couple private`,
                title: 'Couple private',
                detail: checks.length ? `${plural(checks.length, 'focus point')} set` : null,
              } : null)}
            </FadeIn>
          )}
        </ScrollView>

        {renderFoot()}
        {renderLessonModals()}
      </SafeAreaView>
    );
  }

  // ── Group class ────────────────────────────────────────────────────────
  if (view === 'group-briefing') {
    const totalStudents = students.length;
    const onTrack = students.filter((x) => x.status === 'on_track').length;
    const onTrackPct = totalStudents > 0 ? Math.round((onTrack / totalStudents) * 100) : null;
    const topFocus = groupFPs[0] || null;
    const underPracticed = [...groupFPs].sort((a, b) => a.practiced - b.practiced)[0];
    const weekSessions = groupStats.totalSessions;
    const nothingYet = groupLoading && groupFPs.length === 0;

    return (
      <SafeAreaView style={lessonStyles.page} edges={['top']}>
        <TopBar onBack={backFromBriefing} title="Group class" sub={plural(totalStudents, 'student')} />
        <ScrollView
          contentContainerStyle={[lessonStyles.scroll, { paddingBottom: 110 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        >
          {nothingYet ? renderBriefingBones() : (
            <FadeIn>
              <Hero
                big={onTrackPct}
                title="Group class"
                label="On track this week"
                gauge={onTrackPct}
                figures={[
                  { value: totalStudents, label: totalStudents === 1 ? 'student' : 'students' },
                  { value: groupStats.avgSessions, label: 'avg sessions' },
                  { value: groupStats.totalQuestions, label: groupStats.totalQuestions === 1 ? 'question' : 'questions' },
                ]}
              >
                {groupFPs.length === 0 ? (
                  <>No shared focus points yet: they appear once your students have lessons logged.</>
                ) : (
                  <>
                    The group logged <HeroStrong>{plural(weekSessions, 'session')}</HeroStrong> this week.
                    {!!topFocus && (
                      <> <HeroStrong>{topFocus.name}</HeroStrong> was practised most ({topFocus.practiced} of {totalStudents}).</>
                    )}
                    {!!underPracticed && underPracticed !== topFocus && underPracticed.practiced < totalStudents / 2 && (
                      <> <HeroAlert>“{underPracticed.name}”</HeroAlert> only by {underPracticed.practiced}: worth a group drill.</>
                    )}
                  </>
                )}
              </Hero>

              <SectionHead title="Most common focus points" right={groupFPs.length > 0 ? 'practised this week' : null} />
              {groupFPs.length === 0 ? (
                <Card><Empty>Nothing shared across the group yet.</Empty></Card>
              ) : (
                <Card>
                  {groupFPs.slice(0, 6).map((fp, i) => {
                    const ratio = totalStudents > 0 ? fp.practiced / totalStudents : 0;
                    return (
                      <View key={fp.name} style={[ls.fpRow, i > 0 && ls.rowLine]}>
                        <Text style={ls.fpRank}>{i + 1}</Text>
                        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                          <View style={ls.fpHead}>
                            <Text style={ls.fpName} numberOfLines={1}>{fp.name}</Text>
                            <Text style={ls.fpCount}>{fp.practiced}/{totalStudents}</Text>
                          </View>
                          <View style={ls.fpTrack}>
                            <View style={[ls.fpFill, { width: `${Math.max(3, ratio * 100)}%` }]} />
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </Card>
              )}

              {attentionStudents.length > 0 && (
                <>
                  <SectionHead title="Need attention" right={plural(attentionStudents.length, 'student')} />
                  <Card>
                    {attentionStudents.map((a, i) => {
                      const high = a.severity === 'high';
                      return (
                        <View key={a.id} style={[ls.attRow, i > 0 && ls.rowLine]}>
                          <Avatar name={a.name} photoUrl={a.photoUrl} size={36} />
                          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                            <Text style={ls.attName} numberOfLines={1}>{a.name}</Text>
                            <Text style={ls.attReason} numberOfLines={1}>{a.reason}</Text>
                          </View>
                          <View style={[ls.attChip, high && ls.attChipHigh]}>
                            <Text style={[ls.attChipT, high && { color: L.RED }]}>{high ? 'Silent' : 'Watch'}</Text>
                          </View>
                        </View>
                      );
                    })}
                  </Card>
                </>
              )}
            </FadeIn>
          )}
        </ScrollView>

        {renderFoot()}
        {renderLessonModals()}
      </SafeAreaView>
    );
  }

  return null;
}

// ── Start a lesson styles (the rest lives in components/coach/LessonUI) ─────
const ls = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  doneIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: L.INK, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  doneTitle: { fontFamily: Fonts.ttBold, fontSize: 24, letterSpacing: -0.8, color: L.INK, textAlign: 'center' },
  doneBody: { fontFamily: Fonts.ttRegular, fontSize: 14, lineHeight: 21, color: 'rgba(10,10,10,0.68)', textAlign: 'center', marginTop: 8, maxWidth: 300 },

  rowLine: { borderTopWidth: 1, borderTopColor: 'rgba(10,10,10,0.07)' },
  cardHighlight: { borderColor: L.GOLD, borderWidth: 1.5, backgroundColor: '#FFFDF4' },
  silentDot: { position: 'absolute', right: -1, top: -1, width: 11, height: 11, borderRadius: 6, backgroundColor: L.RED_DOT, borderWidth: 2, borderColor: '#FFFFFF' },
  groupIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: L.INK, alignItems: 'center', justifyContent: 'center' },

  boneHero: { marginTop: 14, borderRadius: 19, backgroundColor: L.INK, padding: 17, gap: 13 },
  boneDark: { backgroundColor: 'rgba(255,255,255,0.14)' },
  boneCard: { backgroundColor: '#FFFFFF', borderRadius: 17, borderWidth: 1, borderColor: 'rgba(10,10,10,0.06)', overflow: 'hidden' },
  boneRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 15 },

  fpRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 15 },
  fpRank: { width: 16, fontFamily: Fonts.ttBold, fontSize: 13, color: L.GOLD_INK, fontVariant: ['tabular-nums'] },
  fpHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  fpName: { flex: 1, fontFamily: Fonts.ttDemiBold, fontSize: 14, letterSpacing: -0.25, color: L.INK },
  fpCount: { fontFamily: Fonts.ttBold, fontSize: 12.5, color: L.INK_62, fontVariant: ['tabular-nums'] },
  fpTrack: { height: 5, borderRadius: 3, backgroundColor: 'rgba(10,10,10,0.08)', overflow: 'hidden' },
  fpFill: { height: 5, borderRadius: 3, backgroundColor: L.GOLD },

  attRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 15 },
  attName: { fontFamily: Fonts.ttDemiBold, fontSize: 14, letterSpacing: -0.25, color: L.INK },
  attReason: { fontFamily: Fonts.ttRegular, fontSize: 11, color: L.INK_62 },
  attChip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, backgroundColor: L.CREAM },
  attChipHigh: { backgroundColor: 'rgba(168,65,47,0.1)' },
  attChipT: { fontFamily: Fonts.ttBold, fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase', color: L.GOLD_INK },

  vRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 15 },
  vName: { fontFamily: Fonts.ttDemiBold, fontSize: 14, letterSpacing: -0.25, lineHeight: 18, color: L.INK },

  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 15 },
  noteText: { flex: 1, fontFamily: Fonts.ttRegular, fontSize: 12.5, lineHeight: 17, color: 'rgba(10,10,10,0.72)' },
});

// ── Choose your mic ─────────────────────────────────────────────────────────
const au = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(10,10,10,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: L.PAGE, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: Spacing.side, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(10,10,10,0.16)', marginBottom: 16 },
  eyebrow: { fontFamily: Fonts.ttDemiBold, fontSize: 9.5, letterSpacing: 1.6, textTransform: 'uppercase', color: L.GOLD_INK },
  title: { fontFamily: Fonts.ttBold, fontSize: 24, letterSpacing: -0.8, color: L.INK, marginTop: 6 },
  sub: { fontFamily: Fonts.ttRegular, fontSize: 13.5, lineHeight: 20, color: 'rgba(10,10,10,0.68)', marginTop: 4 },

  searching: { marginTop: 16, alignItems: 'center', paddingVertical: 24, borderRadius: 17, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(10,10,10,0.06)' },
  coreWrap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  core: { width: 44, height: 44, borderRadius: 13, backgroundColor: L.INK, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: L.GOLD },
  searchTitle: { fontFamily: Fonts.ttDemiBold, fontSize: 14.5, letterSpacing: -0.3, color: L.INK },
  searchSub: { fontFamily: Fonts.ttRegular, fontSize: 11.5, color: L.INK_62, marginTop: 3 },

  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 15 },
  inputIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(10,10,10,0.06)', alignItems: 'center', justifyContent: 'center' },
  inputIconOn: { backgroundColor: L.INK },
  inputName: { fontFamily: Fonts.ttDemiBold, fontSize: 14, letterSpacing: -0.25, color: L.INK },
  inputMeta: { fontFamily: Fonts.ttRegular, fontSize: 11, color: L.INK_62, marginTop: 1 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(10,10,10,0.22)', alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: L.INK },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: L.INK },
  wave: { paddingHorizontal: 15, paddingBottom: 13, gap: 8 },
  waveBars: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 36 },
  waveBar: { flex: 1, height: 32, borderRadius: 999, minWidth: 0 },
  waveLabel: { fontFamily: Fonts.ttDemiBold, fontSize: 11, color: L.GOLD_INK },

  go: { marginTop: 18, height: 58, borderRadius: 999, backgroundColor: L.GOLD, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 11 },
  goT: { fontFamily: Fonts.ttBold, fontSize: 19, letterSpacing: -0.4, color: L.INK },
});
