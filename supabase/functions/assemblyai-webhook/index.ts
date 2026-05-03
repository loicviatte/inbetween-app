// assemblyai-webhook
//
// Receives the callback AssemblyAI sends when a transcript job finishes.
// Authenticated via the X-Webhook-Secret header set on each job.
//
// Query string carries our correlation IDs (set by finalize-class):
//   ?recording_id=<uuid>&chunk_idx=<int>
//
// Body (per AssemblyAI docs):
//   { transcript_id: string, status: 'completed' | 'error' }
//
// We MUST return a 2xx within 10 s — AssemblyAI retries up to 10 times
// otherwise. We do the heavy lifting (fetch transcript + finalize the
// recording) inside EdgeRuntime.waitUntil so we ack the webhook fast.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { composeTranscript, identifyCoachSpeaker } from '../_shared/transcript.ts'

declare global {
  const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY')!
const ASSEMBLYAI_WEBHOOK_SECRET = Deno.env.get('ASSEMBLYAI_WEBHOOK_SECRET')!
const ASSEMBLYAI_API = 'https://api.assemblyai.com/v2'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

interface WebhookBody {
  transcript_id: string
  status: 'completed' | 'error'
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('POST only', { status: 405 })
  }

  // Auth — shared secret in custom header.
  const secret = req.headers.get('X-Webhook-Secret') ?? req.headers.get('x-webhook-secret')
  if (!secret || secret !== ASSEMBLYAI_WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const url = new URL(req.url)
  const recordingId = url.searchParams.get('recording_id')
  const chunkIdxStr = url.searchParams.get('chunk_idx')
  if (!recordingId || chunkIdxStr == null) {
    return new Response('Missing recording_id or chunk_idx', { status: 400 })
  }
  const chunkIdx = Number(chunkIdxStr)
  if (!Number.isInteger(chunkIdx) || chunkIdx < 0) {
    return new Response('Bad chunk_idx', { status: 400 })
  }

  let body: WebhookBody
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  // Ack immediately, do the work in the background (waitUntil).
  // AssemblyAI requires 2xx within 10 s, this is the safe pattern.
  EdgeRuntime.waitUntil(handleCallback(recordingId, chunkIdx, body).catch((err) => {
    console.error('[assemblyai-webhook] background work failed:', err)
  }))

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})

async function handleCallback(recordingId: string, chunkIdx: number, body: WebhookBody) {
  // Validate the webhook payload references a chunk we actually expect.
  // This guards against:
  //   - Stale webhooks for jobs we rolled back / replaced (would otherwise
  //     overwrite the new job's pending state with old transcript text)
  //   - Spoofed payloads where someone with the secret sends a real
  //     transcript_id of their own to write attacker-controlled text
  //     into our chunk row
  const { data: chunk } = await supabase
    .from('class_recording_chunks')
    .select('assemblyai_job_id, status')
    .eq('recording_id', recordingId)
    .eq('idx', chunkIdx)
    .maybeSingle()
  if (!chunk) {
    console.warn('[assemblyai-webhook] unknown chunk', recordingId, chunkIdx)
    return
  }
  if (chunk.assemblyai_job_id && chunk.assemblyai_job_id !== body.transcript_id) {
    console.warn(
      '[assemblyai-webhook] job_id mismatch — expected',
      chunk.assemblyai_job_id,
      'got',
      body.transcript_id,
    )
    return
  }

  // Refresh heartbeat on the recording so the cron sweep doesn't trip.
  await supabase
    .from('class_recordings')
    .update({ last_heartbeat_at: new Date().toISOString() })
    .eq('id', recordingId)

  if (body.status === 'error') {
    // We don't have the error string in the webhook payload — go fetch it.
    // We also persist `audio_duration` if AssemblyAI gives it to us, so the
    // composeTranscript offset accumulator can advance by the chunk's real
    // length instead of the 3-minute fallback (avoids fake gaps in the
    // final transcript when a single chunk in the middle fails).
    const fetched = await fetchTranscriptDetails(body.transcript_id)
    const failedDurationMs = Math.round((Number(fetched?.audio_duration) || 0) * 1000)
    await supabase
      .from('class_recording_chunks')
      .update({
        status: 'failed',
        error: fetched?.error ?? 'AssemblyAI error',
        duration_ms: failedDurationMs > 0 ? failedDurationMs : null,
        transcribed_at: new Date().toISOString(),
      })
      .eq('recording_id', recordingId)
      .eq('idx', chunkIdx)
  } else {
    const fetched = await fetchTranscriptDetails(body.transcript_id)
    if (!fetched) {
      console.error('[assemblyai-webhook] could not load transcript', body.transcript_id)
      return
    }
    const utterances = Array.isArray(fetched.utterances) ? fetched.utterances : []
    const speakerLabels = identifyCoachSpeaker(utterances)
    const durationMs = Math.round((Number(fetched.audio_duration) || 0) * 1000)

    await supabase
      .from('class_recording_chunks')
      .update({
        status: 'transcribed',
        transcript_json: {
          utterances,
          text: typeof fetched.text === 'string' ? fetched.text : '',
          audio_duration: fetched.audio_duration,
        },
        speaker_labels: speakerLabels,
        duration_ms: durationMs,
        transcribed_at: new Date().toISOString(),
        error: null,
      })
      .eq('recording_id', recordingId)
      .eq('idx', chunkIdx)
  }

  // After every chunk callback, check whether the recording is now complete.
  await tryFinalizeRecording(recordingId)
}

async function fetchTranscriptDetails(jobId: string): Promise<any | null> {
  const res = await fetch(`${ASSEMBLYAI_API}/transcript/${jobId}`, {
    headers: { authorization: ASSEMBLYAI_API_KEY },
  })
  if (!res.ok) {
    console.error('[assemblyai-webhook] fetch transcript failed:', res.status, await res.text().catch(() => ''))
    return null
  }
  return await res.json()
}

async function tryFinalizeRecording(recordingId: string) {
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

  // Wait until every expected chunk has a terminal status (transcribed/failed).
  const terminal = all.filter((c) => ['transcribed', 'failed'].includes(c.status))
  if (terminal.length < rec.expected_chunks) return

  // Compose the final transcript across all chunks.
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
    // Nothing transcribable — mark failed but keep audio for manual review.
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

  // Atomic finalize via RPC: locks the recording row, INSERTs class_inputs
  // exactly once even under concurrent webhook callbacks (the last 2-3
  // chunks can complete within ms of each other and would otherwise both
  // pass a "if class_input_id is null" guard). The RPC is SECURITY DEFINER
  // and idempotent — concurrent callers serialize on the row lock and
  // the second one returns was_created=false so we skip side-effects.
  const { data: rpcRows, error: rpcErr } = await supabase.rpc(
    'finalize_recording_atomic',
    {
      p_recording_id: recordingId,
      p_transcript: composed,
      p_audio_folder: rec.audio_folder,
    },
  )
  const rpcRow = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows
  if (rpcErr || !rpcRow?.class_input_id) {
    console.error('[assemblyai-webhook] finalize RPC failed:', rpcErr?.message)
    await supabase
      .from('class_recordings')
      .update({ error: `finalize RPC: ${rpcErr?.message ?? 'unknown'}` })
      .eq('id', recordingId)
    return
  }

  // Only the actual creator sends the push — concurrent callers see
  // was_created=false and skip, preventing duplicate notifications when
  // multiple chunks finish within ms of each other.
  if (rpcRow.was_created) {
    try {
      await sendTranscriptReadyPush(rec.user_id, rpcRow.class_input_id)
    } catch (err) {
      console.warn('[assemblyai-webhook] push notif failed:', err instanceof Error ? err.message : err)
    }
  }
}

async function sendTranscriptReadyPush(userId: string, classInputId: string) {
  // The send-push edge function is wired up as a DB webhook on inserts into
  // the `notifications` table. Inserting a row both delivers the push (via
  // the webhook) and surfaces the notification in the in-app list.
  await supabase.from('notifications').insert({
    user_id: userId,
    type: 'transcript_ready',
    title: 'Cours transcrit',
    body: 'Ta classe est prête à être notée.',
    data: { class_input_id: classInputId },
  })
}
