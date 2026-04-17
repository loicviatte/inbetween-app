-- ============================================================
-- Backfill focus_score_history from past data sources.
-- Exact score deltas are not reconstructable (replaying the
-- scoring algorithm chronologically is out of scope), so
-- old_score / new_score / delta stay NULL for these rows — we
-- only surface that the action happened, its reason, and when.
-- ============================================================

-- ── 1. Practice logs → 'practice log' events ────────────────────────────────

INSERT INTO public.focus_score_history
  (focus_point_id, user_id, old_score, new_score, delta, reason, details, created_at)
SELECT
  pl.focus_point_id,
  pl.student_id,
  NULL, NULL, NULL,
  'practice log',
  jsonb_build_object(
    'duration_minutes', pl.duration_minutes,
    'rating',           pl.rating,
    'backfilled',       true
  ),
  pl.created_at
FROM public.practice_logs pl
JOIN public.focus_points fp ON fp.id = pl.focus_point_id
WHERE fp.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.focus_score_history h
    WHERE h.focus_point_id = pl.focus_point_id
      AND h.reason = 'practice log'
      AND h.created_at = pl.created_at
  );

-- ── 2. yoda_score_decisions → one row per individual decision ───────────────
-- `decisions` is a JSONB array of { action, fp_name, existing_fp_id?, ... }
-- Map each action to a reason label.

INSERT INTO public.focus_score_history
  (focus_point_id, user_id, old_score, new_score, delta, reason, details, created_at)
SELECT
  COALESCE(
    (d.decision ->> 'existing_fp_id')::uuid,
    fp_by_name.id
  )                                        AS focus_point_id,
  d.student_id                             AS user_id,
  NULL, NULL, NULL,
  CASE d.decision ->> 'action'
    WHEN 'create'          THEN 'created by coach-logged class'
    WHEN 'auto_merge'      THEN 'auto-merge'
    WHEN 'merge_request'   THEN 'merge request'
    WHEN 'signal_positive' THEN 'coach signal +'
    WHEN 'signal_negative' THEN 'coach signal -'
    ELSE d.decision ->> 'action'
  END                                      AS reason,
  jsonb_build_object(
    'fp_name',   d.decision ->> 'fp_name',
    'reasoning', d.decision ->> 'reasoning',
    'backfilled', true
  )                                        AS details,
  d.created_at
FROM (
  SELECT ysd.id, ysd.student_id, ysd.created_at, elem AS decision
  FROM public.yoda_score_decisions ysd,
       jsonb_array_elements(ysd.decisions) elem
) d
LEFT JOIN LATERAL (
  SELECT fp.id
  FROM public.focus_points fp
  WHERE fp.user_id = d.student_id
    AND lower(fp.name) = lower(d.decision ->> 'fp_name')
  LIMIT 1
) fp_by_name ON TRUE
WHERE COALESCE(
        (d.decision ->> 'existing_fp_id')::uuid,
        fp_by_name.id
      ) IS NOT NULL
  AND d.student_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.focus_score_history h
    WHERE h.focus_point_id = COALESCE(
            (d.decision ->> 'existing_fp_id')::uuid,
            fp_by_name.id
          )
      AND h.created_at = d.created_at
      AND (h.details ->> 'fp_name') = (d.decision ->> 'fp_name')
  );
