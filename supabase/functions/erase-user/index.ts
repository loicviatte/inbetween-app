// erase-user
//
// Honours a deletion request, for real: the files first, then the account and
// everything the foreign keys hang off it, in one transaction (see migration
// 20260923e — public.erase_user, whose header lists what goes and what is
// deliberately kept).
//
// Storage before database, deliberately. Storage is not transactional, and the
// paths are the one thing that becomes unfindable once the rows are gone: a
// crash between the two leaves files deleted and rows intact, which re-running
// fixes. The other order would leave audio nobody can reach, and nobody can
// delete.
//
// Service-role only. There is no self-service button behind this yet — it is
// what support runs when someone asks, and what a future "delete my account"
// will call. Always run it with dry_run first: the plan it returns is the last
// chance to see what a deletion means for that person.
//
//   curl -X POST .../erase-user -H "Authorization: Bearer <service-role>" \
//        -d '{"user_id":"<uuid>","dry_run":true}'

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (!jwtRoleIs(req.headers.get('Authorization') ?? '', 'service_role')) {
    return json({ error: 'forbidden' }, 403)
  }

  let body: { user_id?: string; dry_run?: boolean; requested_by?: string } = {}
  try { body = await req.json() } catch { /* fall through to the guard */ }
  const userId = body?.user_id
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: 'user_id required' }, 400)
  // Deleting is the exception, not the default: the caller has to ask for it.
  const dryRun = body?.dry_run !== false
  const requestedBy = body?.requested_by ?? 'support'

  // Every file the person owns, across both buckets.
  const { data: objects, error: objErr } = await supabase
    .rpc('user_audio_objects', { p_user: userId })
  if (objErr) return json({ error: `user_audio_objects: ${objErr.message}` }, 500)
  const byBucket = new Map<string, string[]>()
  for (const o of (objects ?? []) as Array<{ bucket: string; name: string }>) {
    if (!byBucket.has(o.bucket)) byBucket.set(o.bucket, [])
    byBucket.get(o.bucket)!.push(o.name)
  }
  const storageCount = (objects ?? []).length

  if (dryRun) {
    const { data: plan, error } = await supabase
      .rpc('erase_user', { p_user: userId, p_dry_run: true, p_requested_by: requestedBy })
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true, ...(plan as Record<string, unknown>), storage_objects: storageCount })
  }

  const errors: string[] = []
  let removed = 0
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += 100) {
      const batch = names.slice(i, i + 100)
      const { error } = await supabase.storage.from(bucket).remove(batch)
      if (error) errors.push(`${bucket}: ${error.message}`)
      else removed += batch.length
    }
  }
  // A file we could not delete means the erasure is incomplete — stop rather
  // than report a deletion that did not happen.
  if (errors.length > 0) return json({ error: 'storage delete failed', errors, removed }, 500)

  const { data: result, error } = await supabase
    .rpc('erase_user', { p_user: userId, p_dry_run: false, p_requested_by: requestedBy })
  if (error) return json({ error: error.message, storage_removed: removed }, 500)

  // The audit row is written inside the transaction, without the storage count
  // (only this side knows it). Stamp it by id — PostgREST has no "update the
  // most recent one".
  const { data: auditRow } = await supabase
    .from('data_erasures')
    .select('id')
    .eq('subject_id', userId)
    .order('performed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (auditRow?.id) {
    await supabase.from('data_erasures').update({ storage_objects: removed }).eq('id', auditRow.id)
  }

  return json({ ok: true, ...(result as Record<string, unknown>), storage_objects: removed })
})
