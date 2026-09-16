// ─── minor-consent ──────────────────────────────────────────────────────────
// The whole life of a parental consent for a student under 18:
//
//   invite   the student names a parent; a pending student profile is created
//            that nothing can record, and the parent is sent an email code and
//            a separate SMS code
//   status / resend / update / cancel
//            the student's own device follows the invitation, proven by a
//            device secret handed back at invite time; cancel removes the
//            pending profile so starting over leaves nothing behind
//   verify   the parent proves both channels — the email code AND the SMS code
//   approve  three explicit agreements, an account, and the proof written down
//   withdraw one action from the parent's account deletes everything
//
// No JWT for the first seven: the student and the parent have no account yet.
// withdraw checks the parent's JWT itself.
//
// Delivery: real email (Resend) and SMS (Twilio) when both are configured.
// Otherwise, only if CONSENT_TEST_MODE=on, the messages go to the owner's
// Telegram monitor — never back to the student's device, which would let a
// minor approve their own account. Codes are checked the same way in both
// modes. Test-mode approvals are stamped as such in the proof, because they
// are not proof of anything.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { TERMS_VERSION, consentCopy } from '../_shared/consentCopy.ts'
import { inviteEmail } from './inviteEmail.ts'

const INVITE_TTL_H = 72
const TICKET_TTL_MIN = 30
const MAX_VERIFY_ATTEMPTS = 5
const RESEND_MIN_INTERVAL_S = 60
const MAX_RESENDS = 5
// Both channels: an email code AND an SMS code. Email alone let a student type
// a second address of their own and approve themselves. A second number is much
// harder to come by than a second address — but it is not proof of age.
const SMS_ENABLED = true
const MINOR_AGES = ['Juvenile', 'Junior', 'Youth']
const MANAGED_DOMAIN = 'managed.useinbetween.com'
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'   // no 0/O, 1/I/L, U

type Row = Record<string, any>
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
// Rejection sampling, so no character is likelier than another.
function randomCode(len: number, alphabet = CODE_ALPHABET) {
  const max = Math.floor(256 / alphabet.length) * alphabet.length
  const out: string[] = []
  while (out.length < len) {
    for (const b of crypto.getRandomValues(new Uint8Array(len * 2))) {
      if (b < max && out.length < len) out.push(alphabet[b % alphabet.length])
    }
  }
  return out.join('')
}
const formatToken = (t: string) => `${t.slice(0, 4)}-${t.slice(4, 8)}-${t.slice(8, 12)}`
const normToken = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const normPhone = (v: unknown) => {
  const p = str(v, 32).replace(/[\s().-]/g, '')
  return /^\+[0-9]{8,15}$/.test(p) ? p : ''
}
const maskEmail = (e: string) => {
  const [u, d] = e.split('@')
  return `${u.slice(0, 1)}${'•'.repeat(Math.max(1, Math.min(6, u.length - 1)))}@${d}`
}
const maskPhone = (p: string | null) => (p ? `${p.slice(0, 3)} ••• ••${p.slice(-2)}` : null)
const ipOf = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600000).toISOString()

// ── delivery ────────────────────────────────────────────────────────────────
function deliveryMode(): 'live' | 'test' | null {
  const env = (k: string) => Deno.env.get(k)
  const emailLive = env('RESEND_API_KEY') && env('CONSENT_EMAIL_FROM')
  const smsLive = env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN')
    && (env('TWILIO_FROM') || env('TWILIO_MESSAGING_SERVICE_SID'))
  const live = emailLive && (!SMS_ENABLED || smsLive)
  if (live) return 'live'
  if (env('CONSENT_TEST_MODE') === 'on') return 'test'
  return null
}

function smsMode(): 'live' | 'test' | null {
  const env = (k: string) => Deno.env.get(k)
  if (env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN')
    && (env('TWILIO_FROM') || env('TWILIO_MESSAGING_SERVICE_SID'))) return 'live'
  if (env('CONSENT_TEST_MODE') === 'on') return 'test'
  return null
}

async function toTelegram(text: string) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN'), chat = Deno.env.get('TELEGRAM_CHAT_ID')
  if (!token || !chat) throw new Error('test delivery needs the Telegram monitor')
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text }),
  })
  if (!r.ok) throw new Error(`telegram ${r.status}`)
}

async function sendEmail(mode: 'live' | 'test', to: string, subject: string, text: string, html?: string) {
  if (mode === 'test') return toTelegram(`🧪 TEST · email to ${maskEmail(to)}\n${subject}\n\n${text}`)
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: Deno.env.get('CONSENT_EMAIL_FROM'), to: [to], subject, text, ...(html ? { html } : {}) }),
  })
  if (!r.ok) throw new Error(`resend ${r.status}: ${await r.text()}`)
}

async function sendSms(mode: 'live' | 'test', to: string, body: string) {
  if (mode === 'test') return toTelegram(`🧪 TEST · text to ${maskPhone(to)}\n${body}`)
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')!, tok = Deno.env.get('TWILIO_AUTH_TOKEN')!
  const form = new URLSearchParams({ To: to, Body: body })
  const service = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID')
  if (service) form.set('MessagingServiceSid', service)
  else form.set('From', Deno.env.get('TWILIO_FROM')!)
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${sid}:${tok}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  if (!r.ok) throw new Error(`twilio ${r.status}: ${await r.text()}`)
}

async function deliverInvite(mode: 'live' | 'test', row: Row, token: string, code: string) {
  const child = row.child_name
  const smsSent = SMS_ENABLED && !!row.parent_phone
  const mail = inviteEmail({
    parentFirstName: row.parent_first_name, childName: child, coachName: row.coach_name,
    code: formatToken(token), smsSent, ttlHours: INVITE_TTL_H,
  })
  await sendEmail(mode, row.parent_email, mail.subject, mail.text, mail.html)
  if (smsSent) await sendSms(mode, row.parent_phone,
    `InBetween: your code to approve ${child}'s account is ${code}. It expires in ${INVITE_TTL_H} hours.`)
}

async function freshSecrets() {
  const token = randomCode(12), code = randomCode(6, '0123456789')
  return { token, code, tokenHash: await sha256(token), codeHash: await sha256(code) }
}

async function limited(admin: SupabaseClient, key: string, max: number, windowSec: number) {
  const since = new Date(Date.now() - windowSec * 1000).toISOString()
  const { count } = await admin.from('consent_rate_hits')
    .select('id', { count: 'exact', head: true }).eq('key', key).gte('created_at', since)
  if ((count ?? 0) >= max) return true
  await admin.from('consent_rate_hits').insert({ key })
  if (Math.random() < 0.02) {
    await admin.from('consent_rate_hits').delete().lt('created_at', new Date(Date.now() - 2 * 86400000).toISOString())
  }
  return false
}

async function byDevice(admin: SupabaseClient, b: Row) {
  const id = str(b.inviteId, 40), secret = str(b.deviceSecret, 64)
  if (!id || !secret) return null
  const { data } = await admin.from('parental_consents').select('*').eq('id', id).maybeSingle()
  if (!data || data.device_secret_hash !== await sha256(secret)) return null
  return data as Row
}

// ── invite ──────────────────────────────────────────────────────────────────
async function invite(admin: SupabaseClient, b: Row, ip: string) {
  const childName = str(b.childName, 60), parentFirst = str(b.parentFirstName, 60)
  const parentEmail = str(b.parentEmail, 120).toLowerCase(), parentPhone = normPhone(b.parentPhone)
  if (!childName) return json({ error: 'Add your first name.' }, 400)
  if (!parentFirst) return json({ error: "Add your parent's first name." }, 400)
  if (!EMAIL_RE.test(parentEmail)) return json({ error: "That email doesn't look right." }, 400)
  if (SMS_ENABLED && !parentPhone) return json({ error: 'Add the mobile number with its country code, like +44 7700 900123.' }, 400)
  if (!MINOR_AGES.includes(str(b.ageCategory, 20))) return json({ error: 'This invitation is only for students under 18.' }, 400)

  const mode = deliveryMode()
  if (!mode) return json({ error: "Parent verification isn't available yet. Try again soon." }, 503)
  if (await limited(admin, `invite:ip:${ip}`, 5, 3600)) return json({ error: 'Too many invitations from here. Try again later.' }, 429)
  if (await limited(admin, `invite:email:${await sha256(parentEmail)}`, 3, 86400)
    || (parentPhone && await limited(admin, `invite:phone:${await sha256(parentPhone)}`, 3, 86400))) {
    return json({ error: 'This parent has already been invited several times today.' }, 429)
  }

  const danceStyle = ['Latin', 'Ballroom', 'Latin & Ballroom'].includes(String(b.danceStyle)) ? String(b.danceStyle) : 'Latin'
  const coachId = str(b.coachId, 40) || null
  let coachName: string | null = null
  if (coachId) {
    const { data: coach } = await admin.from('users').select('name, role').eq('id', coachId).maybeSingle()
    if (!coach || coach.role !== 'coach') return json({ error: "We couldn't find that coach." }, 400)
    coachName = coach.name || null
  }

  const lessons = Number(b.lessonsPerMonth)
  const { data: made, error: createErr } = await admin.auth.admin.createUser({
    email: `child.${crypto.randomUUID()}@${MANAGED_DOMAIN}`,
    password: crypto.randomUUID() + crypto.randomUUID(),
    email_confirm: true,
    user_metadata: {
      name: childName, role: 'student', dance_style: danceStyle,
      studio_id: str(b.studioId, 40) || null,
      lessons_per_month: Number.isFinite(lessons) ? lessons : null,
      solo_practice_frequency: str(b.soloFrequency, 40) || null,
    },
  })
  if (createErr || !made?.user) return json({ error: "We couldn't set up your profile." }, 500)
  const childId = made.user.id
  const rollback = () => admin.auth.admin.deleteUser(childId)

  const patch: Row = { consent_status: 'pending' }
  if (coachId) patch[danceStyle === 'Ballroom' ? 'ballroom_coach_id' : 'latin_coach_id'] = coachId
  const { error: rowErr } = await admin.from('users').update(patch).eq('id', childId)
  if (rowErr) { await rollback(); return json({ error: "We couldn't set up your profile." }, 500) }

  // The coach's roster reads accepted coach_requests, not the *_coach_id
  // columns — without a request this student would never appear to them.
  if (coachId) {
    const cats = danceStyle === 'Latin & Ballroom' ? ['latin', 'ballroom'] : [danceStyle === 'Ballroom' ? 'ballroom' : 'latin']
    await admin.from('coach_requests').insert(cats.map((category) => ({ coach_id: coachId, student_id: childId, status: 'pending', category })))
  }

  const s = await freshSecrets()
  const deviceSecret = randomCode(32)
  const { data: row, error: cErr } = await admin.from('parental_consents').insert({
    child_id: childId, child_name: childName, coach_id: coachId, coach_name: coachName,
    parent_first_name: parentFirst, parent_email: parentEmail, parent_phone: parentPhone || null,
    email_token_hash: s.tokenHash, sms_code_hash: SMS_ENABLED ? s.codeHash : null, device_secret_hash: await sha256(deviceSecret),
    expires_at: hoursFromNow(INVITE_TTL_H), last_sent_at: new Date().toISOString(),
    delivery_mode: mode, terms_version: TERMS_VERSION,
  }).select('*').single()
  if (cErr || !row) { await rollback(); return json({ error: "We couldn't create the invitation." }, 500) }

  try {
    await deliverInvite(mode, row, s.token, s.code)
  } catch (e) {
    console.error('[minor-consent] delivery failed', e)
    await admin.from('parental_consents').update({ status: 'expired', email_token_hash: null, sms_code_hash: null }).eq('id', row.id)
    await rollback()
    return json({ error: "We couldn't reach that email or number. Check them and try again." }, 502)
  }
  return json({ inviteId: row.id, deviceSecret, maskedEmail: maskEmail(parentEmail), maskedPhone: maskPhone(parentPhone), mode })
}

// ── the student's device follows its invitation ─────────────────────────────
async function status(admin: SupabaseClient, b: Row) {
  const row = await byDevice(admin, b)
  if (!row) return json({ error: 'Invitation not found.' }, 404)
  const expired = row.status === 'pending' && new Date(row.expires_at) < new Date()
  return json({
    status: expired ? 'expired' : row.status,
    maskedEmail: maskEmail(row.parent_email), maskedPhone: maskPhone(row.parent_phone),
    parentFirstName: row.parent_first_name, childName: row.child_name,
  })
}

async function reissue(admin: SupabaseClient, row: Row, contact: Row = {}) {
  if (row.status === 'approved' || row.status === 'withdrawn') return json({ error: 'This invitation is already closed.' }, 409)
  if (!row.child_id) return json({ error: 'This invitation can no longer be sent. Start again.' }, 410)
  if (row.last_sent_at && Date.now() - new Date(row.last_sent_at).getTime() < RESEND_MIN_INTERVAL_S * 1000) {
    return json({ error: 'Give it a minute before sending again.' }, 429)
  }
  if (row.resend_count >= MAX_RESENDS) return json({ error: "That's the most we can send. Check the details are right." }, 429)
  const mode = deliveryMode()
  if (!mode) return json({ error: "Parent verification isn't available yet." }, 503)
  const s = await freshSecrets()
  const { data: next, error } = await admin.from('parental_consents').update({
    ...contact,
    email_token_hash: s.tokenHash, sms_code_hash: SMS_ENABLED ? s.codeHash : null, verify_attempts: 0, status: 'pending',
    expires_at: hoursFromNow(INVITE_TTL_H), last_sent_at: new Date().toISOString(),
    resend_count: row.resend_count + 1, delivery_mode: mode, ticket_hash: null, ticket_expires_at: null,
  }).eq('id', row.id).select('*').single()
  if (error || !next) return json({ error: "We couldn't send it again." }, 500)
  await deliverInvite(mode, next, s.token, s.code)
  return json({ ok: true, maskedEmail: maskEmail(next.parent_email), maskedPhone: maskPhone(next.parent_phone) })
}

async function resend(admin: SupabaseClient, b: Row) {
  const row = await byDevice(admin, b)
  if (!row) return json({ error: 'Invitation not found.' }, 404)
  return reissue(admin, row)
}

async function update(admin: SupabaseClient, b: Row, ip: string) {
  const row = await byDevice(admin, b)
  if (!row) return json({ error: 'Invitation not found.' }, 404)
  const parentFirst = str(b.parentFirstName, 60) || row.parent_first_name
  const parentEmail = str(b.parentEmail, 120).toLowerCase(), parentPhone = normPhone(b.parentPhone)
  if (!EMAIL_RE.test(parentEmail)) return json({ error: "That email doesn't look right." }, 400)
  if (SMS_ENABLED && !parentPhone) return json({ error: 'Add the mobile number with its country code, like +44 7700 900123.' }, 400)
  if (await limited(admin, `invite:ip:${ip}`, 5, 3600)) return json({ error: 'Too many invitations from here. Try again later.' }, 429)
  return reissue(admin, row, { parent_first_name: parentFirst, parent_email: parentEmail, parent_phone: parentPhone || row.parent_phone || null })
}

// The student starts over: the pending profile, its coach requests and the
// invitation go (purge_pending_minor refuses anything a parent approved).
// Invitations nobody cancels are cleared by the daily purge-expired-minor-invites job.
async function cancel(admin: SupabaseClient, b: Row) {
  const row = await byDevice(admin, b)
  if (!row) return json({ ok: true })   // already gone
  if (row.status === 'approved' || row.status === 'withdrawn') return json({ error: 'This invitation is already closed.' }, 409)
  if (row.child_id) {
    const { data: purged, error } = await admin.rpc('purge_pending_minor', { p_child: row.child_id })
    if (error || purged !== true) {
      console.error('[minor-consent] cancel failed', error?.message ?? 'refused')
      return json({ error: "We couldn't cancel this invitation. Try again in a moment." }, 500)
    }
  } else {
    await admin.from('parental_consents').delete().eq('id', row.id)
  }
  return json({ ok: true })
}

// ── a student who already has an account ────────────────────────────────────
// A coach said this signed-in student is under 18 (users.age_check =
// 'minor_pending'). Their account stays theirs; the parent approves it the same
// way, and approve() links the parent to it and unlocks it. No device secret:
// the student's own JWT proves who is asking.
async function studentFromJwt(admin: SupabaseClient, req: Request) {
  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return null
  const { data: { user } } = await admin.auth.getUser(auth.slice(7))
  if (!user) return null
  const { data: me } = await admin.from('users').select('id, name, age_check, age_check_by').eq('id', user.id).maybeSingle()
  return me ?? null
}

async function inviteSelf(admin: SupabaseClient, req: Request, b: Row, ip: string) {
  const me = await studentFromJwt(admin, req)
  if (!me) return json({ error: 'Sign in again.' }, 401)
  if (me.age_check !== 'minor_pending') return json({ error: 'Your account doesn’t need a parent’s permission.' }, 409)
  const parentFirst = str(b.parentFirstName, 60)
  const parentEmail = str(b.parentEmail, 120).toLowerCase(), parentPhone = normPhone(b.parentPhone)
  if (!parentFirst) return json({ error: "Add your parent's first name." }, 400)
  if (!EMAIL_RE.test(parentEmail)) return json({ error: "That email doesn't look right." }, 400)
  if (SMS_ENABLED && !parentPhone) return json({ error: 'Add the mobile number with its country code, like +44 7700 900123.' }, 400)

  // Already invited: correct the details and send it again.
  const { data: open } = await admin.from('parental_consents').select('*')
    .eq('child_id', me.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (open) {
    if (await limited(admin, `invite:ip:${ip}`, 5, 3600)) return json({ error: 'Too many invitations from here. Try again later.' }, 429)
    return reissue(admin, { ...open, last_sent_at: null }, { parent_first_name: parentFirst, parent_email: parentEmail, parent_phone: parentPhone || null })
  }

  const mode = deliveryMode()
  if (!mode) return json({ error: "Parent verification isn't available yet. Try again soon." }, 503)
  if (await limited(admin, `invite:ip:${ip}`, 5, 3600)) return json({ error: 'Too many invitations from here. Try again later.' }, 429)
  if (await limited(admin, `invite:email:${await sha256(parentEmail)}`, 3, 86400)
    || (parentPhone && await limited(admin, `invite:phone:${await sha256(parentPhone)}`, 3, 86400))) {
    return json({ error: 'This parent has already been invited several times today.' }, 429)
  }
  let coachName: string | null = null
  if (me.age_check_by) {
    const { data: coach } = await admin.from('users').select('name').eq('id', me.age_check_by).maybeSingle()
    coachName = coach?.name || null
  }
  const childName = (me.name || '').trim().split(/\s+/)[0] || 'Your child'
  const s = await freshSecrets()
  const { data: row, error } = await admin.from('parental_consents').insert({
    child_id: me.id, child_name: childName, coach_id: me.age_check_by, coach_name: coachName,
    parent_first_name: parentFirst, parent_email: parentEmail, parent_phone: parentPhone || null,
    email_token_hash: s.tokenHash, sms_code_hash: SMS_ENABLED ? s.codeHash : null,
    device_secret_hash: await sha256(randomCode(32)),   // unused: the JWT stands in for it
    expires_at: hoursFromNow(INVITE_TTL_H), last_sent_at: new Date().toISOString(),
    delivery_mode: mode, terms_version: TERMS_VERSION,
  }).select('*').single()
  if (error || !row) return json({ error: "We couldn't create the invitation." }, 500)
  try {
    await deliverInvite(mode, row, s.token, s.code)
  } catch (e) {
    console.error('[minor-consent] invite-self delivery failed', e)
    await admin.from('parental_consents').delete().eq('id', row.id)
    return json({ error: "We couldn't reach that email or number. Check them and try again." }, 502)
  }
  return json({ ok: true, maskedEmail: maskEmail(parentEmail), maskedPhone: maskPhone(parentPhone), mode })
}

async function resendSelf(admin: SupabaseClient, req: Request) {
  const me = await studentFromJwt(admin, req)
  if (!me) return json({ error: 'Sign in again.' }, 401)
  const { data: open } = await admin.from('parental_consents').select('*')
    .eq('child_id', me.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!open) return json({ error: 'There’s no invitation to send again.' }, 404)
  return reissue(admin, open)
}

// ── the parent ──────────────────────────────────────────────────────────────
async function verify(admin: SupabaseClient, b: Row, ip: string) {
  if (await limited(admin, `verify:ip:${ip}`, 20, 3600)) return json({ error: 'Too many attempts. Try again later.' }, 429)
  const token = normToken(b.token), code = str(b.code, 12).replace(/\D/g, '')
  // Codes are always checked, test mode included: a test invitation's codes
  // reach the Telegram monitor, so the flow can still be walked with them. A
  // "any code works" shortcut here once let anyone approve the newest pending
  // minor and choose the password of the account holding their data.
  if (token.length !== 12) return json({ error: 'Enter the code from the email.' }, 400)
  if (SMS_ENABLED && code.length !== 6) return json({ error: 'Enter both codes.' }, 400)

  const { data: row } = await admin.from('parental_consents').select('*')
    .eq('email_token_hash', await sha256(token)).eq('status', 'pending').maybeSingle()
  if (!row || !row.child_id) return json({ error: "That invitation code isn't valid." }, 404)
  if (new Date(row.expires_at) < new Date()) {
    await admin.from('parental_consents').update({ status: 'expired' }).eq('id', row.id)
    return json({ error: 'This invitation has expired. Ask for a new one.' }, 410)
  }
  if (row.verify_attempts >= MAX_VERIFY_ATTEMPTS) return json({ error: 'Too many wrong codes. Ask for a new invitation.' }, 423)
  if (SMS_ENABLED && row.sms_code_hash !== await sha256(code)) {
    await admin.from('parental_consents').update({ verify_attempts: row.verify_attempts + 1 }).eq('id', row.id)
    return json({ error: "The text message code doesn't match." }, 401)
  }

  // The email code found the invitation (and, when SMS is on, the SMS code
  // matched it). A channel that was never used is never stamped as verified.
  const ticket = randomCode(40)
  const now = new Date().toISOString()
  await admin.from('parental_consents').update({
    email_verified_at: row.email_verified_at || now,
    phone_verified_at: SMS_ENABLED ? (row.phone_verified_at || now) : null,
    ticket_hash: await sha256(ticket),
    ticket_expires_at: new Date(Date.now() + TICKET_TTL_MIN * 60000).toISOString(),
  }).eq('id', row.id)

  const { data: existing } = await admin.from('users').select('id, role').eq('email', row.parent_email).maybeSingle()
  return json({
    ticket, childName: row.child_name, coachName: row.coach_name,
    parentFirstName: row.parent_first_name, parentEmail: row.parent_email,
    accountExists: !!existing, coachAccount: existing?.role === 'coach',
    copy: consentCopy(row.child_name, row.coach_name), termsVersion: TERMS_VERSION,
  })
}

async function approve(admin: SupabaseClient, b: Row, ip: string) {
  const ticket = str(b.ticket, 64)
  if (!ticket) return json({ error: 'Start again from your invitation.' }, 400)
  const { data: row } = await admin.from('parental_consents').select('*')
    .eq('ticket_hash', await sha256(ticket)).eq('status', 'pending').maybeSingle()
  if (!row || !row.child_id || !row.ticket_expires_at || new Date(row.ticket_expires_at) < new Date()) {
    return json({ error: 'This approval has expired. Enter your codes again.' }, 410)
  }
  const checks = Array.isArray(b.checks) ? b.checks : []
  if (checks.length !== 3 || !checks.every((c: unknown) => c === true)) {
    return json({ error: 'All three boxes need to be ticked.' }, 400)
  }

  const { data: existing } = await admin.from('users').select('id, role').eq('email', row.parent_email).maybeSingle()
  // A coach resolving to a child's data would lose their own coach app.
  if (existing?.role === 'coach') {
    return json({ error: 'This email belongs to a coach account. Use a different email for the parent account.' }, 409)
  }
  let parentId: string
  if (existing) {
    parentId = existing.id
    const { data: au } = await admin.auth.admin.getUserById(parentId)
    await admin.auth.admin.updateUserById(parentId, { user_metadata: { ...(au?.user?.user_metadata || {}), account_for: 'child' } })
  } else {
    const password = typeof b.password === 'string' ? b.password : ''
    if (password.length < 8) return json({ error: 'Choose a password of at least 8 characters.' }, 400)
    const { data: made, error } = await admin.auth.admin.createUser({
      email: row.parent_email, password, email_confirm: true,   // the email code already proved it
      user_metadata: { name: row.parent_first_name, role: 'student', account_for: 'child' },
    })
    if (error || !made?.user) return json({ error: "We couldn't create your account." }, 500)
    parentId = made.user.id
  }
  await admin.from('users').update({ account_for: 'child' }).eq('id', parentId)

  const { error: linkErr } = await admin.from('guardians').insert({ guardian_id: parentId, child_id: row.child_id, relationship: 'parent' })
  if (linkErr && linkErr.code !== '23505') return json({ error: "We couldn't link the account." }, 500)
  await admin.from('users').update({ active_child_id: row.child_id }).eq('id', parentId).is('active_child_id', null)

  // The proof first, then the permission it records — never a permission
  // without its proof.
  const copy = consentCopy(row.child_name, row.coach_name)
  const { error: proofErr } = await admin.from('parental_consents').update({
    status: 'approved', approved_at: new Date().toISOString(), approved_ip: ip,
    consent_text: copy, terms_version: TERMS_VERSION, guardian_id: parentId,
    email_token_hash: null, sms_code_hash: null, ticket_hash: null, ticket_expires_at: null,
  }).eq('id', row.id)
  if (proofErr) return json({ error: "We couldn't record your permission." }, 500)
  const { error: grantErr } = await admin.from('users').update({ consent_status: 'granted' }).eq('id', row.child_id)
  if (grantErr) {
    await admin.from('parental_consents').update({ status: 'pending' }).eq('id', row.id)
    return json({ error: "We couldn't record your permission." }, 500)
  }
  // A student a coach had flagged as under 18 is now accounted for.
  await admin.from('users').update({ age_check: 'minor_consented', age_check_at: new Date().toISOString() })
    .eq('id', row.child_id).eq('age_check', 'minor_pending')

  if (row.coach_id) {
    await admin.from('notifications').insert({
      user_id: row.coach_id, type: 'consent_granted',
      title: `${row.child_name} can now be recorded`,
      body: `A parent gave permission. Recording is enabled for ${row.child_name}.`,
      data: { student_id: row.child_id },
    })
  }
  return json({ ok: true, parentEmail: row.parent_email, accountExisted: !!existing })
}

// ── withdrawal ──────────────────────────────────────────────────────────────
async function withdraw(admin: SupabaseClient, req: Request, b: Row, ip: string) {
  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)
  const { data: { user }, error: authErr } = await admin.auth.getUser(auth.slice(7))
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  const childId = str(b.childId, 40)
  const { data: link } = await admin.from('guardians').select('id').eq('guardian_id', user.id).eq('child_id', childId).maybeSingle()
  if (!link) return json({ error: "You can't withdraw permission for this student." }, 403)
  const { data: child } = await admin.from('users').select('name, latin_coach_id, ballroom_coach_id').eq('id', childId).maybeSingle()
  if (!child) return json({ error: 'This profile is already deleted.' }, 404)
  const childName = child.name || 'your child'
  const problems: string[] = []
  const note = (step: string, e: { message?: string } | null) => { if (e) problems.push(`${step}: ${e.message}`) }

  const { data: reqs } = await admin.from('coach_requests').select('coach_id').eq('student_id', childId)
  const coachIds = [...new Set([...(reqs || []).map((r: Row) => r.coach_id), child.latin_coach_id, child.ballroom_coach_id].filter(Boolean))]

  // 1. The proof stays — only its link to the student goes, when the row does.
  note('proof', (await admin.from('parental_consents').update({
    status: 'withdrawn', withdrawn_at: new Date().toISOString(), withdrawn_ip: ip,
    email_token_hash: null, sms_code_hash: null, ticket_hash: null, ticket_expires_at: null,
  }).eq('child_id', childId).in('status', ['pending', 'approved'])).error)

  // 2. Recording stops before anything slow runs.
  note('stop recording', (await admin.from('users').update({ consent_status: 'withdrawn' }).eq('id', childId)).error)

  // 3. Private recordings: the audio, then the rows.
  const { data: recs } = await admin.from('class_recordings').select('id, user_id').eq('student_id', childId)
  let removedFiles = 0
  for (const r of recs || []) {
    const prefix = `${r.user_id}/${r.id}`
    const { data: files } = await admin.storage.from('class-audio').list(prefix, { limit: 1000 })
    const paths = (files || []).map((f: Row) => `${prefix}/${f.name}`)
    if (paths.length) {
      const { error } = await admin.storage.from('class-audio').remove(paths)
      note('audio', error)
      if (!error) removedFiles += paths.length
    }
  }
  const recIds = (recs || []).map((r: Row) => r.id)
  if (recIds.length) {
    note('chunks', (await admin.from('class_recording_chunks').delete().in('recording_id', recIds)).error)
    note('recordings', (await admin.from('class_recordings').delete().in('id', recIds)).error)
  }

  // 4. A group lesson belongs to everyone in it: only this student's place goes.
  note('group recordings', (await admin.from('class_recording_students').delete().eq('student_id', childId)).error)
  note('group lessons', (await admin.from('class_input_students').delete().eq('student_id', childId)).error)
  note('group ids', (await admin.rpc('remove_student_from_group_inputs', { target: childId })).error)

  // 5. Private lessons, and the focus points built from them first.
  note('focus points', (await admin.from('focus_points').delete().eq('user_id', childId)).error)
  const { data: inputs } = await admin.from('class_inputs').select('id, audio_path').eq('student_id', childId)
  for (const i of inputs || []) {
    if (i.audio_path) note('lesson audio', (await admin.storage.from('class-audio').remove([i.audio_path])).error)
  }
  note('lessons', (await admin.from('class_inputs').delete().eq('student_id', childId)).error)

  // 6. Rows whose foreign keys would otherwise block deleting the account.
  note('couple requests', (await admin.from('couple_requests').delete()
    .or(`requester_id.eq.${childId},target_id.eq.${childId},proposed_leader_id.eq.${childId}`)).error)
  note('couples', (await admin.from('couples').delete()
    .or(`user_a_id.eq.${childId},user_b_id.eq.${childId},leader_user_id.eq.${childId}`)).error)

  // 7. The account; every remaining table cascades from it.
  const { error: delErr } = await admin.auth.admin.deleteUser(childId)
  if (delErr) {
    problems.push(`account: ${delErr.message}`)
    try { await toTelegram(`⚠️ minor-consent withdraw incomplete for a child of ${user.id}\n${problems.join('\n')}`) } catch { /* monitor down */ }
    return json({ error: "Recording is off, but some of the data couldn't be deleted. Try again.", problems }, 500)
  }
  if (problems.length) console.warn('[minor-consent] withdraw non-fatal', problems)

  if (coachIds.length) {
    await admin.from('notifications').insert(coachIds.map((cid) => ({
      user_id: cid, type: 'consent_withdrawn',
      title: `${childName}'s data has been deleted`,
      body: 'Their parent withdrew permission. Recording is no longer possible for this student.',
      data: {},
    })))
  }
  const mode = deliveryMode()
  if (mode && user.email) {
    try {
      await sendEmail(mode, user.email, `Everything about ${childName} has been deleted`, [
        `You withdrew permission for ${childName} on InBetween.`, '',
        `All of ${childName}'s data has been deleted and recording has stopped. Their coach has been told.`,
      ].join('\n'))
    } catch (e) { console.error('[minor-consent] withdrawal email failed', e) }
  }
  return json({ ok: true, removedFiles, removedRecordings: recIds.length })
}

// ── a parent's mobile, proven on its own ────────────────────────────────────
// For a parent setting a child up without an invitation: the number is proven
// by a code before the child exists, and create-child-account refuses without
// the token handed back here.
const SMS_CODE_TTL_MIN = 10
const PHONE_TOKEN_TTL_MIN = 60

async function smsSend(admin: SupabaseClient, b: Row, ip: string) {
  const phone = normPhone(b.phone)
  if (!phone) return json({ error: 'Add your mobile number with its country code, like +44 7700 900123.' }, 400)
  const mode = smsMode()
  if (!mode) return json({ error: "Text message codes aren't available yet. Try again soon." }, 503)
  // Anything that sends texts without an account is a target for SMS-pumping
  // fraud, which bills the sender — so the caller and the number are both capped.
  if (await limited(admin, `sms:ip:${ip}`, 5, 3600)) return json({ error: 'Too many codes from here. Try again later.' }, 429)
  if (await limited(admin, `sms:phone:${await sha256(phone)}`, 3, 3600)) {
    return json({ error: 'Too many codes to this number. Try again later.' }, 429)
  }
  const code = randomCode(6, '0123456789')
  const { data: row, error } = await admin.from('phone_verifications').insert({
    phone, code_hash: await sha256(code), delivery_mode: mode,
    expires_at: new Date(Date.now() + SMS_CODE_TTL_MIN * 60000).toISOString(),
  }).select('id').single()
  if (error || !row) return json({ error: "We couldn't send the code." }, 500)
  try {
    await sendSms(mode, phone, `InBetween: your code is ${code}. It expires in ${SMS_CODE_TTL_MIN} minutes.`)
  } catch (e) {
    console.error('[minor-consent] sms send failed', e)
    await admin.from('phone_verifications').delete().eq('id', row.id)
    return json({ error: "We couldn't text that number. Check it and try again." }, 502)
  }
  return json({ verificationId: row.id, maskedPhone: maskPhone(phone), mode })
}

async function smsCheck(admin: SupabaseClient, b: Row, ip: string) {
  if (await limited(admin, `smscheck:ip:${ip}`, 20, 3600)) return json({ error: 'Too many attempts. Try again later.' }, 429)
  const id = str(b.verificationId, 40), code = str(b.code, 12).replace(/\D/g, '')
  if (code.length !== 6) return json({ error: 'Enter the 6-digit code.' }, 400)
  const { data: row } = await admin.from('phone_verifications').select('*').eq('id', id).maybeSingle()
  if (!row || row.used_at) return json({ error: 'Send a new code.' }, 404)
  if (new Date(row.expires_at) < new Date()) return json({ error: 'That code has expired. Send a new one.' }, 410)
  if (row.attempts >= MAX_VERIFY_ATTEMPTS) return json({ error: 'Too many wrong codes. Send a new one.' }, 423)
  // Always checked — a test-mode code reaches the Telegram monitor.
  if (row.code_hash !== await sha256(code)) {
    await admin.from('phone_verifications').update({ attempts: row.attempts + 1 }).eq('id', row.id)
    return json({ error: "That code doesn't match." }, 401)
  }
  const token = randomCode(40)
  await admin.from('phone_verifications').update({
    verified_at: row.verified_at || new Date().toISOString(),
    token_hash: await sha256(token),
    token_expires_at: new Date(Date.now() + PHONE_TOKEN_TTL_MIN * 60000).toISOString(),
  }).eq('id', row.id)
  return json({ phoneToken: token, maskedPhone: maskPhone(row.phone) })
}

// The wording, before anything exists: a parent setting their child up reads —
// and later has stored — exactly what an invited parent reads. The coach's name
// is looked up here, never taken from the caller.
async function copy(admin: SupabaseClient, b: Row) {
  const childName = str(b.childName, 60)
  if (!childName) return json({ error: "Add your child's first name." }, 400)
  let coachName: string | null = null
  const coachId = str(b.coachId, 40)
  if (coachId) {
    const { data } = await admin.from('users').select('name, role').eq('id', coachId).maybeSingle()
    if (data?.role === 'coach') coachName = data.name || null
  }
  return json({ copy: consentCopy(childName, coachName), termsVersion: TERMS_VERSION })
}

// The website's approval page calls this from the parent's browser, so the
// rate limits see the parent's own IP rather than one shared server address.
const WEB_ORIGINS = ['https://www.useinbetween.com', 'https://useinbetween.com']
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || ''
  const allowed = WEB_ORIGINS.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin)
  return allowed
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info', 'Vary': 'Origin' }
    : {}
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const res = await handle(req)
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
  return res
})

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  let body: Row
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  if (!body || typeof body !== 'object') return json({ error: 'Invalid JSON' }, 400)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const ip = ipOf(req)
  try {
    switch (body.action) {
      case 'invite': return await invite(admin, body, ip)
      case 'status': return await status(admin, body)
      case 'resend': return await resend(admin, body)
      case 'update': return await update(admin, body, ip)
      case 'cancel': return await cancel(admin, body)
      case 'invite-self': return await inviteSelf(admin, req, body, ip)
      case 'resend-self': return await resendSelf(admin, req)
      case 'verify': return await verify(admin, body, ip)
      case 'approve': return await approve(admin, body, ip)
      case 'withdraw': return await withdraw(admin, req, body, ip)
      case 'copy': return await copy(admin, body)
      case 'sms-send': return await smsSend(admin, body, ip)
      case 'sms-check': return await smsCheck(admin, body, ip)
      default: return json({ error: 'Unknown action' }, 400)
    }
  } catch (e) {
    console.error('[minor-consent]', body.action, e)
    return json({ error: 'Something went wrong. Try again in a moment.' }, 500)
  }
}
