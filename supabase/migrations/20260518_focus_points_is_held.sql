-- Held focus points
--
-- When a coach marks a carryover focus as "Not yet" during the post-class
-- debrief, the focus stays on the student's roster but is held back from
-- the readiness checklist. It only re-enters the checklist once the
-- student has completed the new class's focuses (readiness == 100%).
--
-- Held focuses also have a different archive target: they're done after
-- 15 cumulative minutes of practice (vs the tier-based session count
-- used for fresh focuses). Both gates are evaluated client-side via
-- getLessonReadiness + completeTrainingSession.

ALTER TABLE focus_points
  ADD COLUMN IF NOT EXISTS is_held boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_focus_points_is_held
  ON focus_points (user_id)
  WHERE is_held = true;
