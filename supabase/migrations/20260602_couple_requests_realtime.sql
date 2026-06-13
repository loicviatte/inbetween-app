-- ============================================================
-- Couple Feature — M1 fix: publish couple_requests + couples to realtime
-- So both dancers see handshake status changes live (B accepts → A sees the
-- "Confirm & pair" step appear; A validates → B sees the couple form) without a
-- manual reload. Realtime respects RLS, so each side only receives rows it can
-- already read.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='couple_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.couple_requests;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='couples') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.couples;
  END IF;
END $$;
