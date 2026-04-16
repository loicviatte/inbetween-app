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

// ─── Focus Point auto-publish ─────────────────────────────────────────────────

async function publishExpiredFocusPoints(supabase: any): Promise<void> {
  const now = new Date().toISOString()
  const { data: expired } = await supabase
    .from('focus_points')
    .select('id, user_id, group_fp, source_class_input_id')
    .eq('status', 'pending_coach')
    .lte('coach_review_deadline', now)

  for (const fp of expired ?? []) {
    if (fp.group_fp && fp.source_class_input_id) {
      const { data: cis } = await supabase
        .from('class_input_students')
        .select('student_id, attendance')
        .eq('class_input_id', fp.source_class_input_id)
      const excluded = new Set((cis ?? []).filter((r: any) => r.attendance === 'no').map((r: any) => r.student_id))
      if (excluded.has(fp.user_id)) {
        await supabase.from('focus_points').update({ is_deleted: true, status: 'past' }).eq('id', fp.id)
      } else {
        await supabase.from('focus_points').update({ status: 'active', coach_review_deadline: null }).eq('id', fp.id)
      }
    } else {
      await supabase.from('focus_points').update({ status: 'active', coach_review_deadline: null }).eq('id', fp.id)
    }
  }
  if ((expired ?? []).length > 0) {
    console.log(`[yoda-score] Auto-published ${expired!.length} expired pending_coach FPs`)
  }
}

// ─── class_input event ────────────────────────────────────────────────────────

async function processClassInput(supabase: any, payload: any): Promise<void> {
  const { class_input_id } = payload

  // Auto-publish expired pending_coach FPs before processing new ones
  await publishExpiredFocusPoints(supabase)

  // 1. Load class input (also fetch dance to determine coach category)
  const { data: classInput, error: ciError } = await supabase
    .from('class_inputs')
    .select('id, raw_ai_json, status, dance, lesson_type')
    .eq('id', class_input_id)
    .single()

  if (ciError || !classInput?.raw_ai_json) {
    throw new Error(`[yoda-score] Cannot load class_input ${class_input_id}: ${ciError?.message}`)
  }

  const aiData = classInput.raw_ai_json as any
  const now = new Date()

  // 2. Process each student
  const classDance: string[] = classInput.dance ?? []
  const isGroupClass = classInput.lesson_type === 'public' || classInput.lesson_type === 'group'

  for (const studentJson of aiData.students ?? []) {
    const studentId: string = studentJson.student_id
    if (!studentId) continue

    await processStudentFocusPoints(supabase, studentId, studentJson, class_input_id, classDance, now, isGroupClass)
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

const LATIN_DANCES_TS = ['Cha Cha', 'Samba', 'Rumba', 'Paso Doble', 'Jive']

function coachIdFromRow(row: any, classDance: string[]): string | null {
  const isLatin = classDance.some(d => LATIN_DANCES_TS.includes(d))
  return isLatin ? (row?.latin_coach_id ?? null) : (row?.ballroom_coach_id ?? null)
}

async function processStudentFocusPoints(
  supabase: any,
  studentId: string,
  studentJson: any,
  classInputId: string,
  classDance: string[],
  now: Date,
  isGroupClass: boolean = false,
): Promise<void> {
  // Get the coach linked to the class's dance category
  const { data: studentRow } = await supabase
    .from('users')
    .select('latin_coach_id, ballroom_coach_id, name')
    .eq('id', studentId)
    .single()
  const coachId: string | null = coachIdFromRow(studentRow, classDance)
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
  const decisions: any[] = []

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
            merge_action: 'auto_merge',
          })
          .eq('id', existing.id)
        mentionedFPIds.add(existing.id)
        decisions.push({
          action: 'auto_merge',
          fp_name: fpJson.title,
          existing_fp_name: existing.name,
          existing_fp_id: existing.id,
          reasoning: `AI extraction confirmed identical root cause with '${existing.name}'. Merged automatically.`,
        })
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
          await supabase.from('merge_requests').insert({
            student_id: studentId,
            focus_a: existing.id,
            focus_b: newFP.id,
            status: 'pending_coach',
          })

          // coachId already resolved from classDance above
          if (coachId) {
            await supabase.from('notifications').insert({
              user_id: coachId,
              type: 'merge_request',
              title: 'Possible duplicate focus point',
              body: `"${fpJson.title}" may overlap with an existing focus point for ${studentJson.student_name}.`,
              data: { student_id: studentId, focus_a: existing.id, focus_b: newFP.id },
            })
          }
          mentionedFPIds.add(existing.id)
        }
        decisions.push({
          action: 'merge_request',
          fp_name: fpJson.title,
          existing_fp_name: existing.name,
          existing_fp_id: existing.id,
          reasoning: `Possible overlap with '${existing.name}' — AI was not certain. Sent to coach for review.`,
        })
        console.log(`[yoda-score] Created merge_request for ${existing.id} / student ${studentId}`)
      }
    } else {
      // New focus point — goes to pending_coach for review before publishing to student
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
          coach_review_deadline: new Date(now.getTime() + 18 * 60 * 60 * 1000).toISOString(),
          group_fp: isGroupClass,
          source_class_input_id: classInputId,
          count: 0,
          is_archived: false,
          is_deleted: false,
          is_other: false,
        })
        .select('id')
        .single()

      if (inserted) {
        mentionedFPIds.add(inserted.id)
        decisions.push({
          action: 'create',
          fp_name: fpJson.title,
          tier,
          reasoning: `New concept — no existing match found. Mentioned ${fpJson.mention_count ?? 1} time(s)${fpJson.explicit_priority ? ', marked explicit priority by coach' : ''}.`,
        })
        console.log(`[yoda-score] Created focus_point ${inserted.id} (${fpJson.title}) for ${studentId}`)
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
        if (fpJson.coach_signal === 'positive') {
          decisions.push({
            action: 'signal_positive',
            fp_name: existing.name,
            reasoning: `Coach explicitly signaled positive progress on '${existing.name}'.`,
          })
        } else if (fpJson.coach_signal === 'negative') {
          decisions.push({
            action: 'signal_negative',
            fp_name: existing.name,
            reasoning: `Coach explicitly signaled regression on '${existing.name}'.`,
          })
        }
      }
    }
  }

  // Store decisions for trainer review
  if (decisions.length > 0) {
    const { error: decErr } = await supabase.from('yoda_score_decisions').insert({
      class_input_id: classInputId,
      student_id: studentId,
      student_name: studentName,
      decisions,
      reviewed: false,
    })
    if (decErr) console.error('[yoda-score] score_decisions insert error:', decErr.message)
    else console.log(`[yoda-score] ✓ Stored ${decisions.length} decisions for ${studentId}`)
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
    status: 'past',
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

  // Notify coach only for focus points that were actually created (pending_coach), not merges
  const newFPCount = decisions.filter((d: any) => d.action === 'create').length
  if (newFPCount > 0 && coachId) {
    await supabase.from('notifications').insert({
      user_id: coachId,
      type: 'focus_points_added',
      title: 'New focus points added',
      body: `Yoda added ${newFPCount} focus point${newFPCount > 1 ? 's' : ''} for ${studentName}. Review before they publish to the student.`,
      data: { student_id: studentId, class_input_id: classInputId },
    })
    console.log(`[yoda-score] Notified coach ${coachId} of ${newFPCount} new FPs for ${studentId}`)
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
