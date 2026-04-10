-- Replace users.coach_id with latin_coach_id + ballroom_coach_id
-- latin_coach_id / ballroom_coach_id were added in 20260410_dual_coach_per_style.sql
--
-- IMPORTANT: DROP COLUMN CASCADE must come first — it removes all dependent
-- policies automatically. Policies are then recreated with the new columns.

-- ── 1. Drop users.coach_id (CASCADE removes dependent policies) ───────────────

DROP INDEX IF EXISTS idx_users_coach_id;
ALTER TABLE users DROP COLUMN IF EXISTS coach_id CASCADE;

-- ── 2. Recreate policies using latin_coach_id / ballroom_coach_id ─────────────

DROP POLICY IF EXISTS "users_read_own_or_student" ON users;
CREATE POLICY "users_read_own_or_student" ON users
  FOR SELECT USING (
    id = auth.uid()
    OR latin_coach_id    = auth.uid()
    OR ballroom_coach_id = auth.uid()
  );

DROP POLICY IF EXISTS "focus_points_read" ON focus_points;
CREATE POLICY "focus_points_read" ON focus_points
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = focus_points.user_id
        AND (u.latin_coach_id = auth.uid() OR u.ballroom_coach_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "class_inputs_read" ON class_inputs;
CREATE POLICY "class_inputs_read" ON class_inputs
  FOR SELECT USING (
    user_id = auth.uid()
    OR student_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = class_inputs.user_id
        AND (u.latin_coach_id = auth.uid() OR u.ballroom_coach_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND (u.latin_coach_id = class_inputs.user_id OR u.ballroom_coach_id = class_inputs.user_id)
        AND (class_inputs.student_id = auth.uid() OR class_inputs.student_id IS NULL)
    )
  );

DROP POLICY IF EXISTS "focus_metrics_select"    ON focus_metrics;
DROP POLICY IF EXISTS "focus_metrics_coach_read" ON focus_metrics;
CREATE POLICY "focus_metrics_coach_read" ON focus_metrics
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM focus_points fp
      JOIN users u ON u.id = fp.user_id
      WHERE fp.id = focus_metrics.focus_id
        AND (
          fp.user_id = auth.uid()
          OR u.latin_coach_id    = auth.uid()
          OR u.ballroom_coach_id = auth.uid()
        )
    )
  );

DROP POLICY IF EXISTS "Students read their coach knowledge" ON coach_knowledge;
CREATE POLICY "Students read their coach knowledge"
  ON coach_knowledge FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND (
          users.latin_coach_id    = coach_knowledge.coach_id
          OR users.ballroom_coach_id = coach_knowledge.coach_id
        )
    )
  );

-- ── 3. coach_requests unique constraint includes category ─────────────────────

ALTER TABLE coach_requests
  DROP CONSTRAINT IF EXISTS coach_requests_student_id_coach_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS coach_requests_student_coach_category_uniq
  ON coach_requests (student_id, coach_id, COALESCE(category, ''));

-- ── 4. Indexes on new coach columns ──────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_users_latin_coach_id    ON users(latin_coach_id);
CREATE INDEX IF NOT EXISTS idx_users_ballroom_coach_id ON users(ballroom_coach_id);
