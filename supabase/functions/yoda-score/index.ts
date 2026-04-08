import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  type FocusPoint,
  type Tier,
  STARTING_SCORES,
  MERGE_NOTIFY_STUDENT_DAYS,
  applyMerge,
  applyCoachSignal,
  applyStateTransition,
  applyCoachInaction,
  applyPracticeLog,
  clearReactivatedFlag,
  dbRowToFocusPoint,
  focusPointToDbUpdate,
} from '../_shared/yoda-score.ts'

// ─── Deno / Supabase Edge Runtime globals ────────────────────────────────────

declare global {
  const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Auth check — must be called with a valid token (user JWT or service role)
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), { status: 401 })
  }

  let payload: any
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 })
  }

  // Always use service role for DB operations — yoda-score touches multiple users' data
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    if (payload.event === 'class_input') {
      await processClassInput(supabase, payload)
    } else if (payload.event === 'practice_log') {
      await processPracticeLog(supabase, payload)
    } else {
      return new Response(JSON.stringify({ error: 'Unknown event' }), { status: 400 })
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[yoda-score] Error:', msg)
    return new Response(JSON.stringify({ error: msg }), { status: 500 })
  }
})

// ─── class_input event ────────────────────────────────────────────────────────

async function processClassInput(supabase: any, payload: any): Promise<void> {
  const { class_input_id } = payload

  // 1. Load class input
  const { data: classInput, error: ciError } = await supabase
    .from('class_inputs')
    .select('id, raw_ai_json, status')
    .eq('id', class_input_id)
    .single()

  if (ciError || !classInput?.raw_ai_json) {
    throw new Error(`[yoda-score] Cannot load class_input ${class_input_id}: ${ciError?.message}`)
  }

  const aiData = classInput.raw_ai_json as any
  const now = new Date()

  // 2. Process each student
  for (const studentJson of aiData.students ?? []) {
    const studentId: string = studentJson.student_id
    if (!studentId) continue

    await processStudentFocusPoints(supabase, studentId, studentJson, class_input_id, now)
  }

  // 3. Check merge_requests older than MERGE_NOTIFY_STUDENT_DAYS → escalate to student
  const cutoff = new Date(now.getTime() - MERGE_NOTIFY_STUDENT_DAYS * 24 * 60 * 60 * 1000)
  const { data: staleMerges } = await supabase
    .from('merge_requests')
    .select('id, student_id, focus_a, focus_b')
    .eq('status', 'pending_coach')
    .lt('created_at', cutoff.toISOString())

  for (const merge of staleMerges ?? []) {
    await supabase
      .from('merge_requests')
      .update({ status: 'pending_student' })
      .eq('id', merge.id)

    await supabase.from('notifications').insert({
      user_id: merge.student_id,
      type: 'merge_request_student',
      title: 'Focus point to review',
      body: 'Two of your focus points may be the same — tap to decide.',
      data: { merge_request_id: merge.id, focus_a: merge.focus_a, focus_b: merge.focus_b },
    })
    console.log(`[yoda-score] Escalated merge_request ${merge.id} to student`)
  }

  // 4. Mark class input as scored
  await supabase
    .from('class_inputs')
    .update({ status: 'scored' })
    .eq('id', class_input_id)

  console.log(`[yoda-score] ✓ Scored class_input ${class_input_id}`)
}

async function processStudentFocusPoints(
  supabase: any,
  studentId: string,
  studentJson: any,
  classInputId: string,
  now: Date,
): Promise<void> {
  // 3h deadline for coach to review new focus points
  const reviewDeadline = new Date(now.getTime() + 3 * 60 * 60 * 1000)

  // Get coach_id for this student (used for notifications)
  const { data: studentRow } = await supabase
    .from('users')
    .select('coach_id, name')
    .eq('id', studentId)
    .single()
  const coachId: string | null = studentRow?.coach_id ?? null
  const studentName: string = studentRow?.name ?? 'your student'

  // Load all non-past, non-other focus points for this student
  const { data: rows, error } = await supabase
    .from('focus_points')
    .select('*')
    .eq('user_id', studentId)
    .neq('status', 'past')
    .eq('is_other', false)

  if (error) {
    console.error(`[yoda-score] Cannot load focus_points for ${studentId}:`, error.message)
    return
  }

  const existingFPs: FocusPoint[] = (rows ?? []).map(dbRowToFocusPoint)
  const mentionedFPIds = new Set<string>()

  // a. Process each focus point from AI JSON
  for (const fpJson of studentJson.focus_points ?? []) {
    const tier = (fpJson.tier ?? 'supporting') as Tier

    if (fpJson.merge_action === 'auto_merge' && fpJson.existing_focus_point_id) {
      // Auto-merge: update existing focus point
      const existing = existingFPs.find(f => f.id === fpJson.existing_focus_point_id)
      if (existing) {
        const updated = applyMerge(existing)
        await supabase
          .from('focus_points')
          .update({
            ...focusPointToDbUpdate(updated),
            last_mentioned_at: now.toISOString(),
          })
          .eq('id', existing.id)
        mentionedFPIds.add(existing.id)
        console.log(`[yoda-score] Auto-merged FP ${existing.id} for student ${studentId}`)
      }
    } else if (fpJson.merge_action === 'notify_coach' && fpJson.existing_focus_point_id) {
      // Create merge request and notify coach
      const existing = existingFPs.find(f => f.id === fpJson.existing_focus_point_id)
      if (existing) {
        // Create the new focus point first (as a merge candidate)
        const { data: newFP } = await supabase
          .from('focus_points')
          .insert({
            user_id: studentId,
            name: fpJson.title,
            normalized_name: fpJson.title.toLowerCase().trim(),
            subtitle: fpJson.subtitle ?? null,
            context: fpJson.context ?? null,
            dance: fpJson.dance ?? [],
            drill: fpJson.drill ?? null,
            tier,
            base_score: STARTING_SCORES[tier],
            mention_count: fpJson.mention_count ?? 0,
            explicit_priority: fpJson.explicit_priority ?? false,
            first_timestamp: fpJson.timestamp ?? null,
            last_mentioned_at: now.toISOString(),
            class_input_id: classInputId,
            status: 'active',
            count: 0,
            is_archived: false,
            is_deleted: false,
            is_other: false,
            merge_status: 'pending_coach',
            merge_candidate_id: existing.id,
          })
          .select('id')
          .single()

        if (newFP) {
          // Get coach_id for this student
          const { data: student } = await supabase
            .from('users')
            .select('coach_id')
            .eq('id', studentId)
            .single()

          await supabase.from('merge_requests').insert({
            student_id: studentId,
            focus_a: existing.id,
            focus_b: newFP.id,
            status: 'pending_coach',
          })

          if (student?.coach_id) {
            await supabase.from('notifications').insert({
              user_id: student.coach_id,
              type: 'merge_request',
              title: 'Possible duplicate focus point',
              body: `"${fpJson.title}" may overlap with an existing focus point for ${studentJson.student_name}.`,
              data: { student_id: studentId, focus_a: existing.id, focus_b: newFP.id },
            })
          }
          mentionedFPIds.add(existing.id)
        }
        console.log(`[yoda-score] Created merge_request for ${existing.id} / student ${studentId}`)
      }
    } else {
      // New focus point — start as pending_coach with 3h review window
      const { data: inserted } = await supabase
        .from('focus_points')
        .insert({
          user_id: studentId,
          name: fpJson.title,
          normalized_name: fpJson.title.toLowerCase().trim(),
          subtitle: fpJson.subtitle ?? null,
          context: fpJson.context ?? null,
          dance: fpJson.dance ?? [],
          drill: fpJson.drill ?? null,
          tier,
          base_score: STARTING_SCORES[tier],
          mention_count: fpJson.mention_count ?? 0,
          explicit_priority: fpJson.explicit_priority ?? false,
          first_timestamp: fpJson.timestamp ?? null,
          last_mentioned_at: now.toISOString(),
          class_input_id: classInputId,
          status: 'pending_coach',
          coach_review_deadline: reviewDeadline.toISOString(),
          count: 0,
          is_archived: false,
          is_deleted: false,
          is_other: false,
        })
        .select('id')
        .single()

      if (inserted) {
        mentionedFPIds.add(inserted.id)
        console.log(`[yoda-score] Created focus_point ${inserted.id} (${fpJson.title}) pending_coach for ${studentId}`)
      }
    }

    // b. Apply coach_signal if present
    if (fpJson.coach_signal && fpJson.existing_focus_point_id) {
      const existing = existingFPs.find(f => f.id === fpJson.existing_focus_point_id)
      if (existing) {
        const updated = applyCoachSignal(existing, fpJson.coach_signal as 'positive' | 'negative')
        await supabase
          .from('focus_points')
          .update(focusPointToDbUpdate(updated))
          .eq('id', existing.id)
      }
    }
  }

  // c. Insert other_focus_points
  const otherRows = (studentJson.other_focus_points ?? []).map((ofp: any) => ({
    user_id: studentId,
    name: ofp.title,
    normalized_name: ofp.title.toLowerCase().trim(),
    dance: ofp.dance ?? [],
    first_timestamp: ofp.timestamp ?? null,
    tier: 'supporting' as Tier,
    base_score: 5,
    class_input_id: classInputId,
    status: 'active',
    is_other: true,
    count: 0,
    is_archived: false,
    is_deleted: false,
    last_mentioned_at: now.toISOString(),
  }))

  if (otherRows.length > 0) {
    const { error: otherError } = await supabase.from('focus_points').insert(otherRows)
    if (otherError) console.error('[yoda-score] Error inserting other_focus_points:', otherError.message)
  }

  // Notify coach to review the new pending_coach focus points (3h window)
  const newFPCount = (studentJson.focus_points ?? []).filter((fp: any) => !fp.merge_action).length
  if (newFPCount > 0 && coachId) {
    await supabase.from('notifications').insert({
      user_id: coachId,
      type: 'focus_points_pending_review',
      title: 'New focus points to review',
      body: `Yoda extracted ${newFPCount} focus point${newFPCount > 1 ? 's' : ''} for ${studentName}. Review within 3h or they'll be sent as-is.`,
      data: { student_id: studentId, class_input_id: classInputId, deadline: reviewDeadline.toISOString() },
    })
    console.log(`[yoda-score] Notified coach ${coachId} to review ${newFPCount} FPs for ${studentId}`)
  }

  // d. Increment lessons_since_mentioned for FPs not mentioned in this lesson
  const unmentioned = existingFPs.filter(f => f.status === 'active' && !mentionedFPIds.has(f.id))
  for (const fp of unmentioned) {
    await supabase
      .from('focus_points')
      .update({ lessons_since_mentioned: fp.lessons_since_mentioned + 1 })
      .eq('id', fp.id)
  }

  // e. Run state transitions for all active focus points
  const { data: updatedRows } = await supabase
    .from('focus_points')
    .select('*')
    .eq('user_id', studentId)
    .eq('status', 'active')
    .eq('is_other', false)

  for (const row of updatedRows ?? []) {
    const fp = dbRowToFocusPoint(row)
    const transitioned = applyStateTransition(fp)
    if (transitioned.status !== fp.status) {
      await supabase
        .from('focus_points')
        .update({ status: transitioned.status })
        .eq('id', fp.id)
      console.log(`[yoda-score] FP ${fp.id} transitioned ${fp.status} → ${transitioned.status}`)
    }
  }

  // f. Run coach inaction check for past_candidate focus points
  const { data: candidateRows } = await supabase
    .from('focus_points')
    .select('*')
    .eq('user_id', studentId)
    .eq('status', 'past_candidate')
    .eq('is_other', false)

  for (const row of candidateRows ?? []) {
    const fp = dbRowToFocusPoint(row)
    const inactioned = applyCoachInaction(fp, now)
    if (inactioned.status !== fp.status) {
      await supabase
        .from('focus_points')
        .update({ status: inactioned.status })
        .eq('id', fp.id)
      console.log(`[yoda-score] FP ${fp.id} moved to past (inaction)`)
    }
  }
}

// ─── practice_log event ───────────────────────────────────────────────────────

async function processPracticeLog(supabase: any, payload: any): Promise<void> {
  const { practice_log_id } = payload

  // 1. Load practice log
  const { data: log, error: logError } = await supabase
    .from('practice_logs')
    .select('id, student_id, focus_point_id, duration_minutes, rating')
    .eq('id', practice_log_id)
    .single()

  if (logError || !log) {
    throw new Error(`[yoda-score] Cannot load practice_log ${practice_log_id}: ${logError?.message}`)
  }

  // 2. Load focus point
  const { data: row, error: fpError } = await supabase
    .from('focus_points')
    .select('*')
    .eq('id', log.focus_point_id)
    .single()

  if (fpError || !row) {
    throw new Error(`[yoda-score] Cannot load focus_point ${log.focus_point_id}: ${fpError?.message}`)
  }

  const fp = dbRowToFocusPoint(row)
  const wasReactivated = fp.reactivated

  // 3. Apply practice log
  let updated = applyPracticeLog(fp, {
    focus_point_id: log.focus_point_id,
    duration_minutes: log.duration_minutes,
    rating: log.rating,
  })

  // 4. Clear reactivated flag after first practice
  if (wasReactivated) {
    updated = clearReactivatedFlag(updated)
  }

  // 5. Update focus point in DB
  const { error: updateError } = await supabase
    .from('focus_points')
    .update({
      ...focusPointToDbUpdate(updated),
      last_exposed_at: new Date().toISOString(),
    })
    .eq('id', fp.id)

  if (updateError) {
    throw new Error(`[yoda-score] Cannot update focus_point ${fp.id}: ${updateError.message}`)
  }

  console.log(`[yoda-score] ✓ Applied practice log ${practice_log_id} → FP ${fp.id} (${fp.status} → ${updated.status})`)
}
