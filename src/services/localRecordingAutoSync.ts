// ───────────────────────────────────────────────────────────────────────
// Local-recording auto-sync orchestrator.
//
// Single source of truth for the "import DJI mic files → class_recordings"
// flow. Used by two surfaces:
//
//   1. LocalUploadScreen (manual button): user-initiated, surfaces a
//      confirmation Alert + per-file feedback.
//   2. DashboardScreen (auto-detect): silently kicks off as soon as the
//      app detects new files in the bookmarked DJI folder, with status
//      mirrored into the START CLASS button area.
//
// Confidence policy (Admin review gate):
//   - session.status === 'matched' AND match.confidence === 'high'
//       → admin_review_status = 'approved'
//       → focus points propagate automatically to the student.
//   - Anything else (greedy match, medium/low confidence, count mismatch,
//     errors) → admin_review_status = 'pending'
//       → file is STILL uploaded + transcribed, but focus points stay
//         held back on `inbetween-admin` until a human signs off.
//
// The function is intentionally callback-driven (onProgress) so the two
// surfaces can show different UX without forking the logic.
// ───────────────────────────────────────────────────────────────────────

import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase/client';
import {
  parseDjiFileName,
  matchFilesToClasses,
  groupMicFilesIntoSessions,
  matchSessionsToClasses,
  assignSessionsByDuration,
  MatchSession,
  MatchConfidence,
  MicFile,
  MicSession,
} from './localRecordingMatcher';
import * as DjiFiles from 'local-recording-files';

// ─── Types ───────────────────────────────────────────────────────────────

export interface PendingClassRow {
  id: string;
  lessonType: string | null;
  studentName: string | null;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number;
}

export type AdminReviewStatus = 'approved' | 'pending';

/** One imported file (a chunk). A split recording has several, ordered. */
export interface SyncPartRef {
  fileName: string;
  relativePath: string;
  sizeBytes: number;
}

export interface SyncPair {
  classId: string;
  /**
   * Ordered parts of one continuous recording (DJI splits at ~30:50). Each
   * becomes a chunk (idx 0..N-1); the server stitches them via
   * composeTranscript. Single-file recordings have exactly one part.
   */
  parts: SyncPartRef[];
  /** DJI session index shared by the parts (first part). */
  index: number;
  startTimestamp: Date;
  confidence: MatchConfidence;
  /** Total duration across all parts. */
  actualDurationSec: number;
  studentName: string | null;
  /** Derived from confidence + session.status — auto-approved when sure. */
  adminReviewStatus: AdminReviewStatus;
}

/** A recording on the mic that matched no pending class (safety-net upload). */
export interface OrphanSessionRef {
  index: number;
  startTimestamp: Date;
  durationSec: number;
  parts: SyncPartRef[];
}

export interface AutoSyncResult {
  pairs: SyncPair[];
  status: MatchSession['status'] | 'no_folder' | 'no_candidates';
  totalFilesInFolder: number;
  errors: Array<{ classId: string; error: string }>;
  importedCount: number;
  /**
   * Safety net: recent recordings on the mic that couldn't be paired to a
   * pending class. Uploaded (transcoded) into `unmatched_recordings` so they
   * get OFF the mic and can be attached / troubleshot server-side without
   * recovering the physical mic from the coach.
   */
  unmatchedSessions?: OrphanSessionRef[];
  /** How many unmatched sessions were uploaded this run. */
  unmatchedUploaded?: number;
  /** True if a mic read timed out mid-import (receiver unplugged). */
  micDisconnected?: boolean;
  /** True if an upload failed for a network reason and items are held. */
  offline?: boolean;
  /**
   * Files fully prepared (copied off the mic + transcoded to m4a on disk) but
   * NOT yet uploaded because the network dropped. The provider holds these and
   * retries uploading them on reconnect — no re-copy / re-transcode needed.
   */
  offlinePending?: PreparedUpload[];
}

/** One part of a recording, already transcoded to m4a and sitting on disk. */
export interface PreparedM4aPart {
  /** Local file:// URI of the transcoded m4a in the app's cache. */
  m4aUri: string;
  /** Original DJI WAV filename (used for dedup + mic_file_names). */
  name: string;
  /** Original WAV byte size (for mic_file_size_bytes + summary). */
  sizeBytes: number;
}

/**
 * A recording that's been copied off the mic + transcoded, ready to upload.
 * Carries everything the upload step needs so it can run later (on reconnect)
 * without the mic. `kind` picks the destination: a class (pair) or the
 * unmatched safety-net table (orphan).
 */
export interface PreparedUpload {
  kind: 'pair' | 'orphan';
  /** "Recording 2/5" — for progress labels. */
  label: string;
  m4aParts: PreparedM4aPart[];
  /** Total original duration (for the completion summary). */
  durationSec: number;
  /** Total original WAV bytes (for the completion summary). */
  sizeBytes: number;
  // kind === 'pair'
  classId?: string;
  matched?: { confidence: MatchConfidence; actualDurationSec: number };
  adminReviewStatus?: AdminReviewStatus;
  // kind === 'orphan'
  session?: OrphanSessionRef;
}

export interface AutoSyncCallbacks {
  /** Called once we know how many files we'll import, before the first upload. */
  onPlanned?: (pairs: SyncPair[]) => void;
  /** Called before each pair starts uploading. idx is 0-based. */
  onPairStart?: (pair: SyncPair, idx: number, total: number) => void;
  /** Called after each pair finishes (success OR error). */
  onPairDone?: (pair: SyncPair, idx: number, total: number, err?: Error) => void;
  /**
   * Human-readable live status (copy/upload phase + byte %) for a UI label,
   * plus an optional overall 0..1 fraction across every part of every session
   * (matched pairs + unmatched uploads) to drive a progress bar.
   */
  onProgress?: (status: string, fraction?: number) => void;
  /**
   * Fires when a new recording (matched pair OR unmatched session) starts
   * importing, carrying its 1-based position across the WHOLE run and its
   * total byte size. Lets the UI show "Recording 7 of 12 · 128 MB" without
   * exposing raw DJI filenames.
   */
  onFile?: (info: { idx: number; total: number; sizeBytes: number }) => void;
}

export interface AutoSyncOptions extends AutoSyncCallbacks {
  /**
   * When true, ONLY auto-import pairs with `adminReviewStatus === 'approved'`
   * — pairs needing admin review are skipped (e.g. for the silent dashboard
   * trigger that doesn't want to upload ambiguous matches without user
   * acknowledgement). When false (default), every pair is uploaded.
   */
  onlyHighConfidence?: boolean;
  /**
   * Safety net: after importing matched pairs, also upload any recent mic
   * recording that matched NO class into `unmatched_recordings` (transcoded,
   * not transcribed). Only enabled for the foreground flow (UploadFlowModal)
   * where the coach sees a progress bar — kept off for the silent background
   * trigger to avoid surprise on-device transcoding.
   */
  uploadUnmatched?: boolean;
}

// ─── Error classification ────────────────────────────────────────────────
//
// Heuristic bucketing of a sync failure into the three UX-relevant kinds the
// v2 mic-sync flow renders distinctly. Pure string-matching (no NetInfo dep)
// — good enough to pick the right screen; the raw message is still shown.

export type SyncErrorKind = 'disconnect' | 'offline' | 'generic';

/**
 * `disconnect` — the mic's USB-C volume went away mid-import (bookmark still
 * resolves but the folder/file can't be read).
 * `offline`   — the upload leg failed for a network reason.
 * `generic`   — anything else.
 * Order matters: a read failure after unmount can superficially look generic,
 * so we test the disconnect/offline signatures first.
 */
export function classifySyncError(message?: string | null): SyncErrorKind {
  const m = (message ?? '').toLowerCase();
  if (!m) return 'generic';
  if (
    /unmount|not mounted|no such file|couldn.?t be read|couldn.?t read|no folder|folder access|e_no_folder|e_enumerate|enumerate|bookmark|resolve|volume|disconnect|nsfileread|cfurl|the file .* couldn|operation not permitted/.test(
      m,
    )
  ) {
    return 'disconnect';
  }
  if (
    /network|offline|internet|fetch failed|failed to fetch|timed ?out|timeout|enotfound|econnreset|econnrefused|unreachable|connection|could not connect|nsurlerror|socket|tls|dns|no address/.test(
      m,
    )
  ) {
    return 'offline';
  }
  return 'generic';
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Approximate WAV duration from raw bytes. Calibrated for the DJI Mic 1/2
 * default format (48 kHz × 24-bit × mono = 144000 bytes/sec). Good enough
 * for matcher scoring; the actual duration is queried from AssemblyAI on
 * the server.
 */
function approximateWavDurationSec(sizeBytes: number): number {
  const BYTES_PER_SEC = 144_000;
  return Math.max(0, Math.round((sizeBytes - 44) / BYTES_PER_SEC));
}

/**
 * Count LOGICAL recordings (sessions) among raw mic-folder entries. The DJI mic
 * splits one continuous recording into multiple ~30-min parts that share an
 * index, so a raw parseable-file count over-reports (a 90-min class = 3 files =
 * 1 recording). Groups parts into sessions exactly like the sync pipeline does.
 * Used by the setup success screen so "Found N recordings" matches reality.
 */
export function countMicSessions(
  entries: Array<{ name: string; sizeBytes: number }>,
): number {
  const micFiles: MicFile[] = [];
  for (const entry of entries) {
    const meta = parseDjiFileName(entry.name);
    if (!meta) continue;
    micFiles.push({
      fileName: entry.name,
      index: meta.index,
      timestamp: meta.timestamp,
      durationSec: approximateWavDurationSec(entry.sizeBytes),
      sizeBytes: entry.sizeBytes,
      uri: '',
    });
  }
  return groupMicFilesIntoSessions(micFiles).length;
}

/**
 * Minimum duration we'll consider as a "real" recording, applied
 * symmetrically to BOTH mic files AND pending class_recordings rows:
 *
 *   - Files shorter than this are filtered out at the candidates
 *     stage in planAutoSync (test recordings, accidental REC starts).
 *   - Pending classes shorter than this are filtered out in
 *     fetchPendingUploads (the coach tapped Start then Stop within a
 *     few seconds without recording anything real).
 *
 * The symmetry matters: without it, an accidental 6-second class
 * stays in the pending pool forever, inflates count, forces every
 * sync into count_mismatch → admin review. With it, both ends of the
 * matcher only see legitimate items, so 1 real class + 1 real file =
 * clean count match → auto-approved.
 *
 * 60s threshold is conservative: real coaching sessions are >30min,
 * almost never under a few min. A coach who genuinely needs a sub-60s
 * recording can still attach it via the manual picker in
 * LocalUploadScreen, which bypasses this filter.
 */
const MIN_VALID_DURATION_SEC = 60;

// Safety-net window: how recent (by mic timestamp) a file must be to be
// uploaded as an "unmatched" recording when it can't be paired. Bounds the
// net to recent failed imports rather than vacuuming the mic's whole history.
const ORPHAN_RECENCY_DAYS = 14;

// After upload, the small m4a is kept on-device for a few days as a local
// backup (the big WAV is deleted right away — its original lives on the DJI
// mic). We move it out of tmp (which iOS purges unpredictably) into this
// cache subfolder, and purgeExpiredM4aBackups() deletes anything older than
// the retention window. cacheDirectory means iOS may reclaim it sooner under
// storage pressure — that's an acceptable upper-bound-only guarantee.
const M4A_BACKUP_DIR = `${FileSystem.cacheDirectory ?? ''}dji-m4a-backup/`;
const M4A_BACKUP_RETENTION_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

// Where transcoded m4a live between the PREPARE and UPLOAD phases (and while an
// upload is held waiting for the network to come back). Cache survives
// backgrounding; lost on app kill (then the file re-prepares next launch).
const PREPARE_DIR = `${FileSystem.cacheDirectory ?? ''}dji-prepared/`;
// A prepared m4a normally lives in PREPARE_DIR for seconds (until its upload
// commits and it's retired to backup) — or minutes while an offline hold
// retries. Anything older than this window is a leftover from a hard failure or
// an app kill (the in-memory hold that referenced it is gone), safe to sweep.
// Comfortably longer than any single continuous offline hold so an active
// retry's freshly-written file is never reclaimed out from under it.
const PREPARE_STALE_MS = 24 * 60 * 60 * 1000; // 1 day

function deriveAdminReviewStatus(
  sessionStatus: MatchSession['status'],
  confidence: MatchConfidence,
): AdminReviewStatus {
  // Two layers must agree for auto-approval:
  //   1. Counts lined up exactly (1:1 chronological pairing — no greedy
  //      guesswork that could attach the wrong file).
  //   2. Duration ratio is in the tight high-confidence band (±15%).
  //
  // Anything else lands in the admin queue so a human can look before
  // focus points reach the student.
  if (sessionStatus === 'matched' && confidence === 'high') return 'approved';
  return 'pending';
}

// ─── Data fetch ──────────────────────────────────────────────────────────

export async function fetchPendingUploads(userId: string): Promise<PendingClassRow[]> {
  const { data, error } = await supabase
    .from('class_recordings')
    .select('id, lesson_type, student_id, started_at, ended_at, users:student_id(name)')
    .eq('user_id', userId)
    .eq('local_recording_mode', true)
    .is('mic_file_name', null)
    .not('ended_at', 'is', null)
    .order('started_at', { ascending: false })
    .limit(50);

  if (error) throw error;

  return (data ?? [])
    .map((row: any) => {
      const startedAt = new Date(row.started_at);
      const endedAt = row.ended_at ? new Date(row.ended_at) : null;
      const durationSec = endedAt ? Math.round((+endedAt - +startedAt) / 1000) : 0;
      return {
        id: row.id,
        lessonType: row.lesson_type,
        studentName: row.users?.name ?? null,
        startedAt,
        endedAt,
        durationSec,
      };
    })
    // Symmetric with the file-side <60s filter in planAutoSync: a
    // class that ran for under MIN_VALID_DURATION_SEC isn't a real
    // class — coach probably tapped Start/Stop in quick succession by
    // accident. Filtering here keeps the dashboard pending count
    // clean AND keeps count-mismatch logic from being polluted by
    // ghost classes. The class row stays in the DB for forensics.
    .filter((p) => p.durationSec >= MIN_VALID_DURATION_SEC);
}

async function fetchImportedFilenames(userId: string): Promise<Set<string>> {
  // Dedup by EXACT filename (e.g. "DJI_03_20260514_123159.WAV"), not by
  // mic_file_index. The mic's index counter restarts at 1 whenever it
  // gets reformatted (firmware behaviour, or user-triggered reset),
  // which would otherwise make every "new" file appear < the max we'd
  // already imported and get silently filtered out. The filename
  // includes a precise timestamp from the mic's RTC so collisions
  // across reformats are vanishingly unlikely.
  //
  // Failed / discarded rows are excluded so a stuck upload doesn't
  // permanently block re-syncing the same file.
  const { data, error } = await supabase
    .from('class_recordings')
    .select('mic_file_name, meta')
    .eq('user_id', userId)
    .eq('local_recording_mode', true)
    .not('mic_file_name', 'is', null)
    .not('status', 'in', '(failed,discarded)')
    .limit(500);
  // A failed read is NOT "nothing imported yet". If we swallowed the error and
  // returned an empty/partial Set, every already-imported file would look new
  // and get re-copied/re-transcoded and (on a foreground run) re-INSERTed as a
  // duplicate orphan. Throw so the caller aborts the sync instead.
  if (error) throw error;
  const names = new Set<string>();
  for (const r of (data ?? []) as any[]) {
    if (r.mic_file_name) names.add(r.mic_file_name as string);
    // A split recording stores every part's filename in meta.mic_file_names
    // (mic_file_name only holds the first part). Collect them all so the
    // 2nd/3rd part of an already-imported session isn't re-offered as new.
    const partNames = r.meta?.mic_file_names;
    if (Array.isArray(partNames)) {
      for (const n of partNames) if (typeof n === 'string') names.add(n);
    }
  }
  // Also dedup against files already uploaded via the unmatched safety net,
  // so they're never re-offered or re-uploaded on a later sync. (Table may
  // not exist on older deployments — the optional chain + null guard keep
  // this a no-op rather than throwing in that case.)
  const { data: orphans, error: orphansError } = await supabase
    .from('unmatched_recordings')
    .select('part_filenames')
    .eq('user_id', userId)
    .neq('status', 'discarded')
    .limit(500);
  // Only the documented "table missing on older deployments" case is a safe
  // no-op (Postgres 42P01 / PostgREST relation-not-found). Any OTHER error
  // (network/RLS/timeout) means an incomplete dedup set → throw so we don't
  // re-upload already-orphaned files as duplicates.
  if (orphansError) {
    const code = (orphansError as any).code;
    const missingTable =
      code === '42P01' ||
      code === 'PGRST205' ||
      /relation .* does not exist|could not find the table/i.test(orphansError.message ?? '');
    if (!missingTable) throw orphansError;
  }
  for (const r of (orphans ?? []) as any[]) {
    const parts = r.part_filenames;
    if (Array.isArray(parts)) {
      for (const n of parts) if (typeof n === 'string') names.add(n);
    }
  }
  return names;
}

// ─── Upload ──────────────────────────────────────────────────────────────

async function uploadFileToStorage(
  localUri: string,
  storagePath: string,
  onProgress?: (fraction: number) => void,
  contentType: string = 'audio/wav',
): Promise<void> {
  // Use expo-file-system's BINARY_CONTENT upload — RN fetch+blob+supabase
  // upload silently produces a 0-byte object on iOS for file:// URIs.
  // See uploadWorker.js for the legacy-pipeline analogue.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/class-audio/${storagePath}`;
  const options = {
    httpMethod: 'PUT' as const,
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
  };
  // createUploadTask streams byte progress via the callback; uploadAsync()
  // resolves the same { status, body } shape as the plain upload.
  let lastProgressAt = Date.now();
  let allBytesSentAt = 0; // when the final byte hit the wire (0 = not yet)
  let stallTimer: ReturnType<typeof setInterval> | undefined;
  const task = FileSystem.createUploadTask(url, localUri, options, (p: any) => {
    lastProgressAt = Date.now();
    const total = p?.totalBytesExpectedToSend ?? 0;
    const sent = p?.totalBytesSent ?? 0;
    if (onProgress && total > 0) {
      onProgress(Math.min(1, sent / total));
    }
    // Mark when every byte is on the wire. After this the only wait is the
    // SERVER forming its response, which the watchdog bounds with a SEPARATE,
    // longer ack timeout (not the short no-progress stall) — so a slow ack isn't
    // misread as a lost connection (false offline) while STILL capping a hung/
    // half-open socket that never acks. Fully clearing the watchdog here (an
    // earlier bug) let such a socket hang the upload — and the whole offline
    // retry loop — forever.
    if (total > 0 && sent >= total && !allBytesSentAt) {
      allBytesSentAt = Date.now();
    }
  });

  // If the connection drops MID-upload, the in-flight request does NOT error —
  // it hangs until the OS socket timeout (can be minutes), freezing the bar.
  // Two-phase watchdog, both cancel + reject with a network error so the caller
  // holds the file offline and retries once we're back online:
  //   • mid-transfer: no byte progress for UPLOAD_STALL_MS ⇒ lost connection.
  //   • after all bytes sent: bound the server-ack wait to ACK_TIMEOUT_MS.
  const UPLOAD_STALL_MS = 15_000;
  const ACK_TIMEOUT_MS = 60_000;
  const uploadPromise = task.uploadAsync();
  // Keep it handled — cancelAsync() below can make it reject after we've raced away.
  uploadPromise.catch(() => {});
  const stallGuard = new Promise<never>((_, reject) => {
    stallTimer = setInterval(() => {
      const now = Date.now();
      const stalled = allBytesSentAt
        ? now - allBytesSentAt > ACK_TIMEOUT_MS
        : now - lastProgressAt > UPLOAD_STALL_MS;
      if (stalled) {
        try { task.cancelAsync?.(); } catch {}
        reject(new Error('E_UPLOAD_STALL: network stalled mid-upload — connection lost'));
      }
    }, 3000);
  });

  try {
    const upRes = await Promise.race([uploadPromise, stallGuard]);
    if (!upRes || upRes.status < 200 || upRes.status >= 300) {
      throw new Error(`Storage upload ${upRes?.status}: ${(upRes?.body ?? '').slice(0, 200)}`);
    }
  } finally {
    if (stallTimer) clearInterval(stallTimer);
  }
}

/**
 * Attach one continuous recording — possibly split across several DJI files —
 * to a pending class. Each part is uploaded as an ordered chunk (0.wav,
 * 1.wav, …) and `expected_chunks` is set to the part count, so finalize-class
 * + the AssemblyAI webhook transcribe every part and composeTranscript
 * stitches them into one timeline. A single-file recording is just the
 * one-part case.
 */
export async function attachSessionToClass(args: {
  classId: string;
  userId: string;
  /** Ordered parts (chunk 0..N-1). */
  parts: Array<{ uri: string; name: string; size: number }>;
  matched: { confidence: MatchConfidence; actualDurationSec: number };
  adminReviewStatus: AdminReviewStatus;
  /** Per-part progress: (1-based index, total, 0..1 fraction, phase). */
  onUploadProgress?: (
    partIndex: number,
    partCount: number,
    fraction: number,
    phase?: 'compressing' | 'uploading',
  ) => void;
}): Promise<void> {
  const { classId, userId, parts, matched, adminReviewStatus, onUploadProgress } = args;
  if (parts.length === 0) throw new Error('attachSessionToClass: no parts to upload');

  // Compress each part on-device, then upload it as its own chunk, in order.
  for (let idx = 0; idx < parts.length; idx++) {
    // DJI WAV parts are ~266 MB — over Supabase's 50 MB free-tier cap and
    // heavy on mobile. Transcode to AAC/m4a (~10-30 MB) before upload;
    // AssemblyAI transcribes m4a identically (same format as the live path).
    onUploadProgress?.(idx + 1, parts.length, 0, 'compressing');
    const m4aUri = await DjiFiles.transcodeToM4A(parts[idx].uri);
    const storagePath = `${userId}/${classId}/${idx}.m4a`;
    await uploadFileToStorage(
      m4aUri,
      storagePath,
      (frac) => onUploadProgress?.(idx + 1, parts.length, frac, 'uploading'),
      'audio/mp4',
    );
    const { error: chunkErr } = await supabase
      .from('class_recording_chunks')
      .upsert({
        recording_id: classId,
        idx,
        storage_path: storagePath,
        status: 'uploaded',
      });
    if (chunkErr) throw chunkErr;

    // Delete the WAV right away — it's huge and disposable (a cache copy of a
    // file that still lives on the DJI mic, the real backup).
    try { await FileSystem.deleteAsync(parts[idx].uri, { idempotent: true }); } catch {}
    // Keep the small m4a on-device as a short-lived local backup: move it out
    // of tmp into the cache backup folder; purgeExpiredM4aBackups() deletes it
    // after the retention window. Best-effort — if the move fails it just
    // stays in tmp and gets purged by iOS instead.
    try {
      await FileSystem.makeDirectoryAsync(M4A_BACKUP_DIR, { intermediates: true });
      await FileSystem.moveAsync({ from: m4aUri, to: `${M4A_BACKUP_DIR}${classId}_${idx}.m4a` });
    } catch { /* leave it in tmp */ }
  }

  // Drop any stale chunk rows left by an earlier, LARGER import of this class.
  // Chunks are keyed by (recording_id, idx) and only ever upserted, never
  // deleted, while expected_chunks is re-set to the current part count. If a
  // re-import produces fewer parts, a leftover higher-idx chunk would otherwise
  // survive — and finalize gates on chunk COUNT, not idx completeness — so a
  // stale part could be transcribed into the final transcript.
  {
    const { error: pruneErr } = await supabase
      .from('class_recording_chunks')
      .delete()
      .eq('recording_id', classId)
      .gte('idx', parts.length);
    if (pruneErr) throw pruneErr;
  }

  const first = parts[0];
  const djiMeta = parseDjiFileName(first.name);
  const totalSizeBytes = parts.reduce((sum, p) => sum + (p.size || 0), 0);
  const partNames = parts.map((p) => p.name);

  // Preserve the existing meta (event log) while recording every part's
  // filename for dedup — fetchImportedFilenames reads meta.mic_file_names.
  const { data: existing } = await supabase
    .from('class_recordings')
    .select('meta')
    .eq('id', classId)
    .maybeSingle();
  const mergedMeta = { ...((existing?.meta as Record<string, unknown>) ?? {}), mic_file_names: partNames };

  const { error: updErr } = await supabase
    .from('class_recordings')
    .update({
      status: 'ready',
      expected_chunks: parts.length,
      audio_folder: `${userId}/${classId}/`,
      last_heartbeat_at: new Date().toISOString(),
      // mic_file_name holds the first part (back-compat / display); the full
      // list lives in meta.mic_file_names.
      mic_file_name: first.name,
      mic_file_index: djiMeta?.index ?? null,
      mic_file_timestamp: djiMeta?.timestamp?.toISOString() ?? null,
      mic_file_duration_sec: matched.actualDurationSec,
      mic_file_size_bytes: totalSizeBytes,
      file_imported_at: new Date().toISOString(),
      match_confidence: matched.confidence,
      admin_review_status: adminReviewStatus,
      // If we auto-approved, also stamp the timestamp so the admin
      // dashboard can show "auto-approved at …" alongside human-approved.
      admin_reviewed_at: adminReviewStatus === 'approved'
        ? new Date().toISOString()
        : null,
      meta: mergedMeta,
    })
    .eq('id', classId);
  if (updErr) throw updErr;

  // Best-effort kick of finalize-class. The cron picks up stragglers.
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/finalize-class`;
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ recording_id: classId }),
    }).catch(() => {});
  } catch {
    /* finalize-class is fire-and-forget */
  }
}

/**
 * Single-file convenience wrapper around attachSessionToClass. Kept for the
 * manual single-pick path and any caller that already has one file.
 */
export async function attachFileToClass(args: {
  classId: string;
  userId: string;
  file: { uri: string; name: string; size: number };
  matched: { confidence: MatchConfidence; actualDurationSec: number };
  adminReviewStatus: AdminReviewStatus;
}): Promise<void> {
  const { classId, userId, file, matched, adminReviewStatus } = args;
  return attachSessionToClass({ classId, userId, parts: [file], matched, adminReviewStatus });
}

/**
 * Sweep the on-device m4a backup folder, deleting any file older than the
 * retention window (3 days). The uploaded audio already lives in Supabase
 * Storage, so these are pure local backups — safe to drop once stale. Call
 * this on a surface the coach opens regularly (the upload screen). No-ops if
 * the folder doesn't exist yet. Best-effort: never throws.
 */
export async function purgeExpiredM4aBackups(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(M4A_BACKUP_DIR);
    if (!info.exists) return;
    const names = await FileSystem.readDirectoryAsync(M4A_BACKUP_DIR);
    const now = Date.now();
    for (const name of names) {
      const path = `${M4A_BACKUP_DIR}${name}`;
      try {
        const fi = await FileSystem.getInfoAsync(path);
        // expo-file-system reports modificationTime in seconds since epoch.
        const ageMs = fi.exists && fi.modificationTime
          ? now - fi.modificationTime * 1000
          : Infinity;
        if (ageMs > M4A_BACKUP_RETENTION_MS) {
          await FileSystem.deleteAsync(path, { idempotent: true });
        }
      } catch { /* skip this file */ }
    }
  } catch { /* best-effort */ }
}

/**
 * Sweep the PREPARE_DIR staging folder. Prepared m4a are retired to the backup
 * folder on a successful upload; any file left here past PREPARE_STALE_MS is a
 * leftover from a hard failure, a failed retire-move, or an app kill (the
 * in-memory offline hold that referenced it no longer exists), so it will never
 * be uploaded and is safe to delete. Best-effort: never throws. Call alongside
 * purgeExpiredM4aBackups() on a surface the coach opens regularly.
 */
export async function purgeExpiredPreparedFiles(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(PREPARE_DIR);
    if (!info.exists) return;
    const names = await FileSystem.readDirectoryAsync(PREPARE_DIR);
    const now = Date.now();
    for (const name of names) {
      const path = `${PREPARE_DIR}${name}`;
      try {
        const fi = await FileSystem.getInfoAsync(path);
        const ageMs = fi.exists && fi.modificationTime
          ? now - fi.modificationTime * 1000
          : Infinity;
        if (ageMs > PREPARE_STALE_MS) {
          await FileSystem.deleteAsync(path, { idempotent: true });
        }
      } catch { /* skip this file */ }
    }
  } catch { /* best-effort */ }
}

// ─── Planning: figure out what to import without uploading yet ──────────

/**
 * Inspect the mic folder + DB state and return the proposed import pairs.
 * Does NOT upload anything — caller decides whether to proceed.
 *
 * Returns status === 'no_folder' if the folder bookmark isn't granted
 * (caller should kick off pickFolder via DjiFiles directly).
 */
export async function planAutoSync(
  userId: string,
  pendingClasses: PendingClassRow[],
): Promise<AutoSyncResult> {
  if (!DjiFiles.hasFolder()) {
    return {
      pairs: [],
      status: 'no_folder',
      totalFilesInFolder: 0,
      errors: [],
      importedCount: 0,
    };
  }

  const allEntries = await DjiFiles.listFiles();
  const importedFilenames = await fetchImportedFilenames(userId);

  // Acceptable file dates: each pending class's date ± a couple of days.
  // The DJI mic's RTC is frequently unset/wrong (we've seen it a full day
  // off), and parseDjiFileName builds the timestamp in local time, so a tz
  // shift can nudge the UTC date by one. Chronological ORDER still drives
  // the real matching — this window only excludes ancient files on the mic,
  // while tolerating the clock drift that used to surface as "No new
  // recordings" even though the right files were sitting right there.
  const DATE_TOLERANCE_DAYS = 2;
  const acceptableDates = new Set<string>();
  for (const p of pendingClasses) {
    const base = new Date(Date.UTC(
      p.startedAt.getUTCFullYear(),
      p.startedAt.getUTCMonth(),
      p.startedAt.getUTCDate(),
    ));
    for (let d = -DATE_TOLERANCE_DAYS; d <= DATE_TOLERANCE_DAYS; d++) {
      const dt = new Date(base);
      dt.setUTCDate(dt.getUTCDate() + d);
      acceptableDates.add(dt.toISOString().slice(0, 10));
    }
  }

  // Filter to DJI-pattern files, not already imported (dedup by exact
  // filename — the index counter restarts on reformat), within the date
  // window. NOTE: we do NOT drop short files here — a split recording can
  // end in a short tail part (e.g. a 28s 3rd chunk of a 62-min class) that
  // must stay with its session. The <60s filter is applied per SESSION below.
  const candidates = allEntries
    .map((entry: any) => {
      const meta = parseDjiFileName(entry.name);
      if (!meta) return null;
      if (importedFilenames.has(entry.name)) return null;
      const fileDate = meta.timestamp.toISOString().slice(0, 10);
      if (!acceptableDates.has(fileDate)) return null;
      return { entry, meta };
    })
    .filter(Boolean) as Array<{ entry: any; meta: { index: number; timestamp: Date } }>;

  if (candidates.length === 0) {
    return {
      pairs: [],
      status: 'no_candidates',
      totalFilesInFolder: allEntries.length,
      errors: [],
      importedCount: 0,
    };
  }

  // Build MicFiles + a name→relativePath lookup (relativePath is what
  // DjiFiles.copyFileToCache needs; MicFile itself doesn't carry it).
  const relPathByName = new Map<string, string>();
  const micFiles: MicFile[] = candidates.map(({ entry, meta }) => {
    relPathByName.set(entry.name as string, (entry.relativePath ?? entry.name) as string);
    return {
      fileName: entry.name as string,
      index: meta.index,
      timestamp: meta.timestamp,
      durationSec: approximateWavDurationSec(entry.sizeBytes),
      sizeBytes: entry.sizeBytes as number,
      uri: '',
    };
  });

  // Stitch split parts into continuous recording sessions, then drop
  // sessions too short to be a real class (symmetric with the pending-class
  // <60s filter — the short tail part survives because we sum the session).
  const sessions = groupMicFilesIntoSessions(micFiles)
    .filter((s) => s.durationSec >= MIN_VALID_DURATION_SEC);

  if (sessions.length === 0) {
    return {
      pairs: [],
      status: 'no_candidates',
      totalFilesInFolder: allEntries.length,
      errors: [],
      importedCount: 0,
    };
  }

  const classesForMatcher = pendingClasses.map((p) => ({
    id: p.id,
    startedAt: p.startedAt,
    endedAt: p.endedAt,
    studentName: p.studentName,
  }));

  const sessionToParts = (session: MicSession): SyncPartRef[] =>
    session.parts.map((p) => ({
      fileName: p.fileName,
      relativePath: relPathByName.get(p.fileName) ?? p.fileName,
      sizeBytes: p.sizeBytes,
    }));

  // Resolve match pairs. Two paths:
  //   - status === 'matched': trust the 1:1 chronological pairing
  //   - status === 'count_mismatch': greedy duration scoring (no wall-clock
  //     gate — RTC drift makes absolute time unreliable). Always lands in
  //     admin review since the pairing decision was made under uncertainty.
  const result = matchSessionsToClasses(classesForMatcher, sessions);
  const pairs: SyncPair[] = [];

  if (result.status === 'matched') {
    for (const m of result.matches) {
      const cls = pendingClasses.find((p) => p.id === m.class.id);
      let adminReviewStatus = deriveAdminReviewStatus(result.status, m.confidence);
      // Auto-approval ALSO requires the paired file's date to be plausibly near
      // the class date. Equal session/class counts force a positional 1:1
      // pairing even when the sets are actually mis-aligned — a class with no
      // file plus a stray orphan gives equal counts, and a duration coincidence
      // would otherwise auto-release focus points to the WRONG student. We reuse
      // the SAME ±DATE_TOLERANCE_DAYS *calendar-date* window the candidate gate
      // admits files by, so a legitimate high-RTC-drift match that was admitted
      // is never over-held — only a pair whose date lands outside that window
      // (a genuine mis-alignment) drops to admin review instead of auto-approve.
      if (adminReviewStatus === 'approved' && cls?.startedAt) {
        const DAY_MS = 24 * 60 * 60 * 1000;
        const utcDay = (d: Date) =>
          Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS);
        const dayGap = Math.abs(utcDay(m.session.startTimestamp) - utcDay(cls.startedAt));
        if (!(dayGap <= DATE_TOLERANCE_DAYS)) {
          adminReviewStatus = 'pending';
        }
      }
      pairs.push({
        classId: m.class.id,
        parts: sessionToParts(m.session),
        index: m.session.index,
        startTimestamp: m.session.startTimestamp,
        confidence: m.confidence,
        actualDurationSec: m.actualDurationSec,
        studentName: cls?.studentName ?? null,
        adminReviewStatus,
      });
    }
  } else if (result.status === 'count_mismatch') {
    // Different number of sessions vs classes: assign each class the
    // closest-duration session (absolute wall-clock ignored — DJI RTC drift
    // makes timestamps unreliable). The pure, unit-tested selection logic and
    // its rationale live in assignSessionsByDuration.
    for (const { class: cls, session } of assignSessionsByDuration(classesForMatcher, sessions)) {
      const scored = matchSessionsToClasses([cls], [session]);
      const m = scored.matches[0];
      if (!m) continue;
      const pendingRow = pendingClasses.find((p) => p.id === cls.id);
      pairs.push({
        classId: cls.id,
        parts: sessionToParts(session),
        index: session.index,
        startTimestamp: session.startTimestamp,
        confidence: m.confidence,
        actualDurationSec: m.actualDurationSec,
        studentName: pendingRow?.studentName ?? null,
        // count_mismatch path is always pending review — the pairing was a guess.
        adminReviewStatus: 'pending',
      });
    }
  }

  return {
    pairs,
    status: result.status,
    totalFilesInFolder: allEntries.length,
    errors: [],
    importedCount: 0,
  };
}

// ─── Safety net: unmatched recordings ────────────────────────────────────

/**
 * Find recent (≤ ORPHAN_RECENCY_DAYS) DJI recordings on the mic that aren't
 * already imported (as a class chunk or a prior unmatched upload) and aren't
 * in `excludeFilenames` (files about to be imported as matched pairs this
 * run). Grouped into sessions (split parts stitched) and filtered to
 * ≥ MIN_VALID_DURATION_SEC. These are the "couldn't pair it to a class"
 * leftovers we still want off the mic.
 */
export async function scanUnmatchedSessions(
  userId: string,
  excludeFilenames: Set<string> = new Set(),
): Promise<OrphanSessionRef[]> {
  if (!DjiFiles.hasFolder?.()) return [];
  const allEntries = await DjiFiles.listFiles();
  const imported = await fetchImportedFilenames(userId);
  const cutoffMs = Date.now() - ORPHAN_RECENCY_DAYS * 24 * 60 * 60 * 1000;

  const relPathByName = new Map<string, string>();
  const micFiles: MicFile[] = [];
  for (const entry of allEntries as any[]) {
    const meta = parseDjiFileName(entry.name);
    if (!meta) continue;
    if (imported.has(entry.name)) continue;
    if (excludeFilenames.has(entry.name)) continue;
    if (+meta.timestamp < cutoffMs) continue;
    relPathByName.set(entry.name as string, (entry.relativePath ?? entry.name) as string);
    micFiles.push({
      fileName: entry.name as string,
      index: meta.index,
      timestamp: meta.timestamp,
      durationSec: approximateWavDurationSec(entry.sizeBytes),
      sizeBytes: entry.sizeBytes as number,
      uri: '',
    });
  }

  return groupMicFilesIntoSessions(micFiles)
    .filter((s) => s.durationSec >= MIN_VALID_DURATION_SEC)
    .map((s) => ({
      index: s.index,
      startTimestamp: s.startTimestamp,
      durationSec: s.durationSec,
      parts: s.parts.map((p) => ({
        fileName: p.fileName,
        relativePath: relPathByName.get(p.fileName) ?? p.fileName,
        sizeBytes: p.sizeBytes,
      })),
    }));
}

/**
 * Transcode + upload one unmatched session's parts as m4a chunks and record
 * it in `unmatched_recordings`. NO class link and NO transcription kicked off
 * — it just gets the audio off the mic + into storage/DB for a later attach.
 */
export async function uploadUnmatchedSession(args: {
  userId: string;
  session: OrphanSessionRef;
  /** Ordered parts, already copied to the app cache. */
  parts: Array<{ uri: string; name: string; size: number }>;
  onPartProgress?: (
    partIndex: number,
    partCount: number,
    fraction: number,
    phase: 'compressing' | 'uploading',
  ) => void;
}): Promise<void> {
  const { userId, session, parts, onPartProgress } = args;
  if (parts.length === 0) throw new Error('uploadUnmatchedSession: no parts');

  const tsCompact = session.startTimestamp
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);
  const folder = `unmatched/${session.index}_${tsCompact}`;
  const storagePaths: string[] = [];

  for (let idx = 0; idx < parts.length; idx++) {
    onPartProgress?.(idx + 1, parts.length, 0, 'compressing');
    const m4aUri = await DjiFiles.transcodeToM4A(parts[idx].uri);
    const storagePath = `${userId}/${folder}/${idx}.m4a`;
    await uploadFileToStorage(
      m4aUri,
      storagePath,
      (frac) => onPartProgress?.(idx + 1, parts.length, frac, 'uploading'),
      'audio/mp4',
    );
    storagePaths.push(storagePath);
    try { await FileSystem.deleteAsync(parts[idx].uri, { idempotent: true }); } catch {}
    try {
      await FileSystem.makeDirectoryAsync(M4A_BACKUP_DIR, { intermediates: true });
      await FileSystem.moveAsync({
        from: m4aUri,
        to: `${M4A_BACKUP_DIR}unmatched_${session.index}_${idx}.m4a`,
      });
    } catch { /* leave it in tmp */ }
  }

  const { error } = await supabase.from('unmatched_recordings').insert({
    user_id: userId,
    dji_index: session.index,
    mic_timestamp: session.startTimestamp.toISOString(),
    duration_sec: session.durationSec,
    size_bytes: parts.reduce((n, p) => n + (p.size || 0), 0),
    part_filenames: parts.map((p) => p.name),
    storage_paths: storagePaths,
    status: 'uploaded',
  });
  if (error) throw error;
}

// ─── Upload a prepared (already-transcoded) recording ────────────────────
//
// These take m4a already on disk and ONLY talk to the network + DB — no mic,
// no transcode. Split out from attach/uploadUnmatchedSession so the two-phase
// engine (and the offline-retry path) can upload without re-preparing.

async function uploadPreparedPair(
  userId: string,
  item: PreparedUpload,
  onPartProgress?: (partIndex: number, partCount: number, fraction: number) => void,
): Promise<void> {
  const classId = item.classId as string;
  const { m4aParts, matched } = item;
  for (let idx = 0; idx < m4aParts.length; idx++) {
    const storagePath = `${userId}/${classId}/${idx}.m4a`;
    // Upload straight from PREPARE_DIR and leave the file there. Re-uploading a
    // chunk is idempotent (x-upsert), so if a LATER part fails mid-item and the
    // whole item is retried, every part's m4a is still readable at its original
    // path. We only retire them to backup once the whole item commits (below).
    await uploadFileToStorage(
      m4aParts[idx].m4aUri,
      storagePath,
      (frac) => onPartProgress?.(idx + 1, m4aParts.length, frac),
      'audio/mp4',
    );
    const { error: chunkErr } = await supabase
      .from('class_recording_chunks')
      .upsert({ recording_id: classId, idx, storage_path: storagePath, status: 'uploaded' });
    if (chunkErr) throw chunkErr;
  }

  // Drop stale chunk rows from an earlier, larger import of this class (see the
  // matching prune in attachSessionToClass) so a shrunk re-import can't leave a
  // leftover higher-idx chunk that finalize would fold into the transcript.
  {
    const { error: pruneErr } = await supabase
      .from('class_recording_chunks')
      .delete()
      .eq('recording_id', classId)
      .gte('idx', m4aParts.length);
    if (pruneErr) throw pruneErr;
  }

  const first = m4aParts[0];
  const djiMeta = parseDjiFileName(first.name);
  const totalSizeBytes = m4aParts.reduce((sum, p) => sum + (p.sizeBytes || 0), 0);
  const partNames = m4aParts.map((p) => p.name);
  const { data: existing } = await supabase
    .from('class_recordings')
    .select('meta')
    .eq('id', classId)
    .maybeSingle();
  const mergedMeta = { ...((existing?.meta as Record<string, unknown>) ?? {}), mic_file_names: partNames };

  const { error: updErr } = await supabase
    .from('class_recordings')
    .update({
      status: 'ready',
      expected_chunks: m4aParts.length,
      audio_folder: `${userId}/${classId}/`,
      last_heartbeat_at: new Date().toISOString(),
      mic_file_name: first.name,
      mic_file_index: djiMeta?.index ?? null,
      mic_file_timestamp: djiMeta?.timestamp?.toISOString() ?? null,
      mic_file_duration_sec: matched?.actualDurationSec ?? item.durationSec,
      mic_file_size_bytes: totalSizeBytes,
      file_imported_at: new Date().toISOString(),
      match_confidence: matched?.confidence,
      admin_review_status: item.adminReviewStatus,
      admin_reviewed_at: item.adminReviewStatus === 'approved' ? new Date().toISOString() : null,
      meta: mergedMeta,
    })
    .eq('id', classId);
  if (updErr) throw updErr;

  // Whole item committed — retire the prepared m4a to the short-lived backup.
  for (let idx = 0; idx < m4aParts.length; idx++) {
    try {
      await FileSystem.makeDirectoryAsync(M4A_BACKUP_DIR, { intermediates: true });
      await FileSystem.moveAsync({ from: m4aParts[idx].m4aUri, to: `${M4A_BACKUP_DIR}${classId}_${idx}.m4a` });
    } catch { /* leave it in the prepare dir; the purge sweeps it later */ }
  }

  // Best-effort kick of finalize-class. The cron picks up stragglers.
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/finalize-class`;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ recording_id: classId }),
    }).catch(() => {});
  } catch { /* fire-and-forget */ }
}

async function uploadPreparedOrphan(
  userId: string,
  item: PreparedUpload,
  onPartProgress?: (partIndex: number, partCount: number, fraction: number) => void,
): Promise<void> {
  const session = item.session as OrphanSessionRef;
  const { m4aParts } = item;
  const tsCompact = session.startTimestamp.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const folder = `unmatched/${session.index}_${tsCompact}`;
  const storagePaths: string[] = [];
  for (let idx = 0; idx < m4aParts.length; idx++) {
    const storagePath = `${userId}/${folder}/${idx}.m4a`;
    // Upload from PREPARE_DIR, leave the file there until the whole item's DB
    // row commits (below) so a mid-item retry can re-read every part.
    await uploadFileToStorage(
      m4aParts[idx].m4aUri,
      storagePath,
      (frac) => onPartProgress?.(idx + 1, m4aParts.length, frac),
      'audio/mp4',
    );
    storagePaths.push(storagePath);
  }
  const { error } = await supabase.from('unmatched_recordings').insert({
    user_id: userId,
    dji_index: session.index,
    mic_timestamp: session.startTimestamp.toISOString(),
    duration_sec: session.durationSec,
    size_bytes: m4aParts.reduce((n, p) => n + (p.sizeBytes || 0), 0),
    part_filenames: m4aParts.map((p) => p.name),
    storage_paths: storagePaths,
    status: 'uploaded',
  });
  if (error) throw error;

  // Committed — retire the prepared m4a to the short-lived backup.
  for (let idx = 0; idx < m4aParts.length; idx++) {
    try {
      await FileSystem.makeDirectoryAsync(M4A_BACKUP_DIR, { intermediates: true });
      await FileSystem.moveAsync({ from: m4aParts[idx].m4aUri, to: `${M4A_BACKUP_DIR}unmatched_${session.index}_${idx}.m4a` });
    } catch { /* leave it in the prepare dir; the purge sweeps it later */ }
  }
}

/**
 * Upload a list of already-prepared recordings. Stops at the first NETWORK
 * failure and returns the not-yet-uploaded remainder in `stillPending` so the
 * caller (offline retry) can pick up from there. Non-network per-item failures
 * are recorded and skipped. Emits onFile / onProgress like executeAutoSync.
 */
export async function uploadPreparedItems(
  userId: string,
  items: PreparedUpload[],
  opts: {
    onFile?: (info: { idx: number; total: number; sizeBytes: number }) => void;
    onProgress?: (status: string, fraction?: number) => void;
  } = {},
): Promise<{
  imported: number;
  unmatchedUploaded: number;
  offline: boolean;
  stillPending: PreparedUpload[];
  errors: Array<{ classId: string; error: string }>;
}> {
  let imported = 0;
  let unmatchedUploaded = 0;
  let offline = false;
  const stillPending: PreparedUpload[] = [];
  const errors: Array<{ classId: string; error: string }> = [];
  const total = items.length;
  const partsTotal = items.reduce((n, it) => n + it.m4aParts.length, 0);
  let basePartsDone = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (offline) {
      stillPending.push(item);
      basePartsDone += item.m4aParts.length;
      continue;
    }
    opts.onFile?.({ idx: i + 1, total, sizeBytes: item.sizeBytes });
    const onPart = (partIdx: number, partCount: number, frac: number) =>
      opts.onProgress?.(
        `${item.label} · uploading part ${partIdx}/${partCount} · ${Math.round(frac * 100)}%`,
        partsTotal > 0 ? Math.min(1, (basePartsDone + (partIdx - 1) + frac) / partsTotal) : 0,
      );
    try {
      if (item.kind === 'pair') {
        await uploadPreparedPair(userId, item, onPart);
        imported += 1;
      } else {
        await uploadPreparedOrphan(userId, item, onPart);
        unmatchedUploaded += 1;
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (classifySyncError(msg) === 'offline') {
        offline = true;
        stillPending.push(item);
      } else {
        console.warn(`[autoSync] prepared upload failed: ${msg}`);
        errors.push({ classId: item.classId ?? `unmatched:${item.session?.index}`, error: msg });
      }
    }
    basePartsDone += item.m4aParts.length;
  }
  return { imported, unmatchedUploaded, offline, stillPending, errors };
}

// ─── Execute: prepare (copy + transcode) then upload the planned pairs ────

export async function executeAutoSync(
  userId: string,
  plan: AutoSyncResult,
  opts: AutoSyncOptions = {},
): Promise<AutoSyncResult> {
  const pairsToImport = opts.onlyHighConfidence
    ? plan.pairs.filter((p) => p.adminReviewStatus === 'approved')
    : plan.pairs;

  opts.onPlanned?.(pairsToImport);

  // Safety net (foreground only): recordings on the mic that matched no class.
  // Exclude EVERY matched filename — even pairs skipped under onlyHighConfidence
  // belong to a class and must not also be orphaned.
  let orphanSessions: OrphanSessionRef[] = [];
  if (opts.uploadUnmatched) {
    const matchedNames = new Set<string>(
      plan.pairs.flatMap((p) => p.parts.map((x) => x.fileName)),
    );
    try {
      orphanSessions = await scanUnmatchedSessions(userId, matchedNames);
    } catch (err: any) {
      console.warn('[autoSync] orphan scan failed:', err?.message ?? err);
    }
  }

  const errors: Array<{ classId: string; error: string }> = [];
  let imported = 0;
  let unmatchedUploaded = 0;
  const total = pairsToImport.length;
  // 1-based position denominator spanning matched pairs + orphan uploads, so
  // the UI's "N of M" matches the same run the progress bar reports.
  const combinedTotal = pairsToImport.length + orphanSessions.length;
  const sumPartBytes = (parts: Array<{ sizeBytes: number }>) =>
    parts.reduce((n, p) => n + (p.sizeBytes || 0), 0);

  // Overall progress across every part of every session (pairs + orphans), so
  // the coach sees one continuous 0→100% bar.
  const totalParts =
    pairsToImport.reduce((n, p) => n + p.parts.length, 0) +
    orphanSessions.reduce((n, s) => n + s.parts.length, 0);
  let basePartsDone = 0;
  const emit = (label: string, withinFrac: number) =>
    opts.onProgress?.(
      label,
      totalParts > 0 ? Math.min(1, (basePartsDone + withinFrac) / totalParts) : 0,
    );

  // A receiver unplugged mid-import makes the native security-scoped read hang
  // with no error — the progress bar just freezes. Bound each mic read so a
  // vanished mic surfaces as a disconnect (caught below) instead of hanging.
  let micDisconnected = false;
  const COPY_TIMEOUT_MS = 60_000;
  const copyFromMic = async (relativePath: string): Promise<string> => {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Ask the native side to abort the chunked read so it can release the
        // security scope early. Best-effort: it only lands promptly if the file
        // provider is still returning reads — a fully-dead volume can block
        // in-kernel until iOS gives up. This 60s timeout is the hard backstop.
        try { DjiFiles.cancelCopy?.(); } catch {}
        reject(new Error('E_MIC_TIMEOUT: mic read timed out — receiver likely unplugged'));
      }, COPY_TIMEOUT_MS);
    });
    try {
      return (await Promise.race([DjiFiles.copyFileToCache(relativePath), timeout])) as string;
    } finally {
      clearTimeout(timer!);
    }
  };

  // Bound the transcode too — AVAssetExportSession can hang on a corrupt or
  // partially-copied WAV, which would otherwise freeze the whole sync in
  // "compressing" forever with no error.
  const TRANSCODE_TIMEOUT_MS = 90_000;
  const transcodeWithTimeout = async (wavUri: string): Promise<string> => {
    let timer: ReturnType<typeof setTimeout>;
    let timedOut = false;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        // Stop AVAssetExportSession from encoding a result we've abandoned.
        try { DjiFiles.cancelTranscode?.(); } catch {}
        reject(new Error('E_TRANSCODE: compression stalled — the recording may be corrupt'));
      }, TRANSCODE_TIMEOUT_MS);
    });
    const native = DjiFiles.transcodeToM4A(wavUri);
    // Late-arrival cleanup: if cancelExport() lost the race and the export still
    // finished AFTER our timeout already rejected, JS never consumes this path —
    // delete it so the m4a doesn't orphan in the native temp dir. The second
    // handler swallows a late rejection so it isn't an unhandled promise.
    native.then(
      (path: string) => {
        if (timedOut && path) FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
      },
      () => {},
    );
    try {
      return (await Promise.race([native, timeout])) as string;
    } finally {
      clearTimeout(timer!);
    }
  };

  let offline = false;
  const offlinePending: PreparedUpload[] = [];

  // PREPARE one recording: copy each part off the mic + transcode to m4a in a
  // stable cache dir (so it survives a wait for the network). Throws (and flips
  // micDisconnected) if a mic read times out — reading only touches the mic.
  const prepareParts = async (
    parts: SyncPartRef[],
    labelPrefix: string,
  ): Promise<PreparedM4aPart[]> => {
    const out: PreparedM4aPart[] = [];
    try {
      for (let p = 0; p < parts.length; p++) {
        emit(`${labelPrefix} · reading part ${p + 1}/${parts.length}…`, p);
        let wavUri: string;
        try {
          wavUri = await copyFromMic(parts[p].relativePath);
        } catch (copyErr) {
          micDisconnected = true;
          throw copyErr;
        }
        emit(`${labelPrefix} · compressing part ${p + 1}/${parts.length}…`, p);
        // Always free the ~266 MB copied WAV, even if the transcode times out or
        // throws — its original still lives on the mic, so the cache copy is pure
        // scratch. Without the finally it would leak on every E_TRANSCODE.
        let m4aTmp: string;
        try {
          m4aTmp = await transcodeWithTimeout(wavUri);
        } finally {
          try { await FileSystem.deleteAsync(wavUri, { idempotent: true }); } catch {}
        }
        // Guard against a transcode that reports success but produced an empty /
        // near-empty m4a — a subtly-corrupt WAV that AVFoundation opens with no
        // readable audio can still export .completed. Uploading it would
        // transcribe silence into the class. A real ≥60s recording is hundreds
        // of KB, so anything under a few KB is broken → fail the part (the WAV is
        // already freed; a later sync re-copies the original from the mic).
        const outInfo = await FileSystem.getInfoAsync(m4aTmp);
        if (!outInfo.exists || outInfo.size < 4096) {
          try { await FileSystem.deleteAsync(m4aTmp, { idempotent: true }); } catch {}
          throw new Error('E_TRANSCODE_EMPTY');
        }
        let m4aUri = m4aTmp;
        try {
          await FileSystem.makeDirectoryAsync(PREPARE_DIR, { intermediates: true });
          m4aUri = `${PREPARE_DIR}${parts[p].fileName}_${p}.m4a`;
          await FileSystem.moveAsync({ from: m4aTmp, to: m4aUri });
        } catch { m4aUri = m4aTmp; }
        out.push({ m4aUri, name: parts[p].fileName, sizeBytes: parts[p].sizeBytes });
      }
      return out;
    } catch (err) {
      // A later part failed (e.g. mic unplugged mid-session): the earlier parts'
      // m4a are already staged in PREPARE_DIR but this whole recording won't
      // upload. Delete them so they don't strand until the periodic sweep.
      for (const part of out) {
        try { await FileSystem.deleteAsync(part.m4aUri, { idempotent: true }); } catch {}
      }
      throw err;
    }
  };

  // ── Matched pairs: PREPARE (copy+transcode) then UPLOAD, holding on a
  //    network drop so we can retry the upload later without re-preparing. ──
  for (let i = 0; i < pairsToImport.length; i++) {
    const pair = pairsToImport[i];
    const label = `Recording ${i + 1}/${combinedTotal}`;
    opts.onPairStart?.(pair, i, total);
    opts.onFile?.({ idx: i + 1, total: combinedTotal, sizeBytes: sumPartBytes(pair.parts) });

    let m4aParts: PreparedM4aPart[];
    try {
      m4aParts = await prepareParts(pair.parts, label);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.warn(`[autoSync] prepare failed for class ${pair.classId}: ${msg}`);
      errors.push({ classId: pair.classId, error: msg });
      opts.onPairDone?.(pair, i, total, err instanceof Error ? err : new Error(msg));
      basePartsDone += pair.parts.length;
      if (micDisconnected) break;
      continue;
    }

    const item: PreparedUpload = {
      kind: 'pair',
      label,
      m4aParts,
      durationSec: pair.actualDurationSec,
      sizeBytes: sumPartBytes(pair.parts),
      classId: pair.classId,
      matched: { confidence: pair.confidence, actualDurationSec: pair.actualDurationSec },
      adminReviewStatus: pair.adminReviewStatus,
    };

    if (offline) {
      offlinePending.push(item); // network already down — prepared, upload later
      opts.onPairDone?.(pair, i, total);
      basePartsDone += pair.parts.length;
      continue;
    }
    try {
      await uploadPreparedPair(userId, item, (partIdx, partCount, frac) =>
        emit(`${label} · uploading part ${partIdx}/${partCount} · ${Math.round(frac * 100)}%`, (partIdx - 1) + frac),
      );
      imported += 1;
      opts.onPairDone?.(pair, i, total);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (classifySyncError(msg) === 'offline') {
        offline = true;
        offlinePending.push(item);
      } else {
        console.warn(`[autoSync] upload failed for class ${pair.classId}: ${msg}`);
        errors.push({ classId: pair.classId, error: msg });
        opts.onPairDone?.(pair, i, total, err instanceof Error ? err : new Error(msg));
      }
    }
    basePartsDone += pair.parts.length;
  }

  // ── Safety-net orphans: same PREPARE → UPLOAD → hold flow ──
  for (let j = 0; j < orphanSessions.length; j++) {
    if (micDisconnected) break;
    const session = orphanSessions[j];
    const label = `Recording ${pairsToImport.length + j + 1}/${combinedTotal}`;
    opts.onFile?.({
      idx: pairsToImport.length + j + 1,
      total: combinedTotal,
      sizeBytes: sumPartBytes(session.parts),
    });

    let m4aParts: PreparedM4aPart[];
    try {
      m4aParts = await prepareParts(session.parts, label);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.warn(`[autoSync] prepare failed (unmatched idx ${session.index}): ${msg}`);
      errors.push({ classId: `unmatched:${session.index}`, error: msg });
      basePartsDone += session.parts.length;
      if (micDisconnected) break;
      continue;
    }

    const item: PreparedUpload = {
      kind: 'orphan',
      label,
      m4aParts,
      durationSec: session.durationSec,
      sizeBytes: sumPartBytes(session.parts),
      session,
    };

    if (offline) {
      offlinePending.push(item);
      basePartsDone += session.parts.length;
      continue;
    }
    try {
      await uploadPreparedOrphan(userId, item, (partIdx, partCount, frac) =>
        emit(`${label} · uploading part ${partIdx}/${partCount} · ${Math.round(frac * 100)}%`, (partIdx - 1) + frac),
      );
      unmatchedUploaded += 1;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (classifySyncError(msg) === 'offline') {
        offline = true;
        offlinePending.push(item);
      } else {
        console.warn(`[autoSync] unmatched upload failed (idx ${session.index}): ${msg}`);
        errors.push({ classId: `unmatched:${session.index}`, error: msg });
      }
    }
    basePartsDone += session.parts.length;
  }

  return {
    ...plan,
    pairs: pairsToImport,
    errors,
    importedCount: imported,
    unmatchedSessions: orphanSessions,
    unmatchedUploaded,
    micDisconnected,
    offline,
    offlinePending,
  };
}

// ─── One-shot convenience: plan + execute ───────────────────────────────

export async function runAutoSync(
  userId: string,
  opts: AutoSyncOptions = {},
): Promise<AutoSyncResult> {
  const pending = await fetchPendingUploads(userId);
  if (pending.length === 0) {
    return {
      pairs: [],
      status: 'no_pending_classes',
      totalFilesInFolder: 0,
      errors: [],
      importedCount: 0,
    };
  }
  const plan = await planAutoSync(userId, pending);
  if (plan.status === 'no_folder' || plan.status === 'no_candidates' || plan.pairs.length === 0) {
    return plan;
  }
  return executeAutoSync(userId, plan, opts);
}
