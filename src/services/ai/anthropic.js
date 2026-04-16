import { supabase } from '../supabase/client';

// All Claude calls are proxied through the Supabase edge function `ai-chat`
// so the ANTHROPIC_API_KEY stays server-side and never ships in the app bundle.

async function invokeAiChat({ systemPrompt, prompt, messages, maxTokens }) {
  const { data, error } = await supabase.functions.invoke('ai-chat', {
    body: { systemPrompt, prompt, messages, maxTokens },
  });
  if (error) throw new Error(`ai-chat invoke error: ${error.message || error}`);
  if (data?.error) throw new Error(data.error);
  return (data?.text ?? '').trim();
}

export async function callClaudeChat(systemPrompt, messages, maxTokens = 500) {
  return await invokeAiChat({ systemPrompt, messages, maxTokens });
}

async function callClaude(prompt, maxTokens = 200) {
  console.log('[Anthropic] callClaude →', { maxTokens, promptPreview: prompt.slice(0, 80) });
  const text = await invokeAiChat({ prompt, maxTokens });
  console.log('[Anthropic] response →', text);
  return text;
}

export function normalizeLabel(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// ─── Call 1: Extract primary focus point ─────────────────────────────────────

export async function extractPrimaryFocus({ practicePoint1, priorityScore1, existingNames }) {
  const existingStr = existingNames.length
    ? `Existing focus point names: ${existingNames.join(', ')}`
    : 'No existing focus points yet.';

  const prompt = `You are a dance coach assistant. A student logged what they need to work on:

"${practicePoint1}" (urgency ${priorityScore1}/5)

${existingStr}

Extract a concise focus point label (e.g. "Leg Strength", "Hip Rotation", "Body Alignment").
- If the input is nonsense or irrelevant, return null.
- If an existing name matches closely, use it exactly.
- Otherwise create a short 2-3 word label.

Respond with ONLY valid JSON: {"focus_name": string|null}`;

  try {
    const text = await callClaude(prompt, 100);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return parsed.focus_name || null;
  } catch {
    return null;
  }
}

// ─── Call 2: Extract secondary focus point ────────────────────────────────────

export async function extractSecondaryFocus({ practicePoint2, priorityScore2, existingNames }) {
  if (!practicePoint2?.trim()) return null;

  const existingStr = existingNames.length
    ? `Existing focus point names: ${existingNames.join(', ')}`
    : 'No existing focus points yet.';

  const prompt = `You are a dance coach assistant. A student logged a second observation:

"${practicePoint2}" (urgency ${priorityScore2}/5)

${existingStr}

Extract a concise focus point label (e.g. "Jump Power", "Arm Lines", "Musicality").
- If the input is nonsense or irrelevant, return null.
- If an existing name matches closely, use it exactly.
- Otherwise create a short 2-3 word label.

Respond with ONLY valid JSON: {"focus_name": string|null}`;

  try {
    const text = await callClaude(prompt, 100);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return parsed.focus_name || null;
  } catch {
    return null;
  }
}

// ─── Group class theme suggestion ────────────────────────────────────────────
//
// Given the top focus points currently shared across a coach's students,
// ask Claude to propose a unifying theme for the next group class.
//   candidates: [{ name, count }]  (count = distinct students working on it)
// Returns { theme, subtitle } or null on failure.
export async function suggestGroupClassTheme(candidates) {
  if (!candidates || candidates.length === 0) return null;

  const list = candidates
    .map((c) => `- "${c.name}" (${c.count} student${c.count > 1 ? 's' : ''})`)
    .join('\n');

  const prompt = `You are a dance coach planning a group class. These are the most common focus points your students are actively working on right now:

${list}

Suggest ONE unifying class theme that addresses the dominant underlying skill — it can group several related focus points under a broader theme, or single out the most frequent one if nothing else clusters well.

Respond with ONLY valid JSON:
{"theme": "2-4 word class title (e.g. 'Balance & Stability')", "subtitle": "8-12 words of context on what to focus on"}`;

  try {
    const text = await callClaude(prompt, 150);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!parsed.theme) return null;
    return { theme: parsed.theme, subtitle: parsed.subtitle || '' };
  } catch {
    return null;
  }
}

// ─── Call 3: Generate coaching summary ───────────────────────────────────────

export async function generateCoachingSummary(recentInputs) {
  if (!recentInputs.length) {
    return "You're just getting started — log your first class to receive personalized coaching insights.";
  }

  const lines = recentInputs.map((inp, i) => {
    const parts = [`Session ${i + 1}: "${inp.practice_point_1}" (urgency ${inp.priority_score_1}/5)`];
    if (inp.practice_point_2) parts.push(`Also: "${inp.practice_point_2}" (urgency ${inp.priority_score_2}/5)`);
    if (inp.class_summary) parts.push(`Worked on: "${inp.class_summary}"`);
    return parts.join('. ');
  });

  const prompt = `You are an encouraging but direct dance coach. Based on these recent class notes from a student, write a 2-3 sentence coaching summary about where they are now and what to focus on. Be specific, warm, and actionable.

${lines.join('\n')}

Write ONLY the 2-3 sentences. No preamble.`;

  try {
    return await callClaude(prompt, 300);
  } catch {
    return 'Keep showing up — consistency is how progress compounds. Focus on your top priority and trust the process.';
  }
}

// ─── Focus session summary ────────────────────────────────────────────────────

export async function generateFocusSummary(focusName, classNotes) {
  if (!classNotes.length) return null;

  const lines = classNotes.map((inp, i) => {
    const parts = [];
    if (inp.practice_point_1) parts.push(inp.practice_point_1);
    if (inp.practice_point_2) parts.push(inp.practice_point_2);
    if (inp.class_summary) parts.push(inp.class_summary);
    return `Note ${i + 1}: ${parts.join('. ')}`;
  }).join('\n');

  const prompt = `Summarize in 1-2 sentences what this dancer has been struggling with regarding "${focusName}", based on these class notes: ${lines}. Be specific and direct. No preamble.`;

  try {
    return await callClaude(prompt, 120);
  } catch {
    return null;
  }
}

// ─── Coach share summary ──────────────────────────────────────────────────────

export async function generateCoachShareSummary({ recentInputs, topFocusPoints, totalFocusWorked, lastActiveDate }) {
  const inputLines = recentInputs.map((inp, i) => {
    const date = inp.created_at ? new Date(inp.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    const parts = [`Session ${i + 1} (${date}): "${inp.practice_point_1}" (urgency ${inp.priority_score_1}/10)`];
    if (inp.ai_primary_focus) parts.push(`Focus: ${inp.ai_primary_focus}`);
    return parts.join(' — ');
  }).join('\n');

  const focusLines = topFocusPoints.map((fp, i) =>
    `${i + 1}. ${fp.name} (${fp.count} session${fp.count !== 1 ? 's' : ''})`
  ).join('\n');

  const lastActive = lastActiveDate
    ? new Date(lastActiveDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
    : 'unknown';

  const prompt = `You are helping a competitive dancer write a factual update for their coach before a lesson.
Based on this data, write a short factual summary of what the dancer has been doing since their last class:

Recent class notes:
${inputLines || 'No recent class notes.'}

Current focus points worked (by priority):
${focusLines || 'No focus points yet.'}

Training stats:
- Total focus sessions completed: ${totalFocusWorked || 0}
- Last active: ${lastActive}

Rules:
- 3-4 sentences maximum
- First person voice (I have been working on...)
- Purely factual — only state what happened, no recommendations, no plan
- Mention what corrections came up in class and what was practiced between sessions
- No fluff, no motivational language
- Example tone: 'Since our last class, I worked on Balance & Stability 3 times and Hip Mobility twice. My main class correction was frame alignment with urgency 8/10. I also noted timing issues in two sessions.'`;

  return await callClaude(prompt, 300);
}

// ─── Class title ──────────────────────────────────────────────────────────────

export async function generateClassTitle(class_summary, practicePoint1) {
  const source = class_summary?.trim() || practicePoint1;
  const prompt = `A dance student described their class: "${source}"\n\nGenerate a 2-4 word keyword title summarising what they worked on (e.g. "Stability & Creativity", "Jump Power Class", "Hip Flow Drills"). Capitalize each word. Return ONLY the title, nothing else.`;

  try {
    const title = await callClaude(prompt, 20);
    return title.replace(/^["']|["']$/g, '');
  } catch {
    return source.split(' ').slice(0, 4).join(' ');
  }
}
