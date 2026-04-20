import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare global {
  const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }
}

const LATIN_DANCES = ['Cha Cha', 'Samba', 'Rumba', 'Paso Doble', 'Jive']
const REVIEW_WINDOW_MS = 18 * 60 * 60 * 1000

function urgencyToTier(score: number | null | undefined): 'critical' | 'important' | 'supporting' {
  const s = score ?? 5
  if (s >= 8) return 'critical'
  if (s >= 5) return 'important'
  return 'supporting'
}

function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

interface FocusPayload {
  name: string | null
  subtitle?: string | null
  context?: string | null
  priority_score: number | null
  drill: string | null
}

interface Payload {
  class_input_id: string
  focuses: FocusPayload[]
}

Deno.serve(async (req: Request) => {
  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    await process(supabase, payload)
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[student-class-score] Error:', msg)
    return new Response(JSON.stringify({ error: msg }), { status: 500 })
  }
})

async function process(supabase: any, payload: Payload): Promise<void> {
  const { class_input_id, focuses } = payload

  const { data: ci, error: ciErr } = await supabase
    .from('class_inputs')
    .select('id, user_id, dance, teacher_name, created_at')
    .eq('id', class_input_id)
    .single()

  if (ciErr || !ci) {
    throw new Error(`Cannot load class_input ${class_input_id}: ${ciErr?.message}`)
  }

  const studentId: string = ci.user_id
  const { data: studentRow } = await supabase
    .from('users')
    .select('latin_coach_id, ballroom_coach_id, name')
    .eq('id', studentId)
    .single()

  // Parse dance — stored as comma-separated string in this flow
  const danceList: string[] =
    typeof ci.dance === 'string'
      ? ci.dance.split(',').map((s: string) => s.trim()).filter(Boolean)
      : Array.isArray(ci.dance)
        ? ci.dance
        : []

  // Determine coach. Priority: teacher_name match (via coach_requests) →
  //   dance category columns → any accepted coach → any linked coach column.
  let coachId: string | null = null

  // Load all accepted coach_requests for this student (source of truth for link)
  const { data: acceptedReqs } = await supabase
    .from('coach_requests')
    .select('coach_id, coach:coach_id(id, name)')
    .eq('student_id', studentId)
    .eq('status', 'accepted')

  const linkedCoaches: Array<{ id: string; name: string | null }> = (acceptedReqs ?? [])
    .map((r: any) => {
      const c = Array.isArray(r.coach) ? r.coach[0] : r.coach
      return c ? { id: c.id, name: c.name } : null
    })
    .filter(Boolean) as Array<{ id: string; name: string | null }>

  // Resolve which coach (if any) should review the focus points from this
  // class. Two cases:
  //
  // (A) The student typed a teacher_name. We ONLY attribute the class to a
  //     coach when that name matches one of the student's linked coaches.
  //     If the typed teacher is not on the app (no match), we leave coachId
  //     null on purpose — the student logged a class with an external
  //     teacher, so there is nobody to validate the focus points and they
  //     must publish straight to the student (status=active below).
  //
  // (B) No teacher_name typed (system-created class etc.) — fall back to
  //     the dance-style based linked coach so their primary coach reviews.
  if (ci.teacher_name) {
    const tn = ci.teacher_name.trim().toLowerCase()
    const hit = linkedCoaches.find((c) => (c.name ?? '').trim().toLowerCase() === tn)
    if (hit) coachId = hit.id
    // No fallback when teacher_name is set but doesn't match — external teacher.
  } else {
    const isLatin = danceList.some((d) => LATIN_DANCES.includes(d))
    coachId = isLatin ? (studentRow?.latin_coach_id ?? null) : (studentRow?.ballroom_coach_id ?? null)
    if (!coachId && linkedCoaches.length === 1) {
      coachId = linkedCoaches[0].id
    }
    if (!coachId) {
      coachId = studentRow?.latin_coach_id ?? studentRow?.ballroom_coach_id ?? null
    }
  }

  const { data: existing } = await supabase
    .from('focus_points')
    .select('id, name, normalized_name, count, tier, base_score, drill, status, subtitle, context')
    .eq('user_id', studentId)
    .eq('is_deleted', false)
    .eq('is_archived', false)
    .neq('status', 'past')

  const existingMap = new Map<string, any>()
  for (const p of existing ?? []) existingMap.set(p.normalized_name, p)

  const now = new Date()
  const deadline = new Date(now.getTime() + REVIEW_WINDOW_MS).toISOString()
  const targetStatus = coachId ? 'pending_coach' : 'active'

  console.log(
    `[student-class-score] class=${class_input_id} student=${studentId} coach=${coachId} ` +
      `teacher_name="${ci.teacher_name ?? ''}" dance=${JSON.stringify(danceList)} focuses=${focuses.length}`,
  )

  const touchedNames: string[] = []

  for (const fp of focuses) {
    if (!fp.name) continue
    const norm = normalize(fp.name)
    const tier = urgencyToTier(fp.priority_score)
    const match = existingMap.get(norm)

    if (match) {
      const { error: upErr } = await supabase
        .from('focus_points')
        .update({
          count: (match.count ?? 0) + 1,
          tier,
          base_score: fp.priority_score,
          last_mentioned_at: now.toISOString(),
          class_input_id: class_input_id,
          ...(fp.drill ? { drill: fp.drill } : {}),
          // Only fill subtitle/context if the existing FP doesn't already have
          // them — preserves any edits the coach made on previous reviews.
          ...(!match.subtitle && fp.subtitle ? { subtitle: fp.subtitle } : {}),
          ...(!match.context && fp.context ? { context: fp.context } : {}),
        })
        .eq('id', match.id)
      if (upErr) {
        console.warn(`[student-class-score] update FP ${match.id} failed:`, upErr.message)
      } else {
        touchedNames.push(fp.name)
      }
    } else {
      const { error: insErr } = await supabase.from('focus_points').insert({
        user_id: studentId,
        name: fp.name,
        normalized_name: norm,
        subtitle: fp.subtitle ?? null,
        context: fp.context ?? null,
        count: 1,
        tier,
        base_score: fp.priority_score,
        drill: fp.drill ?? null,
        status: targetStatus,
        source_class_input_id: class_input_id,
        class_input_id: class_input_id,
        last_mentioned_at: now.toISOString(),
        ...(coachId ? { coach_review_deadline: deadline } : {}),
        is_archived: false,
        is_deleted: false,
        is_other: false,
      })
      if (insErr) {
        console.warn(`[student-class-score] insert FP "${fp.name}" failed:`, insErr.message)
      } else {
        touchedNames.push(fp.name)
      }
    }
  }

  if (coachId && touchedNames.length > 0) {
    const studentName = studentRow?.name ?? 'a student'
    const { error: notifErr } = await supabase.from('notifications').insert({
      user_id: coachId,
      type: touchedNames.length > 1 ? 'focus_points_added' : 'focus_point_added',
      title: `${studentName} logged a class`,
      body:
        touchedNames.length === 1
          ? `Review focus point: "${touchedNames[0]}"`
          : `Review ${touchedNames.length} focus points`,
      data: { class_input_id, student_id: studentId },
    })
    if (notifErr) {
      console.warn('[student-class-score] notification insert failed:', notifErr.message)
    } else {
      console.log(`[student-class-score] notified coach ${coachId}`)
    }
  } else {
    console.log(
      `[student-class-score] no notif sent (coachId=${coachId}, touched=${touchedNames.length})`,
    )
  }

  await supabase
    .from('class_inputs')
    .update({ status: 'scored' })
    .eq('id', class_input_id)
}
