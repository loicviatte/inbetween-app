// Talking to Apple's push service directly, for what Expo's push service can't
// carry: Live Activity updates (apns-push-type: liveactivity).
//
// Secrets: APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (the .p8 file's text),
// APNS_BUNDLE_ID. The key is ours (8DJ54GPH89), not the one Expo keeps for the
// app's ordinary notifications.

// deno-lint-ignore-file no-explicit-any

const KEY_ID = Deno.env.get('APNS_KEY_ID') ?? ''
const TEAM_ID = Deno.env.get('APNS_TEAM_ID') ?? ''
const PRIVATE_KEY = Deno.env.get('APNS_PRIVATE_KEY') ?? ''
const BUNDLE_ID = Deno.env.get('APNS_BUNDLE_ID') ?? 'com.loicviatte.inbetweenapp'

// Apple wants the same provider token for 20–60 minutes; a new one on every
// push is refused ("TooManyProviderTokenUpdates").
const TOKEN_TTL_MS = 40 * 60 * 1000

export type ApnsEnv = 'sandbox' | 'production'

const HOSTS: Record<ApnsEnv, string> = {
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
}

function b64url(bytes: Uint8Array | string): string {
  const bin = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function signProviderToken(): Promise<string> {
  const pem = PRIVATE_KEY.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID }))
  const claims = b64url(JSON.stringify({ iss: TEAM_ID, iat: Math.floor(Date.now() / 1000) }))
  const input = `${header}.${claims}`
  // WebCrypto signs ECDSA as raw r‖s — exactly what ES256 wants.
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input)),
  )
  return `${input}.${b64url(sig)}`
}

/** The provider token, reused across calls through apns_provider_tokens. */
export async function providerToken(supabase: any, fresh = false): Promise<string> {
  if (!KEY_ID || !TEAM_ID || !PRIVATE_KEY) throw new Error('APNs secrets missing')
  if (!fresh) {
    const { data } = await supabase
      .from('apns_provider_tokens')
      .select('token, issued_at')
      .eq('key_id', KEY_ID)
      .maybeSingle()
    if (data && Date.now() - new Date(data.issued_at).getTime() < TOKEN_TTL_MS) return data.token
  }
  const token = await signProviderToken()
  await supabase
    .from('apns_provider_tokens')
    .upsert({ key_id: KEY_ID, token, issued_at: new Date().toISOString() })
  return token
}

export type LiveActivityPush = {
  event: 'update' | 'end'
  contentState?: Record<string, unknown> | null
  // 10 = now; 5 = when convenient (iOS budgets the 10s).
  priority?: 5 | 10
}

export type ApnsResult = { ok: boolean; status: number; reason?: string; env: ApnsEnv }

async function post(env: ApnsEnv, token: string, jwt: string, body: string, priority: number): Promise<ApnsResult> {
  const res = await fetch(`${HOSTS[env]}/3/device/${token}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-push-type': 'liveactivity',
      'apns-topic': `${BUNDLE_ID}.push-type.liveactivity`,
      'apns-priority': String(priority),
      'content-type': 'application/json',
    },
    body,
  })
  let reason: string | undefined
  if (!res.ok) {
    try {
      reason = (await res.json())?.reason
    } catch { /* empty body */ }
  } else {
    await res.body?.cancel()
  }
  return { ok: res.ok, status: res.status, reason, env }
}

/**
 * Sends one Live Activity push. Retries once with a fresh provider token when
 * Apple says it expired, and once on the other environment when the device
 * token doesn't belong to this one (a local build talks to the sandbox).
 */
export async function sendLiveActivity(
  supabase: any,
  pushToken: string,
  env: ApnsEnv,
  push: LiveActivityPush,
): Promise<ApnsResult> {
  const now = Math.floor(Date.now() / 1000)
  const aps: Record<string, unknown> = { timestamp: now, event: push.event }
  if (push.contentState) aps['content-state'] = push.contentState
  if (push.event === 'end') aps['dismissal-date'] = now
  const body = JSON.stringify({ aps })
  const priority = push.priority ?? 10

  let jwt = await providerToken(supabase)
  let result = await post(env, pushToken, jwt, body, priority)
  if (result.status === 403 && result.reason === 'ExpiredProviderToken') {
    jwt = await providerToken(supabase, true)
    result = await post(env, pushToken, jwt, body, priority)
  }
  if (result.status === 400 && result.reason === 'BadDeviceToken') {
    const other: ApnsEnv = env === 'sandbox' ? 'production' : 'sandbox'
    const retry = await post(other, pushToken, jwt, body, priority)
    if (retry.ok) return retry
  }
  return result
}
