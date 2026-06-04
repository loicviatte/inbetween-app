// whisper-transcribe
//
// Server-side proxy for OpenAI Whisper. The mobile app used to call
// api.openai.com/v1/audio/transcriptions directly with EXPO_PUBLIC_OPENAI_API_KEY
// — which got the key shipped in the bundle and eventually disabled by
// OpenAI's GuardDog scanner. This proxy keeps OPENAI_API_KEY server-side
// and logs every transcription to ai_call_logs for cost tracking.
//
// Request:
//   POST /functions/v1/whisper-transcribe
//   Authorization: Bearer <user JWT>
//   Body: multipart/form-data
//     file: audio blob (m4a / mp3 / wav, anything Whisper supports)
//     prompt: optional string — domain context to bias transcription
//
// Response:
//   { text: "transcript here" }
//   Auth/format errors → 4xx
//   OpenAI errors      → 502 with the original error message

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { logOpenAICall } from '../_shared/aiLogger.ts'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

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
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  const jwt = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  if (!OPENAI_API_KEY) {
    console.error('[whisper-transcribe] OPENAI_API_KEY not configured')
    return new Response(
      JSON.stringify({ error: 'OPENAI_API_KEY not configured server-side' }),
      { status: 500 },
    )
  }

  // ── Parse incoming multipart ───────────────────────────────────────────
  let incoming: FormData
  try {
    incoming = await req.formData()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid form data' }), { status: 400 })
  }
  const file = incoming.get('file')
  if (!(file instanceof File) && !(file instanceof Blob)) {
    return new Response(JSON.stringify({ error: 'Missing or invalid file field' }), {
      status: 400,
    })
  }
  const promptRaw = incoming.get('prompt')
  const prompt = typeof promptRaw === 'string' && promptRaw.length > 0 ? promptRaw : null

  // ── Forward to OpenAI Whisper ──────────────────────────────────────────
  // verbose_json gives us a `duration` field we use for cost calculation.
  const outbound = new FormData()
  outbound.append(
    'file',
    file,
    file instanceof File ? file.name : 'recording.m4a',
  )
  outbound.append('model', 'whisper-1')
  outbound.append('response_format', 'verbose_json')
  if (prompt) outbound.append('prompt', prompt)

  const start = Date.now()
  let status: 'success' | 'error' = 'success'
  let errorMessage: string | null = null
  let durationSeconds = 0
  let text = ''
  let httpStatus = 200

  try {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: outbound,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      status = 'error'
      errorMessage = `Whisper ${res.status}: ${body.slice(0, 500)}`
      httpStatus = 502
      console.error('[whisper-transcribe]', errorMessage)
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: httpStatus,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const data = (await res.json()) as { text?: string; duration?: number }
    text = data.text ?? ''
    durationSeconds = Number(data.duration) || 0
    return new Response(JSON.stringify({ text }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    status = 'error'
    errorMessage = e instanceof Error ? e.message : String(e)
    httpStatus = 502
    console.error('[whisper-transcribe] threw:', errorMessage)
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: httpStatus,
      headers: { 'Content-Type': 'application/json' },
    })
  } finally {
    const duration_ms = Date.now() - start
    try {
      await logOpenAICall({
        // deno-lint-ignore no-explicit-any
        supabase: supabase as any,
        user_id: user.id,
        context: 'transcribe',
        model: 'whisper-1',
        audio_seconds: durationSeconds,
        duration_ms,
        status,
        error_message: errorMessage,
      })
    } catch {}
  }
})
