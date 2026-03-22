import { supabase } from '../lib/supabase';

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ─── Score calculation ────────────────────────────────────────────────────────
// score = sum of all priority_score values in focus_progress for this focus point

async function calculateScores(userId) {
  const { data } = await supabase
    .from('focus_progress')
    .select('focus_point_id, priority_score')
    .eq('user_id', userId);

  const scoreMap = {};
  for (const row of data || []) {
    if ((row.priority_score || 0) > 0) {
      const id = row.focus_point_id;
      scoreMap[id] = (scoreMap[id] || 0) + row.priority_score;
    }
  }
  return scoreMap;
}

// ─── Slot selection ───────────────────────────────────────────────────────────

export async function getSlots() {
  try {
    const userId = await getUserId();

    const { data: points } = await supabase
      .from('focus_points')
      .select('*')
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .eq('is_archived', false);

    if (!points || points.length === 0) return { slot1: null, slot2: null };

    const scoreMap = await calculateScores(userId);
    const sorted = [...points].sort(
      (a, b) => (scoreMap[b.id] || 0) - (scoreMap[a.id] || 0)
    );

    const slot1 = sorted[0];

    if (sorted.length === 1) return { slot1, slot2: null };

    // Only 2 focus points → no exclusion possible
    if (sorted.length === 2) return { slot1, slot2: sorted[1] };

    // Get last 2 training sessions → extract slot2_focus_id to exclude
    const { data: sessions } = await supabase
      .from('training_sessions')
      .select('slot2_focus_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(2);

    const excludeIds = new Set(
      (sessions || []).map((s) => s.slot2_focus_id).filter(Boolean)
    );
    excludeIds.add(slot1.id);

    const candidates = sorted.filter((p) => !excludeIds.has(p.id));
    const slot2 = candidates.length > 0 ? candidates[0] : sorted[1];

    return { slot1, slot2 };
  } catch (e) {
    console.error('getSlots error:', e);
    return { slot1: null, slot2: null };
  }
}

// ─── Session count for a focus point ─────────────────────────────────────────

export async function getSessionCountForFocus(focusPointId) {
  try {
    const userId = await getUserId();
    const { data } = await supabase
      .from('training_sessions')
      .select('id')
      .eq('user_id', userId)
      .or(`slot1_focus_id.eq.${focusPointId},slot2_focus_id.eq.${focusPointId}`)
    return (data || []).length;
  } catch (e) {
    return 0;
  }
}

export function getSessionLabel(count) {
  return `${ordinal(count + 1)} Session`;
}

// ─── Start training session ───────────────────────────────────────────────────

export async function startTrainingSession(slot1FocusId, slot2FocusId) {
  try {
    const userId = await getUserId();

    const { data, error } = await supabase
      .from('training_sessions')
      .insert({
        user_id: userId,
        slot1_focus_id: slot1FocusId || null,
        slot2_focus_id: slot2FocusId || null,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    // Increment total_focus_worked + update last_active_date
    const { data: user } = await supabase
      .from('users')
      .select('total_focus_worked')
      .eq('id', userId)
      .single();

    await supabase
      .from('users')
      .update({
        total_focus_worked: (user?.total_focus_worked || 0) + 1,
        last_active_date: new Date().toISOString().split('T')[0],
      })
      .eq('id', userId);

    return data?.id || null;
  } catch (e) {
    console.error('startTrainingSession error:', e);
    return null;
  }
}

// ─── Complete training session ────────────────────────────────────────────────

export async function completeTrainingSession(sessionId, feeling = null, sessionNote = null) {
  try {
    if (!sessionId) return;
    const update = { completed_at: new Date().toISOString() };
    if (feeling) update.feeling = feeling;
    if (sessionNote) update.session_note = sessionNote;
    await supabase
      .from('training_sessions')
      .update(update)
      .eq('id', sessionId);
  } catch (e) {
    console.error('completeTrainingSession error:', e);
  }
}

// ─── Nudge message ────────────────────────────────────────────────────────────

export async function refreshNudgeMessage() {
  try {
    const userId = await getUserId();

    const { data: user } = await supabase
      .from('users')
      .select('last_active_date')
      .eq('id', userId)
      .single();

    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: recentInputs } = await supabase
      .from('class_inputs')
      .select('id')
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .gte('created_at', weekAgo);

    const weekCount = (recentInputs || []).length;
    let nudge = null;

    if (weekCount >= 3) {
      nudge = `Strong week — ${weekCount} sessions logged.`;
    } else if (!user?.last_active_date) {
      nudge = "You haven't logged a session yet. Log your first class to get started.";
    } else {
      const daysSince = Math.floor(
        (Date.now() - new Date(user.last_active_date).getTime()) / 86400000
      );
      if (daysSince > 5) {
        nudge = `You haven't logged a session in ${daysSince} days. Log your next class to update your focus.`;
      }
    }

    await supabase
      .from('users')
      .update({ nudge_message: nudge })
      .eq('id', userId);

    return nudge;
  } catch (e) {
    console.error('refreshNudgeMessage error:', e);
    return null;
  }
}

// ─── Monday recalculation ─────────────────────────────────────────────────────

export async function checkMondayRecalculation() {
  try {
    if (new Date().getDay() !== 1) return; // 1 = Monday
    await refreshNudgeMessage();
  } catch (e) {
    console.error('checkMondayRecalculation error:', e);
  }
}
