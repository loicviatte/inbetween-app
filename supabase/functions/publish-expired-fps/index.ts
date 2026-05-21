// publish-expired-fps
//
// Cron sweep that flushes focus_points stuck in `pending_coach` past their
// `coach_review_deadline` (default 18h). Mirrors the piggy-back logic that
// already lives at the top of `yoda-score/processClassInput`, but runs
// independently so coaches who haven't recorded a new class don't end up
// with their students' FPs frozen forever.
//
// Admin gate: a FP is only eligible for auto-publish once its parent
// class_input has been admin-approved (admin_approved_at IS NOT NULL).
// Before admin review, the 18h coach window doesn't even start ticking
// against the coach — when admin approves, approveClass resets the
// deadline so the coach gets a fresh 18h window.
//
// Behaviour per row:
//   - class_input not yet admin-approved → skip (stay pending_coach)
//   - Group FP with a source class where the student has NOT confirmed
//     attendance (attendance_responses.attended = true) → soft-delete.
//     A pending answer or a missing row counts as "not attended" — the
//     student has to explicitly say "yes" to receive focus points.
//   - Otherwise: publish (status='active').
//
// Triggered by pg_cron every 5 minutes. Safe to invoke manually too —
// idempotent, body ignored.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Cap so a runaway run can't update more than expected. With 5-min cadence
// any reasonable backlog clears in a few sweeps.
const MAX_PER_RUN = 500

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

Deno.serve(async (_req: Request) => {
  try {
    const result = await sweep()
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[publish-expired-fps] error:', msg)
    return new Response(JSON.stringify({ error: msg }), { status: 500 })
  }
})

type ExpiredFP = {
  id: string
  user_id: string
  group_fp: boolean | null
  source_class_input_id: string | null
  class_input_id: string | null
}

async function sweep() {
  const now = new Date().toISOString()

  const { data: expired, error } = await supabase
    .from('focus_points')
    .select('id, user_id, group_fp, source_class_input_id, class_input_id')
    .eq('status', 'pending_coach')
    .eq('is_deleted', false)
    .lte('coach_review_deadline', now)
    .limit(MAX_PER_RUN)

  if (error) throw new Error(`load expired FPs: ${error.message}`)
  if (!expired || expired.length === 0) {
    return { published: 0, dropped: 0, gated: 0, total: 0 }
  }

  // Admin gate: only auto-publish FPs whose parent class_input has been
  // admin-approved. Orphan FPs (class_input_id IS NULL) flow through as
  // before.
  const classIds = [
    ...new Set(
      (expired as ExpiredFP[])
        .map((fp) => fp.class_input_id)
        .filter((v): v is string => !!v),
    ),
  ]
  const approvedSet = new Set<string>()
  if (classIds.length > 0) {
    const { data: approvedClasses } = await supabase
      .from('class_inputs')
      .select('id')
      .in('id', classIds)
      .not('admin_approved_at', 'is', null)
    for (const c of (approvedClasses ?? []) as { id: string }[]) {
      approvedSet.add(c.id)
    }
  }
  const gated: ExpiredFP[] = []
  const eligible: ExpiredFP[] = []
  for (const fp of expired as ExpiredFP[]) {
    if (fp.class_input_id == null || approvedSet.has(fp.class_input_id)) {
      eligible.push(fp)
    } else {
      gated.push(fp)
    }
  }

  // Pre-fetch attendance confirmations for the group FPs in one batch — only
  // students who explicitly answered "yes" via attendance_responses are
  // eligible. Pending or missing responses count as "not attended" and get
  // soft-deleted. Source of truth is attendance_responses.attended, NOT
  // class_input_students.attendance (which is never updated past 'pending').
  const groupFPs = eligible.filter((fp) => fp.group_fp && fp.source_class_input_id)
  const groupClassIds = [
    ...new Set(groupFPs.map((fp) => fp.source_class_input_id as string)),
  ]
  const groupStudentIds = [...new Set(groupFPs.map((fp) => fp.user_id))]

  const attendedKeys = new Set<string>()
  if (groupClassIds.length > 0 && groupStudentIds.length > 0) {
    const { data: attendedRows } = await supabase
      .from('attendance_responses')
      .select('class_input_id, student_id')
      .in('class_input_id', groupClassIds)
      .in('student_id', groupStudentIds)
      .eq('attended', true)
    for (const r of attendedRows || []) {
      attendedKeys.add(`${r.class_input_id}:${r.student_id}`)
    }
  }

  const toPublish: string[] = []
  const toDrop: string[] = []
  for (const fp of eligible) {
    const isGroup = !!(fp.group_fp && fp.source_class_input_id)
    const attended =
      !isGroup ||
      attendedKeys.has(`${fp.source_class_input_id}:${fp.user_id}`)
    if (!attended) toDrop.push(fp.id)
    else toPublish.push(fp.id)
  }

  // Two batched updates instead of one-per-row.
  if (toPublish.length > 0) {
    const { error: pubErr } = await supabase
      .from('focus_points')
      .update({ status: 'active', coach_review_deadline: null })
      .in('id', toPublish)
    if (pubErr) {
      console.error('[publish-expired-fps] publish update failed:', pubErr.message)
    }
  }
  if (toDrop.length > 0) {
    const { error: dropErr } = await supabase
      .from('focus_points')
      .update({ is_deleted: true, status: 'past' })
      .in('id', toDrop)
    if (dropErr) {
      console.error('[publish-expired-fps] drop update failed:', dropErr.message)
    }
  }

  console.log(
    `[publish-expired-fps] swept ${expired.length} (published ${toPublish.length}, dropped ${toDrop.length}, gated ${gated.length})`,
  )
  return {
    published: toPublish.length,
    dropped: toDrop.length,
    gated: gated.length,
    total: expired.length,
  }
}
