-- Allow the trainer account (loic@danceuniteduk.com) to read all rows
-- across key tables, for use in the admin TrainerReviewScreen.

-- users: needed to list coaches and their students
CREATE POLICY "users_trainer_read_all" ON users
  FOR SELECT
  USING (auth.jwt() ->> 'email' = 'loic@danceuniteduk.com');

-- coach_requests: needed if querying student linkages via requests
CREATE POLICY "coach_requests_trainer_read_all" ON coach_requests
  FOR SELECT
  USING (auth.jwt() ->> 'email' = 'loic@danceuniteduk.com');

-- class_inputs: allow trainer to insert rows on behalf of any coach
CREATE POLICY "class_inputs_trainer_insert" ON class_inputs
  FOR INSERT
  WITH CHECK (auth.jwt() ->> 'email' = 'loic@danceuniteduk.com');
