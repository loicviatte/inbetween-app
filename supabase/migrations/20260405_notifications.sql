-- ============================================================
-- Notifications table + trigger on coach_requests response
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type        text        NOT NULL,
  title       text        NOT NULL,
  body        text        NOT NULL,
  data        jsonb       NOT NULL DEFAULT '{}',
  read        boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can only access their own notifications
DROP POLICY IF EXISTS "users_own_notifications" ON public.notifications;
CREATE POLICY "users_own_notifications" ON public.notifications
  FOR ALL USING (auth.uid() = user_id);

-- Index for fast unread lookups
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, read, created_at DESC);

-- ── Trigger: notify student when coach accepts / declines ────────────────────

CREATE OR REPLACE FUNCTION public.notify_coach_request_response()
RETURNS trigger AS $$
DECLARE
  v_coach_name text;
BEGIN
  IF NEW.status IN ('accepted', 'declined') AND OLD.status = 'pending' THEN
    SELECT name INTO v_coach_name FROM public.users WHERE id = NEW.coach_id;

    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      NEW.student_id,
      'coach_request_' || NEW.status,
      CASE
        WHEN NEW.status = 'accepted' THEN 'Request accepted'
        ELSE 'Request declined'
      END,
      CASE
        WHEN NEW.status = 'accepted'
          THEN COALESCE(v_coach_name, 'Your coach') || ' accepted your connection request.'
        ELSE
          COALESCE(v_coach_name, 'Your coach') || ' declined your connection request.'
      END,
      jsonb_build_object('requestId', NEW.id, 'coachId', NEW.coach_id)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_coach_request_response ON public.coach_requests;
CREATE TRIGGER on_coach_request_response
  AFTER UPDATE OF status ON public.coach_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_coach_request_response();
