-- Allow a coach to read the user rows of every member of their studio,
-- even students who haven't sent (or accepted) a coach_request with them.
--
-- Why: the group-class flow now broadcasts attendance prompts to every
-- student in the coach's studio (yoda-extract → notifyGroupClassAttendance).
-- The coach screen needs to render those students by name + avatar in the
-- attendance roster. Without this policy the existing `users_*` policies
-- only let a coach see students who explicitly accepted them, so studio
-- members showed up as the generic "Student" fallback.
--
-- Implementation note — SECURITY DEFINER helper to avoid recursion:
-- A naive `EXISTS (SELECT 1 FROM users WHERE c.id = auth.uid() …)` inside
-- the policy re-triggers RLS on `users`, which triggers this policy
-- again → "infinite recursion detected in policy for relation users".
-- Wrapping the lookup in a SECURITY DEFINER function makes it run as the
-- function owner, bypassing RLS for that inner read.

CREATE OR REPLACE FUNCTION public.current_coach_studio_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT studio_id
    FROM public.users
   WHERE id = auth.uid()
     AND role = 'coach'
     AND studio_id IS NOT NULL
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.current_coach_studio_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_coach_studio_id() TO authenticated, anon, service_role;

DROP POLICY IF EXISTS "users_coach_reads_studio_members" ON public.users;

CREATE POLICY "users_coach_reads_studio_members" ON public.users
  FOR SELECT
  USING (
    studio_id IS NOT NULL
    AND studio_id = public.current_coach_studio_id()
  );
