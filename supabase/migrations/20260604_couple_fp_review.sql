-- ============================================================
-- Couple Feature — couple focus points go through COACH REVIEW
-- (mirror the solo pending_coach → active flow), plus the held
-- 15-min auto-archive done server-side (dancers can't UPDATE
-- couple_focus_points under RLS — cfp_update is coach-only).
-- ============================================================

-- 1) Allow 'pending_coach' on couple_focus_points.status.
ALTER TABLE public.couple_focus_points
  DROP CONSTRAINT IF EXISTS couple_focus_points_status_check;
ALTER TABLE public.couple_focus_points
  ADD CONSTRAINT couple_focus_points_status_check
  CHECK (status IN ('pending_coach', 'active', 'past_candidate', 'past'));

-- 2) New-couple-FP push fires when the FP becomes ACTIVE (after the coach
--    approves, or after the 18h auto-publish) — NOT on insert as pending_coach.
--    Replaces the M7 insert-only trigger so dancers aren't pinged prematurely.
CREATE OR REPLACE FUNCTION public.notify_couple_focus_point()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE ua uuid; ub uuid;
BEGIN
  IF COALESCE(NEW.is_other, false) = false
     AND NEW.status = 'active'
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.status, '') IS DISTINCT FROM 'active') THEN
    SELECT user_a_id, user_b_id INTO ua, ub FROM public.couples WHERE id = NEW.couple_id;
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT uid, 'couple_focus_added', 'New couple focus',
      'New couple focus point: ' || COALESCE(NEW.name, 'a new focus') || '.',
      jsonb_build_object('couple_id', NEW.couple_id, 'couple_focus_point_id', NEW.id)
    FROM (VALUES (ua), (ub)) AS m(uid) WHERE uid IS NOT NULL;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_couple_focus_point ON public.couple_focus_points;
CREATE TRIGGER trg_notify_couple_focus_point
  AFTER INSERT OR UPDATE OF status ON public.couple_focus_points
  FOR EACH ROW EXECUTE FUNCTION public.notify_couple_focus_point();

-- 3) Held couple focus points auto-archive after 15 cumulative minutes of
--    couple practice (mirror of the solo client-side logic in algorithm.js).
--    Server-side trigger because members cannot UPDATE couple_focus_points.
CREATE OR REPLACE FUNCTION public.archive_held_couple_fp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_held boolean; v_status text; v_total numeric;
BEGIN
  SELECT is_held, status INTO v_held, v_status
    FROM public.couple_focus_points
    WHERE id = NEW.couple_focus_point_id;

  IF v_held IS TRUE AND v_status <> 'past' THEN
    SELECT COALESCE(SUM(duration_minutes), 0) INTO v_total
      FROM public.couple_practice_logs
      WHERE couple_focus_point_id = NEW.couple_focus_point_id
        AND completed_at IS NOT NULL;
    IF v_total >= 15 THEN
      UPDATE public.couple_focus_points
        SET status = 'past'
        WHERE id = NEW.couple_focus_point_id;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_archive_held_couple_fp ON public.couple_practice_logs;
CREATE TRIGGER trg_archive_held_couple_fp
  AFTER INSERT ON public.couple_practice_logs
  FOR EACH ROW EXECUTE FUNCTION public.archive_held_couple_fp();
