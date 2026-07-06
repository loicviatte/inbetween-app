import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  type FocusPoint,
  type Tier,
  STARTING_SCORES,
  TRAIN_TARGET_BY_TIER,
  MERGE_NOTIFY_STUDENT_DAYS,
  RECONCILE_TIER_RANK,
  applyMerge,
  applyPracticeLog,
  autoResolveCarryover,
  focusInCategory,
  dbRowToFocusPoint,
  focusPointToDbUpdate,
} from '../_shared/yoda-score.ts'
import { normalizeFocusName } from '../_shared/normalize.ts'

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
    .select('id, user_id, group_fp, source_class_input_id, class_input_id')
    .eq('status', 'pending_coach')
    .lte('coach_review_deadline', now)

  if (!expired || expired.length === 0) return

  // Admin gate: only publish FPs whose parent class_input is admin-approved.
  // Before approval, the 18h coach window doesn't start; approveClass
  // resets the deadline at approval time so the coach gets a fresh window.
  const classIds: string[] = [
    ...new Set(
      (expired as any[])
        .map((fp) => fp.class_input_id)
        .filter((v: any): v is string => !!v),
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
  const eligible = (expired as any[]).filter(
    (fp) => fp.class_input_id == null || approvedSet.has(fp.class_input_id),
  )

  // Group FPs publish only if the student explicitly confirmed attendance
  // (attendance_responses.attended = true). Pending or missing responses
  // count as "not attended" → soft-delete. Source of truth is
  // attendance_responses, NOT class_input_students.attendance.
  const groupEligible = eligible.filter((fp: any) => fp.group_fp && fp.source_class_input_id)
  const groupClassIds = [...new Set(groupEligible.map((fp: any) => fp.source_class_input_id as string))]
  const groupStudentIds = [...new Set(groupEligible.map((fp: any) => fp.user_id as string))]
  const attendedKeys = new Set<string>()
  if (groupClassIds.length > 0 && groupStudentIds.length > 0) {
    const { data: attendedRows } = await supabase
      .from('attendance_responses')
      .select('class_input_id, student_id')
      .in('class_input_id', groupClassIds)
      .in('student_id', groupStudentIds)
      .eq('attended', true)
    for (const r of (attendedRows ?? []) as any[]) {
      attendedKeys.add(`${r.class_input_id}:${r.student_id}`)
    }
  }

  const publishedStudentIds = new Set<string>()
  for (const fp of eligible) {
    const isGroup = !!(fp.group_fp && fp.source_class_input_id)
    const attended = !isGroup || attendedKeys.has(`${fp.source_class_input_id}:${fp.user_id}`)
    if (!attended) {
      await supabase.from('focus_points').update({ is_deleted: true, status: 'past', coach_review_deadline: null }).eq('id', fp.id)
    } else {
      await supabase.from('focus_points').update({ status: 'active', coach_review_deadline: null }).eq('id', fp.id)
      if (!isGroup) publishedStudentIds.add(fp.user_id)
    }
  }
  if (eligible.length > 0) {
    console.log(`[yoda-score] Auto-published ${eligible.length} expired pending_coach FPs (${expired.length - eligible.length} gated by admin)`)
  }

  // #autoResolve: any student a just-published focus left over 3 active private
  // focuses (because a "not yet" carry-over was never reconciled) is resolved in
  // favour of the carry-over now that the 18h window has closed.
  for (const sid of publishedStudentIds) {
    const dropped = await autoResolveCarryover(supabase, sid)
    if (dropped > 0) console.log(`[yoda-score] 18h auto-resolved carry-over for ${sid}: dropped ${dropped}`)
  }

  // Couple focus points — same 18h auto-publish (no per-dancer attendance).
  const { data: expiredCouple } = await supabase
    .from('couple_focus_points')
    .select('id')
    .eq('status', 'pending_coach')
    .lte('coach_review_deadline', now)
  for (const cfp of expiredCouple ?? []) {
    await supabase.from('couple_focus_points')
      .update({ status: 'active', coach_review_deadline: null })
      .eq('id', cfp.id)
  }
  if ((expiredCouple ?? []).length > 0) {
    console.log(`[yoda-score] Auto-published ${expiredCouple!.length} expired pending_coach couple FPs`)
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
    .select('id, raw_ai_json, status, dance, lesson_type, couple_id')
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

  // 2b. Process shared_focus_points (group-wide drills) — insert one row per student
  // linked by shared_group_id so the coach can aggregate across students.
  const sharedFps = aiData.shared_focus_points ?? []
  if (isGroupClass && sharedFps.length > 0) {
    // Shared focus points are CLASS-WIDE → give them to every attendee (the
    // class_input_students roster), not just the students the AI happened to
    // return. The AI omits students it had nothing individual to say about, so
    // keying off aiData.students silently dropped shared FPs for quiet
    // attendees. Fall back to the AI's list only if the roster is empty.
    const { data: rosterRows } = await supabase
      .from('class_input_students')
      .select('student_id')
      .eq('class_input_id', class_input_id)
    let studentIds: string[] = [
      ...new Set((rosterRows ?? []).map((r: any) => r.student_id).filter((x: string) => !!x)),
    ]
    if (studentIds.length === 0) {
      studentIds = (aiData.students ?? []).map((s: any) => s.student_id).filter((x: string) => !!x)
    }
    // Group classes surface at most 2 shared focus points.
    for (const sfp of sharedFps.slice(0, 2)) {
      const sharedGroupId = crypto.randomUUID()
      const tier = (sfp.tier ?? 'supporting') as Tier
      const sharedDance = (sfp.dance && sfp.dance.length > 0) ? sfp.dance : classDance
      const rows = studentIds.map((sid) => ({
        user_id: sid,
        name: sfp.title,
        normalized_name: normalizeFocusName(sfp.title),
        subtitle: sfp.subtitle ?? null,
        context: sfp.context ?? null,
        dance: sharedDance,
        drill: sfp.drill ?? null,
        tier,
        category: sfp.category ?? null,
        base_score: STARTING_SCORES[tier],
        train_target: TRAIN_TARGET_BY_TIER[tier],
        mention_count: sfp.mention_count ?? 0,
        explicit_priority: sfp.explicit_priority ?? false,
        first_timestamp: sfp.timestamp ?? null,
        last_mentioned_at: now.toISOString(),
        class_input_id: class_input_id,
        source_class_input_id: class_input_id,
        status: 'pending_coach',
        coach_review_deadline: new Date(now.getTime() + 18 * 60 * 60 * 1000).toISOString(),
        group_fp: true,
        shared_group_id: sharedGroupId,
        count: 0,
        is_archived: false,
        is_deleted: false,
        is_other: false,
      }))
      const { error: sharedErr } = await supabase.from('focus_points').insert(rows)
      if (sharedErr) {
        console.error(`[yoda-score] shared_focus_points insert error:`, sharedErr.message)
      } else {
        console.log(`[yoda-score] Created shared focus point ${sfp.title} (group ${sharedGroupId}) for ${studentIds.length} students`)
      }
    }
  }

  // 2c. Couple lesson — shared_focus_points belong to the COUPLE (one row in
  // couple_focus_points, keyed by couple_id). Per-dancer focus_points were
  // already inserted above via processStudentFocusPoints (solo, unchanged).
  const isCoupleClass = classInput.lesson_type === 'couple'
  if (isCoupleClass && classInput.couple_id && sharedFps.length > 0) {
    let coupleCreated = 0
    for (const sfp of sharedFps) {
      const tier = (sfp.tier ?? 'supporting') as Tier
      const sharedDance = (sfp.dance && sfp.dance.length > 0) ? sfp.dance : classDance
      const norm = normalizeFocusName(sfp.title)

      // Dedup: if the couple already has a focus with this name (any non-past
      // status), re-anchor + bump it instead of creating a duplicate row.
      const { data: dup } = await supabase
        .from('couple_focus_points')
        .select('id, mention_count')
        .eq('couple_id', classInput.couple_id)
        .eq('normalized_name', norm)
        .eq('is_other', false)
        .neq('status', 'past')
        .limit(1)
        .maybeSingle()
      if (dup) {
        await supabase.from('couple_focus_points').update({
          last_mentioned_at: now.toISOString(),
          class_input_id: class_input_id,
          mention_count: (dup.mention_count || 0) + (sfp.mention_count ?? 1),
          lessons_since_mentioned: 0,
        }).eq('id', dup.id)
        console.log(`[yoda-score] Merged duplicate couple FP "${sfp.title}" into ${dup.id}`)
        continue
      }

      const { error: cErr } = await supabase.from('couple_focus_points').insert({
        couple_id: classInput.couple_id,
        name: sfp.title,
        normalized_name: norm,
        subtitle: sfp.subtitle ?? null,
        context: sfp.context ?? null,
        dance: sharedDance,
        drill: sfp.drill ?? null,
        tier,
        category: sfp.category ?? null,
        base_score: STARTING_SCORES[tier],
        train_target: TRAIN_TARGET_BY_TIER[tier],
        mention_count: sfp.mention_count ?? 0,
        explicit_priority: sfp.explicit_priority ?? false,
        first_timestamp: sfp.timestamp ?? null,
        last_mentioned_at: now.toISOString(),
        class_input_id: class_input_id,
        source_class_input_id: class_input_id,
        // Couple FP go through coach review like solo: pending_coach until the
        // couple-coach approves (or the 18h deadline auto-publishes them).
        status: 'pending_coach',
        coach_review_deadline: new Date(now.getTime() + 18 * 60 * 60 * 1000).toISOString(),
        is_deleted: false,
        is_other: false,
      })
      if (cErr) {
        console.error(`[yoda-score] couple_focus_points insert error:`, cErr.message)
      } else {
        coupleCreated++
        console.log(`[yoda-score] Created couple focus point ${sfp.title} for couple ${classInput.couple_id}`)
      }
    }
    // Batched: notify the couple coach(es) once to review (parity with solo's
    // focus_points_added). One push per class, not one per focus point.
    if (coupleCreated > 0) {
      const { data: cpl } = await supabase
        .from('couples')
        .select('latin_couple_coach_id, ballroom_couple_coach_id')
        .eq('id', classInput.couple_id)
        .single()
      const coachIds = [...new Set([cpl?.latin_couple_coach_id, cpl?.ballroom_couple_coach_id].filter(Boolean))]
      for (const cid of coachIds) {
        await supabase.from('notifications').insert({
          user_id: cid,
          type: 'focus_points_added',
          title: 'New couple focus points',
          body: `${coupleCreated} new couple focus point${coupleCreated > 1 ? 's' : ''}. Review before they publish.`,
          data: { couple_id: classInput.couple_id, class_input_id: class_input_id },
        })
      }
      console.log(`[yoda-score] Notified ${coachIds.length} couple coach(es) of ${coupleCreated} new couple FPs`)
    }
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

// Marker dances used when a focus point would otherwise be inserted with an
// empty dance list. Stored as a single-element array so it pills cleanly and
// so categoryFromDances() routes it into the right Latin/Ballroom ranking.
const LATIN_FALLBACK = ['Cha Cha']
const BALLROOM_FALLBACK = ['Waltz']

function fallbackDanceForCoachStyle(danceStyle: string | null | undefined): string[] {
  const ds = (danceStyle ?? '').toLowerCase()
  if (ds === 'latin') return LATIN_FALLBACK
  if (ds === 'ballroom' || ds === 'standard') return BALLROOM_FALLBACK
  return []
}

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

  // Resolve default dance new FPs will inherit when neither the AI nor the
  // class supplies one. Falls back to the reviewing coach's dance_style.
  let defaultDance: string[] = classDance
  if (defaultDance.length === 0 && coachId) {
    const { data: coachRow } = await supabase
      .from('users')
      .select('dance_style')
      .eq('id', coachId)
      .single()
    defaultDance = fallbackDanceForCoachStyle(coachRow?.dance_style)
  }

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
        const existingRow = rows?.find(r => r.id === existing.id)
        const updated = applyMerge(existing)
        // Re-anchor class_input_id to the class that just re-addressed this
        // focus so the readiness card sees it as belonging to the current
        // private. source_class_input_id preserves the original creation
        // class (initialised on first auto-merge for legacy rows where it
        // was never set).
        const preservedSource =
          existingRow?.source_class_input_id ?? existingRow?.class_input_id ?? classInputId
        await supabase
          .from('focus_points')
          .update({
            ...focusPointToDbUpdate(updated),
            last_mentioned_at: now.toISOString(),
            merge_action: 'auto_merge',
            source_class_input_id: preservedSource,
            class_input_id: classInputId,
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
            normalized_name: normalizeFocusName(fpJson.title),
            subtitle: fpJson.subtitle ?? null,
            context: fpJson.context ?? null,
            dance: (fpJson.dance && fpJson.dance.length > 0) ? fpJson.dance : defaultDance,
            drill: fpJson.drill ?? null,
            tier,
            category: fpJson.category ?? null,
            base_score: STARTING_SCORES[tier],
        train_target: TRAIN_TARGET_BY_TIER[tier],
            mention_count: fpJson.mention_count ?? 0,
            explicit_priority: fpJson.explicit_priority ?? false,
            first_timestamp: fpJson.timestamp ?? null,
            last_mentioned_at: now.toISOString(),
            class_input_id: classInputId,
            source_class_input_id: classInputId,
            status: 'pending_coach',
            coach_review_deadline: new Date(now.getTime() + 18 * 60 * 60 * 1000).toISOString(),
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
          normalized_name: normalizeFocusName(fpJson.title),
          subtitle: fpJson.subtitle ?? null,
          context: fpJson.context ?? null,
          dance: (fpJson.dance && fpJson.dance.length > 0) ? fpJson.dance : defaultDance,
          drill: fpJson.drill ?? null,
          tier,
          category: fpJson.category ?? null,
          base_score: STARTING_SCORES[tier],
        train_target: TRAIN_TARGET_BY_TIER[tier],
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

    // (Coach-signal handling removed: tier is target-count only — a coach
    // signal no longer moves any score or lifecycle, so the AI's coach_signal
    // hint is ignored.)
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
    normalized_name: normalizeFocusName(ofp.title),
    dance: (ofp.dance && ofp.dance.length > 0) ? ofp.dance : defaultDance,
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

  // (No cap-to-3 and no score-based retirement: focus points stay active until
  // the coach validates/rejects or the student archives. Tier is target-count only.)

  // Notify coach only for focus points that were actually created (pending_coach), not merges
  const newFPCount = decisions.filter((d: any) => d.action === 'create').length
  if (newFPCount > 0 && coachId) {
    await supabase.from('notifications').insert({
      user_id: coachId,
      type: 'focus_points_added',
      title: 'New focus points added',
      body: `${newFPCount} new focus point${newFPCount > 1 ? 's' : ''} for ${studentName}. Review before they publish to the student.`,
      data: { student_id: studentId, class_input_id: classInputId },
    })
    console.log(`[yoda-score] Notified coach ${coachId} of ${newFPCount} new FPs for ${studentId}`)
  }

  // Reconciliation (private lessons only): a "not yet" carry-over from the last
  // debrief plus this class's new focuses can push the student past 3 — checked
  // PER dance category (handles tagged + untagged classes).
  if (!isGroupClass && newFPCount > 0) {
    await reconcilePrivateFocusPoints(supabase, studentId, classInputId, coachId, studentName)
  }

  // (Steps d/e/f removed: no lessons_since_mentioned increment, no score-based
  // state transitions, and no inaction sweep. A focus point never decays from
  // score/practice/inaction — only the coach or the student change its status.)
}

// ─── Reconciliation: keep a student at ≤3 active private focuses per category ──
// After a private class creates new focuses, a "not yet" carry-over from the
// last debrief (is_held=true, active) can push the student over 3:
//   • carry-over is critical/important → SILENT auto: it outranks a new
//     supporting, so drop the lowest-ranked new focus(es) down to 3. No notif.
//   • carry-over is only supporting → the coach must choose which to keep
//     (ReconcileFocusSheet). Notify once; if they don't act, the 18h publish
//     auto-resolves in favour of the carry-over (see autoResolveCarryover).
// Checked PER dance category (untagged focuses count in both, focusInCategory).
// A category only acts if THIS class created fresh focuses in it, so e.g. a Latin
// class never reconciles Ballroom — and an UNTAGGED class is handled correctly
// (each category evaluated independently, never merged into one bucket).
// Group/couple classes are out of scope (own ≤2 caps; couple reconcile is not
// surfaced client-side yet). Merge candidates are left to the merge flow.
async function reconcilePrivateFocusPoints(
  supabase: any,
  studentId: string,
  classInputId: string,
  coachId: string | null,
  studentName: string,
): Promise<void> {
  const { data: rows } = await supabase
    .from('focus_points')
    .select('id, tier, status, is_held, class_input_id, created_at, merge_candidate_id, dance')
    .eq('user_id', studentId)
    .eq('is_other', false)
    .eq('is_deleted', false)
    .or('group_fp.is.null,group_fp.eq.false')
    .in('status', ['active', 'pending_coach'])

  const all = (rows ?? []) as any[]
  const droppedIds = new Set<string>()
  let notifyNeeded = false

  for (const category of ['latin', 'ballroom'] as const) {
    const fps = all.filter((f) => !droppedIds.has(f.id) && focusInCategory(f.dance, category))
    if (fps.length <= 3) continue
    const carried = fps.filter((f) => f.is_held === true && f.status === 'active')
    if (carried.length === 0) continue // >3 without a carry-over isn't a reconcile case
    const fresh = fps.filter(
      (f) => f.status === 'pending_coach' && f.class_input_id === classInputId && !f.merge_candidate_id,
    )
    if (fresh.length === 0) continue // this class added nothing in this category

    const topCarriedRank = Math.min(...carried.map((f) => RECONCILE_TIER_RANK[f.tier] ?? 2))
    const keepFresh = Math.max(0, 3 - carried.length)
    // Lowest-ranked new focuses (supporting first, then newest) to drop to reach 3.
    const dropCandidates = [...fresh]
      .sort((a, b) =>
        (RECONCILE_TIER_RANK[b.tier] ?? 2) - (RECONCILE_TIER_RANK[a.tier] ?? 2)
        || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, fresh.length - keepFresh)

    // SILENT auto-resolve only when (a) the carry-over outranks (critical/important),
    // (b) keeping every carry-over still leaves room (≤3), AND (c) the dropped
    // focuses are ALL supporting — the spec auto-drops "the new supporting" only.
    const allDroppedSupporting = dropCandidates.length > 0
      && dropCandidates.every((f) => (RECONCILE_TIER_RANK[f.tier] ?? 2) >= 2)
    if (topCarriedRank <= 1 && carried.length <= 3 && allDroppedSupporting) {
      for (const f of dropCandidates) droppedIds.add(f.id)
    } else {
      notifyNeeded = true // coach must choose (ReconcileFocusSheet)
    }
  }

  if (droppedIds.size > 0) {
    await supabase
      .from('focus_points')
      .update({ status: 'past', coach_review_deadline: null })
      .in('id', [...droppedIds])
    console.log(`[yoda-score] Auto-reconciled ${droppedIds.size} new supporting FP(s) for ${studentId} (carry-over outranks)`)
  }

  // Notify ONCE if any category needs a manual pick — skip if an unread reconcile
  // notification for this student already exists.
  if (notifyNeeded && coachId) {
    const { data: existing } = await supabase
      .from('notifications')
      .select('id')
      .eq('user_id', coachId)
      .eq('type', 'focus_reconcile_needed')
      .eq('read', false)
      .contains('data', { student_id: studentId })
      .limit(1)
      .maybeSingle()
    if (!existing) {
      await supabase.from('notifications').insert({
        user_id: coachId,
        type: 'focus_reconcile_needed',
        title: 'Too many focus points',
        body: `${studentName} has more than 3 focus points after carrying one over. Pick which to keep.`,
        data: { student_id: studentId, class_input_id: classInputId },
      })
      console.log(`[yoda-score] Notified coach ${coachId} to reconcile ${studentName}`)
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

  // 3. Apply practice log (advances the X/N train count only — no score/decay)
  const updated = applyPracticeLog(fp, {
    focus_point_id: log.focus_point_id,
    duration_minutes: log.duration_minutes,
    rating: log.rating,
  })

  // 4. Update focus point in DB
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
