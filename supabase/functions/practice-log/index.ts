import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 })
  }

  const { focus_point_id, duration_minutes, rating, student_id } = body

  if (!focus_point_id || !duration_minutes || !rating || !student_id) {
    return new Response(
      JSON.stringify({ error: 'focus_point_id, duration_minutes, rating, student_id are required' }),
      { status: 400 },
    )
  }

  const validRatings = ['hard', 'struggled', 'okay', 'good', 'great']
  if (!validRatings.includes(rating)) {
    return new Response(
      JSON.stringify({ error: `rating must be one of: ${validRatings.join(', ')}` }),
      { status: 400 },
    )
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // 1. Insert practice log
  const { data: newLog, error: insertError } = await supabase
    .from('practice_logs')
    .insert({ focus_point_id, duration_minutes, rating, student_id })
    .select('id')
    .single()

  if (insertError || !newLog) {
    console.error('[practice-log] Insert error:', insertError?.message)
    return new Response(JSON.stringify({ error: insertError?.message ?? 'Insert failed' }), { status: 500 })
  }

  // 2. Invoke yoda-score to update the focus point scores
  const { error: scoreError } = await supabase.functions.invoke('yoda-score', {
    body: {
      event: 'practice_log',
      student_id,
      practice_log_id: newLog.id,
    },
  })

  if (scoreError) {
    console.error('[practice-log] yoda-score error:', scoreError.message)
    // Non-fatal: log was inserted, scoring will be retried or fixed manually
  }

  // 3. Return updated focus point
  const { data: fp, error: fpError } = await supabase
    .from('focus_points')
    .select('id, name, subtitle, tier, status, base_score, practice_count')
    .eq('id', focus_point_id)
    .single()

  if (fpError) {
    return new Response(JSON.stringify({ ok: true, log_id: newLog.id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true, log_id: newLog.id, focus_point: fp }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
