-- ============================================================
-- AI call logs — per-call Anthropic usage + cost tracking.
--
-- Every Anthropic API call from edge functions records here so we can:
--   - See exactly which class / context burnt how much $
--   - Catch cost regressions (e.g. a prompt blowup that 10x's a call)
--   - Compare cache-read vs full-input savings as we add prompt caching
--   - Bill cost back to coach accounts at scale
--
-- Cost is computed client-side at insert time using the pricing constants
-- in supabase/functions/_shared/anthropic-pricing.ts. We snapshot the
-- USD figure instead of re-deriving from tokens later because Anthropic
-- prices drift; the historical value at the time of the call is the
-- truth for accounting.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_call_logs (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                      timestamptz NOT NULL DEFAULT now(),

  -- Origin
  function_name                   text NOT NULL,           -- e.g. 'yoda-extract'
  context                         text,                    -- e.g. 'extract', 'title', 'dedupe'
  model                           text NOT NULL,           -- e.g. 'claude-sonnet-4-6'

  -- Tying the call back to product entities (optional)
  class_input_id                  uuid REFERENCES public.class_inputs(id) ON DELETE SET NULL,
  user_id                         uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Anthropic usage block (verbatim from /v1/messages response)
  input_tokens                    integer NOT NULL DEFAULT 0,
  output_tokens                   integer NOT NULL DEFAULT 0,
  cache_creation_input_tokens     integer NOT NULL DEFAULT 0,
  cache_read_input_tokens         integer NOT NULL DEFAULT 0,

  -- Snapshot of the cost in USD at the time of the call
  cost_usd                        numeric(10,6) NOT NULL DEFAULT 0,

  -- Operational metadata
  duration_ms                     integer,                 -- end-to-end latency for the API call
  attempts                        integer NOT NULL DEFAULT 1, -- 1 = first try, 2+ = retried
  status                          text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error')),
  error_message                   text
);

CREATE INDEX IF NOT EXISTS idx_ai_call_logs_created_at
  ON public.ai_call_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_call_logs_class_input
  ON public.ai_call_logs(class_input_id, created_at DESC)
  WHERE class_input_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_call_logs_user
  ON public.ai_call_logs(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Helpful aggregate view — daily cost rollup that the admin dashboard
-- can hit with a single query.
CREATE OR REPLACE VIEW public.ai_call_costs_daily AS
SELECT
  date_trunc('day', created_at)::date AS day,
  function_name,
  model,
  count(*)                      AS call_count,
  sum(input_tokens)             AS total_input_tokens,
  sum(output_tokens)            AS total_output_tokens,
  sum(cache_read_input_tokens)  AS total_cache_read,
  sum(cost_usd)                 AS total_cost_usd
FROM public.ai_call_logs
GROUP BY 1, 2, 3
ORDER BY 1 DESC;

COMMENT ON TABLE public.ai_call_logs IS
  'Per-call Anthropic usage and USD cost. One row per /v1/messages call from any edge function. Use to audit cost spikes and bill back to coaches.';
COMMENT ON COLUMN public.ai_call_logs.context IS
  'Which call site fired this — e.g. "extract" for the main yoda-extract prompt, "title" for the title-gen Haiku call, "dedupe" for knowledge-base dedup.';
COMMENT ON COLUMN public.ai_call_logs.cost_usd IS
  'USD cost snapshot at call time. Computed from input_tokens × input_rate + output_tokens × output_rate (plus cache adjustments). Pricing constants live in supabase/functions/_shared/anthropic-pricing.ts.';
