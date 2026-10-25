import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { normalizeFocusName } from '../_shared/normalize.ts'

declare global {
  const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }
}

const LATIN_DANCES = ['Cha Cha', 'Samba', 'Rumba', 'Paso Doble', 'Jive']

// Marker dances used when a focus point is created without an explicit
// dance list (the user logged a class without selecting any dances). Stored
// as a single-element array so it visually pills clean and so
// categoryFromDances() routes the FP into the right Latin/Ballroom ranking.
const LATIN_FALLBACK = ['Cha Cha']
const BALLROOM_FALLBACK = ['Waltz']

function fallbackDanceForCoachStyle(danceStyle: string | null | undefined): string[] {
  const ds = (danceStyle ?? '').toLowerCase()
  if (ds === 'latin') return LATIN_FALLBACK
  if (ds === 'ballroom' || ds === 'standard') return BALLROOM_FALLBACK
  return []
}

function urgencyToTier(score: number | null | undefined): 'critical' | 'important' | 'supporting' {
  const s = score ?? 5
  if (s >= 8) return 'critical'
  if (s >= 5) return 'important'
  return 'supporting'
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

  // Auth: this function uses service-role for all writes, so we MUST verify
  // the JWT manually. Without this, any unauthenticated POST with a
  // known/guessable class_input_id can rewrite focus points and trigger
  // push notifications.
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  const callerId = userData.user.id

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Verify the class_input belongs to the caller before scoring it.
  const { data: ownerRow, error: ownerErr } = await supabase
    .from('class_inputs')
    .select('user_id')
    .eq('id', payload.class_input_id)
    .maybeSingle()
  if (ownerErr) {
    return new Response(JSON.stringify({ error: ownerErr.message }), { status: 500 })
  }
  if (!ownerRow || ownerRow.user_id !== callerId) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
  }

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

  // A lesson the dancer logs is theirs: its focus points go straight to them,
  // whoever they name as the teacher, and no coach is asked to review them.
  // Sadie and Sanna log their Latin lessons with Amy, who isn't on the app, and
  // Sanna put Fabio's name on one (24 Oct): he was sent a lesson he never
  // taught, in a style he can't see.
  //
  // The teacher is still looked up for one thing: a lesson logged without a
  // dance takes the teacher's style, so its focus points land in the right
  // Latin/Ballroom ranking. The name typed, among the dancer's coaches (a name
  // that matches none is a teacher outside the app) → with no name, the coach
  // for the lesson's style → their only coach → any coach column.
  let teacherId: string | null = null

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

  if (ci.teacher_name) {
    const tn = ci.teacher_name.trim().toLowerCase()
    const hit = linkedCoaches.find((c) => (c.name ?? '').trim().toLowerCase() === tn)
    if (hit) teacherId = hit.id
  } else {
    const isLatin = danceList.some((d) => LATIN_DANCES.includes(d))
    teacherId = isLatin ? (studentRow?.latin_coach_id ?? null) : (studentRow?.ballroom_coach_id ?? null)
    if (!teacherId && linkedCoaches.length === 1) {
      teacherId = linkedCoaches[0].id
    }
    if (!teacherId) {
      teacherId = studentRow?.latin_coach_id ?? studentRow?.ballroom_coach_id ?? null
    }
  }

  const { data: existing } = await supabase
    .from('focus_points')
    .select('id, name, normalized_name, count, tier, base_score, train_target, drill, status, subtitle, context')
    .eq('user_id', studentId)
    .eq('is_deleted', false)
    .eq('is_archived', false)
    .neq('status', 'past')

  const existingMap = new Map<string, any>()
  for (const p of existing ?? []) existingMap.set(p.normalized_name, p)

  const now = new Date()

  // Resolve the dance list new FPs will inherit. Priority: the class's own
  // dance list → the teacher's dance_style → empty (rare edge case).
  let fpDance: string[] = danceList
  if (fpDance.length === 0 && teacherId) {
    const { data: coachRow } = await supabase
      .from('users')
      .select('dance_style')
      .eq('id', teacherId)
      .single()
    fpDance = fallbackDanceForCoachStyle(coachRow?.dance_style)
  }

  console.log(
    `[student-class-score] class=${class_input_id} student=${studentId} teacher=${teacherId} ` +
      `teacher_name="${ci.teacher_name ?? ''}" dance=${JSON.stringify(danceList)} focuses=${focuses.length}`,
  )

  const touchedNames: string[] = []

  for (const fp of focuses) {
    if (!fp.name) continue
    const norm = normalizeFocusName(fp.name)
    const tier = urgencyToTier(fp.priority_score)
    const match = existingMap.get(norm)

    if (match) {
      const { error: upErr } = await supabase
        .from('focus_points')
        .update({
          count: (match.count ?? 0) + 1,
          tier,
          base_score: fp.priority_score,
          // Re-logged focus = redo → grow the train target (+2), like a merge.
          train_target: (match.train_target ?? (match.tier === 'critical' ? 3 : 2)) + 2,
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
        train_target: tier === 'critical' ? 3 : 2,
        drill: fp.drill ?? null,
        dance: fpDance,
        status: 'active',
        source_class_input_id: class_input_id,
        class_input_id: class_input_id,
        last_mentioned_at: now.toISOString(),
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

  console.log(`[student-class-score] ${touchedNames.length} focus point(s) to the dancer`)

  await supabase
    .from('class_inputs')
    .update({ status: 'scored' })
    .eq('id', class_input_id)
}
