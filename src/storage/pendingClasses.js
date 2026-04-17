import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@pending_class_drafts';

export async function getPendingClasses() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function writeAll(list) {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

export async function addPendingClass(draft) {
  const list = await getPendingClasses();
  list.push(draft);
  await writeAll(list);
  return list;
}

export async function updatePendingClass(id, patch) {
  const list = await getPendingClasses();
  const idx = list.findIndex(d => d._pendingId === id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...patch };
    await writeAll(list);
  }
  return list;
}

export async function removePendingClass(id) {
  const list = await getPendingClasses();
  const next = list.filter(d => d._pendingId !== id);
  await writeAll(next);
  return next;
}
