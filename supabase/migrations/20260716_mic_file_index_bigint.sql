-- ============================================================
-- Widen mic-file index columns to bigint.
--
-- The bare-timestamp voice recorder (VOICE/RECORD) has no DJI-style index,
-- so the client synthesizes one from the filename timestamp — e.g.
-- 20260122084410 (~2e13). That fits a JS number fine but overflows the
-- int4 mic_file_index / dji_index columns, killing the import at its very
-- last step with: value "20260122084410" is out of range for type integer.
--
-- class_recordings_needing_retry selects mic_file_index, so the view is
-- dropped and recreated (verbatim definition) around the ALTER.
-- ============================================================

BEGIN;

DROP VIEW public.class_recordings_needing_retry;

ALTER TABLE public.class_recordings    ALTER COLUMN mic_file_index TYPE bigint;
ALTER TABLE public.unmatched_recordings ALTER COLUMN dji_index      TYPE bigint;

CREATE VIEW public.class_recordings_needing_retry AS
 SELECT id,
    user_id,
    lesson_type,
    student_id,
    status,
    started_at,
    ended_at,
    expected_chunks,
    last_heartbeat_at,
    audio_folder,
    class_input_id,
    error,
    meta,
    created_at,
    updated_at,
    local_recording_mode,
    admin_review_status,
    admin_reviewed_at,
    admin_reviewed_by,
    mic_file_name,
    mic_file_index,
    mic_file_timestamp,
    mic_file_duration_sec,
    mic_file_size_bytes,
    file_imported_at,
    deleted_from_mic_at,
    match_confidence,
    couple_id
   FROM class_recordings r
  WHERE (status = ANY (ARRAY['ready'::text, 'transcribing'::text])) AND last_heartbeat_at < (now() - '00:10:00'::interval) AND (expected_chunks IS NULL OR (( SELECT count(*) AS count
           FROM class_recording_chunks c
          WHERE c.recording_id = r.id AND (c.status = ANY (ARRAY['uploaded'::text, 'transcribing'::text, 'transcribed'::text, 'failed'::text])))) >= expected_chunks);
;

GRANT ALL ON public.class_recordings_needing_retry TO anon, authenticated, service_role;

COMMIT;
