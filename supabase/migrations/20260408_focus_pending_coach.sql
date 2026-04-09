-- Add pending_coach status and review deadline to focus_points
ALTER TABLE focus_points DROP CONSTRAINT IF EXISTS focus_points_status_check;
ALTER TABLE focus_points ADD CONSTRAINT focus_points_status_check
  CHECK (status IN ('pending_coach', 'active', 'past_candidate', 'past'));

ALTER TABLE focus_points
  ADD COLUMN IF NOT EXISTS coach_review_deadline timestamp with time zone NULL;
