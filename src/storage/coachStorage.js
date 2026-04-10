import { supabase } from '../services/supabase/client';

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

  // Fetch accepted requests and join student profile
  const { data: requests } = await supabase
    .from('coach_requests')
    .select('student_id, users!coach_requests_student_id_fkey(id, name, dance_style, last_active_date)')
    .eq('coach_id', coachId)
    .eq('status', 'accepted');

  const students = (requests || [])
    .map(r => r.users)
    .filter(Boolean);

  if (students.length === 0) return [];

  const studentIds = students.map(s => s.id);

  // Fetch pending questions and pending_coach focus points in parallel
  const [{ data: pendingMessages }, { data: pendingFPs }] = await Promise.all([
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
  ]);

  const questionStudents = new Set((pendingMessages || []).map(m => m.student_id));
  const attentionStudents = new Set((pendingFPs || []).map(v => v.user_id));

  return students.map(s => {
    let status = 'on_track';
    if (questionStudents.has(s.id)) status = 'question';
    else if (attentionStudents.has(s.id)) status = 'attention';

    return {
      id: s.id,
      name: s.name || 'Student',
      danceStyle: s.dance_style || '',
      lastActiveDate: s.last_active_date,
      status,
    };
  }).sort((a, b) => {
    // Sort: question → attention → on_track
    const order = { question: 0, attention: 1, on_track: 2 };
    return order[a.status] - order[b.status];
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
    .select('id, name, subtitle, coach_note, created_at, status, tier')
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
    coachNote: f.coach_note || null,
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

export async function getStudentRecentActivity(studentId, limit = 5) {
  const [{ data: sessions }, { data: classes }] = await Promise.all([
    supabase
      .from('practice_logs')
      .select('id, started_at, completed_at')
      .eq('student_id', studentId)
      .not('completed_at', 'is', null)
      .order('started_at', { ascending: false })
      .limit(limit),
    supabase
      .from('class_inputs')
      .select('id, created_at')
      .eq('user_id', studentId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  const events = [
    ...(sessions || []).map(s => ({
      id: s.id,
      type: 'training',
      date: new Date(s.started_at),
      durationMin: s.completed_at
        ? Math.round((new Date(s.completed_at) - new Date(s.started_at)) / 60000)
        : null,
    })),
    ...(classes || []).map(c => ({
      id: c.id,
      type: 'class',
      date: new Date(c.created_at),
      durationMin: null,
    })),
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

  const [
    { data: sessions },
    { data: classes },
    { data: messages },
  ] = await Promise.all([
    supabase
      .from('practice_logs')
      .select('id, student_id, started_at, completed_at')
      .in('student_id', studentIds)
      .not('completed_at', 'is', null)
      .gte('started_at', fourteenDaysAgo)
      .order('started_at', { ascending: false })
      .limit(30),
    supabase
      .from('class_inputs')
      .select('id, user_id, created_at')
      .in('user_id', studentIds)
      .eq('is_deleted', false)
      .gte('created_at', fourteenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('coach_messages')
      .select('id, student_id, created_at')
      .eq('coach_id', coachId)
      .eq('status', 'pending')
      .in('student_id', studentIds)
      .gte('created_at', fourteenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

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
    })),
    ...(classes || []).map(c => ({
      id: c.id,
      studentId: c.user_id,
      studentName: studentMap[c.user_id] || 'Student',
      type: 'class',
      date: new Date(c.created_at),
      durationMin: null,
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

  return events.sort((a, b) => b.date - a.date);
}
