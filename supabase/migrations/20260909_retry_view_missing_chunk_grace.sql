-- Grace path for the transcribe-class-retry sweep.
--
-- Problem: when a chunk upload is permanently lost mid-recording (the chunk row
-- never lands in class_recording_chunks), the recording's resolved chunk count
-- stays strictly below expected_chunks forever. The retry view required
-- resolved_count >= expected_chunks, so such a recording NEVER re-entered the
-- sweep and stranded in 'ready'/'transcribing' indefinitely — never finalizing
-- on the chunks that DID upload. Observed on real coach recordings (one lost
-- chunk out of 25 → whole class stuck, never scored).
--
-- Fix: after a longer stale window (30 min — well past the point a late chunk
-- could still arrive), sweep the recording anyway as long as SOME audio
-- resolved. finalizeRecording then clamps expected_chunks down to the real
-- resolved count and finalizes on the chunks that exist. The 10-minute
-- happy-path branch (all expected chunks present) is unchanged.
CREATE OR REPLACE VIEW public.class_recordings_needing_retry AS
SELECT r.*
FROM public.class_recordings r
WHERE r.status IN ('ready','transcribing')
  AND r.last_heartbeat_at < now() - interval '10 minutes'
  AND (
    r.expected_chunks IS NULL
    OR (
      SELECT count(*) FROM public.class_recording_chunks c
      WHERE c.recording_id = r.id
        AND c.status IN ('uploaded','transcribing','transcribed','failed')
    ) >= r.expected_chunks
    -- Grace branch: a chunk was permanently lost. Process what we have.
    OR (
      r.last_heartbeat_at < now() - interval '30 minutes'
      AND (
        SELECT count(*) FROM public.class_recording_chunks c
        WHERE c.recording_id = r.id
          AND c.status IN ('uploaded','transcribing','transcribed','failed')
      ) >= 1
    )
  );

COMMENT ON VIEW public.class_recordings_needing_retry IS
  'Recordings the cron sweep should re-poke: heartbeat stale AND (all chunks resolved, OR — after 30 min stale — at least one chunk resolved when a chunk was permanently lost).';
