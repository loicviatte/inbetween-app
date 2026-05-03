import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { Colors, Fonts, Spacing } from '../../theme';
import DashboardSkeleton from '../../components/DashboardSkeleton';
import RecordingProcessingIndicator from '../../components/RecordingProcessingIndicator';
import { useCoachData } from '../../context/CoachDataContext';
import { getGroupClassThemeCandidates } from '../../storage/coachStorage';
import { suggestGroupClassTheme } from '../../services/ai/anthropic';
import {
  getActiveCoachClass,
  subscribeToActiveCoachClass,
} from '../../storage/activeCoachClass';

// ── Palette tuned to the "Var 1b" design ────────────────────────────────────
const HERO_BG = '#141414';
const HERO_GLOW = 'rgba(232,168,56,0.55)';
const GN = 'rgba(61,170,71,0.82)';
const OR = 'rgba(232,168,56,0.82)';
const RD = 'rgba(212,69,69,0.82)';
const GN_SOLID = '#3DAA47';
const OR_SOLID = '#E8A838';
const RD_SOLID = '#D44545';
const T1 = '#0A0A0A';
const T2 = '#8A8A8A';
const T3 = '#C8C8C8';

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

// Health score → (color, progress) for mini student rings.
// Uses the same 0-100 health metric as the student detail hero ring so the
// same number drives the ring everywhere in the app.
function ringForHealth(health) {
  const v = Math.max(0, Math.min(100, health || 0));
  const progress = v / 100;
  const color = v >= 70 ? GN_SOLID : v >= 40 ? OR_SOLID : RD_SOLID;
  return { color, progress };
}

// ── Donut (pie with hole) ───────────────────────────────────────────────────
// Three segments with gaps, rendered via stroke-dashoffset rotations
function OverviewDonut({ practiced, forgetting, silent, total }) {
  const size = 116;
  const r = 46;
  const strokeWidth = 12;
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
          <Text style={styles.donutNum}>{total}</Text>
          <Text style={styles.donutLabel}>STUDENTS</Text>
        </View>
      </View>
    </View>
  );
}

// ── Mini ring for a single student ──────────────────────────────────────────
function StudentRing({ student, actionCount = 0, onPress }) {
  const { color, progress } = ringForHealth(student.health);
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

// ── Small AVG ring inside hero bottom row ───────────────────────────────────
function AvgRing({ value }) {
  const size = 38;
  const r = 16;
  const strokeWidth = 3.5;
  const C = 2 * Math.PI * r;
  const progress = Math.max(0, Math.min(1, value / 100));
  const offset = C * (1 - progress);
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(255,255,255,0.75)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${C} ${C}`}
          strokeDashoffset={offset}
          fill="none"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={styles.avgRingLabel}>{value}</Text>
      </View>
    </View>
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

// ── Screen ──────────────────────────────────────────────────────────────────
export default function DashboardScreen({ navigation }) {
  const { students, events, actionCounts, studentActionCounts, initialLoading: loading } = useCoachData();

  // Subscribe to the running coach class so the Start Class button swaps
  // into a compact "Class in Progress" pill (same spirit as HomeScreen).
  const [activeClass, setActiveClass] = useState(getActiveCoachClass());
  const [chronoTick, setChronoTick] = useState(0);
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

  // ── Group class theme suggestion ────────────────────────────────────────
  // Computes candidates from the coach's students' active focus points since
  // the last group class (or last 30 days), then asks Claude for a unifying
  // theme. Cached per studentIds signature to avoid re-calling on every
  // render — but recomputed when the students list changes.
  const [groupTheme, setGroupTheme] = useState(null);
  const [groupThemeLoading, setGroupThemeLoading] = useState(false);
  const [groupThemeStudents, setGroupThemeStudents] = useState([]);
  const lastSignatureRef = useRef(null);

  useEffect(() => {
    if (!students || students.length === 0) {
      setGroupTheme(null);
      setGroupThemeStudents([]);
      return;
    }
    const signature = students.map((s) => s.id).sort().join('|');
    if (signature === lastSignatureRef.current) return;
    lastSignatureRef.current = signature;

    let alive = true;
    async function run() {
      setGroupThemeLoading(true);
      try {
        const { candidates } = await getGroupClassThemeCandidates(
          students.map((s) => s.id),
        );
        if (!alive) return;
        if (!candidates || candidates.length === 0) {
          setGroupTheme(null);
          setGroupThemeStudents([]);
          return;
        }
        // Students sharing the #1 candidate — used for the avatar stack.
        const topIds = new Set(candidates[0].studentIds);
        const matched = students.filter((s) => topIds.has(s.id));
        const suggestion = await suggestGroupClassTheme(
          candidates.map((c) => ({ name: c.name, count: c.count })),
        );
        if (!alive) return;
        setGroupTheme(
          suggestion || {
            theme: candidates[0].name,
            subtitle: `${candidates[0].count} student${candidates[0].count > 1 ? 's' : ''} working on it`,
          },
        );
        setGroupThemeStudents(matched);
      } catch {
        if (!alive) return;
        setGroupTheme(null);
        setGroupThemeStudents([]);
      } finally {
        if (alive) setGroupThemeLoading(false);
      }
    }
    run();
    return () => {
      alive = false;
    };
  }, [students]);

  const stats = useMemo(() => {
    const practiced = students.filter((s) => s.status === 'on_track').length;
    const inProgress = students.filter((s) => s.status === 'attention').length;
    const silent = students.filter((s) => s.status === 'silent').length;
    const total = students.length;
    // Average of the per-student Global score (same 0-100 metric shown on
    // the student detail hero). Falls back to 0 when there are no students.
    const globalAvg = total > 0
      ? Math.round(
          students.reduce((sum, s) => sum + (s.global || s.health || 0), 0) / total
        )
      : 0;
    const actions = inProgress + silent;
    return { practiced, inProgress, silent, total, globalAvg, actions };
  }, [students]);

  if (loading) return <DashboardSkeleton />;

  return (
    <View style={styles.safe}>
      <View style={styles.fixed}>
        {/* ── Students horizontal scroll ── */}
        <Text style={styles.sectionLabel}>STUDENTS</Text>
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
          <View style={styles.weekBadge}>
            <Text style={styles.weekBadgeText}>SINCE LAST CLASS</Text>
          </View>
          <View style={styles.heroTop}>
            <OverviewDonut
              practiced={stats.practiced}
              forgetting={stats.inProgress}
              silent={stats.silent}
              total={stats.total}
            />
            <View style={styles.heroLegend}>
              <LegendRow color={GN_SOLID} num={stats.practiced} label="Practiced" />
              <LegendRow color={OR_SOLID} num={stats.inProgress} label="In progress" />
              <LegendRow color={RD_SOLID} num={stats.silent} label="Silent" />
            </View>
          </View>

          <TouchableOpacity
            style={styles.retentionBar}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('STUDENTS')}
          >
            <View style={styles.retentionHeader}>
              <Text style={styles.retentionLabel}>GLOBAL AVG</Text>
              <Text style={styles.retentionPct}>{stats.globalAvg}%</Text>
            </View>
            <View style={styles.retentionTrack}>
              <View
                style={[
                  styles.retentionFill,
                  { width: `${Math.max(2, Math.min(100, stats.globalAvg))}%` },
                ]}
              />
            </View>
          </TouchableOpacity>

          <View style={styles.heroDivider} />

          <View style={styles.heroMetrics}>
            {activeClass ? (
              <TouchableOpacity
                style={styles.inProgressBtn}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('StartClass')}
              >
                <View style={styles.inProgressLeft}>
                  <View style={styles.inProgressDot} />
                  <Text style={styles.inProgressLabel}>Class in progress</Text>
                </View>
                <View style={styles.inProgressRight}>
                  <Text style={styles.inProgressTimer}>{chronoLabel}</Text>
                  <Text style={styles.inProgressArrow}>›</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.startClassBtn}
                activeOpacity={0.88}
                onPress={() => navigation.navigate('StartClass')}
              >
                <Ionicons name="play" size={14} color="#fff" />
                <Text style={styles.startClassText}>Start Class</Text>
              </TouchableOpacity>
            )}

            {actionCounts?.total > 0 && (
              <TouchableOpacity
                style={[
                  styles.actionsBtn,
                  { backgroundColor: actionCounts.focus > 0 ? RD_SOLID : OR_SOLID },
                ]}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('ActionNeeded')}
              >
                <Text style={styles.actionsBtnNum}>{actionCounts.total}</Text>
                <Ionicons name="alert" size={14} color="#fff" />
              </TouchableOpacity>
            )}
            <RecordingProcessingIndicator />
          </View>
        </View>

        {/* ── Next group class focus ── */}
        <Text style={styles.sectionLabelLow}>NEXT GROUP CLASS — FOCUS ON</Text>
        <View style={styles.focusCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.focusTitle}>
              {groupThemeLoading
                ? 'Analyzing focus points…'
                : groupTheme?.theme || 'No shared focus yet'}
            </Text>
            <Text style={styles.focusSub}>
              {groupThemeLoading
                ? 'Looking at what your students have been working on'
                : groupTheme?.subtitle ||
                  (students.length > 0 ? 'Not enough recent activity to suggest a theme' : '')}
            </Text>
          </View>
          <View style={styles.focusAvatars}>
            {(groupThemeStudents.length > 0 ? groupThemeStudents : students)
              .slice(0, 4)
              .map((s, idx) => (
                <View
                  key={s.id}
                  style={[
                    styles.focusAvatar,
                    { marginLeft: idx === 0 ? 0 : -8, zIndex: 4 - idx },
                  ]}
                >
                  {(s.photoUrl || s.photo_url) ? (
                    <Image source={{ uri: s.photoUrl || s.photo_url }} style={styles.focusAvatarImg} />
                  ) : (
                    <Text style={styles.focusAvatarText}>{initials(s.name)}</Text>
                  )}
                </View>
              ))}
          </View>
        </View>

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
    </View>
  );
}

function LegendRow({ color, num, label }) {
  return (
    <View style={styles.legendRow}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendNum}>{num}</Text>
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
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

  // Hero card
  hero: {
    marginHorizontal: Spacing.side,
    backgroundColor: HERO_BG,
    borderRadius: 22,
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 16,
    borderWidth: 2.5,
    borderColor: HERO_GLOW,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  heroLegend: {
    flex: 1,
    gap: 8,
  },
  weekBadge: {
    position: 'absolute',
    top: 14,
    right: 16,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(232,168,56,0.14)',
    zIndex: 2,
  },
  weekBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9,
    letterSpacing: 0.8,
    color: OR_SOLID,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 3,
  },
  legendNum: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
    color: '#fff',
    width: 16,
  },
  legendLabel: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
  },
  donutCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutNum: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 30,
    color: '#fff',
    letterSpacing: -1,
    lineHeight: 32,
  },
  donutLabel: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 1.2,
    marginTop: 4,
  },

  heroDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.10)',
    marginTop: 16,
    marginBottom: 14,
  },
  heroMetrics: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  metricTile: {
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  actionsTile: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
  },
  inProgressBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  inProgressLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inProgressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#D44545',
  },
  inProgressLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#fff',
    letterSpacing: 0.2,
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
  startClassBtn: {
    flex: 8,
    backgroundColor: OR_SOLID,
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionsBtn: {
    flex: 2,
    borderRadius: 14,
    paddingVertical: 14,
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
  },
  startClassText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#fff',
    letterSpacing: 0.2,
  },
  retentionBar: {
    marginTop: 16,
  },
  retentionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 6,
  },
  retentionLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    letterSpacing: 1.1,
    color: 'rgba(255,255,255,0.55)',
  },
  retentionPct: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: '#fff',
    letterSpacing: -0.3,
  },
  retentionTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  retentionFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: OR_SOLID,
  },
  metricBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricBadgeNum: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
  },
  metricTileLabel: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.50)',
    letterSpacing: 0.3,
  },
  avgRingLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: '#fff',
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
