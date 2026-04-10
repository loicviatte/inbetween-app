-- AI Training candidates: 3 versions per focus point per class input
CREATE TABLE IF NOT EXISTS ai_training_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_input_id UUID REFERENCES class_inputs(id) ON DELETE CASCADE,
  student_id UUID REFERENCES users(id) ON DELETE CASCADE,
  focus_point_index INT NOT NULL,      -- which FP in this class (0, 1, 2)
  versions JSONB NOT NULL,             -- array of 3 objects: [{title,subtitle,context,drill,dance}, ...]
  chosen_index INT NOT NULL DEFAULT 0, -- which version was sent to the student
  reviewed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trainer feedback on each version
CREATE TABLE IF NOT EXISTS ai_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID REFERENCES ai_training_candidates(id) ON DELETE CASCADE,
  version_index INT NOT NULL,   -- 0=chosen, 1=alt1, 2=alt2
  rating TEXT CHECK (rating IN ('good', 'ok', 'bad')) NOT NULL,
  comment TEXT,
  reviewer_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE ai_training_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_feedback ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (edge functions)
CREATE POLICY "service_all_candidates" ON ai_training_candidates USING (true) WITH CHECK (true);
CREATE POLICY "service_all_feedback" ON ai_feedback USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_candidates_reviewed ON ai_training_candidates(reviewed) WHERE reviewed = false;
CREATE INDEX IF NOT EXISTS idx_ai_feedback_candidate ON ai_feedback(candidate_id);
