-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: coach push/in-app notification when a student sends a request
--
-- The current `notify_coach_request` trigger calls send-push directly with a
-- payload shape send-push doesn't understand (it expects a webhook envelope
-- {type, table, record}, not a flat object). So neither the push goes through
-- nor an in-app notification row is ever written. The coach only sees the
-- pending request in the home list, and only after a manual app refresh.
--
-- Fix: rewrite the trigger to INSERT into public.notifications. The existing
-- `on-notification-insert` DB webhook then forwards the new row to send-push
-- with the correct envelope, so push delivery + the in-app notifications list
-- both work from the same source.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_coach_request()
RETURNS trigger AS $$
DECLARE
  v_student_name text;
BEGIN
  SELECT name INTO v_student_name FROM public.users WHERE id = NEW.student_id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    NEW.coach_id,
    'coach_request_received',
    'New student request',
    COALESCE(v_student_name, 'Someone') || ' wants to add you as their coach.',
    jsonb_build_object('request_id', NEW.id, 'student_id', NEW.student_id)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
