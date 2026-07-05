-- ============================================================
-- Atomic "confirm audio match with reassignment".
-- The admin dashboard confirm rewrites class_recordings + class_input_students +
-- (soft-)clears prior focus points + re-arms extraction on class_inputs. Doing
-- that as separate client statements was neither atomic nor race-safe: a
-- non-pending confirm (two admins / retry) still ran the destructive writes, a
-- mid-way failure left a split-brain state, and a hard DELETE of focus_points
-- would CASCADE practice_logs / focus_score_history / focus_point_edits, etc.
-- One transactional RPC fixes all of it. SECURITY INVOKER (called by the admin's
-- service-role client, which bypasses RLS anyway); the admin id is passed in.
--
-- Returns true iff it confirmed; false if the recording was no longer 'pending'
-- (→ a true no-op, no destructive work).
-- ============================================================

CREATE OR REPLACE FUNCTION public.confirm_audio_match(
  p_recording_id uuid,
  p_lesson_type  text,        -- 'private' | 'group' | 'couple'
  p_style        text,        -- 'latin' | 'ballroom'
  p_student_ids  uuid[],      -- private → 1, group → N; ignored for couple
  p_couple_id    uuid,        -- couple only
  p_admin_id     uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_rec       public.class_recordings%ROWTYPE;
  v_input_id  uuid;
  v_members   uuid[];
  v_private   uuid;
  v_couple_id uuid;
BEGIN
  -- Guard: only a still-pending recording can be confirmed (lock it first so a
  -- concurrent confirm/reset serialises and the loser sees the new status).
  SELECT * INTO v_rec FROM public.class_recordings WHERE id = p_recording_id FOR UPDATE;
  IF NOT FOUND OR v_rec.admin_review_status <> 'pending' THEN RETURN false; END IF;
  v_input_id := v_rec.class_input_id;

  IF p_style IS NULL THEN RAISE EXCEPTION 'style required'; END IF;

  -- Resolve + validate the member set.
  IF p_lesson_type = 'couple' THEN
    v_couple_id := p_couple_id;
    IF v_couple_id IS NULL THEN RAISE EXCEPTION 'couple requires a couple_id'; END IF;
    SELECT ARRAY(
      SELECT x FROM (
        SELECT user_a_id AS x FROM public.couples WHERE id = v_couple_id
        UNION ALL SELECT user_b_id FROM public.couples WHERE id = v_couple_id
      ) s WHERE x IS NOT NULL
    ) INTO v_members;
    IF v_members IS NULL OR array_length(v_members, 1) IS NULL THEN RAISE EXCEPTION 'couple has no members'; END IF;
  ELSIF p_lesson_type = 'group' THEN
    v_members := ARRAY(SELECT DISTINCT s FROM unnest(coalesce(p_student_ids, '{}'::uuid[])) AS s WHERE s IS NOT NULL);
    IF array_length(v_members, 1) IS NULL THEN RAISE EXCEPTION 'group requires at least one student'; END IF;
  ELSIF p_lesson_type = 'private' THEN
    v_private := (coalesce(p_student_ids, '{}'::uuid[]))[1];
    IF v_private IS NULL THEN RAISE EXCEPTION 'private requires one student'; END IF;
    v_members := ARRAY[]::uuid[];
  ELSE
    RAISE EXCEPTION 'invalid lesson_type %', p_lesson_type;
  END IF;

  -- 1. Recording → approved + reassigned + style.
  UPDATE public.class_recordings SET
    admin_review_status = 'approved',
    admin_reviewed_at   = now(),
    admin_reviewed_by   = p_admin_id,
    lesson_type         = p_lesson_type,
    student_id          = v_private,
    couple_id           = v_couple_id,
    meta                = coalesce(meta, '{}'::jsonb) || jsonb_build_object('review_style', p_style)
  WHERE id = p_recording_id;

  IF v_input_id IS NOT NULL THEN
    -- 2. Rebuild the roster.
    DELETE FROM public.class_input_students WHERE class_input_id = v_input_id;
    IF array_length(v_members, 1) IS NOT NULL THEN
      INSERT INTO public.class_input_students (class_input_id, student_id)
      SELECT v_input_id, m FROM unnest(v_members) AS m
      ON CONFLICT DO NOTHING;
    END IF;

    -- 3. SOFT-delete any prior (pre-review) extraction on BOTH tables so
    --    re-extraction is clean — a hard DELETE would cascade practice_logs /
    --    score history / coach edits.
    UPDATE public.focus_points        SET is_deleted = true WHERE class_input_id = v_input_id AND is_deleted = false;
    UPDATE public.couple_focus_points SET is_deleted = true WHERE class_input_id = v_input_id AND is_deleted = false;

    -- 4. Reassign class_inputs, clear any prior reject flag, and re-arm
    --    extraction (raw_ai_json=null + status='pending'); this UPDATE re-fires
    --    the yoda-extract webhook, which now passes its gate (recording approved).
    UPDATE public.class_inputs SET
      lesson_type          = p_lesson_type,
      student_id           = v_private,
      student_ids          = CASE WHEN p_lesson_type = 'private'
                                  THEN (CASE WHEN v_private IS NULL THEN '{}'::uuid[] ELSE ARRAY[v_private] END)
                                  ELSE v_members END,
      couple_id            = v_couple_id,
      raw_ai_json          = NULL,
      status               = 'pending',
      admin_rejected_at    = NULL,
      admin_rejected_reason = NULL,
      admin_notes          = NULL
    WHERE id = v_input_id;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_audio_match(uuid, text, text, uuid[], uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_audio_match(uuid, text, text, uuid[], uuid, uuid) TO authenticated, service_role;
