import { supabase } from '../services/supabase/client';
import { focusMatchesCategory } from './danceCategory';
import { getLessonReadiness } from '../storage/storage';
import { getCoupleReadiness } from '../storage/coupleStorage';

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

const FEELING_TO_RATING = {
  Hard:      'hard',
  Struggled: 'struggled',
  Okay:      'okay',
  Good:      'good',
  Great:     'great',
};

export function urgencyToTier(score) {
  if (score >= 8) return 'critical';
  if (score >= 5) return 'important';
  return 'supporting';
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

// ─── All focus points ranked by priority ──────────────────────────────────────
// `category` is optional: 'latin' | 'ballroom' | null. When set, focus points
// whose `dance` array doesn't match the category are excluded — but untagged
// focuses (no dance) appear in both categories (see focusMatchesCategory).

export async function getAllFocusPointsRanked(category = null) {
  try {
    const userId = await getUserId();
    const now = new Date();

    const { data: points } = await supabase
      .from('focus_points')
      .select('*, class_inputs!focus_points_class_input_id_fkey(id, created_at, class_summary, dance, teacher_name)')
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .eq('is_archived', false)
      .eq('status', 'active')
      .eq('is_other', false)
      .is('alias_of', null);

    if (!points || points.length === 0) return [];

    return points
      .filter((p) => focusMatchesCategory(p, category))
      .map((p) => ({ ...p, _priority: computePriority(p, now) }))
      .sort((a, b) => b._priority - a._priority);
  } catch (e) {
    console.error('getAllFocusPointsRanked error:', e);
    return [];
  }
}

// ─── Top-3 slot selection ─────────────────────────────────────────────────────

export async function getSlots(category = null, readinessOnly = false) {
  try {
    const userId = await getUserId();
    const now    = new Date();

    // Fetch the user's focus_points and the lesson readiness in parallel.
    // Readiness tells us which focuses come from the last private and still
    // need training — we pin those to the top of the slots until the student
    // hits 100%. Once ready, normal priority-based selection resumes.
    const [pointsRes, readiness] = await Promise.all([
      supabase
        .from('focus_points')
        .select('*')
        .eq('user_id', userId)
        .eq('is_deleted', false)
        .eq('is_other', false)
        .is('alias_of', null),
      getLessonReadiness(null, category).catch(() => null),
    ]);
    const points = pointsRes.data;

    if (!points || points.length === 0) {
      return { slot1: null, slot2: null, slot3: null, readiness };
    }

    // Train carousel (readinessOnly): show ONLY the current lesson's readiness
    // focuses (the "get ready" checklist), in readiness order — no extra
    // priority-ranked focuses. Other callers keep the full ranked behavior.
    if (readinessOnly) {
      const byId = new Map(points.map((p) => [p.id, p]));
      const list = (readiness?.focuses || [])
        .map((f) => byId.get(f.focusPointId))
        .filter((fp) => fp && focusMatchesCategory(fp, category));
      return { slot1: list[0] || null, slot2: list[1] || null, slot3: list[2] || null, readiness };
    }

    // Only consider active/cooling_down/past_candidate focuses, and within
    // the selected dance category if one is provided. Held focuses are
    // filtered out here — they re-enter the Train queue as pinned slots
    // only once the primary readiness list is done (see below).
    const visible = points.filter(
      (p) =>
        (!p.status || p.status === 'active' || p.status === 'cooling_down' || p.status === 'past_candidate') &&
        !p.is_held &&
        focusMatchesCategory(p, category)
    );

    const scored = visible
      .map((p) => ({ ...p, _priority: computePriority(p, now) }))
      .sort((a, b) => b._priority - a._priority);

    // Slot pinning has two modes:
    //   1) readiness < 100% → pin uncompleted readiness focuses at top
    //      (carry the new class's checklist into the slots)
    //   2) readiness == 100% → pin held focuses ("Not yet" carryovers
    //      from a prior debrief) so they're the first thing the student
    //      sees before the normal ranking resumes. After 15 min of
    //      cumulative practice each, they auto-archive.
    const pinned = [];
    if (readiness && readiness.percent < 100) {
      const pointById = new Map(points.map((p) => [p.id, p]));
      for (const f of readiness.focuses || []) {
        if (f.done >= f.target) continue;
        const fp = pointById.get(f.focusPointId);
        if (!fp) continue;
        if (!focusMatchesCategory(fp, category)) continue;
        pinned.push({ ...fp, _priority: computePriority(fp, now), _pinned: true });
      }
    } else if (readiness && readiness.percent >= 100) {
      for (const p of points) {
        if (!p.is_held) continue;
        if (p.status === 'past') continue;
        if (!focusMatchesCategory(p, category)) continue;
        pinned.push({ ...p, _priority: computePriority(p, now), _pinned: true });
      }
    }

    const pinnedIds = new Set(pinned.map((p) => p.id));
    const rest = scored.filter((p) => !pinnedIds.has(p.id));
    const finalList = [...pinned, ...rest];

    return {
      slot1: finalList[0] || null,
      slot2: finalList[1] || null,
      slot3: finalList[2] || null,
      readiness,
    };
  } catch (e) {
    console.error('getSlots error:', e);
    return { slot1: null, slot2: null, slot3: null, readiness: null };
  }
}

// ─── Couple top-3 slots ───────────────────────────────────────────────────────
// Mirror of getSlots for the couple's shared focus points (couple_focus_points),
// pinned by the couple's readiness. `coupleId` comes from getMyCouple().
export async function getCoupleSlots(coupleId, category = null) {
  try {
    if (!coupleId) return { slot1: null, slot2: null, slot3: null, readiness: null };

    const [pointsRes, readiness] = await Promise.all([
      supabase
        .from('couple_focus_points')
        .select('*')
        .eq('couple_id', coupleId)
        .eq('is_deleted', false)
        .eq('is_other', false),
      getCoupleReadiness(coupleId, category).catch(() => null),
    ]);
    const points = pointsRes.data || [];

    // Couple Train carousel: only the couple's readiness focuses (their shared
    // lesson checklist), in readiness order — same rule as the solo card.
    const byId = new Map(points.map((p) => [p.id, p]));
    const list = (readiness?.focuses || [])
      .map((f) => byId.get(f.focusPointId))
      .filter((fp) => fp && focusMatchesCategory(fp, category));
    return {
      slot1: list[0] || null,
      slot2: list[1] || null,
      slot3: list[2] || null,
      readiness,
    };
  } catch (e) {
    console.error('getCoupleSlots error:', e);
    return { slot1: null, slot2: null, slot3: null, readiness: null };
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
        .from('practice_logs')
        .select('id')
        .eq('student_id', userId)
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
        update = { base_score: Math.min(20, (fp.base_score || 5) + 2), last_mentioned_at: new Date().toISOString() };
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
// No longer inserts to DB — row is only created when the session is completed.
// Returns a local identifier used to track the in-progress session in memory.

export async function startTrainingSession(slot1FocusId, slot2FocusId) {
  return `local_${Date.now()}`;
}

// ─── Complete training session ────────────────────────────────────────────────
// Inserts a new practice_log row only at this point (end of session).

export async function completeTrainingSession(sessionId, feeling = null, sessionNote = null, activeFocusPointId = null, startedAtMs = null, sessionMotivation = null) {
  try {
    const userId = await getUserId();

    const rating          = FEELING_TO_RATING[feeling] ?? 'okay';
    const completedAt     = new Date();
    const startedAt       = startedAtMs ? new Date(startedAtMs) : completedAt;
    const durationMinutes = Math.max(1, Math.round((completedAt - startedAt) / 60000));
    const activeFid       = activeFocusPointId || null;

    // INSERT a fresh row — no row was created at session start
    const insertPayload = {
      student_id:       userId,
      focus_point_id:   activeFid,
      started_at:       startedAt.toISOString(),
      completed_at:     completedAt.toISOString(),
      duration_minutes: durationMinutes,
      rating,
    };
    if (feeling)     insertPayload.feeling      = feeling;
    if (sessionNote) insertPayload.session_note = sessionNote;
    if (sessionMotivation === 1 || sessionMotivation === 2 || sessionMotivation === 3) {
      insertPayload.session_motivation = sessionMotivation;
    }

    const { data: inserted, error } = await supabase
      .from('practice_logs')
      .insert(insertPayload)
      .select('id')
      .single();
    if (error) throw error;

    const newLogId = inserted?.id;

    if (activeFid) {
      // Server-side yoda-score.applyPracticeLog is the single source of truth
      // for practice_count and base_score changes. Fire-and-forget.
      supabase.functions.invoke('yoda-score', {
        body: {
          event:           'practice_log',
          practice_log_id: newLogId,
        },
      }).catch(err => console.error('yoda-score invoke error:', err));

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

      // Auto-archive ONLY for held focuses — the ones the coach marked
      // "Not yet" in a prior debrief. They re-enter the readiness once
      // the primary list is done and need 15 cumulative minutes of
      // practice to graduate. Fresh focuses (is_held=false) stay on the
      // student's roster until the coach explicitly validates them with
      // a "Good" verdict at the next debrief — no count-based shortcut.
      (async () => {
        try {
          const { data: fpRow } = await supabase
            .from('focus_points')
            .select('id, is_held, status')
            .eq('id', activeFid)
            .maybeSingle();
          if (!fpRow || !fpRow.is_held || fpRow.status === 'past') return;
          const { data: dlogs } = await supabase
            .from('practice_logs')
            .select('duration_minutes')
            .eq('student_id', userId)
            .eq('focus_point_id', activeFid)
            .not('completed_at', 'is', null);
          const totalMin = (dlogs || []).reduce(
            (sum, l) => sum + (l.duration_minutes || 0),
            0,
          );
          if (totalMin >= 15) {
            await supabase
              .from('focus_points')
              .update({ status: 'past' })
              .eq('id', activeFid);
          }
        } catch (e) {
          console.warn('[completeTrainingSession] held-archive failed:', e);
        }
      })();
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
