-- ============================================================
-- Perf: batch the coach's per-student readiness into ONE round-trip.
--
-- CoachHomeScreen / DashboardScreen compute the readiness ring for every
-- student with students.map(getLessonReadiness) — N separate RPC calls that the
-- free-tier pooler serializes (the "most ready for next private" sort feels
-- slow with many students). This runs get_lesson_readiness for the whole list
-- server-side and returns a { "<student_uuid>": <readiness|null> } map.
--
-- SECURITY INVOKER + the inner get_lesson_readiness is also INVOKER, so RLS is
-- enforced per student exactly as the N individual calls were (a coach only
-- gets readiness for students they're allowed to read).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_students_readiness(p_users uuid[], p_category text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT coalesce(
    jsonb_object_agg(u::text, public.get_lesson_readiness(u, p_category)),
    '{}'::jsonb
  )
  FROM unnest(p_users) AS u;
$$;
GRANT EXECUTE ON FUNCTION public.get_students_readiness(uuid[], text) TO authenticated;
