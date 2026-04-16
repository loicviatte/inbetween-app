// ─── Student metrics: Progression / Retention / Global ─────────────────────
//
// Three coach-facing scores returned on the 0-100 scale — for all three,
// higher is better (100 = good, 0 = bad), so the UI can use uniform colour
// thresholds: green > 70, orange 40-70, red < 40.
//
//  • Progression — how many focus points the student has actually retired
//      (past × tier_weight) / (total × tier_weight) × 100
//      +10% bonus per past focus retired in < 3 practice sessions
//
//  • Retention — how well the student sticks with a focus point instead of
//      being flagged by the AI as repeating the same theme again.
//      100 − (focus points with merge_action='auto_merge' / total × 100)
//      100% when the student has no focus points yet (neutral good).
//
//  • Global — arithmetic mean of three sub-scores (all 0-100, higher = better):
//      Progression, Retention, Regularity
//      Regularity = sessions this week / avg sessions per week historically × 100
//
// All functions return 0 when the underlying data is missing rather than null
// so UI gauges always have a number to render (except Retention's "no data"
// case, which returns 100 so it reads as neutral-good).

import { supabase } from '../services/supabase/client';

const TIER_WEIGHT = {
  critical: 3,
  important: 2,
  supporting: 1,
};

function weightFor(tier) {
  return TIER_WEIGHT[tier] ?? TIER_WEIGHT.important;
}

function clamp100(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// Midnight at the start of the current Sunday-based calendar week.
function startOfWeekMs(nowMs = Date.now()) {
  const d = new Date(nowMs);
  d.setDate(d.getDate() - d.getDay()); // Sunday
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Regularity = sessions this calendar week / weekly historical average × 100
// `logs` must be sorted ascending by created_at.
function regularityFromLogs(logs, nowMs = Date.now()) {
  if (!logs || logs.length === 0) return 0;
  const weekStartMs = startOfWeekMs(nowMs);
  const sessionsThisWeek = logs.filter(
    (l) => new Date(l.created_at).getTime() >= weekStartMs
  ).length;
  const firstMs = new Date(logs[0].created_at).getTime();
  const ageWeeks = Math.max(1, (nowMs - firstMs) / (7 * 86400000));
  const weeklyAvg = logs.length / ageWeeks;
  if (weeklyAvg <= 0) return 0;
  return clamp100((sessionsThisWeek / weeklyAvg) * 100);
}

// ─── Progression ────────────────────────────────────────────────────────────
// (past × tier_weight) / (total × tier_weight) × 100
// Bonus: past focus retired in < 3 practice_logs contributes weight × 1.1
// instead of weight (i.e. +10% on that focus' tier weight).
export async function getProgressionScore(studentId) {
  if (!studentId) return 0;

  const { data: focuses } = await supabase
    .from('focus_points')
    .select('id, status, tier')
    .eq('user_id', studentId)
    .eq('is_deleted', false)
    .eq('is_other', false);

  const list = (focuses || []).filter((f) => !!f);
  if (list.length === 0) return 0;

  // Tier-weighted past / total
  let totalWeight = 0;
  let pastWeight = 0;
  const pastIds = [];
  const pastWeightById = {};
  for (const f of list) {
    const w = weightFor(f.tier);
    totalWeight += w;
    if (f.status === 'past') {
      pastIds.push(f.id);
      pastWeightById[f.id] = w;
    }
  }
  if (totalWeight === 0) return 0;

  // Count practice logs per past focus to apply the speed bonus
  let logCounts = {};
  if (pastIds.length > 0) {
    const { data: logs } = await supabase
      .from('practice_logs')
      .select('focus_point_id')
      .eq('student_id', studentId)
      .in('focus_point_id', pastIds);
    for (const l of logs || []) {
      logCounts[l.focus_point_id] = (logCounts[l.focus_point_id] || 0) + 1;
    }
  }

  for (const id of pastIds) {
    const w = pastWeightById[id];
    const fast = (logCounts[id] || 0) < 3;
    pastWeight += fast ? w * 1.1 : w;
  }

  return clamp100((pastWeight / totalWeight) * 100);
}

// ─── Retention ──────────────────────────────────────────────────────────────
// Inverse of the auto-merge rate: share of focus points the AI did NOT flag
// as duplicates of existing themes. Higher means the student isn't repeating.
// No focus points yet → 100 (neutral good default, same as "nothing to repeat").
export async function getRetentionScore(studentId) {
  if (!studentId) return 100;

  const { data } = await supabase
    .from('focus_points')
    .select('id, merge_action')
    .eq('user_id', studentId)
    .eq('is_deleted', false)
    .eq('is_other', false);

  const list = data || [];
  const total = list.length;
  if (total === 0) return 100;

  const repeated = list.filter((fp) => fp.merge_action === 'auto_merge').length;
  return clamp100(100 - (repeated / total) * 100);
}

// ─── Global ─────────────────────────────────────────────────────────────────
//
// Regularity: sessions this week / weekly historical average × 100
// "Historical average" = total completed sessions / (age in weeks, min 1)
// Student age is derived from the earliest practice_log date; if none,
// Regularity is 0.
export async function getGlobalScore(studentId) {
  if (!studentId) return 0;

  const [progression, retention, logsRes] = await Promise.all([
    getProgressionScore(studentId),
    getRetentionScore(studentId),
    supabase
      .from('practice_logs')
      .select('created_at')
      .eq('student_id', studentId)
      .order('created_at', { ascending: true }),
  ]);

  const regularity = regularityFromLogs(logsRes?.data || []);
  return clamp100((progression + retention + regularity) / 3);
}

// Back-compat alias — some legacy callers may still import getHealthScore.
export const getHealthScore = getGlobalScore;

// Convenience: compute all three in a single pass (one DB round-trip per
// source table) — use this from the UI to avoid duplicate queries.
export async function getAllStudentMetrics(studentId) {
  if (!studentId) return { progression: 0, retention: 100, global: 0 };

  const [focusesRes, allLogsRes] = await Promise.all([
    supabase
      .from('focus_points')
      .select('id, status, tier, merge_action')
      .eq('user_id', studentId)
      .eq('is_deleted', false)
      .eq('is_other', false),
    supabase
      .from('practice_logs')
      .select('id, focus_point_id, created_at')
      .eq('student_id', studentId)
      .order('created_at', { ascending: true }),
  ]);

  const focuses = focusesRes?.data || [];
  const logs = allLogsRes?.data || [];

  // ── Progression ──────────────────────────────────────────────────────
  let progression = 0;
  if (focuses.length > 0) {
    let totalWeight = 0;
    let pastWeight = 0;
    const pastIds = [];
    const pastWeightById = {};
    for (const f of focuses) {
      const w = weightFor(f.tier);
      totalWeight += w;
      if (f.status === 'past') {
        pastIds.push(f.id);
        pastWeightById[f.id] = w;
      }
    }
    if (totalWeight > 0) {
      const counts = {};
      for (const l of logs) {
        if (l.focus_point_id) counts[l.focus_point_id] = (counts[l.focus_point_id] || 0) + 1;
      }
      for (const id of pastIds) {
        const w = pastWeightById[id];
        const fast = (counts[id] || 0) < 3;
        pastWeight += fast ? w * 1.1 : w;
      }
      progression = (pastWeight / totalWeight) * 100;
    }
  }
  progression = clamp100(progression);

  // ── Retention ────────────────────────────────────────────────────────
  let retention = 100;
  if (focuses.length > 0) {
    const repeated = focuses.filter((f) => f.merge_action === 'auto_merge').length;
    retention = clamp100(100 - (repeated / focuses.length) * 100);
  }

  // ── Regularity → Global ──────────────────────────────────────────────
  const regularity = regularityFromLogs(logs);
  const global = clamp100((progression + retention + regularity) / 3);
  return { progression, retention, global };
}

// ─── Batched metrics (no DB calls) ─────────────────────────────────────────
//
// Pre-fetched data is passed in so we avoid the N+1 per-student queries.
//   allFocuses: [{ id, user_id, status, tier, is_other, merge_action }]
//   allLogs:    [{ student_id, focus_point_id, created_at }]
//
// Returns { [studentId]: { progression, retention, global } }
export function computeAllStudentMetricsBatch(studentIds, allFocuses, allLogs) {
  const nowMs = Date.now();

  // Group focuses and logs by student
  const focusesByStudent = {};
  const logsByStudent = {};
  for (const id of studentIds) {
    focusesByStudent[id] = [];
    logsByStudent[id] = [];
  }
  for (const f of allFocuses || []) {
    if (focusesByStudent[f.user_id]) focusesByStudent[f.user_id].push(f);
  }
  for (const l of allLogs || []) {
    if (logsByStudent[l.student_id]) logsByStudent[l.student_id].push(l);
  }

  const result = {};
  for (const id of studentIds) {
    const focuses = focusesByStudent[id];
    const logs = logsByStudent[id];

    // ── Progression ──
    let progression = 0;
    if (focuses.length > 0) {
      let totalWeight = 0;
      let pastWeight = 0;
      const pastIds = [];
      const pastWeightById = {};
      for (const f of focuses) {
        const w = weightFor(f.tier);
        totalWeight += w;
        if (f.status === 'past') {
          pastIds.push(f.id);
          pastWeightById[f.id] = w;
        }
      }
      if (totalWeight > 0) {
        const counts = {};
        for (const l of logs) {
          if (l.focus_point_id) counts[l.focus_point_id] = (counts[l.focus_point_id] || 0) + 1;
        }
        for (const fpId of pastIds) {
          const w = pastWeightById[fpId];
          const fast = (counts[fpId] || 0) < 3;
          pastWeight += fast ? w * 1.1 : w;
        }
        progression = (pastWeight / totalWeight) * 100;
      }
    }
    progression = clamp100(progression);

    // ── Retention ──
    let retention = 100;
    if (focuses.length > 0) {
      const repeated = focuses.filter((f) => f.merge_action === 'auto_merge').length;
      retention = clamp100(100 - (repeated / focuses.length) * 100);
    }

    // ── Regularity → Global ──
    // Sort ascending by created_at for the "weeks since first log" math.
    logs.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const regularity = regularityFromLogs(logs, nowMs);

    const global = clamp100((progression + retention + regularity) / 3);
    result[id] = { progression, retention, global };
  }

  return result;
}
