// ─── create-child-account ───────────────────────────────────────────────────
// A parent finishes onboarding; this creates the child they just described.
//
// The child has to be a real student row — coaches attach classes and focus
// points to a student_id, and a roster showing the parent instead of the dancer
// would be wrong. public.users.id is FK'd to auth.users, so the child needs an
// auth account. It is created here with a generated address and a password
// nobody ever sees or needs: the parent reaches the child's training through
// the guardians link, and the child can claim the account later by setting
// their own email.
//
// A guardian can follow several dancers, so this creates a new one each time —
// except when the name matches a child they already guard, which is a retry,
// not a sibling.
//
// Called with the PARENT's JWT. Everything it writes is scoped to that parent.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MANAGED_DOMAIN = 'managed.useinbetween.com'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const { data: { user: parent }, error: authError } = await admin.auth.getUser(authHeader.slice(7))
  if (authError || !parent) return json({ error: 'Unauthorized' }, 401)

  let body: {
    childName?: unknown; danceStyle?: string; level?: string; ageCategory?: string
    studioId?: string | null; coachId?: string | null
    lessonsPerMonth?: number; soloFrequency?: string; weeklyGoalMinutes?: number
    focusPoints?: unknown
  }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  // Called with a JWT, but a signed-in caller can still post nonsense.
  const childName = (typeof body.childName === 'string' ? body.childName : '').trim().slice(0, 80)
  if (childName.length < 1) return json({ error: 'The child needs a name.' }, 400)

  // Same parent, same name → a retry, not a second dancer. Any other name is a
  // sibling and gets their own profile.
  const { data: siblings } = await admin
    .from('guardians').select('child_id, users!guardians_child_id_fkey(name)').eq('guardian_id', parent.id)
  const twin = (siblings || []).find((r: { users?: { name?: string } }) =>
    (r.users?.name || '').trim().toLowerCase() === childName.toLowerCase())
  if (twin) return json({ childId: (twin as { child_id: string }).child_id, created: false })
  const isFirst = (siblings || []).length === 0

  const email = `child.${crypto.randomUUID()}@${MANAGED_DOMAIN}`
  const password = crypto.randomUUID() + crypto.randomUUID()

  const { data: made, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: childName, role: 'student', dance_style: body.danceStyle || null, managed_by: parent.id },
  })
  if (createErr || !made?.user) {
    return json({ error: 'Could not create the child profile.', detail: createErr?.message }, 500)
  }
  const childId = made.user.id

  // handle_new_user has already written the row from the metadata; this fills
  // in what the trigger does not know about.
  const { error: rowErr } = await admin.from('users').update({
    name: childName,
    role: 'student',
    dance_style: body.danceStyle || null,
    studio_id: body.studioId || null,
    lessons_per_month: body.lessonsPerMonth ?? null,
    solo_practice_frequency: body.soloFrequency || null,
    weekly_goal_minutes: body.weeklyGoalMinutes ?? 60,
    account_for: 'self',
  }).eq('id', childId)
  if (rowErr) {
    // Leave nothing half-made: without the profile row the auth user is junk.
    await admin.auth.admin.deleteUser(childId)
    return json({ error: 'Could not create the child profile.', detail: rowErr.message }, 500)
  }

  const { error: linkErr } = await admin.from('guardians')
    .insert({ guardian_id: parent.id, child_id: childId, relationship: 'parent' })
  if (linkErr) {
    await admin.auth.admin.deleteUser(childId)
    return json({ error: 'Could not link the child to your account.', detail: linkErr.message }, 500)
  }

  // The first child becomes the one the app follows; a sibling does not steal
  // the parent's current view out from under them.
  if (isFirst) await admin.from('users').update({ active_child_id: childId }).eq('id', parent.id)

  if (body.coachId) {
    // Which side the coach teaches follows the style the parent chose.
    const col = body.danceStyle === 'Ballroom' ? 'ballroom_coach_id' : 'latin_coach_id'
    await admin.from('users').update({ [col]: body.coachId }).eq('id', childId)
    // The coach's roster reads coach_requests, not these columns: without a
    // request the child never appears in their student list.
    const cats = body.danceStyle === 'Latin & Ballroom' ? ['latin', 'ballroom'] : [body.danceStyle === 'Ballroom' ? 'ballroom' : 'latin']
    await admin.from('coach_requests').insert(cats.map((category) => ({ coach_id: body.coachId, student_id: childId, status: 'pending', category })))
  }

  const points = (Array.isArray(body.focusPoints) ? body.focusPoints : []).slice(0, 5)
  if (points.length) {
    await admin.from('focus_points').insert(points.map((p: Record<string, unknown>) => ({
      user_id: childId,
      name: String(p.name || '').slice(0, 90) || 'Focus point',
      subtitle: p.subtitle ? String(p.subtitle).slice(0, 120) : null,
      dance: p.dance ? [String(p.dance)] : null,
      tier: p.tier === 'critical' ? 'critical' : 'important',
      status: 'active',
    })))
  }

  return json({ childId, created: true })
})
