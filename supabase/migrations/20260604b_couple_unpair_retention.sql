-- ============================================================
-- Couple Feature — unpair keeps data for 30 days (in case they re-form).
-- The UI says "deleted", but the couple row + focus points + logs are
-- kept (soft delete via couples.unpaired_at); a sweep hard-deletes after
-- 30 days, and re-pairing the SAME two dancers restores the old couple.
-- ============================================================

-- 1) Soft-unpair marker (NULL = active couple).
ALTER TABLE public.couples ADD COLUMN IF NOT EXISTS unpaired_at timestamptz;

-- 2) One ACTIVE couple per user — the UNIQUE(user_a_id)/(user_b_id) must
--    ignore soft-deleted rows so a dancer can re-pair (with the same or a
--    new partner) while the old row lingers in its 30-day window.
ALTER TABLE public.couples DROP CONSTRAINT IF EXISTS couples_user_a_id_key;
ALTER TABLE public.couples DROP CONSTRAINT IF EXISTS couples_user_b_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS couples_user_a_active_uq
  ON public.couples(user_a_id) WHERE unpaired_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS couples_user_b_active_uq
  ON public.couples(user_b_id) WHERE unpaired_at IS NULL;

-- 3) Soft-unpair RPC — members can't clear the partner's users.couple_id
--    under RLS, hence SECURITY DEFINER. Keeps the couple data; just frees
--    both dancers and stamps unpaired_at.
CREATE OR REPLACE FUNCTION public.unpair_couple(p_couple uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.couples;
BEGIN
  SELECT * INTO c FROM public.couples WHERE id = p_couple;
  IF NOT FOUND THEN RAISE EXCEPTION 'couple not found'; END IF;
  IF auth.uid() NOT IN (c.user_a_id, c.user_b_id) THEN
    RAISE EXCEPTION 'not a couple member';
  END IF;
  IF c.unpaired_at IS NOT NULL THEN RETURN; END IF;

  UPDATE public.couples SET unpaired_at = now() WHERE id = p_couple;
  UPDATE public.users SET couple_id = NULL WHERE id IN (c.user_a_id, c.user_b_id);
  DELETE FROM public.couple_focus_locks WHERE couple_id = p_couple;
  DELETE FROM public.couple_requests
    WHERE requester_id IN (c.user_a_id, c.user_b_id)
       OR target_id IN (c.user_a_id, c.user_b_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.unpair_couple(uuid) TO authenticated;

-- 4) finalize_couple: if the SAME two dancers re-pair within the retention
--    window, REACTIVATE their old couple (focus points + history intact)
--    instead of starting a fresh empty one.
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
$$;
GRANT EXECUTE ON FUNCTION public.finalize_couple(uuid) TO authenticated;
