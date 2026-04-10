-- ============================================================
-- Coach Schema Migration
-- Adds coach/student roles, linking, messaging, and validation
-- ============================================================

-- 1. Extend users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'student',
  ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS coach_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Index for fast coach → students lookup
CREATE INDEX IF NOT EXISTS idx_users_coach_id ON users(coach_id);
-- Index for invite code lookup
CREATE INDEX IF NOT EXISTS idx_users_invite_code ON users(invite_code);

-- ============================================================
-- 2. Coach-student connection requests
-- Students initiate; coach accepts or declines.
-- ============================================================
CREATE TABLE IF NOT EXISTS coach_requests (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coach_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'declined'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, coach_id)
);

-- ============================================================
-- 3. Student → Coach messages (questions)
-- Stored separately from Coach IA chat (which is AI-only).
-- ============================================================
CREATE TABLE IF NOT EXISTS coach_messages (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coach_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  reply       TEXT,
  status      TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'replied' | 'dismissed'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  replied_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_coach_messages_coach_id ON coach_messages(coach_id);
CREATE INDEX IF NOT EXISTS idx_coach_messages_student_id ON coach_messages(student_id);

-- ============================================================
-- 4. Focus validations
-- Two types:
--   'completion' — student thinks they've mastered a focus
--   'flagged'    — student is unsure about a focus
-- ============================================================
CREATE TABLE IF NOT EXISTS focus_validations (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  focus_point_id  UUID NOT NULL REFERENCES focus_points(id) ON DELETE CASCADE,
  student_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coach_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL, -- 'completion' | 'flagged'
  student_note    TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  -- 'pending' | 'approved' | 'rejected' | 'addressed' | 'dismissed'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_focus_validations_coach_id ON focus_validations(coach_id);
CREATE INDEX IF NOT EXISTS idx_focus_validations_student_id ON focus_validations(student_id);

-- ============================================================
-- 5. Row Level Security policies
--
-- IMPORTANT: Enable RLS on each table before applying these.
-- Run these if RLS is not already enabled:
--   ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE focus_points ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE training_sessions ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE class_inputs ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE coach_requests ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE coach_messages ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE focus_validations ENABLE ROW LEVEL SECURITY;
-- ============================================================

-- users: a user can read their own row, or any row where coach_id = auth.uid()
DROP POLICY IF EXISTS "users_read_own_or_student" ON users;
CREATE POLICY "users_read_own_or_student" ON users
  FOR SELECT USING (
    id = auth.uid()
    OR coach_id = auth.uid()
  );

DROP POLICY IF EXISTS "users_update_own" ON users;
CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (id = auth.uid());

-- focus_points: own rows, or rows of students coached by me
DROP POLICY IF EXISTS "focus_points_read" ON focus_points;
CREATE POLICY "focus_points_read" ON focus_points
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = focus_points.user_id
        AND u.coach_id = auth.uid()
    )
  );

-- training_sessions: skipped — table no longer exists (replaced by practice_logs)

-- class_inputs: own rows, or class inputs of my students
DROP POLICY IF EXISTS "class_inputs_read" ON class_inputs;
CREATE POLICY "class_inputs_read" ON class_inputs
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = class_inputs.user_id
        AND u.coach_id = auth.uid()
    )
  );

-- coach_requests: student can read/create their own; coach can read requests addressed to them
DROP POLICY IF EXISTS "coach_requests_read" ON coach_requests;
CREATE POLICY "coach_requests_read" ON coach_requests
  FOR SELECT USING (student_id = auth.uid() OR coach_id = auth.uid());

DROP POLICY IF EXISTS "coach_requests_insert" ON coach_requests;
CREATE POLICY "coach_requests_insert" ON coach_requests
  FOR INSERT WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "coach_requests_update" ON coach_requests;
CREATE POLICY "coach_requests_update" ON coach_requests
  FOR UPDATE USING (coach_id = auth.uid());

-- coach_messages: student can insert their own; coach can read and update (reply) messages sent to them
DROP POLICY IF EXISTS "coach_messages_read" ON coach_messages;
CREATE POLICY "coach_messages_read" ON coach_messages
  FOR SELECT USING (student_id = auth.uid() OR coach_id = auth.uid());

DROP POLICY IF EXISTS "coach_messages_insert" ON coach_messages;
CREATE POLICY "coach_messages_insert" ON coach_messages
  FOR INSERT WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "coach_messages_update" ON coach_messages;
CREATE POLICY "coach_messages_update" ON coach_messages
  FOR UPDATE USING (coach_id = auth.uid());

-- focus_validations: student can insert; coach can read and update
DROP POLICY IF EXISTS "focus_validations_read" ON focus_validations;
CREATE POLICY "focus_validations_read" ON focus_validations
  FOR SELECT USING (student_id = auth.uid() OR coach_id = auth.uid());

DROP POLICY IF EXISTS "focus_validations_insert" ON focus_validations;
CREATE POLICY "focus_validations_insert" ON focus_validations
  FOR INSERT WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "focus_validations_update" ON focus_validations;
CREATE POLICY "focus_validations_update" ON focus_validations
  FOR UPDATE USING (coach_id = auth.uid());
