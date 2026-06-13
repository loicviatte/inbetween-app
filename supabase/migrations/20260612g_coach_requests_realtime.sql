-- ============================================================
-- Coach gets a new student request LIVE (in-app), independent of push delivery.
--
-- Problem: coach_requests was not in the supabase_realtime publication, so a
-- coach sitting on the Students page saw nothing when a student linked — and the
-- only path (the push-received listener) is unreliable on dev builds / missing
-- tokens. Adding the table lets the app subscribe to INSERTs (coach_id = me) and
-- surface the row + an Accept/Decline modal instantly.
--
-- REPLICA IDENTITY FULL so a student-side cancel (DELETE) also carries coach_id
-- and propagates to the coach's pending list. RLS already lets the coach read
-- their own requests (coach_requests_read: coach_id = auth.uid()).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'coach_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.coach_requests;
  END IF;
END $$;

ALTER TABLE public.coach_requests REPLICA IDENTITY FULL;
