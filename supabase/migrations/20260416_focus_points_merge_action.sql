-- Stores the last AI merge decision applied to a focus point:
--   'auto_merge'   — the AI confirmed this FP is a duplicate of an existing one
--                    and was merged into it automatically.
--   'notify_coach' — the AI suspected a duplicate but asked the coach to decide.
--   null           — no merge event has touched this FP.
--
-- Used by the "Repetition rate" student metric: FPs with merge_action='auto_merge'
-- indicate the student keeps repeating the same theme across classes.
ALTER TABLE focus_points
  ADD COLUMN IF NOT EXISTS merge_action text NULL;
