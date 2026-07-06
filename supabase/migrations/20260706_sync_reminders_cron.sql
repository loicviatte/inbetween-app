-- ============================================================
-- Nightly coach "sync your DJI recordings" reminder.
--
-- Schedules the notify-sync-reminders edge function once every evening. The
-- function finds each coach's classes still awaiting their DJI-mic audio
-- (local_recording_mode + mic_file_name IS NULL + a real >60s session) that
-- haven't been superseded by a later class with an overlapping student, and
-- inserts one grouped notification (type 'sync_reminder') per coach — which the
-- on-notification-insert webhook fans out to send-push.
--
-- 18:00 UTC ≈ 20:00 Europe/Paris (summer) / 19:00 (winter) — an evening digest,
-- matching the app's Paris-centric scheduling (see monitor-report). Mirrors the
-- existing cron invocation pattern; <PROJECT_REF>/<SERVICE_ROLE_KEY> are
-- substituted at apply time (prod patched via the Management API).
-- ============================================================

SELECT cron.unschedule('notify-sync-reminders')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-sync-reminders');

SELECT cron.schedule(
  'notify-sync-reminders',
  '0 18 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-sync-reminders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := jsonb_build_object('trigger', 'cron')
  );
  $cron$
);
