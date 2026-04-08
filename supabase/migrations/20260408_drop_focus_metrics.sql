-- Drop legacy focus_metrics table — all data now lives on focus_points:
--   importance + struggle → base_score
--   practice              → practice_count
--   coach_signal          → coach_signal (already on focus_points)
--   last_practiced_at     → last_exposed_at (already on focus_points)

DROP TABLE IF EXISTS focus_metrics;
