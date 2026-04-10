-- Notify coach when a student sends a connection request

CREATE OR REPLACE FUNCTION public.notify_coach_on_new_request()
RETURNS trigger AS $$
DECLARE
  v_student_name text;
BEGIN
  SELECT name INTO v_student_name FROM public.users WHERE id = NEW.student_id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    NEW.coach_id,
    'coach_request_received',
    'New connection request',
    COALESCE(v_student_name, 'A student') || ' wants to connect with you.',
    jsonb_build_object('requestId', NEW.id, 'studentId', NEW.student_id)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_coach_request_received ON public.coach_requests;
CREATE TRIGGER on_coach_request_received
  AFTER INSERT ON public.coach_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_coach_on_new_request();
