-- ============================================================
-- Atomic orphan→class reconciliation.
-- Attaching an already-uploaded orphan (unmatched_recordings) to a pending
-- class touches THREE tables (class_recording_chunks, class_recordings,
-- unmatched_recordings). Doing that as separate client statements is not
-- atomic and not concurrency-safe: a guard failing mid-way (e.g. a concurrent
-- mic-match already finalized the class) could leave the class pointing at the
-- WRONG audio, or two overlapping runs could double-attach. Do it in ONE
-- transaction with row locks instead. SECURITY INVOKER — RLS still applies, so
-- a coach can only reconcile their OWN orphan + class.
--
-- Returns true iff it attached; false if the orphan was already claimed or the
-- class is no longer pending (either → the whole transaction is a no-op).
-- ============================================================

CREATE OR REPLACE FUNCTION public.reconcile_attach_orphan(
  p_orphan_id uuid,
  p_class_id  uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_orphan public.unmatched_recordings%ROWTYPE;
  v_class  public.class_recordings%ROWTYPE;
  v_n      int;
  i        int;
  v_folder text;
BEGIN
  -- Lock the orphan; it must still be 'uploaded' (not already attached).
  SELECT * INTO v_orphan FROM public.unmatched_recordings WHERE id = p_orphan_id FOR UPDATE;
  IF NOT FOUND OR v_orphan.status <> 'uploaded' THEN RETURN false; END IF;
  v_n := array_length(v_orphan.storage_paths, 1);
  IF v_n IS NULL OR v_n = 0 THEN RETURN false; END IF;

  -- Lock the class; it must still be pending (no mic file attached yet). If a
  -- concurrent mic-match already claimed it, bail — the whole tx rolls back, so
  -- the class's real chunks are never touched.
  SELECT * INTO v_class FROM public.class_recordings WHERE id = p_class_id FOR UPDATE;
  IF NOT FOUND OR v_class.mic_file_name IS NOT NULL THEN RETURN false; END IF;

  -- Point the class's chunks at the orphan's already-uploaded m4a.
  DELETE FROM public.class_recording_chunks WHERE recording_id = p_class_id;
  FOR i IN 1 .. v_n LOOP
    INSERT INTO public.class_recording_chunks (recording_id, idx, storage_path, status)
    VALUES (p_class_id, i - 1, v_orphan.storage_paths[i], 'uploaded');
  END LOOP;

  v_folder := regexp_replace(v_orphan.storage_paths[1], '/[^/]*$', '/');

  UPDATE public.class_recordings SET
    status                = 'ready',
    expected_chunks       = v_n,
    audio_folder          = v_folder,
    last_heartbeat_at     = now(),
    mic_file_name         = v_orphan.part_filenames[1],
    mic_file_index        = v_orphan.dji_index,
    mic_file_timestamp    = v_orphan.mic_timestamp,
    mic_file_duration_sec = v_orphan.duration_sec,
    mic_file_size_bytes   = v_orphan.size_bytes,
    file_imported_at      = now(),
    match_confidence      = 'medium',
    admin_review_status   = 'pending',   -- a duration/date match is a guess → human review
    admin_reviewed_at     = NULL,
    meta                  = coalesce(meta, '{}'::jsonb)
                              || jsonb_build_object('mic_file_names', to_jsonb(v_orphan.part_filenames))
  WHERE id = p_class_id;

  UPDATE public.unmatched_recordings
     SET status = 'attached', attached_recording_id = p_class_id
   WHERE id = p_orphan_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_attach_orphan(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_attach_orphan(uuid, uuid) TO authenticated;
