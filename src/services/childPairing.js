// ─── A child's own phone ─────────────────────────────────────────────────────
// A parent's account holds their child's training; the child trains on their
// own phone, signed in to their own profile, with a one-time code the parent
// gets from Stats ▸ Links. Every step runs in supabase/functions/child-pairing.
import { supabase } from './supabase/client';
import { listChildren } from '../storage/guardianStorage';

async function call(action, body = {}) {
  const { data, error } = await supabase.functions.invoke('child-pairing', { body: { action, ...body } });
  if (error) {
    let detail = '';
    try { detail = (await error.context?.json?.())?.error || ''; } catch { /* body already read */ }
    const e = new Error(detail || 'Something went wrong. Try again in a moment.');
    e.status = error.context?.status;
    throw e;
  }
  return data;
}

// Parent side.
export const createPairingCode = (childId) => call('create', { childId });   // { code, expiresAt, childName }
export const getChildPhoneStatus = (childId) => call('status', { childId });  // { linked, lastSeen }
export async function signOutChildPhone(childId) {
  const r = await call('signout', { childId });
  forgetChildPhones();
  return r;
}

// Child side: the code becomes a session on this phone.
export async function signInWithPairingCode(code) {
  const { tokenHash, childName } = await call('claim', { code });
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (error || !data?.session) throw new Error('We couldn’t sign you in. Ask your parent for a new code.');
  return { user: data.user, childName };
}

// "A6KQ7P" → "A6K 7QP" — two groups of three read back easily over a shoulder.
export const formatPairingCode = (code) => {
  const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return c.length > 3 ? `${c.slice(0, 3)} ${c.slice(3)}` : c;
};

// The header nudge on every tab asks the same question; one answer a minute.
let phonesCache = null;   // { at, value: [{ id, name, linked }] }
export function forgetChildPhones() { phonesCache = null; }
export async function getChildPhones({ fresh = false } = {}) {
  if (!fresh && phonesCache && Date.now() - phonesCache.at < 60000) return phonesCache.value;
  const kids = await listChildren();
  const value = await Promise.all(kids.map(async (k) => {
    try {
      const s = await getChildPhoneStatus(k.id);
      return { id: k.id, name: k.name, linked: !!s.linked, lastSeen: s.lastSeen };
    } catch {
      return { id: k.id, name: k.name, linked: null, lastSeen: null };   // unknown: don't nag
    }
  }));
  phonesCache = { at: Date.now(), value };
  return value;
}
