-- ============================================================
-- Couple Feature — M3: couple classes through the recording pipeline.
-- Additive: class_recordings gets couple_id; finalize_recording_atomic copies
-- it onto class_inputs and propagates the two dancers to class_input_students
-- (so yoda-extract loads both). Private/group paths unchanged.
-- (Replicates the live prod definition — TABLE(class_input_id, was_created) —
--  plus the two couple additions.)
-- ============================================================

ALTER TABLE public.class_recordings
  ADD COLUMN IF NOT EXISTS couple_id uuid REFERENCES public.couples(id) ON DELETE SET NULL;

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

  INSERT INTO class_inputs (user_id, transcript, lesson_type, student_id, couple_id, audio_path, status)
  VALUES (
    v_rec.user_id, p_transcript, v_rec.lesson_type,
    CASE WHEN v_rec.lesson_type = 'private' THEN v_rec.student_id ELSE NULL END,
    v_rec.couple_id,
    p_audio_folder, 'pending'
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

REVOKE ALL ON FUNCTION public.finalize_recording_atomic(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_recording_atomic(uuid, text, text) TO service_role;
