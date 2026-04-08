-- ─── Add missing columns to focus_points ──────────────────────────────────────

ALTER TABLE focus_points ADD COLUMN IF NOT EXISTS base_score numeric NOT NULL DEFAULT 5;
ALTER TABLE focus_points ADD COLUMN IF NOT EXISTS practice_count integer NOT NULL DEFAULT 0;
ALTER TABLE focus_points ADD COLUMN IF NOT EXISTS reactivated boolean NOT NULL DEFAULT false;
ALTER TABLE focus_points ADD COLUMN IF NOT EXISTS last_exposed_at timestamp with time zone NULL;
ALTER TABLE focus_points ADD COLUMN IF NOT EXISTS lessons_since_mentioned integer NOT NULL DEFAULT 0;
ALTER TABLE focus_points ADD COLUMN IF NOT EXISTS is_other boolean NOT NULL DEFAULT false;
ALTER TABLE focus_points ADD COLUMN IF NOT EXISTS merge_status text NULL;
ALTER TABLE focus_points ADD COLUMN IF NOT EXISTS merge_candidate_id uuid NULL REFERENCES focus_points(id);
ALTER TABLE focus_points ADD COLUMN IF NOT EXISTS merge_notified_at timestamp with time zone NULL;
ALTER TABLE focus_points ADD COLUMN IF NOT EXISTS coach_signal numeric NOT NULL DEFAULT 0;
ALTER TABLE focus_points ADD COLUMN IF NOT EXISTS last_mentioned_at timestamp with time zone NULL;

ALTER TABLE focus_points
  ADD CONSTRAINT focus_points_merge_status_check
  CHECK (merge_status IN ('pending_coach', 'pending_student', 'merged', 'rejected'));

-- ─── Convert tier from integer to text ────────────────────────────────────────
-- Handles both integer values (1/2/3) and text values already in the new format

ALTER TABLE focus_points
  ALTER COLUMN tier TYPE text
  USING CASE
    WHEN tier::text = '1' OR tier::text = 'critical'   THEN 'critical'
    WHEN tier::text = '2' OR tier::text = 'important'  THEN 'important'
    ELSE 'supporting'
  END;

ALTER TABLE focus_points DROP CONSTRAINT IF EXISTS focus_points_tier_check;
ALTER TABLE focus_points ADD CONSTRAINT focus_points_tier_check
  CHECK (tier IN ('critical', 'important', 'supporting'));

-- Seed base_score from tier for existing rows
UPDATE focus_points SET base_score = CASE tier
  WHEN 'critical'   THEN 10
  WHEN 'important'  THEN 7
  ELSE 5
END WHERE base_score = 5;

-- ─── Update status constraint on focus_points ─────────────────────────────────

ALTER TABLE focus_points DROP CONSTRAINT IF EXISTS focus_points_status_check;
ALTER TABLE focus_points ADD CONSTRAINT focus_points_status_check
  CHECK (status IN ('active', 'past_candidate', 'past'));

-- ─── merge_requests table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS merge_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  focus_a     uuid NOT NULL REFERENCES focus_points(id) ON DELETE CASCADE,
  focus_b     uuid NOT NULL REFERENCES focus_points(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending_coach'
              CHECK (status IN ('pending_coach', 'pending_student', 'merged', 'rejected')),
  created_at  timestamp with time zone DEFAULT now(),
  resolved_at timestamp with time zone NULL,
  resolved_by text NULL CHECK (resolved_by IN ('coach', 'student', 'auto'))
);

ALTER TABLE merge_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own merge requests"
  ON merge_requests FOR SELECT
  USING (auth.uid() = student_id);

-- ─── practice_logs table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS practice_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  focus_point_id   uuid NOT NULL REFERENCES focus_points(id) ON DELETE CASCADE,
  duration_minutes integer NOT NULL,
  rating           text NOT NULL CHECK (rating IN ('hard', 'struggled', 'okay', 'good', 'great')),
  created_at       timestamp with time zone DEFAULT now()
);

ALTER TABLE practice_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own practice logs"
  ON practice_logs FOR ALL
  USING (auth.uid() = student_id);

-- ─── Add scored status to class_inputs ───────────────────────────────────────

ALTER TABLE class_inputs DROP CONSTRAINT IF EXISTS class_inputs_status_check;
ALTER TABLE class_inputs ADD CONSTRAINT class_inputs_status_check
  CHECK (status IN ('pending', 'processing', 'extracted', 'scored', 'error'));
