// ─── Global active coach-class store ────────────────────────────────────────
// Mirror of src/storage/activeSession.js but for the coach's running class.
// Used so the Dashboard can show "Class in progress" when the coach navigates
// away from StartClassScreen mid class, and so tapping it reopens the same
// briefing view with the chrono still ticking.

let _class = null;
// Shape:
// {
//   kind: 'private' | 'group',
//   startedAt: number (ms since epoch),
//   studentId?: string,         // private only
//   studentName?: string,       // private only
// }
const _listeners = new Set();

export function setActiveCoachClass(next) {
  _class = next;
  _listeners.forEach((fn) => fn(_class));
}

export function getActiveCoachClass() {
  return _class;
}

export function clearActiveCoachClass() {
  _class = null;
  _listeners.forEach((fn) => fn(null));
}

export function subscribeToActiveCoachClass(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
