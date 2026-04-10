-- Columns required by yoda-score when inserting focus points from AI extraction

ALTER TABLE focus_points
  ADD COLUMN IF NOT EXISTS subtitle          text,
  ADD COLUMN IF NOT EXISTS context           text,
  ADD COLUMN IF NOT EXISTS dance             text[],
  ADD COLUMN IF NOT EXISTS mention_count     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS explicit_priority boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_timestamp   text,
  ADD COLUMN IF NOT EXISTS class_input_id    uuid REFERENCES class_inputs(id) ON DELETE SET NULL;
