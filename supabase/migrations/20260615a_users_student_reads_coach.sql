-- ============================================================
-- Fix: a student could not read their own coach's `users` row, so the Profile
-- "Your coach" section was always empty even with users.{latin,ballroom}_coach_id
-- set. Every existing SELECT policy on public.users grants reads to coaches/
-- trainers/couple-coaches, but none to a role='student' reading their coach.
--
-- _student_coach (20260612d) is SECURITY INVOKER, so its `JOIN users c ON
-- c.id = p.coach_id` runs under the student's RLS and returns 0 rows → NULL.
--
-- Helper is SECURITY DEFINER to avoid the policy recursing on public.users
-- (same pattern as current_coach_studio_id in 20260510).
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_my_coach(p_coach uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND (u.latin_coach_id = p_coach OR u.ballroom_coach_id = p_coach)
  ) OR EXISTS (
    SELECT 1 FROM public.coach_requests cr
    WHERE cr.student_id = auth.uid()
      AND cr.coach_id = p_coach
      AND cr.status IN ('accepted', 'pending')
  );
$$;
REVOKE ALL ON FUNCTION public.is_my_coach(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_my_coach(uuid) TO authenticated;

DROP POLICY IF EXISTS "users_student_reads_coach" ON public.users;
CREATE POLICY "users_student_reads_coach" ON public.users
  FOR SELECT USING ( public.is_my_coach(users.id) );

-- Rollback:
--   DROP POLICY IF EXISTS "users_student_reads_coach" ON public.users;
--   DROP FUNCTION IF EXISTS public.is_my_coach(uuid);
