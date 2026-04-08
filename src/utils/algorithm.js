import { supabase } from '../services/supabase/client';

async function getUserId() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error('Not authenticated');
  return session.user.id;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ─── Priority Score Engine ────────────────────────────────────────────────────
// Formula: priority = base_score - (practice_count × practiceWeight[tier])
//                   + recency + tierModifier[tier] + coach_signal + inactionPenalty
// All data lives on focus_points — no focus_metrics join needed.
// Clamped to [0..20]

const TIER_MODIFIER   = { critical: 3, important: 2, supporting: 1 };
const PRACTICE_WEIGHT = { critical: 0.8, important: 1.0, supporting: 1.2 };
const GRACE_DAYS      = { critical: 4, important: 7, supporting: 999 };
const INACTION_DELTA  = { critical: 1.0, important: 0.5, supporting: 0.0 };
const BASE_SCORE      = { critical: 10, important: 7, supporting: 5 };

function computeRecency(daysSince) {
  if (daysSince === 0) return 3;
  if (daysSince <= 3)  return 2;
  if (daysSince <= 6)  return 1;
  return 0;
}

function computeInactionPenalty(tier, daysSincePractice) {
  const grace = GRACE_DAYS[tier] ?? 999;
  const delta = INACTION_DELTA[tier] ?? 0;
  const weeks = Math.floor(Math.max(0, daysSincePractice - grace) / 7);
  return Math.min(3, delta * weeks);
}

// focus_points now holds all needed fields: base_score, practice_count,
// coach_signal, last_exposed_at, last_mentioned_at, tier
function computePriority(focus, now) {
  const tier = focus.tier || 'important';

  const refDate = focus.last_mentioned_at
    ? new Date(focus.last_mentioned_at)
    : new Date(focus.created_at);
  const daysSinceMentioned = Math.floor((now - refDate) / 86400000);

  const lastPracticed = focus.last_exposed_at
    ? new Date(focus.last_exposed_at)
    : null;
  const daysSincePractice = lastPracticed
    ? Math.floor((now - lastPracticed) / 86400000)
    : 999;

  const recency  = computeRecency(daysSinceMentioned);
  const tierMod  = TIER_MODIFIER[tier] ?? 2;
  const w        = PRACTICE_WEIGHT[tier] ?? 1.0;
  const inaction = computeInactionPenalty(tier, daysSincePractice);

  const raw =
    (focus.base_score      ?? BASE_SCORE[tier] ?? 7)
    - ((focus.practice_count ?? 0) * w)
    + recency
    + tierMod
    + (focus.coach_signal  ?? 0)
    + inaction;

  return Math.max(0, Math.min(20, raw));
}

// ─── Top-3 slot selection ─────────────────────────────────────────────────────

export async function getSlots() {
  try {
    const userId = await getUserId();
    const now    = new Date();

    const { data: points } = await supabase
      .from('focus_points')
      .select('*')
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .eq('is_other', false)
      .is('alias_of', null);

    if (!points || points.length === 0) {
      return { slot1: null, slot2: null, slot3: null };
    }

    // Auto-promote pending_coach FPs whose 3h deadline has passed
    const expired = points.filter(
      (p) => p.status === 'pending_coach' &&
             p.coach_review_deadline &&
             new Date(p.coach_review_deadline) <= now
    );
    if (expired.length > 0) {
      await supabase
        .from('focus_points')
        .update({ status: 'active', coach_review_deadline: null })
        .in('id', expired.map(p => p.id));
      // Patch in-memory so scoring below sees 'active'
      for (const p of expired) { p.status = 'active'; p.coach_review_deadline = null; }
    }

    // Only consider active/cooling_down/past_candidate focuses
    const visible = points.filter(
      (p) => !p.status || p.status === 'active' || p.status === 'cooling_down' || p.status === 'past_candidate'
    );

    const scored = visible
      .map((p) => ({ ...p, _priority: computePriority(p, now) }))
      .sort((a, b) => b._priority - a._priority);

    return {
      slot1: scored[0] || null,
      slot2: scored[1] || null,
      slot3: scored[2] || null,
    };
  } catch (e) {
    console.error('getSlots error:', e);
    return { slot1: null, slot2: null, slot3: null };
  }
}

// ─── Question multiplier (14-day behaviour window) ────────────────────────────

export async function getQuestionMultiplier(userId) {
  try {
    const windowStart = new Date(Date.now() - 14 * 86400000).toISOString();
    const [qRes, sRes, lRes] = await Promise.all([
      supabase
        .from('coach_messages')
        .select('id', { count: 'exact', head: true })
        .eq('student_id', userId)
        .gte('created_at', windowStart),
      supabase
        .from('training_sessions')
        .select('id')
        .eq('user_id', userId)
        .not('completed_at', 'is', null)
        .gte('started_at', windowStart),
      supabase
        .from('class_inputs')
        .select('id')
        .eq('user_id', userId)
        .eq('is_deleted', false)
        .gte('created_at', windowStart),
    ]);
    const Q        = qRes.count || 0;
    const S        = (sRes.data || []).length;
    const L        = (lRes.data || []).length;
    const activity = S + 0.5 * L;
    const ratio    = Q / (activity + 1);
    if (ratio < 0.3) return 1.2;
    if (ratio > 2)   return 0.7;
    return 1.0;
  } catch {
    return 1.0;
  }
}

// ─── Apply focus event → update focus_points directly ────────────────────────
// All metrics now live on focus_points:
//   struggle / importance → base_score
//   practice              → practice_count
//   coach_signal          → coach_signal
//   last_practiced_at     → last_exposed_at

export async function applyFocusEvent(focusId, eventType, userId) {
  try {
    const { data: fp } = await supabase
      .from('focus_points')
      .select('base_score, practice_count, coach_signal, tier, status')
      .eq('id', focusId)
      .single();

    if (!fp) return;

    const now    = new Date().toISOString();
    let update   = {};

    switch (eventType) {
      case 'PRACTICE_SESSION_LOG':
        update = { practice_count: (fp.practice_count || 0) + 2, last_exposed_at: now };
        break;
      case 'PRACTICE_QUICK_LOG':
        update = { practice_count: (fp.practice_count || 0) + 1, last_exposed_at: now };
        break;
      case 'QUESTION_CONFIRMATION': {
        const mult = userId ? await getQuestionMultiplier(userId) : 1.0;
        update = { base_score: Math.min(20, (fp.base_score || 5) + 0.5 * mult) };
        break;
      }
      case 'QUESTION_CLARIFICATION': {
        const mult = userId ? await getQuestionMultiplier(userId) : 1.0;
        update = { base_score: Math.min(20, (fp.base_score || 5) + 1.0 * mult) };
        break;
      }
      case 'QUESTION_CONFUSION': {
        const mult = userId ? await getQuestionMultiplier(userId) : 1.0;
        update = { base_score: Math.min(20, (fp.base_score || 5) + 2.0 * mult) };
        break;
      }
      case 'COACH_IMPROVED_MODERATE':
        update = { coach_signal: (fp.coach_signal || 0) - 2 };
        break;
      case 'COACH_IMPROVED_STRONG':
        update = { coach_signal: (fp.coach_signal || 0) - 4 };
        break;
      case 'COACH_FIXED':
        update = { coach_signal: (fp.coach_signal || 0) - 5 };
        break;
      case 'COACH_ESCALATION':
        update = {
          coach_signal: (fp.coach_signal || 0) + 2,
          base_score:   Math.min(20, (fp.base_score || 5) + 2),
        };
        break;
      case 'FOCUS_REMENTIONED':
        update = { base_score: Math.min(20, (fp.base_score || 5) + 2) };
        break;
      default:
        return;
    }

    await supabase.from('focus_points').update(update).eq('id', focusId);

    // Lifecycle: coach_signal <= -5 and priority low → past_candidate
    const merged = { ...fp, ...update };
    if ((merged.coach_signal || 0) <= -5) {
      const priority = computePriority(merged, new Date());
      if (priority <= 5 && (!merged.status || merged.status === 'active')) {
        await supabase
          .from('focus_points')
          .update({ status: 'past_candidate' })
          .eq('id', focusId);
      }
    }
  } catch (e) {
    console.error('applyFocusEvent error:', e);
  }
}

// ─── Session count for a focus point ─────────────────────────────────────────

export async function getSessionCountForFocus(focusPointId) {
  try {
    const userId = await getUserId();
    const { data } = await supabase
      .from('practice_logs')
      .select('id')
      .eq('student_id', userId)
      .eq('focus_point_id', focusPointId);
    return (data || []).length;
  } catch {
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
        user_id:        userId,
        slot1_focus_id: slot1FocusId || null,
        slot2_focus_id: slot2FocusId || null,
        started_at:     new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;
    return data?.id || null;
  } catch (e) {
    console.error('startTrainingSession error:', e);
    return null;
  }
}

// ─── Complete training session ────────────────────────────────────────────────

export async function completeTrainingSession(sessionId, feeling = null, sessionNote = null, activeFocusPointId = null) {
  try {
    if (!sessionId) return;
    const userId = await getUserId();

    // Get focus ids and timing before updating
    const { data: session } = await supabase
      .from('training_sessions')
      .select('slot1_focus_id, slot2_focus_id, started_at')
      .eq('id', sessionId)
      .single();

    const updatePayload = { completed_at: new Date().toISOString() };
    if (feeling)     updatePayload.feeling      = feeling;
    if (sessionNote) updatePayload.session_note = sessionNote;

    await supabase
      .from('training_sessions')
      .update(updatePayload)
      .eq('id', sessionId);

    // Restrict all scoring to only the focus point the user actually worked on
    const focusIds = [session?.slot1_focus_id, session?.slot2_focus_id].filter(Boolean);
    const activeFid = activeFocusPointId || focusIds[0];

    if (activeFid) {
      // Apply PRACTICE_SESSION_LOG to the active focus point only
      await applyFocusEvent(activeFid, 'PRACTICE_SESSION_LOG', userId);

      // Call practice-log edge function to trigger Yoda Score algorithm
      const FEELING_TO_RATING = {
        Hard:      'hard',
        Struggled: 'struggled',
        Okay:      'okay',
        Good:      'good',
        Great:     'great',
      };
      const rating = FEELING_TO_RATING[feeling] ?? 'okay';
      const completedAt = new Date();
      const startedAt = session?.started_at ? new Date(session.started_at) : completedAt;
      const durationMinutes = Math.max(1, Math.round((completedAt - startedAt) / 60000));

      supabase.functions.invoke('practice-log', {
        body: {
          focus_point_id:   activeFid,
          duration_minutes: durationMinutes,
          rating,
          student_id:       userId,
        },
      }).catch(err => console.error('practice-log invoke error:', err));

      // Map feeling → score update on the active focus point only
      // Hard/Struggled → base_score increases (still difficult)
      // Great → coach_signal decreases (self-assessed improvement)
      if (feeling) {
        const { data: fp } = await supabase
          .from('focus_points')
          .select('base_score, coach_signal')
          .eq('id', activeFid)
          .single();
        if (fp) {
          let update = null;
          if (feeling === 'Hard')      update = { base_score: Math.min(20, (fp.base_score || 5) + 1.5) };
          if (feeling === 'Struggled') update = { base_score: Math.min(20, (fp.base_score || 5) + 1.0) };
          if (feeling === 'Great')     update = { coach_signal: (fp.coach_signal || 0) - 1 };
          if (update) {
            await supabase.from('focus_points').update(update).eq('id', activeFid);
          }
        }
      }
    }

    // Update user stats
    const { data: user } = await supabase
      .from('users')
      .select('total_focus_worked')
      .eq('id', userId)
      .single();
    await supabase
      .from('users')
      .update({
        total_focus_worked: (user?.total_focus_worked || 0) + 1,
        last_active_date:   new Date().toISOString().split('T')[0],
      })
      .eq('id', userId);
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
    await supabase.from('users').update({ nudge_message: nudge }).eq('id', userId);
    return nudge;
  } catch (e) {
    console.error('refreshNudgeMessage error:', e);
    return null;
  }
}

export async function checkMondayRecalculation() {
  try {
    if (new Date().getDay() !== 1) return;
    await refreshNudgeMessage();
  } catch (e) {
    console.error('checkMondayRecalculation error:', e);
  }
}
