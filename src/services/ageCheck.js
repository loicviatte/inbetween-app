// ─── A coach's word on a student's age ───────────────────────────────────────
// Accepting a student, the coach says whether they're 18 or over. "Under 18"
// for a student who came without a parent locks their account until they
// confirm by email they're an adult, or a parent approves.
// Server side: coach_set_student_age (SQL), supabase/functions/age-check, and
// minor-consent's invite-self / resend-self.
import { supabase } from './supabase/client';

async function invoke(fn, action, body = {}) {
  const { data, error } = await supabase.functions.invoke(fn, { body: { action, ...body } });
  if (error) {
    let detail = '';
    try { detail = (await error.context?.json?.())?.error || ''; } catch { /* body already read */ }
    const e = new Error(detail || 'Something went wrong. Try again in a moment.');
    e.status = error.context?.status;
    throw e;
  }
  return data;
}

// Coach: 'known' (came with a parent), 'adult' or 'minor_pending'.
export async function setStudentAge(studentId, minor) {
  const { data, error } = await supabase.rpc('coach_set_student_age', { p_student: studentId, p_minor: !!minor });
  if (error) throw new Error(error.message);
  return data;
}

// Student: is this account locked? Read straight from the student's own row,
// cheap enough to poll while the lock screen is up.
export async function isAgeLocked() {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user || user.user_metadata?.account_for === 'child') return false;   // a parent's account is never the one locked
  const { data } = await supabase.from('users').select('age_check').eq('id', user.id).maybeSingle();
  return data?.age_check === 'minor_pending';
}

export const getAgeCheckStatus = () => invoke('age-check', 'status');

// Student: ask the coach who flagged the account to look again.
export async function requestCoachReview() {
  const { data, error } = await supabase.rpc('request_coach_age_review');
  if (error) throw new Error(error.message);
  return data;   // 'requested' | 'already_pending'
}

// Student: a photo of an ID, date of birth showing. It goes straight into the
// private age-proofs bucket (the student can't even read it back) and is
// queued for InBetween, which deletes it once it has decided.
export async function submitProofOfAge({ base64, mimeType }) {
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) throw new Error('Sign in again.');
  const bin = global.atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  const path = `${uid}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('age-proofs').upload(path, bytes, { contentType: mimeType || 'image/jpeg' });
  if (error) throw new Error('The photo didn’t upload. Try again.');
  return invoke('age-check', 'submit-proof', { path });
}

// Coach: is this student waiting on me to look again? And my second answer.
export async function coachReviewPending(studentId) {
  const { data } = await supabase.rpc('coach_age_review_pending', { p_student: studentId });
  return data === true;
}
export async function coachReviewStudentAge(studentId, adult) {
  const { data, error } = await supabase.rpc('coach_review_student_age', { p_student: studentId, p_adult: !!adult });
  if (error) throw new Error(error.message);
  return data;   // 'unlocked' | 'kept' | 'not_pending'
}
export const inviteParentForMe = (contact) => invoke('minor-consent', 'invite-self', contact);
export const resendParentInvite = () => invoke('minor-consent', 'resend-self');
