import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const SIGNAL_PROMPT = `You are analyzing a dance/martial arts lesson coaching report to extract feedback signals for specific focus points.

You will receive:
- A list of the student's active focus points (id + name)
- A coaching analysis/lesson output text

For each focus point, determine if the coaching text contains a feedback signal.

Signal definitions:
- COACH_IMPROVED_STRONG: "much better", "fixed", "that's good now", "great improvement", "nailed it"
- COACH_IMPROVED_MODERATE: "better", "improving", "getting there", "progress"
- COACH_FIXED: "resolved", "no longer an issue", "mastered", "done with this"
- COACH_ESCALATION: "main issue", "this is the problem", "must fix", "critical", "still struggling", "biggest problem", "priorité"
- FOCUS_REMENTIONED: focus point was worked on / mentioned but no clear improvement or escalation signal
- null: focus point not mentioned in this lesson at all

Return ONLY valid JSON, no explanation, no markdown:
{
  "signals": [
    {
      "focus_point_id": "<uuid>",
      "focus_name": "<name>",
      "event": "<signal or null>",
      "evidence": "<short quote from the analysis, max 100 chars, or null>"
    }
  ]
}`;

serve(async (req) => {
  const { class_id } = await req.json();
  if (!class_id) return new Response('missing class_id', { status: 400 });

  // 1. Fetch the class_input row
  const { data: cls, error: clsErr } = await supabase
    .from('class_inputs')
    .select('id, user_id, coach_ai_output, coach_signals_applied')
    .eq('id', class_id)
    .single();

  if (clsErr || !cls) return new Response('class not found', { status: 404 });
  if (!cls.coach_ai_output) return new Response('no coach_ai_output', { status: 200 });
  if (cls.coach_signals_applied) return new Response('already processed', { status: 200 });

  // 2. Fetch student's active focus points
  const { data: fps } = await supabase
    .from('focus_points')
    .select('id, name, tier')
    .eq('user_id', cls.user_id)
    .eq('is_deleted', false)
    .eq('is_archived', false)
    .is('alias_of', null);

  if (!fps || fps.length === 0) return new Response('no focus points', { status: 200 });

  // 3. Call Claude to extract signals
  const userMessage = `Student focus points:\n${fps.map(fp => `- id: ${fp.id} | name: "${fp.name}" | tier: ${fp.tier || 'important'}`).join('\n')}\n\nCoaching analysis:\n${cls.coach_ai_output}`;

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1024,
      system: SIGNAL_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  const claudeJson = await claudeRes.json();
  let extracted: { signals: Array<{ focus_point_id: string; focus_name: string; event: string | null; evidence: string | null }> };

  try {
    extracted = JSON.parse(claudeJson.content[0].text);
  } catch {
    return new Response('claude parse error', { status: 500 });
  }

  // 4. Build metrics map
  const { data: metricsRows } = await supabase
    .from('focus_metrics')
    .select('*')
    .in('focus_id', fps.map((fp: any) => fp.id));

  const metricsMap: Record<string, any> = {};
  for (const m of metricsRows || []) metricsMap[m.focus_id] = m;

  // 5. Apply each signal to focus_metrics
  const BASE_IMPORTANCE: Record<string, number> = { critical: 4, important: 3, supporting: 2 };
  const BASE_STRUGGLE: Record<string, number>   = { critical: 1, important: 1, supporting: 0 };

  for (const sig of extracted.signals || []) {
    if (!sig.event || !sig.focus_point_id) continue;

    const fp   = fps.find((f: any) => f.id === sig.focus_point_id);
    const tier = fp?.tier || 'important';
    const m    = metricsMap[sig.focus_point_id] || {};

    // Ensure metrics row exists
    const { data: existingM } = await supabase
      .from('focus_metrics')
      .select('focus_id')
      .eq('focus_id', sig.focus_point_id)
      .maybeSingle();

    if (!existingM) {
      await supabase.from('focus_metrics').insert({
        focus_id:     sig.focus_point_id,
        importance:   BASE_IMPORTANCE[tier] ?? 3,
        struggle:     BASE_STRUGGLE[tier]   ?? 1,
        practice:     0,
        coach_signal: 0,
      });
    }

    let update: Record<string, any> = {};
    const cs = m.coach_signal ?? 0;
    const im = m.importance   ?? (BASE_IMPORTANCE[tier] ?? 3);

    switch (sig.event) {
      case 'COACH_IMPROVED_STRONG':    update = { coach_signal: cs - 4 }; break;
      case 'COACH_IMPROVED_MODERATE':  update = { coach_signal: cs - 2 }; break;
      case 'COACH_FIXED':              update = { coach_signal: cs - 5 }; break;
      case 'COACH_ESCALATION':         update = { coach_signal: cs + 2, importance: im + 2 }; break;
      case 'FOCUS_REMENTIONED':        update = { importance: im + 2 }; break;
      default: continue;
    }

    await supabase.from('focus_metrics').update(update).eq('focus_id', sig.focus_point_id);

    // Update last_mentioned_at on focus_point for recency score
    await supabase
      .from('focus_points')
      .update({ last_mentioned_at: new Date().toISOString() })
      .eq('id', sig.focus_point_id);

    // Lifecycle: COACH_FIXED or very negative coach_signal → cooling_down
    if (sig.event === 'COACH_FIXED' || (sig.event === 'COACH_IMPROVED_STRONG' && (cs - 4) <= -5)) {
      await supabase
        .from('focus_points')
        .update({ status: 'cooling_down' })
        .eq('id', sig.focus_point_id);
    }
  }

  // 6. Persist extracted signals + mark as applied
  await supabase
    .from('class_inputs')
    .update({
      coach_signals_json:    extracted,
      coach_signals_applied: true,
    })
    .eq('id', class_id);

  return new Response(JSON.stringify({ ok: true, signals: extracted.signals }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
