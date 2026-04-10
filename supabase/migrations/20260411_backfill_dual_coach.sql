-- Backfill latin_coach_id / ballroom_coach_id from existing accepted coach_requests.
-- Students who linked before the dual-coach feature have category = NULL — treat as
-- both-style (set both columns so queries work regardless of dance style).

UPDATE users u
SET
  latin_coach_id    = COALESCE(u.latin_coach_id,    cr.coach_id),
  ballroom_coach_id = COALESCE(u.ballroom_coach_id, cr.coach_id)
FROM coach_requests cr
WHERE cr.student_id = u.id
  AND cr.status     = 'accepted'
  AND cr.category   IS NULL;

UPDATE users u
SET latin_coach_id = COALESCE(u.latin_coach_id, cr.coach_id)
FROM coach_requests cr
WHERE cr.student_id = u.id
  AND cr.status     = 'accepted'
  AND cr.category   = 'latin';

UPDATE users u
SET ballroom_coach_id = COALESCE(u.ballroom_coach_id, cr.coach_id)
FROM coach_requests cr
WHERE cr.student_id = u.id
  AND cr.status     = 'accepted'
  AND cr.category   = 'ballroom';

-- ── Harden RLS with coach_requests fallback ───────────────────────────────────
-- In case a student is linked via coach_requests but columns aren't set yet.

DROP POLICY IF EXISTS "users_read_own_or_student" ON users;
CREATE POLICY "users_read_own_or_student" ON users
  FOR SELECT USING (
    id = auth.uid()
    OR latin_coach_id    = auth.uid()
    OR ballroom_coach_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM coach_requests cr
      WHERE cr.student_id = users.id
        AND cr.coach_id   = auth.uid()
        AND cr.status     = 'accepted'
    )
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
    OR EXISTS (
      SELECT 1 FROM coach_requests cr
      WHERE cr.student_id = focus_points.user_id
        AND cr.coach_id   = auth.uid()
        AND cr.status     = 'accepted'
    )
  );
