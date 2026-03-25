import { supabase } from '../lib/supabase';

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

// ─── User ────────────────────────────────────────────────────────────────────

export async function getUser() {
  const userId = await getUserId();
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  return data;
}

export async function saveUserProfile({ name, main_studio, main_studio_place_id, dance_style }) {
  const userId = await getUserId();
  await supabase
    .from('users')
    .update({ name, main_studio, main_studio_place_id, dance_style })
    .eq('id', userId);
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

// ─── Class Inputs ────────────────────────────────────────────────────────────

export async function getClassInputs() {
  const userId = await getUserId();
  const { data } = await supabase
    .from('class_inputs')
    .select('*')
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function saveClassInput(input) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('class_inputs')
    .insert({ ...input, user_id: userId });
  if (error) throw error;
}

export async function deleteClassInput(id) {
  await supabase
    .from('class_inputs')
    .update({ is_deleted: true })
    .eq('id', id);
}

export async function getRecentClassInputs(limit = 3) {
  const userId = await getUserId();
  const { data } = await supabase
    .from('class_inputs')
    .select('*')
    .eq('user_id', userId)
    .eq('is_deleted', false)
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
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .gte('created_at', weekAgo);
  return (data || []).length;
}

export async function getTrainingSessionsThisWeek() {
  const userId = await getUserId();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data } = await supabase
    .from('training_sessions')
    .select('id')
    .eq('user_id', userId)
    .gte('started_at', weekAgo)
    .not('completed_at', 'is', null);
  return (data || []).length;
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
      .from('training_sessions')
      .select('started_at')
      .eq('user_id', userId)
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
        .from('training_sessions')
        .select('id, started_at, feeling, slot1_focus_id')
        .eq('user_id', userId)
        .gte('started_at', mondayISO)
        .not('completed_at', 'is', null),
      supabase
        .from('class_inputs')
        .select('id, created_at, practice_point_1, ai_primary_focus')
        .eq('user_id', userId)
        .eq('is_deleted', false)
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
      activity[idx].sessions.push({ ...s, focusName: focusMap[s.slot1_focus_id] || null });
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
    .select('id, created_at, practice_point_1, practice_point_2, priority_score_1, priority_score_2, takeaway, ai_primary_focus, ai_secondary_focus')
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .or(`ai_primary_focus.eq.${focusName},ai_secondary_focus.eq.${focusName}`)
    .order('created_at', { ascending: false })
    .limit(5);
  return data || [];
}

export async function cacheFocusSummary(focusPointId, summary) {
  const payload = JSON.stringify({ summary, generated_at: new Date().toISOString() });
  await supabase
    .from('focus_points')
    .update({ current_exercise: payload })
    .eq('id', focusPointId);
}

export async function getCachedFocusSummary(focusPointId) {
  const { data } = await supabase
    .from('focus_points')
    .select('current_exercise')
    .eq('id', focusPointId)
    .single();
  if (!data?.current_exercise) return null;
  try {
    const parsed = JSON.parse(data.current_exercise);
    const age = Date.now() - new Date(parsed.generated_at).getTime();
    if (age > 7 * 86400000) return null; // older than 7 days
    return parsed.summary;
  } catch {
    return null;
  }
}

export async function getFocusTrainedCount() {
  const userId = await getUserId();
  const { data } = await supabase
    .from('training_sessions')
    .select('slot1_focus_id, slot2_focus_id')
    .eq('user_id', userId)
    .not('completed_at', 'is', null);
  const ids = new Set();
  for (const row of data || []) {
    if (row.slot1_focus_id) ids.add(row.slot1_focus_id);
    if (row.slot2_focus_id) ids.add(row.slot2_focus_id);
  }
  return ids.size;
}

export async function getFocusTrainedThisWeek() {
  const userId = await getUserId();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data } = await supabase
    .from('training_sessions')
    .select('slot1_focus_id, slot2_focus_id')
    .eq('user_id', userId)
    .gte('started_at', weekAgo)
    .not('completed_at', 'is', null);
  const ids = new Set();
  for (const row of data || []) {
    if (row.slot1_focus_id) ids.add(row.slot1_focus_id);
    if (row.slot2_focus_id) ids.add(row.slot2_focus_id);
  }
  return ids.size;
}

// ─── Focus Progress ──────────────────────────────────────────────────────────

export async function getFocusProgress() {
  const userId = await getUserId();
  const { data } = await supabase
    .from('focus_progress')
    .select('*')
    .eq('user_id', userId);
  return data || [];
}

export async function saveFocusProgress(entry) {
  const userId = await getUserId();
  await supabase
    .from('focus_progress')
    .insert({ ...entry, user_id: userId });
}

export async function getTopFocusPoints(n = 2) {
  const [points, progress] = await Promise.all([getFocusPoints(), getFocusProgress()]);
  if (!points.length) return [];

  const scores = {};
  for (const p of progress) {
    scores[p.focus_point_id] = (scores[p.focus_point_id] || 0) + p.priority_score;
  }

  return [...points]
    .sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0))
    .slice(0, n);
}

export async function getTopFocusPoint() {
  const top = await getTopFocusPoints(1);
  return top[0] || null;
}

export async function getTopFocusPointsWithCounts(n = 3) {
  const userId = await getUserId();
  const [points, sessions] = await Promise.all([
    getFocusPoints(),
    supabase
      .from('training_sessions')
      .select('slot1_focus_id, slot2_focus_id')
      .eq('user_id', userId)
      .not('completed_at', 'is', null)
      .then(({ data }) => data || []),
  ]);

  const counts = {};
  for (const s of sessions) {
    if (s.slot1_focus_id) counts[s.slot1_focus_id] = (counts[s.slot1_focus_id] || 0) + 1;
    if (s.slot2_focus_id) counts[s.slot2_focus_id] = (counts[s.slot2_focus_id] || 0) + 1;
  }

  return [...points]
    .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0))
    .slice(0, n)
    .map(p => ({ ...p, count: counts[p.id] || 0 }));
}

export async function saveSessionCompletion(focusPointId) {
  await saveFocusProgress({
    focus_point_id: focusPointId,
    class_input_id: null,
    priority_score: -5,
    completed: true,
  });
}

// ─── Notes ───────────────────────────────────────────────────────────────────

export async function getNotes() {
  const userId = await getUserId();
  const { data } = await supabase
    .from('notes')
    .select('*')
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false });
  return data || [];
}

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
      return id;
    }
  }

  const { data } = await supabase
    .from('notes')
    .insert({ ...rest, user_id: userId })
    .select('id')
    .single();
  return data?.id;
}

export async function deleteNote(id) {
  await supabase
    .from('notes')
    .update({ is_deleted: true })
    .eq('id', id);
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
