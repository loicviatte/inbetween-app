-- ============================================================
-- Perf: collapse the All-focus-points screen's ~11 serial round-trips into ONE.
-- The screen fired getSoloReadinessFocuses (2) + getGroupFocusPointsRecent (2) +
-- getUser (1) + getMyCouple (4) + getCoupleReadinessFocuses (2), which the
-- free-tier pooler SERIALIZES into a multi-second staircase. This returns the
-- three card lists already shaped for the screen, in one jsonb payload.
--
-- Mirrors src/utils/algorithm.js getSoloReadinessFocuses + getGroupFocusPointsRecent
-- and src/storage/coupleStorage.js getCoupleReadinessFocuses. SECURITY INVOKER →
-- identical RLS to the inline queries. Category predicate identical to
-- get_lesson_readiness (untagged matches both; latin = dance && latin; ballroom =
-- NOT dance && latin).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_all_focus_points(p_user uuid, p_category text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  latin       text[] := ARRAY['Cha Cha','Samba','Rumba','Paso Doble','Jive'];
  v_style     text;
  v_couple_id uuid;
  v_readiness jsonb;
  v_creadiness jsonb;
  v_solo      jsonb;
  v_couple    jsonb := '[]'::jsonb;
  v_group     jsonb;
BEGIN
  SELECT dance_style, couple_id INTO v_style, v_couple_id FROM users WHERE id = p_user;

  -- SOLO: the readiness checklist of the last private (category-aware), as full
  -- focus_points rows + class meta + {_target,_done}, in readiness (tier) order.
  v_readiness := public.get_lesson_readiness(p_user, p_category);
  WITH rf AS (
    SELECT (e->>'focusPointId')::uuid AS id,
           (e->>'target')::int        AS target,
           (e->>'done')::int          AS done,
           ord
    FROM jsonb_array_elements(COALESCE(v_readiness->'focuses', '[]'::jsonb))
         WITH ORDINALITY AS t(e, ord)
  )
  SELECT COALESCE(jsonb_agg(
           to_jsonb(fp)
             || jsonb_build_object('_target', rf.target, '_done', rf.done)
             || jsonb_build_object('class_inputs', (
                  SELECT jsonb_build_object('id', ci.id, 'created_at', ci.created_at,
                           'class_summary', ci.class_summary, 'dance', ci.dance, 'teacher_name', ci.teacher_name)
                  FROM class_inputs ci WHERE ci.id = fp.class_input_id))
           ORDER BY rf.ord
         ), '[]'::jsonb)
    INTO v_solo
  FROM focus_points fp
  JOIN rf ON rf.id = fp.id
  WHERE fp.user_id = p_user
    AND fp.is_deleted = false AND fp.is_archived = false
    AND fp.status = 'active' AND fp.is_other = false AND fp.alias_of IS NULL;

  -- COUPLE: same against the couple's shared focus points + couple readiness.
  IF v_couple_id IS NOT NULL THEN
    v_creadiness := public.get_couple_readiness(v_couple_id, p_category);
    WITH rf AS (
      SELECT (e->>'focusPointId')::uuid AS id,
             (e->>'target')::int        AS target,
             (e->>'done')::int          AS done,
             ord
      FROM jsonb_array_elements(COALESCE(v_creadiness->'focuses', '[]'::jsonb))
           WITH ORDINALITY AS t(e, ord)
    )
    SELECT COALESCE(jsonb_agg(
             to_jsonb(cfp) || jsonb_build_object('_target', rf.target, '_done', rf.done)
             ORDER BY rf.ord
           ), '[]'::jsonb)
      INTO v_couple
    FROM couple_focus_points cfp
    JOIN rf ON rf.id = cfp.id
    WHERE cfp.couple_id = v_couple_id
      AND cfp.is_deleted = false AND cfp.is_other = false
      AND cfp.status <> 'past' AND cfp.status <> 'pending_coach';
  END IF;

  -- GROUP: active group focus points from the 2 most recent group classes the
  -- student attended, + class meta, newest class first.
  WITH gfp AS (
    SELECT fp.*, COALESCE(fp.source_class_input_id, fp.class_input_id) AS cls_id
    FROM focus_points fp
    WHERE fp.user_id = p_user
      AND fp.group_fp = true
      AND fp.is_deleted = false AND fp.is_archived = false
      AND fp.status = 'active' AND fp.is_other = false AND fp.alias_of IS NULL
      AND (
        p_category IS NULL
        OR fp.dance IS NULL OR cardinality(fp.dance) = 0
        OR (p_category = 'latin'    AND fp.dance && latin)
        OR (p_category = 'ballroom' AND NOT (fp.dance && latin))
      )
  ),
  classes AS (
    SELECT ci.id, ci.created_at, ci.teacher_name, ci.dance, ci.class_summary,
           row_number() OVER (ORDER BY ci.created_at DESC) AS rn
    FROM class_inputs ci
    WHERE ci.id IN (SELECT DISTINCT cls_id FROM gfp WHERE cls_id IS NOT NULL)
      AND ci.lesson_type IN ('group', 'public')
      AND ci.is_deleted IS NOT TRUE
  ),
  recent AS (SELECT * FROM classes WHERE rn <= 2)
  SELECT COALESCE(jsonb_agg(
           (to_jsonb(gfp) - 'cls_id')
             || jsonb_build_object('class_inputs', jsonb_build_object(
                  'id', r.id, 'created_at', r.created_at, 'class_summary', r.class_summary,
                  'dance', r.dance, 'teacher_name', r.teacher_name))
           ORDER BY r.rn, gfp.created_at DESC
         ), '[]'::jsonb)
    INTO v_group
  FROM gfp JOIN recent r ON r.id = gfp.cls_id;

  RETURN jsonb_build_object(
    'danceStyle', v_style,
    'couple',     CASE WHEN v_couple_id IS NULL THEN NULL ELSE jsonb_build_object('coupleId', v_couple_id) END,
    'solo',       COALESCE(v_solo, '[]'::jsonb),
    'couple_pts', COALESCE(v_couple, '[]'::jsonb),
    'group',      COALESCE(v_group, '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_all_focus_points(uuid, text) TO authenticated;

-- Rollback: DROP FUNCTION IF EXISTS public.get_all_focus_points(uuid, text);
