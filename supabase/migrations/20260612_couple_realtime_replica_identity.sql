-- ============================================================
-- Couple Feature — fix partner live-refresh on lock release.
--
-- The couple tables are in the supabase_realtime publication, but with the
-- default REPLICA IDENTITY (primary key only). For a filtered subscription
-- (`couple_id=eq.X`), Realtime evaluates the filter against the row in the WAL:
--   - INSERT  → carries the full NEW row → couple_id present → delivered ✅
--   - DELETE  → carries only the PK (id) → couple_id ABSENT → filter can't
--               match → the event is dropped ❌
--
-- Result: when a dancer cancels/finishes a couple training, release_couple_lock
-- DELETEs the lock row, but the partner never receives the DELETE — their card
-- stays stuck on "<partner> is training" forever.
--
-- REPLICA IDENTITY FULL makes the OLD row carry every column in the WAL, so the
-- DELETE event includes couple_id, the filter matches, and the partner's
-- couple_focus_locks subscription fires → getCoupleLock() returns null → the
-- "training in progress" mirror clears live. No client change needed.
--
-- Also set on couple_practice_logs defensively: same filtered subscription, so
-- any future UPDATE/DELETE there would hit the same drop. INSERTs (the normal
-- "session completed" path) already work, so this is purely belt-and-suspenders.
-- ============================================================

ALTER TABLE public.couple_focus_locks REPLICA IDENTITY FULL;
ALTER TABLE public.couple_practice_logs REPLICA IDENTITY FULL;

-- couple_requests: the partner-handshake subscription is unfiltered, so INSERT
-- and UPDATE (forward progress — accept, awaiting_validation) already deliver.
-- But a DELETE (decline / cancel) only carries the PK, so RLS on the other
-- party's side can't confirm visibility and the event is dropped — the other
-- dancer's row stays stuck on a stale "pending" until they re-open the screen.
-- FULL lets the decline/cancel propagate live to both sides.
ALTER TABLE public.couple_requests REPLICA IDENTITY FULL;
