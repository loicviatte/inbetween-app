-- ============================================================
-- Fix: finalize_recording_atomic misdates delayed / local-mode imports.
--
-- Problem: the INSERT INTO class_inputs did not set created_at, so it
-- defaulted to now() = the finalize time. For same-day recordings that is
-- fine (finalize happens minutes after recording). But for DJI / local-mode
-- recordings that are imported and transcribed days later, created_at lands
-- on the import day instead of the lesson day. Both the coach
-- (CoachClassDetailScreen) and student (FocusSessionScreen, AllFocusPointsScreen)
-- read the class date from class_inputs.created_at, so the lesson surfaces
-- misdated (observed: a 2026-07-07 lesson shown as 2026-07-10).
--
-- Fix: set class_inputs.created_at from the recording's started_at (the
-- on-device record-start time = the true lesson time), falling back to the
-- recording row's own created_at. Both are non-null for real recordings, so
-- this can never regress a same-day finalize (there started_at ≈ now()).
--
-- Body is byte-for-byte the live couple-aware version (TABLE return,
-- couple_id propagation); the ONLY change is the added created_at column
-- + value in the INSERT.
-- ============================================================

CREATE OR REPLACE FUNCTION public.finalize_recording_atomic(
  p_recording_id uuid,
  p_transcript   text,
  p_audio_folder text
)
RETURNS TABLE(class_input_id uuid, was_created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_rec      class_recordings%ROWTYPE;
  v_input_id uuid;
BEGIN
  SELECT * INTO v_rec FROM class_recordings WHERE id = p_recording_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'recording % not found', p_recording_id; END IF;

  IF v_rec.class_input_id IS NOT NULL THEN
    class_input_id := v_rec.class_input_id;
    was_created    := false;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_rec.status NOT IN ('ready', 'transcribing') THEN
    RAISE EXCEPTION 'recording % is in non-finalizable status %', p_recording_id, v_rec.status;
  END IF;

  -- created_at is stamped from the recording's start time so delayed /
  -- local-mode imports keep the true lesson date instead of the import date.
  INSERT INTO class_inputs (user_id, transcript, lesson_type, student_id, couple_id, audio_path, status, created_at)
  VALUES (
    v_rec.user_id, p_transcript, v_rec.lesson_type,
    CASE WHEN v_rec.lesson_type = 'private' THEN v_rec.student_id ELSE NULL END,
    v_rec.couple_id,
    p_audio_folder, 'pending',
    COALESCE(v_rec.started_at, v_rec.created_at)
  )
  RETURNING id INTO v_input_id;

  UPDATE class_recordings
     SET class_input_id = v_input_id, status = 'completed', last_heartbeat_at = now()
   WHERE id = p_recording_id;

  -- Group AND couple classes propagate recorded students to the junction.
  IF v_rec.lesson_type IN ('group', 'couple') THEN
    INSERT INTO class_input_students (class_input_id, student_id)
    SELECT v_input_id, student_id FROM class_recording_students WHERE recording_id = p_recording_id
    ON CONFLICT DO NOTHING;
  END IF;

  class_input_id := v_input_id;
  was_created    := true;
  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.finalize_recording_atomic(uuid, text, text) IS
  'Atomic finalize: locks the recording row, inserts class_inputs once (dated from the recording start, not finalize time), links the recording, propagates group/couple students. Safe under concurrent webhook callbacks.';

REVOKE ALL ON FUNCTION public.finalize_recording_atomic(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_recording_atomic(uuid, text, text) TO service_role;
