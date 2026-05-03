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
