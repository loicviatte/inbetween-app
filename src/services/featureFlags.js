// ─── Feature flags ───────────────────────────────────────────────────────
// Lightweight gate for incrementally rolling out the new recording pipeline.
// Email-based whitelist — keep it simple until we have a real flag service.
//
// Add an email here to enable the new (server-side) recording pipeline
// for that user. Everyone else stays on the legacy client-side path until
// we flip the default.

const NEW_RECORDING_PIPELINE_USERS = new Set([
  'viatteloic@gmail.com',       // Loic — coach test account (David Yates)
  'loic@danceuniteduk.com',     // Loic — admin
  'testmarius@gmail.com',       // Marius — coach (production)
]);

/**
 * Returns true if the given user should use the new server-side recording
 * pipeline (chunks uploaded to Storage during class, finalize-class +
 * AssemblyAI webhook stitches the transcript). Pass the user object from
 * supabase.auth.getUser().
 */
export function isNewRecordingPipelineEnabled(user) {
  if (!user?.email) return false;
  return NEW_RECORDING_PIPELINE_USERS.has(user.email.toLowerCase());
}
