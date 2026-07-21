// ───────────────────────────────────────────────────────────────────────
// Evening upload reminder — the gate.
//
// notify-sync-reminders already pushes a coach every evening when a class is
// still waiting for its DJI audio. A push is easy to swipe away, so this is
// the second, harder-to-miss half: the rules that decide when the app itself
// takes over the whole screen with the same message (SyncReminderModal).
//
// The scheduling lives here, apart from DjiSyncContext, so the rules read as
// rules — and so the tricky parts (the evening rollover, the escalation
// ladder) are pure functions over an injected `now`.
//
// When it fires:
//   • inside the evening window (20:00 → 02:00, device-local time)
//   • at least one class still awaits its audio and hasn't been abandoned
//   • at most once per evening — unless the coach asked for "later tonight"
//   • never over a running class, an open sync flow, or a sync in progress
//
// Escalation is derived from the DATA, not from a counter we'd have to keep
// in sync: how many evenings the oldest waiting class has now sat there.
//   night 1 → gentle, skip is immediate
//   night 2 → firmer wording, skip is immediate
//   night 3+ → skip unlocks after a beat and asks why (incl. "audio lost",
//              the only answer that stops the nagging for good)
//
// An evening that runs past midnight still belongs to the day it started, so
// every date comparison happens on a clock shifted back by ROLLOVER_H — that
// way "tonight" at 00:30 is the same evening as it was at 23:30.
// ───────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

const STORAGE_KEY = 'syncReminderGate.v1';

// Evening window, device-local. Starts after the last realistic class slot and
// runs past midnight for the coaches who get home late.
export const WINDOW_START_H = 20;
export const WINDOW_END_H = 2;
// Anything before 03:00 counts as the previous evening (see header).
const ROLLOVER_H = 3;

export const MAX_TIER = 3;

/**
 * How long "Not tonight" stays hidden, per tier. Night 1 is free: a coach who
 * was about to comply anyway must never be made to wait — that's how you teach
 * someone to dread a screen. The wait only appears once the evening is
 * genuinely a repeat.
 */
export function skipDelayMsFor(tier) {
  if (tier >= MAX_TIER) return 10000;
  if (tier === 2) return 5000;
  return 0;
}

/**
 * Whether skipping asks for a reason. Same threshold as the delay: night 1
 * stays a plain "not tonight", from night 2 we want to know what's blocking —
 * partly to route the next reminder, partly because naming the obstacle is
 * what surfaces "the audio is lost".
 */
export function asksReason(tier) {
  return tier >= 2;
}

const SNOOZE_NOTIF_ID = 'sync-reminder-snooze';
const MORNING_NOTIF_ID = 'sync-reminder-morning';
// "I'll do it tomorrow" lands here — before the first class of the day, while
// the receiver is still in the bag from last night.
const MORNING_HOUR = 8;

// ─── Time helpers ────────────────────────────────────────────────────────

function shifted(date) {
  return new Date(date.getTime() - ROLLOVER_H * 3600000);
}

function localMidnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Whole calendar days from `a` to `b`; DST-safe (rounds off the ±1h drift). */
function daysBetween(a, b) {
  return Math.round((localMidnight(b) - localMidnight(a)) / 86400000);
}

/**
 * Identifier of the evening `date` falls in — the shared key behind
 * "only once per evening". 23:30 Mon and 00:30 Tue both yield Monday's.
 */
export function eveningKey(date) {
  const s = shifted(date);
  const m = String(s.getMonth() + 1).padStart(2, '0');
  const d = String(s.getDate()).padStart(2, '0');
  return `${s.getFullYear()}-${m}-${d}`;
}

export function isInEveningWindow(date) {
  const h = date.getHours();
  return h >= WINDOW_START_H || h < WINDOW_END_H;
}

/**
 * How many evenings this class has now been waiting, counting the evening it
 * was taught as night 1. Pure function of the class's own end time, so it
 * survives reinstalls, logouts and a cleared cache — unlike a stored counter.
 */
export function nightsWaiting(endedAt, now) {
  if (!endedAt) return 1;
  return Math.max(1, daysBetween(shifted(endedAt), shifted(now)) + 1);
}

// ─── Persisted gate state ────────────────────────────────────────────────
// { lastShownEveningKey: string | null, snoozeUntilMs: number | null }

let _state = null;
let _loading = null;
let _scope = null;

const EMPTY_STATE = { lastShownEveningKey: null, snoozeUntilMs: null };

function storageKey() {
  return _scope ? `${STORAGE_KEY}:${_scope}` : STORAGE_KEY;
}

/**
 * Scope the gate to a user. Two coaches sharing a device (or one account
 * swapped for another while testing) must not inherit each other's "already
 * reminded tonight" — switching drops the cache so the next read comes from
 * that user's own key. Idempotent; call it before any other gate function.
 */
export function setGateScope(userId) {
  if (userId === _scope) return;
  _scope = userId ?? null;
  _state = null;
  _loading = null;
}

export function loadGateState() {
  if (_state) return Promise.resolve(_state);
  if (!_loading) {
    _loading = AsyncStorage.getItem(storageKey())
      .then((raw) => {
        _state = raw ? { ...EMPTY_STATE, ...JSON.parse(raw) } : { ...EMPTY_STATE };
        return _state;
      })
      .catch(() => {
        // A cache we can't read must not silence the reminder — start clean.
        _state = { ...EMPTY_STATE };
        return _state;
      })
      .finally(() => {
        _loading = null;
      });
  }
  return _loading;
}

/** Synchronous peek — null until loadGateState() has resolved once. */
export function peekGateState() {
  return _state;
}

function persist(next) {
  _state = next;
  AsyncStorage.setItem(storageKey(), JSON.stringify(next)).catch(() => {});
  return next;
}

/**
 * Shown for this evening: don't come back until tomorrow night. Marked when
 * the reminder APPEARS, not when it's dismissed — a crash or a force-quit
 * mid-reminder must not turn the evening into a re-open loop.
 *
 * Showing also consumes any snooze that led here.
 */
export function markShown(now = new Date()) {
  return persist({
    ...(_state ?? EMPTY_STATE),
    lastShownEveningKey: eveningKey(now),
    snoozeUntilMs: null,
  });
}

/**
 * "Later tonight": clears the once-per-evening lock that markShown just set,
 * so the reminder genuinely comes back when the snooze expires instead of
 * being swallowed by "already shown tonight".
 */
export function setSnooze(untilMs) {
  return persist({
    ...(_state ?? EMPTY_STATE),
    snoozeUntilMs: untilMs,
    lastShownEveningKey: null,
  });
}

export function clearSnooze() {
  return persist({ ...(_state ?? EMPTY_STATE), snoozeUntilMs: null });
}

/**
 * Give the evening back. Used when the coach takes the ACTION path (import /
 * set up the mic) rather than deferring: heading for the mic isn't the same as
 * saying "not tonight", so bailing out of that flow must not have bought them a
 * free evening. The gate re-fires on its own terms — still in the window, still
 * something pending, nothing else on screen — so a successful import ends it
 * naturally, and only "later" or "not tonight" actually defers.
 */
export function clearShown() {
  return persist({ ...(_state ?? EMPTY_STATE), lastShownEveningKey: null });
}

/** Test/dev helper — drops the once-per-evening lock and any snooze. */
export function resetGateState() {
  return persist({ ...EMPTY_STATE });
}

// ─── The decision ────────────────────────────────────────────────────────

/**
 * Should the full-screen reminder be showing right now?
 *
 * @param now      current time (injected so this stays testable)
 * @param pending  classes awaiting audio, ALREADY filtered of abandoned ones
 * @param state    persisted gate state (peekGateState())
 * @param blocked  true when something owns the screen already (running class,
 *                 open sync flow, sync/error phase) — checked by the caller,
 *                 which is the only side that can see it
 */
export function evaluateReminder({ now, pending, state, blocked }) {
  const no = (reason) => ({ show: false, reason, tier: 0, nights: 0 });

  if (blocked) return no('blocked');
  if (!pending || pending.length === 0) return no('nothing-pending');
  if (!isInEveningWindow(now)) return no('outside-window');

  const s = state ?? EMPTY_STATE;
  if (s.snoozeUntilMs && now.getTime() < s.snoozeUntilMs) return no('snoozed');
  if (s.lastShownEveningKey === eveningKey(now)) return no('already-shown-tonight');

  // The oldest waiting class sets the tone: one class two nights late is more
  // urgent than three taught this afternoon.
  const oldest = pending.reduce((acc, p) => {
    const end = p.endedAt ?? p.startedAt;
    return !acc || end < acc ? end : acc;
  }, null);
  const nights = nightsWaiting(oldest, now);

  return { show: true, reason: 'due', tier: Math.min(MAX_TIER, nights), nights };
}

// ─── "Later tonight" local notification ──────────────────────────────────

/**
 * Back-up for the snooze: the in-app gate only fires while the app is open, so
 * without this a coach who taps "later tonight" and locks their phone hears
 * nothing until tomorrow's server push. Best-effort — no permission, no notif,
 * and the gate still catches them on next foreground.
 */
export async function scheduleSnoozeNotification(untilMs, body) {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    await cancelSnoozeNotification();
    const seconds = Math.max(60, Math.round((untilMs - Date.now()) / 1000));
    await Notifications.scheduleNotificationAsync({
      identifier: SNOOZE_NOTIF_ID,
      content: {
        title: 'Still waiting for your class audio',
        body: body || 'Plug in your DJI mic (USB-C) to import it.',
        data: { type: 'sync_reminder', source: 'snooze' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        repeats: false,
      },
    });
  } catch {
    /* best-effort */
  }
}

export async function cancelSnoozeNotification() {
  try {
    await Notifications.cancelScheduledNotificationAsync(SNOOZE_NOTIF_ID);
  } catch {
    /* nothing scheduled */
  }
}

/**
 * "I'll do it tomorrow" → 08:00 the next morning, before the first class of the
 * day, while the receiver is still in the bag from last night. The evening
 * reminder still comes back on its own; this is the earlier, gentler catch.
 */
export async function scheduleMorningNotification(body, now = new Date()) {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    await cancelMorningNotification();
    const at = new Date(now);
    at.setHours(MORNING_HOUR, 0, 0, 0);
    // Past 08:00 already (the usual case — it's the evening) → tomorrow.
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
    await Notifications.scheduleNotificationAsync({
      identifier: MORNING_NOTIF_ID,
      content: {
        title: 'Your class audio is still waiting',
        body: body || 'Plug in your DJI mic (USB-C) to import it before today’s classes.',
        data: { type: 'sync_reminder', source: 'morning' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
  } catch {
    /* best-effort */
  }
}

export async function cancelMorningNotification() {
  try {
    await Notifications.cancelScheduledNotificationAsync(MORNING_NOTIF_ID);
  } catch {
    /* nothing scheduled */
  }
}

/** Everything landed → drop both pending local reminders. */
export async function cancelAllReminderNotifications() {
  await Promise.all([cancelSnoozeNotification(), cancelMorningNotification()]);
}

// ─── Open-on-demand bus ──────────────────────────────────────────────────
// Tapping the nightly push should land on the same full-screen reminder, but
// the tap is handled in App.js — above the coach navigator that owns the
// modal. This tiny bus carries the request down, and latches it when the tap
// cold-starts the app (the provider mounts later, and subscribing replays it).

const _listeners = new Set();
let _pendingOpen = false;

export function requestReminderOpen() {
  if (_listeners.size === 0) {
    _pendingOpen = true;
    return;
  }
  _listeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

export function subscribeReminderOpen(fn) {
  _listeners.add(fn);
  if (_pendingOpen) {
    _pendingOpen = false;
    try {
      fn();
    } catch {}
  }
  return () => _listeners.delete(fn);
}
