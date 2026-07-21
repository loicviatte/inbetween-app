-- ============================================================
-- "Audio lost" — let a coach permanently silence the upload reminder for one
-- class without pretending its audio arrived.
--
-- Until now a pending class only stopped nagging when its audio landed
-- (mic_file_name set), when a later class with an overlapping student
-- superseded it, or when it aged past the 30-day lookback in
-- notify-sync-reminders. A one-off class whose recording is genuinely gone
-- (mic wiped, file deleted, never actually recorded) therefore nagged every
-- evening for a month — which is precisely how a coach learns to ignore the
-- reminder. The evening full-screen reminder escalates after 3 nights, so it
-- needs a truthful way out.
--
-- Scope is deliberately narrow: sync_abandoned_at silences the REMINDER
-- surfaces only (nightly sync_reminder push + the full-screen evening
-- reminder). It does NOT remove the row from the matcher's candidate pool
-- (fetchPendingUploads) — if the coach later plugs in a mic that still holds
-- the file, it must auto-attach to this class rather than land as an orphan.
-- ============================================================

ALTER TABLE public.class_recordings
  ADD COLUMN IF NOT EXISTS sync_abandoned_at     timestamptz,
  ADD COLUMN IF NOT EXISTS sync_abandoned_reason text;

-- Abandoned rows are the rare case; a partial index keeps the common
-- "still pending" scan untouched while making the reminder's filter cheap.
CREATE INDEX IF NOT EXISTS idx_class_recordings_sync_abandoned
  ON public.class_recordings (user_id)
  WHERE sync_abandoned_at IS NOT NULL;

COMMENT ON COLUMN public.class_recordings.sync_abandoned_at IS
  'Set when the coach answers "audio lost" on the evening upload reminder. Silences the sync_reminder push + the full-screen reminder for this class; does NOT exclude it from mic-file matching.';
COMMENT ON COLUMN public.class_recordings.sync_abandoned_reason IS
  'Reason captured alongside sync_abandoned_at (e.g. audio_lost).';
