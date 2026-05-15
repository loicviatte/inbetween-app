import { supabase } from '../services/supabase/client';
import { computeAllStudentMetricsBatch } from '../utils/studentMetrics';
import { categoryFromStyle } from '../utils/danceCategory';
import { normalizeFocusName } from '../utils/normalizeFocusName';
import { getLessonReadiness } from './storage';

async function getCoachId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

// ─── Invite Code ─────────────────────────────────────────────────────────────

function generateInviteCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export async function getOrCreateInviteCode() {
  const coachId = await getCoachId();
  const { data: user } = await supabase
    .from('users')
    .select('invite_code')
    .eq('id', coachId)
    .single();

  if (user?.invite_code) return user.invite_code;

  // Generate a unique code
  let code;
  let attempts = 0;
  while (attempts < 10) {
    code = generateInviteCode();
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('invite_code', code)
      .maybeSingle();
    if (!existing) break;
    attempts++;
  }

  await supabase
    .from('users')
    .update({ invite_code: code })
    .eq('id', coachId);

  return code;
}

// ─── Coach Requests ───────────────────────────────────────────────────────────

export async function getPendingCoachRequests() {
  const coachId = await getCoachId();
  const { data } = await supabase
    .from('coach_requests')
    .select('id, student_id, created_at, users!coach_requests_student_id_fkey(name, dance_style)')
    .eq('coach_id', coachId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  return (data || []).map(r => ({
    id: r.id,
    studentId: r.student_id,
    name: r.users?.name || 'Unknown',
    danceStyle: r.users?.dance_style || '',
    createdAt: r.created_at,
  }));
}

export async function respondToCoachRequest(requestId, accept) {
  const coachId = await getCoachId();
  const status = accept ? 'accepted' : 'declined';

  // Update the request status and retrieve category + student_id
  const { data: req } = await supabase
    .from('coach_requests')
    .update({ status })
    .eq('id', requestId)
    .eq('coach_id', coachId)
    .select('student_id, category')
    .single();

  if (!req?.student_id) return;

  // Determine which coach column(s) to write.
  // category === null means general/no-style-split → set both columns.
  const isLatin    = req.category === 'latin';
  const isBallroom = req.category === 'ballroom';
  const isBoth     = !isLatin && !isBallroom; // null or unknown → treat as both

  if (accept) {
    const updates = {};
    if (isLatin  || isBoth) updates.latin_coach_id    = coachId;
    if (isBallroom || isBoth) updates.ballroom_coach_id = coachId;
    await supabase.from('users').update(updates).eq('id', req.student_id);
  } else {
    // Clear only the relevant column(s) if they were pointing to this coach
    if (isLatin || isBoth) {
      await supabase.from('users').update({ latin_coach_id: null })
        .eq('id', req.student_id).eq('latin_coach_id', coachId);
    }
    if (isBallroom || isBoth) {
      await supabase.from('users').update({ ballroom_coach_id: null })
        .eq('id', req.student_id).eq('ballroom_coach_id', coachId);
    }
  }
}

// ─── Students ─────────────────────────────────────────────────────────────────

export async function getMyStudents() {
  const coachId = await getCoachId();

  // The *request* is the source of truth for "this student chose me and I
  // accepted". The users.x_coach_id columns are only set by the client on
  // accept, and RLS forbids the coach from patching them after the fact —
  // so if they drift (wrong column / null), we must still find the student.
  //
  // Filter by category to match the coach's own dance_style:
  // - coach 'Latin'    → accepted requests with category = 'latin'
  // - coach 'Ballroom' → accepted requests with category = 'ballroom'
  // - coach dual/null  → any accepted request
  const { data: me } = await supabase
    .from('users')
    .select('dance_style')
    .eq('id', coachId)
    .maybeSingle();

  const ds = (me?.dance_style || '').toLowerCase();
  const isLatin = ds === 'latin';
  const isBallroom = ds === 'ballroom' || ds === 'standard';

  // Step 1 — fetch accepted requests. Filter by category in JS to match the
  // coach's dance_style (avoids PostgREST .or()+.is.null parsing quirks).
  const { data: acceptedReqs } = await supabase
    .from('coach_requests')
    .select('student_id, category')
    .eq('coach_id', coachId)
    .eq('status', 'accepted');

  const wantedReqs = (acceptedReqs || []).filter((r) => {
    if (isLatin) return r.category === 'latin' || r.category == null;
    if (isBallroom) return r.category === 'ballroom' || r.category == null;
    return true;
  });

  const wantedIds = [...new Set(wantedReqs.map((r) => r.student_id).filter(Boolean))];
  if (wantedIds.length === 0) return [];

  // Step 2 — fetch the actual user rows for those students (separate query
  // instead of FK embed, which can get silently dropped by RLS).
  const { data: userRows } = await supabase
    .from('users')
    .select('id, name, dance_style, last_active_date, avatar_url')
    .in('id', wantedIds);

  const byId = new Map();
  for (const u of userRows || []) {
    if (u?.id) byId.set(u.id, { ...u, photo_url: u.avatar_url || null });
  }

  const students = Array.from(byId.values());
  if (students.length === 0) return [];

  const studentIds = students.map(s => s.id);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  // Parallel batch queries — includes all practice_logs for metrics (replaces
  // the old per-student getAllStudentMetrics N+1 pattern).
  const [
    { data: pendingMessages },
    { data: pendingFPs },
    { data: allFocuses },
    { data: recentLogs },
    { data: allClasses },
    { data: allLogs },
  ] = await Promise.all([
    supabase
      .from('coach_messages')
      .select('student_id')
      .eq('coach_id', coachId)
      .eq('status', 'pending')
      .in('student_id', studentIds),
    supabase
      .from('focus_points')
      .select('user_id')
      .eq('status', 'pending_coach')
      .eq('is_other', false)
      .in('user_id', studentIds),
    supabase
      .from('focus_points')
      .select('id, name, user_id, status, tier, merge_action, dance')
      .in('user_id', studentIds)
      .eq('is_deleted', false)
      .eq('is_other', false),
    supabase
      .from('practice_logs')
      .select('student_id, focus_point_id, started_at')
      .in('student_id', studentIds)
      .not('completed_at', 'is', null)
      .gte('started_at', sevenDaysAgo),
    supabase
      .from('class_inputs')
      .select('user_id, student_id, created_at, lesson_type')
      .or(`user_id.in.(${studentIds.join(',')}),student_id.in.(${studentIds.join(',')})`)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false }),
    supabase
      .from('practice_logs')
      // `started_at` + `completed_at` are needed by the status computation
      // below (distinct focus points practiced since last private class —
      // filters on completed_at existing + started_at >= cutoff). `created_at`
      // drives the regularity math in computeAllStudentMetricsBatch.
      .select('student_id, focus_point_id, created_at, started_at, completed_at')
      .in('student_id', studentIds)
      .order('created_at', { ascending: true }),
  ]);

  // Pending questions per student
  const questionCountByStudent = {};
  for (const m of pendingMessages || []) {
    questionCountByStudent[m.student_id] =
      (questionCountByStudent[m.student_id] || 0) + 1;
  }
  const pendingReviewStudents = new Set((pendingFPs || []).map(v => v.user_id));

  const activeFocuses = (allFocuses || []).filter(f => f.status === 'active');
  const activeFocusCountByStudent = {};
  for (const f of activeFocuses) {
    activeFocusCountByStudent[f.user_id] =
      (activeFocusCountByStudent[f.user_id] || 0) + 1;
  }

  // Last practice timestamp per student — use the full logs set (allLogs is
  // ordered by started_at asc, so the last entry per student is the most recent).
  const lastPracticeByStudent = {};
  for (const l of allLogs || []) {
    if (l.completed_at) {
      lastPracticeByStudent[l.student_id] = l.started_at;
    }
  }

  // Most recent class (any type) and most recent PRIVATE class per student.
  // A class can reference a student via user_id (student-logged) or
  // student_id (coach-logged / attendance-confirmed).
  const studentIdSet = new Set(studentIds);
  const lastClassByStudent = {};
  const lastPrivateClassByStudent = {};
  for (const c of allClasses || []) {
    const sid = studentIdSet.has(c.user_id) ? c.user_id
              : studentIdSet.has(c.student_id) ? c.student_id
              : null;
    if (!sid) continue;
    if (!lastClassByStudent[sid]) lastClassByStudent[sid] = c.created_at;
    if (
      (c.lesson_type === 'private' || !c.lesson_type) &&
      !lastPrivateClassByStudent[sid]
    ) {
      lastPrivateClassByStudent[sid] = c.created_at;
    }
  }

  function daysSince(iso) {
    if (!iso) return null;
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  }

  // Distinct focus points practiced since last private class, per student.
  const distinctFPSincePrivate = {};
  for (const id of studentIds) {
    const cutoff = lastPrivateClassByStudent[id] || null;
    const focusSet = new Set();
    for (const l of allLogs || []) {
      if (l.student_id !== id || !l.completed_at || !l.focus_point_id) continue;
      if (cutoff && l.started_at < cutoff) continue;
      focusSet.add(l.focus_point_id);
    }
    distinctFPSincePrivate[id] = focusSet.size;
  }

  // Compute the shared Retention / Motivation / Health metrics for every
  // student in a single pass using pre-fetched data (no extra DB calls).
  // Filter to the coach's own dance category so a Latin coach only sees Latin
  // metrics (and vice versa). Dual-style coaches get unfiltered totals.
  const coachCategory = categoryFromStyle(me?.dance_style);
  const metricsByStudent = computeAllStudentMetricsBatch(studentIds, allFocuses, allLogs, coachCategory);

  return students
    .map(s => {
      const pendingQuestions = questionCountByStudent[s.id] || 0;
      const activeFocusCount = activeFocusCountByStudent[s.id] || 0;
      const needsReview = pendingReviewStudents.has(s.id);

      const lastPracticeIso =
        lastPracticeByStudent[s.id] || s.last_active_date || null;
      const daysSincePractice = daysSince(lastPracticeIso);
      const lastClassIso = lastClassByStudent[s.id] || null;
      const lastPrivateClassIso = lastPrivateClassByStudent[s.id] || null;
      const lastPrivateDays = daysSince(lastPrivateClassIso);

      // How many distinct focus points practiced since last private class
      const fpSincePrivate = distinctFPSincePrivate[s.id] || 0;

      // Status based on practice since last private class:
      //   on_track  → practiced >= 2 distinct focus points
      //   attention → practiced exactly 1 focus point ("in progress")
      //   silent    → practiced 0 focus points
      let status = 'on_track';
      if (fpSincePrivate === 0) {
        status = 'silent';
      } else if (fpSincePrivate === 1) {
        status = 'attention';
      }

      // Shared Progression / Retention / Global metrics (identical source
      // as the student detail hero gauges). All three are on a 0-100 scale
      // where 100 = good.
      const m = metricsByStudent[s.id] || { progression: 0, retention: 100, global: 0 };
      const progression = m.progression;
      const retention = m.retention;
      const global = m.global;

      // Primary alert
      let alert = null;
      if (pendingQuestions > 0) {
        alert = {
          kind: 'question',
          text: `${pendingQuestions} pending question${pendingQuestions > 1 ? 's' : ''}`,
        };
      } else if (needsReview) {
        alert = {
          kind: 'review',
          text: 'New focus points to review',
        };
      } else if (status === 'silent') {
        const label = lastPrivateClassIso
          ? `No practice since last class`
          : 'No practice yet';
        alert = { kind: 'inactive', text: label };
      } else if (status === 'attention') {
        alert = { kind: 'in_progress', text: `1 focus practiced — keep going` };
      }

      return {
        id: s.id,
        name: s.name || 'Student',
        danceStyle: s.dance_style || '',
        photoUrl: s.avatar_url || null,
        lastActiveDate: lastPracticeIso,
        daysSincePractice,
        lastClassDate: lastClassIso,
        lastPrivateClassDate: lastPrivateClassIso,
        lastPrivateDays,
        pendingQuestions,
        fpSincePrivate,
        activeFocuses: activeFocusCount,
        needsReview,
        status,
        // `health` kept for any legacy consumer that reads it; mirrors global.
        health: global,
        global,
        progression,
        retention,
        alert,
      };
    })
    .sort((a, b) => {
      // Order: silent → attention → on_track, then lowest health first
      const order = { silent: 0, attention: 1, on_track: 2 };
      if (a.status !== b.status) return (order[a.status] ?? 3) - (order[b.status] ?? 3);
      return a.health - b.health;
    });
}

// ─── Student Detail ───────────────────────────────────────────────────────────

export async function getStudentProfile(studentId) {
  const { data } = await supabase
    .from('users')
    .select('id, name, dance_style, last_active_date, avatar_url, studio:studios!users_studio_id_fkey(id, name)')
    .eq('id', studentId)
    .single();
  if (!data) return null;
  return { ...data, photo_url: data.avatar_url || null };
}

export async function getStudentFocusPoints(studentId) {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  // Get active focus points (pending_coach removed — FPs go direct to student)
  const { data: focusPoints } = await supabase
    .from('focus_points')
    .select('id, name, subtitle, drill, created_at, status, tier')
    .eq('user_id', studentId)
    .eq('is_deleted', false)
    .eq('is_other', false)
    .in('status', ['active', 'past_candidate'])
    .order('created_at', { ascending: true });

  if (!focusPoints || focusPoints.length === 0) return [];

  // Count practice_logs this week for each focus + capture latest log details
  const focusIds = focusPoints.map(f => f.id);
  const { data: logs } = await supabase
    .from('practice_logs')
    .select('focus_point_id, duration_minutes, feeling, created_at, started_at, completed_at')
    .eq('student_id', studentId)
    .gte('created_at', weekAgo)
    .in('focus_point_id', focusIds)
    .order('created_at', { ascending: false });

  const weekCounts = {};
  const totalDuration = {};
  const lastLogByFocus = {};
  for (const l of logs || []) {
    weekCounts[l.focus_point_id] = (weekCounts[l.focus_point_id] || 0) + 1;
    totalDuration[l.focus_point_id] =
      (totalDuration[l.focus_point_id] || 0) + (l.duration_minutes || 0);
    if (!lastLogByFocus[l.focus_point_id]) {
      lastLogByFocus[l.focus_point_id] = l; // first = most recent (desc order)
    }
  }

  return focusPoints.map(f => ({
    id: f.id,
    name: f.name,
    subtitle: f.subtitle || null,
    drill: f.drill || null,
    weekCount: weekCounts[f.id] || 0,
    totalDurationMin: totalDuration[f.id] || 0,
    lastFeeling: lastLogByFocus[f.id]?.feeling || null,
    lastPracticedAt: lastLogByFocus[f.id]?.created_at || null,
    status: f.status,
    tier: f.tier || null,
  }));
}

export async function updateFocusPoint(focusPointId, updates) {
  await supabase
    .from('focus_points')
    .update(updates)
    .eq('id', focusPointId);
}

// Returns up to 5 candidate focus points for a group-class theme suggestion,
// ranked by how many of the coach's students currently share them.
// Looks at active focus points mentioned since the coach's last group class
// (falls back to the last 30 days if the coach has never taught one).
//
// Shape: { candidates: [{ key, name, count, studentIds }], lastGroupDate, cutoffIso }
export async function getGroupClassThemeCandidates(studentIds) {
  if (!studentIds || studentIds.length === 0) {
    return { candidates: [], lastGroupDate: null, cutoffIso: null };
  }

  const [coachId, coachName] = await Promise.all([
    getCoachId().catch(() => null),
    getCoachName(),
  ]);

  // 1. Find the coach's last group class (matched by coach-created user_id
  //    OR student-logged teacher_name).
  const { data: groupClasses } = await supabase
    .from('class_inputs')
    .select('created_at, user_id, teacher_name, lesson_type')
    .eq('lesson_type', 'group')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(30);

  const lc = coachName ? coachName.trim().toLowerCase() : null;
  const lastGroup = (groupClasses || []).find(
    (c) =>
      (coachId && c.user_id === coachId) ||
      (lc && (c.teacher_name || '').trim().toLowerCase() === lc)
  );

  // Fallback window: last 30 days.
  const cutoffIso =
    lastGroup?.created_at ?? new Date(Date.now() - 30 * 86400000).toISOString();

  // 2. All active focus points across these students.
  const { data: fps } = await supabase
    .from('focus_points')
    .select('id, user_id, name, normalized_name, tier, last_mentioned_at, created_at')
    .in('user_id', studentIds)
    .eq('status', 'active')
    .eq('is_deleted', false)
    .eq('is_other', false);

  // 3. Keep only those touched/created since the cutoff.
  const recent = (fps || []).filter((f) => {
    const when = f.last_mentioned_at || f.created_at;
    return !when || when >= cutoffIso;
  });

  // 4. Aggregate by normalized name — count DISTINCT students per theme.
  const byName = {};
  for (const f of recent) {
    const key = f.normalized_name || (f.name || '').toLowerCase();
    if (!key) continue;
    if (!byName[key]) byName[key] = { name: f.name, studentIds: new Set() };
    byName[key].studentIds.add(f.user_id);
  }

  const candidates = Object.entries(byName)
    .map(([k, v]) => ({
      key: k,
      name: v.name,
      count: v.studentIds.size,
      studentIds: [...v.studentIds],
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { candidates, lastGroupDate: lastGroup?.created_at ?? null, cutoffIso };
}

// Look up the logged-in coach's display name (used for teacher matching).
async function getCoachName() {
  const coachId = await getCoachId().catch(() => null);
  if (!coachId) return null;
  const { data } = await supabase
    .from('users')
    .select('name')
    .eq('id', coachId)
    .maybeSingle();
  return data?.name || null;
}

// Returns the ISO timestamp of the most recent PRIVATE lesson for this
// student *taught by the current coach* (matched by teacher_name).
// Falls back to the most recent private lesson of any teacher if the coach
// has never been credited.
export async function getStudentLastClassDate(studentId) {
  const [coachId, coachName] = await Promise.all([
    getCoachId().catch(() => null),
    getCoachName(),
  ]);
  const { data: classes } = await supabase
    .from('class_inputs')
    .select('created_at, user_id, student_id, teacher_name, lesson_type')
    .or(`user_id.eq.${studentId},student_id.eq.${studentId}`)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(30);

  if (!classes || classes.length === 0) return null;

  // Only private lessons count (lesson_type 'private' or legacy null)
  const privateLessons = classes.filter(
    (c) => c.lesson_type === 'private' || c.lesson_type == null
  );
  if (privateLessons.length === 0) return null;

  const lc = coachName ? coachName.trim().toLowerCase() : null;
  const mine = privateLessons.find((c) => {
    // Coach-created class: user_id is the coach
    if (coachId && c.user_id === coachId) return true;
    // Student-created class: teacher_name matches coach name
    if (lc && (c.teacher_name || '').trim().toLowerCase() === lc) return true;
    return false;
  });
  if (mine) return mine.created_at;

  return privateLessons[0]?.created_at || null;
}

export async function getStudentRecentActivity(studentId, limit = 20) {
  const coachId = await getCoachId().catch(() => null);
  const [{ data: sessions }, { data: classes }, coachName] = await Promise.all([
    supabase
      .from('practice_logs')
      .select('id, started_at, completed_at, focus_point_id')
      .eq('student_id', studentId)
      .not('completed_at', 'is', null)
      .order('started_at', { ascending: false })
      .limit(limit),
    supabase
      .from('class_inputs')
      .select('id, user_id, student_id, created_at, title, dance, teacher_name, class_summary, lesson_type, focus_points!focus_points_class_input_id_fkey(id, name, is_other, is_deleted, status)')
      .or(`user_id.eq.${studentId},student_id.eq.${studentId}`)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(limit),
    getCoachName(),
  ]);

  // Fetch focus point names in a single batch
  const focusIds = [...new Set((sessions || []).map(s => s.focus_point_id).filter(Boolean))];
  let focusMap = {};
  if (focusIds.length > 0) {
    const { data: fps } = await supabase
      .from('focus_points')
      .select('id, name')
      .in('id', focusIds);
    focusMap = Object.fromEntries((fps || []).map(f => [f.id, f.name]));
  }

  const lcCoach = coachName ? coachName.trim().toLowerCase() : null;

  const events = [
    ...(sessions || []).map(s => ({
      id: s.id,
      type: 'training',
      date: new Date(s.started_at),
      durationMin: s.completed_at
        ? Math.round((new Date(s.completed_at) - new Date(s.started_at)) / 60000)
        : null,
      focusPointId: s.focus_point_id || null,
      focusName: s.focus_point_id ? focusMap[s.focus_point_id] || null : null,
    })),
    ...(classes || []).map(c => {
      const teacher = c.teacher_name || null;
      // Coach-created class: user_id is the coach, student_id is the student.
      // Student-created class: user_id is the student, teacher_name matches coach name.
      const coachCreated = !!coachId && c.user_id === coachId;
      const nameMatches = !!lcCoach && !!teacher && teacher.trim().toLowerCase() === lcCoach;
      const withCurrentCoach = coachCreated || nameMatches;
      return {
        id: c.id,
        type: 'class',
        date: new Date(c.created_at),
        durationMin: null,
        title: c.title || null,
        dance: c.dance || null,
        teacherName: teacher,
        withCurrentCoach,
        classSummary: c.class_summary || null,
        lessonType: c.lesson_type || null,
        focusPoints: (c.focus_points || [])
          .filter(fp => !fp.is_other && !fp.is_deleted && fp.status !== 'past')
          .map(fp => ({ id: fp.id, name: fp.name })),
      };
    }),
  ];

  return events
    .sort((a, b) => b.date - a.date)
    .slice(0, limit);
}

export async function getStudentQuestions(studentId) {
  const coachId = await getCoachId();
  const { data } = await supabase
    .from('coach_messages')
    .select('id, message, created_at')
    .eq('student_id', studentId)
    .eq('coach_id', coachId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  return data || [];
}


export async function getStudentArchivedFocusPoints(studentId) {
  const { data } = await supabase
    .from('focus_points')
    .select('id, name')
    .eq('user_id', studentId)
    .eq('is_deleted', false)
    .eq('is_archived', true)
    .order('created_at', { ascending: false })
    .limit(10);
  return data || [];
}

// ─── Coach Actions ────────────────────────────────────────────────────────────

export async function replyToQuestion(messageId, replyText) {
  await supabase
    .from('coach_messages')
    .update({
      reply: replyText,
      status: 'replied',
      replied_at: new Date().toISOString(),
    })
    .eq('id', messageId);
}

export async function dismissQuestion(messageId) {
  await supabase
    .from('coach_messages')
    .update({ status: 'dismissed' })
    .eq('id', messageId);
}


// ─── Session / Class Detail ───────────────────────────────────────────────────

export async function getTrainingSessionDetail(sessionId) {
  const { data: session } = await supabase
    .from('practice_logs')
    .select('id, started_at, completed_at, feeling, session_note, focus_point_id')
    .eq('id', sessionId)
    .single();

  if (!session) return null;

  let focusName = null;
  if (session.focus_point_id) {
    const { data: fp } = await supabase
      .from('focus_points')
      .select('name')
      .eq('id', session.focus_point_id)
      .single();
    focusName = fp?.name || null;
  }

  return {
    ...session,
    durationMin: session.completed_at
      ? Math.round((new Date(session.completed_at) - new Date(session.started_at)) / 60000)
      : null,
    focus1Name: focusName,
    focus2Name: null,
  };
}

export async function getClassDetail(classId) {
  const { data } = await supabase
    .from('class_inputs')
    .select('id, created_at, title, class_summary, practice_point_1, practice_point_2, ai_primary_focus, ai_secondary_focus')
    .eq('id', classId)
    .single();
  return data || null;
}

// ─── Focus Point Validation ───────────────────────────────────────────────────

export async function getPendingFocusPoints(studentId) {
  const selectStr =
    'id, name, subtitle, context, drill, tier, coach_review_deadline, group_fp, source_class_input_id, created_at, user_id, ' +
    'source_class_input:source_class_input_id(class_summary, practice_point_1, practice_point_2, ai_primary_focus, ai_secondary_focus)';

  if (studentId) {
    const { data, error } = await supabase
      .from('focus_points')
      .select(selectStr)
      .eq('user_id', studentId)
      .eq('status', 'pending_coach')
      .eq('is_other', false)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  // No studentId — load all pending FPs for all coach's students
  const coachId = await getCoachId();
  const { data: requests } = await supabase
    .from('coach_requests')
    .select('student_id')
    .eq('coach_id', coachId)
    .eq('status', 'accepted');
  const studentIds = (requests ?? []).map(r => r.student_id);
  if (studentIds.length === 0) return [];

  const { data, error } = await supabase
    .from('focus_points')
    .select(selectStr)
    .in('user_id', studentIds)
    .eq('status', 'pending_coach')
    .eq('is_other', false)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getPendingFocusPointsCount() {
  const coachId = await getCoachId();
  // Get all student IDs for this coach
  const { data: requests } = await supabase
    .from('coach_requests')
    .select('student_id')
    .eq('coach_id', coachId)
    .eq('status', 'accepted');
  const studentIds = (requests ?? []).map(r => r.student_id);
  if (studentIds.length === 0) return 0;
  const { count } = await supabase
    .from('focus_points')
    .select('id', { count: 'exact' })
    .eq('status', 'pending_coach')
    .eq('is_other', false)
    .eq('is_deleted', false)
    .in('user_id', studentIds);
  return count ?? 0;
}

export async function approveFocusPoint(fpId) {
  // Capture the student before mutating so we can clear related coach notifs.
  const { data: fpRow } = await supabase
    .from('focus_points')
    .select('user_id')
    .eq('id', fpId)
    .maybeSingle();
  const { error } = await supabase
    .from('focus_points')
    .update({ status: 'active', coach_review_deadline: null })
    .eq('id', fpId);
  if (error) throw error;
  // Coach has acted on the pending FPs for this student → clear any
  // unread "focus_points_added" notifications targeting this student so
  // the bell badge in the dashboard goes back down.
  await markFocusAddedNotificationsReadForStudent(fpRow?.user_id).catch(() => {});
}

async function markFocusAddedNotificationsReadForStudent(studentId) {
  if (!studentId) return;
  const coachId = await getCoachId().catch(() => null);
  if (!coachId) return;
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', coachId)
    .eq('type', 'focus_points_added')
    .eq('read', false)
    .contains('data', { student_id: studentId });
}

export async function editAndApproveFocusPoint(fpId, updates) {
  const allowed = ['name', 'subtitle', 'context', 'drill', 'tier'];
  const filtered = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)));
  // Keep normalized_name in sync whenever the human-facing name changes.
  // Missing this step is what caused duplicate "Hip Settlement" focus points
  // (name edited post-insert, normalized_name left stale — next AI match
  // failed and inserted a new row).
  if (Object.prototype.hasOwnProperty.call(filtered, 'name')) {
    filtered.normalized_name = normalizeFocusName(filtered.name);
  }
  const { data: fpRow } = await supabase
    .from('focus_points')
    .select('user_id')
    .eq('id', fpId)
    .maybeSingle();
  const { error } = await supabase
    .from('focus_points')
    .update({ ...filtered, status: 'active', coach_review_deadline: null })
    .eq('id', fpId);
  if (error) throw error;
  await markFocusAddedNotificationsReadForStudent(fpRow?.user_id).catch(() => {});
}

export async function deletePendingFocusPoint(fpId) {
  const { data: fpRow } = await supabase
    .from('focus_points')
    .select('user_id')
    .eq('id', fpId)
    .maybeSingle();
  const { error } = await supabase
    .from('focus_points')
    .update({ is_deleted: true, status: 'past' })
    .eq('id', fpId);
  if (error) throw error;
  await markFocusAddedNotificationsReadForStudent(fpRow?.user_id).catch(() => {});
}

export async function rejectPendingFocusPoint({ fpId, studentId, fpName, reason }) {
  const { error } = await supabase
    .from('focus_points')
    .update({ is_deleted: true, status: 'past' })
    .eq('id', fpId);
  if (error) throw error;
  await markFocusAddedNotificationsReadForStudent(studentId).catch(() => {});

  const trimmedReason = (reason || '').trim();
  const { error: notifErr } = await supabase.from('notifications').insert({
    user_id: studentId,
    type: 'focus_point_rejected',
    title: 'Focus point declined by your coach',
    body: trimmedReason
      ? `"${fpName}" — ${trimmedReason}`
      : `Your coach declined "${fpName}".`,
    data: { focus_point_name: fpName, reason: trimmedReason || null },
  });
  if (notifErr) {
    console.warn('[rejectPendingFocusPoint] notification insert failed:', notifErr.message);
  }
}

export async function approveAllPendingForStudent(studentId) {
  const { error } = await supabase
    .from('focus_points')
    .update({ status: 'active', coach_review_deadline: null })
    .eq('user_id', studentId)
    .eq('status', 'pending_coach')
    .eq('is_deleted', false);
  if (error) throw error;
  await markFocusAddedNotificationsReadForStudent(studentId).catch(() => {});
}

export async function autoPublishExpiredFPs() {
  try {
    const coachId = await getCoachId();
    const { data: requests } = await supabase
      .from('coach_requests')
      .select('student_id')
      .eq('coach_id', coachId)
      .eq('status', 'accepted');
    const studentIds = (requests ?? []).map(r => r.student_id);
    if (studentIds.length === 0) return;

    const now = new Date().toISOString();
    const { data: expired } = await supabase
      .from('focus_points')
      .select('id, user_id, group_fp, source_class_input_id')
      .eq('status', 'pending_coach')
      .eq('is_deleted', false)
      .lte('coach_review_deadline', now)
      .in('user_id', studentIds);

    for (const fp of expired ?? []) {
      if (fp.group_fp && fp.source_class_input_id) {
        const { data: cis } = await supabase
          .from('class_input_students')
          .select('student_id, attendance')
          .eq('class_input_id', fp.source_class_input_id);
        const excluded = new Set((cis ?? []).filter(r => r.attendance === 'no').map(r => r.student_id));
        if (excluded.has(fp.user_id)) {
          await supabase.from('focus_points').update({ is_deleted: true, status: 'past' }).eq('id', fp.id);
        } else {
          await supabase.from('focus_points').update({ status: 'active', coach_review_deadline: null }).eq('id', fp.id);
        }
      } else {
        await supabase.from('focus_points').update({ status: 'active', coach_review_deadline: null }).eq('id', fp.id);
      }
    }
  } catch (err) {
    console.error('[autoPublishExpiredFPs]', err);
  }
}

// ─── Activity Feed ────────────────────────────────────────────────────────────

export async function getCoachActivityFeed() {
  const coachId = await getCoachId();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

  // Get all accepted students via coach_requests
  const { data: requests } = await supabase
    .from('coach_requests')
    .select('student_id, users!coach_requests_student_id_fkey(id, name)')
    .eq('coach_id', coachId)
    .eq('status', 'accepted');

  if (!requests || requests.length === 0) return [];

  const students = (requests || []).map(r => r.users).filter(Boolean);
  const studentIds = students.map(s => s.id);
  const studentMap = Object.fromEntries(students.map(s => [s.id, s.name]));

  // Fetch ALL class_inputs to compute last class per student (and as class events).
  // We cap the window wide enough (60 days) to handle stale fallback correctly.
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();
  const { data: allClasses } = await supabase
    .from('class_inputs')
    .select('id, user_id, student_id, created_at, title, dance, class_summary, lesson_type, focus_points!focus_points_class_input_id_fkey(id, name, status)')
    .or(`user_id.in.(${studentIds.join(',')}),student_id.in.(${studentIds.join(',')})`)
    .eq('is_deleted', false)
    .gte('created_at', sixtyDaysAgo)
    .order('created_at', { ascending: false })
    .limit(100);

  // Per-student: most recent class date (resolve student from user_id or student_id)
  const feedStudentIdSet = new Set(studentIds);
  const lastClassByStudent = {};
  for (const c of allClasses || []) {
    const sid = feedStudentIdSet.has(c.user_id) ? c.user_id
              : feedStudentIdSet.has(c.student_id) ? c.student_id
              : null;
    if (sid && !lastClassByStudent[sid]) lastClassByStudent[sid] = c.created_at;
  }

  // Query floor: earliest "last class" across all students, or 14 days ago if none.
  const lastClassValues = Object.values(lastClassByStudent);
  const earliestLastClass = lastClassValues.length > 0
    ? lastClassValues.reduce((min, d) => (d < min ? d : min))
    : null;
  const queryFloor =
    earliestLastClass && earliestLastClass < fourteenDaysAgo
      ? earliestLastClass
      : fourteenDaysAgo;

  const [{ data: sessions }, { data: messages }] = await Promise.all([
    supabase
      .from('practice_logs')
      .select('id, student_id, started_at, completed_at, focus_point_id')
      .in('student_id', studentIds)
      .not('completed_at', 'is', null)
      .gte('started_at', queryFloor)
      .order('started_at', { ascending: false })
      .limit(60),
    supabase
      .from('coach_messages')
      .select('id, student_id, created_at')
      .eq('coach_id', coachId)
      .eq('status', 'pending')
      .in('student_id', studentIds)
      .gte('created_at', queryFloor)
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  // Batch-load focus point names for all referenced focus_point_ids
  const focusIds = [...new Set((sessions || []).map(s => s.focus_point_id).filter(Boolean))];
  let focusMap = {};
  if (focusIds.length > 0) {
    const { data: fps } = await supabase
      .from('focus_points')
      .select('id, name')
      .in('id', focusIds);
    focusMap = Object.fromEntries((fps || []).map(f => [f.id, f.name]));
  }

  const events = [
    ...(sessions || []).map(s => ({
      id: s.id,
      studentId: s.student_id,
      studentName: studentMap[s.student_id] || 'Student',
      type: 'training',
      date: new Date(s.started_at),
      durationMin: s.completed_at
        ? Math.round((new Date(s.completed_at) - new Date(s.started_at)) / 60000)
        : null,
      focusPointId: s.focus_point_id || null,
      focusName: s.focus_point_id ? focusMap[s.focus_point_id] || null : null,
    })),
    ...(allClasses || []).map(c => {
      const sid = feedStudentIdSet.has(c.user_id) ? c.user_id
                : feedStudentIdSet.has(c.student_id) ? c.student_id
                : c.user_id;
      return {
        id: c.id,
        studentId: sid,
        studentName: studentMap[sid] || 'Student',
        type: 'class',
        date: new Date(c.created_at),
        durationMin: null,
        title: c.title || null,
        dance: c.dance || null,
        classSummary: c.class_summary || null,
        lessonType: c.lesson_type || null,
        focusPoints: (c.focus_points || []).map(fp => fp.name).filter(Boolean),
      };
    }),
    ...(messages || []).map(m => ({
      id: m.id,
      studentId: m.student_id,
      studentName: studentMap[m.student_id] || 'Student',
      type: 'question',
      date: new Date(m.created_at),
      durationMin: null,
    })),
  ];

  // Filter per-student to only events AFTER (or at) that student's last class.
  // If a student has no class yet, fall back to the 14-day window.
  const fourteenDaysAgoMs = new Date(fourteenDaysAgo).getTime();
  const filtered = events.filter((e) => {
    const lc = lastClassByStudent[e.studentId];
    const ts = e.date.getTime();
    if (!lc) return ts >= fourteenDaysAgoMs;
    // Keep the class event itself and everything after it.
    return ts >= new Date(lc).getTime();
  });

  return filtered.sort((a, b) => b.date - a.date);
}

// ─── Coach Notes ─────────────────────────────────────────────────────────────
//
// Notes authored by the coach. Re-uses the existing `notes` table (created
// for students) but adds the `linked_student_id` and `linked_class_input_id`
// columns so a note can be attached to a student and/or a class.

export async function getCoachNotes() {
  const coachId = await getCoachId();
  const { data: notes } = await supabase
    .from('notes')
    .select('id, title, content, video_clips, linked_student_id, linked_class_input_id, created_at, updated_at')
    .eq('user_id', coachId)
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false });

  if (!notes || notes.length === 0) return [];

  const studentIds = [...new Set(notes.map(n => n.linked_student_id).filter(Boolean))];
  let studentMap = {};
  if (studentIds.length > 0) {
    const { data: students } = await supabase
      .from('users')
      .select('id, name, avatar_url')
      .in('id', studentIds);
    (students || []).forEach(s => {
      studentMap[s.id] = { id: s.id, name: s.name, photoUrl: s.avatar_url };
    });
  }

  const classIds = [...new Set(notes.map(n => n.linked_class_input_id).filter(Boolean))];
  let classMap = {};
  if (classIds.length > 0) {
    const { data: classes } = await supabase
      .from('class_inputs')
      .select('id, title, ai_primary_focus, lesson_type, created_at')
      .in('id', classIds);
    (classes || []).forEach(c => {
      classMap[c.id] = {
        id: c.id,
        title: c.title || c.ai_primary_focus || 'Class',
        lessonType: c.lesson_type || null,
        createdAt: c.created_at,
      };
    });
  }

  return notes.map(n => ({
    ...n,
    linkedStudent: n.linked_student_id ? studentMap[n.linked_student_id] || null : null,
    linkedClass: n.linked_class_input_id ? classMap[n.linked_class_input_id] || null : null,
  }));
}

export async function getCoachNoteById(id) {
  const { data } = await supabase
    .from('notes')
    .select('*')
    .eq('id', id)
    .single();
  if (!data) return null;
  if (data.linked_student_id) {
    const { data: student } = await supabase
      .from('users')
      .select('id, name, avatar_url')
      .eq('id', data.linked_student_id)
      .maybeSingle();
    if (student) {
      data.linkedStudent = { id: student.id, name: student.name, photoUrl: student.avatar_url };
    }
  }
  if (data.linked_class_input_id) {
    const { data: cls } = await supabase
      .from('class_inputs')
      .select('id, title, ai_primary_focus, lesson_type, created_at')
      .eq('id', data.linked_class_input_id)
      .maybeSingle();
    if (cls) {
      data.linkedClass = {
        id: cls.id,
        title: cls.title || cls.ai_primary_focus || 'Class',
        lessonType: cls.lesson_type || null,
        createdAt: cls.created_at,
      };
    }
  }
  return data;
}

export async function saveCoachNote(note) {
  const coachId = await getCoachId();
  const {
    id,
    user_id,
    created_at,
    linkedStudent,
    linkedClass,
    ...rest
  } = note;

  if (id) {
    const { data: existing } = await supabase
      .from('notes')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (existing) {
      await supabase.from('notes').update(rest).eq('id', id);
      return id;
    }
  }

  const { data } = await supabase
    .from('notes')
    .insert({ ...rest, user_id: coachId })
    .select('id')
    .single();
  return data?.id;
}

export async function deleteCoachNote(id) {
  await supabase.from('notes').update({ is_deleted: true }).eq('id', id);
}

export async function getCoachNotesForStudent(studentId) {
  const coachId = await getCoachId();
  const { data } = await supabase
    .from('notes')
    .select('id, title, content, video_clips, created_at, updated_at')
    .eq('user_id', coachId)
    .eq('linked_student_id', studentId)
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false });
  return data || [];
}

// ─── Coach Classes ───────────────────────────────────────────────────────────

// Total minutes coached, summed across all class_recordings rows that
// belong to this coach's class_inputs. Classes with no recording don't
// contribute. Returns minutes (Number); the UI rounds to hours.
export async function getTotalCoachedMinutes() {
  const coachId = await getCoachId();
  const { data: classes } = await supabase
    .from('class_inputs')
    .select('id')
    .eq('user_id', coachId)
    .eq('is_deleted', false);
  const classIds = (classes || []).map(c => c.id);
  if (classIds.length === 0) return 0;
  const { data: recordings } = await supabase
    .from('class_recordings')
    .select('duration_ms')
    .in('class_input_id', classIds);
  const totalMs = (recordings || []).reduce(
    (sum, r) => sum + (r?.duration_ms || 0),
    0,
  );
  return Math.round(totalMs / 60000);
}

// Roster used by the StartClass landing screen — for each of the coach's
// students, returns the readiness % since their last private and the
// per-focus-point briefing (sessions practiced since that private, or
// staleness in days). Sorted by readiness desc.
//
// "Sessions since" is counted from the student's `lastPrivateClassDate`,
// which is already computed in `getMyStudents` (handles coach-created and
// student-logged classes via teacher_name match). Single batched query
// against `practice_logs`, no N+1.
export async function getStartClassRoster() {
  const students = await getMyStudents();
  if (!students || students.length === 0) {
    return { students: [], lastClassDuration: null };
  }
  const studentIds = students.map(s => s.id);

  // Per-student readiness (same source of truth as the student's own
  // profile/Train screen: focuses from the most recent private with usable
  // focus_points, tier-based targets, capped done counts).
  const readinessPerStudent = await Promise.all(
    students.map(s => getLessonReadiness(s.id).catch(() => null)),
  );

  // Resolve each readiness `lastClassDate` to a class_input_id so we can
  // fetch the duration of the class that actually produced the focuses.
  // (Different from `s.lastPrivateClassDate` when the most recent private
  // hasn't been processed yet — readiness walks back to the latest one
  // that has focuses.)
  const readinessClassDates = readinessPerStudent
    .map(r => r?.lastClassDate)
    .filter(Boolean);
  const classIdByDate = {};
  if (readinessClassDates.length > 0) {
    const { data: classRows } = await supabase
      .from('class_inputs')
      .select('id, user_id, student_id, created_at, lesson_type')
      .or(`student_id.in.(${studentIds.join(',')}),user_id.in.(${studentIds.join(',')})`)
      .eq('is_deleted', false)
      .in('created_at', readinessClassDates);
    for (const c of classRows || []) {
      classIdByDate[c.created_at] = c.id;
    }
  }
  const durationByClass = {};
  const classIds = Object.values(classIdByDate);
  if (classIds.length > 0) {
    const { data: recRows } = await supabase
      .from('class_recordings')
      .select('class_input_id, duration_ms')
      .in('class_input_id', classIds);
    for (const r of recRows || []) {
      if (r?.duration_ms) {
        durationByClass[r.class_input_id] = Math.max(1, Math.round(r.duration_ms / 60000));
      }
    }
  }

  const enriched = students.map((s, idx) => {
    const r = readinessPerStudent[idx];
    const focuses = r?.focuses || [];

    // Days between the readiness class and now — used to flag stale focuses
    // (no progress + a week or more since the class).
    const daysSinceClass = r?.lastClassDate
      ? Math.floor((Date.now() - new Date(r.lastClassDate).getTime()) / 86400000)
      : null;

    const briefings = focuses.map(f => {
      const isStale = f.done === 0 && (daysSinceClass || 0) >= 7;
      return {
        id: f.focusPointId,
        name: f.name,
        tier: f.tier,
        sessionsSince: f.done,
        target: f.target,
        daysSinceLast: null,
        staleDays: isStale ? daysSinceClass : null,
        isStale,
      };
    });

    const classId = r?.lastClassDate ? classIdByDate[r.lastClassDate] : null;
    return {
      id: s.id,
      name: s.name,
      photoUrl: s.photoUrl,
      lastPrivateClassDate: r?.lastClassDate || s.lastPrivateClassDate,
      lastPrivateDurationMin: classId ? durationByClass[classId] || null : null,
      readiness: r?.percent ?? 0,
      briefings,
      status: s.status,
    };
  }).sort((a, b) => b.readiness - a.readiness);

  return { students: enriched };
}

// All classes the current coach has authored, newest first.
export async function getMyClasses() {
  const coachId = await getCoachId();
  const { data } = await supabase
    .from('class_inputs')
    .select('id, created_at, title, dance, lesson_type, status, class_summary, ai_primary_focus, ai_secondary_focus, student_id')
    .eq('user_id', coachId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });

  if (!data || data.length === 0) return [];

  // For private lessons resolve the student name (best effort — RLS lets the
  // coach read their own students).
  const studentIds = [...new Set(data.map(c => c.student_id).filter(Boolean))];
  let studentMap = {};
  if (studentIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, name, avatar_url')
      .in('id', studentIds);
    (users || []).forEach(u => {
      studentMap[u.id] = { id: u.id, name: u.name, photoUrl: u.avatar_url };
    });
  }

  return data.map(c => ({
    ...c,
    student: c.student_id ? studentMap[c.student_id] || null : null,
  }));
}

// Detailed view of a coach's class: summary, the recorded students with
// coach-attested attendance, the student's own response, and any notes the
// coach has linked to this class.
export async function getCoachClassDetail(classId) {
  const coachId = await getCoachId();

  const { data: cls } = await supabase
    .from('class_inputs')
    .select('id, user_id, student_id, created_at, title, dance, lesson_type, status, class_summary, transcript, practice_point_1, practice_point_2, ai_primary_focus, ai_secondary_focus, focus_points!focus_points_class_input_id_fkey(id, name, is_other, status)')
    .eq('id', classId)
    .maybeSingle();
  if (!cls) return null;

  // Class recording (if any) — used for the duration stat in the UI header.
  const { data: recordingRow } = await supabase
    .from('class_recordings')
    .select('duration_ms, started_at, ended_at')
    .eq('class_input_id', classId)
    .maybeSingle();

  // Recorded students for this class (group classes only — private lessons
  // store the single student in class_inputs.student_id).
  const { data: cisRows } = await supabase
    .from('class_input_students')
    .select('id, student_id, attendance, responded_at, notified_at')
    .eq('class_input_id', classId);

  // Student's own self-reported response (yes/no).
  const { data: respRows } = await supabase
    .from('attendance_responses')
    .select('student_id, attended, responded_at')
    .eq('class_input_id', classId);

  const responseByStudent = {};
  (respRows || []).forEach(r => {
    responseByStudent[r.student_id] = {
      attended: r.attended,
      respondedAt: r.responded_at,
    };
  });

  // Resolve student profiles in a single batch.
  const studentIds = [
    ...new Set([
      ...(cisRows || []).map(r => r.student_id),
      cls.student_id,
    ].filter(Boolean)),
  ];
  let userMap = {};
  if (studentIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, name, avatar_url, dance_style')
      .in('id', studentIds);
    (users || []).forEach(u => {
      userMap[u.id] = {
        id: u.id,
        name: u.name || 'Student',
        photoUrl: u.avatar_url || null,
        danceStyle: u.dance_style || null,
      };
    });
  }

  const attendees = (cisRows || [])
    .map(r => {
      const u = userMap[r.student_id] || { id: r.student_id, name: 'Student' };
      return {
        cisId: r.id,
        ...u,
        attendance: r.attendance || 'pending',
        respondedAt: r.responded_at,
        studentResponse: responseByStudent[r.student_id] || null,
      };
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Linked notes — only those authored by the current coach, not deleted.
  const { data: noteRows } = await supabase
    .from('notes')
    .select('id, title, content, video_clips, updated_at, created_at, linked_student_id')
    .eq('linked_class_input_id', classId)
    .eq('user_id', coachId)
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false });

  const linkedNotes = (noteRows || []).map(n => ({
    ...n,
    linkedStudent: n.linked_student_id ? userMap[n.linked_student_id] || null : null,
  }));

  // Counted focus points for this class (excluding "other" / placeholder).
  const focusCount = (cls.focus_points || [])
    .filter(fp => !fp.is_other && fp.status !== 'past')
    .length;

  // Duration: prefer the recorded duration; fall back to start/end diff.
  let durationMin = null;
  if (recordingRow?.duration_ms != null) {
    durationMin = Math.max(1, Math.round(recordingRow.duration_ms / 60000));
  } else if (recordingRow?.started_at && recordingRow?.ended_at) {
    const diff = new Date(recordingRow.ended_at) - new Date(recordingRow.started_at);
    if (diff > 0) durationMin = Math.max(1, Math.round(diff / 60000));
  }

  // Recorded = the class came in via the audio pipeline (transcript present
  // OR a class_recordings row exists for it).
  const recorded = !!cls.transcript || !!recordingRow;

  return {
    class: {
      ...cls,
      student: cls.student_id ? userMap[cls.student_id] || null : null,
      durationMin,
      recorded,
    },
    attendees,
    linkedNotes,
    focusCount,
  };
}

// Coach updates the attendance flag on an existing class_input_students row,
// or inserts a new row if the student wasn't recorded yet.
//
// When the new value is 'no' we mirror the student-side cleanup performed
// by the attendance-response edge function: any focus points assigned to
// this student from this class get soft-deleted. Idempotent — if there
// were no FPs (or none assigned yet), the update is a no-op. The reverse
// path ('no' → 'yes') doesn't try to recreate FPs; the coach is warned
// about that in the UI before they confirm.
export async function setStudentAttendance(classInputId, studentId, attendance) {
  await supabase
    .from('class_input_students')
    .upsert(
      { class_input_id: classInputId, student_id: studentId, attendance },
      { onConflict: 'class_input_id,student_id' },
    );

  if (attendance === 'no') {
    await supabase
      .from('focus_points')
      .update({ is_deleted: true, status: 'past' })
      .eq('source_class_input_id', classInputId)
      .eq('user_id', studentId)
      .eq('is_deleted', false);
  }
}

// Remove a student from the class entirely.
export async function removeStudentFromClass(classInputId, studentId) {
  await supabase
    .from('class_input_students')
    .delete()
    .eq('class_input_id', classInputId)
    .eq('student_id', studentId);
}

// Notes authored by the coach that aren't yet linked to any class — used
// when the coach wants to attach an existing note to a class from the
// class detail screen.
export async function getCoachUnlinkedNotes() {
  const coachId = await getCoachId();
  const { data } = await supabase
    .from('notes')
    .select('id, title, content, updated_at, created_at, linked_student_id')
    .eq('user_id', coachId)
    .eq('is_deleted', false)
    .is('linked_class_input_id', null)
    .order('updated_at', { ascending: false });
  return data || [];
}

export async function linkNoteToClass(noteId, classInputId) {
  await supabase
    .from('notes')
    .update({ linked_class_input_id: classInputId })
    .eq('id', noteId);
}

export async function unlinkNoteFromClass(noteId) {
  await supabase
    .from('notes')
    .update({ linked_class_input_id: null })
    .eq('id', noteId);
}
