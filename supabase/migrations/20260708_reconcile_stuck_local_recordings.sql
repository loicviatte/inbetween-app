-- Server-side safety net for DJI/local-mode recordings that were STOPPED but
-- never got ended_at written.
--
-- Context: the client stamps class_recordings.ended_at at Stop for local-mode
-- classes (StartClassScreen.stopClass, commit 26c6a60, shipped in 1.7.3+). But
-- devices on older builds only logged the `session_stopping` meta event (added
-- 2026-05-15) and predate the ended_at stamp, so they leave the row stuck in
-- status='recording' with ended_at=NULL forever. Such a class never appears in
-- the coach's upload list (LocalUploadScreen filters ended_at IS NOT NULL) and
-- never triggers a sync reminder — the audio can never be imported. A stop-time
-- network failure would strand it the same way, even on current builds.
--
-- This cron self-heals those rows regardless of client version by stamping
-- ended_at = updated_at (the last DB write, which for a stopped-but-unfinalized
-- row is the session_stopping meta append ≈ the real stop time).
--
-- SAFE against in-progress classes: it only touches rows whose meta contains a
-- `session_stopping` event, which is written ONLY when the coach actually stops
-- the recording. A class still being recorded has no such event, so it is never
-- matched. The 15-minute buffer lets the client's own stamp land first on
-- current builds; the cron only catches stragglers.

-- One-time backfill for any rows already stuck at deploy time (idempotent).
UPDATE public.class_recordings
   SET ended_at = updated_at
 WHERE local_recording_mode = true
   AND ended_at IS NULL
   AND status = 'recording'
   AND meta::text ILIKE '%session_stopping%'
   AND updated_at < now() - interval '15 minutes';

-- Recurring safety net (every 30 min). Re-runnable: unschedule then reschedule.
SELECT cron.unschedule('reconcile-stuck-local-recordings')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-stuck-local-recordings');

SELECT cron.schedule(
  'reconcile-stuck-local-recordings',
  '*/30 * * * *',
  $cron$
  UPDATE public.class_recordings
     SET ended_at = updated_at
   WHERE local_recording_mode = true
     AND ended_at IS NULL
     AND status = 'recording'
     AND meta::text ILIKE '%session_stopping%'
     AND updated_at < now() - interval '15 minutes';
  $cron$
);
