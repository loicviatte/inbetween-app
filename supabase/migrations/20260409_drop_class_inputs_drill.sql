-- Drills are now stored on focus_points.drill — remove redundant columns from class_inputs

ALTER TABLE public.class_inputs
  DROP COLUMN IF EXISTS drill,
  DROP COLUMN IF EXISTS drill_2;
