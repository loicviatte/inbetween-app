// ─── Couple storage ───────────────────────────────────────────────────────────
// Partner pairing (double opt-in handshake), couple lookup, and unpair.
// Mirrors the coach-linking pattern in coachStorage.js / storage.js.
// A couple is a single shared entity (see docs/COUPLE_FEATURE_SPEC.md).

import { supabase } from '../services/supabase/client';
import { getOrCreateInviteCode } from './coachStorage';
import { focusMatchesCategory } from '../utils/danceCategory';

async function getUserId() {
  // getSession() is local (no network round-trip); getUser() hits the auth server.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error('Not authenticated');
  return session.user.id;
}

// Partner pairing reuses the user's existing stable invite_code (no new code).
export async function getMyPartnerCode() {
  return getOrCreateInviteCode();
}

// ─── My couple ─────────────────────────────────────────────────────────────────
// Returns the couple I belong to, shaped for the UI, or null.
export async function getMyCouple() {
  const userId = await getUserId();
  const { data: me } = await supabase
    .from('users').select('couple_id').eq('id', userId).single();
  if (!me?.couple_id) return null;

  const { data: c } = await supabase
    .from('couples')
    .select('id, user_a_id, user_b_id, leader_user_id, does_latin, does_ballroom, latin_couple_coach_id, ballroom_couple_coach_id, pending_change, pending_change_by, created_at')
    .eq('id', me.couple_id)
    .is('unpaired_at', null)
    .maybeSingle();
  if (!c) return null;

  const partnerId = c.user_a_id === userId ? c.user_b_id : c.user_a_id;

  // Partner row + couple-coach names don't depend on each other — one round-trip
  // instead of two (this whole call is on the Train/Profile cold-start path).
  // Coach names are best-effort: RLS may block a dancer from reading the coach's
  // user row, in which case the lookup returns nothing and we fall back to a
  // plain "Linked" label — never an error.
  const coupleCoach = { latin: null, ballroom: null };
  const coachIds = [c.latin_couple_coach_id, c.ballroom_couple_coach_id].filter(Boolean);
  const [{ data: partner }, coachRes] = await Promise.all([
    supabase.from('users').select('id, name, avatar_url').eq('id', partnerId).maybeSingle(),
    coachIds.length
      ? supabase.from('users').select('id, name').in('id', coachIds)
      : Promise.resolve({ data: [] }),
  ]);
  const nameById = Object.fromEntries((coachRes?.data || []).map((u) => [u.id, u.name]));
  if (c.latin_couple_coach_id) {
    coupleCoach.latin = { id: c.latin_couple_coach_id, name: nameById[c.latin_couple_coach_id] || null };
  }
  if (c.ballroom_couple_coach_id) {
    coupleCoach.ballroom = { id: c.ballroom_couple_coach_id, name: nameById[c.ballroom_couple_coach_id] || null };
  }

  return {
    coupleId: c.id,
    partner: { id: partnerId, name: partner?.name || 'Partner', avatarUrl: partner?.avatar_url || null },
    leaderUserId: c.leader_user_id,
    iAmLeader: c.leader_user_id === userId,
    doesLatin: c.does_latin,
    doesBallroom: c.does_ballroom,
    latinCoupleCoachId: c.latin_couple_coach_id,
    ballroomCoupleCoachId: c.ballroom_couple_coach_id,
    latinCoupleCoach: coupleCoach.latin,
    ballroomCoupleCoach: coupleCoach.ballroom,
    pendingChange: c.pending_change || null,        // { does_latin, does_ballroom, leader_user_id } | null
    pendingChangeBy: c.pending_change_by || null,   // member who proposed it
    pendingChangeMine: !!c.pending_change && c.pending_change_by === userId,
    createdAt: c.created_at,
  };
}

// ─── Pairing handshake ─────────────────────────────────────────────────────────
// Step 1: A enters B's code → pending request to B.
export async function requestPartnerByCode(code) {
  const userId = await getUserId();
  const clean = (code || '').trim().toUpperCase();
  if (!clean) throw new Error('Enter a code.');

  const { data: me } = await supabase
    .from('users').select('couple_id').eq('id', userId).single();
  if (me?.couple_id) throw new Error('You already have a partner.');

  // RLS blocks reading another student's row by invite_code, so resolve the
  // target via a SECURITY DEFINER lookup (find_partner_by_code → students only).
  const { data: rows, error: lookErr } = await supabase
    .rpc('find_partner_by_code', { p_code: clean });
  if (lookErr) throw lookErr;
  const target = Array.isArray(rows) ? rows[0] : rows;
  if (!target) throw new Error('No dancer found for this code.');
  if (target.id === userId) throw new Error("That's your own code.");
  if (target.couple_id) throw new Error('This dancer already has a partner.');

  const { error } = await supabase
    .from('couple_requests')
    .insert({ requester_id: userId, target_id: target.id, status: 'pending' });
  if (error) {
    if (error.code === '23505') throw new Error('Request already sent.');
    throw error;
  }
  return { targetId: target.id, targetName: target.name };
}

// A request awaiting MY acceptance (I'm the target).
// Incoming request where I'm the target: 'pending' (my turn to configure +
// accept) or 'awaiting_validation' (I already accepted — now waiting for the
// requester to confirm). Both are returned so B always sees where the
// handshake stands instead of the row silently reverting to "Add partner".
export async function getIncomingPartnerRequest() {
  const userId = await getUserId();
  const { data } = await supabase
    .from('couple_requests')
    .select('id, requester_id, status, proposed_does_latin, proposed_does_ballroom, proposed_leader_id, created_at, users!couple_requests_requester_id_fkey(name, avatar_url)')
    .eq('target_id', userId)
    .in('status', ['pending', 'awaiting_validation'])
    .order('created_at', { ascending: false })
    .limit(1);
  const r = data?.[0];
  if (!r) return null;
  return {
    id: r.id,
    requesterId: r.requester_id,
    requesterName: r.users?.name || 'A dancer',
    requesterAvatar: r.users?.avatar_url || null,
    status: r.status,
    proposedDoesLatin: r.proposed_does_latin,
    proposedDoesBallroom: r.proposed_does_ballroom,
    proposedLeaderId: r.proposed_leader_id,
    createdAt: r.created_at,
  };
}

// My outgoing request: 'pending' (waiting for B) or 'awaiting_validation' (my turn to validate).
export async function getOutgoingPartnerRequest() {
  const userId = await getUserId();
  const { data } = await supabase
    .from('couple_requests')
    .select('id, target_id, status, proposed_does_latin, proposed_does_ballroom, proposed_leader_id, created_at, users!couple_requests_target_id_fkey(name, avatar_url)')
    .eq('requester_id', userId)
    .in('status', ['pending', 'awaiting_validation'])
    .order('created_at', { ascending: false })
    .limit(1);
  const r = data?.[0];
  if (!r) return null;
  return {
    id: r.id,
    targetId: r.target_id,
    targetName: r.users?.name || 'A dancer',
    targetAvatar: r.users?.avatar_url || null,
    status: r.status,
    proposedDoesLatin: r.proposed_does_latin,
    proposedDoesBallroom: r.proposed_does_ballroom,
    proposedLeaderId: r.proposed_leader_id,
    createdAt: r.created_at,
  };
}

// Step 2: B accepts and configures the couple (styles + who leads) → awaiting_validation.
export async function acceptPartnerRequest(reqId, { doesLatin, doesBallroom, leaderId }) {
  const userId = await getUserId();
  if (!doesLatin && !doesBallroom) throw new Error('Pick at least one style.');
  if (!leaderId) throw new Error('Pick who leads.');
  const { error } = await supabase
    .from('couple_requests')
    .update({
      status: 'awaiting_validation',
      proposed_does_latin: !!doesLatin,
      proposed_does_ballroom: !!doesBallroom,
      proposed_leader_id: leaderId,
    })
    .eq('id', reqId)
    .eq('target_id', userId);
  if (error) throw error;
}

// Step 3: A validates B's proposal → couple created (atomic, server-side).
export async function validatePartner(reqId) {
  const { data, error } = await supabase.rpc('finalize_couple', { p_request_id: reqId });
  if (error) throw error;
  return data;
}

// B declines an incoming request.
export async function declinePartnerRequest(reqId) {
  const userId = await getUserId();
  await supabase.from('couple_requests').delete().eq('id', reqId).eq('target_id', userId);
}

// A cancels their own outgoing request.
export async function cancelPartnerRequest(reqId) {
  const userId = await getUserId();
  await supabase.from('couple_requests').delete().eq('id', reqId).eq('requester_id', userId);
}

// ─── Unpair (destructive) ──────────────────────────────────────────────────────
// Deletes the couple → CASCADE wipes couple FP/logs/locks; the users.couple_id
// FK (ON DELETE SET NULL) clears it for both dancers. All progress is lost.
export async function unpair(coupleId) {
  // Soft delete — keeps the couple's focus points + history for 30 days in
  // case they re-form (handled by the unpair_couple RPC + the publish-expired
  // sweep). The confirmation pop-up still tells the user it's deleted.
  const { error } = await supabase.rpc('unpair_couple', { p_couple: coupleId });
  if (error) throw error;
}

// ─── Couple readiness ──────────────────────────────────────────────────────────
// Mirror of storage.getLessonReadiness, but for the couple: anchored to the
// couple's most recent couple lesson and counting couple_practice_logs.
// One server-side round-trip (RPC) instead of the old 4-query waterfall — the
// couple card is non-blocking + uncached, so the slow chain was leaving the
// couple focus invisible on cold launches. Same result shape | null.
// SECURITY INVOKER → identical RLS (couple members + couple-coach).
// See supabase/migrations/20260612c_couple_readiness_rpc.sql.
export async function getCoupleReadiness(coupleId, category = null) {
  if (!coupleId) return null;
  const { data } = await supabase.rpc('get_couple_readiness', {
    p_couple: coupleId,
    p_category: category,
  });
  return data || null;
}

// ─── Which Train card is primary (most trained over the last 14 days) ──────────
// Returns 'solo' | 'couple'. Drives which card renders large on the Train page.
export async function mostTrainedMode(coupleId = null) {
  const userId = await getUserId();
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  // Reuse the caller's couple id when provided (Train already fetched it) so we
  // skip a redundant getMyCouple() round-trip; fall back to a lookup otherwise.
  const cid = coupleId || (await getMyCouple().catch(() => null))?.coupleId || null;

  const [soloRes, coupleRes] = await Promise.all([
    supabase
      .from('practice_logs')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', userId)
      .gte('completed_at', since)
      .not('completed_at', 'is', null),
    cid
      ? supabase
          .from('couple_practice_logs')
          .select('id', { count: 'exact', head: true })
          .eq('couple_id', cid)
          .gte('completed_at', since)
          .not('completed_at', 'is', null)
      : Promise.resolve({ count: 0 }),
  ]);

  return (coupleRes.count ?? 0) > (soloRes.count ?? 0) ? 'couple' : 'solo';
}

// ─── Couple training lock + session logging ────────────────────────────────────
const FEELING_TO_RATING = { Hard: 'hard', Struggled: 'struggled', Okay: 'okay', Good: 'good', Great: 'great' };

// Atomically try to take the couple-wide lock. Returns { ok, lockedByUserId }:
// ok=true → I hold it (acquired or took over a stale one); ok=false → the
// partner is currently training (lockedByUserId is them).
export async function acquireCoupleLock(coupleId, focusPointId, durationMin) {
  const me = await getUserId();
  const { data, error } = await supabase.rpc('acquire_couple_lock', {
    p_couple: coupleId, p_fp: focusPointId, p_duration: durationMin || 7,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: row?.locked_by_user_id === me, lockedByUserId: row?.locked_by_user_id || null };
}

export async function heartbeatCoupleLock(coupleId) {
  if (!coupleId) return;
  await supabase.rpc('heartbeat_couple_lock', { p_couple: coupleId }).catch(() => {});
}

export async function releaseCoupleLock(coupleId) {
  if (!coupleId) return;
  await supabase.rpc('release_couple_lock', { p_couple: coupleId }).catch(() => {});
}

// The current live lock for a couple (for the partner's "training in progress"
// mirror), or null. Shaped for the UI.
export async function getCoupleLock(coupleId) {
  if (!coupleId) return null;
  const { data } = await supabase
    .from('couple_focus_locks')
    .select('couple_id, couple_focus_point_id, locked_by_user_id, started_at, session_duration_minutes, last_heartbeat_at, couple_focus_points(name)')
    .eq('couple_id', coupleId)
    .maybeSingle();
  if (!data) return null;
  // Treat a stale lock (no heartbeat for >90s) as released.
  const stale = data.last_heartbeat_at && (Date.now() - new Date(data.last_heartbeat_at).getTime()) > 90000;
  if (stale) return null;
  return {
    coupleFocusPointId: data.couple_focus_point_id,
    focusName: data.couple_focus_points?.name || 'a focus point',
    lockedByUserId: data.locked_by_user_id,
    startedAt: data.started_at,
    durationMinutes: data.session_duration_minutes,
  };
}

// Log a completed couple session (couple-level, no per-dancer attribution) and
// release the lock. yoda-score for couples is not wired yet, so couple readiness
// is driven directly by these logs (getCoupleReadiness counts them).
export async function completeCoupleTrainingSession(coupleId, coupleFocusPointId, feeling = null, sessionNote = null, startedAtMs = null, sessionMotivation = null) {
  if (!coupleId || !coupleFocusPointId) return;
  const completedAt = new Date();
  const startedAt = startedAtMs ? new Date(startedAtMs) : completedAt;
  const durationMinutes = Math.max(1, Math.round((completedAt - startedAt) / 60000));
  const payload = {
    couple_id: coupleId,
    couple_focus_point_id: coupleFocusPointId,
    duration_minutes: durationMinutes,
    rating: FEELING_TO_RATING[feeling] ?? 'okay',
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
  };
  if (feeling) payload.feeling = feeling;
  if (sessionNote) payload.session_note = sessionNote;
  if (sessionMotivation === 1 || sessionMotivation === 2 || sessionMotivation === 3) payload.session_motivation = sessionMotivation;
  const { error } = await supabase.from('couple_practice_logs').insert(payload);
  if (error) throw error;
  await releaseCoupleLock(coupleId);
}

// ─── Couple coach (couple designates, per style; coach accepts) ─────────────────
// Student/couple side: designate a couple coach by code for a style.
export async function requestCoupleCoachByCode(coupleId, code, category) {
  if (!coupleId) throw new Error('No couple.');
  const clean = (code || '').trim().toUpperCase();
  if (!clean) throw new Error('Enter a code.');
  if (category !== 'latin' && category !== 'ballroom') throw new Error('Pick a style.');

  const { data: coach } = await supabase
    .from('users').select('id, name, role').eq('invite_code', clean).eq('role', 'coach').maybeSingle();
  if (!coach) throw new Error('No coach found for this code.');

  // One couple-coach request per (couple, style): replace any existing one.
  await supabase.from('couple_coach_requests').delete().eq('couple_id', coupleId).eq('category', category);
  const { error } = await supabase
    .from('couple_coach_requests')
    .insert({ couple_id: coupleId, coach_id: coach.id, category, status: 'pending' });
  if (error) throw error;
  return { coachId: coach.id, coachName: coach.name };
}

// ─── Couple config changes (partner-approved) ────────────────────────────────
// Either dancer proposes new styles / leader; the change is staged on the
// couple and only applied once the OTHER dancer approves (RPCs enforce that and
// push-notify the partner). Both sides see it live via the couples realtime sub.
export async function proposeCoupleChange(coupleId, { doesLatin, doesBallroom, leaderId }) {
  if (!coupleId) throw new Error('No couple.');
  if (!doesLatin && !doesBallroom) throw new Error('Pick at least one style.');
  if (!leaderId) throw new Error('Pick who leads.');
  const { error } = await supabase.rpc('propose_couple_change', {
    p_couple: coupleId,
    p_does_latin: !!doesLatin,
    p_does_ballroom: !!doesBallroom,
    p_leader: leaderId,
  });
  if (error) throw error;
}

export async function respondCoupleChange(coupleId, accept) {
  const { error } = await supabase.rpc('respond_couple_change', { p_couple: coupleId, p_accept: !!accept });
  if (error) throw error;
}

export async function cancelCoupleChange(coupleId) {
  const { error } = await supabase.rpc('cancel_couple_change', { p_couple: coupleId });
  if (error) throw error;
}

// Coach side: pending couple-coach requests addressed to me (with dancer names).
export async function getPendingCoupleCoachRequests() {
  const { data, error } = await supabase.rpc('get_pending_couple_coach_requests');
  if (error) throw error;
  return (data || []).map(r => ({
    id: r.id,
    coupleId: r.couple_id,
    category: r.category,
    coupleName: `${(r.dancer_a || '?').split(' ')[0]} & ${(r.dancer_b || '?').split(' ')[0]}`,
    createdAt: r.created_at,
  }));
}

// Coach side: accept/decline a couple-coach request.
export async function respondToCoupleCoachRequest(reqId, accept) {
  const { error } = await supabase.rpc('respond_couple_coach_request', { p_request_id: reqId, p_accept: !!accept });
  if (error) throw error;
}

// Coach side: couples I coach (latin or ballroom), shaped for the roster.
export async function getMyCouples() {
  const coachId = await getUserId();
  const { data } = await supabase
    .from('couples')
    .select('id, user_a_id, user_b_id, does_latin, does_ballroom, latin_couple_coach_id, ballroom_couple_coach_id')
    .is('unpaired_at', null)
    .or(`latin_couple_coach_id.eq.${coachId},ballroom_couple_coach_id.eq.${coachId}`);
  if (!data || data.length === 0) return [];

  const ids = Array.from(new Set(data.flatMap(c => [c.user_a_id, c.user_b_id])));
  const { data: users } = await supabase.from('users').select('id, name, avatar_url').in('id', ids);
  const byId = new Map((users || []).map(u => [u.id, u]));

  return data.map(c => {
    const a = byId.get(c.user_a_id), b = byId.get(c.user_b_id);
    return {
      coupleId: c.id,
      dancerA: { id: c.user_a_id, name: a?.name || 'Dancer', avatarUrl: a?.avatar_url || null },
      dancerB: { id: c.user_b_id, name: b?.name || 'Dancer', avatarUrl: b?.avatar_url || null },
      name: `${(a?.name || '?').split(' ')[0]} & ${(b?.name || '?').split(' ')[0]}`,
      doesLatin: c.does_latin,
      doesBallroom: c.does_ballroom,
      latinCoupleCoachId: c.latin_couple_coach_id,
      ballroomCoupleCoachId: c.ballroom_couple_coach_id,
    };
  });
}

// ─── Couple detail (coach's couple page) ───────────────────────────────────────
export async function getCoupleDetail(coupleId) {
  if (!coupleId) return null;
  const { data: c } = await supabase
    .from('couples')
    .select('id, user_a_id, user_b_id, leader_user_id, does_latin, does_ballroom')
    .eq('id', coupleId).maybeSingle();
  if (!c) return null;
  const { data: users } = await supabase
    .from('users').select('id, name, avatar_url').in('id', [c.user_a_id, c.user_b_id]);
  const byId = new Map((users || []).map(u => [u.id, u]));
  const a = byId.get(c.user_a_id), b = byId.get(c.user_b_id);
  const readiness = await getCoupleReadiness(coupleId, null).catch(() => null);
  return {
    coupleId: c.id,
    name: `${(a?.name || '?').split(' ')[0]} & ${(b?.name || '?').split(' ')[0]}`,
    dancerA: { id: c.user_a_id, name: a?.name || 'Dancer', avatarUrl: a?.avatar_url || null, isLeader: c.leader_user_id === c.user_a_id },
    dancerB: { id: c.user_b_id, name: b?.name || 'Dancer', avatarUrl: b?.avatar_url || null, isLeader: c.leader_user_id === c.user_b_id },
    doesLatin: c.does_latin,
    doesBallroom: c.does_ballroom,
    readiness,
  };
}

// Active couple focus points (for the coach's couple page).
export async function getCoupleFocusPoints(coupleId) {
  if (!coupleId) return [];
  const { data } = await supabase
    .from('couple_focus_points')
    .select('id, name, subtitle, tier, status, is_held, practice_count, created_at')
    .eq('couple_id', coupleId)
    .eq('is_deleted', false)
    .eq('is_other', false)
    .neq('status', 'past')
    .neq('status', 'pending_coach')
    .order('created_at', { ascending: false });
  return data || [];
}

// ─── Couple "in progress" focuses (current couple readiness checklist) ─────────
// Mirror of the solo readiness tab for the couple's shared focus points: the
// focuses from the couple's most recent lesson, each tagged with {_target,_done}.
// Powers the All-focus-points "Couple" tab.
export async function getCoupleReadinessFocuses(coupleId, category = null) {
  if (!coupleId) return [];
  const [ptsRes, readiness] = await Promise.all([
    supabase
      .from('couple_focus_points')
      .select('*')
      .eq('couple_id', coupleId)
      .eq('is_deleted', false)
      .eq('is_other', false)
      .neq('status', 'past')
      .neq('status', 'pending_coach'),
    getCoupleReadiness(coupleId, category).catch(() => null),
  ]);
  const pts = ptsRes.data || [];
  const focuses = readiness?.focuses || [];
  if (focuses.length === 0) return [];
  const prog = new Map(focuses.map((f) => [f.focusPointId, f]));
  return pts
    .filter((p) => prog.has(p.id) && focusMatchesCategory(p, category))
    .map((p) => ({ ...p, _target: prog.get(p.id).target, _done: prog.get(p.id).done }));
}

// ─── Couple focus point — coach review (mirror of solo pending_coach flow) ──────
// New couple FP from a class land in `pending_coach`; the couple-coach reviews
// them here and approves → `active` (or rejects → `past`). RLS `cfp_update` is
// coach-only (is_couple_coach), so only the couple coach can run these.

// Pending couple FP across all couples this coach coaches (for ActionNeeded).
export async function getPendingCoupleFocusPoints() {
  const couples = await getMyCouples().catch(() => []);
  const coupleIds = (couples || []).map((c) => c.coupleId);
  if (coupleIds.length === 0) return [];
  const byId = new Map((couples || []).map((c) => [c.coupleId, c]));
  const { data, error } = await supabase
    .from('couple_focus_points')
    .select('id, couple_id, name, subtitle, context, drill, tier, dance, coach_review_deadline, source_class_input_id, created_at, ' +
            'source_class_input:source_class_input_id(title, created_at, class_summary, lesson_type, dance)')
    .in('couple_id', coupleIds)
    .eq('status', 'pending_coach')
    .eq('is_other', false)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true });
  if (error) throw error;
  // Attach the couple display name (Anna & Loic) for the review card header.
  return (data || []).map((fp) => ({ ...fp, coupleName: byId.get(fp.couple_id)?.name || 'Couple' }));
}

// Clear the coach's "new couple focus points" bell notifications for a couple
// once they've reviewed them (mirror of the solo markFocusAdded… helper; the
// notif carries couple_id, not student_id).
async function markCoupleFocusAddedRead(coupleId) {
  if (!coupleId) return;
  const coachId = await getUserId().catch(() => null);
  if (!coachId) return;
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', coachId)
    // Match singular + plural (see markFocusAddedNotificationsReadForStudent).
    .in('type', ['focus_points_added', 'focus_point_added'])
    .eq('read', false)
    .contains('data', { couple_id: coupleId })
    .then(() => {}, () => {});
}

export async function approveCoupleFocusPoint(fpId) {
  const { data: row } = await supabase
    .from('couple_focus_points').select('couple_id').eq('id', fpId).maybeSingle();
  const { error } = await supabase
    .from('couple_focus_points')
    .update({ status: 'active', coach_review_deadline: null })
    .eq('id', fpId);
  if (error) throw error;
  await markCoupleFocusAddedRead(row?.couple_id);
}

export async function editAndApproveCoupleFocusPoint(fpId, updates) {
  const allowed = ['name', 'subtitle', 'context', 'drill', 'tier'];
  const filtered = Object.fromEntries(Object.entries(updates || {}).filter(([k]) => allowed.includes(k)));
  const { data: row } = await supabase
    .from('couple_focus_points').select('couple_id').eq('id', fpId).maybeSingle();
  const { error } = await supabase
    .from('couple_focus_points')
    .update({ ...filtered, status: 'active', coach_review_deadline: null })
    .eq('id', fpId);
  if (error) throw error;
  await markCoupleFocusAddedRead(row?.couple_id);
}

export async function rejectCoupleFocusPoint({ fpId, coupleId, fpName, reason }) {
  const { error } = await supabase
    .from('couple_focus_points')
    .update({ is_deleted: true, status: 'past' })
    .eq('id', fpId);
  if (error) throw error;
  // Notify both dancers their coach declined the shared focus.
  const { data: c } = await supabase
    .from('couples').select('user_a_id, user_b_id').eq('id', coupleId).maybeSingle();
  const ids = [c?.user_a_id, c?.user_b_id].filter(Boolean);
  if (ids.length) {
    const trimmed = (reason || '').trim();
    await supabase.from('notifications').insert(ids.map((uid) => ({
      user_id: uid,
      type: 'couple_focus_rejected',
      title: 'Couple focus declined by your coach',
      body: trimmed ? `"${fpName}" — ${trimmed}` : `Your coach declined "${fpName}".`,
      data: { couple_id: coupleId, focus_point_name: fpName, reason: trimmed || null },
    }))).catch(() => {});
  }
  await markCoupleFocusAddedRead(coupleId);
}

export async function approveAllPendingCoupleFocusPoints(coupleId) {
  const { error } = await supabase
    .from('couple_focus_points')
    .update({ status: 'active', coach_review_deadline: null })
    .eq('couple_id', coupleId)
    .eq('status', 'pending_coach')
    .eq('is_deleted', false);
  if (error) throw error;
  await markCoupleFocusAddedRead(coupleId);
}

// A single couple focus point (full row) by id. The couple training session
// receives a couple_focus_points id (not a solo focus_points one), so
// FocusSessionScreen loads it through here instead of getFocusPoints().
export async function getCoupleFocusPointById(id) {
  if (!id) return null;
  const { data } = await supabase
    .from('couple_focus_points')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return data || null;
}

// Recent couple sessions (couple_practice_logs + focus name).
export async function getCoupleActivity(coupleId, limit = 20) {
  if (!coupleId) return [];
  const { data } = await supabase
    .from('couple_practice_logs')
    .select('id, duration_minutes, rating, feeling, completed_at, couple_focus_points(name)')
    .eq('couple_id', coupleId)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(limit);
  return (data || []).map(r => ({
    id: r.id,
    focusName: r.couple_focus_points?.name || 'Focus',
    durationMinutes: r.duration_minutes,
    rating: r.rating,
    feeling: r.feeling,
    completedAt: r.completed_at,
  }));
}
