// live-activity-restart
//
// Puts the red "No audio yet" Live Activity back on a coach's phone without
// the app being opened (push-to-start, iOS 17.2+), for lessons that still wait
// for their DJI audio. The app shows it at the end of a lesson and whenever it
// opens; this covers the coach who closed it, or who never opens the app — in
// practice it reappears the morning after.
//
// pg_cron runs it hourly (20261005a_live_activity_push_to_start.sql). For each
// coach with a push-to-start token, it starts one when:
//   • it's daytime in London (09:00–18:59)
//   • lessons ended 2h–14d ago still have no audio (and weren't written off)
//   • no activity of theirs can still be on screen (none filed in 8h)
//   • none was started for them in the last 20 hours
//
// For ops and testing, { user_id, state } (service role) starts that exact
// state on the coach's phones right away, skipping every rule.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { waitingState, lessonPhrase } from '../_shared/lessonRoad.ts'
import { sendLiveActivity } from '../_shared/apns.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const FIRST_HOUR = 9
const LAST_HOUR = 18
const MIN_AGE_MS = 2 * 3600 * 1000
const MAX_AGE_MS = 14 * 24 * 3600 * 1000
const ALIVE_MS = 8 * 3600 * 1000
const AGAIN_MS = 20 * 3600 * 1000
// A Start/Stop tapped by mistake isn't a lesson (same floor as the app).
const MIN_LESSON_SEC = 60

// Apple no longer knows this token: forget it.
const GONE = new Set(['BadDeviceToken', 'Unregistered', 'ExpiredToken'])

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

function londonHour(d: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(d))
}

function alertFor(waiting: any[]): { title: string; body: string } {
  return {
    title: 'No audio yet',
    body: waiting.length === 1
      ? `Plug in your mic to get the focus points from ${lessonPhrase(waiting[0])}.`
      : `Plug in your mic to get the focus points from your ${waiting.length} lessons.`,
  }
}

async function startOn(rows: any[], state: Record<string, unknown>, alert: { title: string; body: string }) {
  const results: any[] = []
  for (const row of rows) {
    const r = await sendLiveActivity(supabase, row.token, row.apns_env, {
      event: 'start',
      contentState: state,
      attributesType: 'MicPendingAttributes',
      attributes: {},
      alert,
      priority: 10,
    })
    if (r.ok) {
      await supabase
        .from('live_activity_start_tokens')
        .update({ last_started_at: new Date().toISOString(), apns_env: r.env })
        .eq('token', row.token)
    } else if (r.status === 410 || (r.reason && GONE.has(r.reason))) {
      await supabase.from('live_activity_start_tokens').delete().eq('token', row.token)
    }
    results.push({ user_id: row.user_id, ...r })
  }
  return results
}

Deno.serve(async (req) => {
  if (!jwtRoleIs(req.headers.get('Authorization') ?? '', 'service_role')) {
    return json({ error: 'forbidden' }, 403)
  }
  let body: { user_id?: string; state?: Record<string, unknown> } = {}
  try {
    body = await req.json()
  } catch { /* no body */ }

  // Ops / testing: this state, on this coach's phones, now.
  if (body.user_id && body.state) {
    const { data: rows } = await supabase
      .from('live_activity_start_tokens')
      .select('token, user_id, apns_env')
      .eq('user_id', body.user_id)
    const results = await startOn(rows ?? [], body.state, {
      title: String(body.state.title ?? 'InBetween'),
      body: String(body.state.detail ?? ''),
    })
    return json({ ok: true, forced: true, results })
  }

  const now = new Date()
  const hour = londonHour(now)
  if (hour < FIRST_HOUR || hour > LAST_HOUR) return json({ ok: true, note: `night (${hour}h London)` })

  const { data: tokens, error } = await supabase
    .from('live_activity_start_tokens')
    .select('token, user_id, apns_env, last_started_at')
  if (error) return json({ error: error.message }, 500)

  const byUser = new Map<string, any[]>()
  for (const t of tokens ?? []) {
    if (t.last_started_at && now.getTime() - new Date(t.last_started_at).getTime() < AGAIN_MS) continue
    byUser.set(t.user_id, [...(byUser.get(t.user_id) ?? []), t])
  }

  const results: any[] = []
  for (const [userId, rows] of byUser) {
    // Something of theirs may still be on screen.
    const { count: alive } = await supabase
      .from('live_activity_tokens')
      .select('activity_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gt('created_at', new Date(now.getTime() - ALIVE_MS).toISOString())
    if ((alive ?? 0) > 0) continue

    const { data: recs } = await supabase
      .from('class_recordings')
      .select('id, lesson_type, started_at, ended_at, meta, student:student_id(name)')
      .eq('user_id', userId)
      .eq('local_recording_mode', true)
      .is('mic_file_name', null)
      .is('sync_abandoned_at', null)
      .not('status', 'in', '(discarded,failed)')
      .lt('ended_at', new Date(now.getTime() - MIN_AGE_MS).toISOString())
      .gt('ended_at', new Date(now.getTime() - MAX_AGE_MS).toISOString())
    const waiting: any[] = (recs ?? []).filter((r: any) => {
      if (r.meta?.duration_unknown === true) return true
      const sec = (new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 1000
      return sec >= MIN_LESSON_SEC
    })
    if (!waiting.length) continue

    results.push(...await startOn(rows, waitingState(waiting), alertFor(waiting)))
  }
  return json({ ok: true, started: results.filter((r) => r.ok).length, results })
})
