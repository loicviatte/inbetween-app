import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { computeAnthropicCost, AnthropicUsage } from '../_shared/anthropic-pricing.ts'

// ─── Deno / Supabase Edge Runtime globals ────────────────────────────────────

declare global {
  const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClassInputRecord {
  id: string
  user_id: string
  transcript: string | null
  raw_ai_json: unknown | null
  lesson_type: string | null
  student_ids: string[] | null
  student_id: string | null
  status: string | null
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: ClassInputRecord
}

// ─── Style rule & sanitizer (applies to every AI output) ─────────────────────

const NO_HYPHEN_RULE = `

## CRITICAL STYLE RULE — NO HYPHENS
Never use hyphens, en dashes, or em dashes in any string value. Do not use "-", "–", or "—" anywhere — not in titles, subtitles, context, drills, class_summary, notes, reasoning, or any other text field. Replace with a space, a comma, or rephrase. Applies to every text field inside the JSON.`

function stripHyphens(str: string): string {
  if (!str) return str
  return String(str)
    .replace(/[\u2010-\u2015\u2212\-]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([.,;:!?])/g, '$1')
    .trim()
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Recursively walk a parsed JSON object and strip hyphens from every string,
// except UUID values and any key ending in _id (to protect primary keys).
function sanitizeStrings<T>(value: T, parentKey?: string): T {
  if (typeof value === 'string') {
    if (UUID_RE.test(value)) return value as unknown as T
    if (parentKey && /_id$|^id$/.test(parentKey)) return value as unknown as T
    return stripHyphens(value) as unknown as T
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeStrings(v, parentKey)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeStrings(v, k)
    }
    return out as unknown as T
  }
  return value
}

// Hard cap drill length to a gym-prescription style. We keep the first
// imperative sentence and at most one short reps/counts line. Anything
// beyond that is the model relapsing into explanation mode and we strip
// it before persisting. The display layer also chunks by newline.
function trimDrill(raw: unknown): string | null {
  if (typeof raw !== 'string') return raw as null
  const cleaned = raw.replace(/\r/g, '').trim()
  if (!cleaned) return null
  // Split on existing line breaks first, then on sentence boundaries.
  const lines = cleaned
    .split(/\n+/)
    .flatMap((l) => l.split(/(?<=[.!?])\s+/))
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return null
  const first = lines[0].slice(0, 140)
  // Pick a short trailing line that looks like reps / counts / time.
  const repsRegex = /^\d|reps?\b|sets?\b|seconds?\b|sec\b|minutes?\b|min\b|each (side|leg|arm)|hold/i
  const reps = lines.slice(1).find((l) => l.length <= 40 && repsRegex.test(l))
  return reps ? `${first}\n${reps}` : first
}

// Walk the extracted JSON and apply trimDrill to every "drill" field.
function trimAllDrills(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(trimAllDrills)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = k === 'drill' ? trimDrill(v) : trimAllDrills(v)
    }
    return out
  }
  return value
}

// ─── Anthropic call with retry on 5xx / 429 ──────────────────────────────────
//
// Anthropic returns 529 ("Overloaded") sporadically during traffic spikes —
// they explicitly document it as retriable. 503 and 502 occur during deploys.
// 429 means we're being rate-limited.
//
// Without retry, a single transient blip on Anthropic's side kills a coach's
// class permanently (status=error, no focus points ever shown). We saw this
// in prod on 2026-05-12 — testmarius's class extraction got a 529 on the
// first call and stayed broken until manual intervention.
//
// Strategy: up to 4 attempts, exponential backoff (2s, 4s, 8s). Non-retriable
// errors (4xx other than 429) throw immediately so we don't waste minutes
// retrying e.g. a malformed prompt.

interface AnthropicCallOptions {
  /** Tag the call so logs separate "extract" vs "title" vs "dedupe". */
  context: string
  /** Active Supabase client — required to log to ai_call_logs.
   * Pass undefined and we skip logging (no crash). */
  supabase?: ReturnType<typeof createClient>
  /** class_input_id this call belongs to, for billing rollup. */
  classInputId?: string
  /** user_id of the coach whose class is being processed. */
  userId?: string
}

async function fetchAnthropicWithRetry(
  body: Record<string, unknown>,
  options: AnthropicCallOptions,
): Promise<Response> {
  const { context, supabase, classInputId, userId } = options
  const url = 'https://api.anthropic.com/v1/messages'
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
    'anthropic-version': '2023-06-01',
  }
  const model = (body.model as string | undefined) ?? 'unknown'

  const MAX_ATTEMPTS = 4
  let lastErrText = ''
  let lastStatus = 0
  const startedAt = Date.now()

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
    } catch (err) {
      // Network-level failure (DNS, TLS, socket reset) — same retry policy
      lastErrText = err instanceof Error ? err.message : String(err)
      console.error(`[yoda-extract] ${context} network error on attempt ${attempt}: ${lastErrText}`)
      if (attempt === MAX_ATTEMPTS) {
        await logAnthropicCallSafe(supabase, {
          function_name: 'yoda-extract',
          context,
          model,
          class_input_id: classInputId,
          user_id: userId,
          status: 'error',
          attempts: attempt,
          duration_ms: Date.now() - startedAt,
          error_message: lastErrText,
          usage: null,
        })
        throw new Error(`Anthropic API network error after ${MAX_ATTEMPTS} attempts: ${lastErrText}`)
      }
      const backoffMs = 2000 * Math.pow(2, attempt - 1)
      await new Promise((r) => setTimeout(r, backoffMs))
      continue
    }

    if (res.ok) {
      // Drain the body, extract usage for cost logging, and return a
      // fresh Response so the caller can .json() it normally.
      const text = await res.text()
      let usage: AnthropicUsage | null = null
      try {
        const parsed = JSON.parse(text)
        usage = parsed?.usage ?? null
      } catch {
        // Caller will trip on its own JSON parse if the body is bad.
      }
      await logAnthropicCallSafe(supabase, {
        function_name: 'yoda-extract',
        context,
        model,
        class_input_id: classInputId,
        user_id: userId,
        status: 'success',
        attempts: attempt,
        duration_ms: Date.now() - startedAt,
        usage,
      })
      return new Response(text, { status: res.status, headers: res.headers })
    }

    lastStatus = res.status
    lastErrText = await res.text()

    // 429 = rate limit; 5xx = server problems on Anthropic's side. All
    // documented as retriable. 4xx (other than 429) means our request is
    // malformed — retrying won't help, fail fast.
    const isRetriable = res.status === 429 || res.status >= 500
    console.error(
      `[yoda-extract] ${context} Anthropic ${res.status} on attempt ${attempt}/${MAX_ATTEMPTS}: ${lastErrText.slice(0, 200)}`,
    )

    if (!isRetriable || attempt === MAX_ATTEMPTS) {
      await logAnthropicCallSafe(supabase, {
        function_name: 'yoda-extract',
        context,
        model,
        class_input_id: classInputId,
        user_id: userId,
        status: 'error',
        attempts: attempt,
        duration_ms: Date.now() - startedAt,
        error_message: `${res.status}: ${lastErrText.slice(0, 500)}`,
        usage: null,
      })
      throw new Error(`Anthropic API ${res.status}: ${lastErrText}`)
    }

    // Anthropic includes a Retry-After header on 429; honor it if present.
    const retryAfter = res.headers.get('retry-after')
    let backoffMs = 2000 * Math.pow(2, attempt - 1) // 2s, 4s, 8s
    if (retryAfter) {
      const ra = parseInt(retryAfter, 10)
      if (!isNaN(ra) && ra > 0 && ra < 60) backoffMs = ra * 1000
    }
    console.log(`[yoda-extract] ${context} retrying in ${backoffMs}ms…`)
    await new Promise((r) => setTimeout(r, backoffMs))
  }

  throw new Error(`Anthropic API ${lastStatus}: ${lastErrText}`)
}

/**
 * Best-effort insert into ai_call_logs. Never throws — a logging failure
 * shouldn't kill the actual processing call. Cost is computed from
 * usage when present; absent usage (errors) records 0.
 */
async function logAnthropicCallSafe(
  supabase: ReturnType<typeof createClient> | undefined,
  row: {
    function_name: string
    context: string
    model: string
    class_input_id?: string
    user_id?: string
    status: 'success' | 'error'
    attempts: number
    duration_ms: number
    error_message?: string
    usage: AnthropicUsage | null
  },
): Promise<void> {
  if (!supabase) return
  try {
    const usage = row.usage ?? {}
    const costUsd = row.usage ? computeAnthropicCost(row.model, usage) : 0
    await supabase.from('ai_call_logs').insert({
      function_name: row.function_name,
      context: row.context,
      model: row.model,
      class_input_id: row.class_input_id ?? null,
      user_id: row.user_id ?? null,
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cost_usd: costUsd,
      duration_ms: row.duration_ms,
      attempts: row.attempts,
      status: row.status,
      error_message: row.error_message ?? null,
    })
  } catch (err) {
    console.error('[ai_call_logs] insert failed:', err instanceof Error ? err.message : String(err))
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Yoda Extract, a specialized AI that processes coaching lesson transcripts. Your sole job is to output a single structured JSON object — nothing else. No explanation, no preamble, no markdown.

## INPUTS YOU RECEIVE
- lesson_type: "private" or "public"
- coach_name: string
- coach_speaker_id: string (e.g. "A")
- students: array of { id, name }
- existing_focus_points: array of { id, name, subtitle, tier } — focus points already in the system for each student
- transcript: raw lesson transcript with paragraph timestamps in format [MM:SS - MM:SS] Speaker X: ...

## WHAT IS A FOCUS POINT
A focus point is a specific correction tied to a single root cause.
- ONE focus point = ONE root cause (not one symptom)
- If the coach addresses "shoulders rising" and "arm collapsing" → that is ONE focus point: back connection. The symptoms go in the context field, not as separate focus points.

NOT a focus point:
- General encouragement ("good job", "much better")
- Administrative talk ("see you next week", "let's take a break")
- Warm-up instructions with no specific correction attached
- Vague observations without actionable direction ("you seem tired today")
- Off-topic conversation unrelated to the lesson

## ASSIGNMENT RULES
- Private lesson → assign all focus points to the student they are directed at
- Public lesson → only assign a focus point to a student if their name is explicitly mentioned, OR if the coach uses directed language like "work on this for next class" / "you need to practice this"
- Public lesson with a directive aimed at the whole class ("you guys", "everyone", "the class") that includes a concrete corrective action, drill, or priority → put it in "shared_focus_points" (applies to every student in the class). Same structure as a regular focus point, no student_id.
- Generic motivational talk, admin, or vague observations → coach_knowledge only, no focus point created
- If you cannot confidently assign a correction to a specific student or the whole class, do not create a focus point

## SELECTING FOCUS POINTS
Extract all corrections first. Then select the most important ones as focus_points based on these criteria, in order of weight:

1. Time ratio — how much of the total lesson duration was spent addressing this point. This is the strongest signal.
2. Mention count — how many times the coach returned to this point
3. Explicit priority — coach used words like "most important", "above all", "focus on this", "before anything else"

Rules:
- Minimum 1, maximum 3 focus points per student
- Only include what is genuinely important — do not force 3 if only 1 or 2 qualify
- All remaining corrections go into other_focus_points

## TIER
Each focus point must have a tier:
- "critical" — the most important focus point in this lesson (max 1 per student)
- "important" — significant but secondary
- "supporting" — worth tracking but lower priority

## MERGE DETECTION
Compare each extracted focus point against the student's existing_focus_points.

- If the root cause is clearly the SAME concept (even if described differently): set merge_action = "auto_merge", existing_focus_point_id = <id of the matching existing focus point>
- If the root cause MIGHT be the same but you are not certain: set merge_action = "notify_coach", existing_focus_point_id = <id of the most likely match>
- If it is clearly a new concept: set merge_action = null, existing_focus_point_id = null

## COACH SIGNAL
If the coach explicitly signals progress or regression on an EXISTING focus point for a specific student:
- Positive: "much better", "you've really improved on this", "this is looking good now" → coach_signal = "positive"
- Negative: "still struggling with", "this is getting worse", "we really need to fix this" → coach_signal = "negative"
- Only set this for existing focus points (include existing_focus_point_id alongside it)
- Omit the field or set null if no explicit signal

## FOR EACH FOCUS POINT

### title
- 1 to 2 words maximum
- A mental tag the student can instantly recall
- Must not be ambiguous or plurivocal
- No hyphens
- Examples: "Hips Settle", "Back Connection", "Go Extreme"

### subtitle
- One short actionable instruction
- Must be fully understandable without reading the context
- No hyphens
- Examples: "Hip settles on every weight transfer", "Connect through your back, not your shoulders", "Push movement to its limit, medium is not enough"

### context
- Written in second person ("you", "your") as if speaking directly to the student
- Explains the root cause, not the symptoms
- Symptoms can be mentioned to illustrate, but the focus must be on why the problem exists
- No hyphens

### dance
- Array of dance names this focus point applies to, based only on what the coach explicitly mentioned
- Example: ["Rumba", "Cha-cha", "Samba"]

### drill
- A short, gym style exercise prescription the student can do alone. Think
  of how a strength coach writes a workout, NOT how a teacher explains a
  concept. All the explanation already lives in the "context" field, so do
  not repeat it here.
- HARD LENGTH LIMIT: maximum 25 words total in the drill field. If the
  coach's explicit instruction is longer than that, distill it to the
  bare action and reps. Long drills are a bug, not a feature.
- Format: ONE short imperative sentence (the action), optionally followed
  by a single line of reps or counts in this exact form: "3 sets of 8" or
  "30 seconds" or "10 reps each side". Never produce 3+ sentences. Never
  produce paragraphs. Never re-explain why.
- Based strictly on what the coach said explicitly. Do not invent a drill
  if the coach did not give one. Do not reformulate the correction as a
  drill.
- null if the coach gave no explicit exercise.

Good drill examples (target style):
  "Slow side step with weight transfer. 3 sets of 8."
  "Hip drop on the 4 count, walking pattern. 30 seconds."
  "Stand on one leg with arm frame held. Hold 20 seconds each side."

Bad drill examples (do NOT do this):
  Anything 3+ sentences. Anything that explains the concept. Anything
  with bullet points listing common mistakes. Anything starting with
  "First, ... Then, ... Finally, ...".

### category
Classify this focus point into exactly one of these five categories:
- "Stability" — balance, posture, frame, hold, weight distribution, hip position, grounding
- "Technicality" — footwork, steps, rotation, timing, lead/follow, CBM, alignment, rise/fall, swing/sway
- "Strength" — power, drive, energy, speed, force, endurance, push/pull
- "Creativity" — expression, artistry, performance, character, style, interpretation, emotion, presentation
- "Musicality" — rhythm, beat, tempo, phrasing, accent, musical interpretation, syncopation

Pick the best fit. Every focus point must have a category.

### Other fields
- timestamp: MM:SS when first addressed (from paragraph timestamps)
- mention_count: how many times this was addressed across the full lesson
- explicit_priority: true if coach used words like "most important", "above all", "focus on this", "before anything else"

## CLASS SUMMARY
For each student, write a "class_summary" as a thorough recap of the whole lesson — proper meeting minutes, not a teaser. The student should be able to re read this weeks later and reconstruct what was actually covered without watching the video again. Cover EVERY meaningful idea raised during the class; do not pick three favourites and skip the rest.

Required structure (use literal newline characters \\n inside the JSON string to separate lines):

1. Overview paragraph: 2 to 4 full sentences describing the overall theme, the dance(s) worked on, and the main thread the coach pulled through. This is prose, not bullets.

2. A blank line.

3. The literal header "Topics covered:" on its own line.

4. One bullet per distinct teaching point raised in the lesson. Use as many bullets as the transcript actually contains, but never fewer than 2 and never more than 10. Each bullet:
   - Starts with "• " (bullet character + one space).
   - Names the technique, principle, or correction.
   - Explains WHAT to do and WHY in one or two complete sentences (12 to 30 words).
   - Quotes or paraphrases the coach when the wording is memorable.
   - Stays specific to this lesson; never invent points that were not discussed.

5. A blank line.

6. The literal header "Drills:" on its own line — INCLUDE THIS SECTION ONLY if the coach prescribed at least one concrete drill. Then one bullet per drill, formatted "• Drill name: reps, sets, duration, and any cue the coach attached." If no drill was prescribed, omit the header and the section entirely.

7. A blank line (only if Drills section was rendered).

8. The literal header "Watch out:" on its own line — INCLUDE THIS SECTION ONLY if the coach gave explicit warnings or pointed at recurring mistakes. Then 1 to 3 bullets describing what to avoid. If nothing of the kind was said, omit the section entirely.

9. A blank line (only if Watch out section was rendered).

10. The literal header "Next session focus:" on its own line — INCLUDE THIS SECTION ONLY if the coach explicitly named something to prepare or revisit next time. Then 1 or 2 short bullets. If not mentioned, omit the section entirely.

Rules:
- Be exhaustive but not redundant. If the coach repeats a point, summarise it once.
- Always include the Overview and Topics covered sections; the other sections are conditional.
- Use proper sentences; do not write keyword fragments.
- No hyphens, en dashes, or em dashes anywhere (per the global style rule).
- Do not number bullets. Do not capitalise the entire bullet. End every full sentence with a period.
- Keep the language faithful to what the coach actually said. Do not embellish.

Example value of "class_summary" (for a longer lesson; shorter lessons should still hit the structure but with fewer bullets):

"This session focused on building genuine speed in Jive while keeping the rest of the technique honest. The coach framed speed as the urgent priority for the student and contrasted it with Rumba, where the same conditioning would be counter productive. Most of the hour was spent translating that priority into a single, repeatable conditioning drill.\\n\\nTopics covered:\\n• Speed in Jive comes from leg drive, not upper body tension. Crisp kicks must survive the increased tempo.\\n• Use the full diagonal of the studio so the body learns to recover speed across distance, not just short bursts.\\n• Slow walk back between sprints lets the heart rate drop and protects technique on the next rep.\\n• Specificity matters: this conditioning is not needed in Rumba and would actually hurt that dance's quality.\\n\\nDrills:\\n• Studio sprint intervals: full studio length sprint then slow walk back, 10 reps inside one minute, 2 minute pause, 5 sets.\\n\\nWatch out:\\n• Tendency to slow down on the second half of the bar once fatigue sets in.\\n\\nNext session focus:\\n• Bring evidence the sprint drill was practised before the next lesson so we can build on it."

## OTHER FOCUS POINTS
All corrections that did not qualify as focus_points go here.
No limit on number.
Simplified format only:
- title: 1 to 2 words, same rules as focus point title
- timestamp: MM:SS when first addressed
- dance: array of dance names

## COACH KNOWLEDGE
Extract everything that reveals how this coach teaches:
- Technical tips and principles
- Metaphors or images used
- Drills introduced (even if already in a student's focus points)
- Recurring explanation patterns

Each entry:
- type: "tip" | "metaphor" | "drill" | "principle"
- content: the insight in English, in the coach's own words when possible. No hyphens.

## OUTPUT FORMAT
Always return this exact structure:

{
  "students": [
    {
      "student_id": string,
      "student_name": string,
      "class_summary": string,
      "focus_points": [
        {
          "title": string,
          "subtitle": string,
          "context": string,
          "dance": [string],
          "drill": string | null,
          "timestamp": "MM:SS",
          "mention_count": number,
          "explicit_priority": boolean,
          "tier": "critical" | "important" | "supporting",
          "category": "Stability" | "Technicality" | "Strength" | "Creativity" | "Musicality",
          "merge_action": "auto_merge" | "notify_coach" | null,
          "existing_focus_point_id": string | null,
          "coach_signal": "positive" | "negative" | null
        }
      ],
      "other_focus_points": [
        {
          "title": string,
          "timestamp": "MM:SS",
          "dance": [string]
        }
      ]
    }
  ],
  "shared_focus_points": [
    {
      "title": string,
      "subtitle": string,
      "context": string,
      "dance": [string],
      "drill": string | null,
      "timestamp": "MM:SS",
      "mention_count": number,
      "explicit_priority": boolean,
      "tier": "critical" | "important" | "supporting",
      "category": "Stability" | "Technicality" | "Strength" | "Creativity" | "Musicality"
    }
  ],
  "coach": {
    "coach_name": string,
    "lesson_type": "private" | "public",
    "total_students_in_class": number,
    "knowledge": [
      {
        "type": string,
        "content": string
      }
    ]
  }
}`

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  let record: ClassInputRecord | null = null
  try {
    const payload: WebhookPayload = await req.json()
    record = payload.record
  } catch (err) {
    console.error('[yoda-extract] Failed to parse webhook payload:', err)
    return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 })
  }

  // Respond to the webhook immediately to avoid timeout
  EdgeRuntime.waitUntil(processRecord(record))

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})

// ─── Group class attendance notification ──────────────────────────────────────

async function notifyGroupClassAttendance(
  supabase: ReturnType<typeof createClient>,
  classInputId: string,
  coachId: string,
  coachName: string,
  classDate: string,
): Promise<void> {
  // Group class flow does not require the coach to pre-select attendees:
  // every student in the same dance studio as the coach gets prompted, and
  // the coach edits the attendance roster afterwards from the class detail.
  const { data: coach } = await supabase
    .from('users')
    .select('studio_id')
    .eq('id', coachId)
    .maybeSingle()

  let studentIds: string[] = []
  if (coach?.studio_id) {
    const { data: students } = await supabase
      .from('users')
      .select('id')
      .eq('studio_id', coach.studio_id)
      .eq('role', 'student')
    studentIds = (students ?? []).map((s: any) => s.id)
  }

  if (studentIds.length === 0) {
    // Coach has no studio (or studio is empty) — keep the prompt useful by
    // falling back to their connected students.
    const { data: requests } = await supabase
      .from('coach_requests')
      .select('student_id')
      .eq('coach_id', coachId)
      .eq('status', 'accepted')
    studentIds = (requests ?? []).map((r: any) => r.student_id)
  }

  if (studentIds.length === 0) return

  // UPSERT preserves anything `finalize_recording_atomic` already wrote
  // (e.g. attendance the coach started editing) while ensuring every
  // studio member ends up represented in class_input_students.
  const cisRows = studentIds.map((sid: string) => ({
    class_input_id: classInputId,
    student_id: sid,
    attendance: 'pending',
  }))
  await supabase
    .from('class_input_students')
    .upsert(cisRows, { onConflict: 'class_input_id,student_id' })

  const notifications = studentIds.map((sid: string) => ({
    user_id: sid,
    type: 'group_class_attendance',
    title: `Were you at ${coachName}'s group class?`,
    body: `Class on ${classDate} — confirm your attendance to receive your focus points.`,
    data: { class_input_id: classInputId, coach_name: coachName, class_date: classDate },
  }))
  const { error } = await supabase.from('notifications').insert(notifications)
  if (error) console.error('[yoda-extract] Failed to insert attendance notifications:', error.message)
  else console.log(`[yoda-extract] ✓ Sent attendance notifications to ${studentIds.length} studio students for class ${classInputId}`)
}

// ─── Generate alternative versions for each focus point ──────────────────────

async function generateAlternatives(
  supabase: ReturnType<typeof createClient>,
  classInputId: string,
  studentId: string,
  focusPoints: any[],
): Promise<void> {
  if (!focusPoints || focusPoints.length === 0) return

  const simplifiedFPs = focusPoints.map(fp => ({
    title: fp.title,
    subtitle: fp.subtitle,
    context: fp.context,
    drill: fp.drill ?? null,
    dance: fp.dance ?? [],
  }))

  const altPrompt = `You are generating alternative phrasings for dance lesson focus points, for a human trainer to evaluate and improve the AI.

For each focus point given:
1. Add a "reasoning" field to the original — a 1-sentence explanation of why this phrasing was chosen (angle, emphasis, word choice).
2. Produce exactly 2 alternative versions, each also with a "reasoning" field explaining its different angle or approach.
Same root cause across all 3. Keep the same "dance" array. Vary title (1-2 words), subtitle (one short actionable sentence), context (second person), drill if present.

Input focus points:
${JSON.stringify(simplifiedFPs)}

Return ONLY a JSON object with this structure:
{
  "originals": [
    { "title": "...", "subtitle": "...", "context": "...", "drill": "...", "dance": [...], "reasoning": "Chosen because..." },
    ...
  ],
  "alternatives": [
    [
      { "title": "...", "subtitle": "...", "context": "...", "drill": "...", "dance": [...], "reasoning": "Takes a more X approach..." },
      { "title": "...", "subtitle": "...", "context": "...", "drill": "...", "dance": [...], "reasoning": "Focuses on Y instead..." }
    ],
    ...
  ]
}
No markdown, no explanation.${NO_HYPHEN_RULE}`

  const altRes = await fetchAnthropicWithRetry(
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{ role: 'user', content: altPrompt }],
    },
    { context: 'alternatives', supabase, classInputId },
  )

  const altData = await altRes.json()
  const rawAltText: string = (altData.content?.[0]?.text ?? '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let parsed: { originals: any[]; alternatives: any[][] }
  try {
    parsed = JSON.parse(rawAltText)
  } catch {
    throw new Error(`Failed to parse alternatives JSON: ${rawAltText.slice(0, 300)}`)
  }
  parsed = trimAllDrills(sanitizeStrings(parsed)) as typeof parsed

  // Insert one row per focus point
  const rows = simplifiedFPs.map((chosenFP, fpIndex) => {
    const enrichedChosen = { ...chosenFP, reasoning: parsed.originals?.[fpIndex]?.reasoning ?? null }
    const alts = parsed.alternatives?.[fpIndex] ?? []
    const alt1 = alts[0] ?? { ...chosenFP, reasoning: null }
    const alt2 = alts[1] ?? { ...chosenFP, reasoning: null }
    return {
      class_input_id: classInputId,
      student_id: studentId,
      focus_point_index: fpIndex,
      versions: [enrichedChosen, alt1, alt2],
      chosen_index: 0,
      reviewed: false,
    }
  })

  const { error } = await supabase.from('ai_training_candidates').insert(rows)
  if (error) {
    throw new Error(`ai_training_candidates insert error: ${error.message}`)
  }

  console.log(`[yoda-extract] ✓ Stored ${rows.length} training candidates for class ${classInputId}, student ${studentId}`)
}

// ─── Load recent trainer feedback to inject as examples ───────────────────────

async function loadTrainerFeedback(supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data, error } = await supabase
    .from('ai_feedback')
    .select(`
      rating,
      comment,
      version_index,
      ai_training_candidates!inner(versions)
    `)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error || !data || data.length === 0) return ''

  const lines: string[] = []
  for (const row of data) {
    const versions = (row.ai_training_candidates as any)?.versions
    if (!Array.isArray(versions)) continue
    const version = versions[row.version_index]
    if (!version) continue
    const label = row.rating.toUpperCase()
    const commentPart = row.comment ? `, comment: "${row.comment}"` : ''
    lines.push(`[${label}] title: "${version.title}", subtitle: "${version.subtitle}"${commentPart}`)
  }

  if (lines.length === 0) return ''

  let result = `\n\n## TRAINER FEEDBACK — learn from these rated examples:\n${lines.join('\n')}`

  // Also load score decision feedback
  const { data: scoreData, error: scoreError } = await supabase
    .from('yoda_score_feedback')
    .select(`
      rating,
      comment,
      decision_index,
      yoda_score_decisions!inner(decisions)
    `)
    .order('created_at', { ascending: false })
    .limit(20)

  if (!scoreError && scoreData && scoreData.length > 0) {
    const scoreLines: string[] = []
    for (const row of scoreData) {
      const decisions = (row.yoda_score_decisions as any)?.decisions
      if (!Array.isArray(decisions)) continue
      const decision = decisions[row.decision_index]
      if (!decision) continue
      const label = `SCORE-${row.rating.toUpperCase()}`
      const commentPart = row.comment ? `, comment: "${row.comment}"` : ''
      let detail = `action: "${decision.action}", fp: "${decision.fp_name}"`
      if (decision.existing_fp_name) detail += ` → existing: "${decision.existing_fp_name}"`
      if (decision.tier) detail += `, tier: "${decision.tier}"`
      scoreLines.push(`[${label}] ${detail}${commentPart}`)
    }
    if (scoreLines.length > 0) {
      result += `\n\n## SCORE DECISIONS FEEDBACK — learn from these validated decisions:\n${scoreLines.join('\n')}`
    }
  }

  // Also load class-level admin edits (title, class_summary, practice_point_*,
  // ai_primary_focus, ai_secondary_focus, priority_score_*). These are not
  // tied to ai_training_candidates so they live in class_input_edits — pull
  // the 30 most recent so the model sees the patterns of "AI said X, admin
  // corrected to Y" for class-level fields too.
  const { data: classEdits } = await supabase
    .from('class_input_edits')
    .select('field_name, ai_value, human_value, edited_at')
    .order('edited_at', { ascending: false })
    .limit(30)

  if (classEdits && classEdits.length > 0) {
    const editLines: string[] = []
    for (const row of classEdits as Array<{
      field_name: string
      ai_value: string | null
      human_value: string | null
    }>) {
      const ai = (row.ai_value ?? '').trim().slice(0, 120)
      const human = (row.human_value ?? '').trim().slice(0, 120)
      if (!ai && !human) continue
      editLines.push(`[CLASS-LEVEL EDIT] field: ${row.field_name}, AI: "${ai}", admin corrected to: "${human}"`)
    }
    if (editLines.length > 0) {
      result += `\n\n## CLASS-LEVEL CORRECTIONS — admin's corrections on class fields:\n${editLines.join('\n')}`
    }
  }

  return result
}

// ─── Processing logic ─────────────────────────────────────────────────────────

async function processRecord(record: ClassInputRecord): Promise<void> {
  const { id, transcript, raw_ai_json, user_id, lesson_type, student_id } = record

  // Guard: skip if no transcript or already processed/processing
  if (!transcript?.trim()) {
    console.log(`[yoda-extract] Skipping ${id}: no transcript`)
    return
  }
  if (raw_ai_json !== null) {
    console.log(`[yoda-extract] Skipping ${id}: already processed`)
    return
  }
  if (record.status === 'processing' || record.status === 'extracted' || record.status === 'scored') {
    console.log(`[yoda-extract] Skipping ${id}: status is ${record.status}`)
    return
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Atomic claim: the webhook payload above is a snapshot. Concurrent
  // deliveries (Supabase has at-least-once semantics) would each pass the
  // status guard then both run the full extraction pipeline — duplicate
  // focus points, duplicate Anthropic billing. Win the claim race by
  // transitioning status from pending → processing in a single UPDATE
  // that filters on the current state. The losing call's claim returns
  // 0 rows and we bail.
  const { data: claimed, error: claimErr } = await supabase
    .from('class_inputs')
    .update({ status: 'processing' })
    .eq('id', id)
    .is('raw_ai_json', null)
    .neq('status', 'processing')
    .neq('status', 'extracted')
    .neq('status', 'scored')
    .select('id')
    .maybeSingle()
  if (claimErr || !claimed) {
    console.log(`[yoda-extract] Skipping ${id}: failed to claim (concurrent run or already done)`)
    return
  }

  // Load trainer feedback to enrich the system prompt
  let trainerFeedbackSection = ''
  try {
    trainerFeedbackSection = await loadTrainerFeedback(supabase)
  } catch (err) {
    console.warn('[yoda-extract] Could not load trainer feedback:', err)
  }
  const effectiveSystemPrompt = (trainerFeedbackSection
    ? SYSTEM_PROMPT + trainerFeedbackSection
    : SYSTEM_PROMPT) + NO_HYPHEN_RULE

  try {
    // Resolve coach name
    const { data: coachRow } = await supabase
      .from('users')
      .select('name')
      .eq('id', user_id)
      .single()
    const coachName = coachRow?.name ?? 'Unknown'

    // Resolve student names — private (student_id) or group (class_input_students)
    // Fallback: if no explicit student_id, treat user_id as the student
    let students: { id: string; name: string }[] = []
    if (student_id) {
      const { data: studentRow } = await supabase
        .from('users')
        .select('id, name')
        .eq('id', student_id)
        .single()
      if (studentRow) students = [{ id: studentRow.id, name: studentRow.name ?? studentRow.id }]
    } else {
      const { data: junctionRows } = await supabase
        .from('class_input_students')
        .select('student_id, users!class_input_students_student_id_fkey(id, name)')
        .eq('class_input_id', id)
      if (junctionRows && junctionRows.length > 0) {
        students = junctionRows
          .map((r: any) => r.users)
          .filter(Boolean)
          .map((u: any) => ({ id: u.id, name: u.name ?? u.id }))
      } else {
        // Student logged their own class — user_id IS the student
        const { data: selfRow } = await supabase
          .from('users')
          .select('id, name')
          .eq('id', user_id)
          .single()
        if (selfRow) students = [{ id: selfRow.id, name: selfRow.name ?? selfRow.id }]
      }
    }

    // Load existing focus points for each student (for merge detection)
    const existingFPsByStudent: Record<string, any[]> = {}
    for (const s of students) {
      const { data: fps } = await supabase
        .from('focus_points')
        .select('id, name, subtitle, tier, status')
        .eq('user_id', s.id)
        .neq('status', 'past')
        .eq('is_other', false)
      existingFPsByStudent[s.id] = fps ?? []
    }

    // Build user message
    const studentsWithFPs = students.map(s => ({
      ...s,
      existing_focus_points: existingFPsByStudent[s.id] ?? [],
    }))

    const userMessage = [
      `lesson_type: ${lesson_type ?? 'private'}`,
      `coach_name: ${coachName}`,
      `coach_speaker_id: A`,
      `students: ${JSON.stringify(studentsWithFPs)}`,
      `transcript: ${transcript}`,
    ].join('\n')

    // Call Claude via the Anthropic Messages API (with retry on 5xx/429).
    // max_tokens=16000: group classes with multiple students return
    // per-student summaries plus group-level fields, easily exceeding the
    // previous 4000-token limit on 1h+ classes. Sonnet 4.6 supports up to
    // 64k output tokens; 16k gives us headroom for big group sessions
    // while keeping latency reasonable.
    const anthropicRes = await fetchAnthropicWithRetry(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 16000,
        system: effectiveSystemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      },
      { context: 'extract', supabase, classInputId: id, userId: user_id },
    )

    const anthropicData = await anthropicRes.json()
    const rawText: string = anthropicData.content?.[0]?.text ?? ''
    const stopReason: string | undefined = anthropicData.stop_reason

    // Strip markdown code fences if Claude wrapped the JSON
    const jsonText = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      throw new Error(
        `JSON parse failed (stop_reason=${stopReason}). Raw output:\n${rawText.slice(0, 500)}`,
      )
    }
    // Belt-and-suspenders: the prompt forbids hyphens, but strip any that
    // slipped through from every string field before we write anything.
    parsed = trimAllDrills(sanitizeStrings(parsed)) as typeof parsed

    // Write raw JSON back
    await supabase
      .from('class_inputs')
      .update({
        raw_ai_json: parsed,
        status: 'extracted',
        processed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('id', id)

    // Update practice_point_1 / practice_point_2 / class_summary on class_inputs
    const aiData = parsed as any
    const firstStudent = aiData.students?.[0]
    const updates: any = {}
    if (firstStudent?.focus_points?.length > 0) {
      if (firstStudent.focus_points[0]) updates.practice_point_1 = firstStudent.focus_points[0].title
      if (firstStudent.focus_points[1]) updates.practice_point_2 = firstStudent.focus_points[1].title
    }
    if (firstStudent?.class_summary) {
      updates.class_summary = firstStudent.class_summary
    }
    if (Object.keys(updates).length > 0) {
      await supabase.from('class_inputs').update(updates).eq('id', id)
    }

    // Generate title — uses the just-extracted class_summary (concise +
    // already focused on the technical content) rather than the raw
    // transcript head. The first 1500 chars of a transcript are almost
    // always small-talk / setup, which Claude then summarises into
    // generic, useless titles like "Latin Dance Class Introduction".
    // Feeding the distilled summary instead gives Claude the actual
    // teaching content and yields specific titles ("Rumba Walk Phases",
    // "Center Lead in Cha Cha", etc.).
    const { data: existingRow } = await supabase
      .from('class_inputs')
      .select('title, class_summary')
      .eq('id', id)
      .single()
    if (!existingRow?.title && (existingRow?.class_summary || transcript)) {
      const sourceContent =
        existingRow?.class_summary ?? transcript!.slice(0, 3000)
      // Title generation is best-effort: failures don't fail the whole
      // extraction. Still wrap in retry so transient 5xx don't lose the
      // title silently.
      try {
        const titleRes = await fetchAnthropicWithRetry(
          {
            model: 'claude-haiku-4-5',
            max_tokens: 30,
            messages: [{
              role: 'user',
              content: `You are titling a dance class for a coach's dashboard.

CLASS SUMMARY:
${sourceContent}

Write a SPECIFIC 4 to 8 word title that captures the technical topic taught.

RULES:
- Mention the dance style(s) (e.g. Rumba, Cha Cha, Waltz, Tango, Salsa, Bachata) when they're the main focus.
- Name the specific technique or mechanic taught (e.g. "Walk Phases", "Center Lead", "Hip Action", "Frame Connection", "Spin Mechanics").
- AVOID generic words: "Introduction", "Basics", "Class", "Session", "Practice", "Overview", "Technique" (on its own), "Lesson", "Lecture".
- Capitalize each significant word.
- Return ONLY the title — no quotes, no preamble.${NO_HYPHEN_RULE}`,
            }],
          },
          { context: 'title', supabase, classInputId: id, userId: user_id },
        )
        const titleData = await titleRes.json()
        const generatedTitle = stripHyphens(
          (titleData.content?.[0]?.text ?? '').trim().replace(/^["']|["']$/g, '')
        )
        if (generatedTitle) {
          await supabase.from('class_inputs').update({ title: generatedTitle }).eq('id', id)
          console.log(`[yoda-extract] ✓ Generated title: "${generatedTitle}" for ${id}`)
        }
      } catch (err) {
        console.warn(`[yoda-extract] title generation failed for ${id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    console.log(`[yoda-extract] ✓ Extracted: ${id}`)

    // Notify group class students to confirm attendance
    if (lesson_type === 'public' || lesson_type === 'group') {
      try {
        const classDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        await notifyGroupClassAttendance(supabase, id, user_id, coachName, classDate)
      } catch (err) {
        console.error('[yoda-extract] attendance notification error:', err)
      }
    }

    // Insert coach knowledge entries (principles, tips, metaphors, drills)
    // Only insert entries that are genuinely new — not already covered by existing knowledge
    const knowledge: { type: string; content: string }[] = aiData.coach?.knowledge ?? []
    if (knowledge.length > 0) {
      const newCandidates = knowledge.filter(k => k.type && k.content?.trim())

      // Load existing knowledge for this coach
      const { data: existingKnowledge } = await supabase
        .from('coach_knowledge')
        .select('type, content')
        .eq('coach_id', user_id)

      const existing = existingKnowledge ?? []
      let toInsert = newCandidates

      if (existing.length > 0) {
        // Best-effort dedup. If Anthropic fails entirely after retries we
        // just insert all candidates rather than fail the whole class.
        try {
          const dedupeRes = await fetchAnthropicWithRetry(
            {
              model: 'claude-haiku-4-5',
              max_tokens: 800,
              messages: [{
                role: 'user',
                content: `You are deduplicating a dance coach's knowledge base.

EXISTING ENTRIES:
${existing.map((e, i) => `${i + 1}. [${e.type}] ${e.content}`).join('\n')}

NEW CANDIDATES:
${newCandidates.map((e, i) => `${i + 1}. [${e.type}] ${e.content}`).join('\n')}

Return ONLY the indices (1-based) of NEW CANDIDATES that add genuinely new information — reject if the core message or teaching idea is already expressed in the existing entries, even partially or with different wording.
When in doubt, reject. Only keep entries that a coach would clearly want as a separate item in their knowledge base.
If all are duplicates, return an empty array.
Return ONLY a JSON array of numbers, e.g. [1, 3]. No explanation.`,
              }],
            },
            { context: 'dedupe', supabase, classInputId: id, userId: user_id },
          )
          const dedupeData = await dedupeRes.json()
          const rawText = (dedupeData.content?.[0]?.text ?? '').trim()
          try {
            const indices: number[] = JSON.parse(rawText)
            toInsert = indices
              .filter(i => i >= 1 && i <= newCandidates.length)
              .map(i => newCandidates[i - 1])
            console.log(`[yoda-extract] Deduplication: ${newCandidates.length} candidates → ${toInsert.length} truly new`)
          } catch {
            console.warn('[yoda-extract] Failed to parse deduplication response, inserting all candidates')
          }
        } catch (err) {
          console.warn(`[yoda-extract] dedupe call failed (will insert all candidates): ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      if (toInsert.length > 0) {
        const knowledgeRows = toInsert.map(k => ({
          coach_id: user_id,
          source_class_input_id: id,
          type: k.type,
          content: k.content.trim(),
        }))
        const { error: knowledgeError } = await supabase
          .from('coach_knowledge')
          .insert(knowledgeRows)
        if (knowledgeError) {
          console.error(`[yoda-extract] coach_knowledge insert error for ${id}:`, knowledgeError.message)
        } else {
          console.log(`[yoda-extract] ✓ Inserted ${knowledgeRows.length} knowledge entries for coach ${user_id}`)
        }
      }
    }

    // Invoke yoda-score to insert focus points and seed scores
    const { error: scoreError } = await supabase.functions.invoke('yoda-score', {
      body: {
        event: 'class_input',
        class_input_id: id,
      },
    })
    if (scoreError) {
      console.error(`[yoda-extract] yoda-score error for ${id}:`, scoreError.message)
    }

    // Fire-and-forget: generate alternative focus point versions for trainer review
    // This runs after yoda-score and must not affect the student experience
    try {
      const aiData2 = parsed as any
      for (const studentResult of aiData2.students ?? []) {
        const fps = studentResult.focus_points ?? []
        if (fps.length === 0) continue
        await generateAlternatives(supabase, id, studentResult.student_id, fps)
      }
    } catch (altErr) {
      console.warn(`[yoda-extract] Alternatives generation failed for ${id} (non-fatal):`, altErr)
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(`[yoda-extract] ✗ Error for ${id}:`, errorMsg)

    await supabase
      .from('class_inputs')
      .update({ status: 'error', error_message: errorMsg })
      .eq('id', id)
  }
}
