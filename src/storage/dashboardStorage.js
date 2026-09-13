// ─── Student Profile dashboard ───────────────────────────────────────────────
// Everything the Profile landing screen shows, in three round-trips:
//   1. practice_logs (+ the embedded focus point, for its dance tags)
//   2. get_lesson_readiness  — the one number the student can still act on
//   3. class_inputs          — the lesson history
//
// Weekly minutes, the 10-week trend, the week streak, the momentum score and
// the dance breakdown are all derived from the SAME practice_logs rows, so they
// can never disagree with each other. Anything derived here is a pure function
// of that array; nothing re-queries.
import { supabase } from '../services/supabase/client';
import { getUserId, getLessonReadiness } from './storage';
import { focusMatchesCategory } from '../utils/danceCategory';

const WEEKS_BACK = 26;           // enough history for a 10-week trend + streak
const TREND_WEEKS = 10;

// ─── Dance names ─────────────────────────────────────────────────────────────
// focus_points.dance is free text and prod holds three spellings of one dance
// ("Cha-cha", "Cha cha", "Cha Cha"). Folding at read time keeps the UI honest
// without a migration; the underlying rows stay as they are.
const DANCE_ALIASES = {
  'cha cha': 'Cha Cha', 'cha cha cha': 'Cha Cha', 'chacha': 'Cha Cha',
  'paso doble': 'Paso Doble', 'pasodoble': 'Paso Doble', 'paso': 'Paso Doble',
  'viennese waltz': 'Viennese Waltz', 'v waltz': 'Viennese Waltz',
  'slow foxtrot': 'Foxtrot', 'foxtrot': 'Foxtrot', 'slow fox': 'Foxtrot',
  'quickstep': 'Quickstep', 'quick step': 'Quickstep',
  rumba: 'Rumba', samba: 'Samba', jive: 'Jive', waltz: 'Waltz', tango: 'Tango',
};

export function normaliseDance(raw) {
  if (!raw) return null;
  // "Cha-cha" and "Cha  cha" both collapse to the key "cha cha"
  const key = String(raw).trim().toLowerCase().replace(/[\s\-_]+/g, ' ');
  return DANCE_ALIASES[key] || String(raw).trim();
}

// ─── Calendar helpers (ISO weeks, Monday start, local time) ──────────────────
function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const weekKey = (d) => startOfWeek(d).toISOString().slice(0, 10);
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

// ─── Momentum (v2.2) ─────────────────────────────────────────────────────────
// Acute:chronic load on *binary active days* — training five times in one day
// moves it exactly as much as training once, so it cannot be farmed.
//   acute   EWMA, 10-day half-life   "what you are doing now"
//   chronic EWMA, 42-day half-life   "what you normally do"
// Both start at the cohort's median daily rate so a new student is not scored
// against zero, and the ratio carries additive smoothing so a single session
// after a long gap cannot divide by almost-nothing and read as Peaking.
const HALF_LIFE_ACUTE = 10;
const HALF_LIFE_CHRONIC = 42;
const COHORT_PRIOR = 0.111;      // ~0.8 active days/week, the cohort median
const SMOOTHING = COHORT_PRIOR;
const SUFFICIENCY = 1 / 7;       // one day a week = enough to be judged on ratio alone

export function momentumBand(score) {
  if (score >= 80) return 'Peaking';
  if (score >= 65) return 'Building';
  if (score >= 45) return 'Steady';
  if (score >= 25) return 'Cooling';
  return 'Dormant';
}

// activeDays: Set of dayKey(). Returns { score, band, acutePerWeek, chronicPerWeek, ratio }.
function computeMomentum(activeDays, firstDate, today) {
  if (!firstDate) return { score: null, band: null, acutePerWeek: 0, chronicPerWeek: 0, ratio: null };
  const aA = 1 - Math.pow(0.5, 1 / HALF_LIFE_ACUTE);
  const aC = 1 - Math.pow(0.5, 1 / HALF_LIFE_CHRONIC);
  let acute = COHORT_PRIOR;
  let chronic = COHORT_PRIOR;

  const cursor = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate() - 1);
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // Guard against a pathological range walking forever.
  for (let i = 0; cursor <= end && i < 2000; i += 1) {
    const load = activeDays.has(dayKey(cursor)) ? 1 : 0;
    acute += aA * (load - acute);
    chronic += aC * (load - chronic);
    cursor.setDate(cursor.getDate() + 1);
  }

  const ratio = (acute + SMOOTHING) / (chronic + SMOOTHING);
  const raw = Math.max(0, Math.min(100, 55 + 30 * Math.log2(ratio)));
  // Taper rather than clip: below one active day a week the ratio alone would
  // let a dormant student drift back toward "Steady" as acute and chronic
  // converge on zero together.
  const sufficiency = acute > 0 ? Math.min(1, Math.sqrt(acute / SUFFICIENCY)) : 0;
  const score = Math.round(raw * sufficiency);
  return {
    score,
    band: momentumBand(score),
    acutePerWeek: +(acute * 7).toFixed(1),
    chronicPerWeek: +(chronic * 7).toFixed(1),
    ratio: +ratio.toFixed(2),
  };
}

// ─── The bundle ──────────────────────────────────────────────────────────────
export async function getStudentDashboard(category = null) {
  const userId = await getUserId();
  const today = new Date();
  const since = new Date(today.getFullYear(), today.getMonth(), today.getDate() - WEEKS_BACK * 7);

  const [logsRes, readiness, lessonsRes, prefsRes] = await Promise.all([
    supabase
      .from('practice_logs')
      .select('started_at, duration_minutes, focus_point_id, focus_points(name, dance, tier)')
      .eq('student_id', userId)
      .not('completed_at', 'is', null)
      .gte('started_at', since.toISOString())
      .order('started_at', { ascending: false }),
    getLessonReadiness(null, category).catch(() => null),
    supabase
      .from('class_inputs')
      .select('id, created_at, title, dance')
      .eq('student_id', userId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('users').select('weekly_goal_minutes').eq('id', userId).single(),
  ]);

  const weeklyGoal = prefsRes?.data?.weekly_goal_minutes ?? 60;

  const logs = (logsRes?.data || []).filter((l) => {
    if (!category) return true;
    // Keep untagged practice; only drop rows that clearly belong to the other style.
    const dances = l.focus_points?.dance;
    return !dances?.length || focusMatchesCategory({ dance: dances }, category);
  });
  const lessons = lessonsRes?.data || [];

  // ── minutes per week, and the trend ──
  const minutesByWeek = new Map();
  const sessionsByWeek = new Map();
  const insideWeek = new Map();      // week -> { dayMinutes[7], focus: Map }
  const activeDays = new Set();
  const danceCounts = new Map();
  let firstDate = null;

  for (const l of logs) {
    const d = new Date(l.started_at);
    if (Number.isNaN(d.getTime())) continue;
    if (!firstDate || d < firstDate) firstDate = d;
    activeDays.add(dayKey(d));
    const k = weekKey(d);
    minutesByWeek.set(k, (minutesByWeek.get(k) || 0) + (l.duration_minutes || 0));
    sessionsByWeek.set(k, (sessionsByWeek.get(k) || 0) + 1);
    // what the week was actually made of: which days, which focus points
    if (!insideWeek.has(k)) insideWeek.set(k, { dayMinutes: [0, 0, 0, 0, 0, 0, 0], focus: new Map() });
    const inside = insideWeek.get(k);
    inside.dayMinutes[(d.getDay() + 6) % 7] += l.duration_minutes || 0;
    if (l.focus_point_id) {
      const f = inside.focus.get(l.focus_point_id)
        || { id: l.focus_point_id, name: l.focus_points?.name || 'Focus point', sessions: 0, minutes: 0 };
      f.sessions += 1;
      f.minutes += l.duration_minutes || 0;
      inside.focus.set(l.focus_point_id, f);
    }
    // A focus point can carry several dances; each one counts the session once.
    const seen = new Set();
    for (const raw of l.focus_points?.dance || []) {
      const name = normaliseDance(raw);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      danceCounts.set(name, (danceCounts.get(name) || 0) + 1);
    }
  }

  const totalMinutes = logs.reduce((a, l) => a + (l.duration_minutes || 0), 0);
  const thisWeek = startOfWeek(today);
  const nowKey = weekKey(today);
  const todayIndex = (today.getDay() + 6) % 7;

  const lessonsByWeek = new Map();
  for (const l of lessons) {
    const d = new Date(l.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const k = weekKey(d);
    if (!lessonsByWeek.has(k)) lessonsByWeek.set(k, []);
    lessonsByWeek.get(k).push({ id: l.id, title: l.title, dance: l.dance, date: l.created_at });
  }

  const trend = [];
  for (let i = TREND_WEEKS - 1; i >= 0; i -= 1) {
    const w = new Date(thisWeek.getFullYear(), thisWeek.getMonth(), thisWeek.getDate() - i * 7);
    const k = weekKey(w);
    const inside = insideWeek.get(k);
    trend.push({
      week: k,
      minutes: minutesByWeek.get(k) || 0,
      sessions: sessionsByWeek.get(k) || 0,
      focusPoints: inside?.focus.size || 0,
      metGoal: (minutesByWeek.get(k) || 0) >= weeklyGoal,
      // the breakdown the detail view opens on
      dayMinutes: inside?.dayMinutes || [0, 0, 0, 0, 0, 0, 0],
      dayIndex: k === nowKey ? todayIndex : 6,       // a past week is fully played out
      isCurrent: k === nowKey,
      focusDone: inside ? [...inside.focus.values()].sort((a, b) => b.minutes - a.minutes) : [],
      lessons: lessonsByWeek.get(k) || [],
    });
  }
  const weekMinutes = trend[trend.length - 1].minutes;
  const trained = trend.filter((t) => t.minutes > 0);

  // ── week streak: consecutive weeks with any training, ending this week or last ──
  // The current week is still open, so an untrained Monday must not break a run.
  let streakWeeks = 0;
  for (let i = 0; i < WEEKS_BACK; i += 1) {
    const w = new Date(thisWeek.getFullYear(), thisWeek.getMonth(), thisWeek.getDate() - i * 7);
    const had = (minutesByWeek.get(weekKey(w)) || 0) > 0;
    if (had) streakWeeks += 1;
    else if (i > 0) break;      // i === 0 is the open week: skip it, don't break
  }

  const dances = [...danceCounts.entries()]
    .map(([name, sessions]) => ({ name, sessions }))
    .sort((a, b) => b.sessions - a.sessions);
  const totalDanceSessions = dances.reduce((a, d) => a + d.sessions, 0);

  return {
    readiness,                                   // { percent, focuses[], minutesRemaining, lastClassDate } | null
    weekMinutes,
    trend,                                       // oldest → newest, each week carrying its own breakdown
    momentum: computeMomentum(activeDays, firstDate, today),
    streakWeeks,
    weeksTrained: trained.length,
    trendWeeks: TREND_WEEKS,
    dances,                                      // [{ name, sessions }] desc
    totalDanceSessions,
    sessionCount: logs.length,
    lessonCount: lessons.length,
    weeklyGoal,
    weeksAtGoal: trend.filter((t) => t.metGoal).length,
    totalMinutes,
    lessons: lessons.slice(0, 40).map((l) => ({ id: l.id, date: l.created_at, title: l.title, dance: l.dance })),
    lastLesson: lessons[0]
      ? { id: lessons[0].id, title: lessons[0].title, date: lessons[0].created_at, dance: lessons[0].dance }
      : null,
    hasAnyData: logs.length > 0 || lessons.length > 0,
  };
}
