-- ============================================================
-- Class recordings pipeline — server-side audio orchestration.
--
-- Coach records a class as 3-min m4a chunks. Chunks are uploaded to
-- Supabase Storage during/after recording. When the coach hits Done,
-- an edge function (finalize-class) creates AssemblyAI transcript jobs
-- with a webhook URL pointing back to assemblyai-webhook. When all
-- chunks are transcribed, the webhook composes a final transcript with
-- cumulative offsets + per-chunk speaker re-labeling, INSERTs into
-- class_inputs (which triggers yoda-extract via the existing trigger),
-- and sends a push notification.
--
-- Idempotent throughout: every state transition is guarded so the
-- pg_cron retry sweep can safely re-invoke finalize-class on stuck
-- recordings without creating duplicate AssemblyAI jobs or class_inputs.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── class_recordings ─────────────────────────────────────────
-- One row per recording session. Status lifecycle:
--   recording  → coach is actively recording (or just stopped, before Done)
--   ready      → coach hit Done, expected_chunks set, all chunks should be uploaded
--   transcribing → finalize-class created AssemblyAI jobs, awaiting webhooks
--   completed  → class_input created, push sent, audio retained for cleanup
--   failed     → terminal failure, requires manual intervention
--   discarded  → coach explicitly threw it away
CREATE TABLE IF NOT EXISTS public.class_recordings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_type         text NOT NULL CHECK (lesson_type IN ('private', 'group')),
  student_id          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'recording'
                        CHECK (status IN ('recording','ready','transcribing','completed','failed','discarded')),
  started_at          timestamptz NOT NULL DEFAULT now(),
  ended_at            timestamptz,
  expected_chunks     integer,                 -- set on Done click; finalize waits until count(uploaded chunks) >= this
  last_heartbeat_at   timestamptz NOT NULL DEFAULT now(),
  audio_folder        text,                    -- e.g. "{user_id}/{recording_id}/" — convenience, derivable
  class_input_id      uuid REFERENCES public.class_inputs(id) ON DELETE SET NULL,
  error               text,
  meta                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Sanity check on the private/student_id pairing.
ALTER TABLE public.class_recordings
  DROP CONSTRAINT IF EXISTS class_recordings_private_has_student,
  ADD  CONSTRAINT class_recordings_private_has_student
       CHECK (lesson_type <> 'private' OR student_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_class_recordings_user_status
  ON public.class_recordings (user_id, status);

CREATE INDEX IF NOT EXISTS idx_class_recordings_status_heartbeat
  ON public.class_recordings (status, last_heartbeat_at)
  WHERE status IN ('recording','ready','transcribing');

CREATE INDEX IF NOT EXISTS idx_class_recordings_class_input
  ON public.class_recordings (class_input_id)
  WHERE class_input_id IS NOT NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_class_recordings_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS class_recordings_touch_updated_at ON public.class_recordings;
CREATE TRIGGER class_recordings_touch_updated_at
  BEFORE UPDATE ON public.class_recordings
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_class_recordings_updated_at();

-- ── class_recording_chunks ───────────────────────────────────
-- One row per audio chunk. Status lifecycle:
--   pending      → file exists locally, not yet in Storage
--   uploaded     → file in Storage at storage_path
--   transcribing → AssemblyAI job created, waiting for webhook
--   transcribed  → webhook received, transcript_json populated
--   failed       → transcription failed permanently (will be skipped in stitch)
CREATE TABLE IF NOT EXISTS public.class_recording_chunks (
  recording_id       uuid NOT NULL REFERENCES public.class_recordings(id) ON DELETE CASCADE,
  idx                integer NOT NULL CHECK (idx >= 0),
  storage_path       text,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','uploaded','transcribing','transcribed','failed')),
  duration_ms        integer,                          -- known after AssemblyAI completes
  assemblyai_job_id  text,
  transcript_json    jsonb,                            -- raw {utterances, text, audio_duration}
  speaker_labels     jsonb,                            -- {speakerId: 'Coach'|'Élève'}
  error              text,
  retries            integer NOT NULL DEFAULT 0,
  uploaded_at        timestamptz,
  transcribed_at     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recording_id, idx)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_assemblyai_job_id
  ON public.class_recording_chunks (assemblyai_job_id)
  WHERE assemblyai_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chunks_recording_status
  ON public.class_recording_chunks (recording_id, status);

DROP TRIGGER IF EXISTS class_recording_chunks_touch_updated_at ON public.class_recording_chunks;
CREATE TRIGGER class_recording_chunks_touch_updated_at
  BEFORE UPDATE ON public.class_recording_chunks
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_class_recordings_updated_at();

-- ── class_recording_students ─────────────────────────────────
-- For group lessons, the list of students captured at recording time.
-- At finalize, this list is propagated to class_input_students.
CREATE TABLE IF NOT EXISTS public.class_recording_students (
  recording_id  uuid NOT NULL REFERENCES public.class_recordings(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  PRIMARY KEY (recording_id, student_id)
);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.class_recordings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_recording_chunks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_recording_students ENABLE ROW LEVEL SECURITY;

-- class_recordings: a coach owns their recordings.
DROP POLICY IF EXISTS "own recordings select" ON public.class_recordings;
CREATE POLICY "own recordings select" ON public.class_recordings
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own recordings insert" ON public.class_recordings;
CREATE POLICY "own recordings insert" ON public.class_recordings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own recordings update" ON public.class_recordings;
CREATE POLICY "own recordings update" ON public.class_recordings
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- chunks: piggyback on the parent recording's ownership.
DROP POLICY IF EXISTS "own chunks select" ON public.class_recording_chunks;
CREATE POLICY "own chunks select" ON public.class_recording_chunks
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.class_recordings r
    WHERE r.id = recording_id AND r.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "own chunks insert" ON public.class_recording_chunks;
CREATE POLICY "own chunks insert" ON public.class_recording_chunks
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM public.class_recordings r
    WHERE r.id = recording_id AND r.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "own chunks update" ON public.class_recording_chunks;
CREATE POLICY "own chunks update" ON public.class_recording_chunks
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM public.class_recordings r
    WHERE r.id = recording_id AND r.user_id = auth.uid()
  ));

-- students: same — owned via parent recording.
DROP POLICY IF EXISTS "own recording students select" ON public.class_recording_students;
CREATE POLICY "own recording students select" ON public.class_recording_students
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.class_recordings r
    WHERE r.id = recording_id AND r.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "own recording students insert" ON public.class_recording_students;
CREATE POLICY "own recording students insert" ON public.class_recording_students
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM public.class_recordings r
    WHERE r.id = recording_id AND r.user_id = auth.uid()
  ));

-- Service role bypasses RLS automatically (used by edge functions and cron).

-- ── Storage bucket: class-audio ──────────────────────────────
-- Private bucket holding {user_id}/{recording_id}/{idx}.m4a
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'class-audio',
  'class-audio',
  false,
  52428800,  -- 50 MB per file (chunks are <1 MB; this is a generous cap)
  ARRAY['audio/m4a','audio/mp4','audio/aac','audio/x-m4a','application/octet-stream']
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage RLS: coach can read/write only their own folder.
DROP POLICY IF EXISTS "class-audio own folder rw" ON storage.objects;
CREATE POLICY "class-audio own folder rw" ON storage.objects
  FOR ALL
  USING (
    bucket_id = 'class-audio'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'class-audio'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Helper view: recordings that need the retry sweep ────────
-- Used by transcribe-class-retry cron. A recording needs attention if:
--  - status='ready' (Done clicked, finalize hasn't run/completed)  AND all chunks uploaded
--  - status='transcribing' AND last_heartbeat_at is too old (webhook lost)
CREATE OR REPLACE VIEW public.class_recordings_needing_retry AS
SELECT r.*
FROM public.class_recordings r
WHERE r.status IN ('ready','transcribing')
  AND r.last_heartbeat_at < now() - interval '10 minutes'
  AND (r.expected_chunks IS NULL OR (
    SELECT count(*) FROM public.class_recording_chunks c
    WHERE c.recording_id = r.id AND c.status IN ('uploaded','transcribing','transcribed')
  ) >= r.expected_chunks);

COMMENT ON VIEW public.class_recordings_needing_retry IS
  'Recordings the cron sweep should re-poke (heartbeat stale and chunks ready).';

-- ── Cron schedules ───────────────────────────────────────────
-- transcribe-class-retry runs every 5 min. Wired up below; the URL and
-- service-role key need to be substituted at deploy time. Same pattern as
-- the existing inbetween-monitor-report cron.
--
-- BEFORE RUNNING THIS BLOCK in a fresh environment, replace placeholders.
-- Re-running is safe (unschedule guard).
--
-- SELECT cron.unschedule('transcribe-class-retry')
--   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'transcribe-class-retry');
--
-- SELECT cron.schedule(
--   'transcribe-class-retry',
--   '*/5 * * * *',
--   $cron$
--   SELECT net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/transcribe-class-retry',
--     headers := jsonb_build_object(
--       'Content-Type',  'application/json',
--       'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
--     ),
--     body := '{}'::jsonb
--   );
--   $cron$
-- );

-- ── Cleanup cron: delete chunks + storage for completed recordings > 30d ─
-- Lightweight: drops chunk rows + Storage objects. The transcript stays in
-- class_inputs.transcript forever. Will be wired up later via cron.
--
-- SELECT cron.schedule(
--   'class-audio-cleanup',
--   '15 3 * * *',  -- 3:15 UTC every day
--   $cron$
--   DELETE FROM storage.objects
--   WHERE bucket_id = 'class-audio'
--     AND name LIKE (
--       SELECT string_agg(format('%s/%s/%%', user_id::text, id::text), ',')
--       FROM public.class_recordings
--       WHERE status = 'completed' AND updated_at < now() - interval '30 days'
--     );
--   DELETE FROM public.class_recording_chunks
--   WHERE recording_id IN (
--     SELECT id FROM public.class_recordings
--     WHERE status = 'completed' AND updated_at < now() - interval '30 days'
--   );
--   $cron$
-- );

COMMENT ON TABLE public.class_recordings IS
  'Server-side orchestration of audio recordings. One row per coach class. Replaces the previous client-only transcription path.';
COMMENT ON TABLE public.class_recording_chunks IS
  'Per-chunk state for a class_recordings entry. Driven by client uploads + AssemblyAI webhook callbacks.';
