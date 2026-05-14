// ─── Feature flags ───────────────────────────────────────────────────────
// Lightweight gate for incrementally rolling out the new recording pipeline.
//
// History: this was originally an email-based whitelist (only Loic + Marius
// got the new pipeline; everyone else stayed on the legacy client-side
// AssemblyAI path). After validation we flipped the default to ON for all
// authenticated coaches. The whitelist scaffolding is kept here in case we
// need to roll out a future feature gradually again.

/**
 * Returns true if the given user should use the new server-side recording
 * pipeline (chunks uploaded to Storage during class, finalize-class +
 * AssemblyAI webhook stitches the transcript). Pass the user object from
 * supabase.auth.getUser().
 *
 * Currently: enabled for every authenticated user. Returns false only if
 * the user object is missing (e.g. signed out) so the legacy fallback path
 * can still kick in for unauthenticated edge cases.
 */
export function isNewRecordingPipelineEnabled(user) {
  return !!user?.id;
}

// ─── Local recording mode (DJI mic on-device storage) ────────────────────
// New architecture being beta-tested with a single coach: the mic records
// to its own internal storage during class, then the coach plugs the mic
// via USB-C and InBetween imports + matches files to pending classes by
// chronological order + duration. Phone never captures audio during class,
// so the coach can use Spotify/Apple Music freely on a Bluetooth speaker
// without iOS audio-session conflicts.
//
// Gated by email because:
//   - We need to validate end-to-end before flipping for other coaches
//   - The flow changes UX significantly (no live waveform, manual import
//     of audio files) — needs onboarding before rolling out broadly
//   - Admin review (isAdminReviewer) is the safety net for early matching
//     errors — at 5-20 classes/day, Loic can hand-verify each one

const LOCAL_RECORDING_BETA_EMAILS = new Set([
  'viatteloic@gmail.com',
]);

export function isLocalRecordingMode(user) {
  if (!user?.email) return false;
  return LOCAL_RECORDING_BETA_EMAILS.has(user.email.toLowerCase());
}

// ─── Admin reviewer ──────────────────────────────────────────────────────
// Loic personally reviews each local-recording class before its focus
// points propagate to the student. This is the human-in-the-loop safety
// net for the MVP — if the matcher ever attaches the wrong audio file to
// a class, Loic sees the mismatch in the review screen and rejects/
// re-assigns before the student is notified.

export function isAdminReviewer(user) {
  if (!user?.email) return false;
  return user.email.toLowerCase() === 'loic@danceuniteduk.com';
}
