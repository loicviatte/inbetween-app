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

// ─── Display ordering ─────────────────────────────────────────────────────────
// Tier is a display RANK only now (critical first), no longer a score. There is
// no priority/decay engine: focus points sort by tier, then most-recently
// addressed first. base_score / coach_signal / recency / inaction are all gone.
const TIER_RANK = { critical: 0, important: 1, supporting: 2 };

function byTierThenRecent(a, b) {
  const ra = TIER_RANK[a.tier] ?? 1;
  const rb = TIER_RANK[b.tier] ?? 1;
  if (ra !== rb) return ra - rb;
  const ta = new Date(a.last_mentioned_at || a.created_at || 0).getTime();
  const tb = new Date(b.last_mentioned_at || b.created_at || 0).getTime();
  return tb - ta; // newest first
}

// ─── All focus points ranked by priority ──────────────────────────────────────
// `category` is optional: 'latin' | 'ballroom' | null. When set, focus points
// whose `dance` array doesn't match the category are excluded — but untagged
// focuses (no dance) appear in both categories (see focusMatchesCategory).

export async function getAllFocusPointsRanked(category = null) {
  try {
    const userId = await getUserId();

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
      .sort(byTierThenRecent);
  } catch (e) {
    console.error('getAllFocusPointsRanked error:', e);
    return [];
  }
}

// ─── Solo "in progress" focuses (current readiness checklist) ──────────────────
// The focus points from the student's most recent private lesson — the same set
// the readiness meter tracks — returned as full ranked rows, each tagged with
// its {_target,_done} progress. Powers the All-focus-points "Solo" tab, which
// shows only what's currently in progress rather than the full lifetime list.
export async function getSoloReadinessFocuses(category = null) {
  try {
    const [ranked, readiness] = await Promise.all([
      getAllFocusPointsRanked(category),
      getLessonReadiness(null, category).catch(() => null),
    ]);
    const focuses = readiness?.focuses || [];
    if (focuses.length === 0) return [];
    const prog = new Map(focuses.map((f) => [f.focusPointId, f]));
    // Intersect with the active/ranked set so a not-yet-published (pending_coach)
    // readiness focus is naturally dropped — we only ever surface practiceable FPs.
    return ranked
      .filter((p) => prog.has(p.id))
      .map((p) => ({ ...p, _target: prog.get(p.id).target, _done: prog.get(p.id).done }));
  } catch (e) {
    console.error('getSoloReadinessFocuses error:', e);
    return [];
  }
}

// ─── Group focuses from the last N group classes ───────────────────────────────
// Active group focus points the student owns, restricted to the `classLimit`
// most recent group classes they attended. Each row gets `class_inputs` meta
// (for the card). Powers the All-focus-points "Group" tab.
export async function getGroupFocusPointsRecent(category = null, classLimit = 2) {
  try {
    const userId = await getUserId();

    const { data: points } = await supabase
      .from('focus_points')
      .select('*')
      .eq('user_id', userId)
      .eq('group_fp', true)
      .eq('is_deleted', false)
      .eq('is_archived', false)
      .eq('status', 'active')
      .eq('is_other', false)
      .is('alias_of', null);
    if (!points || points.length === 0) return [];

    // A group FP's originating class is `source_class_input_id` (set when it was
    // created); fall back to `class_input_id` for older rows.
    const classOf = (p) => p.source_class_input_id || p.class_input_id || null;
    const classIds = Array.from(new Set(points.map(classOf).filter(Boolean)));
    if (classIds.length === 0) return [];

    const { data: classes } = await supabase
      .from('class_inputs')
      .select('id, created_at, teacher_name, dance, class_summary, lesson_type')
      .in('id', classIds)
      .in('lesson_type', ['group', 'public'])
      .not('is_deleted', 'is', true)
      .order('created_at', { ascending: false });
    if (!classes || classes.length === 0) return [];

    const recent = classes.slice(0, classLimit);
    const recentIds = new Set(recent.map((c) => c.id));
    const clsById = new Map(classes.map((c) => [c.id, c]));
    const classRank = new Map(recent.map((c, i) => [c.id, i])); // 0 = newest class

    return points
      .filter((p) => recentIds.has(classOf(p)))
      .filter((p) => focusMatchesCategory(p, category))
      .map((p) => ({ ...p, class_inputs: clsById.get(classOf(p)) || null }))
      .sort((a, b) => {
        const ra = classRank.get(classOf(a)) ?? 99;
        const rb = classRank.get(classOf(b)) ?? 99;
        if (ra !== rb) return ra - rb;          // newest class first
        return byTierThenRecent(a, b);           // then by tier rank within a class
      });
  } catch (e) {
    console.error('getGroupFocusPointsRecent error:', e);
    return [];
  }
}

// ─── All-focus-points bundle (one round-trip) ──────────────────────────────────
// Server-side equivalent of getSoloReadinessFocuses + getCoupleReadinessFocuses +
// getGroupFocusPointsRecent + getMyCouple + getUser — collapsed into ONE RPC so
// the screen doesn't pay the free-tier pooler's serial-round-trip staircase.
// Returns { danceStyle, couple: {coupleId}|null, solo[], couple_pts[], group[] }.
export async function getAllFocusPointsBundle(category = null) {
  try {
    const userId = await getUserId();
    const { data } = await supabase.rpc('get_all_focus_points', { p_user: userId, p_category: category });
    return data || null;
  } catch (e) {
    console.error('getAllFocusPointsBundle error:', e);
    return null;
  }
}

// ─── Train per-style bundle (one round-trip) ───────────────────────────────────
// Solo slots + readiness, couple slots + readiness, and slot1/slot2 session
// counts for ONE dance category — collapses the getSlots + getCoupleSlots + 2×
// count staircase the free-tier pooler serialized (the ~20s timeout that left
// Train with 0 focus points). Returns null on failure (callers keep what's on
// screen). Shape: { solo:{slots[],readiness}, couple:{slots[],readiness}|null,
// sessionCounts:{slot1,slot2} }.
export async function getTrainFocus(category = null) {
  try {
    const userId = await getUserId();
    const { data } = await supabase.rpc('get_train_focus', { p_user: userId, p_category: category });
    return data || null;
  } catch (e) {
    console.error('getTrainFocus error:', e);
    return null;
  }
}

// ─── Top-3 slot selection ─────────────────────────────────────────────────────

export async function getSlots(category = null, readinessOnly = false) {
  try {
    const userId = await getUserId();

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

    // Only consider active/cooling_down focuses, and within the selected dance
    // category if one is provided. "Not yet" carry-overs (is_held) are normal
    // active focuses now — they stay in the readiness/Train list until the coach
    // validates them or they're reconciled into a new class (no auto-graduation).
    const visible = points.filter(
      (p) =>
        (!p.status || p.status === 'active' || p.status === 'cooling_down') &&
        focusMatchesCategory(p, category)
    );

    const scored = [...visible].sort(byTierThenRecent);

    // Pin the uncompleted readiness focuses at the top — the current class's
    // checklist, which now includes "Not yet" carry-overs (held focuses are in
    // readiness like any other active focus).
    const pinned = [];
    if (readiness && readiness.percent < 100) {
      const pointById = new Map(points.map((p) => [p.id, p]));
      for (const f of readiness.focuses || []) {
        if (f.done >= f.target) continue;
        const fp = pointById.get(f.focusPointId);
        if (!fp) continue;
        if (!focusMatchesCategory(fp, category)) continue;
        pinned.push({ ...fp, _pinned: true });
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
    // `error: true` lets callers tell a genuine "no focuses" ({slot1:null}) apart
    // from a transient failure (timeout / pooler saturation), so a hiccup never
    // blanks focus points already on screen. See HomeScreen load() guards.
    return { slot1: null, slot2: null, slot3: null, readiness: null, error: true };
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

    // Once the couple's readiness checklist is done, surface held ("Not yet")
    // couple focuses so they re-enter Train and can graduate after 15 min of
    // cumulative practice (the archive_held_couple_fp trigger). Mirrors getSlots.
    if (readiness && readiness.percent >= 100) {
      const seen = new Set(list.filter(Boolean).map((p) => p.id));
      for (const p of points) {
        if (!p.is_held) continue;
        if (p.status === 'past' || p.status === 'pending_coach') continue;
        if (seen.has(p.id)) continue;
        if (!focusMatchesCategory(p, category)) continue;
        list.push(p);
      }
    }

    return {
      slot1: list[0] || null,
      slot2: list[1] || null,
      slot3: list[2] || null,
      readiness,
    };
  } catch (e) {
    console.error('getCoupleSlots error:', e);
    return { slot1: null, slot2: null, slot3: null, readiness: null, error: true };
  }
}

// ─── Apply focus event → update focus_points directly ────────────────────────
// Tier is target-count only now, so the only events that change anything are
// practice logs (they advance the X/N count). Question events are kept as
// no-ops so AI-chat / ask-coach callers don't error. There is no score,
// coach_signal, decay or lifecycle transition: a focus point stays active until
// the coach validates it at a debrief or the student archives it.
export async function applyFocusEvent(focusId, eventType, userId) {
  try {
    const { data: fp } = await supabase
      .from('focus_points')
      .select('practice_count')
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
      // Questions no longer move any score or lifecycle — no-op.
      case 'QUESTION_CONFIRMATION':
      case 'QUESTION_CLARIFICATION':
      case 'QUESTION_CONFUSION':
        return;
      default:
        return;
    }

    await supabase.from('focus_points').update(update).eq('id', focusId);
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

      // Feeling no longer moves any score — tier is target-count only now. The
      // feeling is still recorded on the practice_logs row inserted above.

      // No count-based graduation: "Not yet" carry-overs (is_held) are normal
      // active focuses now — they stay until the coach validates them at a
      // debrief or they're reconciled into a new class. No 15-min auto-archive.
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
