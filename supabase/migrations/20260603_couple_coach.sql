-- ============================================================
-- Couple Feature — M2: couple-coach designation
--   1) users_couple_read extended so a couple-coach can read the two dancers'
--      rows (names/avatars for the roster + couple page).
--   2) respond_couple_coach_request — coach accepts/declines; on accept sets
--      couples.<category>_couple_coach_id (coach isn't a member, so SECURITY DEFINER).
--   3) get_pending_couple_coach_requests — coach lists pending requests with the
--      dancers' names (the couple isn't coach-readable until accepted).
-- ============================================================

DROP POLICY IF EXISTS "users_couple_read" ON public.users;
CREATE POLICY "users_couple_read" ON public.users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.couples c
      WHERE users.id IN (c.user_a_id, c.user_b_id)
        AND auth.uid() IN (c.user_a_id, c.user_b_id, c.latin_couple_coach_id, c.ballroom_couple_coach_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.couple_requests r
      WHERE (r.requester_id = auth.uid() AND r.target_id = users.id)
         OR (r.target_id = auth.uid() AND r.requester_id = users.id)
    )
  );

CREATE OR REPLACE FUNCTION public.respond_couple_coach_request(p_request_id uuid, p_accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.couple_coach_requests;
BEGIN
  SELECT * INTO r FROM public.couple_coach_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found'; END IF;
  IF r.coach_id <> auth.uid() THEN RAISE EXCEPTION 'not your request'; END IF;
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
$$;
GRANT EXECUTE ON FUNCTION public.respond_couple_coach_request(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_pending_couple_coach_requests()
RETURNS TABLE (id uuid, couple_id uuid, category text, dancer_a text, dancer_b text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.couple_id, r.category, ua.name, ub.name, r.created_at
  FROM public.couple_coach_requests r
  JOIN public.couples c ON c.id = r.couple_id
  JOIN public.users ua ON ua.id = c.user_a_id
  JOIN public.users ub ON ub.id = c.user_b_id
  WHERE r.coach_id = auth.uid() AND r.status = 'pending'
  ORDER BY r.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_pending_couple_coach_requests() TO authenticated;
