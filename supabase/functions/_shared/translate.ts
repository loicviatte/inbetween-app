// Language-detect + Claude translation for transcript chunks.
//
// The primary assemblyai-webhook path detects a non-English class and translates
// its utterances/text to English before storing. The retry cron
// (transcribe-class-retry) writes chunk transcripts too, on the webhook-lost
// path, and must apply the SAME normalization — otherwise a recovered
// non-English class lands as an untranslated transcript. This module is the
// shared implementation so both paths agree.
//
// The API key is passed in (not read from a module const) so the same code runs
// under both edge functions' environments.

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'

export function isEnglishLang(languageCode: string): boolean {
  const l = String(languageCode || '').toLowerCase()
  return !l || l === 'en' || l.startsWith('en_') || l.startsWith('en-')
}

async function callClaudeForTranslation(
  apiKey: string | undefined,
  prompt: string,
  maxTokens: number,
): Promise<string | null> {
  if (!apiKey) {
    console.warn('[translate] ANTHROPIC_API_KEY not set; skipping translation')
    return null
  }
  try {
    const res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) {
      console.warn('[translate] http error:', res.status, await res.text().catch(() => ''))
      return null
    }
    const data = await res.json()
    const text = data?.content?.[0]?.text
    return typeof text === 'string' ? text : null
  } catch (err) {
    console.warn('[translate] threw:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function translateUtterancesToEnglish(
  apiKey: string | undefined,
  utterances: Array<{ start: number; end: number; speaker: string; text: string }>,
  sourceLang: string,
): Promise<Array<{ start: number; end: number; speaker: string; text: string }> | null> {
  if (!Array.isArray(utterances) || utterances.length === 0) return utterances
  const inputs = utterances.map((u) => String(u.text ?? ''))
  const prompt =
    `Translate each string in the JSON array below from ${sourceLang || 'the source language'} to English. ` +
    `Preserve dance terminology (waltz, rumba, paso doble, frame, hold, lead, follow, CBM, etc.) verbatim — do not translate dance terms. ` +
    `Preserve proper names. Keep tone natural. ` +
    `Return ONLY a JSON array of strings, same length and order as the input. No preamble, no markdown fences.\n\n` +
    `Input:\n${JSON.stringify(inputs)}`
  const raw = await callClaudeForTranslation(apiKey, prompt, 8192)
  if (!raw) return null
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    console.warn('[translate] utterances parse failed:', cleaned.slice(0, 200))
    return null
  }
  if (!Array.isArray(parsed) || parsed.length !== utterances.length) {
    console.warn('[translate] utterances bad shape', { expected: utterances.length, got: Array.isArray(parsed) ? parsed.length : 'not-array' })
    return null
  }
  return utterances.map((u, i) => ({
    ...u,
    text: typeof parsed[i] === 'string' ? (parsed[i] as string) : String(u.text ?? ''),
  }))
}

export async function translateTextToEnglish(
  apiKey: string | undefined,
  text: string,
  sourceLang: string,
): Promise<string | null> {
  if (!text || !text.trim()) return text
  const prompt =
    `Translate the following text from ${sourceLang || 'the source language'} to English. ` +
    `Preserve dance terminology (waltz, rumba, paso doble, frame, hold, lead, follow, CBM, etc.) verbatim — do not translate dance terms. ` +
    `Preserve proper names. Return ONLY the translation, no preamble.\n\n` +
    text
  const raw = await callClaudeForTranslation(apiKey, prompt, 8192)
  if (!raw) return null
  return raw.trim()
}
