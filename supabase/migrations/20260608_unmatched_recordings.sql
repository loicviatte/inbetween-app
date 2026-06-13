-- ── unmatched_recordings ──────────────────────────────────────────────
-- Safety net for the DJI local-recording import. When the matcher can't pair
-- a mic file to a pending class, the app still transcodes + uploads it here
-- (audio only — NOT transcribed) so the recording gets OFF the mic and can be
-- attached / troubleshot server-side, without having to recover the physical
-- mic from the coach. A later "attach to class" step turns one of these into a
-- real class_recording (+ chunks pointing at the already-uploaded m4a).
CREATE TABLE IF NOT EXISTS public.unmatched_recordings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dji_index             integer,
  mic_timestamp         timestamptz,                 -- first part's mic-RTC time (may drift)
  duration_sec          integer,                     -- summed across parts
  size_bytes            bigint,                      -- summed WAV bytes
  part_filenames        text[] NOT NULL DEFAULT '{}', -- original WAV names (dedup + display)
  storage_paths         text[] NOT NULL DEFAULT '{}', -- {user_id}/unmatched/{idx}_{ts}/{n}.m4a
  status                text NOT NULL DEFAULT 'uploaded'
                          CHECK (status IN ('uploaded','attached','discarded')),
  attached_recording_id uuid REFERENCES public.class_recordings(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unmatched_user_status
  ON public.unmatched_recordings (user_id, status);

ALTER TABLE public.unmatched_recordings ENABLE ROW LEVEL SECURITY;

-- Coach reads/writes only their own. service_role bypasses RLS.
DROP POLICY IF EXISTS "unmatched own rw" ON public.unmatched_recordings;
CREATE POLICY "unmatched own rw" ON public.unmatched_recordings
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.unmatched_recordings TO authenticated;
GRANT ALL ON public.unmatched_recordings TO service_role;

-- keep updated_at fresh
CREATE OR REPLACE FUNCTION public.touch_unmatched_recordings_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS unmatched_recordings_touch_updated_at ON public.unmatched_recordings;
CREATE TRIGGER unmatched_recordings_touch_updated_at
  BEFORE UPDATE ON public.unmatched_recordings
  FOR EACH ROW EXECUTE FUNCTION public.touch_unmatched_recordings_updated_at();
