-- Allow coaches to read practice_logs of students they coach.
-- The existing "Users can manage own practice logs" policy (FOR ALL) is kept
-- so students can still insert/update/delete their own rows. This new policy
-- only adds SELECT access for coaches via the linking columns on users.

DROP POLICY IF EXISTS "practice_logs_coach_read" ON practice_logs;

CREATE POLICY "practice_logs_coach_read" ON practice_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = practice_logs.student_id
        AND (
          u.latin_coach_id    = auth.uid()
          OR u.ballroom_coach_id = auth.uid()
        )
    )
    OR EXISTS (
      -- Fallback: accepted request, in case user columns drift from requests
      SELECT 1 FROM coach_requests cr
      WHERE cr.student_id = practice_logs.student_id
        AND cr.coach_id   = auth.uid()
        AND cr.status     = 'accepted'
    )
  );
