// notify-audio-match
//
// Pings the ops Telegram chat when a DJI-mic recording enters
// admin_review_status='pending' — an uncertain audio↔class match the admin must
// confirm in the dashboard's Audio Matching section before its focus points
// reach students. Invoked by an AFTER-UPDATE trigger on class_recordings via
// pg_net (see migration 20260704_notify_audio_match.sql). Mirrors the existing
// monitor-report → Telegram pattern; reuses its sendMessage helper + the same
// TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID secrets.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendMessage } from './telegram.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Public base URL of the inbetween-admin dashboard, e.g. https://admin.example.com
// Set as a function secret so the Telegram message can deep-link to the review.
const ADMIN_BASE_URL = Deno.env.get('ADMIN_BASE_URL') ?? ''

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

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

Deno.serve(async (req) => {
  // Only the DB trigger (service-role bearer) may fire this.
  if (!jwtRoleIs(req.headers.get('Authorization') ?? '', 'service_role')) {
    return json({ error: 'forbidden' }, 403)
  }

  let body: { recording_id?: string } = {}
  try {
    body = await req.json()
  } catch { /* no body */ }
  const recordingId = body.recording_id
  if (!recordingId) return json({ error: 'recording_id required' }, 400)

  const { data: rec } = await supabase
    .from('class_recordings')
    .select('id, user_id, class_input_id, match_confidence, started_at, ended_at, lesson_type, admin_review_status')
    .eq('id', recordingId)
    .maybeSingle()
  // Only notify while it's actually pending (guards against a stale trigger).
  if (!rec || rec.admin_review_status !== 'pending') return json({ ok: true, skipped: true })

  const [{ data: coach }, { data: ci }] = await Promise.all([
    rec.user_id
      ? supabase.from('users').select('name, email').eq('id', rec.user_id).maybeSingle()
      : Promise.resolve({ data: null }),
    rec.class_input_id
      ? supabase.from('class_inputs').select('title').eq('id', rec.class_input_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const coachName = coach?.name || coach?.email || 'A coach'
  const title = ci?.title || rec.lesson_type || 'a class'
  const durMin =
    rec.started_at && rec.ended_at
      ? Math.round((new Date(rec.ended_at).getTime() - new Date(rec.started_at).getTime()) / 60000)
      : null
  const conf = rec.match_confidence ? ` · ${rec.match_confidence} confidence` : ''
  const link = ADMIN_BASE_URL
    ? `${ADMIN_BASE_URL.replace(/\/$/, '')}/audio-matching/${recordingId}`
    : ''

  const text = [
    '🎧 <b>Audio match needs review</b>',
    `${coachName} — ${title}${durMin ? ` (${durMin}m)` : ''}${conf}`,
    link,
  ]
    .filter(Boolean)
    .join('\n')

  const { message_id } = await sendMessage(text)
  return json({ ok: true, message_id })
})

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })
}
