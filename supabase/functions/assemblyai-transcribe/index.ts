// assemblyai-transcribe
//
// Server-side proxy for AssemblyAI. The coach recording pipeline's LEGACY
// fallback path used to call api.assemblyai.com directly from the app with
// EXPO_PUBLIC_ASSEMBLYAI_API_KEY — which shipped the account key inside every
// IPA (anyone could unzip the bundle and run unlimited transcription on our
// dime). This proxy keeps ASSEMBLYAI_API_KEY server-side (same secret the new
// pipeline's finalize-recording already uses).
//
// A full transcription can take minutes — longer than an edge function's
// wall-clock budget — so we split the work like the client used to:
//   * CREATE  (multipart POST with `file` [+ optional `prompt`])
//              → uploads the audio + creates the transcript job
//              → { jobId }
//   * POLL    (JSON POST { jobId })
//              → { status, utterances?, text?, durationMs?, error? }
// The client creates once, then polls every ~2s until completed/error. Each
// invocation is a fast round-trip, so we never block past the edge limit.
//
// Auth: user JWT (verify_jwt defaults to true for functions absent from
// config.toml; we also validate in-handler, mirroring whisper-transcribe).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ASSEMBLYAI_API_KEY = Deno.env.get('ASSEMBLYAI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ASSEMBLYAI_API = 'https://api.assemblyai.com/v2'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }
  const jwt = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !user) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!ASSEMBLYAI_API_KEY) {
    console.error('[assemblyai-transcribe] ASSEMBLYAI_API_KEY not configured')
    return json({ error: 'ASSEMBLYAI_API_KEY not configured server-side' }, 500)
  }

  const contentType = req.headers.get('content-type') ?? ''

  // ── POLL mode (JSON { jobId }) ────────────────────────────────────────────
  if (contentType.includes('application/json')) {
    let body: { jobId?: string }
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid JSON' }, 400)
    }
    const jobId = body?.jobId
    if (!jobId || typeof jobId !== 'string') {
      return json({ error: 'Missing jobId' }, 400)
    }

    const res = await fetch(`${ASSEMBLYAI_API}/transcript/${jobId}`, {
      headers: { authorization: ASSEMBLYAI_API_KEY },
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      console.error('[assemblyai-transcribe] poll error', res.status, t.slice(0, 300))
      return json({ error: `AssemblyAI poll ${res.status}` }, 502)
    }
    const jobData = await res.json()
    if (jobData.status === 'completed') {
      return json({
        status: 'completed',
        utterances: Array.isArray(jobData.utterances) ? jobData.utterances : [],
        text: typeof jobData.text === 'string' ? jobData.text : '',
        durationMs: Math.round((Number(jobData.audio_duration) || 0) * 1000),
      })
    }
    if (jobData.status === 'error') {
      return json({ status: 'error', error: jobData.error || 'unknown error' })
    }
    // queued / processing
    return json({ status: jobData.status ?? 'processing' })
  }

  // ── CREATE mode (multipart form with `file` [+ `prompt`]) ────────────────
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json({ error: 'Invalid form data' }, 400)
  }
  const file = form.get('file')
  if (!(file instanceof File)) {
    return json({ error: 'Missing or invalid file field' }, 400)
  }
  const promptRaw = form.get('prompt')
  const prompt = typeof promptRaw === 'string' && promptRaw.length > 0 ? promptRaw : null

  // 1. Upload raw audio bytes to AssemblyAI.
  const bytes = new Uint8Array(await file.arrayBuffer())
  const upRes = await fetch(`${ASSEMBLYAI_API}/upload`, {
    method: 'POST',
    headers: {
      authorization: ASSEMBLYAI_API_KEY,
      'content-type': 'application/octet-stream',
    },
    body: bytes,
  })
  if (!upRes.ok) {
    const t = await upRes.text().catch(() => '')
    console.error('[assemblyai-transcribe] upload error', upRes.status, t.slice(0, 300))
    return json({ error: `AssemblyAI upload ${upRes.status}` }, 502)
  }
  const { upload_url } = await upRes.json()
  if (!upload_url) {
    return json({ error: 'AssemblyAI upload returned no upload_url' }, 502)
  }

  // 2. Create the transcript job (same config the client used).
  const createBody: Record<string, unknown> = {
    audio_url: upload_url,
    speech_models: ['universal-3-pro'],
    speaker_labels: true,
    punctuate: true,
    format_text: true,
  }
  if (prompt) createBody.prompt = prompt

  const createRes = await fetch(`${ASSEMBLYAI_API}/transcript`, {
    method: 'POST',
    headers: {
      authorization: ASSEMBLYAI_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify(createBody),
  })
  if (!createRes.ok) {
    const t = await createRes.text().catch(() => '')
    console.error('[assemblyai-transcribe] create error', createRes.status, t.slice(0, 300))
    return json({ error: `AssemblyAI create ${createRes.status}` }, 502)
  }
  const { id: jobId } = await createRes.json()
  if (!jobId) {
    return json({ error: 'AssemblyAI create returned no job id' }, 502)
  }

  return json({ jobId })
})
