import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Auth check
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  const jwt = authHeader.slice(7)

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // The coach's knowledge base is the one thing here that belongs to somebody
  // other than the caller, and the only isolation was this file filtering on
  // coach_id. A one-line mistake would hand a student another coach's material.
  // It is read through the caller's own JWT instead, so Postgres enforces the
  // boundary (coach_knowledge_select: your own rows, or those of the coach you
  // are linked to) and the code filter becomes the second line of defence
  // rather than the only one.
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  )

  // Verify JWT and get student id
  const { data: { user }, error: authError } = await serviceClient.auth.getUser(jwt)
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  const studentId = user.id

  const LATIN_DANCES = ['Cha Cha', 'Samba', 'Rumba', 'Paso Doble', 'Jive']

  // ── 1. Get student profile ────────────────────────────────────────────────────
  const { data: studentProfile } = await serviceClient
    .from('users')
    .select('id, name, latin_coach_id, ballroom_coach_id')
    .eq('id', studentId)
    .single()

  const studentName: string = studentProfile?.name ?? 'the student'

  // ── 1b. Determine relevant coach from the most recent class's dance ───────────
  const { data: lastClass } = await serviceClient
    .from('class_inputs')
    .select('dance')
    .eq('user_id', studentId)
    .not('is_deleted', 'is', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let coachId: string | null = null
  if (lastClass?.dance && lastClass.dance.length > 0) {
    const isLatin = lastClass.dance.some((d: string) => LATIN_DANCES.includes(d))
    coachId = isLatin
      ? (studentProfile?.latin_coach_id ?? studentProfile?.ballroom_coach_id ?? null)
      : (studentProfile?.ballroom_coach_id ?? studentProfile?.latin_coach_id ?? null)
  } else {
    // No recent class — use whichever coach is linked
    coachId = studentProfile?.latin_coach_id ?? studentProfile?.ballroom_coach_id ?? null
  }

  // ── 2. Get coach profile (name) ───────────────────────────────────────────────
  let coachName: string | null = null
  if (coachId) {
    const { data: coachProfile } = await serviceClient
      .from('users')
      .select('name')
      .eq('id', coachId)
      .single()
    coachName = coachProfile?.name ?? null
  }

  // ── 3. Student's own class inputs (full data + transcripts) ──────────────────
  const { data: studentClassInputs } = await serviceClient
    .from('class_inputs')
    .select('id, created_at, title, class_summary, practice_point_1, priority_score_1, practice_point_2, priority_score_2, ai_primary_focus, ai_secondary_focus, transcript, raw_ai_json, dance, teacher_name, lesson_type, student_ids')
    .eq('user_id', studentId)
    .not('is_deleted', 'is', true)
    .order('created_at', { ascending: false })
    .limit(20)

  // ── 4. Group lessons where student appears in student_ids ────────────────────
  const { data: groupClassInputs } = await serviceClient
    .from('class_inputs')
    .select('id, created_at, title, class_summary, practice_point_1, priority_score_1, practice_point_2, priority_score_2, ai_primary_focus, ai_secondary_focus, transcript, raw_ai_json, dance, teacher_name, lesson_type, student_ids')
    .contains('student_ids', [studentId])
    .neq('user_id', studentId)
    .not('is_deleted', 'is', true)
    .order('created_at', { ascending: false })
    .limit(10)

  // ── 5. Student's focus points (full data) ────────────────────────────────────
  const { data: focusPoints } = await serviceClient
    .from('focus_points')
    .select('id, name, normalized_name, tier, status, coach_note, drill, base_score, coach_signal, practice_count, last_mentioned_at, lessons_since_mentioned')
    .eq('user_id', studentId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })

  // ── 6. Coach knowledge base (principles, tips, metaphors, drills) ─────────────
  let coachKnowledge: { type: string; content: string }[] = []

  // Only a coach this student is actually linked to — resolved from the
  // student's own row above, and re-stated here so a future edit to the dance
  // routing can't widen it by accident.
  const linkedCoachIds = [studentProfile?.latin_coach_id, studentProfile?.ballroom_coach_id].filter(Boolean)
  if (coachId && linkedCoachIds.includes(coachId)) {
    const { data: knowledge, error: knowledgeError } = await userClient
      .from('coach_knowledge')
      .select('type, content')
      .eq('coach_id', coachId)
      .order('created_at', { ascending: false })
    if (knowledgeError) {
      // RLS said no, or the read failed: answer without the knowledge base
      // rather than reaching around it with the service role. The assistant's
      // own rules turn an empty base into "ask your coach" (see rule 3 of the
      // system prompt in FocusSessionScreen).
      console.warn('[get-teacher-context] coach_knowledge denied:', knowledgeError.message)
    }
    coachKnowledge = knowledge ?? []
  } else if (coachId) {
    console.warn(`[get-teacher-context] coach ${coachId} is not linked to student ${studentId} — knowledge withheld`)
  }

  // ── 7. Return ─────────────────────────────────────────────────────────────────
  return new Response(
    JSON.stringify({
      studentName,
      coachName,
      focusPoints: focusPoints ?? [],
      studentClassInputs: [
        ...(studentClassInputs ?? []),
        ...(groupClassInputs ?? []),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
      coachKnowledge,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
