-- ─── focus_ai_chats ───────────────────────────────────────────────────────────
-- Persists AI coach conversations per student per focus point.
-- One row per (student_id, focus_point_id) pair — upserted on each message.

CREATE TABLE IF NOT EXISTS focus_ai_chats (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  focus_point_id   uuid NOT NULL REFERENCES focus_points(id) ON DELETE CASCADE,
  messages         jsonb NOT NULL DEFAULT '[]',
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (student_id, focus_point_id)
);

CREATE INDEX focus_ai_chats_student_idx ON focus_ai_chats(student_id);

ALTER TABLE focus_ai_chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students manage own chats"
  ON focus_ai_chats FOR ALL
  USING (student_id = auth.uid());
