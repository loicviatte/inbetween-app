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
import { TERMS_VERSION, consentCopy } from '../_shared/consentCopy.ts'

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

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
    consent?: unknown; parentFirstName?: unknown; phoneToken?: unknown
  }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  // Called with a JWT, but a signed-in caller can still post nonsense.
  const childName = (typeof body.childName === 'string' ? body.childName : '').trim().slice(0, 80)
  if (childName.length < 1) return json({ error: 'The child needs a name.' }, 400)

  // No child without a permission: the same statements an invited parent ticks,
  // in the wording of the version they were actually shown.
  const consent = body.consent && typeof body.consent === 'object' ? body.consent as Record<string, unknown> : {}
  const checks = Array.isArray(consent.checks) ? consent.checks : []
  if (checks.length !== 4 || !checks.every((c) => c === true)) {
    return json({ error: 'Every box needs to be ticked.' }, 400)
  }
  if (consent.termsVersion !== TERMS_VERSION) {
    return json({ error: 'The permission wording has changed. Go back and read it again.', termsVersion: TERMS_VERSION }, 409)
  }

  // Same parent, same name → a retry, not a second dancer. Any other name is a
  // sibling and gets their own profile.
  const { data: siblings } = await admin
    .from('guardians').select('child_id, users!guardians_child_id_fkey(name)').eq('guardian_id', parent.id)
  const twin = (siblings || []).find((r: { users?: { name?: string } }) =>
    (r.users?.name || '').trim().toLowerCase() === childName.toLowerCase())
  if (twin) return json({ childId: (twin as { child_id: string }).child_id, created: false })
  const isFirst = (siblings || []).length === 0

  // The parent's mobile, proven by a code moments ago: an email and three ticked
  // boxes alone are within reach of the child themselves. Checked after the
  // retry short-circuit above, so resubmitting an already-created child still
  // returns it instead of failing on a token that has been spent.
  const phoneToken = typeof body.phoneToken === 'string' ? body.phoneToken : ''
  const { data: phoneRow } = phoneToken
    ? await admin.from('phone_verifications').select('*').eq('token_hash', await sha256(phoneToken)).is('used_at', null).maybeSingle()
    : { data: null }
  if (!phoneRow?.verified_at || !phoneRow.token_expires_at || new Date(phoneRow.token_expires_at) < new Date()) {
    return json({ error: 'Verify your mobile number first.' }, 400)
  }

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

  // The proof first, then the permission it records — and never a child
  // without its proof: if either write fails, the child is not created.
  let coachName: string | null = null
  if (body.coachId) {
    const { data: coach } = await admin.from('users').select('name, role').eq('id', body.coachId).maybeSingle()
    if (coach?.role === 'coach') coachName = coach.name || null
  }
  const parentFirst = (typeof body.parentFirstName === 'string' && body.parentFirstName.trim())
    || String(parent.user_metadata?.name || 'Parent')
  const { error: proofErr } = await admin.from('parental_consents').insert({
    consent_method: 'parent_signup', status: 'approved',
    child_id: childId, child_name: childName, coach_id: body.coachId || null, coach_name: coachName,
    parent_first_name: parentFirst.slice(0, 60), parent_email: parent.email || '',
    approved_at: new Date().toISOString(),
    approved_ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    consent_text: consentCopy(childName, coachName), terms_version: TERMS_VERSION,
    guardian_id: parent.id,
    // signed in, but the address was never proven with a code: not stamped verified
    email_verified_at: null,
    parent_phone: phoneRow.phone, phone_verified_at: phoneRow.verified_at,
    // a code delivered in test mode proves nothing, and the proof says so
    delivery_mode: phoneRow.delivery_mode,
  })
  if (proofErr) {
    await admin.auth.admin.deleteUser(childId)
    return json({ error: "We couldn't record your permission.", detail: proofErr.message }, 500)
  }
  // one verified number, one child: the token can't be replayed for another
  await admin.from('phone_verifications').update({ used_at: new Date().toISOString() }).eq('id', phoneRow.id)
  const { error: grantErr } = await admin.from('users').update({ consent_status: 'granted' }).eq('id', childId)
  if (grantErr) {
    await admin.from('parental_consents').delete().eq('child_id', childId)
    await admin.auth.admin.deleteUser(childId)
    return json({ error: "We couldn't record your permission." }, 500)
  }

  // The first child becomes the one the app follows; a sibling does not steal
  // the parent's current view out from under them.
  if (isFirst) await admin.from('users').update({ active_child_id: childId }).eq('id', parent.id)
  // The row says what the auth metadata already says: this account is for a child.
  await admin.from('users').update({ account_for: 'child' }).eq('id', parent.id)

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
