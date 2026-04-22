// Fetches an aggregated snapshot of the database for the reporting period.
// Schema references are grounded in:
//   - users: id, name, email, role, latin_coach_id, ballroom_coach_id
//   - class_inputs: id, user_id (uploader = coach for coach-submitted
//     lessons), student_id, student_ids, status (pending | extracted |
//     scored), processed_at, raw_ai_json, created_at, lesson_type
//   - focus_points: id, user_id, name, tier, status (active | past),
//     mention_count, base_score, created_at, last_mentioned_at
//   - focus_score_history: id, focus_point_id, user_id, old_score,
//     new_score, delta, reason, created_at

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ACTIVE_COACH_DAYS = 30
const ACTIVE_STUDENT_DAYS = 60

// Users to fully exclude from the monitoring scope (internal test accounts,
// the founder's own QA account, etc.). Their activity is filtered out of
// every table before the LLM or any check ever sees it.
const EXCLUDED_USER_IDS = new Set<string>([
  '4bc1004e-0ee0-4912-8dca-13afdf82ea22',
])

export function isExcludedUser(id: string | null | undefined): boolean {
  return !!id && EXCLUDED_USER_IDS.has(id)
}

export const EXCLUDED_USERS_ARRAY = Array.from(EXCLUDED_USER_IDS)

export async function buildSnapshot(
  sb: SupabaseClient,
  periodStart: string,
  periodEnd: string,
) {
  const activeCoachCutoff = new Date(Date.now() - ACTIVE_COACH_DAYS * 86400000).toISOString()
  const activeStudentCutoff = new Date(Date.now() - ACTIVE_STUDENT_DAYS * 86400000).toISOString()

  // ── Coaches: everyone with role='coach' (we'll compute "active" below by
  //    intersecting with recent class_inputs uploaders).
  const { data: allCoaches } = await sb
    .from('users')
    .select('id, name, email')
    .eq('role', 'coach')

  const coachIds = (allCoaches ?? [])
    .map((c) => c.id)
    .filter((id) => !isExcludedUser(id))

  // ── Recent class_inputs, filtered to exclude any row touching an excluded
  //    user. Uploader is users.id == class_inputs.user_id.
  const { data: rawRecentClassInputs } = await sb
    .from('class_inputs')
    .select('id, user_id, student_id, student_ids, created_at, status, processed_at, raw_ai_json, lesson_type, is_deleted')
    .gte('created_at', activeCoachCutoff)
    .or('is_deleted.is.null,is_deleted.eq.false')

  const recentClassInputs = (rawRecentClassInputs ?? []).filter((c) => {
    if (isExcludedUser(c.user_id)) return false
    if (isExcludedUser(c.student_id)) return false
    if (Array.isArray(c.student_ids) && c.student_ids.some(isExcludedUser)) return false
    return true
  })

  const activeCoachIds = Array.from(
    new Set(
      recentClassInputs
        .map((c) => c.user_id)
        .filter((id) => id && coachIds.includes(id)),
    ),
  )

  const coaches = (allCoaches ?? []).filter((c) => activeCoachIds.includes(c.id))

  // ── Students: users.role='student' whose coach pointer matches any
  //    active coach. Students with no coach pointing to an active coach
  //    are out of scope.
  let students: Array<{ id: string; name: string | null; latin_coach_id: string | null; ballroom_coach_id: string | null; created_at: string }> = []
  if (activeCoachIds.length) {
    const { data } = await sb
      .from('users')
      .select('id, name, latin_coach_id, ballroom_coach_id, created_at')
      .eq('role', 'student')
      .or(
        activeCoachIds
          .map((id) => `latin_coach_id.eq.${id},ballroom_coach_id.eq.${id}`)
          .join(','),
      )
    students = (data ?? []).filter((s) => !isExcludedUser(s.id))
  }

  const studentIds = students.map((s) => s.id)

  // ── Per-student data. Kept lean — only columns the LLM needs to reason.
  const emptyFilter = ['00000000-0000-0000-0000-000000000000']
  const studentFilter = studentIds.length ? studentIds : emptyFilter

  const [
    { data: focusPoints },
    { data: practiceLogs },
    { data: focusEvents },
    { data: mergeRequests },
    { data: attendanceResponses },
    { data: scoreHistory },
  ] = await Promise.all([
    sb
      .from('focus_points')
      .select('id, user_id, name, tier, status, mention_count, base_score, created_at, last_mentioned_at, alias_of, merge_candidate_id, merge_status, coach_review_deadline')
      .in('user_id', studentFilter)
      .or(`last_mentioned_at.gte.${activeStudentCutoff},created_at.gte.${activeStudentCutoff}`)
      .or('is_deleted.is.null,is_deleted.eq.false'),
    sb
      .from('practice_logs')
      .select('id, user_id, focus_point_id, created_at')
      .gte('created_at', periodStart)
      .lte('created_at', periodEnd),
    sb
      .from('focus_events')
      .select('id, user_id, focus_point_id, event_type, created_at')
      .gte('created_at', periodStart)
      .lte('created_at', periodEnd),
    sb
      .from('merge_requests')
      .select('id, student_id, source_focus_id, target_focus_id, status, created_at')
      .gte('created_at', periodStart)
      .lte('created_at', periodEnd),
    sb
      .from('attendance_responses')
      .select('id, user_id, class_input_id, created_at')
      .gte('created_at', periodStart)
      .lte('created_at', periodEnd),
    sb
      .from('focus_score_history')
      .select('id, focus_point_id, user_id, old_score, new_score, delta, reason, created_at')
      .gte('created_at', periodStart)
      .lte('created_at', periodEnd),
  ])

  // ── focus_progress (per-student aggregated scores). This table is optional:
  //    if it doesn't exist in this environment, swallow the error and move on
  //    rather than failing the whole run.
  let focusProgress:
    | Array<{ user_id: string; progression_score?: number; retention_score?: number; global_score?: number; updated_at?: string }>
    | null = null
  try {
    const { data } = await sb
      .from('focus_progress')
      .select('user_id, progression_score, retention_score, global_score, updated_at')
      .in('user_id', studentFilter)
    focusProgress = data ?? []
  } catch (_e) {
    focusProgress = []
  }

  const periodClassInputs = recentClassInputs.filter(
    (c) => c.created_at >= periodStart && c.created_at <= periodEnd,
  )

  return {
    coaches,
    students,
    class_inputs: periodClassInputs.map((c) => ({
      id: c.id,
      uploader_user_id: c.user_id,
      student_ids: c.student_ids ?? (c.student_id ? [c.student_id] : []),
      created_at: c.created_at,
      processed_at: c.processed_at,
      status: c.status,
      processed: c.status === 'scored' || c.status === 'extracted',
      lesson_type: c.lesson_type,
    })),
    focus_points: (focusPoints ?? []).filter((f) => !isExcludedUser(f.user_id)),
    focus_progress: (focusProgress ?? []).filter((f) => !isExcludedUser(f.user_id)),
    practice_logs: (practiceLogs ?? []).filter((f) => !isExcludedUser(f.user_id)),
    focus_events: (focusEvents ?? []).filter((f) => !isExcludedUser(f.user_id)),
    merge_requests: (mergeRequests ?? []).filter((f) => !isExcludedUser(f.student_id)),
    attendance_responses: (attendanceResponses ?? []).filter((f) => !isExcludedUser(f.user_id)),
    focus_score_history: (scoreHistory ?? []).filter((f) => !isExcludedUser(f.user_id)),
  }
}
