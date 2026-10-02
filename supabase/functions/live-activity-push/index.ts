// live-activity-push
//
// Moves a coach's lesson Live Activity on while their phone is in a pocket.
// The app draws the activity while it runs (src/services/micPendingActivity.js)
// and leaves us each activity's push token and the lessons it follows
// (live_activity_tokens). When one of those lessons moves on the server —
// transcription starts, focus points are written, the class opens to the
// coach, a focus point is validated — a trigger calls this with the coach's
// id, and we push the activity's next state to Apple. Nothing left to follow:
// the activity ends.
//
// Callers: the triggers in 20261002a_live_activity_tokens.sql (service-role
// bearer, like notify-audio-lost). For ops and testing, { activity_id, state }
// pushes that exact state to one activity.
//
// A failed push costs a stale lock screen until the app is next opened, never
// data: the triggers swallow their own errors and the pipeline never waits.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { lessonRoadState } from '../_shared/lessonRoad.ts'
import { sendLiveActivity } from '../_shared/apns.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

function jwtRoleIs(authHeader: string, expectedRole: string): boolean {
  const m = authHeader.match(/^\s*Bearer\s+(.+)$/i)
  if (!m) return false
  const parts = m[1].trim().split('.')
  if (parts.length !== 3) return false
  try {
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = payload.length % 4
    if (pad) payload += '='.repeat(4 - pad)
    return JSON.parse(atob(payload))?.role === expectedRole
  } catch {
    return false
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// jsonb hands keys back in its own order: compare states key-sorted.
function canon(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
}

// Apple no longer knows this activity: forget it.
const GONE = new Set(['BadDeviceToken', 'Unregistered', 'ExpiredToken'])

// A burst of trigger calls for one coach (one row per dancer when a group focus
// point is validated; the 18h auto-publish touching many) waits this long and
// lets only the latest call send — the final state, once, read after the last
// write. Measured: 30 calls in one burst otherwise meant 30 pushes landing in
// any order.
const SETTLE_MS = 2000

Deno.serve(async (req) => {
  if (!jwtRoleIs(req.headers.get('Authorization') ?? '', 'service_role')) {
    return json({ error: 'forbidden' }, 403)
  }

  let body: { user_id?: string; activity_id?: string; state?: Record<string, unknown> } = {}
  try {
    body = await req.json()
  } catch { /* no body */ }
  if (!body.user_id && !body.activity_id) return json({ error: 'user_id or activity_id required' }, 400)

  if (!body.state && body.user_id) {
    const { data: stamp, error: claimErr } = await supabase.rpc('live_activity_claim', { p_user: body.user_id })
    if (claimErr) return json({ error: claimErr.message }, 500)
    const mine = Array.isArray(stamp) ? stamp[0] : stamp
    if (!mine) return json({ ok: true, results: [], note: 'no activity' })
    await new Promise((r) => setTimeout(r, SETTLE_MS))
    const { data: latest } = await supabase
      .from('live_activity_tokens')
      .select('push_requested_at')
      .eq('user_id', body.user_id)
      .order('push_requested_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    if (latest && latest.push_requested_at !== mine) {
      return json({ ok: true, results: [], note: 'superseded' })
    }
  }

  let q = supabase
    .from('live_activity_tokens')
    .select('activity_id, user_id, push_token, apns_env, recording_ids, last_state')
  q = body.activity_id ? q.eq('activity_id', body.activity_id) : q.eq('user_id', body.user_id)
  const { data: rows, error } = await q
  if (error) return json({ error: error.message }, 500)

  const results: any[] = []
  for (const row of rows ?? []) {
    try {
      const forced = body.state ?? null
      const state = forced ?? await lessonRoadState(supabase, row.recording_ids ?? [])

      if (!state) {
        const r = await sendLiveActivity(supabase, row.push_token, row.apns_env, {
          event: 'end',
          contentState: row.last_state,
          priority: 10,
        })
        await supabase.from('live_activity_tokens').delete().eq('activity_id', row.activity_id)
        results.push({ activity_id: row.activity_id, sent: 'end', ...r })
        continue
      }

      if (!forced && canon(state) === canon(row.last_state)) {
        results.push({ activity_id: row.activity_id, sent: null, note: 'unchanged' })
        continue
      }

      const stage = (state as any).stage
      // iOS rations immediate updates. Spend them on arriving at a step that
      // asks something of the coach; a count going down (3 ready → 2) can wait.
      const arriving = (stage === 'ready' || stage === 'waiting') && row.last_state?.stage !== stage
      const r = await sendLiveActivity(supabase, row.push_token, row.apns_env, {
        event: 'update',
        contentState: state,
        priority: forced || arriving ? 10 : 5,
      })
      if (r.ok) {
        await supabase
          .from('live_activity_tokens')
          .update({ last_state: state, apns_env: r.env, updated_at: new Date().toISOString() })
          .eq('activity_id', row.activity_id)
      } else if (r.status === 410 || (r.reason && GONE.has(r.reason))) {
        await supabase.from('live_activity_tokens').delete().eq('activity_id', row.activity_id)
      }
      results.push({ activity_id: row.activity_id, sent: stage, ...r })
    } catch (e) {
      console.error('[live-activity-push]', row.activity_id, e)
      results.push({ activity_id: row.activity_id, error: String((e as Error)?.message ?? e) })
    }
  }
  return json({ ok: true, results })
})
