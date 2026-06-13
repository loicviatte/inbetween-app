-- user_events: lightweight in-app telemetry.
--
-- Captures three signals from the mobile client:
--   - app_open    : AppState transitions to 'active' (fresh launch or
--                   resume from background).
--   - app_close   : AppState transitions away from 'active' (background
--                   or inactive).
--   - screen_view : navigation lands on a new route (Home, Focus, Log,
--                   ClassDetail, etc.). screen_name carries the route.
--
-- Used by the admin dashboard's "Session detail" view to reconstruct a
-- per-user, per-day minute-by-minute timeline alongside the existing
-- practice_logs / class_inputs / notifications activity.

CREATE TABLE IF NOT EXISTS user_events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL CHECK (event_type IN ('app_open', 'app_close', 'screen_view')),
  screen_name TEXT,
  client_ts   TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Most queries are "events for user X on day Y". client_ts is the wall-clock
-- on the device; we sort and bucket by that, not the server-side created_at.
CREATE INDEX IF NOT EXISTS idx_user_events_user_clientts
  ON user_events (user_id, client_ts DESC);

ALTER TABLE user_events ENABLE ROW LEVEL SECURITY;

-- Users can insert their own events (the mobile client writes with the
-- user's auth JWT).
DROP POLICY IF EXISTS "user_events_insert_self" ON user_events;
CREATE POLICY "user_events_insert_self"
  ON user_events
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can read their own events (debugging, future in-app history).
DROP POLICY IF EXISTS "user_events_select_self" ON user_events;
CREATE POLICY "user_events_select_self"
  ON user_events
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Service role bypasses RLS, so admin dashboard queries work without an
-- explicit policy.
