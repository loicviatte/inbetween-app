import { supabase } from '../services/supabase/client';
import { getAllStudentMetrics } from '../utils/studentMetrics';

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
    .select('id, name, dance_style, last_active_date')
    .in('id', wantedIds);

  const byId = new Map();
  for (const u of userRows || []) {
    if (u?.id) byId.set(u.id, u);
  }

  const students = Array.from(byId.values());
  if (students.length === 0) return [];

  const studentIds = students.map(s => s.id);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  // Parallel batch queries
  const [
    { data: pendingMessages },
    { data: pendingFPs },
    { data: allFocuses },
    { data: recentLogs },
    { data: allClasses },
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
      .select('id, name, user_id')
      .in('user_id', studentIds)
      .eq('status', 'active')
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
      .select('user_id, created_at, lesson_type')
      .in('user_id', studentIds)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false }),
  ]);

  // Pending questions per student
  const questionCountByStudent = {};
  for (const m of pendingMessages || []) {
    questionCountByStudent[m.student_id] =
      (questionCountByStudent[m.student_id] || 0) + 1;
  }
  const pendingReviewStudents = new Set((pendingFPs || []).map(v => v.user_id));

  // Practice counts per (student, focus) over last 7 days
  const practicedFocusSet = new Set(
    (recentLogs || [])
      .filter(l => l.focus_point_id)
      .map(l => `${l.student_id}:${l.focus_point_id}`)
  );
  // Stuck focuses: active focuses with no practice log in the last 7 days
  const stuckByStudent = {};
  for (const f of allFocuses || []) {
    const key = `${f.user_id}:${f.id}`;
    if (!practicedFocusSet.has(key)) {
      if (!stuckByStudent[f.user_id]) stuckByStudent[f.user_id] = [];
      stuckByStudent[f.user_id].push(f);
    }
  }
  const activeFocusCountByStudent = {};
  for (const f of allFocuses || []) {
    activeFocusCountByStudent[f.user_id] =
      (activeFocusCountByStudent[f.user_id] || 0) + 1;
  }

  // Last practice timestamp per student (any log, including ones older than 7d)
  // We already loaded the recent-7d window; also capture most-recent from it.
  const lastPracticeByStudent = {};
  for (const l of recentLogs || []) {
    if (
      !lastPracticeByStudent[l.student_id] ||
      new Date(l.started_at) > new Date(lastPracticeByStudent[l.student_id])
    ) {
      lastPracticeByStudent[l.student_id] = l.started_at;
    }
  }

  // Most recent class (any type) and most recent PRIVATE class per student
  const lastClassByStudent = {};
  const lastPrivateClassByStudent = {};
  for (const c of allClasses || []) {
    if (!lastClassByStudent[c.user_id]) lastClassByStudent[c.user_id] = c.created_at;
    if (
      (c.lesson_type === 'private' || !c.lesson_type) &&
      !lastPrivateClassByStudent[c.user_id]
    ) {
      lastPrivateClassByStudent[c.user_id] = c.created_at;
    }
  }

  function daysSince(iso) {
    if (!iso) return null;
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  }

  // Compute the shared Retention / Motivation / Health metrics for every
  // student in parallel — this is the SAME source the student detail hero
  // gauges read from, so the ring value matches across all screens.
  const metricsEntries = await Promise.all(
    studentIds.map(async (id) => {
      try {
        return [id, await getAllStudentMetrics(id)];
      } catch {
        return [id, { retention: 0, motivation: 0, health: 0 }];
      }
    })
  );
  const metricsByStudent = Object.fromEntries(metricsEntries);

  return students
    .map(s => {
      const pendingQuestions = questionCountByStudent[s.id] || 0;
      const stuckFocuses = stuckByStudent[s.id] || [];
      const activeFocuses = activeFocusCountByStudent[s.id] || 0;
      const needsReview = pendingReviewStudents.has(s.id);

      const lastPracticeIso =
        lastPracticeByStudent[s.id] || s.last_active_date || null;
      const daysSincePractice = daysSince(lastPracticeIso);
      const lastClassIso = lastClassByStudent[s.id] || null;
      const lastPrivateClassIso = lastPrivateClassByStudent[s.id] || null;
      const lastPrivateDays = daysSince(lastPrivateClassIso);

      // Inactivity threshold (5 days)
      const isInactive =
        daysSincePractice === null || daysSincePractice >= 5;

      // Status — preserved 3-value enum used by Dashboard rings:
      //   question → pending questions (red)
      //   attention → stuck / review / inactive (orange)
      //   on_track → healthy
      // The new Students list groups question + attention together.
      let status = 'on_track';
      if (pendingQuestions > 0) {
        status = 'question';
      } else if (
        stuckFocuses.length > 0 ||
        needsReview ||
        isInactive
      ) {
        status = 'attention';
      }

      // Shared Retention / Motivation / Health metrics (identical source
      // as the student detail hero gauges).
      const m = metricsByStudent[s.id] || { retention: 0, motivation: 0, health: 0 };
      const health = m.health;
      const retention = m.retention;
      const motivation = m.motivation;

      // Primary alert for attention students
      let alert = null;
      if (stuckFocuses.length > 0) {
        alert = {
          kind: 'stuck',
          text: `${stuckFocuses[0].name} — stuck ${stuckFocuses.length}×`,
        };
      } else if (pendingQuestions > 0) {
        alert = {
          kind: 'question',
          text: `${pendingQuestions} pending question${pendingQuestions > 1 ? 's' : ''}`,
        };
      } else if (needsReview) {
        alert = {
          kind: 'review',
          text: 'New focus points to review',
        };
      } else if (isInactive && daysSincePractice !== null) {
        alert = {
          kind: 'inactive',
          text: `Inactive for ${daysSincePractice} day${daysSincePractice > 1 ? 's' : ''}`,
        };
      }

      return {
        id: s.id,
        name: s.name || 'Student',
        danceStyle: s.dance_style || '',
        photoUrl: s.avatar_url || null, // avatar_url may be undefined if column missing
        lastActiveDate: lastPracticeIso,
        daysSincePractice,
        lastClassDate: lastClassIso,
        lastPrivateClassDate: lastPrivateClassIso,
        lastPrivateDays,
        pendingQuestions,
        stuckCount: stuckFocuses.length,
        stuckFocusName: stuckFocuses[0]?.name || null,
        activeFocuses,
        needsReview,
        status,
        health,
        retention,
        motivation,
        alert,
      };
    })
    .sort((a, b) => {
      // Order: question → attention → on_track, then lowest health first
      const order = { question: 0, attention: 1, on_track: 2 };
      if (a.status !== b.status) return order[a.status] - order[b.status];
      return a.health - b.health;
    });
}

// ─── Student Detail ───────────────────────────────────────────────────────────

export async function getStudentProfile(studentId) {
  const { data } = await supabase
    .from('users')
    .select('id, name, dance_style, main_studio, last_active_date')
    .eq('id', studentId)
    .single();
  return data || null;
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

  // Count practice_logs this week for each focus
  const focusIds = focusPoints.map(f => f.id);
  const { data: logs } = await supabase
    .from('practice_logs')
    .select('focus_point_id')
    .eq('student_id', studentId)
    .gte('created_at', weekAgo)
    .in('focus_point_id', focusIds);

  const weekCounts = {};
  for (const l of logs || []) {
    weekCounts[l.focus_point_id] = (weekCounts[l.focus_point_id] || 0) + 1;
  }

  return focusPoints.map(f => ({
    id: f.id,
    name: f.name,
    subtitle: f.subtitle || null,
    drill: f.drill || null,
    weekCount: weekCounts[f.id] || 0,
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
  const coachName = await getCoachName();
  const { data: classes } = await supabase
    .from('class_inputs')
    .select('created_at, teacher_name, lesson_type')
    .eq('user_id', studentId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(30);

  if (!classes || classes.length === 0) return null;

  // Only private lessons count (lesson_type 'private' or legacy null)
  const privateLessons = classes.filter(
    (c) => c.lesson_type === 'private' || c.lesson_type == null
  );
  if (privateLessons.length === 0) return null;

  if (coachName) {
    const lc = coachName.trim().toLowerCase();
    const mine = privateLessons.find(
      (c) => (c.teacher_name || '').trim().toLowerCase() === lc
    );
    if (mine) return mine.created_at;
  }
  return privateLessons[0]?.created_at || null;
}

export async function getStudentRecentActivity(studentId, limit = 20) {
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
      .select('id, created_at, title, dance, teacher_name')
      .eq('user_id', studentId)
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
      const withCurrentCoach =
        !!lcCoach && !!teacher && teacher.trim().toLowerCase() === lcCoach;
      return {
        id: c.id,
        type: 'class',
        date: new Date(c.created_at),
        durationMin: null,
        title: c.title || null,
        dance: c.dance || null,
        teacherName: teacher,
        withCurrentCoach,
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
  if (studentId) {
    const { data, error } = await supabase
      .from('focus_points')
      .select('id, name, subtitle, context, drill, tier, coach_review_deadline, group_fp, source_class_input_id, created_at')
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
    .select('id, name, subtitle, context, drill, tier, coach_review_deadline, group_fp, source_class_input_id, created_at, user_id')
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
  const { error } = await supabase
    .from('focus_points')
    .update({ status: 'active', coach_review_deadline: null })
    .eq('id', fpId);
  if (error) throw error;
}

export async function editAndApproveFocusPoint(fpId, updates) {
  const allowed = ['name', 'subtitle', 'context', 'drill', 'tier'];
  const filtered = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)));
  const { error } = await supabase
    .from('focus_points')
    .update({ ...filtered, status: 'active', coach_review_deadline: null })
    .eq('id', fpId);
  if (error) throw error;
}

export async function deletePendingFocusPoint(fpId) {
  const { error } = await supabase
    .from('focus_points')
    .update({ is_deleted: true, status: 'past' })
    .eq('id', fpId);
  if (error) throw error;
}

export async function approveAllPendingForStudent(studentId) {
  const { error } = await supabase
    .from('focus_points')
    .update({ status: 'active', coach_review_deadline: null })
    .eq('user_id', studentId)
    .eq('status', 'pending_coach')
    .eq('is_deleted', false);
  if (error) throw error;
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
    .select('id, user_id, created_at, title, dance')
    .in('user_id', studentIds)
    .eq('is_deleted', false)
    .gte('created_at', sixtyDaysAgo)
    .order('created_at', { ascending: false })
    .limit(100);

  // Per-student: most recent class date
  const lastClassByStudent = {};
  for (const c of allClasses || []) {
    if (!lastClassByStudent[c.user_id]) lastClassByStudent[c.user_id] = c.created_at;
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
    ...(allClasses || []).map(c => ({
      id: c.id,
      studentId: c.user_id,
      studentName: studentMap[c.user_id] || 'Student',
      type: 'class',
      date: new Date(c.created_at),
      durationMin: null,
      title: c.title || null,
      dance: c.dance || null,
    })),
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
// for students) but adds the `linked_student_id` column so a note can be
// attached to a student. Coach-side notes never have a `linked_class_input_id`.

export async function getCoachNotes() {
  const coachId = await getCoachId();
  const { data: notes } = await supabase
    .from('notes')
    .select('id, title, content, video_clips, linked_student_id, created_at, updated_at')
    .eq('user_id', coachId)
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false });

  if (!notes || notes.length === 0) return [];

  const studentIds = [...new Set(notes.map(n => n.linked_student_id).filter(Boolean))];
  let studentMap = {};
  if (studentIds.length > 0) {
    const { data: students } = await supabase
      .from('users')
      .select('id, name')
      .in('id', studentIds);
    (students || []).forEach(s => {
      studentMap[s.id] = { id: s.id, name: s.name, photoUrl: s.avatar_url };
    });
  }

  return notes.map(n => ({
    ...n,
    linkedStudent: n.linked_student_id ? studentMap[n.linked_student_id] || null : null,
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
      .select('id, name')
      .eq('id', data.linked_student_id)
      .maybeSingle();
    if (student) {
      data.linkedStudent = { id: student.id, name: student.name, photoUrl: student.avatar_url };
    }
  }
  return data;
}

export async function saveCoachNote(note) {
  const coachId = await getCoachId();
  const { id, user_id, created_at, linkedStudent, ...rest } = note;

  // Coach notes never link to a class
  rest.linked_class_input_id = null;

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
