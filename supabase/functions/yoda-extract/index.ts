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
- General corrections (no student named) → coach_knowledge only, no focus point created
- If you cannot confidently assign a correction to a specific student, do not create a focus point

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
- A practical exercise the student can do alone, written as a concrete sequence of actions
- Based strictly on what the coach said explicitly — do not reformulate the correction as a drill, do not invent
- null if the coach gave no explicit exercise

### Other fields
- timestamp: MM:SS when first addressed (from paragraph timestamps)
- mention_count: how many times this was addressed across the full lesson
- explicit_priority: true if coach used words like "most important", "above all", "focus on this", "before anything else"

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
        model: 'claude-haiku-4-5',
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
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

    // Update practice_point_1 / practice_point_2 on class_inputs (first student's top FPs)
    const aiData = parsed as any
    const firstStudent = aiData.students?.[0]
    if (firstStudent?.focus_points?.length > 0) {
      const updates: any = {}
      if (firstStudent.focus_points[0]) updates.practice_point_1 = firstStudent.focus_points[0].title
      if (firstStudent.focus_points[1]) updates.practice_point_2 = firstStudent.focus_points[1].title
      await supabase.from('class_inputs').update(updates).eq('id', id)
    }

    console.log(`[yoda-extract] ✓ Extracted: ${id}`)

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
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(`[yoda-extract] ✗ Error for ${id}:`, errorMsg)

    await supabase
      .from('class_inputs')
      .update({ status: 'error', error_message: errorMsg })
      .eq('id', id)
  }
}
