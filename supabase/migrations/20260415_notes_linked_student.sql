-- Allow notes to be linked to a student (used by the coach notes feature).
-- Column is nullable; deleting the linked student simply unlinks the note.

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS linked_student_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notes_linked_student_id_fkey'
  ) THEN
    ALTER TABLE notes
      ADD CONSTRAINT notes_linked_student_id_fkey
      FOREIGN KEY (linked_student_id)
      REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS notes_linked_student_id_idx
  ON notes(linked_student_id);
