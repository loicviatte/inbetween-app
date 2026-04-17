-- ============================================================
-- Allow coaches to insert notifications for their linked students.
-- Needed so the client-side "reject pending focus point" flow
-- can notify the student with the coach's reason.
-- ============================================================

DROP POLICY IF EXISTS "coach_insert_student_notifications" ON public.notifications;

CREATE POLICY "coach_insert_student_notifications" ON public.notifications
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.coach_requests cr
      WHERE cr.coach_id = auth.uid()
        AND cr.student_id = notifications.user_id
        AND cr.status = 'accepted'
    )
  );
