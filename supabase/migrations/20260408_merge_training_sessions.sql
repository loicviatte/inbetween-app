-- Merge training_sessions into practice_logs
-- Each practice session is now a single practice_log row.

ALTER TABLE practice_logs
  ADD COLUMN IF NOT EXISTS started_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS feeling       TEXT CHECK (feeling IN ('Hard', 'Struggled', 'Okay', 'Good', 'Great')),
  ADD COLUMN IF NOT EXISTS session_note  TEXT;

-- Migrate existing training_sessions data into practice_logs
-- One row per session, linked to slot1_focus_id (the primary focus)
INSERT INTO practice_logs (student_id, focus_point_id, started_at, completed_at, feeling, session_note, duration_minutes, rating)
SELECT
  ts.user_id,
  COALESCE(ts.slot1_focus_id, ts.slot2_focus_id),
  ts.started_at,
  ts.completed_at,
  ts.feeling,
  ts.session_note,
  CASE
    WHEN ts.completed_at IS NOT NULL
    THEN GREATEST(1, ROUND(EXTRACT(EPOCH FROM (ts.completed_at - ts.started_at)) / 60)::int)
    ELSE NULL
  END,
  CASE ts.feeling
    WHEN 'Hard'      THEN 'hard'
    WHEN 'Struggled' THEN 'struggled'
    WHEN 'Okay'      THEN 'okay'
    WHEN 'Good'      THEN 'good'
    WHEN 'Great'     THEN 'great'
    ELSE 'okay'
  END
FROM training_sessions ts
WHERE ts.completed_at IS NOT NULL
  AND COALESCE(ts.slot1_focus_id, ts.slot2_focus_id) IS NOT NULL;

DROP TABLE IF EXISTS training_sessions;
