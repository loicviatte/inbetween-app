// ─── child-pairing ──────────────────────────────────────────────────────────
// A child trains on their own phone, signed in to their own profile, without
// ever knowing their parent's password.
//
//   create   the parent (signed in) asks for a code for one of their children:
//            6 characters, 10 minutes, one use
//   claim    the child's phone sends the code and gets back a one-time sign-in
//            token for the child's profile — the app turns it into a session
//   status   the parent sees whether a phone is signed in to the profile
//   signout  the parent signs every phone out of it
//
// create / status / signout check the parent's JWT and the guardians link
// themselves; claim has no account to check, so it is rate-limited by IP.
// The code is only ever stored as a hash. The sign-in token comes from
// auth.admin.generateLink, which sends no email.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CODE_TTL_MIN = 10
const CODE_LEN = 6
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'   // no 0/O, 1/I/L, U
const CLAIM_LIMIT_PER_HOUR = 10
const PAIRABLE = ['granted', 'not_required']

type Row = Record<string, any>
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const normCode = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const ipOf = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
function randomCode(len: number) {
  const max = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length
  const out: string[] = []
  while (out.length < len) {
    for (const b of crypto.getRandomValues(new Uint8Array(len * 2))) {
      if (b < max && out.length < len) out.push(CODE_ALPHABET[b % CODE_ALPHABET.length])
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

// The signed-in parent and one of their children, or a response saying why not.
async function parentAndChild(admin: SupabaseClient, req: Request, b: Row) {
  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return { error: json({ error: 'Sign in again.' }, 401) }
  const { data: { user }, error } = await admin.auth.getUser(auth.slice(7))
  if (error || !user) return { error: json({ error: 'Sign in again.' }, 401) }
  const childId = str(b.childId, 40)
  const { data: link } = await admin.from('guardians').select('id')
    .eq('guardian_id', user.id).eq('child_id', childId).maybeSingle()
  if (!link) return { error: json({ error: "This isn't one of your children." }, 403) }
  const { data: child } = await admin.from('users').select('id, name, consent_status').eq('id', childId).maybeSingle()
  if (!child) return { error: json({ error: 'This profile no longer exists.' }, 404) }
  return { user, child }
}

async function create(admin: SupabaseClient, req: Request, b: Row) {
  const r = await parentAndChild(admin, req, b)
  if (r.error) return r.error
  const { user, child } = r
  if (!PAIRABLE.includes(child.consent_status)) {
    return json({ error: `${child.name || 'Your child'} can't be signed in until permission is given.` }, 409)
  }
  // One live code per child: asking again replaces the last one.
  await admin.from('child_pairing_codes').delete().eq('child_id', child.id).is('used_at', null)
  const code = randomCode(CODE_LEN)
  const expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60000).toISOString()
  const { error } = await admin.from('child_pairing_codes').insert({
    guardian_id: user.id, child_id: child.id, code_hash: await sha256(code), expires_at: expiresAt,
  })
  if (error) return json({ error: "We couldn't make a code. Try again." }, 500)
  return json({ code, expiresAt, childName: child.name })
}

async function claim(admin: SupabaseClient, b: Row, ip: string) {
  if (await limited(admin, `pair:ip:${ip}`, CLAIM_LIMIT_PER_HOUR, 3600)) {
    return json({ error: 'Too many tries. Wait a little and try again.' }, 429)
  }
  const code = normCode(b.code)
  if (code.length !== CODE_LEN) return json({ error: `The code has ${CODE_LEN} characters.` }, 400)

  const { data: row } = await admin.from('child_pairing_codes').select('*')
    .eq('code_hash', await sha256(code)).is('used_at', null).maybeSingle()
  if (!row || new Date(row.expires_at) < new Date()) {
    return json({ error: "That code didn't work. Codes last 10 minutes — ask your parent for a new one." }, 404)
  }
  // Spend it first; if two phones race, only one gets through.
  const { data: spent } = await admin.from('child_pairing_codes').update({ used_at: new Date().toISOString() })
    .eq('id', row.id).is('used_at', null).select('id')
  if (!spent?.length) return json({ error: 'That code has just been used. Ask your parent for a new one.' }, 409)

  const [{ data: au }, { data: child }] = await Promise.all([
    admin.auth.admin.getUserById(row.child_id),
    admin.from('users').select('name, consent_status').eq('id', row.child_id).maybeSingle(),
  ])
  const email = au?.user?.email
  if (!email || !child || !PAIRABLE.includes(child.consent_status)) {
    return json({ error: "This profile can't be signed in to right now." }, 409)
  }
  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = link?.properties?.hashed_token
  if (error || !tokenHash) {
    console.error('[child-pairing] generateLink failed', error?.message)
    return json({ error: "We couldn't sign you in. Try again in a moment." }, 500)
  }

  // The parent hears about it — and would notice a phone that isn't their child's.
  await admin.from('notifications').insert({
    user_id: row.guardian_id, type: 'child_phone_linked',
    title: `${child.name || 'Your child'}'s phone is signed in`,
    body: `${child.name || 'Your child'} can now train on their own phone. You can sign it out from Stats ▸ Links.`,
    data: { child_id: row.child_id },
  })
  return json({ tokenHash, childName: child.name })
}

async function status(admin: SupabaseClient, req: Request, b: Row) {
  const r = await parentAndChild(admin, req, b)
  if (r.error) return r.error
  const { data, error } = await admin.rpc('child_phone_status', { p_child: r.child.id })
  if (error) return json({ error: "We couldn't check." }, 500)
  const sessions = Number(data?.sessions ?? 0)
  return json({ linked: sessions > 0, sessions, lastSeen: data?.last_seen ?? null })
}

async function signout(admin: SupabaseClient, req: Request, b: Row) {
  const r = await parentAndChild(admin, req, b)
  if (r.error) return r.error
  await admin.from('child_pairing_codes').delete().eq('child_id', r.child.id).is('used_at', null)
  const { error } = await admin.rpc('revoke_child_sessions', { p_child: r.child.id })
  if (error) return json({ error: "We couldn't sign the phone out. Try again." }, 500)
  return json({ ok: true })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  let body: Row
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  if (!body || typeof body !== 'object') return json({ error: 'Invalid JSON' }, 400)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    switch (body.action) {
      case 'create': return await create(admin, req, body)
      case 'claim': return await claim(admin, body, ipOf(req))
      case 'status': return await status(admin, req, body)
      case 'signout': return await signout(admin, req, body)
      default: return json({ error: 'Unknown action' }, 400)
    }
  } catch (e) {
    console.error('[child-pairing]', body.action, e)
    return json({ error: 'Something went wrong. Try again in a moment.' }, 500)
  }
})
