// ─── What was ticked at sign-up, kept as evidence ───────────────────────
// Three statements stand between someone and an account. Two of them used to
// leave no trace at all: the button simply stayed dead until all three were on,
// so the only proof was "the account exists, and the code cannot create one
// otherwise". That is an argument, not a record — and it is not the argument
// you want to be making to a regulator.
//
// Now every sign-up writes one consent_records row holding the exact sentences
// that were on screen, in the order they were shown, with the version of that
// wording and the moment they were accepted. The table is append-only from the
// app's side (insert-own, select-own, no update, no delete).
//
// This is NOT users.consent_status — that column says whether a PARENT's
// permission is needed, and reads 'not_required' for every adult.

import { supabase } from './supabase/client';
import { HEALTH_CONSENT } from './healthConsent';

// Bump with every change to the sentences below. The version is what makes the
// record mean something: an account that agreed to v1 did not agree to v2.
export const ACCOUNT_CONSENT_VERSION = 'account-v1-2026-09-23';

/**
 * The three boxes, in display order. A coach records other people; a student is
 * recorded — the first sentence says so in their own words.
 */
export function accountConsentStatements(isCoach) {
  return [
    isCoach
      ? 'I record my lessons with InBetween: the audio is transcribed and turned into focus points for my students'
      : 'My lessons are recorded and transcribed, and turned into focus points for me to train',
    'I understand I can withdraw this consent and delete my data at any time',
    HEALTH_CONSENT,
  ];
}

/**
 * Writes the record. Best-effort by design: a consent we fail to STORE must
 * never block the account of someone who did consent — it is logged instead,
 * and the health timestamp on the user row still carries the third statement.
 */
export async function recordAccountConsent({ userId, isCoach, role, acceptedAt, appVersion = null }) {
  if (!userId) return { error: null };
  const statements = accountConsentStatements(isCoach).map((text) => ({ text, accepted: true }));
  const { error } = await supabase.from('consent_records').insert({
    user_id: userId,
    kind: 'account_signup',
    version: ACCOUNT_CONSENT_VERSION,
    role: role ?? (isCoach ? 'coach' : 'student'),
    statements,
    accepted_at: acceptedAt ?? new Date().toISOString(),
    source: 'captured',
    app_version: appVersion,
  });
  if (error) console.warn('[consentRecord] not saved:', error.message);
  return { error };
}
