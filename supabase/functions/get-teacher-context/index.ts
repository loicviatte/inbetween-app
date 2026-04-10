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

  if (coachId) {
    const { data: knowledge } = await serviceClient
      .from('coach_knowledge')
      .select('type, content')
      .eq('coach_id', coachId)
      .order('created_at', { ascending: false })

    coachKnowledge = knowledge ?? []
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
