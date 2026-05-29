// Wraps Anthropic Messages API calls and logs every call to ai_call_logs.
// Returns the raw response so the caller can extract content/text the way
// it wants. Logging is best-effort — a failure here never blocks the
// actual AI flow.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

// USD per million tokens. Add new models as they're used.
//
// Keys must match the EXACT model string used in the API call. Some callers
// pass the dated snapshot id (e.g. `claude-haiku-4-5-20251001`), others pass
// the family alias (e.g. `claude-haiku-4-5`). We strip the trailing date
// suffix in `lookupPricing()` below so both forms resolve to the same row.
const PRICING: Record<
  string,
  { input: number; output: number; cacheWrite: number; cacheRead: number }
> = {
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },
  'claude-opus-4-7': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  default: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
}

// Strip the trailing `-YYYYMMDD` snapshot date if present. So
// `claude-haiku-4-5-20251001` → `claude-haiku-4-5`, but
// `claude-haiku-4-5` → `claude-haiku-4-5` (unchanged).
function lookupPricing(model: string): typeof PRICING[string] {
  if (PRICING[model]) return PRICING[model]
  const stripped = model.replace(/-\d{8}$/, '')
  return PRICING[stripped] ?? PRICING.default
}

type AnthropicUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

function computeCost(model: string, usage: AnthropicUsage | undefined): number {
  if (!usage) return 0
  const rates = lookupPricing(model)
  return (
    ((usage.input_tokens ?? 0) * rates.input +
      (usage.output_tokens ?? 0) * rates.output +
      (usage.cache_creation_input_tokens ?? 0) * rates.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * rates.cacheRead) /
    1_000_000
  )
}

export type AnthropicCallArgs = {
  model: string
  max_tokens: number
  system?: string
  messages: Array<{ role: string; content: string }>
}

export type LogContext = {
  function_name: string
  context: string
  class_input_id?: string | null
  user_id?: string | null
  supabase: SupabaseClient
}

export type AnthropicResponse = {
  content?: Array<{ type: string; text?: string }>
  usage?: AnthropicUsage
  stop_reason?: string
}

export async function callAnthropic(
  args: AnthropicCallArgs,
  log: LogContext,
): Promise<AnthropicResponse> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  const start = Date.now()
  let parsed: AnthropicResponse | null = null
  let status: 'success' | 'error' = 'success'
  let errorMessage: string | null = null

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(args),
    })
    if (!res.ok) {
      status = 'error'
      errorMessage = `Anthropic API ${res.status}: ${await res.text()}`
      throw new Error(errorMessage)
    }
    parsed = (await res.json()) as AnthropicResponse
    return parsed
  } catch (e) {
    if (status !== 'error') {
      status = 'error'
      errorMessage = e instanceof Error ? e.message : String(e)
    }
    throw e
  } finally {
    const duration_ms = Date.now() - start
    try {
      await log.supabase.from('ai_call_logs').insert({
        function_name: log.function_name,
        context: log.context,
        model: args.model,
        class_input_id: log.class_input_id ?? null,
        user_id: log.user_id ?? null,
        input_tokens: parsed?.usage?.input_tokens ?? 0,
        output_tokens: parsed?.usage?.output_tokens ?? 0,
        cache_creation_input_tokens: parsed?.usage?.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: parsed?.usage?.cache_read_input_tokens ?? 0,
        cost_usd: computeCost(args.model, parsed?.usage),
        duration_ms,
        attempts: 1,
        status,
        error_message: errorMessage,
      })
    } catch (logErr) {
      console.warn('[aiLogger] failed to write ai_call_logs:', logErr)
    }
  }
}

// Helper: log an AssemblyAI transcription call (no token counts; price by
// audio_seconds_minute). Free plan = $0; standard plan ~$0.12/hour.
export async function logAssemblyAICall({
  supabase,
  class_input_id,
  audio_seconds,
  duration_ms,
  status,
  error_message,
  context = 'transcribe',
}: {
  supabase: SupabaseClient
  class_input_id?: string | null
  audio_seconds: number
  duration_ms: number
  status: 'success' | 'error'
  error_message?: string | null
  context?: string
}) {
  // AssemblyAI nano tier ≈ $0.12/hour audio = $0.00003333/sec
  const cost_usd = audio_seconds * (0.12 / 3600)
  try {
    await supabase.from('ai_call_logs').insert({
      function_name: 'assemblyai',
      context,
      model: 'assemblyai-nano',
      class_input_id: class_input_id ?? null,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd,
      duration_ms,
      attempts: 1,
      status,
      error_message,
    })
  } catch (logErr) {
    console.warn('[aiLogger] failed to log AssemblyAI call:', logErr)
  }
}

export type { SupabaseClient }
export { createClient }
