import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { callAnthropic } from '../_shared/aiLogger.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'

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

  const { systemPrompt, prompt, messages, maxTokens = 500, model = DEFAULT_MODEL } = body

  // Support both modes: { systemPrompt, messages } (chat) or { prompt } (one-shot)
  const apiMessages = messages && messages.length > 0
    ? messages
    : prompt
    ? [{ role: 'user', content: prompt }]
    : null

  if (!apiMessages) {
    return new Response(JSON.stringify({ error: 'Missing prompt or messages' }), { status: 400 })
  }

  // ── Call Anthropic via the shared wrapper so usage + cost lands in
  //     ai_call_logs alongside every other LLM call we make.
  let data
  try {
    data = await callAnthropic(
      {
        model,
        max_tokens: Math.min(maxTokens, 2000),
        system: systemPrompt,
        messages: apiMessages,
      },
      {
        function_name: 'ai-chat',
        context: 'chat',
        // Conversational chat isn't tied to a specific class.
        class_input_id: null,
        user_id: user.id,
        // deno-lint-ignore no-explicit-any
        supabase: serviceClient as any,
      },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[ai-chat] Anthropic error', msg)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 502 }
    )
  }

  const text = (data.content?.[0]?.text ?? '').trim()

  return new Response(
    JSON.stringify({ text }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
