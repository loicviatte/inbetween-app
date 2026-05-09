-- ─────────────────────────────────────────────────────────────────────────────
-- Studios — finalize
--
-- Two follow-ups to 20260506150000_studios.sql now that the UI relies on the
-- new entity exclusively:
--   1. Relax the SELECT policy to allow anon reads. The signup screen needs to
--      list studios *before* the user has an authenticated session, so the
--      picker can render. Studio names aren't sensitive.
--   2. Drop the legacy free-text columns. They're no longer read or written by
--      any client code.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "studios_read_all" ON public.studios;
CREATE POLICY "studios_read_all" ON public.studios
  FOR SELECT USING (true);

ALTER TABLE public.users DROP COLUMN IF EXISTS main_studio;
ALTER TABLE public.users DROP COLUMN IF EXISTS main_studio_place_id;
