-- ─── coach_knowledge ──────────────────────────────────────────────────────────
-- Stores teaching principles, tips, metaphors and drills extracted from lesson
-- transcripts. Indexed by coach so the AI can quickly retrieve a coach's full
-- knowledge base when answering student questions.

CREATE TABLE IF NOT EXISTS coach_knowledge (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_class_input_id uuid REFERENCES class_inputs(id) ON DELETE SET NULL,
  type                  text NOT NULL CHECK (type IN ('tip', 'metaphor', 'drill', 'principle')),
  content               text NOT NULL,
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX coach_knowledge_coach_id_idx ON coach_knowledge(coach_id);

ALTER TABLE coach_knowledge ENABLE ROW LEVEL SECURITY;

-- Coaches can manage their own entries
CREATE POLICY "Coaches manage own knowledge"
  ON coach_knowledge FOR ALL
  USING (coach_id = auth.uid());

-- Students can read their coach's knowledge base
CREATE POLICY "Students read their coach knowledge"
  ON coach_knowledge FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.coach_id = coach_knowledge.coach_id
    )
  );
