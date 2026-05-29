// ─── Role resolution + caching ───────────────────────────────────────────────
// On cold start we want the right navigator on screen instantly. The naive
// path — `await supabase.from('users').select('role')` — adds a 200-800 ms
// round-trip before the navigator can mount.
//
// This module gives the caller a role in three priority layers:
//   1. `session.user.user_metadata.role` — already in memory once getSession()
//      resolves from AsyncStorage. Zero extra IO.
//   2. `@user_role:<userId>` cache in AsyncStorage — populated after the first
//      DB lookup. One AsyncStorage read, ~30 ms.
//   3. DB fallback — only used if neither of the above had it.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase/client';

const ROLE_KEY = (userId) => `@user_role:${userId}`;

const VALID_ROLES = new Set(['student', 'coach']);

function sanitize(role) {
  if (!role) return null;
  return VALID_ROLES.has(role) ? role : null;
}

/** Read role from session metadata + AsyncStorage cache. No network. */
export async function readCachedRole(session) {
  if (!session?.user?.id) return null;
  const fromMeta = sanitize(session.user.user_metadata?.role);
  if (fromMeta) return fromMeta;
  try {
    const cached = await AsyncStorage.getItem(ROLE_KEY(session.user.id));
    return sanitize(cached);
  } catch {
    return null;
  }
}

/** Query the DB for the authoritative role and refresh the cache. */
export async function loadFreshRole(userId) {
  if (!userId) return null;
  let role = null;
  try {
    const { data } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();
    role = sanitize(data?.role);
  } catch {}
  if (!role) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      role = sanitize(user?.user_metadata?.role) || 'student';
    } catch {
      role = 'student';
    }
  }
  try {
    await AsyncStorage.setItem(ROLE_KEY(userId), role);
  } catch {}
  return role;
}
