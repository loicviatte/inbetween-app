// ─── Batched startup hydration ──────────────────────────────────────────────
// Pull every AsyncStorage key the cold-start path needs in a single
// `multiGet` round-trip, then dispatch the values into their respective
// in-memory stores. On Android this is the difference between 3 serial
// bridge round-trips and 1.
//
// Each store accepts a `_hydrate*FromValue(value)` private setter so we can
// populate it without going through the persist-back-to-disk write path.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { _hydrateActiveSessionFromValue } from './activeSession';
import { _hydrateActiveCoachClassFromValue } from './activeCoachClass';
import { _hydrateRecordingQueueFromValue } from './recordingQueue';

const KEYS = [
  'activeSession.v1',
  'activeCoachClass.v1',
  'recordingQueue.v1',
];

// Singleton promise so concurrent callers share the same multiGet
// round-trip. Without this a second caller would race the read and the
// upload worker could see an empty queue, missing pending uploads until
// the next foreground transition.
let _coldHydratePromise = null;

/**
 * Read all hydration keys in one batched call and dispatch into the stores.
 * Idempotent: returns the same in-flight promise on repeat calls so callers
 * can `await` without doubling the AsyncStorage IO.
 */
export function hydrateAllFromCold() {
  if (_coldHydratePromise) return _coldHydratePromise;
  _coldHydratePromise = (async () => {
    let pairs;
    try {
      pairs = await AsyncStorage.multiGet(KEYS);
    } catch {
      return;
    }
    const map = Object.fromEntries(pairs);
    try { _hydrateActiveSessionFromValue(map['activeSession.v1']); } catch {}
    try { _hydrateActiveCoachClassFromValue(map['activeCoachClass.v1']); } catch {}
    try { _hydrateRecordingQueueFromValue(map['recordingQueue.v1']); } catch {}
  })();
  return _coldHydratePromise;
}
