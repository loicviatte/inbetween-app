// ─── Global active-session store ─────────────────────────────────────────────
// Plain JS module — no React context needed.
// FocusSessionScreen writes here; HomeScreen reads here.
// Persisted to AsyncStorage so the chrono survives an app kill: the timer is
// computed from wall-clock startedAt, so on relaunch we can restore the same
// session and the elapsed math stays correct.

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'activeSession.v1';

let _session = null; // { sessionId, focusPointId, rank, sessionCount, duration, startedAt, pausedRemaining?, liveActivityId? }
const _listeners = new Set();

// ─── Chat messages store (persists across navigation while session is active) ─
let _chatMessages = [];

export function getChatMessages() { return _chatMessages; }
export function setChatMessages(msgs) { _chatMessages = msgs; }
export function clearChatMessages() { _chatMessages = []; }

function persist(session) {
  if (session) {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session)).catch(() => {});
  } else {
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }
}

export function setActiveSession(session) {
  _session = session;
  persist(session);
  _listeners.forEach(fn => fn(_session));
}

export function getActiveSession() {
  return _session;
}

export function clearActiveSession() {
  _session = null;
  persist(null);
  _listeners.forEach(fn => fn(null));
}

/** Restore from AsyncStorage on app launch. Call once before the first read. */
export async function hydrateActiveSession() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return _hydrateActiveSessionFromValue(raw);
  } catch {}
  return null;
}

/** Internal: apply a raw value already read elsewhere (used by batched hydrate). */
export function _hydrateActiveSessionFromValue(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.startedAt === 'number') {
      _session = parsed;
      _listeners.forEach(fn => fn(_session));
      return _session;
    }
  } catch {}
  return null;
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function subscribeToActiveSession(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Remaining seconds, computed from real wall-clock time.
 *  When paused, `pausedRemaining` is set and the clock is frozen. */
export function getSessionTimeLeft() {
  if (!_session) return 0;
  if (_session.pausedRemaining !== undefined) return _session.pausedRemaining;
  const elapsed = (Date.now() - _session.startedAt) / 1000;
  return Math.max(0, _session.duration * 60 - elapsed);
}
