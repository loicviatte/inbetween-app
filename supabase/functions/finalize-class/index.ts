// finalize-class
//
// HTTP wrapper around the shared `finalizeRecording` logic. Called by the
// client (with user JWT) when the coach hits Done. The retry cron sweep
// imports the shared module directly rather than calling this — avoids
// auth-header transformation gotchas at the edge gateway.
//
// Idempotent: every state transition is guarded so a recording can be
// poked multiple times safely (cron retries, double-tap on Done, etc.).
//
// Auth:
//   - User JWT: we verify ownership via auth.uid() vs class_recordings.user_id
//   - Service role: pass-through (used by tests / scripts)
//
// Required env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
//   ASSEMBLYAI_API_KEY, ASSEMBLYAI_WEBHOOK_SECRET, FUNCTIONS_PUBLIC_URL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { finalizeRecording } from '../_shared/finalize-recording.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY')!
const ASSEMBLYAI_WEBHOOK_SECRET = Deno.env.get('ASSEMBLYAI_WEBHOOK_SECRET')!
const FUNCTIONS_PUBLIC_URL =
  Deno.env.get('FUNCTIONS_PUBLIC_URL') ?? `${SUPABASE_URL}/functions/v1`

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

interface FinalizeBody {
  recording_id: string
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Decode the JWT payload from a `Bearer <token>` Authorization header and
 * check whether the `role` claim matches. Returns false on any decode error
 * — we never throw out of an auth check.
 */
function jwtRoleIs(authHeader: string, expectedRole: string): boolean {
  const m = authHeader.match(/^\s*Bearer\s+(.+)$/i)
  if (!m) return false
  const token = m[1].trim()
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = payload.length % 4
    if (pad) payload += '='.repeat(4 - pad)
    const decoded = JSON.parse(atob(payload))
    return decoded?.role === expectedRole
  } catch {
    return false
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405)

  let body: FinalizeBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }
  const recordingId = body?.recording_id
  if (!recordingId || typeof recordingId !== 'string') {
    return jsonResponse({ error: 'recording_id required' }, 400)
  }

  const authHeader = req.headers.get('Authorization') || ''
  const isServiceRole = jwtRoleIs(authHeader, 'service_role')
  if (!isServiceRole) {
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData?.user) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }
    const { data: ownership, error: ownErr } = await supabase
      .from('class_recordings')
      .select('user_id')
      .eq('id', recordingId)
      .maybeSingle()
    if (ownErr) return jsonResponse({ error: ownErr.message }, 500)
    if (!ownership || ownership.user_id !== userData.user.id) {
      return jsonResponse({ error: 'Forbidden' }, 403)
    }
  }

  try {
    const result = await finalizeRecording(recordingId, {
      supabase,
      assemblyaiApiKey: ASSEMBLYAI_API_KEY,
      assemblyaiWebhookSecret: ASSEMBLYAI_WEBHOOK_SECRET,
      functionsPublicUrl: FUNCTIONS_PUBLIC_URL,
    })
    return jsonResponse(result, result.status === 'waiting' ? 202 : 200)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[finalize-class] error:', msg)
    await supabase
      .from('class_recordings')
      .update({ error: msg })
      .eq('id', recordingId)
    return jsonResponse({ error: msg }, 500)
  }
})
