-- ============================================================
-- Telegram alert on a new DJI-mic match awaiting admin review.
-- When class_recordings.admin_review_status transitions INTO 'pending' (an
-- uncertain audio↔class match the app couldn't auto-approve), fire the
-- notify-audio-match edge function via pg_net so the ops chat gets a link to
-- confirm it in the dashboard — same channel as the focus-point review alerts.
--
-- The guard lives in the function body (TG_OP + OLD aren't both safe in a WHEN
-- clause on an INSERT-inclusive trigger). A notification failure NEVER blocks
-- the write (EXCEPTION → RETURN NEW). The <PROJECT_REF>/<SERVICE_ROLE_KEY>
-- placeholders are substituted at apply time (prod was patched via the
-- Management API with the real values; mirrors the monitor-report cron pattern).
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_audio_match_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF NEW.admin_review_status = 'pending'
     AND (TG_OP = 'INSERT' OR OLD.admin_review_status IS DISTINCT FROM 'pending') THEN
    PERFORM net.http_post(
      url := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-audio-match',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
      ),
      body := jsonb_build_object('recording_id', NEW.id)
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_audio_match_pending ON public.class_recordings;
CREATE TRIGGER trg_notify_audio_match_pending
  AFTER INSERT OR UPDATE OF admin_review_status ON public.class_recordings
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_audio_match_pending();
