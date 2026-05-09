// ─── Upload worker ──────────────────────────────────────────────────────
// Drains the recording queue (src/storage/recordingQueue.js) by uploading
// each pending chunk to Supabase Storage and patching the corresponding
// class_recording_chunks row.
//
// Concurrency: serializes uploads through a single in-flight slot. We could
// parallelize 2-3 wide but at chunk sizes of ~720 KB the network is rarely
// the bottleneck, and serializing keeps memory + retry logic simple.
//
// Lifecycle:
//   - `startUploadWorker()` is called on app launch (after queue hydrate),
//     and immediately on every chunk enqueue. It's also re-poked when the
//     app comes to foreground.
//   - The worker exits cleanly when the queue is empty. It re-enters on
//     the next external trigger.
//
// Failure handling:
//   - On any upload error, mark the entry `failed` with an exponential
//     backoff `nextAttemptAt`. Next worker tick will retry once the
//     deadline passes.

import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase/client';
import {
  getRecordingQueue,
  patchChunk,
  removeChunk,
  backoffDelayMs,
} from '../storage/recordingQueue';

let _workerActive = false;
let _scheduledTimer = null;
const BUCKET = 'class-audio';
const MAX_RETRIES_BEFORE_GIVING_UP = 12; // ~5 min cap × 12 ≈ 1h of retries

/**
 * Trigger a worker run. Idempotent — if a run is in progress, this is a
 * no-op. Schedules a delayed run if any entry is currently in backoff.
 */
export function pokeUploadWorker() {
  if (_workerActive) return;
  _workerActive = true;
  // Run async, swallow errors at the top level.
  runWorker().finally(() => {
    _workerActive = false;
    scheduleNextRunIfNeeded();
  });
}

function scheduleNextRunIfNeeded() {
  // If any entry is waiting on backoff, schedule a wake-up.
  const queue = getRecordingQueue();
  const pending = queue.filter((e) => e.status !== 'uploaded');
  if (pending.length === 0) return;
  const now = Date.now();
  const earliestNext = pending.reduce(
    (min, e) => Math.min(min, e.nextAttemptAt || now),
    Infinity,
  );
  if (earliestNext === Infinity) return;
  const delay = Math.max(1000, earliestNext - now);
  if (_scheduledTimer) clearTimeout(_scheduledTimer);
  _scheduledTimer = setTimeout(() => {
    _scheduledTimer = null;
    pokeUploadWorker();
  }, Math.min(delay, 5 * 60 * 1000));
}

async function runWorker() {
  while (true) {
    const queue = getRecordingQueue();
    const now = Date.now();
    // Pick the next entry that's ready to attempt (status not uploaded,
    // and not in backoff).
    const next = queue.find(
      (e) => e.status !== 'uploaded' && (e.nextAttemptAt || 0) <= now,
    );
    if (!next) return; // nothing to do right now

    await uploadOne(next);
  }
}

async function uploadOne(entry) {
  const { recordingId, idx, fileUri, storagePath, retries = 0 } = entry;

  // Mark uploading so the UI can show progress.
  await patchChunk(recordingId, idx, { status: 'uploading' });

  try {
    // expo-file-system can read the file as a binary blob via uploadAsync.
    // Supabase Storage REST endpoint accepts raw binary PUT with the right
    // headers. We use the user's session JWT — RLS on the bucket
    // (folder = auth.uid()) gates writes to the coach's own folder.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not signed in');

    const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`;
    // PUT is the canonical upsert verb on Supabase Storage's REST API.
    // POST works for new objects but returns 400 on retries when the file
    // already exists. PUT + x-upsert handles both cases (initial upload
    // and retry-after-network-blip) without conditional logic.
    const upRes = await FileSystem.uploadAsync(url, fileUri, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'audio/m4a',
        'x-upsert': 'true',
      },
    });
    // Storage returns 200 on success (object created or updated). Some
    // proxies return 204 on a no-op replace — accept that too.
    if (upRes.status < 200 || upRes.status >= 300) {
      throw new Error(`Storage upload ${upRes.status}: ${upRes.body?.slice(0, 200) || ''}`);
    }

    // Update class_recording_chunks row to status='uploaded'.
    const { error: dbErr } = await supabase
      .from('class_recording_chunks')
      .update({
        storage_path: storagePath,
        status: 'uploaded',
        uploaded_at: new Date().toISOString(),
        error: null,
      })
      .eq('recording_id', recordingId)
      .eq('idx', idx);
    if (dbErr) throw new Error(`DB update: ${dbErr.message}`);

    // Drop from local queue — the file is safely in Storage and the chunk
    // row knows about it.
    await removeChunk(recordingId, idx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const nextRetries = retries + 1;
    if (nextRetries > MAX_RETRIES_BEFORE_GIVING_UP) {
      // Give up on this chunk. Mark it failed in DB so finalize-class can
      // proceed without it. The local file is left on disk for forensic
      // recovery.
      console.warn(`[uploadWorker] giving up on chunk ${recordingId}/${idx} after ${nextRetries} retries: ${msg}`);
      await supabase
        .from('class_recording_chunks')
        .update({
          status: 'failed',
          error: msg.slice(0, 500),
          retries: nextRetries,
        })
        .eq('recording_id', recordingId)
        .eq('idx', idx);
      await removeChunk(recordingId, idx);
      return;
    }
    const delay = backoffDelayMs(retries);
    await patchChunk(recordingId, idx, {
      status: 'failed',
      retries: nextRetries,
      nextAttemptAt: Date.now() + delay,
      error: msg.slice(0, 500),
    });
    console.warn(`[uploadWorker] chunk ${recordingId}/${idx} failed (retry in ${Math.round(delay/1000)}s):`, msg);
  }
}
