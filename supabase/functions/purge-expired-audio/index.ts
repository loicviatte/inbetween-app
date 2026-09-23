// purge-expired-audio
//
// Nightly (pg_cron, 03:20 UTC). Two halves of one promise:
//
//   · RETENTION — a lesson's audio is deleted 180 days after the lesson. The
//     FILE goes from storage, not just its row: a pointer set to null while the
//     object lives on is not a deletion, it is a lie with a tidy database.
//     Everything derived from the recording — transcript, focus points, notes,
//     summaries — is deliberately kept. A lesson that loses its audio keeps
//     saying so through class_inputs.audio_purged_at.
//
//   · WARNING — the coach is told 14 days before it happens, once per lesson.
//     Without it the retention clause is a trapdoor.
//
// Two passes delete, because neither alone is complete:
//   A. lesson-driven — every lesson older than the limit, whatever the age of
//      the file (audio imported today can belong to a lesson from April).
//   B. object-driven — every object in the bucket older than the limit,
//      whatever the database thinks. An object is written at import, always at
//      or after its lesson, so an object past the limit belongs to a lesson
//      past the limit. This is what catches the 47 files that no row points at
//      any more (failed imports, deleted lessons) and that would otherwise sit
//      in storage forever.
//
// Guards, because this function deletes data that cannot come back:
//   · refuses to run if RETENTION_DAYS is ever edited below MIN_RETENTION_DAYS
//   · deletes at most MAX_DELETES_PER_RUN objects per night; the rest go the
//     next night rather than in one unreviewable sweep
//   · dry_run=true computes and returns the whole plan, deleting nothing
//
// Only pg_cron (service-role bearer) may invoke it.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const BUCKET = 'class-audio'
const RETENTION_DAYS = 180
const MIN_RETENTION_DAYS = 90        // a smaller value is a mistake, not a policy
const WARN_DAYS = 14                 // how long before deletion the coach hears about it
const MAX_DELETES_PER_RUN = 2000
const DAY_MS = 86400000

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

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })
}

/** Every object under a `<user>/<id>/` prefix. Audio lives one level deep. */
async function objectsUnder(prefix: string): Promise<string[]> {
  const clean = prefix.replace(/\/+$/, '')
  const { data, error } = await supabase.storage.from(BUCKET).list(clean, { limit: 1000 })
  if (error || !data) return []
  return data.filter((f) => f.id !== null).map((f) => `${clean}/${f.name}`)
}

/** Remove in batches — the storage API takes a list, not a thousand of them. */
async function removeObjects(paths: string[], dryRun: boolean): Promise<{ removed: number; errors: string[] }> {
  if (dryRun || paths.length === 0) return { removed: dryRun ? 0 : 0, errors: [] }
  const errors: string[] = []
  let removed = 0
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100)
    const { error } = await supabase.storage.from(BUCKET).remove(batch)
    if (error) errors.push(error.message)
    else removed += batch.length
  }
  return { removed, errors }
}

Deno.serve(async (req) => {
  if (!jwtRoleIs(req.headers.get('Authorization') ?? '', 'service_role')) {
    return json({ error: 'forbidden' }, 403)
  }
  if (RETENTION_DAYS < MIN_RETENTION_DAYS) {
    return json({ error: `retention ${RETENTION_DAYS}d is below the ${MIN_RETENTION_DAYS}d floor — refusing to run` }, 500)
  }

  let body: { dry_run?: boolean } = {}
  try { body = await req.json() } catch { /* cron sends nothing */ }
  const dryRun = body?.dry_run === true

  const now = Date.now()
  const cutoffIso = new Date(now - RETENTION_DAYS * DAY_MS).toISOString()
  const warnFromIso = new Date(now - (RETENTION_DAYS - WARN_DAYS) * DAY_MS).toISOString()

  const plan = {
    dry_run: dryRun,
    cutoff: cutoffIso,
    lessons: [] as Array<{ id: string; date: string; objects: number }>,
    recordings: [] as Array<{ id: string; date: string; objects: number }>,
    orphan_objects: 0,
    objects_removed: 0,
    capped: false,
    warned_coaches: 0,
    warned_lessons: 0,
    errors: [] as string[],
  }

  let budget = MAX_DELETES_PER_RUN

  // ── Pass A1: lessons past the limit ───────────────────────────────────
  const { data: expiredInputs, error: ciErr } = await supabase
    .from('class_inputs')
    .select('id, user_id, created_at, audio_path')
    .not('audio_path', 'is', null)
    .is('audio_purged_at', null)
    .lt('created_at', cutoffIso)
    .order('created_at', { ascending: true })
    .limit(500)
  if (ciErr) return json({ error: ciErr.message }, 500)

  for (const row of expiredInputs ?? []) {
    if (budget <= 0) { plan.capped = true; break }
    const paths = (await objectsUnder(row.audio_path as string)).slice(0, budget)
    const { removed, errors } = await removeObjects(paths, dryRun)
    budget -= paths.length
    plan.objects_removed += removed
    plan.errors.push(...errors)
    plan.lessons.push({ id: row.id, date: String(row.created_at).slice(0, 10), objects: paths.length })
    if (!dryRun && errors.length === 0) {
      // audio_path is cleared so nothing tries to read a file that is gone;
      // audio_purged_at is the record that there WAS one.
      await supabase
        .from('class_inputs')
        .update({ audio_path: null, audio_purged_at: new Date().toISOString() })
        .eq('id', row.id)
    }
  }

  // ── Pass A2: recordings past the limit (the mic-flow side) ────────────
  const { data: expiredRecs, error: crErr } = await supabase
    .from('class_recordings')
    .select('id, started_at')
    .is('audio_purged_at', null)
    .lt('started_at', cutoffIso)
    .order('started_at', { ascending: true })
    .limit(500)
  if (crErr) return json({ error: crErr.message }, 500)

  for (const rec of expiredRecs ?? []) {
    if (budget <= 0) { plan.capped = true; break }
    const { data: chunks } = await supabase
      .from('class_recording_chunks')
      .select('idx, storage_path')
      .eq('recording_id', rec.id)
      .not('storage_path', 'is', null)
    const paths = (chunks ?? []).map((c) => c.storage_path as string).slice(0, budget)
    const { removed, errors } = await removeObjects(paths, dryRun)
    budget -= paths.length
    plan.objects_removed += removed
    plan.errors.push(...errors)
    plan.recordings.push({ id: rec.id, date: String(rec.started_at).slice(0, 10), objects: paths.length })
    if (!dryRun && errors.length === 0) {
      // The chunk rows stay: they carry the transcript. Only the pointer to the
      // audio goes, with the recording stamped as purged.
      if (paths.length > 0) {
        await supabase
          .from('class_recording_chunks')
          .update({ storage_path: null })
          .eq('recording_id', rec.id)
          .not('storage_path', 'is', null)
      }
      await supabase
        .from('class_recordings')
        .update({ audio_purged_at: new Date().toISOString() })
        .eq('id', rec.id)
    }
  }

  // ── Pass B: anything left in the bucket past the limit ────────────────
  // storage.objects is readable with the service role and carries created_at,
  // which the storage list API does not give us in one call.
  if (budget > 0) {
    // Through an RPC: PostgREST only exposes `public`, and opening the storage
    // schema to the API for one query is a bigger hole than the query is worth
    // (see migration 20260923c).
    const { data: oldObjects, error: soErr } = await supabase
      .rpc('expired_audio_objects', { p_cutoff: cutoffIso, p_limit: budget })
    if (soErr) plan.errors.push(`expired_audio_objects: ${soErr.message}`)
    const names = ((oldObjects ?? []) as Array<{ name: string }>).map((o) => o.name)
    plan.orphan_objects = names.length
    const { removed, errors } = await removeObjects(names, dryRun)
    plan.objects_removed += removed
    plan.errors.push(...errors)
    if (names.length >= budget) plan.capped = true
  } else {
    plan.capped = true
  }

  // ── The 14-day warning ────────────────────────────────────────────────
  // One notification per coach per night, naming the soonest deletion date.
  const { data: expiring } = await supabase
    .from('class_inputs')
    .select('id, user_id, created_at')
    .not('audio_path', 'is', null)
    .is('audio_purged_at', null)
    .is('audio_expiry_warned_at', null)
    .lt('created_at', warnFromIso)
    .gte('created_at', cutoffIso)
    .order('created_at', { ascending: true })
    .limit(500)

  const byCoach = new Map<string, Array<{ id: string; created_at: string }>>()
  for (const row of expiring ?? []) {
    if (!row.user_id) continue
    if (!byCoach.has(row.user_id)) byCoach.set(row.user_id, [])
    byCoach.get(row.user_id)!.push({ id: row.id, created_at: row.created_at })
  }

  for (const [coachId, rows] of byCoach) {
    const soonest = new Date(Date.parse(rows[0].created_at) + RETENTION_DAYS * DAY_MS)
    const when = soonest.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
    const n = rows.length
    const body =
      n === 1
        ? `The audio of a lesson from ${new Date(rows[0].created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} is deleted on ${when} — we keep lesson audio for ${RETENTION_DAYS} days. The lesson, its transcript and its focus points stay. Ask us before then if you need the recording itself.`
        : `The audio of ${n} lessons starts being deleted on ${when} — we keep lesson audio for ${RETENTION_DAYS} days. The lessons, their transcripts and their focus points stay. Ask us before then if you need the recordings themselves.`
    if (!dryRun) {
      const { error: insErr } = await supabase.from('notifications').insert({
        user_id: coachId,
        type: 'audio_expiring',
        title: n === 1 ? 'A lesson recording expires soon' : 'Lesson recordings expire soon',
        body,
        data: { count: n, class_input_ids: rows.map((r) => r.id), deletes_from: soonest.toISOString() },
      })
      if (insErr) { plan.errors.push(`warn ${coachId}: ${insErr.message}`); continue }
      await supabase
        .from('class_inputs')
        .update({ audio_expiry_warned_at: new Date().toISOString() })
        .in('id', rows.map((r) => r.id))
    }
    plan.warned_coaches += 1
    plan.warned_lessons += rows.length
  }

  return json({ ok: true, ...plan })
})
