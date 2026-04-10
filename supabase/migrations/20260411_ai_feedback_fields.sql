-- Allow ai_feedback to store feedback on class-level fields (title, class_summary)
-- instead of only on ai_training_candidates versions.

ALTER TABLE ai_feedback
  ALTER COLUMN candidate_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS class_input_id UUID REFERENCES class_inputs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS field_name TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_feedback_class_input ON ai_feedback(class_input_id) WHERE class_input_id IS NOT NULL;
