-- Add global session motivation to practice_logs.
-- 1 = Démotivé, 2 = Neutre, 3 = Motivé
-- Captured at the end of a focus training session alongside the per-focus
-- feeling. Used to compute the student Motivation score.

ALTER TABLE practice_logs
  ADD COLUMN IF NOT EXISTS session_motivation INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'practice_logs_session_motivation_check'
  ) THEN
    ALTER TABLE practice_logs
      ADD CONSTRAINT practice_logs_session_motivation_check
      CHECK (session_motivation IS NULL OR session_motivation IN (1, 2, 3));
  END IF;
END $$;
