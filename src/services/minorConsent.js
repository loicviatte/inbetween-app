// ─── Parental consent for students under 18 ─────────────────────────────────
// Every step runs server-side in supabase/functions/minor-consent: the student
// and the parent have no account for most of it, and the proof has to be
// written where no client can edit it.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase/client';

const STORE = 'minorInvite.v1';

async function call(action, body = {}) {
  const { data, error } = await supabase.functions.invoke('minor-consent', { body: { action, ...body } });
  if (error) {
    // invoke() hides the body on a non-2xx; the function's own message is the
    // one worth showing.
    let detail = '';
    try { detail = (await error.context?.json?.())?.error || ''; } catch { /* body already read */ }
    const e = new Error(detail || 'Something went wrong. Try again in a moment.');
    // 404 / 409 / 410 mean the invitation can no longer be used — the caller
    // needs to tell that apart from a network hiccup.
    e.status = error.context?.status;
    throw e;
  }
  return data;
}

export const inviteParent = (payload) => call('invite', payload);
export const getInviteStatus = (inviteId, deviceSecret) => call('status', { inviteId, deviceSecret });
export const resendInvite = (inviteId, deviceSecret) => call('resend', { inviteId, deviceSecret });
export const updateInvite = (inviteId, deviceSecret, contact) => call('update', { inviteId, deviceSecret, ...contact });
export const verifyInvitation = (token, code) => call('verify', { token, code });
export const approveInvitation = (ticket, checks, password) => call('approve', { ticket, checks, password });
export const withdrawChild = (childId) => call('withdraw', { childId });
// The permission wording for a parent setting a child up themselves — the same
// text, from the same place, that an invited parent reads.
export const getConsentCopy = (childName, coachId) => call('copy', { childName, coachId });

// The waiting student's invitation survives the app being closed, so reopening
// returns to it instead of starting a second pending profile.
export async function savePendingInvite(v) {
  try { await AsyncStorage.setItem(STORE, JSON.stringify(v)); } catch { /* storage unavailable */ }
}
export async function loadPendingInvite() {
  try { const raw = await AsyncStorage.getItem(STORE); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export async function clearPendingInvite() {
  try { await AsyncStorage.removeItem(STORE); } catch { /* storage unavailable */ }
}

// com.loicviatte.inbetweenapp://consent?token=ABCD-EFGH-JKMN
export function tokenFromUrl(url) {
  if (!url || !/consent/.test(url)) return null;
  const m = /[?&]token=([A-Za-z0-9-]+)/.exec(url);
  return m ? m[1] : null;
}
