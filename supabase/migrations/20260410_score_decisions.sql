CREATE TABLE IF NOT EXISTS yoda_score_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_input_id UUID REFERENCES class_inputs(id) ON DELETE CASCADE,
  student_id UUID REFERENCES users(id) ON DELETE CASCADE,
  student_name TEXT,
  decisions JSONB NOT NULL DEFAULT '[]',
  reviewed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS yoda_score_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id UUID REFERENCES yoda_score_decisions(id) ON DELETE CASCADE,
  decision_index INT NOT NULL,
  rating TEXT CHECK (rating IN ('good', 'ok', 'bad')) NOT NULL,
  comment TEXT,
  reviewer_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE yoda_score_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE yoda_score_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all_score_decisions" ON yoda_score_decisions USING (true) WITH CHECK (true);
CREATE POLICY "service_all_score_feedback" ON yoda_score_feedback USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_score_decisions_reviewed ON yoda_score_decisions(reviewed) WHERE reviewed = false;
