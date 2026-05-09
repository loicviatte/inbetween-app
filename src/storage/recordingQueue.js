// ─── Recording queue ─────────────────────────────────────────────────────
// Persistent queue of pending audio chunk uploads, backed by AsyncStorage.
// One entry per chunk; multiple recordings can have entries simultaneously
// (coach finishes class A, immediately starts class B → A's chunks finish
// uploading in the background while B's chunks start enqueueing).
//
// Each entry shape:
//   {
//     recordingId: string,       // class_recordings.id
//     idx: number,                // 0-based chunk index
//     fileUri: string,            // file:// path to the m4a on disk
//     storagePath: string,        // {user_id}/{recording_id}/{idx}.m4a
//     status: 'pending' | 'uploading' | 'uploaded' | 'failed',
//     retries: number,            // upload retry count
//     nextAttemptAt: number,      // ms epoch — earliest time to retry
//     enqueuedAt: number,
//     error?: string,
//   }
//
// A single AsyncStorage key holds the JSON-serialized array. All mutations
// go through `withQueue` which serializes reads + writes via a Promise chain
// so concurrent callers (chunk rotation + worker drain + app launch hydrate)
// don't race.

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'recordingQueue.v1';

const _listeners = new Set();
let _cache = null; // in-memory mirror, hydrated lazily
let _writeChain = Promise.resolve(); // serializes mutations

function notify() {
  _listeners.forEach((fn) => {
    try { fn(_cache); } catch {}
  });
}

async function loadFromDisk() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function persist(next) {
  try {
    if (next && next.length > 0) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } else {
      await AsyncStorage.removeItem(STORAGE_KEY);
    }
  } catch (err) {
    console.warn('[recordingQueue] persist failed:', err);
  }
}

/**
 * Run a mutator function `(currentEntries) => nextEntries` under the
 * serialized write chain. The mutator may return a Promise. Returns the
 * new entries array.
 */
function withQueue(mutator) {
  const next = _writeChain.then(async () => {
    if (_cache == null) _cache = await loadFromDisk();
    const updated = await mutator(_cache);
    if (updated !== _cache) {
      _cache = updated;
      await persist(updated);
      notify();
    }
    return _cache;
  });
  // Swallow errors here so a single failure doesn't break the chain.
  _writeChain = next.catch(() => {});
  return next;
}

/** Restore from disk on app launch. Idempotent.
 * Any entry that was mid-upload when the app died is reset to 'pending'
 * so the worker actually picks it up on the next drain (a stuck
 * 'uploading' entry would otherwise sit forever — runWorker filters by
 * status !== 'uploaded' so it would still try, but with retries=0 and no
 * backoff, hammering the endpoint immediately on repeated launches).
 */
export async function hydrateRecordingQueue() {
  return withQueue(async (cur) =>
    cur.map((e) =>
      e.status === 'uploading'
        ? { ...e, status: 'pending', nextAttemptAt: Date.now() }
        : e,
    ),
  );
}

/** Subscribe to queue changes. Returns unsubscribe. */
export function subscribeToRecordingQueue(fn) {
  _listeners.add(fn);
  // Notify immediately with current cache if hydrated
  if (_cache != null) {
    try { fn(_cache); } catch {}
  }
  return () => _listeners.delete(fn);
}

/** Synchronous read of the in-memory cache. Returns [] if not hydrated. */
export function getRecordingQueue() {
  return _cache ?? [];
}

/** Add a new chunk to the queue. */
export function enqueueChunk({ recordingId, idx, fileUri, storagePath }) {
  return withQueue(async (cur) => {
    // Dedupe: if a (recordingId, idx) entry exists already, leave it alone.
    if (cur.some((e) => e.recordingId === recordingId && e.idx === idx)) {
      return cur;
    }
    return [
      ...cur,
      {
        recordingId,
        idx,
        fileUri,
        storagePath,
        status: 'pending',
        retries: 0,
        nextAttemptAt: Date.now(),
        enqueuedAt: Date.now(),
      },
    ];
  });
}

/** Replace an entry (by recordingId+idx) with a patched version. */
export function patchChunk(recordingId, idx, patch) {
  return withQueue(async (cur) =>
    cur.map((e) =>
      e.recordingId === recordingId && e.idx === idx ? { ...e, ...patch } : e,
    ),
  );
}

/** Drop an entry from the queue (called once it's persistently uploaded). */
export function removeChunk(recordingId, idx) {
  return withQueue(async (cur) =>
    cur.filter((e) => !(e.recordingId === recordingId && e.idx === idx)),
  );
}

/** Drop ALL entries for a recording (used on coach 'discard'). */
export function clearRecording(recordingId) {
  return withQueue(async (cur) => cur.filter((e) => e.recordingId !== recordingId));
}

/** Get pending entries that are ready to retry now. */
export function getReadyEntries() {
  const now = Date.now();
  return (_cache ?? []).filter(
    (e) => e.status !== 'uploaded' && e.nextAttemptAt <= now,
  );
}

/** Compute exponential backoff delay (ms) for a given retry count. */
export function backoffDelayMs(retries) {
  // 2^n seconds with jitter, capped at 5 minutes.
  const base = Math.min(2 ** retries, 300) * 1000;
  const jitter = Math.floor(Math.random() * 1000);
  return base + jitter;
}
