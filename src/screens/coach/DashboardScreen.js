import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  AppState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Fonts, Spacing } from '../../theme';
import DashboardSkeleton from '../../components/DashboardSkeleton';
import { useCoachData } from '../../context/CoachDataContext';
import { getLessonReadiness } from '../../storage/storage';
import {
  getActiveCoachClass,
  subscribeToActiveCoachClass,
} from '../../storage/activeCoachClass';
import { supabase } from '../../services/supabase/client';
import { isLocalRecordingMode } from '../../services/featureFlags';
import { useDjiAutoSync } from '../../services/useDjiAutoSync';
import { fetchPendingUploads } from '../../services/localRecordingAutoSync';
import * as DjiFiles from 'local-recording-files';
import UploadFlowModal from '../../components/UploadFlowModal';

// ── Palette ─────────────────────────────────────────────────────────────────
// Gold scale + ink + paper, aligned with the May 2026 design refresh.
const GOLD_500 = '#E8B530';
const GOLD_400 = '#F0C24A';
const GOLD_300 = '#F6D27A';
const GOLD_200 = '#F9DF9B';
const INK_950 = '#0A0A0A';
const INK_50 = '#F7F6F3';

// Hero (dark) — radial-gradient base ink with warm depth in the corner.
// We can't do a real radial in RN without extra deps, so we layer a
// solid base + a subtle warm overlay via the border + shadow.
const HERO_BG = '#1A1410';
// Slim golden hairline framing the dark card — more present than the
// previous 22% so the trait reads as deliberate trim, not a soft glow.
const HERO_BORDER = 'rgba(232,181,48,0.55)';

// Status colors — reused in donut, legend indicators, student rings.
const SUCCESS = '#7FB77E';
const WARNING = '#D68A3C';
const RED = '#D44545';

// Status alpha versions (donut strokes, indicator track tints).
const GN = SUCCESS;
const OR = WARNING;
const RD = RED;
const GN_SOLID = SUCCESS;
const OR_SOLID = WARNING;
const RD_SOLID = RED;

// Text scale on light surface.
const T1 = INK_950;
const T2 = 'rgba(10,10,10,0.45)';
const T3 = 'rgba(10,10,10,0.30)';
const LINE = 'rgba(10,10,10,0.09)';

// ── Helpers ─────────────────────────────────────────────────────────────────
function initials(name) {
  if (!name) return '?';
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function formatRelative(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffH < 24 && now.getDate() === d.getDate()) return `Today · ${time}`;
  if (diffDays === 1) return `Yesterday · ${time}`;
  if (diffDays < 7) {
    const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
    return `${weekday} · ${time}`;
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Lesson readiness % → (color, progress) for mini student rings.
// Same 0-100 readiness metric as the student detail hero ring, so the same
// number drives the ring everywhere in the app.
function ringForReadiness(percent) {
  const v = Math.max(0, Math.min(100, percent || 0));
  // Floor progress at 1% so a 0%-ready student still shows a tiny red dot
  // (otherwise the ring vanishes and "0%" looks the same as "no data").
  const progress = Math.max(0.01, v / 100);
  const color = v >= 70 ? GN_SOLID : v >= 40 ? OR_SOLID : RD_SOLID;
  return { color, progress };
}

// ── Donut (pie with hole) ───────────────────────────────────────────────────
// Three segments with gaps, rendered via stroke-dashoffset rotations
function OverviewDonut({ practiced, forgetting, silent, total }) {
  const size = 88;
  const r = 35;
  const strokeWidth = 9;
  const C = 2 * Math.PI * r;

  const totalVal = Math.max(total, 1);
  const gP = practiced / totalVal;
  const gF = forgetting / totalVal;
  const gS = silent / totalVal;

  // Starting offsets (cumulative) — circle starts at 3 o'clock; rotate -90° to start at top
  const startP = 0;
  const startF = practiced / totalVal;
  const startS = (practiced + forgetting) / totalVal;

  function segProps(startFrac, lenFrac) {
    const dash = lenFrac * C;
    const rot = startFrac * 360 - 90;
    return {
      strokeDasharray: `${dash} ${C}`,
      strokeDashoffset: 0,
      transform: `rotate(${rot} ${size / 2} ${size / 2})`,
    };
  }

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {/* Background track */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {gP > 0 && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={GN}
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
            fill="none"
            {...segProps(startP, gP)}
          />
        )}
        {gF > 0 && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={OR}
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
            fill="none"
            {...segProps(startF, gF)}
          />
        )}
        {gS > 0 && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={RD}
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
            fill="none"
            {...segProps(startS, gS)}
          />
        )}
      </Svg>
      <View style={StyleSheet.absoluteFillObject}>
        <View style={styles.donutCenter}>
          <View style={styles.donutNumRow}>
            <Text style={styles.donutNum}>{practiced}</Text>
            <Text style={styles.donutNumOf}>/{total}</Text>
          </View>
          <Text style={styles.donutLabel}>ACTIVE</Text>
        </View>
      </View>
    </View>
  );
}

// ── Mini ring for a single student ──────────────────────────────────────────
function StudentRing({ student, readinessPercent = 0, actionCount = 0, onPress }) {
  const { color, progress } = ringForReadiness(readinessPercent);
  const photoUri = student.photoUrl || student.photo_url || student.avatar_url;
  const size = 50;
  const r = 22;
  const strokeWidth = 3;
  const C = 2 * Math.PI * r;
  const offset = C * (1 - progress);

  return (
    <TouchableOpacity style={miniS.wrap} onPress={onPress} activeOpacity={0.75}>
      <View style={{ width: size, height: size, marginBottom: 5 }}>
        <Svg width={size} height={size}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="rgba(0,0,0,0.06)"
            strokeWidth={strokeWidth}
            fill="none"
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${C} ${C}`}
            strokeDashoffset={offset}
            fill="none"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <View style={[StyleSheet.absoluteFillObject, miniS.avatarWrap]}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={miniS.photo} />
          ) : (
            <View style={[miniS.avatar, { backgroundColor: `${color}22` }]}>
              <Text style={[miniS.avatarText, { color }]}>
                {initials(student.name)}
              </Text>
            </View>
          )}
        </View>
        {actionCount > 0 && (
          <View style={miniS.actionBadge}>
            <Text style={miniS.actionBadgeText}>
              {actionCount > 9 ? '9+' : actionCount}
            </Text>
          </View>
        )}
      </View>
      <Text style={miniS.name} numberOfLines={1}>
        {student.name.split(' ')[0]}
      </Text>
    </TouchableOpacity>
  );
}

// ── Activity row (timeline) ─────────────────────────────────────────────────
function ActivityRow({ item, isLast }) {
  let tone = 'gn';
  let verb = '';
  let detail = '';

  let subject = '';
  if (item.type === 'training') {
    tone = 'gn';
    if (item.focusName) {
      verb = 'practiced';
      subject = `"${item.focusName}"`;
    } else {
      verb = 'practiced';
    }
    detail = item.durationMin ? `${item.durationMin} min` : '';
  } else if (item.type === 'class') {
    tone = 'or';
    verb = 'logged a class';
    subject = item.title || item.dance || '';
    detail = '';
  } else if (item.type === 'question') {
    tone = 'dim';
    verb = 'asked a question';
    detail = 'waiting for your reply';
  }

  const circleColor =
    tone === 'gn' ? 'rgba(61,170,71,0.45)'
      : tone === 'or' ? 'rgba(232,168,56,0.45)'
        : '#D0D0D0';

  const verbColor =
    tone === 'gn' ? 'rgba(61,170,71,0.75)'
      : tone === 'or' ? 'rgba(232,168,56,0.85)'
        : T3;

  return (
    <View style={actS.row}>
      <View style={[actS.circle, { borderColor: circleColor }]}>
        <View style={[actS.circleDot, { backgroundColor: circleColor }]} />
      </View>
      <View style={actS.body}>
        <Text style={actS.time}>{formatRelative(item.date)}</Text>
        <Text style={actS.text}>
          <Text style={actS.textStrong}>{item.studentName || 'Student'} </Text>
          <Text style={[actS.textVerb, { color: verbColor }]}>{verb}</Text>
          {!!subject && <Text> {subject}</Text>}
          {!!detail && <Text style={actS.textDim}> — {detail}</Text>}
        </Text>
      </View>
    </View>
  );
}

// ── DJI auto-sync status pill ──────────────────────────────────────────
// Visually swaps into the START CLASS button slot while the foreground
// poller (useDjiAutoSync) is running an import. Module-level helper so it
// doesn't get re-created on every Dashboard render.
function renderSyncPill(autoSync) {
  const { phase, currentIdx, total, imported, pending, errorMessage } = autoSync;

  let label;
  let leftEl;
  let bgStyle;
  let textStyle;

  if (phase === 'detecting') {
    label = 'Detecting mic…';
    leftEl = <ActivityIndicator size="small" color={INK_950} />;
    bgStyle = styles.syncPillNeutral;
    textStyle = styles.syncPillTextDark;
  } else if (phase === 'syncing') {
    label = total > 0
      ? `Importing ${currentIdx} of ${total}…`
      : 'Importing…';
    leftEl = <ActivityIndicator size="small" color={INK_950} />;
    bgStyle = styles.syncPillNeutral;
    textStyle = styles.syncPillTextDark;
  } else if (phase === 'done') {
    // Surface admin-review count alongside the imported count so the
    // coach knows some files still need a human pass on inbetween-admin.
    const reviewSuffix = pending > 0 ? ` (${pending} for review)` : '';
    label = imported === 1
      ? `1 recording synced${reviewSuffix}`
      : `${imported} recordings synced${reviewSuffix}`;
    leftEl = <Ionicons name="checkmark-circle" size={16} color="#2D8A4A" />;
    bgStyle = styles.syncPillSuccess;
    textStyle = styles.syncPillTextSuccess;
  } else if (phase === 'error') {
    label = 'Sync error — tap UPLOAD to retry';
    leftEl = <Ionicons name="alert-circle" size={16} color="#B33A3A" />;
    bgStyle = styles.syncPillError;
    textStyle = styles.syncPillTextError;
    // errorMessage is logged but not surfaced in the pill itself —
    // most error strings are too long for the CTA-sized slot.
    void errorMessage;
  } else {
    return null;
  }

  return (
    <View style={[styles.syncPill, bgStyle]}>
      {leftEl}
      <Text style={[styles.syncPillText, textStyle]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────
export default function DashboardScreen({ navigation }) {
  const { students, events, actionCounts, studentActionCounts, initialLoading: loading } = useCoachData();

  // Subscribe to the running coach class so the Start Class button swaps
  // into a compact "Class in Progress" pill (same spirit as HomeScreen).
  const [activeClass, setActiveClass] = useState(getActiveCoachClass());
  const [chronoTick, setChronoTick] = useState(0);

  // Local-recording-mode user check (gated to viatteloic@gmail.com). When
  // true, we surface a "Upload pending recordings" entry point so the
  // coach can attach DJI mic WAV files to completed classes.
  const [authUser, setAuthUser] = useState(null);
  useEffect(() => {
    supabase.auth.getUser()
      .then(({ data: { user } }) => setAuthUser(user))
      .catch(() => setAuthUser(null));
  }, []);
  const isLocalMode = isLocalRecordingMode(authUser);

  // Auto-detects DJI mic file additions while the coach has the app open
  // and automatically imports them. Polls the bookmarked folder every 5s
  // when the app is foregrounded; surfaces sync progress as state we
  // project into the START CLASS button below.
  const autoSync = useDjiAutoSync({
    userId: authUser?.id ?? null,
    enabled: isLocalMode,
  });

  // First-run gate: tracks whether the coach has already granted folder
  // access to the DJI mic. iOS sandboxing requires an explicit user pick
  // via UIDocumentPicker the first time — after that the bookmark is
  // persisted in UserDefaults and the auto-sync resolves it silently on
  // every subsequent plug-in. We surface this state to gate the
  // onboarding card vs. the regular UPLOAD button.
  const [hasFolderAccess, setHasFolderAccess] = useState(false);
  useEffect(() => {
    if (!isLocalMode) {
      setHasFolderAccess(false);
      return;
    }
    const check = () => {
      try {
        setHasFolderAccess(DjiFiles.hasFolder?.() ?? false);
      } catch {
        setHasFolderAccess(false);
      }
    };
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, [isLocalMode]);

  // Upload-flow modal: opened when the coach taps the big UPLOAD button
  // on the dashboard (Phase 2, after folder access is granted). Walks
  // through plug-in detection → connected → syncing → done. Replaces
  // the old "navigate to LocalUploadScreen" path for the primary flow.
  const [uploadFlowModalOpen, setUploadFlowModalOpen] = useState(false);

  // How many classes are waiting on audio. Drives whether the manual
  // UPLOAD DJI RECORDING fallback button is shown — when there's nothing
  // pending we hide it entirely so the dashboard stays clean. Refreshed
  // on mount, on app foreground, and right after an auto-sync completes
  // (since the count just changed).
  const [pendingUploadCount, setPendingUploadCount] = useState(0);
  useEffect(() => {
    if (!isLocalMode || !authUser?.id) {
      setPendingUploadCount(0);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const rows = await fetchPendingUploads(authUser.id);
        if (!cancelled) setPendingUploadCount(rows.length);
      } catch {
        /* ignore — keep last value */
      }
    };
    refresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [isLocalMode, authUser?.id]);
  // Re-fetch when an auto-sync run lands so the manual fallback button
  // shows/hides without needing a manual refresh.
  useEffect(() => {
    if (!isLocalMode || !authUser?.id) return;
    if (autoSync.phase !== 'done' && autoSync.phase !== 'error') return;
    fetchPendingUploads(authUser.id)
      .then((rows) => setPendingUploadCount(rows.length))
      .catch(() => {});
  }, [autoSync.phase, isLocalMode, authUser?.id]);

  // Also refetch every time the dashboard regains focus (e.g. coach
  // finishes a class on StartClassScreen and navigates back). React
  // Navigation keeps the dashboard mounted in the stack, so AppState
  // change + initial useEffect don't fire — we need useFocusEffect to
  // catch this transition.
  useFocusEffect(
    useCallback(() => {
      if (!isLocalMode || !authUser?.id) return;
      fetchPendingUploads(authUser.id)
        .then((rows) => setPendingUploadCount(rows.length))
        .catch(() => {});
    }, [isLocalMode, authUser?.id]),
  );

  useEffect(() => subscribeToActiveCoachClass(setActiveClass), []);
  useEffect(() => {
    if (!activeClass) return;
    const id = setInterval(() => setChronoTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [activeClass]);
  const chronoLabel = useMemo(() => {
    if (!activeClass) return '';
    const total = Math.floor((Date.now() - activeClass.startedAt) / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(sec).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClass, chronoTick]);

  // ── Per-student readiness ────────────────────────────────────────────────
  // Pulls readiness for every student in one batch and derives two signals:
  //   - readiestStudent: the highest % (drives the "MOST READY" card)
  //   - globalReadinessAvg: mean across all students (drives the "GLOBAL AVG
  //     READINESS" gauge — now aligned with the same readiness metric shown
  //     everywhere else in the app, instead of the older composite
  //     progression/retention/regularity health score).
  // Students with no readiness data count as 0% in the average so newly
  // added students don't disappear from the denominator.
  const [readiestStudent, setReadiestStudent] = useState(null);
  const [readiestLoading, setReadiestLoading] = useState(false);
  const [globalReadinessAvg, setGlobalReadinessAvg] = useState(0);
  const [readinessByStudent, setReadinessByStudent] = useState({});
  const lastReadiestSigRef = useRef(null);

  useEffect(() => {
    if (!students || students.length === 0) {
      setReadiestStudent(null);
      setGlobalReadinessAvg(0);
      setReadinessByStudent({});
      return;
    }
    const signature = students.map((s) => s.id).sort().join('|');
    if (signature === lastReadiestSigRef.current) return;
    lastReadiestSigRef.current = signature;

    let alive = true;
    async function run() {
      setReadiestLoading(true);
      try {
        const readinesses = await Promise.all(
          students.map((s) => getLessonReadiness(s.id).catch(() => null)),
        );
        if (!alive) return;
        let best = null;
        let bestPct = -1;
        let sum = 0;
        const byStudent = {};
        for (let i = 0; i < students.length; i++) {
          const r = readinesses[i];
          const pct = r?.percent ?? 0;
          byStudent[students[i].id] = pct;
          sum += pct;
          if (r && pct > bestPct) {
            bestPct = pct;
            best = { student: students[i], readiness: r };
          }
        }
        setReadiestStudent(best);
        setGlobalReadinessAvg(Math.round(sum / students.length));
        setReadinessByStudent(byStudent);
      } catch {
        if (alive) {
          setReadiestStudent(null);
          setGlobalReadinessAvg(0);
          setReadinessByStudent({});
        }
      } finally {
        if (alive) setReadiestLoading(false);
      }
    }
    run();
    return () => {
      alive = false;
    };
  }, [students]);

  const stats = useMemo(() => {
    const practicedList = students.filter((s) => s.status === 'on_track');
    const inProgressList = students.filter((s) => s.status === 'attention');
    const silentList = students.filter((s) => s.status === 'silent');
    const practiced = practicedList.length;
    const inProgress = inProgressList.length;
    const silent = silentList.length;
    const total = students.length;
    const actions = inProgress + silent;
    return {
      practiced, inProgress, silent, total, actions,
      practicedList, inProgressList, silentList,
    };
  }, [students]);

  // Hero "since last class" — relative time of the most recent class event,
  // shown top-right of the hero card. Falls back to empty string if none.
  const lastClassRelative = useMemo(() => {
    const latest = students.reduce((acc, s) => {
      const d = s.lastClassDate || s.lastPrivateClassDate;
      if (!d) return acc;
      const t = new Date(d).getTime();
      return t > acc ? t : acc;
    }, 0);
    if (!latest) return '';
    const diffMs = Date.now() - latest;
    const days = Math.floor(diffMs / 86400000);
    if (days < 1) {
      const hours = Math.floor(diffMs / 3600000);
      if (hours < 1) return 'JUST NOW';
      return `${hours}H AGO`;
    }
    if (days === 1) return 'YESTERDAY';
    if (days < 7) return `${days} DAYS AGO`;
    if (days < 30) return `${Math.floor(days / 7)}W AGO`;
    return `${Math.floor(days / 30)}MO AGO`;
  }, [students]);


  if (loading) return <DashboardSkeleton />;

  return (
    <View style={styles.safe}>
      {/* Exact same vertical paper gradient as the student TRAIN screen
          (HomeScreen.js) — byte-for-byte identical for visual parity. */}
      <LinearGradient
        colors={['#F2F2EF', '#F8F2E2', '#F4EAD0', '#FFFFFF', '#FFFFFF']}
        locations={[0, 0.4, 0.7, 0.85, 1]}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      <View style={styles.fixed}>
        {/* ── Students horizontal scroll ── */}
        {students.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.studentsScroll}
            style={styles.studentsScrollOuter}
          >
            {students.map((s) => (
              <StudentRing
                key={s.id}
                student={s}
                readinessPercent={readinessByStudent[s.id] || 0}
                actionCount={studentActionCounts?.[s.id] || 0}
                onPress={() =>
                  navigation.navigate('StudentDetail', {
                    studentId: s.id,
                    studentName: s.name,
                  })
                }
              />
            ))}
          </ScrollView>
        ) : (
          <View style={styles.emptyStudents}>
            <Text style={styles.emptyStudentsText}>No students yet</Text>
          </View>
        )}

        {/* ── Hero overview card ── */}
        <View style={styles.hero}>
          <View style={styles.heroHead}>
            <View style={styles.heroHeadLabelRow}>
              <View style={styles.heroHeadLine} />
              <Text style={styles.heroHeadLabel}>SINCE LAST CLASS</Text>
            </View>
            {!!lastClassRelative && (
              <Text style={styles.heroHeadTime}>{lastClassRelative}</Text>
            )}
          </View>

          <View style={styles.donutRow}>
            <OverviewDonut
              practiced={stats.practiced}
              forgetting={stats.inProgress}
              silent={stats.silent}
              total={stats.total}
            />
            <View style={styles.heroLegend}>
              <LegendRow color={SUCCESS} num={stats.practiced} label="Practiced" />
              <LegendRow color={WARNING} num={stats.inProgress} label="In progress" />
              <LegendRow color={RED} num={stats.silent} label="Silent" />
            </View>
          </View>

          <TouchableOpacity
            style={styles.avgBlock}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('STUDENTS')}
          >
            <View style={styles.avgHead}>
              <Text style={styles.avgLabel}>GLOBAL AVG READINESS</Text>
              <View style={styles.avgValueRow}>
                <Text style={styles.avgValue}>{globalReadinessAvg}</Text>
                <Text style={styles.avgPercent}>%</Text>
              </View>
            </View>
            <View style={styles.avgTrack}>
              <View
                style={[
                  styles.avgFill,
                  { width: `${Math.max(2, Math.min(100, globalReadinessAvg))}%` },
                ]}
              />
            </View>
          </TouchableOpacity>

          {/* CTA row — Start Class fills, Actions chip sits to the right
              when the coach has pending alerts. Same layout pattern as
              before the May 2026 refresh, restyled to the new palette. */}
          <View style={styles.ctaRow}>
            {activeClass ? (
              <TouchableOpacity
                style={styles.inProgressBtn}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('StartClass')}
              >
                <View style={styles.inProgressLeft}>
                  <View style={styles.inProgressDot} />
                  <Text style={styles.inProgressLabel}>CLASS IN PROGRESS</Text>
                </View>
                <View style={styles.inProgressRight}>
                  <Text style={styles.inProgressTimer}>{chronoLabel}</Text>
                  <Text style={styles.inProgressArrow}>›</Text>
                </View>
              </TouchableOpacity>
            ) : autoSync.phase !== 'idle' ? (
              // In place of START CLASS: live status of the auto-sync.
              // The coach plugs the mic, the app picks it up via the
              // foreground polling in useDjiAutoSync and surfaces progress
              // here. No tap needed — fully automatic for high-confidence
              // matches; lower-confidence imports still upload but flag
              // for review on inbetween-admin.
              renderSyncPill(autoSync)
            ) : isLocalMode && hasFolderAccess && pendingUploadCount > 0 ? (
              // ── Phase 2 CTA: priority on UPLOAD (ink, big) + START CLASS
              // demoted to a small outlined chip next to it. The coach
              // typically taps UPLOAD right after a class ends, which
              // walks them through the plug-in + sync flow via the
              // UploadFlow modal below.
              <>
                <TouchableOpacity
                  style={styles.uploadPrimaryBtn}
                  activeOpacity={0.88}
                  onPress={() => setUploadFlowModalOpen(true)}
                  // Hidden affordance: long-press opens the legacy
                  // LocalUploadScreen with its "Reset folder access" /
                  // "Pick a single file manually" controls. Lets a
                  // power user re-pick the folder bookmark without
                  // needing to interrupt the main upload modal flow.
                  onLongPress={() => navigation.navigate('LocalUpload')}
                  delayLongPress={550}
                >
                  <Ionicons name="cloud-upload-outline" size={16} color={INK_950} />
                  {/* numberOfLines + adjustsFontSizeToFit keeps "UPLOAD
                      99 RECORDINGS" on a single line: the text engine
                      shrinks the font (down to minimumFontScale) when
                      it doesn't fit, rather than wrapping or clipping. */}
                  <Text
                    style={styles.uploadPrimaryText}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.65}
                  >
                    UPLOAD {pendingUploadCount === 1 ? '1 RECORDING' : `${pendingUploadCount} RECORDINGS`}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.startClassSmallBtn}
                  activeOpacity={0.85}
                  onPress={async () => {
                    if (isLocalMode) {
                      try { await DjiFiles.stopAudioRouteMonitor?.(); } catch {}
                    }
                    navigation.navigate('StartClass');
                  }}
                >
                  <Ionicons name="play" size={12} color={INK_950} />
                  <Text style={styles.startClassSmallText}>START</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={styles.startClassBtn}
                activeOpacity={0.88}
                onPress={async () => {
                  // Local-recording-mode invariant: no audio session
                  // active during the cours. If the route monitor is
                  // running (first-run setup mode), stop it before
                  // jumping to the class screen so the BT speaker stays
                  // in A2DP throughout the cours.
                  if (isLocalMode) {
                    try { await DjiFiles.stopAudioRouteMonitor?.(); } catch {}
                  }
                  navigation.navigate('StartClass');
                }}
              >
                <Ionicons name="play" size={13} color={INK_950} />
                <Text style={styles.startClassText}>START CLASS</Text>
              </TouchableOpacity>
            )}

            {actionCounts?.total > 0 && (
              <TouchableOpacity
                style={[
                  styles.actionsBtn,
                  { backgroundColor: actionCounts.focus > 0 ? RED : WARNING },
                ]}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('ActionNeeded')}
              >
                <Text style={styles.actionsBtnNum}>{actionCounts.total}</Text>
                <Ionicons name="alert" size={14} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── Most-ready student for next private ── */}
        <Text style={styles.sectionLabelLow}>MOST READY FOR NEXT PRIVATE</Text>
        <TouchableOpacity
          style={styles.focusCard}
          activeOpacity={readiestStudent ? 0.85 : 1}
          disabled={!readiestStudent}
          onPress={() => {
            if (!readiestStudent) return;
            navigation.navigate('StudentDetail', {
              studentId: readiestStudent.student.id,
              studentName: readiestStudent.student.name,
            });
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.focusTitle}>
              {readiestLoading
                ? 'Checking readiness…'
                : readiestStudent?.student?.name || 'No student ready yet'}
            </Text>
            <Text style={styles.focusSub}>
              {readiestLoading
                ? 'Looking at what each student has trained'
                : readiestStudent
                  ? `${readiestStudent.readiness.percent}% ready · ${readiestStudent.readiness.focuses.length} focus point${readiestStudent.readiness.focuses.length > 1 ? 's' : ''} from last private`
                  : (students.length > 0 ? 'Log a private with one of your students to start tracking' : '')}
            </Text>
          </View>
          {readiestStudent && (
            <View style={styles.focusAvatars}>
              <View style={[styles.focusAvatar, { marginLeft: 0 }]}>
                {(readiestStudent.student.photoUrl || readiestStudent.student.photo_url) ? (
                  <Image
                    source={{ uri: readiestStudent.student.photoUrl || readiestStudent.student.photo_url }}
                    style={styles.focusAvatarImg}
                  />
                ) : (
                  <Text style={styles.focusAvatarText}>{initials(readiestStudent.student.name)}</Text>
                )}
              </View>
            </View>
          )}
        </TouchableOpacity>

        {/* ── Recent activity label (fixed) ── */}
        <Text style={styles.sectionLabelLow}>RECENT ACTIVITY</Text>

        {/* ── Recent activity timeline (scrollable) ── */}
        <ScrollView
          style={styles.timelineScroll}
          contentContainerStyle={styles.timelineScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {events.length > 0 ? (
            <View style={styles.timeline}>
              <View style={styles.timelineLine} />
              {events.map((item, idx) => (
                <ActivityRow
                  key={(item.id || '') + idx}
                  item={item}
                  isLast={idx === events.length - 1}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.emptyActivity}>
              {loading ? ' ' : 'No activity yet.'}
            </Text>
          )}

        </ScrollView>
      </View>

      {/* Phase-2 upload flow — opens when the coach taps the big UPLOAD
          button. Internally handles plug-in detection, sync execution,
          and success/error states. */}
      <UploadFlowModal
        visible={uploadFlowModalOpen}
        userId={authUser?.id ?? null}
        onClose={() => setUploadFlowModalOpen(false)}
        onDone={() => {
          setUploadFlowModalOpen(false);
          if (authUser?.id) {
            fetchPendingUploads(authUser.id)
              .then((rows) => setPendingUploadCount(rows.length))
              .catch(() => {});
          }
        }}
      />
    </View>
  );
}

// Hero legend row — vertical indicator + label + optional meta + number.
// `meta` shape: { name: string (bolded), tail: string } or { tail: string }
// for empty rows. When num=0 we render the row in a dimmed "empty" style.
function LegendRow({ color, num, label, meta }) {
  const isEmpty = !num;
  return (
    <View style={styles.legendRow}>
      <View
        style={[
          styles.legendIndicator,
          { backgroundColor: isEmpty ? 'rgba(255,255,255,0.14)' : color },
        ]}
      />
      <View style={styles.legendBody}>
        <Text style={[styles.legendLabel, isEmpty && styles.legendLabelEmpty]}>
          {label}
        </Text>
        {meta && (
          <Text style={styles.legendMeta} numberOfLines={1}>
            {meta.name && <Text style={styles.legendMetaName}>{meta.name}</Text>}
            {meta.name && meta.tail ? ' · ' : ''}
            {meta.tail || ''}
          </Text>
        )}
      </View>
      <Text style={[styles.legendNum, isEmpty && styles.legendNumEmpty]}>
        {num}
      </Text>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Transparent — the paper gradient is rendered by CoachMainTabs in
  // App.js, behind both the header and the tab content.
  safe: { flex: 1, backgroundColor: 'transparent' },
  fixed: {
    flex: 1,
  },

  // Header (same pattern as SessionsFeedScreen)
  header: {
    paddingTop: 16,
    paddingHorizontal: Spacing.side,
    paddingBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  notifBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: Colors.orange,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  notifBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9,
    color: '#fff',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5E6C8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPhoto: { width: 36, height: 36, borderRadius: 18 },
  avatarText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#8A6A2E',
  },

  // Section labels
  sectionLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: T3,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    paddingHorizontal: Spacing.side,
    marginBottom: 10,
  },
  sectionLabelLow: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: T3,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    paddingHorizontal: Spacing.side,
    marginTop: 18,
    marginBottom: 10,
  },

  // Students scroll
  studentsScrollOuter: {
    flexGrow: 0,
    flexShrink: 0,
  },
  studentsScroll: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 14,
    gap: 10,
  },
  emptyStudents: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 14,
  },
  emptyStudentsText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: T2,
  },

  // ── Hero card ─────────────────────────────────────────────────────────
  // Dark warm-ink ground with a faint gold border. The mockup's CSS
  // radial-gradient corner glow is approximated via the shadow + border.
  hero: {
    marginHorizontal: 18,
    backgroundColor: HERO_BG,
    borderRadius: 20,
    paddingTop: 14,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderWidth: 1,
    borderColor: HERO_BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.30,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },

  // Hero header — small leading line + uppercase gold label, mono "X ago"
  // pinned to the right.
  heroHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  heroHeadLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroHeadLine: {
    width: 14,
    height: 1,
    backgroundColor: GOLD_300,
  },
  heroHeadLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9.5,
    color: GOLD_300,
    letterSpacing: 1.6,
  },
  heroHeadTime: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 9.5,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.9,
  },

  // Donut row — donut on left, legend on right, divider rule below.
  donutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingBottom: 10,
    marginBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.10)',
  },
  heroLegend: {
    flex: 1,
    gap: 6,
  },

  // Legend row — vertical 3px indicator + label/meta + monospace number.
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  legendIndicator: {
    width: 3,
    height: 18,
    borderRadius: 2,
  },
  legendBody: {
    flex: 1,
    minWidth: 0,
  },
  legendLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#fff',
    letterSpacing: -0.1,
    lineHeight: 15,
  },
  legendLabelEmpty: {
    color: 'rgba(255,255,255,0.40)',
  },
  legendMeta: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 2,
    lineHeight: 13,
  },
  legendMetaName: {
    color: 'rgba(255,255,255,0.85)',
    fontFamily: Fonts.jakartaSemiBold,
  },
  legendNum: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: '#fff',
    letterSpacing: -0.4,
    minWidth: 18,
    textAlign: 'right',
    lineHeight: 22,
    includeFontPadding: false,
  },
  legendNumEmpty: {
    color: 'rgba(255,255,255,0.25)',
  },

  // Donut center — "{practiced}/{total}" big, "ACTIVE" small gold caption.
  donutCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutNumRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  donutNum: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: '#fff',
    letterSpacing: -0.6,
    // Generous lineHeight (~1.5×) so TT Travels Next ExtraBold's tall
    // cap-height doesn't get clipped by the parent flex container.
    lineHeight: 32,
    includeFontPadding: false,
  },
  donutNumOf: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12,
    color: 'rgba(255,255,255,0.40)',
    letterSpacing: -0.2,
    marginLeft: 1,
    lineHeight: 18,
    includeFontPadding: false,
  },
  donutLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 6.5,
    color: GOLD_300,
    letterSpacing: 1.2,
    // Pull tight against the bottom of the lineHeight box of the
    // donutNum row above (which has 32px lineHeight on a 22px font →
    // ~5px of trailing whitespace). Negative margin closes the gap.
    marginTop: -4,
    lineHeight: 9,
    includeFontPadding: false,
  },

  // Global avg readiness — discrete progress block, tappable to STUDENTS.
  avgBlock: {
    marginBottom: 10,
  },
  avgHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 5,
  },
  avgLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9.5,
    color: 'rgba(255,255,255,0.50)',
    letterSpacing: 1.6,
  },
  avgValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  avgValue: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
    color: '#fff',
    letterSpacing: -0.5,
    lineHeight: 24,
    includeFontPadding: false,
  },
  avgPercent: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    marginLeft: 1,
    lineHeight: 15,
    includeFontPadding: false,
  },
  avgTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  avgFill: {
    height: 5,
    borderRadius: 999,
    backgroundColor: GOLD_500,
  },

  // CTAs — full-width at the bottom of the hero. Gold for primary,
  // muted gray-on-ink for the in-progress variant (the gold band is
  // reserved for the start action).
  startClassBtn: {
    flex: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: GOLD_500,
    borderRadius: 10,
  },
  // Beta-only entry for the local-recording workflow (DJI mic on-device
  // storage). Sits above the START CLASS button when isLocalMode.
  localUploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#EAE4D7',
    borderRadius: 10,
    marginBottom: 8,
    marginHorizontal: Spacing.side,
  },
  localUploadText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: INK_950,
    letterSpacing: 1.1,
  },
  startClassText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13.5,
    color: INK_950,
    letterSpacing: 1.2,
  },
  inProgressBtn: {
    flex: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 10,
  },
  inProgressLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  inProgressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: RED,
  },
  inProgressLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
    color: '#fff',
    letterSpacing: 1.0,
  },
  inProgressRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  inProgressTimer: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
    color: '#fff',
    letterSpacing: 0.3,
    fontVariant: ['tabular-nums'],
  },
  inProgressArrow: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 20,
  },

  // CTA row — Start Class flexes to fill, Actions sits as a 2-flex chip
  // on the right (only visible when actions > 0). Mirrors the layout
  // shipped before the May 2026 refresh.
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  actionsBtn: {
    flex: 2,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  actionsBtnNum: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
    color: '#fff',
    letterSpacing: -0.3,
    lineHeight: 18,
    includeFontPadding: false,
  },

  // Focus card
  focusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: Spacing.side,
    backgroundColor: '#FFF',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  focusTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: T1,
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  focusSub: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: T2,
  },
  focusAvatars: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  focusAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#F5E6C8',
    borderWidth: 2.5,
    borderColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusAvatarImg: {
    width: 21,
    height: 21,
    borderRadius: 11,
  },
  focusAvatarText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9,
    color: '#8A6A2E',
  },

  // Timeline (scrollable region — flex:1 takes remaining space above CTA)
  timelineScroll: {
    flex: 1,
  },
  timelineScrollContent: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 30, // clear the tab bar
  },
  timeline: {
    position: 'relative',
    paddingLeft: 26,
    paddingTop: 4,
  },
  timelineLine: {
    position: 'absolute',
    left: 9,
    top: 12,
    bottom: 8,
    width: 1,
    backgroundColor: '#E8E8E8',
  },
  emptyActivity: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: T2,
    paddingVertical: 4,
  },

  // ─── DJI auto-sync status pill (sits in the START CLASS slot) ─────────
  // Matches startClassBtn dimensions (flex 8, same padding + radius) so
  // the swap is layout-neutral. Three visual variants: neutral (in-flight),
  // success (done), error.
  syncPill: {
    flex: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    minHeight: 40,
  },
  syncPillNeutral: {
    backgroundColor: '#EAE4D7',
  },
  syncPillSuccess: {
    backgroundColor: 'rgba(45, 138, 74, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(45, 138, 74, 0.25)',
  },
  syncPillError: {
    backgroundColor: 'rgba(179, 58, 58, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(179, 58, 58, 0.22)',
  },
  syncPillText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    letterSpacing: 0.4,
    flexShrink: 1,
  },
  syncPillTextDark: { color: INK_950 },
  syncPillTextSuccess: { color: '#1F6B36' },
  syncPillTextError: { color: '#8B2A2A' },

  // ─── Phase-2 CTA buttons ─────────────────────────────────────────────
  // After folder bookmark is granted, when there's a pending upload, the
  // CTA flips: UPLOAD (white, primary) takes the spotlight on the dark
  // hero card; START CLASS demotes to a compact outlined chip next to
  // it. White-on-dark is what gives the right pop here — ink would
  // blend into the hero card background.
  uploadPrimaryBtn: {
    flex: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
  },
  uploadPrimaryText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13.5,
    color: INK_950,
    letterSpacing: 1.1,
  },
  startClassSmallBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 12,
    paddingHorizontal: 8,
    backgroundColor: GOLD_500,
    borderRadius: 10,
  },
  startClassSmallText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11.5,
    color: INK_950,
    letterSpacing: 1.0,
  },

});

const miniS = StyleSheet.create({
  wrap: {
    width: 68,
    alignItems: 'center',
  },
  avatarWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
  },
  photo: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  name: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 10,
    color: T2,
  },
  actionBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: '#E8A838',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FAFAFA',
  },
  actionBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: '#fff',
    letterSpacing: 0.1,
    lineHeight: 12,
  },
});

const actS = StyleSheet.create({
  row: {
    position: 'relative',
    paddingBottom: 16,
  },
  circle: {
    position: 'absolute',
    left: -24,
    top: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  body: { flex: 1 },
  time: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 10,
    color: T2,
    marginBottom: 3,
  },
  text: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: T1,
    lineHeight: 17,
  },
  textStrong: {
    fontFamily: Fonts.jakartaExtraBold,
  },
  textVerb: {
    fontFamily: Fonts.jakartaSemiBold,
  },
  textDim: {
    color: T3,
  },
});
