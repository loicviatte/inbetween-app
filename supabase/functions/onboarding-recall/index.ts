// ─── onboarding-recall ──────────────────────────────────────────────────────
// Turns a student's own words about their last lesson into focus points, during
// onboarding — before they have an account.
//
// Every other AI path in this app is behind a user JWT. This one cannot be: the
// whole point of the onboarding is that the student sees what the app builds
// for them BEFORE signing up. So the abuse surface is closed by shape instead
// of by auth:
//   · the system prompt is fixed here and the caller supplies only free text
//   · max_tokens is small and the model is pinned to the cheap tier
//   · the recall is length-capped before it reaches Anthropic
//   · at most 3 calls per IP per minute, counted in the database — edge
//     functions run across isolates, so an in-memory counter would only ever
//     see a fraction of the traffic
// Nothing is written to the database: the focus points are returned to the
// device and only persisted if that person goes on to create an account.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { callAnthropic } from '../_shared/aiLogger.ts'

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_RECALL_CHARS = 1200
const WINDOW_SECONDS = 60
const MAX_PER_WINDOW = 3

const SYSTEM = `You turn a ballroom or Latin dance student's description of their last private lesson into focus points they can train tonight.

Return ONLY a JSON array of 3 objects, no prose, no code fence. Each object:
{"name": string, "subtitle": string, "dance": string, "tier": "critical"|"important", "drills": number, "minutes": number}

Rules:
- "name" is the correction itself, 2 to 6 words, in the student's own terms. Not a topic ("Rumba technique") — the actual fix ("Hip opening in the walk").
- "subtitle" is one short clause naming the mechanism, max 8 words.
- "dance" is a single dance name, or "" when the student did not say one. Never invent one.
- Exactly one focus point is "critical": the correction the student repeated or dwelt on. The rest are "important".
- "drills" is 3 or 4. "minutes" is 6 to 9.
- Use only what the student actually said. If they gave you little, say less — do not pad with generic advice.`

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: { recall?: unknown; style?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  // Nothing here may assume the caller sent a string: this endpoint takes no
  // JWT, so the body is whatever anyone felt like posting.
  const recall = (typeof body.recall === 'string' ? body.recall : '').trim().slice(0, MAX_RECALL_CHARS)
  if (recall.length < 12) return json({ error: 'Tell us a little more about the lesson.' }, 400)
  const style = body.style === 'Ballroom' || body.style === 'Latin & Ballroom' ? body.style : 'Latin'

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const since = new Date(Date.now() - WINDOW_SECONDS * 1000).toISOString()
  const { count } = await supabase
    .from('onboarding_recall_hits')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', since)
  if ((count ?? 0) >= MAX_PER_WINDOW) {
    return json({ error: 'Give it a moment, then try again.' }, 429)
  }
  await supabase.from('onboarding_recall_hits').insert({ ip })
  // Opportunistic sweep so the table cannot grow without bound.
  if (Math.random() < 0.02) {
    await supabase.from('onboarding_recall_hits')
      .delete().lt('created_at', new Date(Date.now() - 3600_000).toISOString())
  }

  let res
  try {
    res = await callAnthropic(
      {
        model: MODEL,
        max_tokens: 700,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Style: ${style}\n\nWhat the student said:\n${recall}` }],
      },
      { function_name: 'onboarding-recall', context: 'recall→focus points', user_id: null, supabase },
    )
  } catch (e) {
    return json({ error: 'Could not read that lesson.', detail: String(e) }, 502)
  }

  const text = res.content?.find((c) => c.type === 'text')?.text || ''
  // The model is told to return bare JSON; a stray fence should not cost the
  // student their answer, so the array is pulled out of whatever came back.
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return json({ error: 'Could not read that lesson.' }, 502)

  let points: unknown
  try { points = JSON.parse(match[0]) } catch { return json({ error: 'Could not read that lesson.' }, 502) }
  if (!Array.isArray(points) || points.length === 0) return json({ error: 'Could not read that lesson.' }, 502)

  const clean = points.slice(0, 3).map((p: Record<string, unknown>, i: number) => ({
    name: String(p.name || '').slice(0, 90) || 'Focus point',
    subtitle: String(p.subtitle || '').slice(0, 120),
    dance: String(p.dance || '').slice(0, 40),
    tier: p.tier === 'critical' && i === 0 ? 'critical' : (p.tier === 'critical' ? 'critical' : 'important'),
    drills: Math.max(1, Math.min(6, Number(p.drills) || 3)),
    minutes: Math.max(3, Math.min(20, Number(p.minutes) || 7)),
  }))
  // Exactly one critical, whatever the model did.
  if (!clean.some((p) => p.tier === 'critical')) clean[0].tier = 'critical'
  let keptCritical = false
  for (const p of clean) {
    if (p.tier !== 'critical') continue
    if (keptCritical) p.tier = 'important'
    keptCritical = true
  }

  return json({ points: clean })
})
