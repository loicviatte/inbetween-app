-- ============================================================
-- DEPLOY ORDER: migration 20260615f (ADD train_target to focus_points +
-- couple_focus_points) MUST be applied BEFORE this one — the RPCs below
-- reference the train_target column.
--
-- Focus-points rework: the readiness X/N target now comes from the stored
-- `train_target` column (which grows +2 per redo), not a fixed CASE on tier.
-- COALESCE keeps the old tier-based value as a fallback for any row where
-- train_target is null.
--
-- Also adds `is_archived IS NOT TRUE` to get_lesson_readiness (solo): an archived
-- focus must NOT appear in readiness / Train / Profile (it already drops from
-- get_all_focus_points + get_student_profile, which both filter is_archived).
-- Without it, archived-but-active rows leaked into the readiness card. Couple
-- readiness is unchanged — couple_focus_points has no is_archived column.
--
-- Also REMOVES the `is_held = false` filter from get_lesson_readiness (solo):
-- "Not yet" carry-overs (is_held=true) are normal active focuses now — they must
-- stay visible/trainable in readiness/Train until the coach validates them or
-- they're reconciled into a new class (no more "hide until 100% then graduate at
-- 15 min"). Couple readiness keeps its is_held filter (couple held-graduation is
-- a separate follow-up). Otherwise only target/done change vs 20260612b/c.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_lesson_readiness(p_user uuid, p_category text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
    AND (ci.lesson_type = 'private' OR ci.lesson_type IS NULL)
    AND ci.is_deleted IS NOT TRUE
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
    WHERE pl.student_id = p_user
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
$$;
GRANT EXECUTE ON FUNCTION public.get_lesson_readiness(uuid, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.get_couple_readiness(p_couple uuid, p_category text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
$$;
GRANT EXECUTE ON FUNCTION public.get_couple_readiness(uuid, text) TO authenticated;
