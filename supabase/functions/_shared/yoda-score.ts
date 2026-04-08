export type Tier = 'critical' | 'important' | 'supporting'
export type FocusStatus = 'active' | 'past_candidate' | 'past'
export type Rating = 'hard' | 'struggled' | 'okay' | 'good' | 'great'

export interface FocusPoint {
  id: string
  student_id: string
  tier: Tier
  status: FocusStatus
  base_score: number
  practice_count: number
  coach_signal: number
  reactivated: boolean
  last_exposed_at: Date | null
  last_mentioned_at: Date | null
  lessons_since_mentioned: number
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

export const PRACTICE_WEIGHT: Record<Tier, number> = {
  critical: 0.8,
  important: 1.0,
  supporting: 1.2,
}

export const TIER_MODIFIER: Record<Tier, number> = {
  critical: 3,
  important: 2,
  supporting: 1,
}

export const RATING_DELTA: Record<Rating, number> = {
  hard: 1.5,
  struggled: 1.0,
  okay: 0.0,
  good: -1.0,
  great: -2.0,
}

export const COACH_SIGNAL_POSITIVE = -4
export const COACH_SIGNAL_NEGATIVE = 2
export const MERGE_BOOST = 2
export const REACTIVATION_SCORE = 5
export const PAST_CANDIDATE_SCORE_THRESHOLD = 2
export const PAST_CANDIDATE_LESSONS_THRESHOLD = 3
export const EXPOSURE_GUARANTEE_DAYS = 15
export const PAST_INACTION_DAYS = 7
export const MERGE_NOTIFY_STUDENT_DAYS = 7

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function computePriority(focus: FocusPoint): number {
  const raw =
    focus.base_score
    - (focus.practice_count * PRACTICE_WEIGHT[focus.tier])
    + TIER_MODIFIER[focus.tier]
    + focus.coach_signal
  return clamp(raw, 0, 20)
}

export function applyPracticeLog(focus: FocusPoint, log: PracticeLog): FocusPoint {
  const durationDelta = log.duration_minutes >= 15 ? -1 : -0.5
  const ratingDelta = RATING_DELTA[log.rating]
  const updated = {
    ...focus,
    base_score: clamp(focus.base_score + durationDelta + ratingDelta, 0, 20),
    practice_count: focus.practice_count + 1,
  }
  return applyStateTransition(updated)
}

export function applyCoachSignal(
  focus: FocusPoint,
  signal: 'positive' | 'negative'
): FocusPoint {
  const delta = signal === 'positive' ? COACH_SIGNAL_POSITIVE : COACH_SIGNAL_NEGATIVE
  const updated = {
    ...focus,
    coach_signal: focus.coach_signal + delta,
    base_score: clamp(focus.base_score + delta, 0, 20),
  }
  return applyStateTransition(updated)
}

export function applyReactivation(focus: FocusPoint): FocusPoint {
  return {
    ...focus,
    status: 'active',
    base_score: REACTIVATION_SCORE,
    reactivated: true,
    practice_count: 0,
    coach_signal: 0,
    lessons_since_mentioned: 0,
    last_mentioned_at: new Date(),
  }
}

export function applyMerge(existing: FocusPoint): FocusPoint {
  const updated = {
    ...existing,
    base_score: clamp(existing.base_score + MERGE_BOOST, 0, 20),
    practice_count: 0,
    last_mentioned_at: new Date(),
    lessons_since_mentioned: 0,
  }
  return applyStateTransition(updated)
}

export function applyStateTransition(focus: FocusPoint): FocusPoint {
  const priority = computePriority(focus)

  if (focus.status === 'active') {
    const shouldBeCandidate =
      priority <= PAST_CANDIDATE_SCORE_THRESHOLD &&
      focus.practice_count >= 1 &&
      focus.lessons_since_mentioned >= PAST_CANDIDATE_LESSONS_THRESHOLD
    if (shouldBeCandidate) return { ...focus, status: 'past_candidate' }
  }

  if (focus.status === 'past_candidate') {
    if (priority > PAST_CANDIDATE_SCORE_THRESHOLD) return { ...focus, status: 'active' }
  }

  return focus
}

export function applyCoachInaction(focus: FocusPoint, now: Date): FocusPoint {
  if (focus.status !== 'past_candidate') return focus
  const candidateSince = focus.last_mentioned_at ?? focus.created_at
  const daysSince = Math.floor(
    (now.getTime() - candidateSince.getTime()) / (1000 * 60 * 60 * 24)
  )
  if (daysSince >= PAST_INACTION_DAYS) return { ...focus, status: 'past' }
  return focus
}

export function selectFocusPoints(focuses: FocusPoint[], now: Date): FocusPoint[] {
  const active = focuses.filter(f => f.status === 'active')

  const reactivated = active.filter(f => f.reactivated)

  const overdue = active.filter(f => {
    if (f.reactivated) return false
    if (!f.last_exposed_at) return true
    const daysSince = Math.floor(
      (now.getTime() - f.last_exposed_at.getTime()) / (1000 * 60 * 60 * 24)
    )
    return daysSince >= EXPOSURE_GUARANTEE_DAYS
  })

  const normal = active
    .filter(f => !f.reactivated && !overdue.includes(f))
    .sort((a, b) => computePriority(b) - computePriority(a))

  return [...reactivated, ...overdue, ...normal]
}

export function clearReactivatedFlag(focus: FocusPoint): FocusPoint {
  return { ...focus, reactivated: false }
}

/** Map a DB row to the FocusPoint interface */
export function dbRowToFocusPoint(row: any): FocusPoint {
  return {
    id: row.id,
    student_id: row.user_id,
    tier: row.tier as Tier,
    status: row.status as FocusStatus,
    base_score: row.base_score ?? 5,
    practice_count: row.practice_count ?? 0,
    coach_signal: row.coach_signal ?? 0,
    reactivated: row.reactivated ?? false,
    last_exposed_at: row.last_exposed_at ? new Date(row.last_exposed_at) : null,
    last_mentioned_at: row.last_mentioned_at ? new Date(row.last_mentioned_at) : null,
    lessons_since_mentioned: row.lessons_since_mentioned ?? 0,
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
  }
}
