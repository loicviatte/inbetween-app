import { supabase } from '../services/supabase/client';
import { categoryFromStyle, categoryFromDances } from '../utils/danceCategory';

export async function getUserId() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error('Not authenticated');
  return session.user.id;
}

// ─── In-memory cache (speeds up stack screens that reuse tab data) ───────────
const _cache = {};
const CACHE_TTL = 15000; // 15s — fresh enough, avoids duplicate network calls

function cached(key, fetcher) {
  return async function (...args) {
    const entry = _cache[key];
    if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
    const data = await fetcher(...args);
    _cache[key] = { data, ts: Date.now() };
    return data;
  };
}

export function invalidateCache(key) {
  if (key) delete _cache[key];
  else Object.keys(_cache).forEach((k) => delete _cache[k]);
}

// ─── User ────────────────────────────────────────────────────────────────────

export async function getUser() {
  const userId = await getUserId();
  const { data } = await supabase
    .from('users')
    .select('*, studio:studios!users_studio_id_fkey(id, name)')
    .eq('id', userId)
    .single();
  return data;
}

export async function saveUserProfile({ name, studio_id, dance_style }) {
  const userId = await getUserId();
  await supabase.from('users').update({ name, studio_id, dance_style }).eq('id', userId);
}

export async function updateUserSummary(summary) {
  const userId = await getUserId();
  await supabase
    .from('users')
    .update({ current_summary: summary })
    .eq('id', userId);
}

export async function getUserSummary() {
  const userId = await getUserId();
  const { data } = await supabase
    .from('users')
    .select('current_summary')
    .eq('id', userId)
    .single();
  return data?.current_summary || null;
}

// ─── AI Coach Context ─────────────────────────────────────────────────────────

export async function getTeacherContextForAI() {
  const { data, error } = await supabase.functions.invoke('get-teacher-context');
  if (error) throw error;
  return data;
}

// ─── Class Inputs ────────────────────────────────────────────────────────────

async function _getClassInputs() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('class_inputs')
    .select('*, focus_points!focus_points_class_input_id_fkey(id, name, subtitle, context, drill, dance, tier, status)')
    .not('is_deleted', 'is', true)
    .order('created_at', { ascending: false });

  if (error) console.warn('[getClassInputs] error:', error.message);

  const inputs = data || [];

  // Batch-resolve teacher name from user_id for classes missing teacher_name
  const missingIds = [...new Set(
    inputs.filter(i => !i.teacher_name && i.user_id).map(i => i.user_id)
  )];
  let userNameMap = {};
  if (missingIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, name')
      .in('id', missingIds);
    userNameMap = Object.fromEntries((users || []).map(u => [u.id, u.name]));
  }

  return inputs.map(i => {
    const hasPendingFPs = (i.focus_points ?? []).some(fp => fp.status === 'pending_coach');
    const isProcessing   = i.status === 'processing' || i.status === 'extracted' || i.status === 'pending';
    const deadline       = (hasPendingFPs || isProcessing)
      ? new Date(new Date(i.created_at).getTime() + 18 * 60 * 60 * 1000).toISOString()
      : null;
    return {
      ...i,
      _teacher_fallback: !i.teacher_name ? (userNameMap[i.user_id] || null) : null,
      _pendingDeadline:  deadline,
      _hasPendingFPs:    hasPendingFPs,
    };
  });
}
export const getClassInputs = cached('classInputs', _getClassInputs);

export async function respondToAttendance(classInputId, attended) {
  const { data, error } = await supabase.functions.invoke('attendance-response', {
    body: { class_input_id: classInputId, attended: attended === 'yes' || attended === true },
  });
  console.log('[respondToAttendance] result:', data, error);
  if (error) throw error;
}

export async function saveClassInput(input) {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('class_inputs')
    .insert({ status: 'pending', ...input, user_id: userId, is_deleted: false })
    .select('id')
    .single();
  if (error) throw error;
  invalidateCache('classInputs');
  return data?.id;
}

export async function deleteClassInput(id) {
  await supabase
    .from('class_inputs')
    .update({ is_deleted: true })
    .eq('id', id);
  invalidateCache('classInputs');
}

export async function getRecentClassInputs(limit = 3) {
  const userId = await getUserId();
  const { data } = await supabase
    .from('class_inputs')
    .select('*')
    .eq('user_id', userId)
    .not('is_deleted', 'is', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

export async function getSessionsThisWeek() {
  const userId = await getUserId();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data } = await supabase
    .from('class_inputs')
    .select('id')
    .or(`user_id.eq.${userId},student_id.eq.${userId}`)
    .not('is_deleted', 'is', true)
    .gte('created_at', weekAgo);
  return (data || []).length;
}

// ─── AI Coach Chats ───────────────────────────────────────────────────────────

export async function loadAIChat(focusPointId) {
  const userId = await getUserId();
  const { data } = await supabase
    .from('focus_ai_chats')
    .select('messages')
    .eq('student_id', userId)
    .eq('focus_point_id', focusPointId)
    .single();
  return data?.messages || [];
}

export async function saveAIChat(focusPointId, messages) {
  const userId = await getUserId();
  await supabase
    .from('focus_ai_chats')
    .upsert(
      { student_id: userId, focus_point_id: focusPointId, messages, updated_at: new Date().toISOString() },
      { onConflict: 'student_id,focus_point_id' }
    );
}

export async function getTrainingSessionsThisWeek() {
  const userId = await getUserId();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data } = await supabase
    .from('practice_logs')
    .select('id')
    .eq('student_id', userId)
    .gte('started_at', weekAgo)
    .not('completed_at', 'is', null);
  return (data || []).length;
}

// Returns completed practice_logs for the current calendar month (used by
// the LogScreen monthly heatmap).
export async function getTrainingSessionsThisMonth() {
  try {
    const userId = await getUserId();
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const { data } = await supabase
      .from('practice_logs')
      .select('id, started_at, completed_at, feeling, focus_point_id')
      .eq('student_id', userId)
      .gte('started_at', firstOfMonth.toISOString())
      .lt('started_at', firstOfNextMonth.toISOString())
      .not('completed_at', 'is', null);
    return data || [];
  } catch {
    return [];
  }
}

export async function getTrainingDaysThisWeek() {
  try {
    const userId = await getUserId();
    const now = new Date();
    const mondayOffset = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - mondayOffset);
    monday.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('practice_logs')
      .select('started_at')
      .eq('student_id', userId)
      .gte('started_at', monday.toISOString())
      .not('completed_at', 'is', null);
    const days = new Set();
    for (const row of data || []) {
      const idx = (new Date(row.started_at).getDay() + 6) % 7; // Mon=0…Sun=6
      days.add(idx);
    }
    return days;
  } catch {
    return new Set();
  }
}

export async function getWeekActivity() {
  try {
    const userId = await getUserId();
    const now = new Date();
    const mondayOffset = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - mondayOffset);
    monday.setHours(0, 0, 0, 0);
    const mondayISO = monday.toISOString();
    const [{ data: sessions }, { data: classes }, { data: focusPoints }] = await Promise.all([
      supabase
        .from('practice_logs')
        .select('id, started_at, feeling, focus_point_id')
        .eq('student_id', userId)
        .gte('started_at', mondayISO)
        .not('completed_at', 'is', null),
      supabase
        .from('class_inputs')
        .select('id, created_at, title, practice_point_1, ai_primary_focus')
        .or(`user_id.eq.${userId},student_id.eq.${userId}`)
        .not('is_deleted', 'is', true)
        .gte('created_at', mondayISO),
      supabase
        .from('focus_points')
        .select('id, name')
        .eq('user_id', userId),
    ]);
    const focusMap = {};
    for (const fp of focusPoints || []) focusMap[fp.id] = fp.name;
    const activity = {};
    for (const s of sessions || []) {
      const idx = (new Date(s.started_at).getDay() + 6) % 7;
      if (!activity[idx]) activity[idx] = { sessions: [], classes: [] };
      activity[idx].sessions.push({ ...s, focusName: focusMap[s.focus_point_id] || null });
    }
    for (const c of classes || []) {
      const idx = (new Date(c.created_at).getDay() + 6) % 7;
      if (!activity[idx]) activity[idx] = { sessions: [], classes: [] };
      activity[idx].classes.push(c);
    }
    return activity;
  } catch {
    return {};
  }
}

// ─── Focus Points ────────────────────────────────────────────────────────────

export async function getFocusPoints() {
  const userId = await getUserId();
  const { data } = await supabase
    .from('focus_points')
    .select('*')
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .eq('is_archived', false)
    .eq('status', 'active')
    .eq('is_other', false)
    .order('created_at', { ascending: true });
  return data || [];
}

export async function saveFocusPoint(fp) {
  const userId = await getUserId();
  if (fp.id) {
    const { data: existing } = await supabase
      .from('focus_points')
      .select('id')
      .eq('id', fp.id)
      .single();

    if (existing) {
      const { id, user_id, created_at, ...updates } = fp;
      await supabase
        .from('focus_points')
        .update(updates)
        .eq('id', fp.id);
      return fp.id;
    }
  }

  const { id, ...rest } = fp;
  const { data } = await supabase
    .from('focus_points')
    .insert({ ...rest, user_id: userId })
    .select('id')
    .single();

  return data?.id;
}

export async function archiveFocusPoint(id) {
  await supabase
    .from('focus_points')
    .update({ is_archived: true })
    .eq('id', id);
}

export async function getClassInputsForFocus(focusName) {
  const userId = await getUserId();
  const { data } = await supabase
    .from('class_inputs')
    .select('id, created_at, practice_point_1, practice_point_2, priority_score_1, priority_score_2, class_summary, ai_primary_focus, ai_secondary_focus')
    .eq('user_id', userId)
    .not('is_deleted', 'is', true)
    .or(`ai_primary_focus.eq.${focusName},ai_secondary_focus.eq.${focusName}`)
    .order('created_at', { ascending: false })
    .limit(5);
  return data || [];
}

export async function getFocusTrainedCount() {
  const userId = await getUserId();
  const { data } = await supabase
    .from('practice_logs')
    .select('focus_point_id')
    .eq('student_id', userId)
    .not('completed_at', 'is', null)
    .not('focus_point_id', 'is', null);
  const ids = new Set((data || []).map(r => r.focus_point_id));
  return ids.size;
}

export async function getFocusTrainedThisWeek() {
  const userId = await getUserId();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data } = await supabase
    .from('practice_logs')
    .select('focus_point_id')
    .eq('student_id', userId)
    .gte('started_at', weekAgo)
    .not('completed_at', 'is', null)
    .not('focus_point_id', 'is', null);
  const ids = new Set((data || []).map(r => r.focus_point_id));
  return ids.size;
}

export async function getTopFocusPointsWithCounts(n = 3) {
  const userId = await getUserId();
  const [points, sessions] = await Promise.all([
    getFocusPoints(),
    supabase
      .from('practice_logs')
      .select('focus_point_id')
      .eq('student_id', userId)
      .not('completed_at', 'is', null)
      .not('focus_point_id', 'is', null)
      .then(({ data }) => data || []),
  ]);

  const counts = {};
  for (const s of sessions) {
    if (s.focus_point_id) counts[s.focus_point_id] = (counts[s.focus_point_id] || 0) + 1;
  }

  return [...points]
    .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0))
    .slice(0, n)
    .map(p => ({ ...p, count: counts[p.id] || 0 }));
}

// ─── Day streak (consecutive days with a completed practice_log) ─────────────
function _dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export async function getDayStreak() {
  const userId = await getUserId();
  // Pull recent completions (90 days is more than enough for any reasonable streak)
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data } = await supabase
    .from('practice_logs')
    .select('completed_at')
    .eq('student_id', userId)
    .not('completed_at', 'is', null)
    .gte('completed_at', since);

  const days = new Set();
  for (const r of data || []) days.add(_dayKey(new Date(r.completed_at)));

  // Walk back from today; if no log today, allow yesterday as the anchor
  // so the streak doesn't reset until 24h after the last activity.
  const today = new Date();
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!days.has(_dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (days.has(_dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ─── Lesson readiness ────────────────────────────────────────────────────────
// "How ready you are for your next private" — measured against the focus
// points extracted from your most recent private. Critical focuses need 3
// sessions, everything else needs 2. A session = ~7 min of training.
const SESSION_MINUTES = 7;
const TIER_ORDER = { critical: 0, important: 1, supporting: 2 };
function targetForTier(tier) {
  return tier === 'critical' ? 3 : 2;
}

// Pass `targetUserId` to inspect another student's readiness (coach view).
// Omit it to read the readiness of the currently authenticated user.
export async function getLessonReadiness(targetUserId = null) {
  const userId = targetUserId || (await getUserId());

  // Source of truth = the focus_points the AI extracted for this student,
  // tagged with their originating class. We start there (rather than from
  // class_inputs) so a freshly logged class that hasn't been processed yet
  // doesn't blank out the dashboard — we fall back to the most recent
  // private that actually has focus_points.
  const { data: fpClassRefs } = await supabase
    .from('focus_points')
    .select('class_input_id')
    .eq('user_id', userId)
    .eq('is_other', false)
    .not('is_deleted', 'is', true)
    .neq('status', 'past')
    .not('class_input_id', 'is', null);
  const distinctClassIds = Array.from(
    new Set((fpClassRefs ?? []).map(r => r.class_input_id))
  );
  if (distinctClassIds.length === 0) return null;

  // Most recent private among those classes (legacy rows with null
  // lesson_type still count as private).
  const { data: classes } = await supabase
    .from('class_inputs')
    .select('id, created_at')
    .in('id', distinctClassIds)
    .or('lesson_type.eq.private,lesson_type.is.null')
    .not('is_deleted', 'is', true)
    .order('created_at', { ascending: false })
    .limit(1);
  const lastClass = classes?.[0];
  if (!lastClass) return null;

  // Primary focuses = those produced by the anchor class AND not currently
  // held (a held focus is one the coach marked "Not yet" in a prior debrief
  // — it waits until the primary list is done before re-entering).
  const { data: fps } = await supabase
    .from('focus_points')
    .select('id, name, tier')
    .eq('user_id', userId)
    .eq('class_input_id', lastClass.id)
    .eq('is_other', false)
    .not('is_deleted', 'is', true)
    .neq('status', 'past')
    .or('is_held.is.null,is_held.eq.false');
  if (!fps || fps.length === 0) return null;

  // Sessions completed against those focus points since the class
  const ids = fps.map(f => f.id);
  const counts = {};
  const { data: logs } = await supabase
    .from('practice_logs')
    .select('focus_point_id')
    .eq('student_id', userId)
    .in('focus_point_id', ids)
    .gte('completed_at', lastClass.created_at)
    .not('completed_at', 'is', null);
  for (const l of logs || []) counts[l.focus_point_id] = (counts[l.focus_point_id] || 0) + 1;

  const focuses = fps
    .map(fp => {
      const target = targetForTier(fp.tier);
      const done = Math.min(target, counts[fp.id] || 0);
      return { focusPointId: fp.id, name: fp.name, tier: fp.tier, target, done };
    })
    .sort((a, b) => (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99));

  const totalTarget = focuses.reduce((sum, f) => sum + f.target, 0);
  const totalDone = focuses.reduce((sum, f) => sum + f.done, 0);
  const percent = totalTarget > 0 ? Math.round((totalDone / totalTarget) * 100) : 0;
  const minutesRemaining = Math.max(0, totalTarget - totalDone) * SESSION_MINUTES;

  return { lastClassDate: lastClass.created_at, focuses, percent, minutesRemaining };
}

// ─── Notes ───────────────────────────────────────────────────────────────────

async function _getNotes() {
  const userId = await getUserId();
  const { data } = await supabase
    .from('notes')
    .select('*')
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false });
  return data || [];
}
export const getNotes = cached('notes', _getNotes);

export async function getNoteById(id) {
  const { data } = await supabase
    .from('notes')
    .select('*')
    .eq('id', id)
    .single();
  return data || null;
}

export async function saveNote(note) {
  const userId = await getUserId();
  const { id, user_id, created_at, ...rest } = note;

  if (id) {
    const { data: existing } = await supabase
      .from('notes')
      .select('id')
      .eq('id', id)
      .single();

    if (existing) {
      await supabase
        .from('notes')
        .update(rest)
        .eq('id', id);
      invalidateCache('notes');
      return id;
    }
  }

  const { data } = await supabase
    .from('notes')
    .insert({ ...rest, user_id: userId })
    .select('id')
    .single();
  invalidateCache('notes');
  return data?.id;
}

export async function deleteNote(id) {
  await supabase
    .from('notes')
    .update({ is_deleted: true })
    .eq('id', id);
  invalidateCache('notes');
}

export async function getNotesLinkedToClass(classInputId) {
  const userId = await getUserId();
  const { data } = await supabase
    .from('notes')
    .select('*')
    .eq('user_id', userId)
    .eq('linked_class_input_id', classInputId)
    .eq('is_deleted', false);
  return data || [];
}

// ─── Coach Linking (student side) ─────────────────────────────────────────────

// Internal: link by invite code for a given category
async function _linkToCoachByCategory(userId, inviteCode, category) {
  const code = inviteCode.trim().toUpperCase();
  const coachIdField = category === 'latin' ? 'latin_coach_id' : 'ballroom_coach_id';

  const { data: coach } = await supabase
    .from('users')
    .select('id, name, role, dance_style, studio:studios!users_studio_id_fkey(id, name)')
    .eq('invite_code', code)
    .eq('role', 'coach')
    .maybeSingle();

  if (!coach) throw new Error('Coach not found. Check the code and try again.');

  const { data: existing } = await supabase
    .from('coach_requests')
    .select('id, status')
    .eq('student_id', userId)
    .eq('coach_id', coach.id)
    .eq('category', category)
    .maybeSingle();

  if (existing) {
    if (existing.status === 'accepted') {
      await supabase.from('users').update({ [coachIdField]: coach.id }).eq('id', userId);
      return { coach: { ...coach, pending: false }, alreadyLinked: true };
    }
    if (existing.status === 'pending') return { coach: { ...coach, pending: true }, pending: true };
  }

  await supabase.from('coach_requests').insert({
    student_id: userId,
    coach_id: coach.id,
    status: 'pending',
    category,
  });

  return { coach: { ...coach, pending: true }, pending: true };
}

// For single-style students (Latin or Ballroom) — category derived from dance_style
export async function linkToCoachByCode(inviteCode) {
  const userId = await getUserId();
  const { data: me } = await supabase.from('users').select('dance_style').eq('id', userId).single();
  const category = categoryFromStyle(me?.dance_style);
  if (!category) throw new Error('Set your dance style before linking a coach.');
  return _linkToCoachByCategory(userId, inviteCode, category);
}

// For 'Latin & Ballroom' students — explicit category ('latin' | 'ballroom')
export async function linkToCoachByCodeForCategory(inviteCode, category) {
  const userId = await getUserId();
  return _linkToCoachByCategory(userId, inviteCode, category);
}

// For single-style students
export async function unlinkCoach() {
  const userId = await getUserId();
  const { data: me } = await supabase.from('users').select('dance_style').eq('id', userId).single();
  const category = categoryFromStyle(me?.dance_style);
  if (!category) return;
  const field = category === 'latin' ? 'latin_coach_id' : 'ballroom_coach_id';
  // Hard-delete the request row (any status) so the coach loses RLS access
  // and stops seeing the student. Then null the column on users for
  // belt-and-suspenders. Order matters: delete first so the coach's read
  // policy via coach_requests fails immediately.
  await supabase
    .from('coach_requests')
    .delete()
    .eq('student_id', userId)
    .eq('category', category);
  await supabase.from('users').update({ [field]: null }).eq('id', userId);
}

// For 'Latin & Ballroom' students
export async function unlinkCoachForCategory(category) {
  const userId = await getUserId();
  const field = category === 'latin' ? 'latin_coach_id' : 'ballroom_coach_id';
  await supabase
    .from('coach_requests')
    .delete()
    .eq('student_id', userId)
    .eq('category', category);
  await supabase.from('users').update({ [field]: null }).eq('id', userId);
}

// Lookup a coach by id and tag the pending state. Returns null if not found.
async function _coachWithPending(coachId, pending) {
  const { data: coach } = await supabase
    .from('users')
    .select('id, name, dance_style, studio:studios!users_studio_id_fkey(id, name)')
    .eq('id', coachId)
    .single();
  return coach ? { ...coach, pending } : null;
}

// For single-style students
export async function getMyCoach() {
  const userId = await getUserId();
  const { data: me } = await supabase
    .from('users')
    .select('dance_style, latin_coach_id, ballroom_coach_id')
    .eq('id', userId)
    .single();

  const category = categoryFromStyle(me?.dance_style);
  if (!category) return null;
  const coachId = category === 'latin' ? me?.latin_coach_id : me?.ballroom_coach_id;

  // Accepted link wins — the users column is the source of truth.
  if (coachId) return _coachWithPending(coachId, false);

  // Otherwise surface the latest accepted-or-pending request so the UI can
  // show "Waiting to accept…" until the coach responds (or "Add teacher"
  // if there's no request at all). Prefer accepted over pending — alphabetical
  // ascending puts 'accepted' before 'pending' so a stale accepted row isn't
  // overshadowed by a newer pending one.
  const { data: req } = await supabase
    .from('coach_requests')
    .select('coach_id, status')
    .eq('student_id', userId)
    .eq('category', category)
    .in('status', ['accepted', 'pending'])
    .order('status', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!req?.coach_id) return null;
  return _coachWithPending(req.coach_id, req.status === 'pending');
}

// For 'Latin & Ballroom' students
export async function getMyCoachForCategory(category) {
  const userId = await getUserId();
  const field = category === 'latin' ? 'latin_coach_id' : 'ballroom_coach_id';

  const { data: me } = await supabase
    .from('users')
    .select(field)
    .eq('id', userId)
    .single();

  if (me?.[field]) return _coachWithPending(me[field], false);

  // Fallback: surface accepted requests not yet backfilled into users, plus
  // pending requests waiting on the coach. Accepted wins over pending.
  const { data: req } = await supabase
    .from('coach_requests')
    .select('coach_id, status, created_at')
    .eq('student_id', userId)
    .eq('category', category)
    .in('status', ['accepted', 'pending'])
    .order('status', { ascending: true })  // 'accepted' < 'pending' alphabetically
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!req?.coach_id) return null;

  // Self-heal the users column for accepted requests so the next read is
  // one round trip (preserves the original behaviour).
  if (req.status === 'accepted') {
    await supabase.from('users').update({ [field]: req.coach_id }).eq('id', userId);
  }

  return _coachWithPending(req.coach_id, req.status === 'pending');
}

// ─── Student → Coach Messages ─────────────────────────────────────────────────

// question_type: 'confirmation' | 'clarification' | 'confusion' (default: 'clarification')
// focusPointId: optional — the focus point this question relates to
export async function askCoach(message, question_type = 'clarification', focusPointId = null) {
  const userId = await getUserId();

  const { data: me } = await supabase
    .from('users')
    .select('dance_style, latin_coach_id, ballroom_coach_id')
    .eq('id', userId)
    .single();

  // Determine which coach to route to:
  // If a focus point is provided, use its dance to pick the matching coach.
  // Otherwise fall back to the student's dance_style.
  let coachId = null;
  if (focusPointId) {
    const { data: fp } = await supabase
      .from('focus_points')
      .select('dance')
      .eq('id', focusPointId)
      .single();
    const category = categoryFromDances(fp?.dance);
    coachId = category === 'latin' ? me?.latin_coach_id : me?.ballroom_coach_id;
  }
  if (!coachId) {
    // Fallback: use dance_style, then whichever coach is set
    const category = categoryFromStyle(me?.dance_style);
    coachId = category === 'latin'
      ? (me?.latin_coach_id ?? me?.ballroom_coach_id)
      : (me?.ballroom_coach_id ?? me?.latin_coach_id);
  }

  if (!coachId) throw new Error('No coach linked. Add your coach first.');

  await supabase.from('coach_messages').insert({
    student_id:    userId,
    coach_id:      coachId,
    message:       message.trim(),
    question_type: question_type,
    status:        'pending',
  });

  // Update struggle score on the related focus point
  if (focusPointId) {
    const eventType =
      question_type === 'confirmation' ? 'QUESTION_CONFIRMATION'
      : question_type === 'confusion'  ? 'QUESTION_CONFUSION'
      : 'QUESTION_CLARIFICATION';
    const { applyFocusEvent } = await import('../utils/algorithm');
    await applyFocusEvent(focusPointId, eventType, userId).catch(() => {});
  }
}

// Returns the student's own questions to their coach with current status.
// Filters to "active" statuses — pending (still in the coach's queue),
// dismissed (coach will cover it in the next class), and replied (coach
// answered). Past/rejected are excluded.
export async function getMyCoachQuestions() {
  const userId = await getUserId();
  const { data } = await supabase
    .from('coach_messages')
    .select('id, message, reply, status, created_at')
    .eq('student_id', userId)
    .in('status', ['pending', 'dismissed', 'replied'])
    .order('created_at', { ascending: false })
    .limit(20);
  return data || [];
}

export async function getCoachReplies() {
  const userId = await getUserId();
  const { data } = await supabase
    .from('coach_messages')
    .select('id, message, reply, status, created_at, replied_at')
    .eq('student_id', userId)
    .in('status', ['replied'])
    .order('replied_at', { ascending: false })
    .limit(10);
  return data || [];
}


export async function getUserRole() {
  const userId = await getUserId();
  const { data } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .single();
  return data?.role || 'student';
}

export async function setUserRole(role) {
  const userId = await getUserId();
  await supabase.from('users').update({ role }).eq('id', userId);
}
