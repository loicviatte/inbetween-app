-- Allow coaches to read and update merge_requests of students they coach.
-- The existing "Users can read own merge requests" policy is kept so students
-- can still read their own rows when a merge escalates to pending_student.

DROP POLICY IF EXISTS "merge_requests_coach_read" ON merge_requests;
CREATE POLICY "merge_requests_coach_read" ON merge_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = merge_requests.student_id
        AND (
          u.latin_coach_id    = auth.uid()
          OR u.ballroom_coach_id = auth.uid()
        )
    )
    OR EXISTS (
      SELECT 1 FROM coach_requests cr
      WHERE cr.student_id = merge_requests.student_id
        AND cr.coach_id   = auth.uid()
        AND cr.status     = 'accepted'
    )
  );

DROP POLICY IF EXISTS "merge_requests_coach_update" ON merge_requests;
CREATE POLICY "merge_requests_coach_update" ON merge_requests
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = merge_requests.student_id
        AND (
          u.latin_coach_id    = auth.uid()
          OR u.ballroom_coach_id = auth.uid()
        )
    )
    OR EXISTS (
      SELECT 1 FROM coach_requests cr
      WHERE cr.student_id = merge_requests.student_id
        AND cr.coach_id   = auth.uid()
        AND cr.status     = 'accepted'
    )
  );
