-- ============================================================
-- Idempotent orphan (unmatched_recordings) uploads.
-- The DJI safety-net upload did a plain INSERT, so a lost-ACK retry (the offline
-- loop re-runs the whole upload) created a DUPLICATE orphan row. Add a
-- natural-key UNIQUE constraint so the client can upsert(onConflict) and a retry
-- becomes a no-op. (user_id, dji_index, mic_timestamp) uniquely identifies a
-- recording: the same coach can't have two recordings sharing the mic index AND
-- the exact RTC start time. NULLs (a fileless/degenerate orphan) stay distinct,
-- which is fine — only genuine parsed orphans (both set) get deduped.
-- ============================================================

ALTER TABLE public.unmatched_recordings
  DROP CONSTRAINT IF EXISTS unmatched_recordings_natural_key,
  ADD  CONSTRAINT unmatched_recordings_natural_key
       UNIQUE (user_id, dji_index, mic_timestamp);
