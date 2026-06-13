-- Link a coach_message to the class where it was addressed verbally.
--
-- When the coach taps "covered" on a question during finishDebrief, the
-- question transitions to status='replied' with the sentinel reply text
-- "Covered in your last class." Until now, that closure had no link back
-- to the specific class — the class detail screen had no way to show
-- "here's everything you asked that I covered in this lesson."
--
-- covered_class_input_id is set ONLY by markQuestionCovered. Text replies
-- (replyToQuestion) leave it null. Read it from ClassDetailScreen to
-- render the "Questions covered in this class" block under the summary.

ALTER TABLE coach_messages
  ADD COLUMN IF NOT EXISTS covered_class_input_id UUID
    REFERENCES class_inputs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_coach_messages_covered_class
  ON coach_messages (covered_class_input_id)
  WHERE covered_class_input_id IS NOT NULL;
