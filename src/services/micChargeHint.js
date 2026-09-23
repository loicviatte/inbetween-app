// ─── micChargeHint ───────────────────────────────────────────────────────
// "Charge your mic" for the DJI flow.
//
// The mic's battery level is unreadable: no public iOS API hands a third-party
// app the charge of a USB-C or Bluetooth accessory, and the mic exposes nothing
// but its audio volume. What we CAN see is the consequence — audio that stops
// before the lesson did. When an import lands short (DjiSyncContext), we raise
// this flag; the next debrief reads it and shows the charge card that the
// Bluetooth flow already gets from its own airtime counter.
//
// Raised at import time (mic in hand, plugged into the phone) and consumed
// once, by the first debrief that follows — the moment a coach is putting the
// gear away and can still act on it. Scoped per coach because a studio phone
// can carry two accounts, and expiring so a hint from a month ago never
// resurfaces as a mystery.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'micChargeHint.v1';
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * An import came back short: the lesson ran `gapSec` longer than its audio.
 * Best-effort — a hint we fail to store is a hint the coach doesn't get, never
 * an error they have to see.
 */
export async function raiseMicChargeHint(userId, gapSec) {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ userId, at: Date.now(), gapSec: Math.round(gapSec || 0) }),
    );
  } catch {}
}

/** Reads the flag and clears it — the card shows once, then goes quiet. */
export async function takeMicChargeHint(userId) {
  if (!userId) return false;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return false;
    const hint = JSON.parse(raw);
    if (hint?.userId !== userId) return false;
    await AsyncStorage.removeItem(KEY);
    return Date.now() - (hint.at ?? 0) <= MAX_AGE_MS;
  } catch {
    return false;
  }
}
