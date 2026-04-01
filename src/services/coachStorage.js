import { supabase } from '../lib/supabase';

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

  await supabase
    .from('coach_requests')
    .update({ status })
    .eq('id', requestId)
    .eq('coach_id', coachId);

  if (accept) {
    // Get the student_id from the request
    const { data: req } = await supabase
      .from('coach_requests')
      .select('student_id')
      .eq('id', requestId)
      .single();

    if (req?.student_id) {
      // Link the student to this coach
      await supabase
        .from('users')
        .update({ coach_id: coachId })
        .eq('id', req.student_id);
    }
  }
}

// ─── Students ─────────────────────────────────────────────────────────────────

export async function getMyStudents() {
  const coachId = await getCoachId();

  // Fetch all students linked to this coach
  const { data: students } = await supabase
    .from('users')
    .select('id, name, dance_style, last_active_date')
    .eq('coach_id', coachId)
    .eq('role', 'student')
    .order('name', { ascending: true });

  if (!students || students.length === 0) return [];

  const studentIds = students.map(s => s.id);

  // Fetch pending questions and validations in parallel
  const [{ data: pendingMessages }, { data: pendingValidations }] = await Promise.all([
    supabase
      .from('coach_messages')
      .select('student_id')
      .eq('coach_id', coachId)
      .eq('status', 'pending')
      .in('student_id', studentIds),
    supabase
      .from('focus_validations')
      .select('student_id')
      .eq('coach_id', coachId)
      .eq('status', 'pending')
      .in('student_id', studentIds),
  ]);

  const questionStudents = new Set((pendingMessages || []).map(m => m.student_id));
  const attentionStudents = new Set((pendingValidations || []).map(v => v.student_id));

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
  const coachId = await getCoachId();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  // Get active focus points
  const { data: focusPoints } = await supabase
    .from('focus_points')
    .select('id, name, created_at')
    .eq('user_id', studentId)
    .eq('is_deleted', false)
    .eq('is_archived', false)
    .order('created_at', { ascending: true });

  if (!focusPoints || focusPoints.length === 0) return [];

  const focusIds = focusPoints.map(f => f.id);

  // Count training sessions this week for each focus
  const { data: sessions } = await supabase
    .from('training_sessions')
    .select('slot1_focus_id, slot2_focus_id')
    .eq('user_id', studentId)
    .gte('started_at', weekAgo)
    .not('completed_at', 'is', null);

  const weekCounts = {};
  for (const s of sessions || []) {
    if (s.slot1_focus_id) weekCounts[s.slot1_focus_id] = (weekCounts[s.slot1_focus_id] || 0) + 1;
    if (s.slot2_focus_id) weekCounts[s.slot2_focus_id] = (weekCounts[s.slot2_focus_id] || 0) + 1;
  }

  // Get pending validations for these focus points
  const { data: validations } = await supabase
    .from('focus_validations')
    .select('focus_point_id, type, student_note')
    .eq('student_id', studentId)
    .eq('coach_id', coachId)
    .eq('status', 'pending')
    .in('focus_point_id', focusIds);

  const validationMap = {};
  for (const v of validations || []) {
    validationMap[v.focus_point_id] = { type: v.type, note: v.student_note };
  }

  return focusPoints.map(f => ({
    id: f.id,
    name: f.name,
    weekCount: weekCounts[f.id] || 0,
    validationPending: validationMap[f.id] || null,
  }));
}

export async function getStudentRecentActivity(studentId, limit = 5) {
  const [{ data: sessions }, { data: classes }] = await Promise.all([
    supabase
      .from('training_sessions')
      .select('id, started_at, completed_at')
      .eq('user_id', studentId)
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

export async function getStudentPendingValidations(studentId) {
  const coachId = await getCoachId();
  const { data } = await supabase
    .from('focus_validations')
    .select('id, focus_point_id, type, student_note, created_at, focus_points(name)')
    .eq('student_id', studentId)
    .eq('coach_id', coachId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  return (data || []).map(v => ({
    id: v.id,
    focusPointId: v.focus_point_id,
    focusName: v.focus_points?.name || '',
    type: v.type,
    studentNote: v.student_note,
    createdAt: v.created_at,
  }));
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

// Focus completion: coach approves (close focus) or rejects (keep working)
export async function respondToFocusCompletion(validationId, approve) {
  const status = approve ? 'approved' : 'rejected';
  await supabase
    .from('focus_validations')
    .update({ status })
    .eq('id', validationId);

  if (approve) {
    const { data: v } = await supabase
      .from('focus_validations')
      .select('focus_point_id')
      .eq('id', validationId)
      .single();

    if (v?.focus_point_id) {
      await supabase
        .from('focus_points')
        .update({ is_archived: true })
        .eq('id', v.focus_point_id);
    }
  }
}

// Flagged focus: coach decides what to do
// action: 'keep' | 'address' | 'dismiss'
export async function respondToFlaggedFocus(validationId, action) {
  let status = 'addressed';
  if (action === 'dismiss') status = 'dismissed';

  await supabase
    .from('focus_validations')
    .update({ status })
    .eq('id', validationId);

  if (action === 'dismiss') {
    const { data: v } = await supabase
      .from('focus_validations')
      .select('focus_point_id')
      .eq('id', validationId)
      .single();

    if (v?.focus_point_id) {
      await supabase
        .from('focus_points')
        .update({ is_archived: true })
        .eq('id', v.focus_point_id);
    }
  }
}

// ─── Activity Feed ────────────────────────────────────────────────────────────

export async function getCoachActivityFeed() {
  const coachId = await getCoachId();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

  // Get all students
  const { data: students } = await supabase
    .from('users')
    .select('id, name')
    .eq('coach_id', coachId)
    .eq('role', 'student');

  if (!students || students.length === 0) return [];

  const studentIds = students.map(s => s.id);
  const studentMap = Object.fromEntries(students.map(s => [s.id, s.name]));

  const [
    { data: sessions },
    { data: classes },
    { data: messages },
  ] = await Promise.all([
    supabase
      .from('training_sessions')
      .select('id, user_id, started_at, completed_at')
      .in('user_id', studentIds)
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
      studentId: s.user_id,
      studentName: studentMap[s.user_id] || 'Student',
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
