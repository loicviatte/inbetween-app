// ─── Global active coach-class store ────────────────────────────────────────
// Mirror of src/storage/activeSession.js but for the coach's running class.
// Used so the Dashboard can show "Class in progress" when the coach navigates
// away from StartClassScreen mid class, and so tapping it reopens the same
// briefing view with the chrono still ticking.
// Persisted to AsyncStorage so we can offer a "Continue recording" prompt
// when the coach reopens the app after killing it mid-recording.

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'activeCoachClass.v1';

let _class = null;
// Shape:
// {
//   kind: 'private' | 'group',
//   startedAt: number (ms since epoch),
//   studentId?: string,
//   studentName?: string,
//   liveActivityId?: string,
//   lastHeartbeatAt?: number,  // updated every ~1s while recording
// }
const _listeners = new Set();

function persist(next) {
  if (next) {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  } else {
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }
}

export function setActiveCoachClass(next) {
  _class = next;
  persist(next);
  _listeners.forEach((fn) => fn(_class));
}

/** Patch a few fields on the active class without rebuilding it from scratch. */
export function patchActiveCoachClass(patch) {
  if (!_class) return;
  _class = { ..._class, ...patch };
  persist(_class);
  _listeners.forEach((fn) => fn(_class));
}

export function getActiveCoachClass() {
  return _class;
}

export function clearActiveCoachClass() {
  _class = null;
  persist(null);
  _listeners.forEach((fn) => fn(null));
}

export function subscribeToActiveCoachClass(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Restore from disk. Call once before the first read on app launch. */
export async function hydrateActiveCoachClass() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return _hydrateActiveCoachClassFromValue(raw);
  } catch {}
  return null;
}

/** Internal: apply a raw value already read elsewhere (used by batched hydrate). */
export function _hydrateActiveCoachClassFromValue(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.startedAt === 'number') {
      _class = parsed;
      _listeners.forEach((fn) => fn(_class));
      return _class;
    }
  } catch {}
  return null;
}
