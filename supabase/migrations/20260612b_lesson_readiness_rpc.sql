-- ============================================================
-- Perf: collapse the lesson-readiness waterfall into ONE round-trip.
--
-- storage.getLessonReadiness() ran 4 SEQUENTIAL queries (focus_points →
-- class_inputs → focus_points → practice_logs). On the Train screen that sits
-- on the critical path before the first focus card paints — ~6 sequential
-- round-trips total — so on a cold/free-tier backend it compounds into many
-- seconds. The SQL itself is sub-millisecond; the cost is purely the serial
-- network round-trips. This RPC does the whole computation server-side in a
-- single call, mirroring the JS logic exactly.
--
-- SECURITY INVOKER (not DEFINER): the function is also called by coaches for a
-- student's id (CoachHome / Dashboard / StudentDetail). Running as the invoker
-- means RLS is enforced on every table read exactly as it was when the JS fired
-- the queries directly — identical access, no privilege escalation.
--
-- Mirrors src/storage/storage.js getLessonReadiness + src/utils/danceCategory.js:
--   LATIN_DANCES, categoryFromDances, focusMatchesCategory,
--   targetForTier (critical→3 else 2), TIER_ORDER, SESSION_MINUTES = 7.
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
  -- Most recent PRIVATE class among the user's category-matching, non-past,
  -- non-other focus points (legacy rows with null lesson_type still count as
  -- private). focusMatchesCategory: untagged focuses (empty `dance`) match both.
  SELECT ci.id, ci.created_at
    INTO v_last
  FROM class_inputs ci
  WHERE ci.id IN (
          SELECT DISTINCT fp.class_input_id
          FROM focus_points fp
          WHERE fp.user_id = p_user
            AND fp.is_other = false
            AND fp.is_deleted IS NOT TRUE
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

  -- Primary (non-held) focuses produced by that anchor class + sessions done
  -- against them since the class. tier → target (critical 3, else 2); done is
  -- capped at target; sorted by tier rank.
  WITH fps AS (
    SELECT fp.id, fp.name, fp.tier
    FROM focus_points fp
    WHERE fp.user_id = p_user
      AND fp.class_input_id = v_last.id
      AND fp.is_other = false
      AND fp.is_deleted IS NOT TRUE
      AND fp.status <> 'past'
      AND (fp.is_held IS NULL OR fp.is_held = false)
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
      (CASE WHEN fps.tier = 'critical' THEN 3 ELSE 2 END) AS target,
      LEAST(CASE WHEN fps.tier = 'critical' THEN 3 ELSE 2 END, COALESCE(c.done, 0)) AS done,
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

  -- No primary focuses for the anchor class → null (matches JS).
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
