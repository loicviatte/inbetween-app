// ─── age-check ──────────────────────────────────────────────────────────────
// A coach said a student is under 18 (coach_set_student_age), so the
// student's account is locked. The student gets it back one of two ways:
//
//   status            the locked student's phone: where things stand
//   submit-proof      the student uploaded a photo of an ID (date of birth
//                     showing, the rest hidden) to the private age-proofs
//                     bucket: it is queued for InBetween, which decides from
//                     the admin dashboard and deletes the photo straight away
//   send-adult-link / confirm-adult
//                     an email link to self-confirm (no longer offered in the
//                     app; kept so links already sent still work)
//
// Asking the coach to review is an SQL function (request_coach_age_review);
// a parent approving runs in minor-consent (invite-self).
// status / send-adult-link check the student's JWT; confirm-adult is public
// and proven by the link, and answers CORS for the website only.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const LINK_TTL_H = 24
const CONFIRM_URL = 'https://www.useinbetween.com/auth/confirm-age'
const WEB_ORIGINS = ['https://www.useinbetween.com', 'https://useinbetween.com']
const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZabcdefghjkmnpqrstvwxyz23456789'

type Row = Record<string, any>
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const firstName = (n: unknown) => String(n || '').trim().split(/\s+/)[0] || ''
const maskEmail = (e: string) => {
  const [u, d] = e.split('@')
  return `${u.slice(0, 1)}${'•'.repeat(Math.max(1, Math.min(6, u.length - 1)))}@${d}`
}
const maskPhone = (p: string | null) => (p ? `${p.slice(0, 3)} ••• ••${p.slice(-2)}` : null)

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
function randomToken(len: number) {
  const max = Math.floor(256 / TOKEN_ALPHABET.length) * TOKEN_ALPHABET.length
  const out: string[] = []
  while (out.length < len) {
    for (const b of crypto.getRandomValues(new Uint8Array(len * 2))) {
      if (b < max && out.length < len) out.push(TOKEN_ALPHABET[b % TOKEN_ALPHABET.length])
    }
  }
  return out.join('')
}

async function limited(admin: SupabaseClient, key: string, max: number, windowSec: number) {
  const since = new Date(Date.now() - windowSec * 1000).toISOString()
  const { count } = await admin.from('consent_rate_hits')
    .select('id', { count: 'exact', head: true }).eq('key', key).gte('created_at', since)
  if ((count ?? 0) >= max) return true
  await admin.from('consent_rate_hits').insert({ key })
  return false
}

async function signedIn(admin: SupabaseClient, req: Request) {
  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return null
  const { data: { user } } = await admin.auth.getUser(auth.slice(7))
  return user ?? null
}

async function status(admin: SupabaseClient, req: Request) {
  const user = await signedIn(admin, req)
  if (!user) return json({ error: 'Sign in again.' }, 401)
  // Never who flagged the account: the student only learns their age is being checked.
  const { data: me } = await admin.from('users').select('age_check, consent_status, age_check_at').eq('id', user.id).maybeSingle()
  const { data: inv } = await admin.from('parental_consents')
    .select('status, parent_first_name, parent_email, parent_phone, expires_at')
    .eq('child_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  // Only reviews of this lock: an answer from an earlier one says nothing now.
  let reviewQuery = admin.from('age_reviews').select('kind, status, created_at')
    .eq('student_id', user.id).order('created_at', { ascending: false })
  if (me?.age_check_at) reviewQuery = reviewQuery.gte('created_at', me.age_check_at)
  const { data: reviews } = await reviewQuery
  const latest = (kind: string) => (reviews || []).find((r: Row) => r.kind === kind)?.status ?? null
  const invite = inv && inv.status === 'pending' ? {
    status: new Date(inv.expires_at) < new Date() ? 'expired' : 'pending',
    parentFirstName: inv.parent_first_name,
    maskedEmail: maskEmail(inv.parent_email),
    maskedPhone: maskPhone(inv.parent_phone),
  } : null
  return json({
    ageCheck: me?.age_check ?? null,
    consentStatus: me?.consent_status ?? null,
    coachReview: latest('coach'),     // pending | approved | rejected | null
    proofReview: latest('proof'),
    email: user.email?.endsWith('@managed.useinbetween.com') ? null : maskEmail(user.email || ''),
    invite,
  })
}

async function sendAdultLink(admin: SupabaseClient, req: Request) {
  const user = await signedIn(admin, req)
  if (!user) return json({ error: 'Sign in again.' }, 401)
  const { data: me } = await admin.from('users').select('name, age_check, age_check_by').eq('id', user.id).maybeSingle()
  if (me?.age_check !== 'minor_pending') return json({ error: 'Your account doesn’t need this.' }, 409)
  const email = user.email || ''
  if (!email || email.endsWith('@managed.useinbetween.com')) return json({ error: 'Your account has no email we can write to.' }, 409)
  const key = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('CONSENT_EMAIL_FROM')
  if (!key || !from) return json({ error: 'Email isn’t available right now. Try again soon.' }, 503)
  if (await limited(admin, `agecheck:user:${user.id}`, 3, 3600)) {
    return json({ error: 'We’ve sent a few already. Check your inbox and spam, or try again in an hour.' }, 429)
  }

  await admin.from('age_confirm_tokens').delete().eq('user_id', user.id).is('used_at', null)
  const token = randomToken(40)
  const { error } = await admin.from('age_confirm_tokens').insert({
    user_id: user.id, token_hash: await sha256(token),
    expires_at: new Date(Date.now() + LINK_TTL_H * 3600000).toISOString(),
  })
  if (error) return json({ error: 'We couldn’t send the email. Try again.' }, 500)

  const link = `${CONFIRM_URL}?token=${token}`
  const name = firstName(me.name)
  const subject = 'Confirm you’re 18 or over'
  const text = [
    `Hi${name ? ` ${name}` : ''},`, '',
    'We think you might be under 18, so your InBetween account is locked for now.', '',
    'If you’re 18 or over, confirm it here:', link, '',
    'If you’re under 18, don’t use this link: open the app and ask a parent to approve instead.', '',
    `The link works once, for ${LINK_TTL_H} hours.`,
  ].join('\n')
  const F = 'font-family:Helvetica,Arial,sans-serif;'
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#000000;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000000;"><tr><td align="center" style="padding:44px 20px 52px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
<tr><td style="padding:0 0 40px;"><img src="https://www.useinbetween.com/images/logo-lockup-white.png" width="150" alt="InBetween" style="display:block;width:150px;height:auto;border:0;"></td></tr>
<tr><td style="${F}font-size:28px;line-height:34px;font-weight:700;letter-spacing:-0.4px;color:#F7F6F3;padding:0 0 14px;">Confirm you&rsquo;re 18 or over</td></tr>
<tr><td style="${F}font-size:16px;line-height:25px;color:#B5B5B5;padding:0 0 30px;">We think you might be under 18, so your InBetween account is locked for now. If you&rsquo;re 18 or over, confirm it and your account unlocks.</td></tr>
<tr><td style="padding:0 0 30px;"><a href="${esc(link)}" style="display:inline-block;background:#F0C24A;color:#000000;${F}font-size:16px;line-height:20px;font-weight:700;text-decoration:none;padding:16px 30px;border-radius:999px;">Confirm I&rsquo;m 18 or over</a></td></tr>
<tr><td style="${F}font-size:14px;line-height:22px;color:#B5B5B5;padding:0 0 24px;">If you&rsquo;re under 18, don&rsquo;t use this link: open the app and ask a parent to approve instead.</td></tr>
<tr><td style="${F}font-size:13px;line-height:20px;color:#8A8A8A;border-top:1px solid #1F1F1F;padding:22px 0 0;">The link works once, for ${LINK_TTL_H} hours.</td></tr>
</table></td></tr></table></body></html>`

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [email], subject, text, html }),
  })
  if (!r.ok) {
    console.error('[age-check] resend', r.status, await r.text())
    return json({ error: 'We couldn’t send the email. Try again.' }, 502)
  }
  return json({ maskedEmail: maskEmail(email) })
}

const PROOF_BUCKET = 'age-proofs'
const ADMIN_URL = 'https://inbetween-admin.vercel.app/age-proofs'

async function submitProof(admin: SupabaseClient, req: Request, b: Row) {
  const user = await signedIn(admin, req)
  if (!user) return json({ error: 'Sign in again.' }, 401)
  const { data: me } = await admin.from('users').select('name, age_check').eq('id', user.id).maybeSingle()
  if (me?.age_check !== 'minor_pending') return json({ error: 'Your account doesn’t need this.' }, 409)
  const path = String(b.path ?? '')
  if (!path.startsWith(`${user.id}/`) || path.includes('..')) return json({ error: 'That upload isn’t yours.' }, 400)
  if (await limited(admin, `ageproof:user:${user.id}`, 5, 86400)) {
    return json({ error: 'You’ve sent a few already today. We’ll check the last one.' }, 429)
  }
  const folder = path.split('/')[0], file = path.split('/').slice(1).join('/')
  const { data: listed } = await admin.storage.from(PROOF_BUCKET).list(folder, { search: file })
  if (!listed?.some((f: Row) => f.name === file)) return json({ error: 'The photo didn’t upload. Try again.' }, 400)

  // One photo waiting at a time: a new one replaces the last.
  const { data: older } = await admin.from('age_reviews').select('id, proof_path')
    .eq('student_id', user.id).eq('kind', 'proof').eq('status', 'pending')
  const stale = (older || []).map((r: Row) => r.proof_path).filter((p: string) => p && p !== path)
  if (stale.length) await admin.storage.from(PROOF_BUCKET).remove(stale)
  if (older?.length) await admin.from('age_reviews').delete().in('id', older.map((r: Row) => r.id))

  const { error } = await admin.from('age_reviews').insert({ student_id: user.id, kind: 'proof', proof_path: path })
  if (error) return json({ error: 'We couldn’t send it. Try again.' }, 500)

  const token = Deno.env.get('TELEGRAM_BOT_TOKEN'), chat = Deno.env.get('TELEGRAM_CHAT_ID')
  if (token && chat) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat,
        text: `🪪 Proof of age to check: ${firstName(me.name) || 'a student'}\n${ADMIN_URL}`,
        link_preview_options: { is_disabled: true },
      }),
    }).catch(() => {})
  }
  return json({ ok: true })
}

async function confirmAdult(admin: SupabaseClient, b: Row) {
  const token = String(b.token ?? '').trim()
  if (token.length < 20 || token.length > 80) return json({ error: 'invalid_link' }, 400)
  const { data: row } = await admin.from('age_confirm_tokens').select('*')
    .eq('token_hash', await sha256(token)).is('used_at', null).maybeSingle()
  if (!row || new Date(row.expires_at) < new Date()) return json({ error: 'expired' }, 410)

  const { data: spent } = await admin.from('age_confirm_tokens').update({ used_at: new Date().toISOString() })
    .eq('id', row.id).is('used_at', null).select('id')
  if (!spent?.length) return json({ error: 'expired' }, 410)

  const { data: me } = await admin.from('users').select('name, age_check, age_check_by').eq('id', row.user_id).maybeSingle()
  if (!me) return json({ error: 'expired' }, 410)
  if (me.age_check !== 'minor_pending') return json({ ok: true, firstName: firstName(me.name), already: true })

  const { error } = await admin.from('users')
    .update({ age_check: 'adult_confirmed', consent_status: 'not_required', age_check_at: new Date().toISOString() })
    .eq('id', row.user_id).eq('age_check', 'minor_pending')
  if (error) return json({ error: 'server' }, 500)

  // A parent invitation sent in the meantime has nothing left to approve.
  await admin.from('parental_consents')
    .update({ status: 'expired', email_token_hash: null, sms_code_hash: null, ticket_hash: null, ticket_expires_at: null })
    .eq('child_id', row.user_id).eq('status', 'pending')

  if (me.age_check_by) {
    await admin.from('notifications').insert({
      user_id: me.age_check_by, type: 'age_check_adult_confirmed',
      title: `${firstName(me.name) || 'Your student'} confirmed they’re 18 or over`,
      body: 'They confirmed it by email, so their lessons can be captured again.',
      data: { student_id: row.user_id },
    })
  }
  return json({ ok: true, firstName: firstName(me.name) })
}

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || ''
  const allowed = WEB_ORIGINS.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin)
  return allowed
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info', 'Vary': 'Origin' }
    : {}
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  let body: Row
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  if (!body || typeof body !== 'object') return json({ error: 'Invalid JSON' }, 400)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    switch (body.action) {
      case 'status': return await status(admin, req)
      case 'send-adult-link': return await sendAdultLink(admin, req)
      case 'submit-proof': return await submitProof(admin, req, body)
      case 'confirm-adult': return await confirmAdult(admin, body)
      default: return json({ error: 'Unknown action' }, 400)
    }
  } catch (e) {
    console.error('[age-check]', body.action, e)
    return json({ error: 'Something went wrong. Try again in a moment.' }, 500)
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const res = await handle(req)
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
  return res
})
