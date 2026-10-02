-- A guard that a missing identity walks straight through.
--
-- Three functions defended themselves with an inequality:
--
--   IF auth.email() != admin_email() THEN RAISE …     -- trainer_insert_class_input
--   IF r.coach_id   <> auth.uid()   THEN RAISE …     -- respond_couple_coach_request
--   IF r.requester_id <> auth.uid() THEN RAISE …     -- finalize_couple
--
-- For a caller who is not signed in, auth.email() and auth.uid() are NULL. A
-- comparison with NULL is neither true nor false, IF treats that as false, the
-- RAISE is skipped, and the function carries on with the service's own rights.
-- All three were executable by the anonymous role.
--
-- The first was proven, in a transaction that was rolled back: holding only the
-- public key that ships inside the app, with a coach id read from the public
-- coach directory, an anonymous caller inserted a lesson into that coach's
-- account. A lesson insert is what wakes the extraction pipeline — the model
-- runs on whatever transcript was supplied, and its focus points head for the
-- students named. The other two would let an anonymous caller who knew a
-- request id accept a couple-coach request or pair a couple.
--
-- IS DISTINCT FROM treats NULL as a value, so a missing identity now fails the
-- guard like any wrong one. And none of these — nor any other function that
-- changes data or returns it — has a reason to be callable signed out, so the
-- anonymous role loses EXECUTE on them below. What it keeps: the password-reset
-- check, which runs before sign-in by definition, and the boolean helpers the
-- row policies call, which only ever answer about the caller and which would
-- turn an empty result into a permission error if taken away.

CREATE OR REPLACE FUNCTION public.trainer_insert_class_input(p_coach_id uuid, p_lesson_type text, p_student_id uuid, p_transcript text, p_created_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_id UUID;
BEGIN
  IF auth.email() IS DISTINCT FROM public.admin_email() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  INSERT INTO class_inputs (user_id, lesson_type, student_id, transcript, created_at, status, practice_point_1, is_deleted)
  VALUES (p_coach_id, p_lesson_type, p_student_id, p_transcript, p_created_at, 'pending', '…', false)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.respond_couple_coach_request(p_request_id uuid, p_accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r public.couple_coach_requests;
BEGIN
  SELECT * INTO r FROM public.couple_coach_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found'; END IF;
  IF r.coach_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'not your request'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'already handled'; END IF;

  IF p_accept THEN
    IF r.category = 'latin' THEN
      UPDATE public.couples SET latin_couple_coach_id = r.coach_id WHERE id = r.couple_id;
    ELSE
      UPDATE public.couples SET ballroom_couple_coach_id = r.coach_id WHERE id = r.couple_id;
    END IF;
    UPDATE public.couple_coach_requests SET status = 'accepted' WHERE id = p_request_id;
  ELSE
    UPDATE public.couple_coach_requests SET status = 'declined' WHERE id = p_request_id;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.finalize_couple(p_request_id uuid)
 RETURNS couples
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r        public.couple_requests;
  v_couple public.couples;
BEGIN
  SELECT * INTO r FROM public.couple_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found'; END IF;
  IF r.requester_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'only the requester can validate'; END IF;
  IF r.status <> 'awaiting_validation' THEN RAISE EXCEPTION 'request not awaiting validation'; END IF;

  IF EXISTS (SELECT 1 FROM public.users u
             WHERE u.id IN (r.requester_id, r.target_id) AND u.couple_id IS NOT NULL) THEN
    RAISE EXCEPTION 'one of the dancers is already in a couple';
  END IF;

  IF r.proposed_leader_id IS NULL OR r.proposed_leader_id NOT IN (r.requester_id, r.target_id) THEN
    RAISE EXCEPTION 'invalid leader';
  END IF;

  -- Re-form: restore the most recent soft-unpaired couple between these two.
  SELECT * INTO v_couple FROM public.couples
    WHERE unpaired_at IS NOT NULL
      AND ((user_a_id = r.requester_id AND user_b_id = r.target_id)
        OR (user_a_id = r.target_id AND user_b_id = r.requester_id))
    ORDER BY unpaired_at DESC LIMIT 1;

  IF FOUND THEN
    UPDATE public.couples
      SET unpaired_at    = NULL,
          leader_user_id = r.proposed_leader_id,
          does_latin     = COALESCE(r.proposed_does_latin, does_latin),
          does_ballroom  = COALESCE(r.proposed_does_ballroom, does_ballroom)
      WHERE id = v_couple.id
      RETURNING * INTO v_couple;
  ELSE
    INSERT INTO public.couples (user_a_id, user_b_id, leader_user_id, does_latin, does_ballroom)
    VALUES (r.requester_id, r.target_id, r.proposed_leader_id,
            COALESCE(r.proposed_does_latin, false), COALESCE(r.proposed_does_ballroom, false))
    RETURNING * INTO v_couple;
  END IF;

  UPDATE public.users SET couple_id = v_couple.id WHERE id IN (r.requester_id, r.target_id);
  UPDATE public.couple_requests SET status = 'accepted' WHERE id = p_request_id;
  DELETE FROM public.couple_requests
   WHERE id <> p_request_id
     AND (requester_id IN (r.requester_id, r.target_id)
          OR target_id IN (r.requester_id, r.target_id));

  RETURN v_couple;
END;
$function$
;

-- Nothing below has a signed-out use.
revoke execute on function public.trainer_insert_class_input(uuid, text, uuid, text, timestamptz) from public, anon;
revoke execute on function public.respond_couple_coach_request(uuid, boolean) from public, anon;
revoke execute on function public.finalize_couple(uuid) from public, anon;
revoke execute on function public.acquire_couple_lock(uuid, uuid, integer) from public, anon;
revoke execute on function public.heartbeat_couple_lock(uuid) from public, anon;
revoke execute on function public.release_couple_lock(uuid) from public, anon;
revoke execute on function public.cancel_couple_change(uuid) from public, anon;
revoke execute on function public.propose_couple_change(uuid, boolean, boolean, uuid) from public, anon;
revoke execute on function public.respond_couple_change(uuid, boolean) from public, anon;
revoke execute on function public.unpair_couple(uuid) from public, anon;
revoke execute on function public.get_pending_couple_coach_requests() from public, anon;
revoke execute on function public.coach_card_observed(uuid) from public, anon;
revoke execute on function public.lesson_minutes(uuid[]) from public, anon;
-- Trigger functions are not meant to be called at all.
revoke execute on function public.refuse_publish_before_release() from public, anon, authenticated;
revoke execute on function public.trg_release_on_admin_approval() from public, anon, authenticated;

-- The signed-in role keeps what the app calls.
grant execute on function public.trainer_insert_class_input(uuid, text, uuid, text, timestamptz) to authenticated;
grant execute on function public.respond_couple_coach_request(uuid, boolean) to authenticated;
grant execute on function public.finalize_couple(uuid) to authenticated;
grant execute on function public.acquire_couple_lock(uuid, uuid, integer) to authenticated;
grant execute on function public.heartbeat_couple_lock(uuid) to authenticated;
grant execute on function public.release_couple_lock(uuid) to authenticated;
grant execute on function public.cancel_couple_change(uuid) to authenticated;
grant execute on function public.propose_couple_change(uuid, boolean, boolean, uuid) to authenticated;
grant execute on function public.respond_couple_change(uuid, boolean) to authenticated;
grant execute on function public.unpair_couple(uuid) to authenticated;
grant execute on function public.get_pending_couple_coach_requests() to authenticated;
grant execute on function public.coach_card_observed(uuid) to authenticated;
grant execute on function public.lesson_minutes(uuid[]) to authenticated;

-- Rollback: restore the three comparisons and `grant execute … to anon`.
