const API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
const MODEL = 'claude-haiku-4-5-20251001';
const API_URL = 'https://api.anthropic.com/v1/messages';

function normalizeLabel(str) {
  // lowercase, remove spaces, remove accents/diacritics
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export { normalizeLabel };

export async function extractFocusPoints({ input1, urgency1, input2, urgency2, existingLabels }) {
  const existingStr = existingLabels.length
    ? `Existing focus point labels: ${existingLabels.join(', ')}`
    : 'No existing focus points yet.';

  const secondPoint = input2
    ? `Second point (urgency ${urgency2}/5): "${input2}"`
    : 'No second point.';

  const prompt = `You are a dance coach assistant. A student logged a class with the following notes:

First point (urgency ${urgency1}/5): "${input1}"
${secondPoint}

${existingStr}

Extract 1-2 concise focus point labels (e.g. "Leg Strength", "Hip Rotation", "Body Alignment").
- If the input is nonsense, irrelevant, or "rien", return null for that field.
- If an existing label matches, use it exactly.
- Otherwise create a short 2-3 word label.

Respond with ONLY valid JSON, no explanation:
{"primary_focus": string|null, "secondary_focus": string|null}`;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error: ${err}`);
  }

  const data = await res.json();
  const text = data.content[0].text.trim();

  // Extract JSON from response
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in response');
  return JSON.parse(match[0]);
}

export async function generateCoachingSummary(recentInputs) {
  if (!recentInputs.length) return "You're just getting started — log your first class to receive personalized coaching insights.";

  const lines = recentInputs.map((inp, i) => {
    const parts = [`Session ${i + 1}: "${inp.input1}" (urgency ${inp.urgency1}/5)`];
    if (inp.input2) parts.push(`Also: "${inp.input2}" (urgency ${inp.urgency2}/5)`);
    return parts.join('. ');
  });

  const prompt = `You are an encouraging but direct dance coach. Based on these recent class notes from a student, write a 2-3 sentence coaching summary about where they are now and what to focus on. Be specific, warm, and actionable.

${lines.join('\n')}

Write ONLY the 2-3 sentences. No preamble.`;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    return "Keep showing up — consistency is how progress compounds. Focus on your top priority and trust the process.";
  }

  const data = await res.json();
  return data.content[0].text.trim();
}
