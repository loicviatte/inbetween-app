-- Add drill column to focus_points
-- Stores the most recent drill given by the coach for this focus point

ALTER TABLE public.focus_points
  ADD COLUMN IF NOT EXISTS drill TEXT;
