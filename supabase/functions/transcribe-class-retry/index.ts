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
import { finalizeRecording, composeAndFinalize } from '../_shared/finalize-recording.ts'
import { isEnglishLang, translateUtterancesToEnglish, translateTextToEnglish } from '../_shared/translate.ts'

declare global {
  const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY')!
const ASSEMBLYAI_WEBHOOK_SECRET = Deno.env.get('ASSEMBLYAI_WEBHOOK_SECRET')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const FUNCTIONS_PUBLIC_URL =
  Deno.env.get('FUNCTIONS_PUBLIC_URL') ?? `${SUPABASE_URL}/functions/v1`
const ASSEMBLYAI_API = 'https://api.assemblyai.com/v2'

// Hard cap so a misbehaving cron run doesn't blow up its budget.
const MAX_RECORDINGS_PER_RUN = 50

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

function jwtRoleIs(authHeader: string | null, expectedRole: string): boolean {
  const m = (authHeader ?? '').match(/^\s*Bearer\s+(.+)$/i)
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

Deno.serve(async (req: Request) => {
  // Only the cron (service role) may trigger this global sweep. Without the
  // gate any authenticated coach could POST their own Bearer JWT and repeatedly
  // kick the whole AssemblyAI-poll + Claude-translation sweep on demand — a
  // cost/abuse vector. Sibling fns already gate (finalize-class on service_role,
  // assemblyai-webhook on the webhook secret); this one had none.
  if (!jwtRoleIs(req.headers.get('Authorization'), 'service_role')) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }
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
    if (!chunk.assemblyai_job_id) {
      // Crashed between the atomic claim (uploaded→transcribing) and the
      // AssemblyAI POST: the chunk is 'transcribing' with NO job_id, so no
      // webhook or poll can ever advance it and the recording would strand
      // forever (the cron just re-sweeps it every 5 min). Reset it to 'uploaded'
      // — guarded to only fire while it's still stuck + jobless so we can't
      // clobber a chunk a concurrent run just POSTed — so the finalizeRecording
      // claim below re-POSTs it (idempotent).
      await supabase
        .from('class_recording_chunks')
        .update({ status: 'uploaded', error: 'reset: transcribing with no job_id' })
        .eq('recording_id', recordingId)
        .eq('idx', chunk.idx)
        .eq('status', 'transcribing')
        .is('assemblyai_job_id', null)
      continue
    }
    const job = await pollAssemblyAI(chunk.assemblyai_job_id)
    if (!job) continue
    if (job.status === 'completed') {
      // Normalize to English exactly like the primary webhook — otherwise a
      // non-English class recovered on this path lands as an untranslated
      // transcript (and without source_language/translated markers).
      const rawUtterances = Array.isArray(job.utterances) ? job.utterances : []
      const rawText = typeof job.text === 'string' ? job.text : ''
      const language = String(job.language_code || '').toLowerCase()
      const english = isEnglishLang(language)
      let utterances = rawUtterances
      let text = rawText
      if (!english) {
        const tu = await translateUtterancesToEnglish(ANTHROPIC_API_KEY, rawUtterances, language)
        if (tu) utterances = tu
        const tt = await translateTextToEnglish(ANTHROPIC_API_KEY, rawText, language)
        if (tt) text = tt
      }
      await supabase
        .from('class_recording_chunks')
        .update({
          status: 'transcribed',
          transcript_json: {
            utterances,
            text,
            audio_duration: job.audio_duration,
            source_language: language || null,
            translated: !english,
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

  // finalizeRecording only CREATES AssemblyAI jobs. When the completion webhook
  // was lost (failure modes #2/#3 above) every chunk is already terminal, so
  // there are no jobs to create and the recording would sit in 'transcribing'
  // forever. Compose the transcript + create the class_input here too — the
  // finalize RPC is idempotent, so racing a late webhook is safe.
  await composeAndFinalize(recordingId, supabase)
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
