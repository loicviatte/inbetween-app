/**
 * One-time backfill: classify existing focus_points that have no category.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... node tools/backfill-categories.mjs
 *
 * SUPABASE_URL and ANTHROPIC_API_KEY are read from .env automatically.
 * SUPABASE_SERVICE_ROLE_KEY is found in Supabase Dashboard → Settings → API.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// Load .env from project root
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../.env')
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (match) process.env[match[1].trim()] = match[2].trim()
}

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANTHROPIC_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY

if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY. Get it from Supabase Dashboard → Settings → API.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const VALID_CATEGORIES = ['Stability', 'Technicality', 'Strength', 'Creativity', 'Musicality']
const BATCH_SIZE = 50

async function classifyBatch(focusPoints) {
  const items = focusPoints.map((fp, i) => `${i + 1}. title: "${fp.name}"${fp.subtitle ? `, subtitle: "${fp.subtitle}"` : ''}`)

  const prompt = `You are classifying dance lesson focus points into exactly one of five categories:
- Stability: balance, posture, frame, hold, weight distribution, hip position, grounding
- Technicality: footwork, steps, rotation, timing, lead/follow, CBM, alignment, rise/fall, swing/sway
- Strength: power, drive, energy, speed, force, endurance, push/pull
- Creativity: expression, artistry, performance, character, style, interpretation, emotion, presentation
- Musicality: rhythm, beat, tempo, phrasing, accent, musical interpretation, syncopation

For each focus point below, return exactly one category. Pick the best fit.

Focus points:
${items.join('\n')}

Return ONLY a JSON array of strings, one per focus point, in the same order. Example: ["Stability", "Technicality", "Musicality"]
No explanation, no markdown.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`)

  const data = await res.json()
  const raw = (data.content?.[0]?.text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const categories = JSON.parse(raw)

  if (!Array.isArray(categories) || categories.length !== focusPoints.length) {
    throw new Error(`Unexpected response length: got ${categories.length}, expected ${focusPoints.length}`)
  }

  return categories.map(cat => VALID_CATEGORIES.includes(cat) ? cat : null)
}

async function run() {
  // Load all focus points without a category
  const { data: fps, error } = await supabase
    .from('focus_points')
    .select('id, name, subtitle')
    .is('category', null)
    .eq('is_deleted', false)

  if (error) { console.error('Failed to load focus points:', error.message); process.exit(1) }
  if (!fps?.length) { console.log('No focus points without category. Nothing to do.'); return }

  console.log(`Found ${fps.length} focus points to classify`)

  let updated = 0
  let failed = 0

  for (let i = 0; i < fps.length; i += BATCH_SIZE) {
    const batch = fps.slice(i, i + BATCH_SIZE)
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1} / ${Math.ceil(fps.length / BATCH_SIZE)} (${batch.length} items)...`)

    let categories
    try {
      categories = await classifyBatch(batch)
    } catch (err) {
      console.error(`  Batch failed: ${err.message}`)
      failed += batch.length
      continue
    }

    for (let j = 0; j < batch.length; j++) {
      const fp = batch[j]
      const cat = categories[j]
      if (!cat) { console.warn(`  Skipping "${fp.name}" — invalid category returned`); failed++; continue }

      const { error: updateError } = await supabase
        .from('focus_points')
        .update({ category: cat })
        .eq('id', fp.id)

      if (updateError) {
        console.error(`  Failed to update "${fp.name}": ${updateError.message}`)
        failed++
      } else {
        console.log(`  ✓ "${fp.name}" → ${cat}`)
        updated++
      }
    }
  }

  console.log(`\nDone. Updated: ${updated}, Failed: ${failed}`)
}

run().catch(err => { console.error(err); process.exit(1) })
