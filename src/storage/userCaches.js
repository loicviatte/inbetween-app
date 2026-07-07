// Centralised cleanup of every AsyncStorage key that holds user-specific
// data. Without this, a logout-then-login-as-someone-else briefly shows the
// previous user's avatar, home screen state, focus points, etc., because
// readers fall through to the cache before the network fetch resolves.
//
// We also stamp an `@auth_user_id` anchor on every successful sign-in. If a
// later sign-in resolves a different user id, we wipe before any UI mounts
// so caches never bleed across users — defence-in-depth for any future code
// path that forgets to call clearUserCaches() on logout.

import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTH_USER_KEY = '@auth_user_id';

// All keys that contain user-specific state. Keep this list exhaustive —
// when a new feature persists user state, add its key here.
const USER_CACHE_KEYS = [
  '@profile_photo',
  '@profile_name',
  '@cache_profile',
  '@cache_home',
  '@cache_log',
  '@skip_add_class_reminder',
  '@pending_class_drafts',
  'train_category_filter',
  'coach.btMic.cumulativeMs',
  'coach.btMic.reminderThresholdMs',
  'coach.liveActivityHintShown.v1',
  'recordingQueue.v1',
  'activeSession.v1',
  'activeCoachClass.v1',
  'startClassRoster.v1',
];

// Families of keys that are per-entity (one key per student+style, etc.) and so
// can't be listed exhaustively — wiped by prefix scan.
const USER_CACHE_PREFIXES = [
  'startClass.bundle.v1:', // persisted Start-Class briefing bundles per student+style
];

async function clearPrefixedCaches() {
  try {
    const all = await AsyncStorage.getAllKeys();
    const doomed = (all || []).filter((k) => USER_CACHE_PREFIXES.some((p) => k.startsWith(p)));
    if (doomed.length) await AsyncStorage.multiRemove(doomed);
  } catch {}
}

/** Remove every user-specific cache. Safe to call repeatedly. */
export async function clearUserCaches() {
  try {
    await AsyncStorage.multiRemove([...USER_CACHE_KEYS, AUTH_USER_KEY]);
    await clearPrefixedCaches();
  } catch {}
}

/**
 * Reconcile the stored auth-user anchor with the freshly-resolved session
 * user id. Wipes caches if the user changed (or signed out). Call this
 * exactly once per auth state event in App.js — it's the safety net that
 * protects against any logout path that forgets to clear caches itself.
 */
export async function reconcileAuthUser(currentUserId) {
  try {
    const previous = await AsyncStorage.getItem(AUTH_USER_KEY);
    if (previous && previous !== currentUserId) {
      // Different user (or signed out → null). Wipe before any screen mounts.
      await AsyncStorage.multiRemove(USER_CACHE_KEYS);
      await clearPrefixedCaches();
    }
    if (currentUserId) {
      await AsyncStorage.setItem(AUTH_USER_KEY, currentUserId);
    } else {
      await AsyncStorage.removeItem(AUTH_USER_KEY);
    }
  } catch {}
}
