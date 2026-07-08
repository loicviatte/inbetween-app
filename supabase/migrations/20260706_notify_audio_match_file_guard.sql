-- ============================================================
-- Fix: the DJI audio-match Telegram alert fired at CLASS START, not on a match.
--
-- Root cause: a class_recordings row is INSERTed at class start already stamped
-- admin_review_status='pending' as a placeholder (see StartClassScreen — local/
-- DJI coaches), long before any audio file exists. The original trigger
-- (20260704_notify_audio_match.sql) fired on `AFTER INSERT ... NEW.admin_review_
-- status='pending'`, so every DJI class start pinged the ops chat — including
-- 2-second test recordings — with no audio and nothing to review yet.
--
-- Worse, the genuine "uncertain match landed" event was MISSED: the matcher
-- UPDATEs that same placeholder row pending→pending (localRecordingAutoSync),
-- so `OLD.admin_review_status IS DISTINCT FROM 'pending'` was false and the
-- trigger never fired for the case it exists for.
--
-- Fix: key the notification off `file_imported_at` — the column the matcher
-- stamps only once an actual mic file is attached. It is NULL for the class-
-- start placeholder and NOT NULL for every real match. So we notify iff the row
-- is pending AND has an imported file AND this write is the one that made it so
-- (INSERT of an already-imported row, the import UPDATE that set file_imported_
-- at, or a re-open where admin_review_status transitions back into 'pending').
-- The trigger now also watches file_imported_at so the import UPDATE fires it
-- even when admin_review_status stays 'pending' throughout.
--
-- A notification failure NEVER blocks the write (EXCEPTION → RETURN NEW). The
-- <PROJECT_REF>/<SERVICE_ROLE_KEY> placeholders are substituted at apply time
-- (prod patched via the Management API with the real values; mirrors the
-- monitor-report cron pattern).
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_audio_match_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF NEW.admin_review_status = 'pending'
     AND NEW.file_imported_at IS NOT NULL
     AND (
          TG_OP = 'INSERT'
          OR OLD.file_imported_at IS NULL
          OR OLD.admin_review_status IS DISTINCT FROM 'pending'
     ) THEN
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

-- Recreate the trigger so it also fires when file_imported_at changes (the
-- import UPDATE that attaches the mic file), not only admin_review_status.
DROP TRIGGER IF EXISTS trg_notify_audio_match_pending ON public.class_recordings;
CREATE TRIGGER trg_notify_audio_match_pending
  AFTER INSERT OR UPDATE OF admin_review_status, file_imported_at ON public.class_recordings
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_audio_match_pending();
