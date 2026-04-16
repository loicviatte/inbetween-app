import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

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

  // ── Call Anthropic ──
  const payload: Record<string, unknown> = {
    model,
    max_tokens: Math.min(maxTokens, 2000),
    messages: apiMessages,
  }
  if (systemPrompt) payload.system = systemPrompt

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error('[ai-chat] Anthropic error', res.status, errText)
    return new Response(
      JSON.stringify({ error: `Anthropic ${res.status}: ${errText}` }),
      { status: 502 }
    )
  }

  const data = await res.json()
  const text = (data.content?.[0]?.text ?? '').trim()

  return new Response(
    JSON.stringify({ text }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
