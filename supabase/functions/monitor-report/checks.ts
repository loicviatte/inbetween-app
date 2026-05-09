// Deterministic backend checks — run in code (not via LLM) so anomaly
// detection is reliable and reproducible. The LLM reasons on top of this
// pre-qualified list and adds contextual patterns it spots on its own.
//
// Schema notes:
//   - class_inputs.status values observed in prod: 'pending' | 'extracted'
//     | 'scored'. "Processed" = 'extracted' OR 'scored' (raw_ai_json set).
//   - focus_points.status values observed: 'active' | 'past'. There is no
//     'past_candidate' yet — that check is a no-op until/unless the state
//     machine introduces it.
//   - Scores live on roughly a [0, 20] scale (observed max ~17). We flag
//     critical only for outright impossible values (<0 or >100), and warn
//     for soft out-of-range (>20).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isExcludedUser } from './snapshot.ts'

export type Severity = 'critical' | 'warning' | 'info'

export interface DetectedAnomaly {
  kind: string               // stable key, used to dedupe across runs
  severity: Severity
  description: string
  affected: string
  row_table?: string
  row_id?: string
  first_detected: string     // YYYY-MM-DD
}

interface Ctx {
  sb: SupabaseClient
  periodStart: string
  periodEnd: string
  today: string
}

const SCORE_HARD_MAX = 100   // physically impossible above this
const SCORE_HARD_MIN = 0     // negative = bug
const SCORE_SOFT_MAX = 20    // soft warning ceiling for the current algorithm

// ── 1. Yoda Extract timeouts, scoped to the reporting period ────────────────
// A class_input is "late" if it was submitted during the period and either:
//   - is still not processed after >10 min, OR
//   - was processed >10 min after submission.
async function checkExtractTimeouts(ctx: Ctx): Promise<DetectedAnomaly[]> {
  const { data } = await ctx.sb
    .from('class_inputs')
    .select('id, user_id, created_at, processed_at, status, raw_ai_json')
    .gte('created_at', ctx.periodStart)
    .lte('created_at', ctx.periodEnd)
    .or('is_deleted.is.null,is_deleted.eq.false')
  if (!data) return []

  const out: DetectedAnomaly[] = []
  const tenMinMs = 10 * 60 * 1000
  const nowMs = Date.now()
  for (const row of data) {
    if (isExcludedUser(row.user_id)) continue
    const submittedMs = new Date(row.created_at).getTime()
    const isProcessed =
      (row.status === 'extracted' || row.status === 'scored') && !!row.raw_ai_json
    const processedMs = row.processed_at ? new Date(row.processed_at).getTime() : null

    if (isProcessed && processedMs && processedMs - submittedMs > tenMinMs) {
      const lateMin = Math.round((processedMs - submittedMs) / 60000)
      out.push({
        kind: `extract_late:${row.id}`,
        severity: 'critical',
        description: `Yoda Extract processed a lesson ${lateMin} min after submission (SLA: 10 min)`,
        affected: `class_input ${row.id}`,
        row_table: 'class_inputs',
        row_id: row.id,
        first_detected: ctx.today,
      })
      continue
    }
    if (!isProcessed && nowMs - submittedMs > tenMinMs) {
      const ageMin = Math.round((nowMs - submittedMs) / 60000)
      out.push({
        kind: `extract_stuck:${row.id}`,
        severity: 'critical',
        description: `Yoda Extract has not processed a lesson submitted ${ageMin} min ago (status=${row.status ?? 'null'})`,
        affected: `class_input ${row.id}`,
        row_table: 'class_inputs',
        row_id: row.id,
        first_detected: ctx.today,
      })
    }
  }
  return out
}

// ── 2. Impossible score values ──────────────────────────────────────────────
async function checkImpossibleScores(ctx: Ctx): Promise<DetectedAnomaly[]> {
  const out: DetectedAnomaly[] = []

  // Hard out-of-range on focus_points.base_score
  const { data: fps } = await ctx.sb
    .from('focus_points')
    .select('id, user_id, base_score, name')
    .or(`base_score.lt.${SCORE_HARD_MIN},base_score.gt.${SCORE_HARD_MAX}`)
  for (const r of fps ?? []) {
    if (isExcludedUser(r.user_id)) continue
    out.push({
      kind: `score_hard_range:focus_point:${r.id}`,
      severity: 'critical',
      description: `focus_point.base_score out of hard range (${r.base_score})`,
      affected: `"${r.name}" (user ${r.user_id})`,
      row_table: 'focus_points',
      row_id: r.id,
      first_detected: ctx.today,
    })
  }

  // Soft out-of-range warning on focus_points.base_score
  const { data: softFps } = await ctx.sb
    .from('focus_points')
    .select('id, user_id, base_score, name')
    .gt('base_score', SCORE_SOFT_MAX)
    .lte('base_score', SCORE_HARD_MAX)
  for (const r of softFps ?? []) {
    if (isExcludedUser(r.user_id)) continue
    out.push({
      kind: `score_soft_range:focus_point:${r.id}`,
      severity: 'warning',
      description: `focus_point.base_score above soft ceiling ${SCORE_SOFT_MAX} (value=${r.base_score})`,
      affected: `"${r.name}" (user ${r.user_id})`,
      row_table: 'focus_points',
      row_id: r.id,
      first_detected: ctx.today,
    })
  }

  // Soft out-of-range warning on focus_score_history.new_score
  const { data: histHits } = await ctx.sb
    .from('focus_score_history')
    .select('id, focus_point_id, user_id, new_score, created_at')
    .gte('created_at', ctx.periodStart)
    .lte('created_at', ctx.periodEnd)
    .gt('new_score', SCORE_SOFT_MAX)
  if (histHits?.length) {
    const fpIds = Array.from(new Set(histHits.map((h) => h.focus_point_id)))
    const { data: nameRows } = await ctx.sb
      .from('focus_points')
      .select('id, name')
      .in('id', fpIds)
    const nameById = new Map((nameRows ?? []).map((f) => [f.id, f.name as string]))
    for (const r of histHits) {
      if (isExcludedUser(r.user_id)) continue
      const name = nameById.get(r.focus_point_id) ?? '(unknown focus point)'
      out.push({
        kind: `score_soft_range:history:${r.id}`,
        severity: 'warning',
        description: `focus_score_history.new_score above soft ceiling ${SCORE_SOFT_MAX} on "${name}" (value=${r.new_score})`,
        affected: `"${name}" (user ${r.user_id})`,
        row_table: 'focus_score_history',
        row_id: r.id,
        first_detected: ctx.today,
      })
    }
  }

  // focus_progress (optional table) scores hard out-of-range
  try {
    const { data: fpr } = await ctx.sb
      .from('focus_progress')
      .select('user_id, progression_score, retention_score, global_score')
      .or(
        [
          `progression_score.lt.${SCORE_HARD_MIN}`,
          `progression_score.gt.${SCORE_HARD_MAX}`,
          `retention_score.lt.${SCORE_HARD_MIN}`,
          `retention_score.gt.${SCORE_HARD_MAX}`,
          `global_score.lt.${SCORE_HARD_MIN}`,
          `global_score.gt.${SCORE_HARD_MAX}`,
        ].join(','),
      )
    for (const r of fpr ?? []) {
      if (isExcludedUser(r.user_id)) continue
      const parts: string[] = []
      if (r.progression_score != null && (r.progression_score < SCORE_HARD_MIN || r.progression_score > SCORE_HARD_MAX)) parts.push(`progression=${r.progression_score}`)
      if (r.retention_score != null && (r.retention_score < SCORE_HARD_MIN || r.retention_score > SCORE_HARD_MAX)) parts.push(`retention=${r.retention_score}`)
      if (r.global_score != null && (r.global_score < SCORE_HARD_MIN || r.global_score > SCORE_HARD_MAX)) parts.push(`global=${r.global_score}`)
      out.push({
        kind: `score_hard_range:focus_progress:${r.user_id}`,
        severity: 'critical',
        description: `focus_progress score out of hard range (${parts.join(', ')})`,
        affected: `focus_progress for user ${r.user_id}`,
        row_table: 'focus_progress',
        row_id: r.user_id,
        first_detected: ctx.today,
      })
    }
  } catch (_e) {
    // focus_progress table not present in this environment — skip.
  }

  return out
}

// ── 3. Focus points active > 14d with zero practice logs ────────────────────
async function checkStaleActiveFocusPoints(ctx: Ctx): Promise<DetectedAnomaly[]> {
  const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()
  const { data: fps } = await ctx.sb
    .from('focus_points')
    .select('id, user_id, name, tier, status, created_at')
    .eq('status', 'active')
    .lt('created_at', cutoff)
    .or('is_deleted.is.null,is_deleted.eq.false')
  if (!fps?.length) return []

  const ids = fps.map((f) => f.id)
  const { data: logs } = await ctx.sb
    .from('practice_logs')
    .select('focus_point_id')
    .in('focus_point_id', ids)
  const logged = new Set((logs ?? []).map((l) => l.focus_point_id))

  return fps
    .filter((f) => !logged.has(f.id) && !isExcludedUser(f.user_id))
    .map<DetectedAnomaly>((f) => ({
      kind: `stale_active:${f.id}`,
      severity: 'warning',
      description: `Focus point "${f.name}" active for >14 days with zero practice logs`,
      affected: `"${f.name}" (user ${f.user_id})`,
      row_table: 'focus_points',
      row_id: f.id,
      first_detected: ctx.today,
    }))
}

// ── 4. Tier inconsistencies ─────────────────────────────────────────────────
async function checkTierInconsistencies(ctx: Ctx): Promise<DetectedAnomaly[]> {
  const out: DetectedAnomaly[] = []

  const { data: crit } = await ctx.sb
    .from('focus_points')
    .select('id, user_id, name, tier, mention_count')
    .eq('tier', 'critical')
    .eq('mention_count', 1)
    .or('is_deleted.is.null,is_deleted.eq.false')
  for (const r of crit ?? []) {
    if (isExcludedUser(r.user_id)) continue
    out.push({
      kind: `tier_incoherence:${r.id}`,
      severity: 'warning',
      description: `Critical focus point "${r.name}" with mention_count=1`,
      affected: `"${r.name}"`,
      row_table: 'focus_points',
      row_id: r.id,
      first_detected: ctx.today,
    })
  }

  const { data: supp } = await ctx.sb
    .from('focus_points')
    .select('id, user_id, name, tier, mention_count')
    .eq('tier', 'supporting')
    .gt('mention_count', 8)
    .or('is_deleted.is.null,is_deleted.eq.false')
  for (const r of supp ?? []) {
    if (isExcludedUser(r.user_id)) continue
    out.push({
      kind: `tier_incoherence:${r.id}`,
      severity: 'warning',
      description: `Supporting focus point "${r.name}" with mention_count=${r.mention_count}`,
      affected: `"${r.name}"`,
      row_table: 'focus_points',
      row_id: r.id,
      first_detected: ctx.today,
    })
  }
  return out
}

// ── 5. Score jumps >8 points in a single event during the period ────────────
// Ignores rows with all-null scores (practice-log rows that don't actually
// move base_score are logged by the trigger but carry no delta).
async function checkScoreJumps(ctx: Ctx): Promise<DetectedAnomaly[]> {
  const { data } = await ctx.sb
    .from('focus_score_history')
    .select('id, focus_point_id, user_id, delta, reason, old_score, new_score, created_at')
    .gte('created_at', ctx.periodStart)
    .lte('created_at', ctx.periodEnd)
  if (!data) return []

  const hits = data.filter((r) => {
    if (isExcludedUser(r.user_id)) return false
    if (r.delta == null && r.old_score == null && r.new_score == null) return false
    return Math.abs(Number(r.delta ?? 0)) > 8
  })
  if (!hits.length) return []

  const fpIds = Array.from(new Set(hits.map((h) => h.focus_point_id)))
  const { data: fps } = await ctx.sb
    .from('focus_points')
    .select('id, name')
    .in('id', fpIds)
  const nameById = new Map((fps ?? []).map((f) => [f.id, f.name as string]))

  return hits.map<DetectedAnomaly>((r) => {
    const name = nameById.get(r.focus_point_id) ?? '(unknown focus point)'
    return {
      kind: `score_jump:${r.id}`,
      severity: 'warning',
      description: `Yoda Score on "${name}" jumped ${r.delta} points in one event (reason: ${r.reason ?? 'unknown'})`,
      affected: `"${name}" (user ${r.user_id})`,
      row_table: 'focus_score_history',
      row_id: r.id,
      first_detected: ctx.today,
    }
  })
}

export async function runAllChecks(ctx: Ctx): Promise<DetectedAnomaly[]> {
  const results = await Promise.all([
    checkExtractTimeouts(ctx),
    checkImpossibleScores(ctx),
    checkStaleActiveFocusPoints(ctx),
    checkTierInconsistencies(ctx),
    checkScoreJumps(ctx),
  ])
  return results.flat()
}
