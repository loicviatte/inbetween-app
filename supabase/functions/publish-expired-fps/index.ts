// publish-expired-fps
//
// Cron sweep that flushes focus_points stuck in `pending_coach` past their
// `coach_review_deadline` (default 18h). Mirrors the piggy-back logic that
// already lives at the top of `yoda-score/processClassInput`, but runs
// independently so coaches who haven't recorded a new class don't end up
// with their students' FPs frozen forever.
//
// Behaviour per row:
//   - Group FP with a source class: if the student answered 'no' to
//     attendance, soft-delete the FP. Otherwise publish (status='active').
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
}

async function sweep() {
  const now = new Date().toISOString()

  // Couple focus points — same 18h auto-publish (no per-dancer attendance),
  // run independently of the solo sweep below.
  let couplePublished = 0
  {
    const { data: ec } = await supabase
      .from('couple_focus_points')
      .select('id')
      .eq('status', 'pending_coach')
      .eq('is_deleted', false)
      .lte('coach_review_deadline', now)
      .limit(MAX_PER_RUN)
    if (ec && ec.length > 0) {
      const ids = ec.map((r: any) => r.id)
      const { error: ce } = await supabase
        .from('couple_focus_points')
        .update({ status: 'active', coach_review_deadline: null })
        .in('id', ids)
      if (ce) console.error('[publish-expired-fps] couple publish failed:', ce.message)
      else couplePublished = ids.length
    }
  }

  const { data: expired, error } = await supabase
    .from('focus_points')
    .select('id, user_id, group_fp, source_class_input_id')
    .eq('status', 'pending_coach')
    .eq('is_deleted', false)
    .lte('coach_review_deadline', now)
    .limit(MAX_PER_RUN)

  if (error) throw new Error(`load expired FPs: ${error.message}`)
  if (!expired || expired.length === 0) {
    return { published: 0, dropped: 0, couplePublished, total: 0 }
  }

  // Pre-fetch attendance for the group FPs in one batch — avoids N+1 when
  // the backlog is large (e.g. after a long downtime of this sweep).
  const groupClassIds = [
    ...new Set(
      expired
        .filter((fp: ExpiredFP) => fp.group_fp && fp.source_class_input_id)
        .map((fp: ExpiredFP) => fp.source_class_input_id as string),
    ),
  ]

  const excludedByClass: Record<string, Set<string>> = {}
  if (groupClassIds.length > 0) {
    const { data: cisRows } = await supabase
      .from('class_input_students')
      .select('class_input_id, student_id, attendance')
      .in('class_input_id', groupClassIds)
      .eq('attendance', 'no')
    for (const r of cisRows || []) {
      const cid = r.class_input_id as string
      const sid = r.student_id as string
      if (!excludedByClass[cid]) excludedByClass[cid] = new Set<string>()
      excludedByClass[cid].add(sid)
    }
  }

  const toPublish: string[] = []
  const toDrop: string[] = []
  for (const fp of expired as ExpiredFP[]) {
    const isGroup = !!(fp.group_fp && fp.source_class_input_id)
    const excluded =
      isGroup &&
      excludedByClass[fp.source_class_input_id as string]?.has(fp.user_id)
    if (excluded) toDrop.push(fp.id)
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
    `[publish-expired-fps] swept ${expired.length} (published ${toPublish.length}, dropped ${toDrop.length}, couple ${couplePublished})`,
  )
  return {
    published: toPublish.length,
    dropped: toDrop.length,
    couplePublished,
    total: expired.length,
  }
}
