// Shared finalize-recording logic.
//
// Used by:
//   - finalize-class (HTTP wrapper called by client at Done click)
//   - transcribe-class-retry (cron sweep) — calls this directly without
//     going back out through HTTP, since edge-fn-to-edge-fn HTTP calls
//     hit auth-header transformation issues at the gateway.
//
// Idempotent: every state transition is guarded so a recording can be
// poked multiple times safely.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DANCE_PROMPT, composeTranscript } from './transcript.ts'

const ASSEMBLYAI_API = 'https://api.assemblyai.com/v2'
const SIGNED_URL_TTL = 12 * 60 * 60 // 12 hours
// After this many failed AssemblyAI job-creation attempts, stop rolling the
// chunk back to 'uploaded' (which the retry sweep re-attempts forever, re-
// billing each time) and mark it terminally 'failed' so the completeness gate
// can finalize with the chunks that DID transcribe.
const MAX_ASSEMBLYAI_CREATE_RETRIES = 5

export interface FinalizeResult {
  status: 'transcribing' | 'waiting' | 'completed' | 'failed' | 'discarded'
  created_jobs?: number
  total_chunks?: number
  uploaded_chunks?: number
}

export interface FinalizeDeps {
  supabase: SupabaseClient
  assemblyaiApiKey: string
  assemblyaiWebhookSecret: string
  functionsPublicUrl: string
}

export async function finalizeRecording(
  recordingId: string,
  deps: FinalizeDeps,
): Promise<FinalizeResult> {
  const { supabase, assemblyaiApiKey, assemblyaiWebhookSecret, functionsPublicUrl } = deps

  // Refresh heartbeat so cron doesn't sweep us mid-flight.
  await supabase
    .from('class_recordings')
    .update({ last_heartbeat_at: new Date().toISOString() })
    .eq('id', recordingId)

  const { data: rec, error: recErr } = await supabase
    .from('class_recordings')
    .select('*')
    .eq('id', recordingId)
    .maybeSingle()
  if (recErr) throw new Error(`load recording: ${recErr.message}`)
  if (!rec) throw new Error('recording not found')

  // Processing hold: a recording flagged meta._hold uploads its chunks to
  // Storage normally, but must NOT be transcribed until the flag is cleared
  // (an ops hold — e.g. while a human verifies something about the class).
  // Skip ALL AssemblyAI work and leave the chunks + recording untouched. The
  // retry sweep re-checks later and this short-circuits each time; clearing
  // meta._hold (then re-kicking finalize-class or waiting for the cron) lets
  // it transcribe normally.
  if (rec.meta && (rec.meta as { _hold?: unknown })._hold) {
    console.log(`[finalize-recording] ${recordingId} on _hold — chunks kept in Storage, transcription skipped`)
    return { status: 'waiting' }
  }

  if (['completed', 'discarded', 'failed'].includes(rec.status)) {
    return { status: rec.status as FinalizeResult['status'] }
  }

  if (rec.expected_chunks == null) {
    return { status: 'waiting', total_chunks: 0, uploaded_chunks: 0 }
  }

  // Edge case: coach hit Done with zero chunks (immediate stop, or
  // recording failed to start). Nothing to transcribe, nothing to wait
  // for. Mark discarded so the cron sweep stops looking at it.
  if (rec.expected_chunks === 0) {
    await supabase
      .from('class_recordings')
      .update({
        status: 'failed',
        error: 'no audio chunks recorded',
        last_heartbeat_at: new Date().toISOString(),
      })
      .eq('id', recordingId)
      .in('status', ['ready', 'transcribing', 'recording'])
    return { status: 'failed', total_chunks: 0, uploaded_chunks: 0 }
  }

  const { data: chunks, error: chunksErr } = await supabase
    .from('class_recording_chunks')
    .select('recording_id, idx, storage_path, status, assemblyai_job_id, retries')
    .eq('recording_id', recordingId)
    .order('idx', { ascending: true })
  if (chunksErr) throw new Error(`load chunks: ${chunksErr.message}`)
  const all = chunks ?? []

  const ready = all.filter((c) =>
    ['uploaded', 'transcribing', 'transcribed'].includes(c.status),
  )
  // Completeness counts terminally-FAILED chunks too, matching the webhook's
  // terminal = transcribed|failed rule. Otherwise a chunk that failed
  // permanently (e.g. missing storage_path, marked 'failed' below) drops the
  // ready-count under expected_chunks forever and the recording strands in
  // 'waiting' — never re-entering the retry sweep, never finalizing on the
  // chunks that DID transcribe. Jobs are still only created for `ready` chunks
  // (a failed chunk can't be transcribed); the gate just stops blocking on it.
  const resolved = all.filter((c) =>
    ['uploaded', 'transcribing', 'transcribed', 'failed'].includes(c.status),
  )
  if (resolved.length < rec.expected_chunks) {
    return {
      status: 'waiting',
      total_chunks: rec.expected_chunks,
      uploaded_chunks: ready.length,
    }
  }

  // Speaker-count hint for diarization. AssemblyAI's default over-segments a
  // 1-on-1 lesson into ~6 speakers, which defeats the top-talker Coach/Élève
  // heuristic in transcript.ts (the coach's own second cluster gets mislabeled
  // Élève → the "everyone Élève" bug). Telling it how many voices to expect
  // yields a clean split. private → coach + 1 = 2 | couple → coach + 2 = 3 |
  // group → coach + N recorded students.
  let speakersExpected: number | null = null
  if (rec.lesson_type === 'private') speakersExpected = 2
  else if (rec.lesson_type === 'couple') speakersExpected = 3
  else if (rec.lesson_type === 'group') {
    const { count } = await supabase
      .from('class_recording_students')
      .select('student_id', { count: 'exact', head: true })
      .eq('recording_id', recordingId)
    if (count && count > 0) speakersExpected = 1 + count
  }

  let createdJobs = 0
  for (const chunk of ready) {
    if (chunk.assemblyai_job_id) continue
    if (!chunk.storage_path) {
      await supabase
        .from('class_recording_chunks')
        .update({ status: 'failed', error: 'missing storage_path' })
        .eq('recording_id', recordingId)
        .eq('idx', chunk.idx)
      continue
    }

    // Atomic claim: try to transition this chunk from 'uploaded' to
    // 'transcribing'. Only ONE concurrent caller will succeed because
    // PostgreSQL serializes UPDATEs on the same row and our WHERE clause
    // checks the current status. Losers see no row updated and skip,
    // preventing duplicate AssemblyAI jobs (and the resulting orphan
    // billing). If we crash between claim and AssemblyAI POST, the chunk
    // is left in 'transcribing' with NULL job_id; the cron retry view
    // catches that case via stale heartbeat and pollAssemblyAI skips
    // (no job_id) — we then need an additional path to unstick. See
    // recordings_needing_retry handling for the recovery.
    const { data: claimed, error: claimErr } = await supabase
      .from('class_recording_chunks')
      .update({ status: 'transcribing' })
      .eq('recording_id', recordingId)
      .eq('idx', chunk.idx)
      .eq('status', 'uploaded')
      .select('idx')
      .maybeSingle()
    if (claimErr || !claimed) {
      // Someone else is racing us on this chunk — they own creation.
      continue
    }

    const { data: signed, error: signErr } = await supabase.storage
      .from('class-audio')
      .createSignedUrl(chunk.storage_path, SIGNED_URL_TTL)
    if (signErr || !signed?.signedUrl) {
      // Roll back our claim so a future retry can pick the chunk up again.
      await supabase
        .from('class_recording_chunks')
        .update({
          status: 'uploaded',
          error: `signed url: ${signErr?.message ?? 'unknown'}`,
        })
        .eq('recording_id', recordingId)
        .eq('idx', chunk.idx)
      continue
    }

    const webhookUrl =
      `${functionsPublicUrl}/assemblyai-webhook` +
      `?recording_id=${encodeURIComponent(recordingId)}` +
      `&chunk_idx=${chunk.idx}`

    const createRes = await fetch(`${ASSEMBLYAI_API}/transcript`, {
      method: 'POST',
      headers: {
        authorization: assemblyaiApiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: signed.signedUrl,
        // universal-3-5-pro (18 langs incl. English) → falls back to
        // universal-2 for other languages (e.g. Russian). A/B on a real
        // English lesson: low-confidence words 12% → 5% vs universal-3-pro.
        speech_models: ['universal-3-5-pro', 'universal-2'],
        prompt: DANCE_PROMPT,
        speaker_labels: true,
        ...(speakersExpected ? { speakers_expected: speakersExpected } : {}),
        punctuate: true,
        format_text: true,
        webhook_url: webhookUrl,
        webhook_auth_header_name: 'X-Webhook-Secret',
        webhook_auth_header_value: assemblyaiWebhookSecret,
      }),
    })
    if (!createRes.ok) {
      const text = await createRes.text().catch(() => '')
      const nextRetries = (chunk as any).retries != null ? (chunk as any).retries + 1 : 1
      // Roll back the claim — chunk was atomically transitioned to
      // 'transcribing' but we never got a job_id, so it's effectively
      // still uploaded. Returning to 'uploaded' lets the next retry
      // attempt re-create the job — but only up to a cap. Past the cap the
      // audio is almost certainly unprocessable (corrupt / persistent 4xx);
      // keeping it 'uploaded' would re-create (and re-bill) the job on every
      // 5-min cron sweep forever and wedge the recording in 'transcribing'.
      // Mark it terminally 'failed' so the completeness gate can finalize the
      // chunks that did transcribe.
      const terminal = nextRetries > MAX_ASSEMBLYAI_CREATE_RETRIES
      await supabase
        .from('class_recording_chunks')
        .update({
          status: terminal ? 'failed' : 'uploaded',
          error: `assemblyai create ${createRes.status}: ${text.slice(0, 200)}`,
          retries: nextRetries,
        })
        .eq('recording_id', recordingId)
        .eq('idx', chunk.idx)
      continue
    }
    const created = await createRes.json()
    const jobId = created.id as string
    if (!jobId) {
      // Same rollback path — AssemblyAI returned a 200 without an id (very
      // unusual, but be defensive).
      await supabase
        .from('class_recording_chunks')
        .update({ status: 'uploaded' })
        .eq('recording_id', recordingId)
        .eq('idx', chunk.idx)
      continue
    }

    // Persist the real job_id. The chunk is already in 'transcribing'
    // status from the atomic claim above; we only need to fill in the id.
    await supabase
      .from('class_recording_chunks')
      .update({
        assemblyai_job_id: jobId,
        error: null,
      })
      .eq('recording_id', recordingId)
      .eq('idx', chunk.idx)
    createdJobs += 1
  }

  await supabase
    .from('class_recordings')
    .update({
      status: 'transcribing',
      last_heartbeat_at: new Date().toISOString(),
      ended_at: rec.ended_at ?? new Date().toISOString(),
    })
    .eq('id', recordingId)
    .in('status', ['ready', 'transcribing'])

  return {
    status: 'transcribing',
    created_jobs: createdJobs,
    total_chunks: rec.expected_chunks,
  }
}

/**
 * Compose the stitched transcript and create the class_input — the finalize
 * step that the assemblyai-webhook runs after each chunk callback. Extracted so
 * the retry cron can run it too: `finalizeRecording` above only CREATES
 * AssemblyAI jobs, so a recording whose completion webhook was lost would sit in
 * 'transcribing' forever (the cron polled the chunks to terminal state but had
 * no path to compose + finalize). Idempotent via finalize_recording_atomic
 * (row lock + class_input_id guard), so it's safe to call alongside a live
 * webhook — the loser sees was_created=false and skips the push.
 */
export async function composeAndFinalize(
  recordingId: string,
  supabase: SupabaseClient,
): Promise<void> {
  const { data: rec, error: recErr } = await supabase
    .from('class_recordings')
    .select('*')
    .eq('id', recordingId)
    .maybeSingle()
  if (recErr || !rec) return
  if (['completed', 'discarded', 'failed'].includes(rec.status)) return
  if (rec.expected_chunks == null) return

  const { data: chunks } = await supabase
    .from('class_recording_chunks')
    .select('idx, status, transcript_json, speaker_labels, duration_ms')
    .eq('recording_id', recordingId)
    .order('idx', { ascending: true })
  const all = chunks ?? []

  // Only finalize once every expected chunk has a terminal outcome.
  const terminal = all.filter((c) => ['transcribed', 'failed'].includes(c.status))
  if (terminal.length < rec.expected_chunks) return

  const composed = composeTranscript(
    all.map((c) => ({
      utterances: (c.transcript_json as any)?.utterances ?? [],
      text: (c.transcript_json as any)?.text ?? '',
      durationMs: c.duration_ms ?? null,
      speakerLabels: (c.speaker_labels as Record<string, string>) ?? null,
      failed: c.status === 'failed',
    })),
  )

  if (!composed) {
    await supabase
      .from('class_recordings')
      .update({
        status: 'failed',
        error: 'all chunks failed transcription',
        last_heartbeat_at: new Date().toISOString(),
      })
      .eq('id', recordingId)
      .in('status', ['ready', 'transcribing'])
    return
  }

  const { data: rpcRows, error: rpcErr } = await supabase.rpc('finalize_recording_atomic', {
    p_recording_id: recordingId,
    p_transcript: composed,
    p_audio_folder: rec.audio_folder,
  })
  const rpcRow = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows
  if (rpcErr || !rpcRow?.class_input_id) {
    console.error('[finalize] compose RPC failed:', rpcErr?.message)
    await supabase
      .from('class_recordings')
      .update({ error: `finalize RPC: ${rpcErr?.message ?? 'unknown'}` })
      .eq('id', recordingId)
    return
  }

  // Only the row's actual creator sends the push (idempotent under concurrent
  // callers — a live webhook racing the cron sees was_created=false).
  if (rpcRow.was_created) {
    try {
      // Skip for coaches — their actionable signal is 'focus_points_added'
      // (after scoring). Keep transcript_ready only for a student who records
      // their own class (recording owner isn't a coach).
      const { data: owner } = await supabase
        .from('users')
        .select('role')
        .eq('id', rec.user_id)
        .maybeSingle()
      if ((owner?.role ?? '').toLowerCase() !== 'coach') {
        await supabase.from('notifications').insert({
          user_id: rec.user_id,
          type: 'transcript_ready',
          title: 'Class transcribed',
          body: 'Your class is ready to review.',
          data: { class_input_id: rpcRow.class_input_id },
        })
      }
    } catch (err) {
      console.warn('[finalize] push notif failed:', err instanceof Error ? err.message : err)
    }
  }
}
