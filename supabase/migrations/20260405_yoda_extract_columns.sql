-- ============================================================
-- Yoda Extract — add processing columns to class_inputs
-- ============================================================

ALTER TABLE public.class_inputs
  ADD COLUMN IF NOT EXISTS transcript      text,
  ADD COLUMN IF NOT EXISTS lesson_type     text    NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS student_ids     uuid[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS raw_ai_json     jsonb,
  ADD COLUMN IF NOT EXISTS status          text    NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS error_message   text,
  ADD COLUMN IF NOT EXISTS processed_at    timestamptz;

-- Index to quickly find rows waiting to be processed
CREATE INDEX IF NOT EXISTS idx_class_inputs_status
  ON public.class_inputs (status)
  WHERE status IN ('pending', 'processing', 'error');
