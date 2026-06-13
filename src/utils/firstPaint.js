// ─── First-screen paint signal ──────────────────────────────────────────────
// Lets App.js keep the cold-start logo up until the first real screen
// (student Home / coach Dashboard) has actually painted its initial content —
// so a kill→reopen shows the brand logo continuously instead of flashing an
// empty skeleton while the first page loads.
//
// Module-level + one-shot per JS context: a genuine cold start re-imports this
// with `ready = false`; a warm foreground (app not killed) keeps it `true`, so
// the overlay only ever shows on a real cold launch. App.js also arms a safety
// timeout, so if a first screen never signals the logo can't hang forever.

let ready = false;
let listeners = [];

export function isFirstScreenReady() {
  return ready;
}

// Called by the first screen once its initial content is on screen (from cache
// or after the first load). Idempotent — extra calls are no-ops.
export function markFirstScreenReady() {
  if (ready) return;
  ready = true;
  const queued = listeners;
  listeners = [];
  queued.forEach((fn) => { try { fn(); } catch {} });
}

// Subscribe to the one-shot signal. Returns an unsubscribe fn. Fires immediately
// if already ready.
export function onFirstScreenReady(fn) {
  if (ready) { fn(); return () => {}; }
  listeners.push(fn);
  return () => { listeners = listeners.filter((x) => x !== fn); };
}
