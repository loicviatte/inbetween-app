// notify-sync-reminders
//
// Nightly digest (pg_cron ~20h Paris) that nudges a coach to import the DJI-mic
// audio for classes they recorded but never synced. Inserts ONE grouped
// notification (type 'sync_reminder') per coach into public.notifications; the
// on-notification-insert DB webhook fans it out to send-push → Expo push.
//
// A "class awaiting audio" mirrors LocalUploadScreen / fetchPendingUploads:
//   local_recording_mode = true AND mic_file_name IS NULL AND ended_at IS NOT
//   NULL AND (ended_at - started_at) >= 60s  (the <60s filter drops Start/Stop
//   test taps — same MIN_VALID_DURATION_SEC the matcher uses) AND
//   sync_abandoned_at IS NULL (the coach answered "audio lost" on the evening
//   full-screen reminder — see 20260721_sync_abandoned.sql; the class stays
//   matchable, it just stops nagging).
//
// Repeats every evening until EITHER the audio is synced (mic_file_name set →
// the class drops out of the query) OR the class is "superseded": the coach
// later taught another class with at least one overlapping student, at which
// point nagging about the older, now-stale recording stops. Bounded to the last
// 30 days so an ancient unrecoverable class doesn't nag forever.
//
// Only pg_cron (service-role bearer) may invoke it.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const MIN_VALID_DURATION_SEC = 60          // matches localRecordingAutoSync
const LOOKBACK_DAYS = 30                    // don't nag about ancient classes
const SUPERSEDE_LOOKBACK_DAYS = 60          // window to find a "taught them again" class
const DEDUP_HOURS = 18                      // skip if we already pinged this coach recently

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

type Rec = {
  id: string
  user_id: string
  student_id: string | null
  started_at: string
  ended_at: string | null
}

function rosterOf(recId: string, studentId: string | null, crs: Map<string, Set<string>>): Set<string> {
  const set = new Set<string>(crs.get(recId) ?? [])
  if (studentId) set.add(studentId)
  return set
}

function overlaps(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true
  return false
}

Deno.serve(async (req) => {
  if (!jwtRoleIs(req.headers.get('Authorization') ?? '', 'service_role')) {
    return json({ error: 'forbidden' }, 403)
  }

  // dry_run=true computes the plan and returns it WITHOUT inserting any
  // notification (no push). Used to validate against real data safely.
  let reqBody: { dry_run?: boolean } = {}
  try { reqBody = await req.json() } catch { /* cron may send an empty/simple body */ }
  const dryRun = reqBody?.dry_run === true

  const nowMs = Date.now()
  const lookbackIso = new Date(nowMs - LOOKBACK_DAYS * 86400000).toISOString()

  // 1. Classes awaiting audio (the reminder candidates).
  const { data: pendingRaw, error: pErr } = await supabase
    .from('class_recordings')
    .select('id, user_id, student_id, started_at, ended_at')
    .eq('local_recording_mode', true)
    .is('mic_file_name', null)
    .is('sync_abandoned_at', null)
    .not('ended_at', 'is', null)
    .gte('started_at', lookbackIso)
  if (pErr) return json({ error: pErr.message }, 500)

  const pending: Rec[] = (pendingRaw ?? []).filter((r: Rec) => {
    if (!r.ended_at) return false
    const dur = (new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 1000
    return dur >= MIN_VALID_DURATION_SEC
  })
  if (pending.length === 0) return json({ ok: true, coaches: 0, reminded: 0, note: 'nothing pending' })

  const coachIds = [...new Set(pending.map((r) => r.user_id))]

  // 2. All of those coaches' recordings in the supersede window — used both to
  //    resolve rosters and to detect a later overlapping-student class.
  const supersedeIso = new Date(nowMs - SUPERSEDE_LOOKBACK_DAYS * 86400000).toISOString()
  const { data: allRecs, error: aErr } = await supabase
    .from('class_recordings')
    .select('id, user_id, student_id, started_at')
    .in('user_id', coachIds)
    .gte('started_at', supersedeIso)
  if (aErr) return json({ error: aErr.message }, 500)

  // 3. Roster rows (group/couple classes) for every recording in play.
  const recIds = [...new Set([...(allRecs ?? []).map((r: Rec) => r.id), ...pending.map((r) => r.id)])]
  const crs = new Map<string, Set<string>>()
  for (let i = 0; i < recIds.length; i += 500) {
    const batch = recIds.slice(i, i + 500)
    const { data: rows } = await supabase
      .from('class_recording_students')
      .select('recording_id, student_id')
      .in('recording_id', batch)
    for (const row of rows ?? []) {
      if (!crs.has(row.recording_id)) crs.set(row.recording_id, new Set())
      crs.get(row.recording_id)!.add(row.student_id)
    }
  }

  const recsByCoach = new Map<string, Array<{ id: string; started: number; roster: Set<string> }>>()
  for (const r of (allRecs ?? []) as Rec[]) {
    if (!recsByCoach.has(r.user_id)) recsByCoach.set(r.user_id, [])
    recsByCoach.get(r.user_id)!.push({
      id: r.id,
      started: new Date(r.started_at).getTime(),
      roster: rosterOf(r.id, r.student_id, crs),
    })
  }

  // 4. Keep only pending classes NOT superseded by a later overlapping-student class.
  const survivorsByCoach = new Map<string, Rec[]>()
  const studentIdsNeeded = new Set<string>()
  for (const m of pending) {
    const mStart = new Date(m.started_at).getTime()
    const mRoster = rosterOf(m.id, m.student_id, crs)
    const later = (recsByCoach.get(m.user_id) ?? []).some(
      (r) => r.id !== m.id && r.started > mStart && overlaps(r.roster, mRoster),
    )
    if (later) continue
    if (!survivorsByCoach.has(m.user_id)) survivorsByCoach.set(m.user_id, [])
    survivorsByCoach.get(m.user_id)!.push(m)
    for (const sid of mRoster) studentIdsNeeded.add(sid)
  }
  if (survivorsByCoach.size === 0) return json({ ok: true, coaches: coachIds.length, reminded: 0, note: 'all superseded' })

  // 5. Student names for the payload (best-effort; group classes may be unnamed).
  const nameById = new Map<string, string>()
  if (studentIdsNeeded.size > 0) {
    const ids = [...studentIdsNeeded]
    for (let i = 0; i < ids.length; i += 500) {
      const { data: users } = await supabase
        .from('users')
        .select('id, name')
        .in('id', ids.slice(i, i + 500))
      for (const u of users ?? []) if (u.name) nameById.set(u.id, u.name)
    }
  }

  // 6. One grouped notification per coach — skipping any coach already pinged
  //    within DEDUP_HOURS (belt-and-suspenders against a double cron fire).
  const dedupIso = new Date(nowMs - DEDUP_HOURS * 3600000).toISOString()
  let reminded = 0
  let skippedDedup = 0
  const results: Array<{ coach: string; count: number; body: string }> = []

  for (const [coachId, recs] of survivorsByCoach) {
    const { count: recent } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', coachId)
      .eq('type', 'sync_reminder')
      .gte('created_at', dedupIso)
    if ((recent ?? 0) > 0) { skippedDedup += 1; continue }

    const count = recs.length
    const names: string[] = []
    for (const r of recs) {
      for (const sid of rosterOf(r.id, r.student_id, crs)) {
        const n = nameById.get(sid)
        if (n && !names.includes(n)) names.push(n)
      }
    }
    const nameSuffix = names.length
      ? ` (${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : ''})`
      : ''
    const body =
      count === 1
        ? `1 class is still waiting for its audio${nameSuffix}. Plug in your DJI mic (USB-C) to import it.`
        : `${count} classes are still waiting for their audio${nameSuffix}. Plug in your DJI mic (USB-C) to import them.`

    if (!dryRun) {
      const { error: insErr } = await supabase.from('notifications').insert({
        user_id: coachId,
        type: 'sync_reminder',
        title: 'Sync your DJI recordings',
        body,
        data: {
          count,
          recording_ids: recs.map((r) => r.id),
          student_names: names,
        },
      })
      if (insErr) {
        console.error(`[sync-reminders] insert failed for ${coachId}:`, insErr.message)
        continue
      }
    }
    reminded += 1
    results.push({ coach: coachId, count, body })
  }

  return json({ ok: true, dry_run: dryRun, coaches: coachIds.length, reminded, skippedDedup, results })
})

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })
}
