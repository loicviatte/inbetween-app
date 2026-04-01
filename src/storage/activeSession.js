// ─── Global active-session store ─────────────────────────────────────────────
// Plain JS module — no React context needed.
// FocusSessionScreen writes here; HomeScreen reads here.

let _session = null; // { sessionId, focusPointId, rank, sessionCount, duration, startedAt }
const _listeners = new Set();

// ─── Chat messages store (persists across navigation while session is active) ─
let _chatMessages = [];

export function getChatMessages() { return _chatMessages; }
export function setChatMessages(msgs) { _chatMessages = msgs; }
export function clearChatMessages() { _chatMessages = []; }

export function setActiveSession(session) {
  _session = session;
  _listeners.forEach(fn => fn(_session));
}

export function getActiveSession() {
  return _session;
}

export function clearActiveSession() {
  _session = null;
  _listeners.forEach(fn => fn(null));
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
