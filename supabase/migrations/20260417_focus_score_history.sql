-- ============================================================
-- Per-focus-point score change history, for trainer diagnostics.
-- Every time `base_score` changes on a focus_point we log a row
-- with a best-effort reason derived from which adjacent columns
-- changed in the same update.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.focus_score_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  focus_point_id  uuid NOT NULL REFERENCES public.focus_points(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  old_score       numeric,
  new_score       numeric,
  delta           numeric,
  reason          text,           -- e.g. 'class re-mention', 'practice log', 'coach signal +', 'state transition'
  details         jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.focus_score_history ENABLE ROW LEVEL SECURITY;

-- Trainer-only read (trainer is identified by email, matching the client check
-- in ProfileScreen). Service role bypasses RLS automatically.
DROP POLICY IF EXISTS "trainer_read_score_history" ON public.focus_score_history;
CREATE POLICY "trainer_read_score_history" ON public.focus_score_history
  FOR SELECT
  USING (
    (auth.jwt() ->> 'email') = 'loic@danceuniteduk.com'
  );

DROP POLICY IF EXISTS "owner_read_score_history" ON public.focus_score_history;
CREATE POLICY "owner_read_score_history" ON public.focus_score_history
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_focus_score_history_fp_created
  ON public.focus_score_history (focus_point_id, created_at DESC);

-- ── Trigger: log base_score changes ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.log_focus_score_change()
RETURNS trigger AS $$
DECLARE
  v_reason text;
  v_details jsonb;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.base_score IS DISTINCT FROM OLD.base_score THEN
    v_details := jsonb_build_object(
      'tier_before',          OLD.tier,
      'tier_after',           NEW.tier,
      'count_before',         OLD.count,
      'count_after',          NEW.count,
      'practice_count_before', OLD.practice_count,
      'practice_count_after',  NEW.practice_count,
      'coach_signal_before',  OLD.coach_signal,
      'coach_signal_after',   NEW.coach_signal,
      'status_before',        OLD.status,
      'status_after',         NEW.status
    );

    v_reason := CASE
      WHEN NEW.practice_count IS DISTINCT FROM OLD.practice_count
        THEN 'practice log'
      WHEN NEW.coach_signal IS DISTINCT FROM OLD.coach_signal AND NEW.coach_signal > OLD.coach_signal
        THEN 'coach signal +'
      WHEN NEW.coach_signal IS DISTINCT FROM OLD.coach_signal AND NEW.coach_signal < OLD.coach_signal
        THEN 'coach signal -'
      WHEN NEW.count IS DISTINCT FROM OLD.count AND NEW.count > OLD.count
        THEN 'class re-mention'
      WHEN NEW.status IS DISTINCT FROM OLD.status
        THEN 'state transition (' || OLD.status || ' → ' || NEW.status || ')'
      WHEN NEW.reactivated IS DISTINCT FROM OLD.reactivated AND NEW.reactivated = true
        THEN 'reactivated'
      WHEN NEW.tier IS DISTINCT FROM OLD.tier
        THEN 'tier change (' || OLD.tier || ' → ' || NEW.tier || ')'
      ELSE 'score update'
    END;

    INSERT INTO public.focus_score_history
      (focus_point_id, user_id, old_score, new_score, delta, reason, details)
    VALUES (
      NEW.id,
      NEW.user_id,
      OLD.base_score,
      NEW.base_score,
      NEW.base_score - OLD.base_score,
      v_reason,
      v_details
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_focus_score_history ON public.focus_points;
CREATE TRIGGER trg_focus_score_history
  AFTER UPDATE OF base_score, count, practice_count, coach_signal, tier, status, reactivated
  ON public.focus_points
  FOR EACH ROW EXECUTE FUNCTION public.log_focus_score_change();

-- Seed: backfill an initial row for every existing focus point so the
-- trainer screen has something to show even before new changes happen.
INSERT INTO public.focus_score_history
  (focus_point_id, user_id, old_score, new_score, delta, reason, created_at)
SELECT id, user_id, base_score, base_score, 0, 'initial', created_at
FROM public.focus_points
WHERE user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.focus_score_history h WHERE h.focus_point_id = focus_points.id
  );
