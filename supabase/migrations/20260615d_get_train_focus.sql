-- ============================================================
-- Perf: collapse the Train screen's per-style data into ONE round-trip.
-- Toggling Latin/Ballroom (or a focus-triggered reload) ran getSlots (1) +
-- getCoupleSlots (1) + 2× getSessionCountForFocus — serialized by the free-tier
-- pooler into a multi-second staircase that times out and paints 0 focus points.
-- This returns everything the solo + couple Train cards + readiness rings need
-- for one dance category, in a single jsonb payload.
--
-- Mirrors getSlots(cat, readinessOnly=true) + getCoupleSlots(cid, cat) +
-- getSessionCountForFocus, reusing get_lesson_readiness / get_couple_readiness
-- (so the category predicate + targets stay identical). SECURITY INVOKER → same
-- RLS as the inline queries. Returns up to 3 slots each, in readiness order.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_train_focus(p_user uuid, p_category text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_couple_id   uuid;
  v_readiness   jsonb;
  v_creadiness  jsonb;
  v_solo_slots  jsonb;
  v_couple_slots jsonb;
  v_c1 int := 0;
  v_c2 int := 0;
BEGIN
  SELECT couple_id INTO v_couple_id FROM users WHERE id = p_user;

  -- SOLO ─ readinessOnly slots = full rows for the first 3 readiness focuses.
  v_readiness := public.get_lesson_readiness(p_user, p_category);
  WITH rf AS (
    SELECT (e->>'focusPointId')::uuid AS id, ord
    FROM jsonb_array_elements(COALESCE(v_readiness->'focuses', '[]'::jsonb))
         WITH ORDINALITY AS t(e, ord)
    WHERE ord <= 3
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(fp) ORDER BY rf.ord), '[]'::jsonb)
    INTO v_solo_slots
  FROM focus_points fp
  JOIN rf ON rf.id = fp.id
  WHERE fp.user_id = p_user;

  -- Session counts for slot1 + slot2 (all-time practice_logs, like getSessionCountForFocus).
  WITH rf AS (
    SELECT (e->>'focusPointId')::uuid AS id, ord
    FROM jsonb_array_elements(COALESCE(v_readiness->'focuses', '[]'::jsonb))
         WITH ORDINALITY AS t(e, ord)
    WHERE ord <= 2
  ),
  c AS (
    SELECT rf.ord, count(pl.id) AS cnt
    FROM rf
    LEFT JOIN practice_logs pl ON pl.focus_point_id = rf.id AND pl.student_id = p_user
    GROUP BY rf.ord
  )
  SELECT COALESCE(max(cnt) FILTER (WHERE ord = 1), 0),
         COALESCE(max(cnt) FILTER (WHERE ord = 2), 0)
    INTO v_c1, v_c2
  FROM c;

  -- COUPLE ─ same against the couple's shared focus points.
  IF v_couple_id IS NOT NULL THEN
    v_creadiness := public.get_couple_readiness(v_couple_id, p_category);
    WITH rf AS (
      SELECT (e->>'focusPointId')::uuid AS id, ord
      FROM jsonb_array_elements(COALESCE(v_creadiness->'focuses', '[]'::jsonb))
           WITH ORDINALITY AS t(e, ord)
      WHERE ord <= 3
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(cfp) ORDER BY rf.ord), '[]'::jsonb)
      INTO v_couple_slots
    FROM couple_focus_points cfp
    JOIN rf ON rf.id = cfp.id
    WHERE cfp.couple_id = v_couple_id;
  END IF;

  RETURN jsonb_build_object(
    'solo',   jsonb_build_object('slots', COALESCE(v_solo_slots, '[]'::jsonb), 'readiness', v_readiness),
    'couple', CASE WHEN v_couple_id IS NULL THEN NULL
                   ELSE jsonb_build_object('slots', COALESCE(v_couple_slots, '[]'::jsonb), 'readiness', v_creadiness) END,
    'sessionCounts', jsonb_build_object('slot1', v_c1, 'slot2', v_c2)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_train_focus(uuid, text) TO authenticated;

-- Rollback: DROP FUNCTION IF EXISTS public.get_train_focus(uuid, text);
