-- ============================================================
-- Couple Feature — M8: partner-approved config changes
--   After pairing, either dancer can PROPOSE a change to the couple's dance
--   styles or leader. The change is staged on couples.pending_change and only
--   applied once the OTHER dancer approves it. Both sides see the staged change
--   live (couples is already in the realtime publication) and the partner also
--   gets a push (each RPC INSERTs into public.notifications → send-push webhook).
-- ============================================================

-- 1) Staging columns — null when there's no pending change.
ALTER TABLE public.couples
  ADD COLUMN IF NOT EXISTS pending_change     jsonb,
  ADD COLUMN IF NOT EXISTS pending_change_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pending_change_at  timestamptz;

-- 2) Propose a change — member only. Stages the change + notifies the partner.
CREATE OR REPLACE FUNCTION public.propose_couple_change(
  p_couple uuid, p_does_latin boolean, p_does_ballroom boolean, p_leader uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.couples; v_other uuid; v_name text;
BEGIN
  SELECT * INTO c FROM public.couples WHERE id = p_couple;
  IF NOT FOUND THEN RAISE EXCEPTION 'couple not found'; END IF;
  IF auth.uid() NOT IN (c.user_a_id, c.user_b_id) THEN RAISE EXCEPTION 'not your couple'; END IF;
  IF NOT COALESCE(p_does_latin, false) AND NOT COALESCE(p_does_ballroom, false) THEN
    RAISE EXCEPTION 'pick at least one style';
  END IF;
  IF p_leader IS NULL OR p_leader NOT IN (c.user_a_id, c.user_b_id) THEN
    RAISE EXCEPTION 'invalid leader';
  END IF;

  UPDATE public.couples
  SET pending_change = jsonb_build_object(
        'does_latin', COALESCE(p_does_latin, false),
        'does_ballroom', COALESCE(p_does_ballroom, false),
        'leader_user_id', p_leader),
      pending_change_by = auth.uid(),
      pending_change_at = now()
  WHERE id = p_couple;

  v_other := CASE WHEN auth.uid() = c.user_a_id THEN c.user_b_id ELSE c.user_a_id END;
  SELECT name INTO v_name FROM public.users WHERE id = auth.uid();
  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (v_other, 'couple_change_proposed', 'Change to approve',
    COALESCE(split_part(v_name, ' ', 1), 'Your partner') || ' proposed a change to your couple setup.',
    jsonb_build_object('couple_id', p_couple));
END; $$;
GRANT EXECUTE ON FUNCTION public.propose_couple_change(uuid, boolean, boolean, uuid) TO authenticated;

-- 3) Approve / decline — the OTHER member only. Applies on accept, clears either
--    way, and notifies the proposer of the outcome.
CREATE OR REPLACE FUNCTION public.respond_couple_change(p_couple uuid, p_accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.couples; v_change jsonb; v_proposer uuid; v_name text;
BEGIN
  SELECT * INTO c FROM public.couples WHERE id = p_couple;
  IF NOT FOUND THEN RAISE EXCEPTION 'couple not found'; END IF;
  IF c.pending_change IS NULL THEN RAISE EXCEPTION 'no pending change'; END IF;
  IF auth.uid() NOT IN (c.user_a_id, c.user_b_id) THEN RAISE EXCEPTION 'not your couple'; END IF;
  IF auth.uid() = c.pending_change_by THEN RAISE EXCEPTION 'proposer cannot approve own change'; END IF;

  v_change := c.pending_change;
  v_proposer := c.pending_change_by;

  IF p_accept THEN
    UPDATE public.couples
    SET does_latin     = COALESCE((v_change->>'does_latin')::boolean, does_latin),
        does_ballroom  = COALESCE((v_change->>'does_ballroom')::boolean, does_ballroom),
        leader_user_id = COALESCE((v_change->>'leader_user_id')::uuid, leader_user_id),
        pending_change = NULL, pending_change_by = NULL, pending_change_at = NULL
    WHERE id = p_couple;
  ELSE
    UPDATE public.couples
    SET pending_change = NULL, pending_change_by = NULL, pending_change_at = NULL
    WHERE id = p_couple;
  END IF;

  SELECT name INTO v_name FROM public.users WHERE id = auth.uid();
  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (v_proposer,
    CASE WHEN p_accept THEN 'couple_change_accepted' ELSE 'couple_change_declined' END,
    CASE WHEN p_accept THEN 'Change approved' ELSE 'Change declined' END,
    COALESCE(split_part(v_name, ' ', 1), 'Your partner')
      || CASE WHEN p_accept THEN ' approved your couple change.' ELSE ' declined your couple change.' END,
    jsonb_build_object('couple_id', p_couple));
END; $$;
GRANT EXECUTE ON FUNCTION public.respond_couple_change(uuid, boolean) TO authenticated;

-- 4) Cancel — the proposer withdraws their own pending change. No notification.
CREATE OR REPLACE FUNCTION public.cancel_couple_change(p_couple uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.couples;
BEGIN
  SELECT * INTO c FROM public.couples WHERE id = p_couple;
  IF NOT FOUND THEN RAISE EXCEPTION 'couple not found'; END IF;
  IF auth.uid() IS DISTINCT FROM c.pending_change_by THEN RAISE EXCEPTION 'not your pending change'; END IF;
  UPDATE public.couples
  SET pending_change = NULL, pending_change_by = NULL, pending_change_at = NULL
  WHERE id = p_couple;
END; $$;
GRANT EXECUTE ON FUNCTION public.cancel_couple_change(uuid) TO authenticated;
