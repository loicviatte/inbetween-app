-- Wave 1 perf: category-scoped + fuller coach student-detail bundle for the
-- Start Class briefing. Collapses loadStudentDetail's ~8 round-trips into ONE
-- RPC so a cold tap costs a single position in the RN socket queue instead of
-- eight (measured: cold phase1 was 48s, all of it client-side queue wait).
--
-- This is a NEW 2-arg overload: get_coach_student_detail(uuid, text). The
-- existing 1-arg get_coach_student_detail(uuid) stays live untouched for the
-- StudentDetail screen caller (coachStorage.js) so nothing breaks mid-deploy.
--
-- The 2-arg body REUSES the 1-arg function for every shared block
-- (profile / focusPoints / lastClassDate / questions / pendingFps) via jsonb
-- merge (||), so those shapes can never drift from the original. It only adds:
--   * readiness  -> category-scoped (get_lesson_readiness(student, p_category)),
--                   overriding the 1-arg's NULL-category readiness
--   * openQuestions -> coach_messages status IN ('pending','dismissed')
--                      (mirrors getStudentOpenQuestions)
--   * activity   -> up to 40 most-recent events (training + class), matching
--                   getStudentRecentActivity's EXACT event shape so the client's
--                   trainedCount / last-class recap logic reads it unchanged.
--
-- SECURITY INVOKER (default): RLS applies as the calling coach, identical to the
-- inline JS queries. auth.uid() == getCoachId() (getCoachId is literally
-- supabase.auth.getUser().id), so withCurrentCoach is equivalent to the JS.
-- The class focus_points here use a direct correlated subquery (NOT a PostgREST
-- embed), so they are immune to the embed/RLS row-drop footgun the JS worked
-- around with a separate flat query.

-- NB: p_category has NO default on purpose. A default would make a 1-arg call
-- get_coach_student_detail(uuid) ambiguous between this overload and the
-- original 1-arg one (Postgres: "function is not unique"), which also breaks the
-- v_base self-call below. The client always passes p_category explicitly (null
-- for style-less students), so no default is needed.
CREATE OR REPLACE FUNCTION public.get_coach_student_detail(p_student uuid, p_category text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_coach_name text;
  v_base jsonb;
BEGIN
  SELECT name INTO v_coach_name FROM users WHERE id = auth.uid();

  -- Reuse the deployed 1-arg bundle for all shared blocks (no shape drift).
  v_base := public.get_coach_student_detail(p_student);

  RETURN v_base || jsonb_build_object(
    -- Override with category-scoped readiness (fixes 2-style Latin/Ballroom).
    'readiness', public.get_lesson_readiness(p_student, p_category),

    -- getStudentOpenQuestions: pending + dismissed (the coach's checklist).
    'openQuestions', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'message', message, 'status', status, 'created_at', created_at
      ) ORDER BY created_at DESC), '[]'::jsonb)
      FROM coach_messages
      WHERE student_id = p_student
        AND coach_id = auth.uid()
        AND status IN ('pending', 'dismissed')
    ),

    -- getStudentRecentActivity(student, 40): 40 most-recent events across
    -- training sessions (completed practice_logs) + classes (class_inputs),
    -- merged and date-desc-sorted. Field names mirror the JS exactly.
    'activity', (
      SELECT coalesce(jsonb_agg(ev ORDER BY sort_date DESC), '[]'::jsonb)
      FROM (
        SELECT sort_date, ev
        FROM (
          (
            SELECT pl.started_at AS sort_date,
              jsonb_build_object(
                'id', pl.id,
                'type', 'training',
                'date', pl.started_at,
                'durationMin', CASE
                  WHEN pl.completed_at IS NOT NULL
                  THEN round(extract(epoch FROM (pl.completed_at - pl.started_at)) / 60.0)::int
                  ELSE NULL END,
                'focusPointId', pl.focus_point_id,
                'focusName', (SELECT f.name FROM focus_points f WHERE f.id = pl.focus_point_id)
              ) AS ev
            FROM practice_logs pl
            WHERE pl.student_id = p_student
              AND pl.completed_at IS NOT NULL
            ORDER BY pl.started_at DESC
            LIMIT 40
          )
          UNION ALL
          (
            SELECT ci.created_at AS sort_date,
              jsonb_build_object(
                'id', ci.id,
                'type', 'class',
                'date', ci.created_at,
                'durationMin', NULL,
                'title', ci.title,
                'dance', ci.dance,
                'teacherName', ci.teacher_name,
                'withCurrentCoach', (
                  (ci.user_id = auth.uid())
                  OR (v_coach_name IS NOT NULL AND ci.teacher_name IS NOT NULL
                      AND lower(trim(ci.teacher_name)) = lower(trim(v_coach_name)))
                ),
                'classSummary', ci.class_summary,
                'lessonType', ci.lesson_type,
                'focusPoints', coalesce((
                  SELECT jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name))
                  FROM focus_points f
                  WHERE f.class_input_id = ci.id
                    AND f.user_id = p_student
                    AND f.is_other = false
                    AND f.is_deleted = false
                    AND f.status <> 'past'
                ), '[]'::jsonb)
              ) AS ev
            FROM class_inputs ci
            WHERE (ci.user_id = p_student OR ci.student_id = p_student)
              AND ci.is_deleted = false
            ORDER BY ci.created_at DESC
            LIMIT 40
          )
        ) combined
        ORDER BY sort_date DESC
        LIMIT 40
      ) t
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_coach_student_detail(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
