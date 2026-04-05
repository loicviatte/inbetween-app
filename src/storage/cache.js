import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = '@inbetween_cache_';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function cacheSet(key, data) {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}

export async function cacheGet(key) {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}
