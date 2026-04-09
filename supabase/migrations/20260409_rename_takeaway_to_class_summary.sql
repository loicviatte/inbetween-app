-- ============================================================
-- Rename class_inputs.takeaway → class_inputs.class_summary
-- ============================================================

ALTER TABLE public.class_inputs
  RENAME COLUMN takeaway TO class_summary;
