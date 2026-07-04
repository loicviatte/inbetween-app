-- ============================================================
-- Recording-pipeline audit fixes (2026-07-04).
-- Three independent, additive fixes surfaced by the deep audit of the DJI
-- local-recording flow. All idempotent / safe to re-run.
-- ============================================================

-- ── 1. Allow 'couple' recordings (HIGH — data loss) ──────────
-- class_recordings.lesson_type was CHECK (lesson_type IN ('private','group'))
-- (20260429_class_recordings.sql:32) and never relaxed, but the client inserts
-- lesson_type='couple' for a couple class (StartClassScreen) and
-- finalize_recording_atomic already branches on lesson_type IN ('group','couple')
-- (20260603_couple_recordings.sql). Every couple class in recording mode was
-- rejected at INSERT with a 23514 check_violation → the whole class (transcript +
-- focus points for both dancers) silently lost. Widen the allowed set to match.
-- (The class_recordings_private_has_student CHECK stays satisfied: 'couple' is not
-- 'private', so student_id may be NULL.)
ALTER TABLE public.class_recordings
  DROP CONSTRAINT IF EXISTS class_recordings_lesson_type_check,
  ADD  CONSTRAINT class_recordings_lesson_type_check
       CHECK (lesson_type IN ('private', 'group', 'couple'));

-- ── 2. Let a coach DELETE their own chunks (RLS) ─────────────
-- class_recording_chunks has RLS enabled with SELECT/INSERT/UPDATE policies but
-- no FOR DELETE policy, so the client's stale-chunk prune (delete idx >= partCount
-- on a shrunk re-import) silently affected zero rows — a leftover higher-idx
-- chunk survived and finalize (which gates on COUNT, not idx-completeness) could
-- fold it into the transcript. Grant owner-scoped DELETE, mirroring the other
-- chunk policies, so the prune actually removes stale rows.
DROP POLICY IF EXISTS "own chunks delete" ON public.class_recording_chunks;
CREATE POLICY "own chunks delete" ON public.class_recording_chunks
  FOR DELETE USING (EXISTS (
    SELECT 1 FROM public.class_recordings r
    WHERE r.id = recording_id AND r.user_id = auth.uid()
  ));

-- ── 3. Retry sweep must not skip recordings with a failed chunk ──
-- The completeness gate counted chunks in ('uploaded','transcribing','transcribed')
-- but NOT 'failed'. A chunk that fails permanently (e.g. missing storage_path)
-- then makes ready-count < expected_chunks forever, so the recording never enters
-- the retry view and stays stuck in 'transcribing'/'ready'. Count terminally-failed
-- chunks toward completeness (matching the webhook's terminal = transcribed|failed
-- rule) so the sweep can pick it up and finalize on the chunks that DID transcribe.
CREATE OR REPLACE VIEW public.class_recordings_needing_retry AS
SELECT r.*
FROM public.class_recordings r
WHERE r.status IN ('ready','transcribing')
  AND r.last_heartbeat_at < now() - interval '10 minutes'
  AND (r.expected_chunks IS NULL OR (
    SELECT count(*) FROM public.class_recording_chunks c
    WHERE c.recording_id = r.id
      AND c.status IN ('uploaded','transcribing','transcribed','failed')
  ) >= r.expected_chunks);
