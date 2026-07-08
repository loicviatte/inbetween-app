-- ============================================================
-- Focus-points rework: tier becomes display-only; the X/N "how many sessions to
-- train" target is now STORED per focus point in `train_target` (seed from tier:
-- critical 3, else 2) and grows by +2 each time the focus must be redone
-- (re-mention / carry-over). practice_count is never reset.
-- Nullable on purpose: any stray insert that doesn't set it falls back to the
-- tier-based value in the readiness RPCs (see 20260615g). Existing rows backfilled.
-- ============================================================

ALTER TABLE public.focus_points
  ADD COLUMN IF NOT EXISTS train_target integer;
UPDATE public.focus_points
  SET train_target = CASE WHEN tier = 'critical' THEN 3 ELSE 2 END
  WHERE train_target IS NULL;

ALTER TABLE public.couple_focus_points
  ADD COLUMN IF NOT EXISTS train_target integer;
UPDATE public.couple_focus_points
  SET train_target = CASE WHEN tier = 'critical' THEN 3 ELSE 2 END
  WHERE train_target IS NULL;

-- Rollback:
--   ALTER TABLE public.focus_points DROP COLUMN IF EXISTS train_target;
--   ALTER TABLE public.couple_focus_points DROP COLUMN IF EXISTS train_target;
