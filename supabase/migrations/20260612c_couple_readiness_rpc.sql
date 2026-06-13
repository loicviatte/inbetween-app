-- ============================================================
-- Perf: same single-round-trip collapse as get_lesson_readiness, but for the
-- COUPLE card. coupleStorage.getCoupleReadiness ran 4 SEQUENTIAL queries
-- (couple_focus_points → class_inputs → couple_focus_points → couple_practice_logs).
-- On the Train screen the couple card is non-blocking + uncached, so when that
-- slow waterfall is slow/fails on a cold launch the couple focus never appears.
-- This computes it server-side in one call.
--
-- Mirrors src/storage/coupleStorage.js getCoupleReadiness:
--   anchor class is lesson_type = 'couple'; statuses exclude 'past' AND
--   'pending_coach'; counts come from couple_practice_logs; targets/SESSION_MINUTES
--   identical to the solo version. SECURITY INVOKER → same RLS as the inline
--   queries (couple members + couple-coach).
-- ============================================================

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
  -- Most recent COUPLE lesson among the couple's category-matching, active
  -- (non-past, non-pending_coach, non-other) focus points.
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
    SELECT cfp.id, cfp.name, cfp.tier
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
      (CASE WHEN fps.tier = 'critical' THEN 3 ELSE 2 END) AS target,
      LEAST(CASE WHEN fps.tier = 'critical' THEN 3 ELSE 2 END, COALESCE(c.done, 0)) AS done,
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
