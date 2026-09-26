-- Both readiness functions follow the same gate: the class is open.
--
-- 20260926b replaced "the admin approved it" with "it opened to its coach" —
-- the admin's approval, or four hours of silence. The solo readiness asked the
-- old question; the couple readiness asked none at all, which is how two couple
-- focus points reached their dancers 28 minutes before the class was checked.
--
-- Now both ask the same one. Everything else in either function is untouched.
--
-- Rollback: put back `ci.admin_approved_at IS NOT NULL` in the solo function
-- and drop the new line from the couple one.

CREATE OR REPLACE FUNCTION public.get_lesson_readiness(p_user uuid, p_category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  latin        text[] := ARRAY['Cha Cha','Samba','Rumba','Paso Doble','Jive'];
  v_uid        uuid := auth.uid();
  v_trainer    boolean := coalesce((auth.jwt() ->> 'email') = public.admin_email(), false);
  -- The service key (edge functions such as yoda-score) bypassed every policy.
  v_service    boolean := coalesce(auth.role() = 'service_role', false);
  v_self       boolean;
  v_guardian   boolean;
  v_coach      boolean;
  v_logs       boolean;
  v_last       record;
  v_focuses    jsonb;
  v_target_sum int := 0;
  v_done_sum   int := 0;
BEGIN
  -- Who may read this dancer's readiness — the focus_points read policy, checked
  -- once instead of on every row (row policies cost ~40x here).
  v_self := v_uid IS NOT NULL AND v_uid = p_user;
  v_guardian := public.is_guardian_of(p_user);
  v_coach := v_uid IS NOT NULL AND (
    EXISTS (SELECT 1 FROM coach_requests cr WHERE cr.coach_id = v_uid AND cr.student_id = p_user AND cr.status = 'accepted')
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = p_user AND (u.latin_coach_id = v_uid OR u.ballroom_coach_id = v_uid))
  );
  IF NOT (v_service OR v_self OR v_guardian OR v_coach OR v_trainer) THEN
    RETURN NULL;
  END IF;
  -- practice_logs' read policy has no trainer branch.
  v_logs := v_service OR v_self OR v_guardian OR v_coach;

  SELECT ci.id, ci.created_at
    INTO v_last
  FROM class_inputs ci
  WHERE ci.id IN (
          SELECT DISTINCT fp.class_input_id
          FROM focus_points fp
          WHERE fp.user_id = p_user
            AND fp.is_other = false
            AND fp.is_deleted IS NOT TRUE
            AND fp.is_archived IS NOT TRUE
            AND fp.status <> 'past'
            AND fp.class_input_id IS NOT NULL
            AND (
              p_category IS NULL
              OR fp.dance IS NULL OR cardinality(fp.dance) = 0
              OR (p_category = 'latin'    AND fp.dance && latin)
              OR (p_category = 'ballroom' AND NOT (fp.dance && latin))
            )
        )
    AND (ci.lesson_type IN ('private', 'couple') OR ci.lesson_type IS NULL)
    AND ci.is_deleted IS NOT TRUE
    -- the focus points' admin-approval policy, and the class read policy
    AND (v_service OR v_trainer OR ci.coach_released_at IS NOT NULL)
    AND (
      v_service
      OR v_trainer
      OR (ci.couple_id IS NOT NULL AND public.is_couple_participant(ci.couple_id))
      OR public.guardian_can_read_class_input(ci.id)
      OR ci.user_id = v_uid
      OR ci.student_id = v_uid
      OR EXISTS (SELECT 1 FROM users u WHERE u.id = ci.user_id AND (u.latin_coach_id = v_uid OR u.ballroom_coach_id = v_uid))
      OR EXISTS (SELECT 1 FROM users u WHERE u.id = v_uid AND (u.latin_coach_id = ci.user_id OR u.ballroom_coach_id = ci.user_id)
                   AND (ci.student_id = v_uid OR ci.student_id IS NULL))
      OR ci.user_id IN (SELECT cr.student_id FROM coach_requests cr WHERE cr.coach_id = v_uid AND cr.status = 'accepted')
    )
  ORDER BY ci.created_at DESC
  LIMIT 1;

  IF v_last.id IS NULL THEN
    RETURN NULL;
  END IF;

  WITH fps AS (
    SELECT fp.id, fp.name, fp.tier, fp.train_target
    FROM focus_points fp
    WHERE fp.user_id = p_user
      AND fp.class_input_id = v_last.id
      AND fp.is_other = false
      AND fp.is_deleted IS NOT TRUE
      AND fp.is_archived IS NOT TRUE
      AND fp.status <> 'past'
      AND (
        p_category IS NULL
        OR fp.dance IS NULL OR cardinality(fp.dance) = 0
        OR (p_category = 'latin'    AND fp.dance && latin)
        OR (p_category = 'ballroom' AND NOT (fp.dance && latin))
      )
  ),
  counts AS (
    SELECT pl.focus_point_id, count(*) AS done
    FROM practice_logs pl
    WHERE v_logs
      AND pl.student_id = p_user
      AND pl.focus_point_id IN (SELECT id FROM fps)
      AND pl.completed_at IS NOT NULL
      AND pl.completed_at >= v_last.created_at
    GROUP BY pl.focus_point_id
  ),
  rows AS (
    SELECT
      fps.id,
      fps.name,
      fps.tier,
      COALESCE(fps.train_target, CASE WHEN fps.tier = 'critical' THEN 3 ELSE 2 END) AS target,
      LEAST(COALESCE(fps.train_target, CASE WHEN fps.tier = 'critical' THEN 3 ELSE 2 END), COALESCE(c.done, 0)) AS done,
      (CASE fps.tier WHEN 'critical' THEN 0 WHEN 'important' THEN 1 WHEN 'supporting' THEN 2 ELSE 99 END) AS tier_order
    FROM fps
    LEFT JOIN counts c ON c.focus_point_id = fps.id
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object('focusPointId', id, 'name', name, 'tier', tier, 'target', target, 'done', done)
      ORDER BY tier_order, id
    ), '[]'::jsonb),
    COALESCE(sum(target), 0),
    COALESCE(sum(done), 0)
    INTO v_focuses, v_target_sum, v_done_sum
  FROM rows;

  IF v_focuses IS NULL OR jsonb_array_length(v_focuses) = 0 THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'lastClassDate',    v_last.created_at,
    'focuses',          v_focuses,
    'percent',          CASE WHEN v_target_sum > 0 THEN round((v_done_sum::numeric / v_target_sum) * 100)::int ELSE 0 END,
    'minutesRemaining', GREATEST(0, v_target_sum - v_done_sum) * 7
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_couple_readiness(p_couple uuid, p_category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  latin        text[] := ARRAY['Cha Cha','Samba','Rumba','Paso Doble','Jive'];
  v_last       record;
  v_focuses    jsonb;
  v_target_sum int := 0;
  v_done_sum   int := 0;
BEGIN
  SELECT ci.id, ci.created_at
    INTO v_last
  FROM class_inputs ci
  WHERE ci.id IN (
          SELECT DISTINCT cfp.class_input_id
          FROM couple_focus_points cfp
          WHERE cfp.couple_id = p_couple
            AND cfp.is_other = false
            AND cfp.is_deleted IS NOT TRUE
            AND cfp.status <> 'past'
            AND cfp.status <> 'pending_coach'
            AND cfp.class_input_id IS NOT NULL
            AND (
              p_category IS NULL
              OR cfp.dance IS NULL OR cardinality(cfp.dance) = 0
              OR (p_category = 'latin'    AND cfp.dance && latin)
              OR (p_category = 'ballroom' AND NOT (cfp.dance && latin))
            )
        )
    AND ci.lesson_type = 'couple'
    -- The couple side waits for the admin too. Until 20260926b it did not:
    -- a coach who approved his couple's focus points published them to both
    -- dancers before the class had been checked at all.
    AND ci.coach_released_at IS NOT NULL
    AND ci.is_deleted IS NOT TRUE
  ORDER BY ci.created_at DESC
  LIMIT 1;

  IF v_last.id IS NULL THEN
    RETURN NULL;
  END IF;

  WITH fps AS (
    SELECT cfp.id, cfp.name, cfp.tier, cfp.train_target
    FROM couple_focus_points cfp
    WHERE cfp.couple_id = p_couple
      AND cfp.class_input_id = v_last.id
      AND cfp.is_other = false
      AND cfp.is_deleted IS NOT TRUE
      AND cfp.status <> 'past'
      AND cfp.status <> 'pending_coach'
      AND (cfp.is_held IS NULL OR cfp.is_held = false)
      AND (
        p_category IS NULL
        OR cfp.dance IS NULL OR cardinality(cfp.dance) = 0
        OR (p_category = 'latin'    AND cfp.dance && latin)
        OR (p_category = 'ballroom' AND NOT (cfp.dance && latin))
      )
  ),
  counts AS (
    SELECT cpl.couple_focus_point_id AS fid, count(*) AS done
    FROM couple_practice_logs cpl
    WHERE cpl.couple_id = p_couple
      AND cpl.couple_focus_point_id IN (SELECT id FROM fps)
      AND cpl.completed_at IS NOT NULL
      AND cpl.completed_at >= v_last.created_at
    GROUP BY cpl.couple_focus_point_id
  ),
  rows AS (
    SELECT
      fps.id,
      fps.name,
      fps.tier,
      COALESCE(fps.train_target, CASE WHEN fps.tier = 'critical' THEN 3 ELSE 2 END) AS target,
      LEAST(COALESCE(fps.train_target, CASE WHEN fps.tier = 'critical' THEN 3 ELSE 2 END), COALESCE(c.done, 0)) AS done,
      (CASE fps.tier WHEN 'critical' THEN 0 WHEN 'important' THEN 1 WHEN 'supporting' THEN 2 ELSE 99 END) AS tier_order
    FROM fps
    LEFT JOIN counts c ON c.fid = fps.id
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object('focusPointId', id, 'name', name, 'tier', tier, 'target', target, 'done', done)
      ORDER BY tier_order, id
    ), '[]'::jsonb),
    COALESCE(sum(target), 0),
    COALESCE(sum(done), 0)
    INTO v_focuses, v_target_sum, v_done_sum
  FROM rows;

  IF v_focuses IS NULL OR jsonb_array_length(v_focuses) = 0 THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'lastClassDate',    v_last.created_at,
    'focuses',          v_focuses,
    'percent',          CASE WHEN v_target_sum > 0 THEN round((v_done_sum::numeric / v_target_sum) * 100)::int ELSE 0 END,
    'minutesRemaining', GREATEST(0, v_target_sum - v_done_sum) * 7
  );
END;
$function$
;
