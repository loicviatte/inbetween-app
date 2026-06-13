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
  const { data } = await supabase
    .from('class_recordings')
    .select('mic_file_name, meta')
    .eq('user_id', userId)
    .eq('local_recording_mode', true)
    .not('mic_file_name', 'is', null)
    .not('status', 'in', '(failed,discarded)')
    .limit(500);
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
  const { data: orphans } = await supabase
    .from('unmatched_recordings')
    .select('part_filenames')
    .eq('user_id', userId)
    .neq('status', 'discarded')
    .limit(500);
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
  const task = FileSystem.createUploadTask(url, localUri, options, (p: any) => {
    const total = p?.totalBytesExpectedToSend ?? 0;
    if (onProgress && total > 0) {
      onProgress(Math.min(1, (p?.totalBytesSent ?? 0) / total));
    }
  });
  const upRes = await task.uploadAsync();
  if (!upRes || upRes.status < 200 || upRes.status >= 300) {
    throw new Error(`Storage upload ${upRes?.status}: ${(upRes?.body ?? '').slice(0, 200)}`);
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
      pairs.push({
        classId: m.class.id,
        parts: sessionToParts(m.session),
        index: m.session.index,
        startTimestamp: m.session.startTimestamp,
        confidence: m.confidence,
        actualDurationSec: m.actualDurationSec,
        studentName: cls?.studentName ?? null,
        adminReviewStatus: deriveAdminReviewStatus(result.status, m.confidence),
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

// ─── Execute: upload the planned pairs ──────────────────────────────────

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

  for (let i = 0; i < pairsToImport.length; i++) {
    const pair = pairsToImport[i];
    const ci = i + 1;
    opts.onPairStart?.(pair, i, total);
    try {
      // Copy every part out of the mic's security-scoped folder into the
      // app cache, preserving order, then upload them as ordered chunks.
      const fileParts: Array<{ uri: string; name: string; size: number }> = [];
      for (let p = 0; p < pair.parts.length; p++) {
        emit(`Recording ${ci}/${total} · reading part ${p + 1}/${pair.parts.length}…`, p);
        const cacheUri = await DjiFiles.copyFileToCache(pair.parts[p].relativePath);
        fileParts.push({ uri: cacheUri, name: pair.parts[p].fileName, size: pair.parts[p].sizeBytes });
      }
      await attachSessionToClass({
        classId: pair.classId,
        userId,
        parts: fileParts,
        matched: {
          confidence: pair.confidence,
          actualDurationSec: pair.actualDurationSec,
        },
        adminReviewStatus: pair.adminReviewStatus,
        onUploadProgress: (partIndex, partCount, frac, phase) =>
          emit(
            phase === 'compressing'
              ? `Recording ${ci}/${total} · compressing part ${partIndex}/${partCount}…`
              : `Recording ${ci}/${total} · uploading part ${partIndex}/${partCount} · ${Math.round(frac * 100)}%`,
            (partIndex - 1) + (phase === 'uploading' ? frac : 0),
          ),
      });
      imported += 1;
      opts.onPairDone?.(pair, i, total);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.warn(`[autoSync] import failed for class ${pair.classId} (${pair.parts.length} part(s)): ${msg}`);
      errors.push({ classId: pair.classId, error: msg });
      opts.onPairDone?.(pair, i, total, err instanceof Error ? err : new Error(msg));
    }
    basePartsDone += pair.parts.length;
  }

  // Safety-net uploads (couldn't pair → still get them off the mic).
  for (let j = 0; j < orphanSessions.length; j++) {
    const session = orphanSessions[j];
    const oc = j + 1;
    const oTotal = orphanSessions.length;
    try {
      const fileParts: Array<{ uri: string; name: string; size: number }> = [];
      for (let p = 0; p < session.parts.length; p++) {
        emit(`Unmatched ${oc}/${oTotal} · reading part ${p + 1}/${session.parts.length}…`, p);
        const cacheUri = await DjiFiles.copyFileToCache(session.parts[p].relativePath);
        fileParts.push({ uri: cacheUri, name: session.parts[p].fileName, size: session.parts[p].sizeBytes });
      }
      await uploadUnmatchedSession({
        userId,
        session,
        parts: fileParts,
        onPartProgress: (partIndex, partCount, frac, phase) =>
          emit(
            phase === 'compressing'
              ? `Saving unmatched ${oc}/${oTotal} · part ${partIndex}/${partCount}…`
              : `Saving unmatched ${oc}/${oTotal} · part ${partIndex}/${partCount} · ${Math.round(frac * 100)}%`,
            (partIndex - 1) + (phase === 'uploading' ? frac : 0),
          ),
      });
      unmatchedUploaded += 1;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.warn(`[autoSync] unmatched upload failed (idx ${session.index}): ${msg}`);
      errors.push({ classId: `unmatched:${session.index}`, error: msg });
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
