import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare global {
  const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }
}

const STARTING_SCORES: Record<string, number> = { critical: 10, important: 7, supporting: 5 }

Deno.serve(async (req: Request) => {
  console.log('[attendance-response] Invoked — method:', req.method, 'headers:', JSON.stringify(Object.fromEntries(req.headers)))

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Kong already verified the JWT signature — decode payload directly
  const jwt = authHeader.replace('Bearer ', '')
  let studentId: string
  try {
    const payloadB64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(payloadB64))
    if (!payload?.sub) throw new Error('No sub')
    studentId = payload.sub
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 })
  }

  const { class_input_id, attended } = body
  if (!class_input_id || typeof attended !== 'boolean') {
    return new Response(JSON.stringify({ error: 'Missing or invalid fields: class_input_id, attended (boolean)' }), { status: 400 })
  }

  EdgeRuntime.waitUntil(processResponse(supabase, studentId, class_input_id, attended))

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})

async function processResponse(
  supabase: ReturnType<typeof createClient>,
  studentId: string,
  classInputId: string,
  attended: boolean,
): Promise<void> {
  // 1. Record attendance response (upsert in case of re-submission)
  const { error: insertErr } = await supabase
    .from('attendance_responses')
    .upsert(
      { class_input_id: classInputId, student_id: studentId, attended, responded_at: new Date().toISOString() },
      { onConflict: 'class_input_id,student_id' },
    )
  if (insertErr) {
    console.error('[attendance-response] Failed to insert attendance_response:', insertErr.message)
    return
  }

  if (!attended) {
    // Soft-delete any FPs previously assigned to this student from this class.
    // Idempotent: if there are none (first-time "no" answer), this is a no-op.
    // Covers the case where a student switches their answer from yes → no after
    // FPs were already assigned by an earlier branch of this function.
    const { error: delErr, count } = await supabase
      .from('focus_points')
      .update({ is_deleted: true }, { count: 'exact' })
      .eq('source_class_input_id', classInputId)
      .eq('user_id', studentId)
      .eq('is_deleted', false)
    if (delErr) {
      console.error('[attendance-response] Failed to soft-delete FPs on yes→no switch:', delErr.message)
    } else if (count && count > 0) {
      console.log(`[attendance-response] ✓ Soft-deleted ${count} previously assigned FPs for student ${studentId} (class ${classInputId})`)
    } else {
      console.log(`[attendance-response] Student ${studentId} did not attend class ${classInputId} — nothing to assign`)
    }
    return
  }

  // 2. Load student name for matching
  const { data: studentRow } = await supabase
    .from('users')
    .select('name')
    .eq('id', studentId)
    .single()
  const studentName: string = (studentRow?.name ?? '').toLowerCase().trim()

  // 3. Load student's recently completed FPs (last 3 weeks) to avoid duplicates
  const threeWeeksAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString()
  const { data: recentlyCompleted } = await supabase
    .from('focus_points')
    .select('normalized_name')
    .eq('user_id', studentId)
    .eq('status', 'past')
    .gte('updated_at', threeWeeksAgo)
  const completedNames = new Set((recentlyCompleted ?? []).map((fp: any) => fp.normalized_name))

  // 4. Load all unassigned FPs for this class (both shared and individual)
  const { data: classFPs, error: fpErr } = await supabase
    .from('focus_points')
    .select('*')
    .eq('source_class_input_id', classInputId)
    .is('user_id', null)
    .eq('is_deleted', false)
  if (fpErr) {
    console.error('[attendance-response] Failed to load class FPs:', fpErr.message)
    return
  }

  const now = new Date()
  const deadline = new Date(now.getTime() + 18 * 60 * 60 * 1000).toISOString()

  // 5. Handle shared FPs — duplicate for student (filter recently completed)
  const sharedFPs = (classFPs ?? []).filter((fp: any) => fp.is_shared === true)
  const sharedToInsert = sharedFPs.filter((fp: any) => !completedNames.has(fp.normalized_name))

  if (sharedToInsert.length > 0) {
    const sharedRows = sharedToInsert.map((fp: any) => ({
      user_id: studentId,
      is_shared: true,
      group_fp: true,
      source_class_input_id: classInputId,
      class_input_id: classInputId,
      name: fp.name,
      normalized_name: fp.normalized_name,
      subtitle: fp.subtitle ?? null,
      context: fp.context ?? null,
      dance: fp.dance ?? [],
      drill: fp.drill ?? null,
      tier: fp.tier ?? 'supporting',
      base_score: STARTING_SCORES[fp.tier ?? 'supporting'] ?? 5,
      mention_count: fp.mention_count ?? 0,
      explicit_priority: fp.explicit_priority ?? false,
      first_timestamp: fp.first_timestamp ?? null,
      last_mentioned_at: now.toISOString(),
      status: 'pending_coach',
      coach_review_deadline: deadline,
      count: 0,
      is_archived: false,
      is_deleted: false,
      is_other: false,
    }))
    const { error } = await supabase.from('focus_points').insert(sharedRows)
    if (error) console.error('[attendance-response] Failed to insert shared FPs for student:', error.message)
    else console.log(`[attendance-response] ✓ Assigned ${sharedRows.length} shared FPs to student ${studentId}`)
  }

  // 6. Handle individual FPs — match extracted_name against student name and assign
  const individualFPs = (classFPs ?? []).filter((fp: any) => fp.is_shared === false && fp.extracted_name)

  // Split into exact and fuzzy matches
  const exactMatches: any[] = []
  const fuzzyMatches: any[] = []

  for (const fp of individualFPs) {
    const extracted = (fp.extracted_name ?? '').toLowerCase().trim()
    if (extracted === studentName) {
      exactMatches.push(fp)
    } else if (studentName.includes(extracted) || extracted.includes(studentName)) {
      fuzzyMatches.push(fp)
    }
  }

  // Assign exact matches directly (pending_coach)
  if (exactMatches.length > 0) {
    const exactIds = exactMatches.map((fp: any) => fp.id)
    const { error } = await supabase
      .from('focus_points')
      .update({
        user_id: studentId,
        status: 'pending_coach',
        coach_review_deadline: deadline,
        matched_at: now.toISOString(),
        last_mentioned_at: now.toISOString(),
      })
      .in('id', exactIds)
    if (error) console.error('[attendance-response] Failed to assign exact FPs:', error.message)
    else console.log(`[attendance-response] ✓ Assigned ${exactIds.length} exact-match FPs to student ${studentId}`)
  }

  // Handle fuzzy matches — assign but require coach confirmation
  if (fuzzyMatches.length > 0) {
    const fuzzyIds = fuzzyMatches.map((fp: any) => fp.id)
    const { error } = await supabase
      .from('focus_points')
      .update({
        user_id: studentId,
        status: 'pending_name_confirm',
        coach_review_deadline: deadline,
        matched_at: now.toISOString(),
        last_mentioned_at: now.toISOString(),
      })
      .in('id', fuzzyIds)
    if (error) console.error('[attendance-response] Failed to assign fuzzy FPs:', error.message)
    else {
      console.log(`[attendance-response] ✓ Assigned ${fuzzyIds.length} fuzzy-match FPs to student ${studentId} (pending name confirmation)`)

      // Notify coach to confirm name match
      const { data: classInput } = await supabase
        .from('class_inputs')
        .select('user_id')
        .eq('id', classInputId)
        .single()

      if (classInput?.user_id) {
        await supabase.from('notifications').insert({
          user_id: classInput.user_id,
          type: 'name_match_confirm',
          title: 'Confirm student name match',
          body: `"${fuzzyMatches[0].extracted_name}" confirmed attendance. Is this ${studentName}? Confirm to assign their ${fuzzyIds.length} focus point${fuzzyIds.length > 1 ? 's' : ''}.`,
          data: {
            student_id: studentId,
            extracted_name: fuzzyMatches[0].extracted_name,
            student_name: studentName,
            class_input_id: classInputId,
            focus_point_ids: fuzzyIds,
          },
        })
        console.log(`[attendance-response] Notified coach to confirm name match for "${fuzzyMatches[0].extracted_name}" → ${studentName}`)
      }
    }
  } else if (exactMatches.length === 0 && studentName) {
    console.log(`[attendance-response] No individual FPs matched for student "${studentName}" in class ${classInputId}`)
  }
}
