-- ============================================================
-- Local recording mode — DJI mic on-device storage workflow.
--
-- New architecture (vs the existing real-time chunked path):
--   1. Coach taps "Start class" — only a timestamp is stored client-side;
--      no audio is captured by the phone. The mic records to its own
--      internal storage (DJI Mic 1/2/3 have 8-32 GB on the TX).
--   2. Class happens; phone is free to play music via Spotify/BT speaker
--      because no audio session is held by InBetween.
--   3. Coach taps "End class" — second timestamp stored.
--   4. Later (typically end of day), coach plugs the mic via USB-C and
--      opens InBetween. App reads the file system, matches new audio
--      files to pending classes by chronological order + duration, then
--      uploads matched files to Supabase Storage.
--   5. AssemblyAI transcribes (re-uses the existing transcribing → completed
--      pipeline).
--   6. Admin (loic@danceuniteduk.com) reviews each completed recording
--      before focus points propagate to students.
--   7. ~3 days after upload, files are auto-deleted from the mic.
--
-- This migration is additive only; the legacy real-time pipeline is
-- untouched. `local_recording_mode = false` (the default) preserves
-- existing behavior bit-for-bit.
-- ============================================================

ALTER TABLE public.class_recordings
  ADD COLUMN IF NOT EXISTS local_recording_mode boolean NOT NULL DEFAULT false,

  -- Admin review gate (only used when local_recording_mode = true)
  ADD COLUMN IF NOT EXISTS admin_review_status text
    CHECK (admin_review_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS admin_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Imported mic-file metadata (filled when the file is matched/imported)
  ADD COLUMN IF NOT EXISTS mic_file_name text,             -- e.g. "DJI_21_20260512_132205.WAV"
  ADD COLUMN IF NOT EXISTS mic_file_index integer,         -- 21 — monotonically increases on the mic
  ADD COLUMN IF NOT EXISTS mic_file_timestamp timestamptz, -- parsed from filename, mic's RTC time
  ADD COLUMN IF NOT EXISTS mic_file_duration_sec integer,
  ADD COLUMN IF NOT EXISTS mic_file_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS file_imported_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_from_mic_at timestamptz,

  -- Confidence of the file↔class match
  ADD COLUMN IF NOT EXISTS match_confidence text
    CHECK (match_confidence IN ('high', 'medium', 'low'));

-- Admin queue: pending reviews newest-first
CREATE INDEX IF NOT EXISTS idx_class_recordings_admin_pending
  ON public.class_recordings(created_at DESC)
  WHERE admin_review_status = 'pending';

-- Mic file lookup: find max imported index per coach (so we know what's "new")
CREATE INDEX IF NOT EXISTS idx_class_recordings_mic_file_per_user
  ON public.class_recordings(user_id, mic_file_index DESC NULLS LAST)
  WHERE local_recording_mode = true;

COMMENT ON COLUMN public.class_recordings.local_recording_mode IS
  'true = class recorded locally on the DJI mic, imported via USB-C later. false (default) = legacy real-time chunked mode.';
COMMENT ON COLUMN public.class_recordings.admin_review_status IS
  'Admin review gate. Focus points only published to the student after admin_review_status = ''approved''. Only applies when local_recording_mode = true.';
COMMENT ON COLUMN public.class_recordings.match_confidence IS
  'Confidence that the imported file matches this class (high/medium/low). Derived from duration ratio + chronological order + count check at import time.';
COMMENT ON COLUMN public.class_recordings.mic_file_index IS
  'Monotonically-increasing index from the DJI mic''s filename (DJI_NN_...). Used to dedupe re-imports and detect missing files.';
