-- Fix class_inputs_read policy to allow students to see
-- classes logged BY their coach (where student_id = auth.uid())

DROP POLICY IF EXISTS "class_inputs_read" ON class_inputs;
CREATE POLICY "class_inputs_read" ON class_inputs
  FOR SELECT USING (
    user_id    = auth.uid()
    OR student_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = class_inputs.user_id
        AND (u.latin_coach_id = auth.uid() OR u.ballroom_coach_id = auth.uid())
    )
  );
