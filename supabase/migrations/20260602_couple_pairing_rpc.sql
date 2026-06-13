-- ============================================================
-- Couple Feature — M1: pairing finalize RPC
-- A validates B's configured request → create the couple atomically and
-- set users.couple_id on BOTH dancers (a client can't update the partner's
-- user row under RLS, hence SECURITY DEFINER).
-- Unpair needs no RPC: deleting the couples row cascades (FP/logs/locks) and
-- the users.couple_id FK is ON DELETE SET NULL for both members.
-- ============================================================

CREATE OR REPLACE FUNCTION public.finalize_couple(p_request_id uuid)
RETURNS public.couples
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r        public.couple_requests;
  v_couple public.couples;
BEGIN
  SELECT * INTO r FROM public.couple_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found'; END IF;
  IF r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'only the requester can validate'; END IF;
  IF r.status <> 'awaiting_validation' THEN RAISE EXCEPTION 'request not awaiting validation'; END IF;

  -- neither dancer may already be in a couple
  IF EXISTS (SELECT 1 FROM public.users u
             WHERE u.id IN (r.requester_id, r.target_id) AND u.couple_id IS NOT NULL) THEN
    RAISE EXCEPTION 'one of the dancers is already in a couple';
  END IF;

  -- leader must be one of the two dancers
  IF r.proposed_leader_id IS NULL OR r.proposed_leader_id NOT IN (r.requester_id, r.target_id) THEN
    RAISE EXCEPTION 'invalid leader';
  END IF;

  INSERT INTO public.couples (user_a_id, user_b_id, leader_user_id, does_latin, does_ballroom)
  VALUES (r.requester_id, r.target_id, r.proposed_leader_id,
          COALESCE(r.proposed_does_latin, false), COALESCE(r.proposed_does_ballroom, false))
  RETURNING * INTO v_couple;

  UPDATE public.users SET couple_id = v_couple.id WHERE id IN (r.requester_id, r.target_id);

  UPDATE public.couple_requests SET status = 'accepted' WHERE id = p_request_id;

  -- drop any other dangling requests involving either dancer
  DELETE FROM public.couple_requests
   WHERE id <> p_request_id
     AND (requester_id IN (r.requester_id, r.target_id)
          OR target_id IN (r.requester_id, r.target_id));

  RETURN v_couple;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_couple(uuid) TO authenticated;
