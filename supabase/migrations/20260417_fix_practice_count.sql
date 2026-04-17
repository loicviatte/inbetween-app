-- ============================================================
-- Reset focus_points.practice_count so it matches the actual
-- number of rows in practice_logs per focus point.
-- The old client code was double-counting (+2 from client +
-- +1 from server). base_score was only mutated by the server
-- path so it stays correct — no adjustment needed there.
-- ============================================================

UPDATE public.focus_points fp
SET practice_count = COALESCE(counts.cnt, 0)
FROM (
  SELECT focus_point_id, COUNT(*)::int AS cnt
  FROM public.practice_logs
  GROUP BY focus_point_id
) counts
WHERE fp.id = counts.focus_point_id
  AND fp.practice_count IS DISTINCT FROM counts.cnt;

-- For FPs with no practice logs at all, zero them out if they're > 0.
UPDATE public.focus_points
SET practice_count = 0
WHERE practice_count > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.practice_logs pl
    WHERE pl.focus_point_id = focus_points.id
  );
