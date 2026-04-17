-- Allow the trainer account (loic@danceuniteduk.com) to read all focus_points.
-- Needed for the TrainerStudentsScreen which lists every student's FPs
-- ordered by base_score.

DROP POLICY IF EXISTS "focus_points_trainer_read_all" ON public.focus_points;
CREATE POLICY "focus_points_trainer_read_all" ON public.focus_points
  FOR SELECT
  USING (auth.jwt() ->> 'email' = 'loic@danceuniteduk.com');
