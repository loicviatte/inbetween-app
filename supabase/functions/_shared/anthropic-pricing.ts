// ───────────────────────────────────────────────────────────────────────
// Anthropic pricing snapshot — May 2026.
//
// Per Anthropic's public price list. Update the table below when prices
// change; the helper computes per-call USD cost from the usage block
// returned by /v1/messages.
//
// Pricing model (per million tokens):
//   - INPUT: prompt tokens NOT served from cache
//   - OUTPUT: assistant tokens generated
//   - CACHE WRITE: input tokens that wrote to the prompt cache. Charged
//     at 1.25× input rate (25 % premium) — one-time per cache key.
//   - CACHE READ: input tokens served from a cache hit. Charged at
//     0.10× input rate (90 % discount).
//
// The `usage` block returned by Anthropic has these fields:
//   {
//     input_tokens: number              // billed at input rate
//     output_tokens: number             // billed at output rate
//     cache_creation_input_tokens: number  // billed at input × 1.25
//     cache_read_input_tokens: number      // billed at input × 0.10
//   }
//
// Note: `input_tokens` in the response is the non-cached portion only;
// the cached portions are separated into their own fields. So we just
// sum the three categories with their respective multipliers.
// ───────────────────────────────────────────────────────────────────────

export interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

interface PricePerMTok {
  input: number   // USD per million input tokens
  output: number  // USD per million output tokens
}

// USD per 1M tokens.
// Adjust if Anthropic publishes a price change.
const PRICING: Record<string, PricePerMTok> = {
  'claude-opus-4-7':   { input: 15.0,  output: 75.0 },
  'claude-sonnet-4-6': { input: 3.0,   output: 15.0 },
  'claude-haiku-4-5':  { input: 0.80,  output: 4.0 },
  // Legacy / older models fall through to a conservative Sonnet 3.5 price.
  'claude-3-5-sonnet': { input: 3.0,   output: 15.0 },
  'claude-3-5-haiku':  { input: 0.80,  output: 4.0 },
}

// Cache pricing multipliers applied to the input rate.
const CACHE_WRITE_MULTIPLIER = 1.25
const CACHE_READ_MULTIPLIER = 0.10

function findPricing(model: string): PricePerMTok {
  // Exact match first.
  if (PRICING[model]) return PRICING[model]
  // Prefix match for versioned model IDs like 'claude-sonnet-4-6-20260301'.
  const prefixMatch = Object.keys(PRICING).find((key) => model.startsWith(key))
  if (prefixMatch) return PRICING[prefixMatch]
  // Unknown model — default to Sonnet 4.6 rates so we don't under-bill.
  console.warn(`[anthropic-pricing] Unknown model "${model}", defaulting to Sonnet 4.6 rates.`)
  return PRICING['claude-sonnet-4-6']
}

/**
 * Compute USD cost for an Anthropic call given the model and the usage
 * block from the response. Returns a number rounded to 6 decimals
 * (enough for sub-cent precision).
 */
export function computeAnthropicCost(model: string, usage: AnthropicUsage): number {
  const price = findPricing(model)
  const inputTok  = usage.input_tokens                ?? 0
  const outputTok = usage.output_tokens               ?? 0
  const writeTok  = usage.cache_creation_input_tokens ?? 0
  const readTok   = usage.cache_read_input_tokens     ?? 0

  const cost =
    (inputTok  * price.input)                          / 1_000_000 +
    (outputTok * price.output)                         / 1_000_000 +
    (writeTok  * price.input * CACHE_WRITE_MULTIPLIER) / 1_000_000 +
    (readTok   * price.input * CACHE_READ_MULTIPLIER)  / 1_000_000

  return Math.round(cost * 1_000_000) / 1_000_000
}
