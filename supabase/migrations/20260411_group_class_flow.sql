-- Table junction pour cours de groupe
CREATE TABLE IF NOT EXISTS class_input_students (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_input_id  UUID NOT NULL REFERENCES class_inputs(id) ON DELETE CASCADE,
  student_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attendance      TEXT NOT NULL DEFAULT 'pending'
                  CHECK (attendance IN ('pending', 'yes', 'no')),
  responded_at    TIMESTAMPTZ NULL,
  notified_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (class_input_id, student_id)
);
CREATE INDEX idx_cis_class_input ON class_input_students(class_input_id);
CREATE INDEX idx_cis_student ON class_input_students(student_id);
ALTER TABLE class_input_students ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cis_student_read_own" ON class_input_students FOR SELECT USING (student_id = auth.uid());
CREATE POLICY "cis_student_update_own" ON class_input_students FOR UPDATE USING (student_id = auth.uid());
CREATE POLICY "cis_service_all" ON class_input_students USING (true) WITH CHECK (true);

ALTER TABLE focus_points
  ADD COLUMN IF NOT EXISTS group_fp BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_class_input_id UUID REFERENCES class_inputs(id) ON DELETE SET NULL;
