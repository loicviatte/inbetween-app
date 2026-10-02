// notify-audio-missing
//
// Tells the admin on Telegram when a DJI-mic lesson still has no audio 8
// hours after it ended. Since 2026-10-02 the admin no longer reads every
// lesson (20261002b_classes_open_on_scoring.sql); Telegram only carries what
// went wrong, and a lesson whose audio never arrives is the commonest way a
// lesson gets lost. By then the coach has had the Live Activity, the
// two-hour nudge and — if it's evening — the 20:00 reminder: it's a human's
// turn to ask.
//
// Run every 15 minutes by pg_cron with a service-role bearer. Each lesson is
// reported once (class_recordings.missing_audio_alerted_at); several at the
// same run go in one message. A Telegram failure leaves them unstamped, for
// the next run.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTelegramMessage, escapeHtml } from '../_shared/telegram.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const AFTER_MS = 8 * 3600 * 1000
// Older than this is history, not news (and keeps the first run short).
const LOOKBACK_MS = 7 * 24 * 3600 * 1000
// A Start/Stop tapped by mistake isn't a lesson (same floor as the app).
const MIN_LESSON_SEC = 60

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

const WHEN = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

function lessonLabel(r: any): string {
  if (r.student?.name) return `${r.student.name}’s lesson`
  if (r.lesson_type === 'group') return 'group lesson'
  if (r.lesson_type === 'couple') return 'couple lesson'
  return 'private lesson'
}

Deno.serve(async (req) => {
  if (!jwtRoleIs(req.headers.get('Authorization') ?? '', 'service_role')) {
    return json({ error: 'forbidden' }, 403)
  }

  const now = Date.now()
  const { data, error } = await supabase
    .from('class_recordings')
    .select('id, user_id, lesson_type, started_at, ended_at, meta, student:student_id(name)')
    .eq('local_recording_mode', true)
    .is('mic_file_name', null)
    .is('sync_abandoned_at', null)
    .is('missing_audio_alerted_at', null)
    .not('status', 'in', '(discarded,failed)')
    .lt('ended_at', new Date(now - AFTER_MS).toISOString())
    .gt('ended_at', new Date(now - LOOKBACK_MS).toISOString())
    .order('ended_at', { ascending: true })
  if (error) return json({ error: error.message }, 500)

  const lost: any[] = (data ?? []).filter((r: any) => {
    if (r.meta?.duration_unknown === true) return true
    const sec = (new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 1000
    return sec >= MIN_LESSON_SEC
  })
  if (!lost.length) return json({ ok: true, alerted: 0 })

  // class_recordings.user_id carries no foreign key to users: look coaches up.
  const coachIds = [...new Set(lost.map((r: any) => r.user_id))]
  const { data: coaches } = await supabase.from('users').select('id, name, email').in('id', coachIds)
  const coachById = new Map((coaches ?? []).map((c: any) => [c.id, c]))
  for (const r of lost) r.coach = coachById.get(r.user_id)

  const lines = lost.map((r: any) => {
    const coach = r.coach?.name || r.coach?.email || 'Unknown coach'
    const email = r.coach?.email ? ` (${r.coach.email})` : ''
    const hours = Math.floor((now - new Date(r.ended_at).getTime()) / 3600000)
    return `• ${escapeHtml(coach)}${escapeHtml(email)} — ${escapeHtml(lessonLabel(r))}, ended ${escapeHtml(WHEN.format(new Date(r.ended_at)))} (${hours}h ago)`
  })
  const text =
    `🎙️ <b>${lost.length === 1 ? 'A lesson has' : `${lost.length} lessons have`} no audio 8h after the end</b>\n` +
    lines.join('\n')

  const sent = await sendTelegramMessage(text)
  if (!sent.ok) return json({ ok: false, error: 'telegram failed', pending: lost.length }, 502)

  const { error: stampErr } = await supabase
    .from('class_recordings')
    .update({ missing_audio_alerted_at: new Date().toISOString() })
    .in('id', lost.map((r: any) => r.id))
  if (stampErr) console.error('[notify-audio-missing] stamp failed:', stampErr.message)

  return json({ ok: true, alerted: lost.length })
})
