// notify-audio-lost
//
// Pings the ops Telegram chat when a coach answers "the audio is lost" on the
// evening upload reminder (SyncReminderModal → abandonPendingUploads, which
// stamps class_recordings.sync_abandoned_at). Invoked by a trigger on that
// column via pg_net — see 20260721_notify_audio_lost.sql.
//
// Why a human is on the other end: "lost" is the one answer with no way back
// on the coach's side. It silences the nightly push and the full-screen
// reminder for that class permanently, and the student never gets focus points
// from it. The confirmation card tells the coach "We'll get in touch about this
// one" — this function is what makes that promise true, so it must not fail
// silently in a way nobody notices.
//
// It does NOT block the coach: the trigger swallows its own errors and the
// client never waits on it. A missed ping costs an ops follow-up, never data.
//
// Mirrors notify-audio-match: same service-role gate, same Telegram secrets.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendMessage } from './telegram.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fmtDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return 'unknown length'
  const min = Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000)
  return min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min} min`
}

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

  const { data: rec, error } = await supabase
    .from('class_recordings')
    .select(
      'id, user_id, lesson_type, started_at, ended_at, sync_abandoned_at, sync_abandoned_reason, mic_file_name',
    )
    .eq('id', recordingId)
    .maybeSingle()
  if (error) return json({ error: error.message }, 500)
  if (!rec) return json({ ok: true, note: 'recording gone' })
  // Guard against a stale trigger firing on a row that was un-abandoned, or on
  // one whose audio turned up in the meantime.
  if (!rec.sync_abandoned_at || rec.mic_file_name) {
    return json({ ok: true, note: 'not abandoned anymore' })
  }

  // Who to call back, and about whose lesson.
  const { data: coach } = await supabase
    .from('users')
    .select('name, email')
    .eq('id', rec.user_id)
    .maybeSingle()

  const { data: roster } = await supabase
    .from('class_recording_students')
    .select('student_id')
    .eq('recording_id', rec.id)
  const studentIds = (roster ?? []).map((r: { student_id: string }) => r.student_id)
  let studentNames: string[] = []
  if (studentIds.length) {
    const { data: students } = await supabase
      .from('users')
      .select('name')
      .in('id', studentIds)
    studentNames = (students ?? [])
      .map((u: { name: string | null }) => u.name)
      .filter(Boolean) as string[]
  }

  const when = new Date(rec.started_at).toLocaleString('en-GB', {
    timeZone: 'Europe/Paris',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

  const lines = [
    '🔇 <b>Audio marked as lost</b>',
    '',
    `Coach: <b>${esc(coach?.name ?? 'Unknown')}</b>${coach?.email ? ` (${esc(coach.email)})` : ''}`,
    `Class: ${esc(rec.lesson_type ?? 'private')} · ${esc(when)} · ${fmtDuration(rec.started_at, rec.ended_at)}`,
    studentNames.length ? `Students: ${esc(studentNames.join(', '))}` : null,
    `Reason: ${esc(rec.sync_abandoned_reason ?? 'audio_lost')}`,
    '',
    'The coach was told we would get in touch. Reminders for this class are off.',
    `<code>${esc(rec.id)}</code>`,
  ].filter(Boolean) as string[]

  await sendMessage(lines.join('\n'))
  return json({ ok: true, notified: true })
})

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })
}
