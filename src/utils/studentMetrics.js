// ─── Student metrics: Retention / Motivation / Health ───────────────────────
//
// Three coach-facing scores returned on the 0-100 scale.
//
//  • Retention — how many focus points the student has actually retired
//      (past × tier_weight) / (total × tier_weight) × 100
//      +10% bonus per past focus retired in < 3 practice sessions
//
//  • Motivation — average session_motivation over the last 14 days,
//      normalised to 0-100. 1 = Démotivé, 2 = Neutre, 3 = Motivé.
//
//  • Health — arithmetic mean of three sub-scores:
//      Retention, Motivation_normalised, Regularity
//      Regularity = sessions this week / avg sessions per week historically × 100
//
// All functions return 0 when the underlying data is missing rather than null
// so UI gauges always have a number to render.

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

// ─── Retention ──────────────────────────────────────────────────────────────
export async function getRetentionScore(studentId) {
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
  for (const f of list) {
    const w = weightFor(f.tier);
    totalWeight += w;
    if (f.status === 'past') {
      pastWeight += w;
      pastIds.push(f.id);
    }
  }
  if (totalWeight === 0) return 0;

  let score = (pastWeight / totalWeight) * 100;

  // Bonus: +10% per past focus that was retired in fewer than 3 sessions
  if (pastIds.length > 0) {
    const { data: logs } = await supabase
      .from('practice_logs')
      .select('focus_point_id')
      .eq('student_id', studentId)
      .in('focus_point_id', pastIds);

    const counts = {};
    for (const l of logs || []) {
      counts[l.focus_point_id] = (counts[l.focus_point_id] || 0) + 1;
    }
    let bonus = 0;
    for (const id of pastIds) {
      if ((counts[id] || 0) < 3) bonus += 10;
    }
    score += bonus;
  }

  return clamp100(score);
}

// ─── Motivation ─────────────────────────────────────────────────────────────
export async function getMotivationScore(studentId) {
  if (!studentId) return 0;

  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data: logs } = await supabase
    .from('practice_logs')
    .select('session_motivation, started_at, created_at')
    .eq('student_id', studentId)
    .gte('started_at', fourteenDaysAgo)
    .not('session_motivation', 'is', null);

  const values = (logs || [])
    .map((l) => l.session_motivation)
    .filter((v) => v === 1 || v === 2 || v === 3);
  if (values.length === 0) return 0;

  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  // Normalise 1..3 → 0..100: (avg - 1) / 2 × 100
  return clamp100(((avg - 1) / 2) * 100);
}

// ─── Health ─────────────────────────────────────────────────────────────────
//
// Regularity: sessions this week / weekly historical average × 100
// "Historical average" = total completed sessions / (age in weeks, min 1)
// Student age is derived from the earliest practice_log date; if none,
// Regularity is 0.
export async function getHealthScore(studentId) {
  if (!studentId) return 0;

  // Parallel: retention, motivation, and the data needed for regularity
  const [retention, motivation, logsRes] = await Promise.all([
    getRetentionScore(studentId),
    getMotivationScore(studentId),
    supabase
      .from('practice_logs')
      .select('started_at, completed_at')
      .eq('student_id', studentId)
      .not('completed_at', 'is', null)
      .order('started_at', { ascending: true }),
  ]);

  const logs = logsRes?.data || [];
  let regularity = 0;
  if (logs.length > 0) {
    const nowMs = Date.now();
    const weekAgoMs = nowMs - 7 * 86400000;
    const sessionsThisWeek = logs.filter(
      (l) => new Date(l.started_at).getTime() >= weekAgoMs
    ).length;

    const firstMs = new Date(logs[0].started_at).getTime();
    const ageWeeks = Math.max(1, (nowMs - firstMs) / (7 * 86400000));
    const weeklyAvg = logs.length / ageWeeks;
    if (weeklyAvg > 0) {
      regularity = clamp100((sessionsThisWeek / weeklyAvg) * 100);
    }
  }

  const health = (retention + motivation + regularity) / 3;
  return clamp100(health);
}

// Convenience: compute all three in a single pass (one DB round-trip per
// source table) — use this from the UI to avoid duplicate queries.
export async function getAllStudentMetrics(studentId) {
  if (!studentId) return { retention: 0, motivation: 0, health: 0 };

  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

  const [focusesRes, allLogsRes] = await Promise.all([
    supabase
      .from('focus_points')
      .select('id, status, tier')
      .eq('user_id', studentId)
      .eq('is_deleted', false)
      .eq('is_other', false),
    supabase
      .from('practice_logs')
      .select('id, focus_point_id, started_at, completed_at, session_motivation')
      .eq('student_id', studentId)
      .order('started_at', { ascending: true }),
  ]);

  const focuses = focusesRes?.data || [];
  const logs = (allLogsRes?.data || []).filter((l) => !!l.completed_at);

  // ── Retention ────────────────────────────────────────────────────────
  let retention = 0;
  if (focuses.length > 0) {
    let totalWeight = 0;
    let pastWeight = 0;
    const pastIds = [];
    for (const f of focuses) {
      const w = weightFor(f.tier);
      totalWeight += w;
      if (f.status === 'past') {
        pastWeight += w;
        pastIds.push(f.id);
      }
    }
    if (totalWeight > 0) {
      retention = (pastWeight / totalWeight) * 100;
      if (pastIds.length > 0) {
        const counts = {};
        for (const l of logs) {
          if (l.focus_point_id) counts[l.focus_point_id] = (counts[l.focus_point_id] || 0) + 1;
        }
        let bonus = 0;
        for (const id of pastIds) {
          if ((counts[id] || 0) < 3) bonus += 10;
        }
        retention += bonus;
      }
    }
  }
  retention = clamp100(retention);

  // ── Motivation ───────────────────────────────────────────────────────
  const recentValues = logs
    .filter((l) => l.started_at >= fourteenDaysAgo && (l.session_motivation === 1 || l.session_motivation === 2 || l.session_motivation === 3))
    .map((l) => l.session_motivation);
  let motivation = 0;
  if (recentValues.length > 0) {
    const avg = recentValues.reduce((a, b) => a + b, 0) / recentValues.length;
    motivation = clamp100(((avg - 1) / 2) * 100);
  }

  // ── Regularity → Health ──────────────────────────────────────────────
  let regularity = 0;
  if (logs.length > 0) {
    const nowMs = Date.now();
    const weekAgoMs = nowMs - 7 * 86400000;
    const sessionsThisWeek = logs.filter(
      (l) => new Date(l.started_at).getTime() >= weekAgoMs
    ).length;
    const firstMs = new Date(logs[0].started_at).getTime();
    const ageWeeks = Math.max(1, (nowMs - firstMs) / (7 * 86400000));
    const weeklyAvg = logs.length / ageWeeks;
    if (weeklyAvg > 0) {
      regularity = clamp100((sessionsThisWeek / weeklyAvg) * 100);
    }
  }

  const health = clamp100((retention + motivation + regularity) / 3);
  return { retention, motivation, health };
}
