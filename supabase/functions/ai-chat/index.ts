import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { callAnthropic } from '../_shared/aiLogger.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
// Cost-control allow-list: this function is a general Claude proxy reachable by
// any authenticated user, so a client-supplied `model` must never be able to
// drive an arbitrary (expensive) tier. Anything not listed is coerced to the
// cheap default. Add models here only when the app legitimately needs them.
const ALLOWED_MODELS = new Set<string>([DEFAULT_MODEL])

Deno.serve(async (req: Request) => {
  // ── Auth ──
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  const jwt = authHeader.slice(7)

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const { data: { user }, error: authError } = await serviceClient.auth.getUser(jwt)
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), { status: 500 })
  }

  // ── Body ──
  let body: { systemPrompt?: string; prompt?: string; messages?: Array<{ role: string; content: string }>; maxTokens?: number; model?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 })
  }

  const { systemPrompt, prompt, messages, maxTokens = 500, model: requestedModel = DEFAULT_MODEL } = body
  const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : DEFAULT_MODEL

  // Support both modes: { systemPrompt, messages } (chat) or { prompt } (one-shot)
  const apiMessages = messages && messages.length > 0
    ? messages
    : prompt
    ? [{ role: 'user', content: prompt }]
    : null

  if (!apiMessages) {
    return new Response(JSON.stringify({ error: 'Missing prompt or messages' }), { status: 400 })
  }

  // ── Call Anthropic (via shared wrapper so every call is logged to
  //    ai_call_logs for cost tracking — this is the highest-volume client-
  //    facing AI path and was previously invisible to the cost dashboard). ──
  let data
  try {
    data = await callAnthropic(
      {
        model,
        max_tokens: Math.min(maxTokens, 2000),
        messages: apiMessages,
        ...(systemPrompt ? { system: systemPrompt } : {}),
      },
      { supabase: serviceClient, function_name: 'ai-chat', context: 'chat', user_id: user.id },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[ai-chat] Anthropic error', msg)
    return new Response(JSON.stringify({ error: msg }), { status: 502 })
  }

  const text = (data.content?.[0]?.text ?? '').trim()

  return new Response(
    JSON.stringify({ text }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
