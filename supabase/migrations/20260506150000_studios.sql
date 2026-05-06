-- ─────────────────────────────────────────────────────────────────────────────
-- Studios v1
--
-- Introduces a structured studio entity. Today users have free-text
-- `main_studio` / `main_studio_place_id` (Google Places) on their row, which
-- means there's no shared identity between a coach and the students they teach
-- in the same physical space. This migration adds a real `studios` table and a
-- `users.studio_id` FK so the app can model "a studio has coaches and
-- students" — paving the way for studio-scoped group classes.
--
-- Scope of this migration:
--   1. Create studios table + RLS.
--   2. Add nullable users.studio_id (kept nullable so existing flows don't
--      break; the legacy main_studio columns are left in place for now).
--   3. Seed two studios and assign every existing user:
--        - Oti & Marius Dance Studio        ← all current users
--        - SangriStudio Dancing             ← test accounts only
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.studios (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  created_by UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive uniqueness on name so "Oti" and "oti" can't coexist and the
-- "create new" path can detect collisions.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_studios_name_lower
  ON public.studios (LOWER(name));

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS studio_id UUID REFERENCES public.studios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_studio_id ON public.users(studio_id);

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.studios ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can list studios (needed for the signup picker).
DROP POLICY IF EXISTS "studios_read_all" ON public.studios;
CREATE POLICY "studios_read_all" ON public.studios
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Any authenticated user can create a studio. UI restricts this to coaches.
DROP POLICY IF EXISTS "studios_insert_authenticated" ON public.studios;
CREATE POLICY "studios_insert_authenticated" ON public.studios
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ─── Seed + backfill ────────────────────────────────────────────────────────
DO $$
DECLARE
  v_oti_id    UUID;
  v_sangri_id UUID;
BEGIN
  SELECT id INTO v_oti_id
  FROM public.studios
  WHERE LOWER(name) = LOWER('Oti & Marius Dance Studio');
  IF v_oti_id IS NULL THEN
    INSERT INTO public.studios (name)
    VALUES ('Oti & Marius Dance Studio')
    RETURNING id INTO v_oti_id;
  END IF;

  SELECT id INTO v_sangri_id
  FROM public.studios
  WHERE LOWER(name) = LOWER('SangriStudio Dancing');
  IF v_sangri_id IS NULL THEN
    INSERT INTO public.studios (name)
    VALUES ('SangriStudio Dancing')
    RETURNING id INTO v_sangri_id;
  END IF;

  -- Test accounts → SangriStudio Dancing
  UPDATE public.users
  SET studio_id = v_sangri_id
  WHERE LOWER(email) IN (
    'loicpk@gmail.com',
    'viatteloic@gmail.com',
    'alexandra@lukey.ch'
  );

  -- Everyone else who hasn't been assigned a studio yet → Oti & Marius
  UPDATE public.users
  SET studio_id = v_oti_id
  WHERE studio_id IS NULL;
END $$;
