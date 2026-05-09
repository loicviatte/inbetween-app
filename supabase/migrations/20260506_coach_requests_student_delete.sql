-- ─────────────────────────────────────────────────────────────────────────────
-- Allow a student to delete their own coach_requests rows.
--
-- Why: when a student "unlinks" a coach, the client previously only nulled
-- users.{latin,ballroom}_coach_id. The matching coach_requests row stayed at
-- status='accepted', so the coach kept seeing the student in their list and
-- retained read access to the student's data via RLS joins through
-- coach_requests. From the student's perspective the unlink was a one-way
-- illusion.
--
-- Fix: give students DELETE permission on their own request rows so the
-- client can hard-delete on unlink. The relationship simply ceases to exist;
-- no audit trail is required for this product.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "coach_requests_student_delete" ON coach_requests;
CREATE POLICY "coach_requests_student_delete" ON coach_requests
  FOR DELETE USING (student_id = auth.uid());
