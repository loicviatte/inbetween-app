-- ============================================================
-- Couple Feature — M7: push + in-app notifications
-- Mirrors notify_coach_request: each trigger INSERTs into public.notifications;
-- the existing on-notification-insert webhook forwards the row to send-push
-- (push) and the in-app notifications list reads the same table.
-- Covered events (per spec): partner request received/accepted, couple paired,
-- unpair, couple-coach request received/accepted, new couple focus point.
-- NOT covered: partner logged a session (intentionally — they train together).
-- ============================================================

-- 1) Partner request received → notify the target.
CREATE OR REPLACE FUNCTION public.notify_couple_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_name text;
BEGIN
  IF NEW.status = 'pending' THEN
    SELECT name INTO v_name FROM public.users WHERE id = NEW.requester_id;
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (NEW.target_id, 'couple_request_received', 'New partner request',
      COALESCE(v_name, 'Someone') || ' wants to be your dance partner.',
      jsonb_build_object('request_id', NEW.id, 'requester_id', NEW.requester_id));
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_couple_request ON public.couple_requests;
CREATE TRIGGER trg_notify_couple_request AFTER INSERT ON public.couple_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_couple_request();

-- 2) Partner accepted & configured → notify the requester to confirm.
CREATE OR REPLACE FUNCTION public.notify_couple_request_validate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_name text;
BEGIN
  IF NEW.status = 'awaiting_validation' AND OLD.status IS DISTINCT FROM 'awaiting_validation' THEN
    SELECT name INTO v_name FROM public.users WHERE id = NEW.target_id;
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (NEW.requester_id, 'couple_request_accepted', 'Partner accepted',
      COALESCE(v_name, 'Your partner') || ' accepted - confirm to pair up.',
      jsonb_build_object('request_id', NEW.id, 'target_id', NEW.target_id));
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_couple_request_validate ON public.couple_requests;
CREATE TRIGGER trg_notify_couple_request_validate AFTER UPDATE ON public.couple_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_couple_request_validate();

-- 3) Couple created → notify both dancers.
CREATE OR REPLACE FUNCTION public.notify_couple_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE na text; nb text;
BEGIN
  SELECT name INTO na FROM public.users WHERE id = NEW.user_a_id;
  SELECT name INTO nb FROM public.users WHERE id = NEW.user_b_id;
  INSERT INTO public.notifications (user_id, type, title, body, data) VALUES
    (NEW.user_a_id, 'couple_paired', 'You are paired', 'You are now dancing as a couple with ' || COALESCE(split_part(nb,' ',1), 'your partner') || '.', jsonb_build_object('couple_id', NEW.id)),
    (NEW.user_b_id, 'couple_paired', 'You are paired', 'You are now dancing as a couple with ' || COALESCE(split_part(na,' ',1), 'your partner') || '.', jsonb_build_object('couple_id', NEW.id));
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_couple_created ON public.couples;
CREATE TRIGGER trg_notify_couple_created AFTER INSERT ON public.couples
  FOR EACH ROW EXECUTE FUNCTION public.notify_couple_created();

-- 4) Unpair → notify the partner(s) who did not trigger the delete.
CREATE OR REPLACE FUNCTION public.notify_couple_unpaired()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT uid, 'couple_unpaired', 'Couple ended', 'Your dance partnership has ended.', jsonb_build_object('couple_id', OLD.id)
  FROM (VALUES (OLD.user_a_id), (OLD.user_b_id)) AS m(uid)
  WHERE uid IS NOT NULL AND uid IS DISTINCT FROM auth.uid();
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_couple_unpaired ON public.couples;
CREATE TRIGGER trg_notify_couple_unpaired AFTER DELETE ON public.couples
  FOR EACH ROW EXECUTE FUNCTION public.notify_couple_unpaired();

-- 5) Couple-coach request received → notify the coach.
CREATE OR REPLACE FUNCTION public.notify_couple_coach_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE na text; nb text;
BEGIN
  SELECT u1.name, u2.name INTO na, nb
  FROM public.couples c
  JOIN public.users u1 ON u1.id = c.user_a_id
  JOIN public.users u2 ON u2.id = c.user_b_id
  WHERE c.id = NEW.couple_id;
  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (NEW.coach_id, 'couple_coach_request', 'New couple coach request',
    COALESCE(split_part(na,' ',1),'A dancer') || ' & ' || COALESCE(split_part(nb,' ',1),'partner') || ' want you as their ' || NEW.category || ' couple coach.',
    jsonb_build_object('request_id', NEW.id, 'couple_id', NEW.couple_id, 'category', NEW.category));
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_couple_coach_request ON public.couple_coach_requests;
CREATE TRIGGER trg_notify_couple_coach_request AFTER INSERT ON public.couple_coach_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_couple_coach_request();

-- 6) Couple-coach accepted → notify both dancers.
CREATE OR REPLACE FUNCTION public.notify_couple_coach_accepted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_coach text; ua uuid; ub uuid;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    SELECT name INTO v_coach FROM public.users WHERE id = NEW.coach_id;
    SELECT user_a_id, user_b_id INTO ua, ub FROM public.couples WHERE id = NEW.couple_id;
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT uid, 'couple_coach_accepted', 'Couple coach confirmed',
      COALESCE(v_coach,'Your coach') || ' is now your ' || NEW.category || ' couple coach.',
      jsonb_build_object('couple_id', NEW.couple_id, 'category', NEW.category)
    FROM (VALUES (ua),(ub)) AS m(uid) WHERE uid IS NOT NULL;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_couple_coach_accepted ON public.couple_coach_requests;
CREATE TRIGGER trg_notify_couple_coach_accepted AFTER UPDATE ON public.couple_coach_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_couple_coach_accepted();

-- 7) New couple focus point → notify both dancers.
CREATE OR REPLACE FUNCTION public.notify_couple_focus_point()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE ua uuid; ub uuid;
BEGIN
  IF COALESCE(NEW.is_other, false) = false THEN
    SELECT user_a_id, user_b_id INTO ua, ub FROM public.couples WHERE id = NEW.couple_id;
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT uid, 'couple_focus_added', 'New couple focus',
      'New couple focus point: ' || COALESCE(NEW.name, 'a new focus') || '.',
      jsonb_build_object('couple_id', NEW.couple_id, 'couple_focus_point_id', NEW.id)
    FROM (VALUES (ua),(ub)) AS m(uid) WHERE uid IS NOT NULL;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_couple_focus_point ON public.couple_focus_points;
CREATE TRIGGER trg_notify_couple_focus_point AFTER INSERT ON public.couple_focus_points
  FOR EACH ROW EXECUTE FUNCTION public.notify_couple_focus_point();
