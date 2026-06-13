-- ============================================================
-- Perf: bundle the CORE of the coach's StudentDetail screen into one round-trip.
--
-- StudentDetailScreen fires ~10 parallel queries the free-tier pooler
-- serializes → the first open is slow. This collapses the 6 student-scoped core
-- pieces into a single jsonb payload. The 4 heavier / coach-global pieces stay
-- separate (analytics + cross-cutting): getStudentRecentActivity,
-- getAllStudentMetrics, getNotifications, merge_requests.
--
-- SECURITY INVOKER → RLS enforced exactly as the inline queries; auth.uid() is
-- the coach (used for the question filter + the last-private "is this my class"
-- match). Mirrors getStudentProfile / getStudentFocusPoints /
-- getStudentLastClassDate / getStudentQuestions / getPendingFocusPoints +
-- get_lesson_readiness.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_coach_student_detail(p_student uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_coach_name text;
BEGIN
  SELECT name INTO v_coach_name FROM users WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'profile', (
      SELECT jsonb_build_object(
        'id', u.id, 'name', u.name, 'dance_style', u.dance_style,
        'last_active_date', u.last_active_date, 'avatar_url', u.avatar_url,
        'photo_url', u.avatar_url,
        'studio', (SELECT jsonb_build_object('id', s.id, 'name', s.name) FROM studios s WHERE s.id = u.studio_id)
      )
      FROM users u WHERE u.id = p_student
    ),

    -- getStudentFocusPoints: active/past_candidate focuses + this-week practice
    -- rollup (count, total minutes, last feeling/time).
    'focusPoints', (
      WITH fps AS (
        SELECT id, name, subtitle, drill, status, tier, created_at
        FROM focus_points
        WHERE user_id = p_student AND is_deleted = false AND is_other = false
          AND status IN ('active', 'past_candidate')
      ),
      wl AS (
        SELECT pl.focus_point_id AS fid,
               count(*) AS week_count,
               sum(coalesce(pl.duration_minutes, 0)) AS total_dur,
               (array_agg(pl.feeling ORDER BY pl.created_at DESC))[1] AS last_feeling,
               max(pl.created_at) AS last_at
        FROM practice_logs pl
        WHERE pl.student_id = p_student
          AND pl.created_at >= now() - interval '7 days'
          AND pl.focus_point_id IN (SELECT id FROM fps)
        GROUP BY pl.focus_point_id
      )
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', f.id, 'name', f.name, 'subtitle', f.subtitle, 'drill', f.drill,
        'weekCount', coalesce(w.week_count, 0), 'totalDurationMin', coalesce(w.total_dur, 0),
        'lastFeeling', w.last_feeling, 'lastPracticedAt', w.last_at,
        'status', f.status, 'tier', f.tier
      ) ORDER BY f.created_at ASC), '[]'::jsonb)
      FROM fps f LEFT JOIN wl w ON w.fid = f.id
    ),

    -- getStudentLastClassDate: most recent PRIVATE that's mine (coach user_id or
    -- teacher_name match), else the most recent private at all.
    'lastClassDate', (
      WITH priv AS (
        SELECT created_at, user_id, teacher_name
        FROM class_inputs
        WHERE (user_id = p_student OR student_id = p_student)
          AND is_deleted = false
          AND (lesson_type = 'private' OR lesson_type IS NULL)
        ORDER BY created_at DESC
        LIMIT 30
      )
      SELECT coalesce(
        (SELECT created_at FROM priv
          WHERE user_id = auth.uid()
             OR (v_coach_name IS NOT NULL AND lower(trim(teacher_name)) = lower(trim(v_coach_name)))
          ORDER BY created_at DESC LIMIT 1),
        (SELECT created_at FROM priv ORDER BY created_at DESC LIMIT 1)
      )
    ),

    'questions', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'message', message, 'created_at', created_at
      ) ORDER BY created_at DESC), '[]'::jsonb)
      FROM coach_messages
      WHERE student_id = p_student AND coach_id = auth.uid() AND status = 'pending'
    ),

    'pendingFps', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', fp.id, 'name', fp.name, 'subtitle', fp.subtitle, 'context', fp.context,
        'drill', fp.drill, 'tier', fp.tier, 'coach_review_deadline', fp.coach_review_deadline,
        'group_fp', fp.group_fp, 'shared_group_id', fp.shared_group_id,
        'source_class_input_id', fp.source_class_input_id, 'created_at', fp.created_at,
        'user_id', fp.user_id, 'dance', fp.dance, 'mention_count', fp.mention_count,
        'source_class_input', (
          SELECT jsonb_build_object(
            'title', ci.title, 'created_at', ci.created_at, 'class_summary', ci.class_summary,
            'practice_point_1', ci.practice_point_1, 'practice_point_2', ci.practice_point_2,
            'ai_primary_focus', ci.ai_primary_focus, 'ai_secondary_focus', ci.ai_secondary_focus,
            'lesson_type', ci.lesson_type, 'teacher_name', ci.teacher_name, 'dance', ci.dance
          )
          FROM class_inputs ci WHERE ci.id = fp.source_class_input_id
        )
      ) ORDER BY fp.created_at ASC), '[]'::jsonb)
      FROM focus_points fp
      WHERE fp.user_id = p_student AND fp.status = 'pending_coach'
        AND fp.is_other = false AND fp.is_deleted = false
    ),

    'readiness', public.get_lesson_readiness(p_student, NULL)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_coach_student_detail(uuid) TO authenticated;
