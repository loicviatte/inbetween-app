-- Nightly retention sweep: delete lesson audio 180 days after the lesson, and
-- warn the coach 14 days before it happens. The work is in the edge function
-- purge-expired-audio (its header explains the two passes and the guards);
-- this only schedules it, following the existing cron pattern —
-- <PROJECT_REF>/<SERVICE_ROLE_KEY> are substituted when the statement is run,
-- never committed.
--
-- 03:20 UTC: after the evening reminders, before anyone opens the app.
-- Applied to prod 2026-09-23, verified on a backdated test lesson (two objects
-- deleted from storage, pointer cleared, row stamped) and on the warning path
-- (one notification, not repeated on the next run).

select cron.unschedule('purge-expired-audio')
 where exists (select 1 from cron.job where jobname = 'purge-expired-audio');

select cron.schedule(
  'purge-expired-audio',
  '20 3 * * *',
  $cron$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/purge-expired-audio',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- Rollback:
--   select cron.unschedule('purge-expired-audio');
