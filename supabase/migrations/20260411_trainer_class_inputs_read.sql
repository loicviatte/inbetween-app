-- Allow the trainer account to read all class_inputs rows
-- (needed to display class titles in the Extract tab)
CREATE POLICY "class_inputs_trainer_read_all" ON class_inputs
  FOR SELECT
  USING (auth.jwt() ->> 'email' = 'loic@danceuniteduk.com');
