-- ============================================================
-- Add extra metadata fields to class_inputs
-- ============================================================

ALTER TABLE public.class_inputs
  ADD COLUMN IF NOT EXISTS dance        TEXT,
  ADD COLUMN IF NOT EXISTS teacher_name TEXT;

-- lesson_type already exists (default 'private') — no change needed
