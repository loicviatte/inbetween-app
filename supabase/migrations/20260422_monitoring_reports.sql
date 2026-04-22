-- ============================================================
-- InBetween Data Monitor — reports table + cron schedule.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.monitoring_reports (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  report_date           date        NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Paris')::date,
  period_start          timestamptz NOT NULL,
  period_end            timestamptz NOT NULL,
  status                text        NOT NULL CHECK (status IN ('ok', 'attention', 'critical')),
  summary               text,
  report_md             text,
  report_pdf            bytea,
  anomalies             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  unresolved_ids        text[]      NOT NULL DEFAULT '{}',
  telegram_message_ids  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  run_duration_ms       integer,
  error                 text
);

CREATE INDEX IF NOT EXISTS idx_monitoring_reports_created_at
  ON public.monitoring_reports (created_at DESC);

ALTER TABLE public.monitoring_reports ENABLE ROW LEVEL SECURITY;

-- Trainer-only read. Service role bypasses RLS automatically.
DROP POLICY IF EXISTS "trainer_read_monitoring" ON public.monitoring_reports;
CREATE POLICY "trainer_read_monitoring" ON public.monitoring_reports
  FOR SELECT
  USING ((auth.jwt() ->> 'email') = 'loic@danceuniteduk.com');

-- ── Cron: Mon / Wed / Sat at 08:00 Europe/Paris (06:00 UTC) ─────────────────
-- Supabase hosted does not allow ALTER DATABASE SET, so the URL and service
-- role key are inlined. The service_role_key value lives only in cron.job
-- (restricted to superuser/service_role) — never commit a real key.
--
-- BEFORE RUNNING THIS BLOCK, replace <PROJECT_REF> and <SERVICE_ROLE_KEY>
-- with the real values. Re-running is safe (unschedule guard).

-- SELECT cron.unschedule('inbetween-monitor-report')
--   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'inbetween-monitor-report');
--
-- SELECT cron.schedule(
--   'inbetween-monitor-report',
--   '0 6 * * 1,3,6',
--   $cron$
--   SELECT net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/monitor-report',
--     headers := jsonb_build_object(
--       'Content-Type',  'application/json',
--       'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
--     ),
--     body := jsonb_build_object('trigger', 'cron')
--   );
--   $cron$
-- );
