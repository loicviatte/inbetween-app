// Lightweight in-app telemetry — writes to the `user_events` table.
//
// We track three signals:
//   - app_open    : called from App.js when AppState becomes 'active'
//   - app_close   : called from App.js when AppState leaves 'active'
//   - screen_view : called from the NavigationContainer's onStateChange
//                   with the new route name
//
// Events are buffered in memory and flushed in batches to keep the impact
// on UX minimal — a single screen transition shouldn't trigger a network
// roundtrip in the hot path. The buffer is also flushed eagerly on
// app_close so we don't lose a backgrounded session.

import { supabase } from './supabase/client';

const FLUSH_INTERVAL_MS = 8_000;
const FLUSH_BATCH_SIZE = 20;
// Cap so a runaway producer (e.g. nav state loop) can't OOM the buffer.
const MAX_BUFFER = 200;

let buffer = [];
let flushTimer = null;
let cachedUserId = null;
// Avoid spamming app_open/app_close when AppState bounces ('active' →
// 'inactive' → 'active' within a few ms during system sheets, FaceID, etc.).
let lastEventType = null;
let lastEventAt = 0;
const DEDUPE_WINDOW_MS = 1500;

async function getUserId() {
  if (cachedUserId) return cachedUserId;
  try {
    const { data } = await supabase.auth.getUser();
    cachedUserId = data?.user?.id ?? null;
    return cachedUserId;
  } catch {
    return null;
  }
}

// Public: reset the cached user when the session changes (sign in / out).
export function resetAnalyticsUser() {
  cachedUserId = null;
  // Don't carry events from the previous user into the next session.
  buffer = [];
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush().catch(() => {});
  }, FLUSH_INTERVAL_MS);
}

export async function flush() {
  if (buffer.length === 0) return;
  const userId = await getUserId();
  if (!userId) {
    // Not signed in — drop the buffer rather than holding onto pre-auth
    // events. Anonymous telemetry isn't useful for per-user timelines.
    buffer = [];
    return;
  }
  const rows = buffer.splice(0, buffer.length).map((e) => ({
    user_id: userId,
    event_type: e.event_type,
    screen_name: e.screen_name ?? null,
    client_ts: e.client_ts,
  }));
  try {
    await supabase.from('user_events').insert(rows);
  } catch {
    // Network blip — silently drop. We don't want telemetry retries to
    // interfere with real app traffic, and a missed event is acceptable.
  }
}

function enqueue(event_type, screen_name) {
  const now = Date.now();
  // Dedupe consecutive identical events within a small window.
  if (
    event_type === lastEventType &&
    now - lastEventAt < DEDUPE_WINDOW_MS &&
    event_type !== 'screen_view' // screen views may legitimately repeat
  ) {
    return;
  }
  lastEventType = event_type;
  lastEventAt = now;

  if (buffer.length >= MAX_BUFFER) {
    // Drop the oldest to make room — keeps memory bounded.
    buffer.shift();
  }
  buffer.push({
    event_type,
    screen_name,
    client_ts: new Date(now).toISOString(),
  });

  if (buffer.length >= FLUSH_BATCH_SIZE) {
    flush().catch(() => {});
  } else {
    scheduleFlush();
  }
}

export function trackAppOpen() {
  enqueue('app_open', null);
}

export function trackAppClose() {
  enqueue('app_close', null);
  // Eagerly flush on close so we don't lose the trailing event when the
  // OS kills the JS context shortly after.
  flush().catch(() => {});
}

export function trackScreenView(screenName) {
  if (!screenName) return;
  // Dedupe back-to-back identical screens (Navigation fires onStateChange
  // for parent + child route — we only want the leaf).
  const last = buffer[buffer.length - 1];
  if (last?.event_type === 'screen_view' && last?.screen_name === screenName) {
    return;
  }
  enqueue('screen_view', screenName);
}
