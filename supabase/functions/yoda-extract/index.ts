import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

// Recursively walk a parsed JSON object and strip hyphens from every string.
function sanitizeStrings<T>(value: T): T {
  if (typeof value === 'string') return stripHyphens(value) as unknown as T
  if (Array.isArray(value)) return value.map(sanitizeStrings) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeStrings(v)
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

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Yoda Extract, a specialized AI that processes coaching lesson transcripts. Your sole job is to output a single structured JSON object — nothing else. No explanation, no preamble, no markdown.

## INPUTS YOU RECEIVE
- lesson_type: "private" | "public"
- coach_name: string
- coach_speaker_id: string (e.g. "A")
- students: array of { id, name } — for public lessons, only include students explicitly named in the transcript OR confirmed present
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

## LESSON TYPE RULES

### private
- All focus points assigned to the single student
- All corrections are relevant

### public
- Two categories of focus points: shared and individual
- SHARED: a theme the coach returns to multiple times, addressed to the group as a whole, with no specific student named. Minimum 2 mentions to qualify. Maximum 3 shared focus points per lesson.
- INDIVIDUAL: a correction explicitly directed at a named student. Extract for every student named in the transcript, even if they are not in the input students[]. Use extracted_name = the name as it appears in the transcript, and student_id = null. Only set student_id if the student is in the input students[].
- Coach signals during live practice (e.g. during a final run-through) → LOW CONFIDENCE. Do not link to a concept unless the same concept was explicitly taught earlier in the same lesson AND the coach uses the student's name in the same paragraph.
- General corrections with no student named → shared_focus_points or coach_knowledge only, never individual focus points

## SELECTING FOCUS POINTS
Extract all corrections first. Then select the most important ones as focus_points based on these criteria, in order of weight:

1. Time ratio — how much of the total lesson duration was spent addressing this point. This is the strongest signal.
2. Mention count — how many times the coach returned to this point
3. Explicit priority — coach used words like "most important", "above all", "focus on this", "before anything else"

Rules:
- Minimum 1, maximum 3 focus points per student
- Maximum 3 shared focus points for public lessons
- Only include what is genuinely important — do not force 3 if only 1 or 2 qualify
- All remaining corrections go into other_focus_points
- If an individual focus point is the same concept as a shared focus point → do not duplicate. Instead, only set coach_signal if applicable on the shared focus point for that student.

## TIER
Each focus point must have a tier:
- "critical" — the most important focus point in this lesson (max 1 per student AND max 1 among shared_focus_points)
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
- For public lessons: only set coach_signal if the student is named explicitly in the same paragraph as the signal
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

### Other fields
- timestamp: MM:SS when first addressed (from paragraph timestamps)
- mention_count: how many times this was addressed across the full lesson
- explicit_priority: true if coach used words like "most important", "above all", "focus on this", "before anything else"

## CLASS SUMMARY
For each student, write a "class_summary": one sentence (max 20 words) summarizing what was worked on overall during this lesson.
For public lessons, also write a "shared_class_summary": one sentence (max 20 words) summarizing the main themes addressed to the group.

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
      "tier": "critical" | "important" | "supporting"
    }
  ],
  "shared_class_summary": string | null,
  "students": [
    {
      "student_id": string | null,
      "extracted_name": string | null,
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
  "coach": {
    "coach_name": string,
    "lesson_type": "private" | "public",
    "total_students_in_class": number,
    "shared_class_summary": string | null,
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

// ─── Shared focus points (group class) ───────────────────────────────────────

const STARTING_SCORES: Record<string, number> = { critical: 10, important: 7, supporting: 5 }

async function insertPublicFocusPoints(
  supabase: ReturnType<typeof createClient>,
  classInputId: string,
  aiData: any,
): Promise<void> {
  const now = new Date().toISOString()

  // ── 1. Shared focus points (addressed to the whole group) ─────────────────
  const sharedFPs: any[] = aiData.shared_focus_points ?? []

  // Save shared_class_summary
  const sharedSummary = aiData.shared_class_summary ?? aiData.coach?.shared_class_summary ?? null
  if (sharedSummary) {
    await supabase.from('class_inputs').update({ shared_class_summary: sharedSummary }).eq('id', classInputId)
  }

  if (sharedFPs.length > 0) {
    const sharedRows = sharedFPs.map((fp: any) => ({
      user_id: null,
      is_shared: true,
      group_fp: true,
      source_class_input_id: classInputId,
      class_input_id: classInputId,
      name: fp.title,
      normalized_name: (fp.title ?? '').toLowerCase().trim(),
      subtitle: fp.subtitle ?? null,
      context: fp.context ?? null,
      dance: fp.dance ?? [],
      drill: fp.drill ?? null,
      tier: fp.tier ?? 'supporting',
      base_score: STARTING_SCORES[fp.tier ?? 'supporting'] ?? 5,
      mention_count: fp.mention_count ?? 0,
      explicit_priority: fp.explicit_priority ?? false,
      first_timestamp: fp.timestamp ?? null,
      last_mentioned_at: now,
      status: 'active',
      count: 0,
      is_archived: false,
      is_deleted: false,
      is_other: false,
    }))
    const { error } = await supabase.from('focus_points').insert(sharedRows)
    if (error) console.error('[yoda-extract] Failed to insert shared FPs:', error.message)
    else console.log(`[yoda-extract] ✓ Inserted ${sharedRows.length} shared FPs for class ${classInputId}`)
  }

  // ── 2. Individual student focus points (named in transcript) ─────────────
  const individualRows: any[] = []
  for (const student of aiData.students ?? []) {
    const extractedName: string = (student.student_name ?? '').trim()

    // Main focus_points for this student
    for (const fp of student.focus_points ?? []) {
      individualRows.push({
        user_id: null,
        is_shared: false,
        group_fp: true,
        extracted_name: extractedName || null,
        source_class_input_id: classInputId,
        class_input_id: classInputId,
        name: fp.title,
        normalized_name: (fp.title ?? '').toLowerCase().trim(),
        subtitle: fp.subtitle ?? null,
        context: fp.context ?? null,
        dance: fp.dance ?? [],
        drill: fp.drill ?? null,
        tier: fp.tier ?? 'supporting',
        base_score: STARTING_SCORES[fp.tier ?? 'supporting'] ?? 5,
        mention_count: fp.mention_count ?? 0,
        explicit_priority: fp.explicit_priority ?? false,
        first_timestamp: fp.timestamp ?? null,
        last_mentioned_at: now,
        status: 'active',
        count: 0,
        is_archived: false,
        is_deleted: false,
        is_other: false,
      })
    }

    // other_focus_points for this student — also insert so attendance-response can assign them
    for (const fp of student.other_focus_points ?? []) {
      individualRows.push({
        user_id: null,
        is_shared: false,
        group_fp: true,
        extracted_name: extractedName || null,
        source_class_input_id: classInputId,
        class_input_id: classInputId,
        name: fp.title,
        normalized_name: (fp.title ?? '').toLowerCase().trim(),
        subtitle: fp.subtitle ?? null,
        context: fp.context ?? null,
        dance: fp.dance ?? [],
        drill: fp.drill ?? null,
        tier: fp.tier ?? 'supporting',
        base_score: STARTING_SCORES[fp.tier ?? 'supporting'] ?? 5,
        mention_count: fp.mention_count ?? 0,
        explicit_priority: fp.explicit_priority ?? false,
        first_timestamp: fp.timestamp ?? null,
        last_mentioned_at: now,
        status: 'active',
        count: 0,
        is_archived: false,
        is_deleted: false,
        is_other: true,
      })
    }
  }

  if (individualRows.length > 0) {
    const { error } = await supabase.from('focus_points').insert(individualRows)
    if (error) console.error('[yoda-extract] Failed to insert individual FPs:', error.message)
    else console.log(`[yoda-extract] ✓ Inserted ${individualRows.length} individual FPs (unassigned) for class ${classInputId}`)
  }
}

// ─── Group class attendance notification ──────────────────────────────────────

async function notifyGroupClassAttendance(
  supabase: ReturnType<typeof createClient>,
  classInputId: string,
  coachId: string,
  coachName: string,
  classDate: string,
): Promise<void> {
  // Get all students connected to this coach
  const { data: requests } = await supabase
    .from('coach_requests')
    .select('student_id')
    .eq('coach_id', coachId)
    .eq('status', 'accepted')

  const studentIds: string[] = (requests ?? []).map((r: any) => r.student_id)
  if (studentIds.length === 0) return

  // Send attendance_check notification to each student
  const notifications = studentIds.map((sid: string) => ({
    user_id: sid,
    type: 'attendance_check',
    title: `Were you at ${coachName}'s group class?`,
    body: `Class on ${classDate} — confirm your attendance to receive your focus points.`,
    data: { class_input_id: classInputId, coach_name: coachName, lesson_date: classDate },
  }))
  const { error } = await supabase.from('notifications').insert(notifications)
  if (error) console.error('[yoda-extract] Failed to insert attendance notifications:', error.message)
  else console.log(`[yoda-extract] ✓ Sent attendance_check notifications to ${studentIds.length} students for class ${classInputId}`)
}

// ─── Generate alternative versions for each focus point ──────────────────────

async function generateAlternatives(
  supabase: ReturnType<typeof createClient>,
  classInputId: string,
  studentId: string | null,
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

  const altRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 3000,
      messages: [{ role: 'user', content: altPrompt }],
    }),
  })

  if (!altRes.ok) {
    throw new Error(`Alternatives API ${altRes.status}: ${await altRes.text()}`)
  }

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

  // Mark as processing
  await supabase
    .from('class_inputs')
    .update({ status: 'processing' })
    .eq('id', id)

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

    // Call Claude via the Anthropic Messages API
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4000,
        system: effectiveSystemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text()
      throw new Error(`Anthropic API ${anthropicRes.status}: ${errText}`)
    }

    const anthropicData = await anthropicRes.json()
    const rawText: string = anthropicData.content?.[0]?.text ?? ''

    // Strip markdown code fences if Claude wrapped the JSON
    const jsonText = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      throw new Error(`JSON parse failed. Raw output:\n${rawText.slice(0, 500)}`)
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
    const isGroupLessonType = lesson_type === 'public' || lesson_type === 'group'
    const updates: any = {}

    if (isGroupLessonType) {
      // For group classes, use shared focus points and shared summary
      const sharedFPs = aiData.shared_focus_points ?? []
      if (sharedFPs[0]) updates.practice_point_1 = sharedFPs[0].title
      if (sharedFPs[1]) updates.practice_point_2 = sharedFPs[1].title
      const sharedSummary = aiData.shared_class_summary ?? aiData.coach?.shared_class_summary ?? null
      if (sharedSummary) updates.class_summary = sharedSummary
    } else {
      const firstStudent = aiData.students?.[0]
      if (firstStudent?.focus_points?.length > 0) {
        if (firstStudent.focus_points[0]) updates.practice_point_1 = firstStudent.focus_points[0].title
        if (firstStudent.focus_points[1]) updates.practice_point_2 = firstStudent.focus_points[1].title
      }
      if (firstStudent?.class_summary) updates.class_summary = firstStudent.class_summary
    }

    if (Object.keys(updates).length > 0) {
      await supabase.from('class_inputs').update(updates).eq('id', id)
    }

    // Generate title from transcript if not already set
    const { data: existingRow } = await supabase
      .from('class_inputs')
      .select('title')
      .eq('id', id)
      .single()
    if (!existingRow?.title && transcript) {
      const titleRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 20,
          messages: [{
            role: 'user',
            content: `Here is a dance lesson transcript:\n\n${transcript.slice(0, 1500)}\n\nWrite a 2 to 5 word title summarizing what this lesson was about. Capitalize each word. Return ONLY the title, nothing else.${NO_HYPHEN_RULE}`,
          }],
        }),
      })
      if (titleRes.ok) {
        const titleData = await titleRes.json()
        const generatedTitle = stripHyphens(
          (titleData.content?.[0]?.text ?? '').trim().replace(/^["']|["']$/g, '')
        )
        if (generatedTitle) {
          await supabase.from('class_inputs').update({ title: generatedTitle }).eq('id', id)
          console.log(`[yoda-extract] ✓ Generated title: "${generatedTitle}" for ${id}`)
        }
      }
    }

    console.log(`[yoda-extract] ✓ Extracted: ${id}`)

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
        // Ask Claude Haiku to filter out entries already covered by existing knowledge
        const dedupeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5',
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
          }),
        })

        if (dedupeRes.ok) {
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

    const isGroupClass = lesson_type === 'public' || lesson_type === 'group'

    if (isGroupClass) {
      // Group class: create shared + individual FPs (user_id=null) then notify students
      await insertPublicFocusPoints(supabase, id, aiData)
      const classDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      await notifyGroupClassAttendance(supabase, id, user_id, coachName, classDate)
    } else {
      // Private class: invoke yoda-score to insert + score per-student FPs
      const { error: scoreError } = await supabase.functions.invoke('yoda-score', {
        body: { event: 'class_input', class_input_id: id },
      })
      if (scoreError) {
        console.error(`[yoda-extract] yoda-score error for ${id}:`, scoreError.message)
      }
    }

    // Fire-and-forget: generate alternative focus point versions for trainer review
    try {
      const aiData2 = parsed as any
      if (isGroupClass) {
        // Shared FPs → single batch with student_id = null
        const sharedFPs = aiData2.shared_focus_points ?? []
        if (sharedFPs.length > 0) {
          await generateAlternatives(supabase, id, null, sharedFPs)
        }
        // Per-student FPs (named students in transcript) → also null student_id since not yet assigned
        for (const studentResult of aiData2.students ?? []) {
          const fps = [
            ...(studentResult.focus_points ?? []),
            ...(studentResult.other_focus_points ?? []),
          ]
          if (fps.length === 0) continue
          await generateAlternatives(supabase, id, null, fps)
        }
      } else {
        for (const studentResult of aiData2.students ?? []) {
          const fps = studentResult.focus_points ?? []
          if (fps.length === 0) continue
          await generateAlternatives(supabase, id, studentResult.student_id, fps)
        }
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
