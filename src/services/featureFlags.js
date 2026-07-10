import { Platform } from 'react-native';

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

// Native iOS recorder (continuous-audio-recorder module). When enabled, the
// audio CAPTURE backend switches from expo-audio's stop+start chunk rotation
// (which trips expo/expo#21782 in background and loses everything past chunk 0)
// to a single AVAudioEngine that never restarts and rotates files natively.
// Independent of the server-side pipeline — chunks still feed enqueueChunk →
// uploadWorker → finalize-class.
//
// Currently enabled for every authenticated user — field-test rollout in 1.5.7.
// Falls back to expo-audio automatically if the native start path throws (e.g.
// non-iOS, missing native module).
export function isNativeRecorderEnabled(user) {
  return !!(typeof user === 'string' ? user : user?.id);
}

// ─── Local recording mode (DJI mic on-device storage) ────────────────────
// The "new" recording flow: the mic records to its own internal storage
// during class, then the coach plugs the mic via USB-C and InBetween imports
// + matches files to pending classes by chronological order + duration. The
// phone never captures audio during class, so the coach can use Spotify/Apple
// Music freely on a Bluetooth speaker without iOS audio-session conflicts.
//
// Rollout: after end-to-end validation this is now the DEFAULT for coaches.
// Every coach gets the new flow automatically — including newly onboarded
// ones, with no change needed here — EXCEPT the legacy coaches listed below,
// who stay on the old live phone-capture flow until they migrate their setup.
//
// Safety net for early matching errors: the inbetween-admin dashboard gates
// focus-point propagation on class_recordings.admin_review_status (stamped
// 'pending' for anything below high-confidence), so a human can catch a
// mis-matched file before it ever reaches a student.

// Coaches kept on the OLD live phone-capture flow. Add an email here to opt a
// specific coach OUT of the new DJI-mic + USB-C sync flow.
const LOCAL_RECORDING_LEGACY_EMAILS = new Set([
  'testmarius@gmail.com', // Marius — still on the old Bluetooth / live-capture setup
]);

export function isLocalRecordingMode(user) {
  // iOS-only: the DJI import flow (folder picker, file copy, WAV→m4a
  // transcode) is backed by the local-recording-files native module, which
  // is iOS-only and throws off-iOS. Now that local recording is the DEFAULT
  // for every coach, this guard is what stops any coach signing in on Android
  // from reaching a crashing native call (disables the whole DJI UI there).
  if (Platform.OS !== 'ios') return false;
  if (!user?.id) return false;
  // Coach-only capture path — students never record classes. Mirrors the
  // app's role convention (see services/auth/role.js): role lives in
  // user_metadata.role and anything that isn't 'coach' is treated as a student.
  const role = (user.user_metadata?.role ?? '').toString().toLowerCase();
  if (role !== 'coach') return false;
  // Legacy coaches explicitly held on the old live-capture flow.
  const email = user.email?.toLowerCase();
  if (email && LOCAL_RECORDING_LEGACY_EMAILS.has(email)) return false;
  return true;
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
