export type Tier = 'critical' | 'important' | 'supporting'
export type FocusStatus = 'active' | 'past_candidate' | 'past'
export type Rating = 'hard' | 'struggled' | 'okay' | 'good' | 'great'

export interface FocusPoint {
  id: string
  student_id: string
  name?: string
  tier: Tier
  status: FocusStatus
  base_score: number
  practice_count: number
  coach_signal: number
  reactivated: boolean
  last_exposed_at: Date | null
  last_mentioned_at: Date | null
  lessons_since_mentioned: number
  train_target: number
  created_at: Date
}

export interface PracticeLog {
  focus_point_id: string
  duration_minutes: number
  rating: Rating
}

export const STARTING_SCORES: Record<Tier, number> = {
  critical: 10,
  important: 7,
  supporting: 5,
}

// Per-tier base train target = how many sessions to "train" a focus point.
// This is now the source of truth for the X/N progress (tier itself is just a
// display rank). It is STORED per focus point (focus_points.train_target) and
// grows by REDO_INCREMENT each time a focus must be redone (carry-over/merge).
export const TRAIN_TARGET_BY_TIER: Record<Tier, number> = {
  critical: 3,
  important: 2,
  supporting: 2,
}
export const REDO_INCREMENT = 2

// How many days a coach-pending merge_request waits before it escalates to the
// student. The only score/lifecycle constant still in use — everything else
// (priority weights, coach-signal deltas, reactivation, past-candidate
// thresholds) is gone: tier is a target-count rank only now.
export const MERGE_NOTIFY_STUDENT_DAYS = 7

// Display rank for reconciliation: critical outranks important outranks
// supporting. Used to decide which focus survives when a student has >3.
export const RECONCILE_TIER_RANK: Record<string, number> = {
  critical: 0,
  important: 1,
  supporting: 2,
}

// Reconciliation is PER dance category — a 2-style dancer keeps up to 3 Latin
// AND up to 3 Ballroom, they must never be mixed into one bucket. Mirrors the
// client's danceCategory.js: untagged focuses (no dance) belong to BOTH styles.
const LATIN_DANCES_RECONCILE = ['Cha Cha', 'Samba', 'Rumba', 'Paso Doble', 'Jive']

export function categoryFromDance(dance: string[] | null | undefined): 'latin' | 'ballroom' | null {
  const d = dance ?? []
  if (d.length === 0) return null
  return d.some((x) => LATIN_DANCES_RECONCILE.includes(x)) ? 'latin' : 'ballroom'
}

export function focusInCategory(dance: string[] | null | undefined, category: 'latin' | 'ballroom' | null): boolean {
  if (!category) return true
  const d = dance ?? []
  if (d.length === 0) return true // untagged → counts in both styles
  const isLatin = d.some((x) => LATIN_DANCES_RECONCILE.includes(x))
  return category === 'latin' ? isLatin : !isLatin
}

export function applyPracticeLog(focus: FocusPoint, _log: PracticeLog): FocusPoint {
  // Practice only advances the X/N train count. Tier is target-count only now:
  // a practice log must NOT move base_score nor trigger any lifecycle transition
  // — the focus point stays active until the coach validates or the student archives.
  return {
    ...focus,
    practice_count: focus.practice_count + 1,
  }
}

export function applyMerge(existing: FocusPoint): FocusPoint {
  // Re-mention of the same focus point (coach re-addressed it in a new class):
  // KEEP the train count (practice_count is NOT reset) and grow the target by
  // REDO_INCREMENT — it must be redone, so e.g. 3/3 → 3/5. No score, no decay.
  return {
    ...existing,
    train_target: existing.train_target + REDO_INCREMENT,
    last_mentioned_at: new Date(),
  }
}

/** Map a DB row to the FocusPoint interface */
export function dbRowToFocusPoint(row: any): FocusPoint {
  return {
    id: row.id,
    student_id: row.user_id,
    name: row.name,
    tier: row.tier as Tier,
    status: row.status as FocusStatus,
    base_score: row.base_score ?? 5,
    practice_count: row.practice_count ?? 0,
    coach_signal: row.coach_signal ?? 0,
    reactivated: row.reactivated ?? false,
    last_exposed_at: row.last_exposed_at ? new Date(row.last_exposed_at) : null,
    last_mentioned_at: row.last_mentioned_at ? new Date(row.last_mentioned_at) : null,
    lessons_since_mentioned: row.lessons_since_mentioned ?? 0,
    train_target: row.train_target ?? TRAIN_TARGET_BY_TIER[row.tier as Tier] ?? 2,
    created_at: new Date(row.created_at),
  }
}

/** Extract DB-updatable fields from a FocusPoint */
export function focusPointToDbUpdate(fp: FocusPoint): Record<string, unknown> {
  return {
    status: fp.status,
    base_score: fp.base_score,
    practice_count: fp.practice_count,
    coach_signal: fp.coach_signal,
    reactivated: fp.reactivated,
    last_exposed_at: fp.last_exposed_at?.toISOString() ?? null,
    last_mentioned_at: fp.last_mentioned_at?.toISOString() ?? null,
    lessons_since_mentioned: fp.lessons_since_mentioned,
    train_target: fp.train_target,
  }
}

// ─── Reconciliation auto-resolve (18h publish) ────────────────────────────────
// When the new focuses auto-publish and a student is left with >3 active,
// non-group private focuses IN A DANCE CATEGORY because a "not yet" carry-over
// (is_held=true) was never reconciled, the carry-over WINS by default: drop the
// lowest-ranked NEW (non-held) focuses down to 3, keeping the carry-over(s).
// PER CATEGORY — a 2-style dancer can hold 3 Latin + 3 Ballroom. Mirrors the
// coach's ReconcileFocusSheet default. Returns how many were dropped.
export async function autoResolveCarryover(supabase: any, studentId: string): Promise<number> {
  const { data: rows } = await supabase
    .from('focus_points')
    .select('id, tier, is_held, created_at, dance')
    .eq('user_id', studentId)
    .eq('status', 'active')
    .eq('is_other', false)
    .eq('is_deleted', false)
    .or('group_fp.is.null,group_fp.eq.false')

  const all = (rows ?? []) as any[]
  const droppedIds = new Set<string>()

  for (const category of ['latin', 'ballroom'] as const) {
    const fps = all.filter((f) => !droppedIds.has(f.id) && focusInCategory(f.dance, category))
    if (fps.length <= 3) continue
    const carried = fps.filter((f) => f.is_held === true)
    if (carried.length === 0) continue // >3 without a carry-over is not an auto case
    const fresh = fps.filter((f) => f.is_held !== true)
    if (fresh.length === 0) continue

    // Keep all carry-overs (capped at 3) + the highest-ranked fresh up to 3
    // total; drop the lowest-ranked fresh (supporting first, then newest).
    const keepFresh = Math.max(0, 3 - carried.length)
    const dropIds = [...fresh]
      .sort((a, b) =>
        (RECONCILE_TIER_RANK[b.tier] ?? 2) - (RECONCILE_TIER_RANK[a.tier] ?? 2)
        || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, fresh.length - keepFresh)
      .map((f) => f.id)
    for (const id of dropIds) droppedIds.add(id)
  }

  if (droppedIds.size === 0) return 0
  await supabase
    .from('focus_points')
    .update({ status: 'past' })
    .in('id', [...droppedIds])
  return droppedIds.size
}
