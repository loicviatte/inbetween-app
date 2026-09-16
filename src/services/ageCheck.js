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
export const sendAdultLink = () => invoke('age-check', 'send-adult-link');
export const inviteParentForMe = (contact) => invoke('minor-consent', 'invite-self', contact);
export const resendParentInvite = () => invoke('minor-consent', 'resend-self');
