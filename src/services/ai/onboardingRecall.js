// The onboarding's one AI call, made before the student has an account.
//
// It returns focus points to the device and writes nothing: they live in the
// screen's state, are persisted only if that person goes on to sign up, and
// disappear with the app if they don't. See supabase/functions/onboarding-recall.
import { supabase } from '../supabase/client';

export async function recallToFocusPoints(recall, style) {
  const { data, error } = await supabase.functions.invoke('onboarding-recall', {
    body: { recall, style },
  });
  if (error) {
    // invoke() hides the response body on a non-2xx, so the function's own
    // message (rate limit, too-short recall) is dug out of the context.
    let detail = '';
    try { detail = (await error.context?.json?.())?.error || ''; } catch { /* body already read */ }
    throw new Error(detail || 'Could not read that lesson.');
  }
  if (!data?.points?.length) throw new Error('Could not read that lesson.');
  return data.points;
}

// Written only once an account exists. Mirrors the shape the rest of the app
// expects from focus_points: active, not archived, tier drives the train target.
export async function saveOnboardingFocusPoints(userId, points) {
  if (!userId || !points?.length) return;
  const rows = points.map((p) => ({
    user_id: userId,
    name: p.name,
    subtitle: p.subtitle || null,
    dance: p.dance ? [p.dance] : null,
    tier: p.tier === 'critical' ? 'critical' : 'important',
    status: 'active',
  }));
  const { error } = await supabase.from('focus_points').insert(rows);
  if (error) console.warn('[onboarding] focus points not saved:', error.message);
}
