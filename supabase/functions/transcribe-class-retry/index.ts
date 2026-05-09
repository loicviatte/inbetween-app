// transcribe-class-retry
//
// Cron sweep that re-pokes class_recordings stuck in 'ready' or
// 'transcribing' for too long. Three failure modes it covers:
//   1. The client called finalize-class but the call failed mid-flight
//      (mark recording 'ready' but no AssemblyAI jobs exist).
//   2. AssemblyAI completed a transcript but the webhook didn't reach us
//      (DB webhooks fail silently with no retry — the existing trigger
//      pattern, also true for outbound webhooks AssemblyAI tries 10× then
//      gives up).
//   3. assemblyai-webhook was called but the waitUntil work crashed before
//      finalizing the recording.
//
// Strategy:
//   - For every recording matching the `class_recordings_needing_retry`
//     view (status in ready/transcribing AND last_heartbeat older than
//     10 min AND chunks ready):
//       - If any chunk is still 'transcribing' (job_id present), poll
//         AssemblyAI directly for that job and apply the result.
//       - Then call finalize-class for that recording. finalize-class is
//         idempotent — it'll skip chunks that already have a job.
//
// Triggered by pg_cron every 5 minutes.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { identifyCoachSpeaker } from '../_shared/transcript.ts'
import { finalizeRecording } from '../_shared/finalize-recording.ts'

declare global {
  const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY')!
const ASSEMBLYAI_WEBHOOK_SECRET = Deno.env.get('ASSEMBLYAI_WEBHOOK_SECRET')!
const FUNCTIONS_PUBLIC_URL =
  Deno.env.get('FUNCTIONS_PUBLIC_URL') ?? `${SUPABASE_URL}/functions/v1`
const ASSEMBLYAI_API = 'https://api.assemblyai.com/v2'

// Hard cap so a misbehaving cron run doesn't blow up its budget.
const MAX_RECORDINGS_PER_RUN = 50

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

Deno.serve(async (_req: Request) => {
  // Always do the actual work in waitUntil so the cron caller (pg_net) gets
  // an instant response — pg_net keeps responses for only 6 hours and we
  // don't want backlogged work to drag the cron poke timeout.
  const result = await sweep()
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})

async function sweep() {
  const { data: stuck, error } = await supabase
    .from('class_recordings_needing_retry')
    .select('id')
    .limit(MAX_RECORDINGS_PER_RUN)
  if (error) {
    console.error('[retry] view query error:', error.message)
    return { ok: false, error: error.message }
  }
  if (!stuck || stuck.length === 0) {
    return { ok: true, swept: 0 }
  }
  console.log(`[retry] sweeping ${stuck.length} stuck recordings`)

  let healed = 0
  const errors: Array<{ id: string; error: string }> = []
  for (const row of stuck) {
    try {
      await healOne(row.id)
      healed += 1
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[retry] heal failed for', row.id, msg)
      errors.push({ id: row.id, error: msg })
    }
  }
  return { ok: true, swept: stuck.length, healed, errors }
}

async function healOne(recordingId: string) {
  // First, poll AssemblyAI for any chunk in 'transcribing' state — the
  // webhook may have been lost.
  const { data: transcribingChunks } = await supabase
    .from('class_recording_chunks')
    .select('idx, assemblyai_job_id')
    .eq('recording_id', recordingId)
    .eq('status', 'transcribing')

  for (const chunk of transcribingChunks ?? []) {
    if (!chunk.assemblyai_job_id) continue
    const job = await pollAssemblyAI(chunk.assemblyai_job_id)
    if (!job) continue
    if (job.status === 'completed') {
      const utterances = Array.isArray(job.utterances) ? job.utterances : []
      await supabase
        .from('class_recording_chunks')
        .update({
          status: 'transcribed',
          transcript_json: {
            utterances,
            text: job.text ?? '',
            audio_duration: job.audio_duration,
          },
          speaker_labels: identifyCoachSpeaker(utterances),
          duration_ms: Math.round((Number(job.audio_duration) || 0) * 1000),
          transcribed_at: new Date().toISOString(),
          error: null,
        })
        .eq('recording_id', recordingId)
        .eq('idx', chunk.idx)
    } else if (job.status === 'error') {
      await supabase
        .from('class_recording_chunks')
        .update({
          status: 'failed',
          error: job.error ?? 'AssemblyAI error',
          transcribed_at: new Date().toISOString(),
        })
        .eq('recording_id', recordingId)
        .eq('idx', chunk.idx)
    }
    // 'queued'/'processing' → still pending, leave it alone for the next sweep
  }

  // Call the shared finalize logic directly — no HTTP hop. Edge-fn-to-
  // edge-fn HTTP runs into auth header transformation at the gateway, and
  // a direct in-process call is faster and more transparent for retries.
  await finalizeRecording(recordingId, {
    supabase,
    assemblyaiApiKey: ASSEMBLYAI_API_KEY,
    assemblyaiWebhookSecret: ASSEMBLYAI_WEBHOOK_SECRET,
    functionsPublicUrl: FUNCTIONS_PUBLIC_URL,
  })
}

async function pollAssemblyAI(jobId: string): Promise<any | null> {
  const res = await fetch(`${ASSEMBLYAI_API}/transcript/${jobId}`, {
    headers: { authorization: ASSEMBLYAI_API_KEY },
  })
  if (!res.ok) {
    console.warn('[retry] AssemblyAI poll failed:', res.status)
    return null
  }
  return await res.json()
}
