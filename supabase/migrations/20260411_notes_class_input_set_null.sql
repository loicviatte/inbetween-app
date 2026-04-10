-- Change notes.class_input_id FK from RESTRICT to SET NULL
-- so deleting a class_input unlinks the note rather than blocking deletion.

ALTER TABLE notes
  DROP CONSTRAINT notes_linked_class_input_id_fkey;

ALTER TABLE notes
  ADD CONSTRAINT notes_linked_class_input_id_fkey
  FOREIGN KEY (linked_class_input_id)
  REFERENCES class_inputs(id)
  ON DELETE SET NULL;
