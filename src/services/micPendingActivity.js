// ─── The lesson's Live Activity, from class to focus points ─────────────
// A lesson recorded on the DJI mic is done on the coach's side except for one
// step: getting the audio onto the phone. From the moment they stop a lesson,
// a Live Activity follows it on the lock screen and in the Dynamic Island, on
// one rail weighted Lesson 60 · Mic audio 20 · Focus points 20:
//
//   waiting     60%       "No audio yet" — red, with a Plug in your mic button
//   uploading   60→80%    "Sending audio" while the import runs
//   extracting  80→100%   "Finding focus points" while the server works
//   ready       100%      "3 focus points ready" — Validate focus points
//
// Fed by DjiSyncContext: every recount of the lessons awaiting audio (app
// foreground, end of a lesson, end of an import) and every tick of an import.
// iOS only lets an app START an activity while it's on screen. For the steps
// that happen on the server once the app is closed, each activity hands us its
// push token and we file it with the lessons it follows (live_activity_tokens);
// the edge function live-activity-push then moves it on from there, with the
// same rules (supabase/functions/_shared/lessonRoad.ts — keep them in lockstep).
//
// A coach can swipe it away, and iOS ends it after 8 hours. Neither brings it
// back for the same lessons — only a new lesson does. To tell the two apart we
// remember which lessons an activity has already shown, and follow those
// (and only those) until their focus points are validated.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  startMicPending,
  updateMicPending,
  endMicPending,
  micPendingPushTokens,
  addMicPendingPushTokenListener,
  apnsEnvironment,
} from 'live-activities';
import { supabase } from './supabase/client';

const SHOWN_KEY = 'micPendingActivity.shown.v1';
const MIC_SYNC_LINK = 'inbetween://mic-sync';
const REVIEW_LINK = 'inbetween://action-needed';
// A lesson stops being followed a day after it ended, whatever its state.
const FOLLOW_MS = 24 * 3600 * 1000;
// Import ticks arrive every ~700ms; the activity doesn't need them all.
const PROGRESS_MIN_INTERVAL_MS = 1000;

// Where a lesson's audio is on the server, as a share of the Focus points
// segment and the words for it. No count of focus points exists before the
// class opens to its coach, so the steps are all there is to show.
function serverStep(rec) {
  const ci = rec.class_inputs;
  if (!ci) {
    return rec.status === 'transcribing'
      ? { share: 0.3, text: 'Listening to the lesson' }
      : { share: 0.1, text: 'Getting the audio ready' };
  }
  if (ci.status === 'extracted') return { share: 0.75, text: 'Writing the focus points' };
  if (ci.status === 'scored') return { share: 0.9, text: 'Almost ready' };
  return { share: 0.55, text: 'Reading the lesson' };
}

function lessonPhrase(row) {
  if (row.studentName) return `${row.studentName}’s lesson`;
  if (row.lessonType === 'group') return 'Your group lesson';
  if (row.lessonType === 'couple') return 'Your couple lesson';
  return 'Your private lesson';
}

// ─── What the server says about the lessons whose audio has arrived ──────

async function fetchRoad(ids) {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('class_recordings')
    .select('id, status, ended_at, class_input_id, class_inputs:class_input_id(status, coach_released_at)')
    .in('id', ids);
  if (error) throw error;
  const recs = data ?? [];

  // Focus points the coach can act on, per lesson (the class has opened).
  const ciIds = recs.filter((r) => r.class_inputs?.coach_released_at).map((r) => r.class_input_id);
  const names = new Map();
  if (ciIds.length) {
    const pick = (table) => supabase
      .from(table)
      .select('name, source_class_input_id')
      .in('source_class_input_id', ciIds)
      .eq('status', 'pending_coach')
      .eq('is_other', false)
      .eq('is_deleted', false)
      .not('coach_review_deadline', 'is', null);
    const [solo, couple] = await Promise.all([pick('focus_points'), pick('couple_focus_points')]);
    if (solo.error) throw solo.error;
    for (const fp of [...(solo.data ?? []), ...(couple.data ?? [])]) {
      const set = names.get(fp.source_class_input_id) ?? new Set();
      // A group focus point is one row per dancer: count it once.
      set.add(fp.name);
      names.set(fp.source_class_input_id, set);
    }
  }

  return recs.map((r) => {
    const old = r.ended_at && Date.now() - new Date(r.ended_at).getTime() > FOLLOW_MS;
    if (old || r.status === 'failed' || r.status === 'discarded') return { id: r.id, kind: 'gone' };
    if (r.class_inputs?.coach_released_at) {
      const n = names.get(r.class_input_id);
      // Released with nothing left to validate: done with this lesson.
      return n?.size ? { id: r.id, kind: 'ready', names: [...n] } : { id: r.id, kind: 'gone' };
    }
    return { id: r.id, kind: 'moving', ...serverStep(r) };
  });
}

// ─── The state on screen ─────────────────────────────────────────────────

let pending = null; // every lesson awaiting audio (written-off ones included)
let road = []; // server state of the shown lessons whose audio arrived
let importing = { phase: 'idle', progressPct: 0, fileIdx: 0, fileTotal: 0 };

function desiredState() {
  const waiting = (pending ?? []).filter((r) => !r.abandonedAt);

  if (importing.phase === 'syncing') {
    const pct = Math.max(0, Math.min(100, importing.progressPct || 0));
    return {
      stage: 'uploading',
      progress: 0.6 + 0.2 * (pct / 100),
      title: 'Sending audio',
      detail: importing.fileTotal > 1
        ? `Lesson ${Math.min(importing.fileIdx + 1, importing.fileTotal)} of ${importing.fileTotal} · keep the mic plugged`
        : 'Keep the mic plugged',
      badge: null,
      cta: null,
      link: MIC_SYNC_LINK,
    };
  }

  if (waiting.length) {
    const oldest = waiting.reduce((acc, r) => {
      const end = r.endedAt ?? r.startedAt;
      const accEnd = acc.endedAt ?? acc.startedAt;
      return end < accEnd ? r : acc;
    });
    return {
      stage: 'waiting',
      progress: 0.6,
      title: 'No audio yet',
      detail: waiting.length === 1
        ? `${lessonPhrase(oldest)} can’t sync without it`
        : `${waiting.length} lessons can’t sync without it`,
      badge: 'Plug mic',
      cta: 'Plug in your mic',
      link: MIC_SYNC_LINK,
    };
  }

  // Something to validate beats something still in the works.
  const ready = road.filter((x) => x.kind === 'ready');
  if (ready.length) {
    const all = [...new Set(ready.flatMap((x) => x.names))];
    const n = all.length;
    return {
      stage: 'ready',
      progress: 1,
      title: `${n} focus point${n === 1 ? '' : 's'} ready`,
      detail: n > 2 ? `${all.slice(0, 2).join(', ')} +${n - 2}` : all.join(', '),
      badge: `${n} ready`,
      cta: 'Validate focus points',
      link: REVIEW_LINK,
    };
  }

  const moving = road.filter((x) => x.kind === 'moving');
  if (moving.length) {
    // The furthest behind sets the pace.
    const slowest = moving.reduce((a, b) => (b.share < a.share ? b : a));
    return {
      stage: 'extracting',
      progress: 0.8 + 0.2 * slowest.share,
      title: 'Finding focus points',
      detail: slowest.text,
      badge: null,
      cta: null,
      link: REVIEW_LINK,
    };
  }

  return null;
}

// ─── Memory of the lessons shown ─────────────────────────────────────────

async function loadShown() {
  try {
    const raw = await AsyncStorage.getItem(SHOWN_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

async function saveShown(ids) {
  try {
    if (ids.length) await AsyncStorage.setItem(SHOWN_KEY, JSON.stringify(ids));
    else await AsyncStorage.removeItem(SHOWN_KEY);
  } catch {}
}

// ─── The server's copy: push tokens and the lessons they follow ─────────
// Reconciled against what is really alive on the phone, every time: the live
// activities are filed, anything filed that died (ended, dismissed, timed out)
// is withdrawn — and stays on the to-withdraw list, across launches, until the
// server has actually let it go.

const FILED_KEY = 'micPendingActivity.filed.v1';

let lastState = null; // what the activity shows now
let lastFiled = '';

async function loadFiled() {
  try {
    const raw = await AsyncStorage.getItem(FILED_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

async function saveFiled(ids) {
  try {
    if (ids.length) await AsyncStorage.setItem(FILED_KEY, JSON.stringify(ids));
    else await AsyncStorage.removeItem(FILED_KEY);
  } catch {}
}

async function reconcileServer() {
  let live = [];
  try {
    live = await micPendingPushTokens();
  } catch {}
  const liveIds = new Set(live.map((x) => x.activityId));
  const filed = new Set(await loadFiled());

  for (const id of [...filed]) {
    if (liveIds.has(id)) continue;
    const { error } = await supabase.rpc('unregister_live_activity', { p_activity_id: id });
    if (!error) filed.delete(id);
  }

  if (live.length) {
    const shown = await loadShown();
    // The server compares against this to skip pushes that change nothing. An
    // import's ticks are the app's alone — the server never sees one.
    const state = lastState && lastState.stage !== 'uploading' ? lastState : null;
    const sig = JSON.stringify([live, shown, state]);
    if (sig !== lastFiled) {
      const env = apnsEnvironment();
      let ok = true;
      for (const { activityId, token } of live) {
        filed.add(activityId); // before the call: a lost reply must still be withdrawn later
        const { error } = await supabase.rpc('register_live_activity', {
          p_activity_id: activityId,
          p_push_token: token,
          p_apns_env: env,
          p_recording_ids: shown,
          p_state: state,
        });
        if (error) ok = false; // signed out or offline: again on the next recount
      }
      if (ok) lastFiled = sig;
    }
  } else {
    lastFiled = '';
  }
  await saveFiled([...filed]);
}

// ─── Putting it on screen ────────────────────────────────────────────────

let lastSent = '';

async function render({ mayStart }) {
  const state = desiredState();
  let shown = await loadShown();

  if (!state) {
    if (shown.length || lastSent) {
      await endMicPending();
      await saveShown([]);
      lastSent = '';
    }
    lastState = null;
    await reconcileServer();
    return;
  }

  const sig = JSON.stringify(state);
  // Unchanged and nothing new to announce: nothing to send. A new lesson always
  // asks iOS, since only that can bring back an activity the coach dismissed.
  const live = !mayStart && sig === lastSent ? 1 : await updateMicPending(state);
  if (live === 0) {
    // Dismissed or timed out: withdraw it from the server.
    await reconcileServer();
    if (!mayStart) return;
    if (!(await startMicPending(state))) return;
  }
  lastSent = sig;
  lastState = state;
  const waitingIds = (pending ?? []).filter((r) => !r.abandonedAt).map((r) => r.id);
  shown = [...new Set([...shown, ...waitingIds])];
  await saveShown(shown);
  await reconcileServer();
}

async function recount(rows) {
  pending = rows;
  const shown = await loadShown();
  const pendingIds = new Set(rows.map((r) => r.id));
  const waitingIds = rows.filter((r) => !r.abandonedAt).map((r) => r.id);

  // Shown lessons whose audio arrived are followed on the server; written-off
  // ones (still in `rows`, marked abandoned) simply drop out.
  const arrived = shown.filter((id) => !pendingIds.has(id));
  try {
    road = await fetchRoad(arrived);
  } catch {
    // Offline: keep what we knew.
  }
  const done = new Set(road.filter((x) => x.kind === 'gone').map((x) => x.id));
  const abandoned = new Set(rows.filter((r) => r.abandonedAt).map((r) => r.id));
  const stillShown = shown.filter((id) => !done.has(id) && !abandoned.has(id));
  if (stillShown.length !== shown.length) await saveShown(stillShown);
  road = road.filter((x) => x.kind !== 'gone');

  // Only a lesson the coach hasn't been shown yet may (re)start an activity.
  const hasNew = waitingIds.some((id) => !stillShown.includes(id));
  await render({ mayStart: hasNew });
}

// Recounts and import ticks run one after another, never interleaved, so two
// can't both decide to start an activity.
let queue = Promise.resolve();
const enqueue = (fn) => {
  queue = queue.then(fn).catch(() => {});
  return queue;
};

// Apple hands each activity's token over a moment after it starts (and again
// if it rotates).
addMicPendingPushTokenListener(() => {
  enqueue(async () => {
    lastFiled = '';
    await reconcileServer();
  });
});

/** `rows` = every lesson awaiting mic audio, written-off ones included. */
export function syncMicPendingActivity(rows) {
  return enqueue(() => recount(rows));
}

let lastTickAt = 0;

/** Each tick of the mic import (phase, progressPct, fileIdx, fileTotal). */
export function reportMicImportProgress(next) {
  const phaseChanged = next.phase !== importing.phase;
  importing = { ...importing, ...next };
  if (pending === null) return queue;
  const now = Date.now();
  if (!phaseChanged && now - lastTickAt < PROGRESS_MIN_INTERVAL_MS) return queue;
  lastTickAt = now;
  return enqueue(() => render({ mayStart: false }));
}

/** Sign-out: the next account must not inherit this coach's lessons. */
export function clearMicPendingActivity() {
  return enqueue(async () => {
    pending = null;
    road = [];
    importing = { phase: 'idle', progressPct: 0, fileIdx: 0, fileTotal: 0 };
    lastSent = '';
    lastState = null;
    await endMicPending();
    await saveShown([]);
    await reconcileServer();
  });
}
