-- ============================================================
-- Telegram alert when a coach answers "the audio is lost".
--
-- That answer (SyncReminderModal → abandonPendingUploads → sync_abandoned_at,
-- see 20260721_sync_abandoned.sql) is the one exit with no way back on the
-- coach's side: it permanently silences the nightly push and the full-screen
-- reminder for that class, and the student never receives focus points from
-- it. The confirmation card promises "We'll get in touch about this one", so a
-- human has to actually hear about it — hence this ping.
--
-- Fires ONLY on the NULL → NOT NULL transition, so re-saves and any later
-- write to the row can't re-notify. Mirrors notify_audio_match_pending: a
-- notification failure NEVER blocks the write (EXCEPTION → RETURN NEW), and
-- <PROJECT_REF>/<SERVICE_ROLE_KEY> are substituted at apply time (prod patched
-- via the Management API).
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_audio_lost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF NEW.sync_abandoned_at IS NOT NULL
     AND OLD.sync_abandoned_at IS NULL THEN
    PERFORM net.http_post(
      url := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-audio-lost',
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

DROP TRIGGER IF EXISTS trg_notify_audio_lost ON public.class_recordings;
CREATE TRIGGER trg_notify_audio_lost
  AFTER UPDATE OF sync_abandoned_at ON public.class_recordings
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_audio_lost();
