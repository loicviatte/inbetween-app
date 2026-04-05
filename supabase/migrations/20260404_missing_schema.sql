-- ============================================================
-- Missing Schema Migration
-- Adds all columns and tables referenced in code but absent
-- from supabase_migration.sql and 20260401_coach_schema.sql
-- Run this AFTER both previous migrations.
-- ============================================================

-- ─── 1. Users — missing columns ─────────────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS dance_style           TEXT,
  ADD COLUMN IF NOT EXISTS main_studio           TEXT,
  ADD COLUMN IF NOT EXISTS main_studio_place_id  TEXT,
  ADD COLUMN IF NOT EXISTS last_active_date      DATE,
  ADD COLUMN IF NOT EXISTS total_focus_worked    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nudge_message         TEXT;

-- ─── 2. Focus_points — missing columns ──────────────────────────────────────

ALTER TABLE public.focus_points
  ADD COLUMN IF NOT EXISTS tier              TEXT NOT NULL DEFAULT 'important',
  ADD COLUMN IF NOT EXISTS status            TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_mentioned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS alias_of          UUID REFERENCES public.focus_points(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coach_note        TEXT;

-- ─── 3. Coach_messages — missing column ─────────────────────────────────────

ALTER TABLE public.coach_messages
  ADD COLUMN IF NOT EXISTS question_type TEXT NOT NULL DEFAULT 'clarification';

-- ─── 4. Focus_metrics table ─────────────────────────────────────────────────
-- One row per focus_point. Tracks the algorithm scoring inputs.

CREATE TABLE IF NOT EXISTS public.focus_metrics (
  focus_id          UUID PRIMARY KEY REFERENCES public.focus_points(id) ON DELETE CASCADE,
  importance        FLOAT NOT NULL DEFAULT 3,
  struggle          FLOAT NOT NULL DEFAULT 1,
  practice          FLOAT NOT NULL DEFAULT 0,
  coach_signal      FLOAT NOT NULL DEFAULT 0,
  last_practiced_at TIMESTAMPTZ,
  last_question_at  TIMESTAMPTZ
);

ALTER TABLE public.focus_metrics ENABLE ROW LEVEL SECURITY;

-- focus_metrics: student owns their own rows; coach can read their students' rows
CREATE POLICY "focus_metrics_select" ON public.focus_metrics
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.focus_points fp
      WHERE fp.id = focus_metrics.focus_id
        AND (
          fp.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = fp.user_id AND u.coach_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY "focus_metrics_insert" ON public.focus_metrics
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.focus_points fp
      WHERE fp.id = focus_metrics.focus_id AND fp.user_id = auth.uid()
    )
  );

CREATE POLICY "focus_metrics_update" ON public.focus_metrics
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.focus_points fp
      WHERE fp.id = focus_metrics.focus_id AND fp.user_id = auth.uid()
    )
  );

-- ─── 5. Ensure RLS is enabled on coach tables ────────────────────────────────
-- (safe to run even if already enabled)

ALTER TABLE public.coach_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_validations ENABLE ROW LEVEL SECURITY;

-- ─── 6. Backfill focus_metrics for existing focus_points ────────────────────
-- Creates a default metrics row for any focus_point that doesn't have one yet.

INSERT INTO public.focus_metrics (focus_id, importance, struggle, practice, coach_signal)
SELECT
  fp.id,
  CASE fp.tier
    WHEN 'critical'   THEN 4
    WHEN 'supporting' THEN 2
    ELSE 3
  END AS importance,
  CASE fp.tier
    WHEN 'supporting' THEN 0
    ELSE 1
  END AS struggle,
  0,
  0
FROM public.focus_points fp
WHERE NOT EXISTS (
  SELECT 1 FROM public.focus_metrics fm WHERE fm.focus_id = fp.id
);
