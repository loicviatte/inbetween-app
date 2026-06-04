-- ============================================================
-- Couple Feature — M1 RLS: partner lookup + cross-read
-- The existing users invite-code lookup is coach-only
-- (users_invite_code_lookup: role='coach'). Partner pairing is
-- student↔student, so:
--   1) find_partner_by_code() — SECURITY DEFINER lookup that returns only the
--      matching student's minimal info (avoids exposing all student rows).
--   2) users_couple_read — lets a dancer read their partner's user row (name,
--      avatar) once paired, and the counterparty's row while a request is open.
-- ============================================================

CREATE OR REPLACE FUNCTION public.find_partner_by_code(p_code text)
RETURNS TABLE (id uuid, name text, couple_id uuid)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT u.id, u.name, u.couple_id
  FROM public.users u
  WHERE u.invite_code = upper(trim(p_code))
    AND u.role = 'student'
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.find_partner_by_code(text) TO authenticated;

DROP POLICY IF EXISTS "users_couple_read" ON public.users;
CREATE POLICY "users_couple_read" ON public.users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.couples c
      WHERE auth.uid() IN (c.user_a_id, c.user_b_id)
        AND users.id IN (c.user_a_id, c.user_b_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.couple_requests r
      WHERE (r.requester_id = auth.uid() AND r.target_id = users.id)
         OR (r.target_id = auth.uid() AND r.requester_id = users.id)
    )
  );
