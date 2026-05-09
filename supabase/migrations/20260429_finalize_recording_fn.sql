-- ============================================================
-- Atomic finalize-recording RPC.
--
-- Problem: when the last 2-3 chunks of a class come back from AssemblyAI
-- almost simultaneously, multiple invocations of `tryFinalizeRecording`
-- in `assemblyai-webhook` can race. Each loads `class_recordings`, sees
-- `class_input_id IS NULL`, and inserts into `class_inputs` — duplicating
-- the row and triggering `yoda-extract` twice.
--
-- Fix: encapsulate the "lock recording → INSERT class_inputs → link →
-- mark completed" sequence in a single SECURITY DEFINER function that
-- takes a row-level lock (`SELECT ... FOR UPDATE`). Concurrent callers
-- block on the lock; the second one re-reads the row, sees the now-set
-- `class_input_id`, and short-circuits.
--
-- Returns the class_input_id (newly created OR pre-existing).
-- ============================================================

CREATE OR REPLACE FUNCTION public.finalize_recording_atomic(
  p_recording_id uuid,
  p_transcript   text,
  p_audio_folder text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_rec        class_recordings%ROWTYPE;
  v_input_id   uuid;
BEGIN
  -- Take a row-level lock on the recording. Concurrent callers will
  -- queue here, ensuring exactly one finalize executes the INSERT below.
  SELECT *
    INTO v_rec
    FROM class_recordings
   WHERE id = p_recording_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'recording % not found', p_recording_id;
  END IF;

  -- Already finalized — return the existing class_input_id idempotently.
  IF v_rec.class_input_id IS NOT NULL THEN
    RETURN v_rec.class_input_id;
  END IF;

  -- Don't re-finalize a recording that was discarded or hard-failed.
  IF v_rec.status NOT IN ('ready', 'transcribing') THEN
    RAISE EXCEPTION 'recording % is in non-finalizable status %', p_recording_id, v_rec.status;
  END IF;

  -- Insert the canonical class_inputs row. The trigger on this table
  -- fires yoda-extract immediately.
  INSERT INTO class_inputs (
    user_id,
    transcript,
    lesson_type,
    student_id,
    audio_path,
    status
  )
  VALUES (
    v_rec.user_id,
    p_transcript,
    v_rec.lesson_type,
    CASE WHEN v_rec.lesson_type = 'private' THEN v_rec.student_id ELSE NULL END,
    p_audio_folder,
    'pending'
  )
  RETURNING id INTO v_input_id;

  -- Link the recording to its class_input and mark completed in the same
  -- transaction. Heartbeat refresh so the cron sweep doesn't pick it up.
  UPDATE class_recordings
     SET class_input_id    = v_input_id,
         status            = 'completed',
         last_heartbeat_at = now()
   WHERE id = p_recording_id;

  -- For group classes, propagate the recorded students to class_input_students.
  -- We do it inside the same transaction so a failure here rolls back
  -- the whole finalize.
  IF v_rec.lesson_type = 'group' THEN
    INSERT INTO class_input_students (class_input_id, student_id)
    SELECT v_input_id, student_id
      FROM class_recording_students
     WHERE recording_id = p_recording_id
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_input_id;
END;
$$;

COMMENT ON FUNCTION public.finalize_recording_atomic(uuid, text, text) IS
  'Atomic finalize: locks the recording row, inserts class_inputs once, links the recording. Safe under concurrent webhook callbacks.';

-- Allow service role to call it (anon/authenticated have no need).
REVOKE ALL ON FUNCTION public.finalize_recording_atomic(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_recording_atomic(uuid, text, text) TO service_role;
