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

  for (const fp of eligible) {
    const isGroup = !!(fp.group_fp && fp.source_class_input_id)
    const attended = !isGroup || attendedKeys.has(`${fp.source_class_input_id}:${fp.user_id}`)
    if (!attended) {
      await supabase.from('focus_points').update({ is_deleted: true, status: 'past', coach_review_deadline: null }).eq('id', fp.id)
    } else {
      await supabase.from('focus_points').update({ status: 'active', coach_review_deadline: null }).eq('id', fp.id)
    }
  }
  if (eligible.length > 0) {
    console.log(`[yoda-score] Auto-published ${eligible.length} expired pending_coach FPs (${expired.length - eligible.length} gated by admin)`)
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
    const studentIds: string[] = (aiData.students ?? [])
      .map((s: any) => s.student_id)
      .filter((x: string) => !!x)
    for (const sfp of sharedFps) {
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
          body: `Yoda added ${coupleCreated} couple focus point${coupleCreated > 1 ? 's' : ''}. Review before they publish.`,
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

  // ── CAP TO 3 ACTIVE PER STUDENT PER CLASS ────────────────────────────────────
  // Keep only the 3 most important new FPs from this class in pending_coach/
  // active state. Demote the rest to 'past' (they stay in the audit trail for
  // the feedback loop). Ranking: tier > explicit_priority > base_score >
  // mention_count > created_at desc.
  {
    const { data: classFps } = await supabase
      .from('focus_points')
      .select('id, tier, status, explicit_priority, base_score, mention_count, created_at, name')
      .eq('user_id', studentId)
      .eq('class_input_id', classInputId)
      .eq('is_deleted', false)
      .eq('is_archived', false)
      .in('status', ['pending_coach', 'active'])

    if (classFps && classFps.length > 3) {
      const tierRank: Record<string, number> = { critical: 1, important: 2, supporting: 3 }
      const sorted = [...classFps].sort((a: any, b: any) => {
        const tA = tierRank[a.tier] ?? 4
        const tB = tierRank[b.tier] ?? 4
        if (tA !== tB) return tA - tB
        const epA = a.explicit_priority ? 1 : 0
        const epB = b.explicit_priority ? 1 : 0
        if (epA !== epB) return epB - epA
        const bsA = a.base_score ?? 0
        const bsB = b.base_score ?? 0
        if (bsA !== bsB) return bsB - bsA
        const mcA = a.mention_count ?? 0
        const mcB = b.mention_count ?? 0
        if (mcA !== mcB) return mcB - mcA
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
      const toDemote = sorted.slice(3) as any[]
      for (const fp of toDemote) {
        await supabase
          .from('focus_points')
          .update({ status: 'past', coach_review_deadline: null })
          .eq('id', fp.id)
      }
      console.log(
        `[yoda-score] cap-to-3: kept ${sorted.slice(0, 3).map((f: any) => f.name).join(', ')}; demoted ${toDemote.length} for student ${studentId}`,
      )
    }
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
