// ─── Health-data consent ────────────────────────────────────────────────
// A lesson's audio can carry an injury, a pain, a limitation. Under the GDPR
// that is special-category data, and it needs its own explicit permission —
// not the blanket one in the terms. Every account is asked for it at sign-up,
// in these exact words.
//
// Three things make it a real consent rather than a box:
//   · it is unticked when the screen opens (OnboardingScreen.acctChecks)
//   · what is stored is WHEN it was given and WHICH wording was read
//     (users.health_data_consent_at + health_consent_version) — a timestamp
//     alone cannot say what someone agreed to
//   · it can be taken back from Settings, and taking it back stops the
//     recording of that person: canBeRecorded() is what Start Class asks.
//
// Withdrawing does NOT delete anything by itself — deletion is its own request
// (erase-user). Nor does it erase the consent record: that the permission was
// given, and withdrawn, is exactly what has to survive.

import { supabase } from './supabase/client';

// The sentence, and the version of it. Bump BOTH together: an account that
// agreed to v1 did not agree to v2's words, and the column is what proves it.
// Named after the day the WORDING went live (with the minor consent's v3), not
// the day this file was written: the version identifies the sentence, so the
// four accounts that already ticked exactly these words carry the same one.
export const HEALTH_CONSENT_VERSION = 'health-v1-2026-09-18';

export const HEALTH_CONSENT =
  'Lessons are recorded and transcribed. Conversations during a lesson may include references to injuries, '
  + 'pain or physical limitations. I explicitly consent to InBetween processing this information as part of lesson content.';

/** 'given' | 'withdrawn' | 'never' — from a users row (any shape that carries the two columns). */
export function healthConsentState(user) {
  if (!user) return 'never';
  if (user.health_consent_withdrawn_at) return 'withdrawn';
  return user.health_data_consent_at ? 'given' : 'never';
}

/**
 * May this person be recorded? A withdrawal is a hard no. An account that was
 * never asked (created before the consent existed) is not blocked — blocking
 * them would be inventing a refusal they never made; they are asked again at
 * the next sign-up-shaped moment.
 */
export function canBeRecorded(user) {
  return healthConsentState(user) !== 'withdrawn';
}

/** Records the consent, with the wording that was on screen. */
export async function giveHealthConsent(userId, at = new Date().toISOString(), version = HEALTH_CONSENT_VERSION) {
  if (!userId) return { error: null };
  const { error } = await supabase
    .from('users')
    .update({
      health_data_consent_at: at,
      health_consent_version: version,
      health_consent_withdrawn_at: null,
    })
    .eq('id', userId);
  if (error) console.warn('[healthConsent] not saved:', error.message);
  return { error };
}

/** Takes it back. The date it was first given stays — it is the other half of the proof. */
export async function withdrawHealthConsent(userId) {
  if (!userId) return { error: null };
  const { error } = await supabase
    .from('users')
    .update({ health_consent_withdrawn_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) console.warn('[healthConsent] withdrawal not saved:', error.message);
  return { error };
}
