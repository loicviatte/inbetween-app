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
  MatchSession,
  MatchConfidence,
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

export interface SyncPair {
  classId: string;
  micFile: {
    fileName: string;
    relativePath: string;
    index: number;
    timestamp: Date;
    durationSec: number;
    sizeBytes: number;
  };
  confidence: MatchConfidence;
  actualDurationSec: number;
  studentName: string | null;
  /** Derived from confidence + session.status — auto-approved when sure. */
  adminReviewStatus: AdminReviewStatus;
}

export interface AutoSyncResult {
  pairs: SyncPair[];
  status: MatchSession['status'] | 'no_folder' | 'no_candidates';
  totalFilesInFolder: number;
  errors: Array<{ classId: string; error: string }>;
  importedCount: number;
}

export interface AutoSyncCallbacks {
  /** Called once we know how many files we'll import, before the first upload. */
  onPlanned?: (pairs: SyncPair[]) => void;
  /** Called before each pair starts uploading. idx is 0-based. */
  onPairStart?: (pair: SyncPair, idx: number, total: number) => void;
  /** Called after each pair finishes (success OR error). */
  onPairDone?: (pair: SyncPair, idx: number, total: number, err?: Error) => void;
}

export interface AutoSyncOptions extends AutoSyncCallbacks {
  /**
   * When true, ONLY auto-import pairs with `adminReviewStatus === 'approved'`
   * — pairs needing admin review are skipped (e.g. for the silent dashboard
   * trigger that doesn't want to upload ambiguous matches without user
   * acknowledgement). When false (default), every pair is uploaded.
   */
  onlyHighConfidence?: boolean;
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
    .select('mic_file_name')
    .eq('user_id', userId)
    .eq('local_recording_mode', true)
    .not('mic_file_name', 'is', null)
    .not('status', 'in', '(failed,discarded)')
    .limit(500);
  return new Set((data ?? []).map((r: any) => r.mic_file_name as string));
}

// ─── Upload ──────────────────────────────────────────────────────────────

async function uploadFileToStorage(localUri: string, storagePath: string): Promise<void> {
  // Use expo-file-system's BINARY_CONTENT upload — RN fetch+blob+supabase
  // upload silently produces a 0-byte object on iOS for file:// URIs.
  // See uploadWorker.js for the legacy-pipeline analogue.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/class-audio/${storagePath}`;
  const upRes = await FileSystem.uploadAsync(url, localUri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'audio/wav',
      'x-upsert': 'true',
    },
  });
  if (upRes.status < 200 || upRes.status >= 300) {
    throw new Error(`Storage upload ${upRes.status}: ${(upRes.body ?? '').slice(0, 200)}`);
  }
}

export async function attachFileToClass(args: {
  classId: string;
  userId: string;
  file: { uri: string; name: string; size: number };
  matched: { confidence: MatchConfidence; actualDurationSec: number };
  adminReviewStatus: AdminReviewStatus;
}): Promise<void> {
  const { classId, userId, file, matched, adminReviewStatus } = args;
  const storagePath = `${userId}/${classId}/0.wav`;

  await uploadFileToStorage(file.uri, storagePath);

  const { error: chunkErr } = await supabase
    .from('class_recording_chunks')
    .upsert({
      recording_id: classId,
      idx: 0,
      storage_path: storagePath,
      status: 'uploaded',
    });
  if (chunkErr) throw chunkErr;

  const djiMeta = parseDjiFileName(file.name);
  const { error: updErr } = await supabase
    .from('class_recordings')
    .update({
      status: 'ready',
      expected_chunks: 1,
      audio_folder: `${userId}/${classId}/`,
      last_heartbeat_at: new Date().toISOString(),
      mic_file_name: file.name,
      mic_file_index: djiMeta?.index ?? null,
      mic_file_timestamp: djiMeta?.timestamp?.toISOString() ?? null,
      mic_file_duration_sec: matched.actualDurationSec,
      mic_file_size_bytes: file.size,
      file_imported_at: new Date().toISOString(),
      match_confidence: matched.confidence,
      admin_review_status: adminReviewStatus,
      // If we auto-approved, also stamp the timestamp so the admin
      // dashboard can show "auto-approved at …" alongside human-approved.
      admin_reviewed_at: adminReviewStatus === 'approved'
        ? new Date().toISOString()
        : null,
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

  // Filter to:
  //   (a) DJI-pattern filenames
  //   (b) Filename not already in the DB (avoid duplicates / re-syncs).
  //       We dedup by EXACT filename, not by mic_file_index — the
  //       index counter restarts at 1 whenever the mic is reformatted,
  //       so using indices as a proxy for "imported so far" would
  //       silently filter out the entire post-reset batch.
  //   (c) File date matches one of the pending classes' dates — sidesteps
  //       ancient files lying on the mic that have no plausible match.
  const pendingDates = new Set(
    pendingClasses.map((p) => p.startedAt.toISOString().slice(0, 10)),
  );
  const candidates = allEntries
    .map((entry: any) => {
      const meta = parseDjiFileName(entry.name);
      if (!meta) return null;
      if (importedFilenames.has(entry.name)) return null;
      const fileDate = meta.timestamp.toISOString().slice(0, 10);
      if (!pendingDates.has(fileDate)) return null;
      // Filter out files too short to plausibly be a real class —
      // typically test recordings, accidental REC starts, or
      // momentary stops. See MIN_VALID_DURATION_SEC for the
      // reasoning. Caps stray-file inflation that would otherwise
      // force count_mismatch on every sync.
      const approxDur = approximateWavDurationSec(entry.sizeBytes);
      if (approxDur < MIN_VALID_DURATION_SEC) return null;
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

  const micFiles = candidates.map(({ entry, meta }) => ({
    fileName: entry.name as string,
    relativePath: (entry.relativePath ?? entry.name) as string,
    index: meta.index,
    timestamp: meta.timestamp,
    durationSec: approximateWavDurationSec(entry.sizeBytes),
    sizeBytes: entry.sizeBytes as number,
    uri: '',
  }));

  const classesForMatcher = pendingClasses.map((p) => ({
    id: p.id,
    startedAt: p.startedAt,
    endedAt: p.endedAt,
    studentName: p.studentName,
  }));

  const session = matchFilesToClasses(classesForMatcher, micFiles);

  // Resolve match pairs. Two paths:
  //   - status === 'matched': trust the 1:1 chronological pairing
  //   - status === 'count_mismatch': greedy time + duration scoring
  //     with a ±2h window (RTC drift tolerance). Always lands in admin
  //     review since the pairing decision was made under uncertainty.
  const pairs: SyncPair[] = [];

  if (session.status === 'matched') {
    for (const m of session.matches) {
      const cls = pendingClasses.find((p) => p.id === m.class.id);
      pairs.push({
        classId: m.class.id,
        micFile: micFiles.find((f) => f.fileName === m.file.fileName)!,
        confidence: m.confidence,
        actualDurationSec: m.actualDurationSec,
        studentName: cls?.studentName ?? null,
        adminReviewStatus: deriveAdminReviewStatus(session.status, m.confidence),
      });
    }
  } else if (session.status === 'count_mismatch') {
    const sortedClasses = [...classesForMatcher].sort(
      (a, b) => +a.startedAt - +b.startedAt,
    );
    const usedFileIndices = new Set<number>();
    const PROXIMITY_WINDOW_MS = 2 * 60 * 60 * 1000;
    for (const cls of sortedClasses) {
      const expectedDurSec = cls.endedAt
        ? (+cls.endedAt - +cls.startedAt) / 1000
        : 0;
      let bestIdx = -1;
      let bestScore = Infinity;
      for (let i = 0; i < micFiles.length; i++) {
        if (usedFileIndices.has(i)) continue;
        const timeDeltaMs = Math.abs(+micFiles[i].timestamp - +cls.startedAt);
        if (timeDeltaMs > PROXIMITY_WINDOW_MS) continue;
        const timeScore = timeDeltaMs / 60_000;
        let durScore = 0;
        if (expectedDurSec > 0) {
          const ratio = micFiles[i].durationSec / expectedDurSec;
          if (ratio < 0.85) durScore = (0.85 - ratio) * 100;
          else if (ratio > 1.15) durScore = (ratio - 1.15) * 100;
        }
        const score = timeScore + durScore;
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      if (bestIdx === -1) continue;
      usedFileIndices.add(bestIdx);
      const scored = matchFilesToClasses([cls], [micFiles[bestIdx]]);
      const m = scored.matches[0];
      if (!m) continue;
      const pendingRow = pendingClasses.find((p) => p.id === cls.id);
      pairs.push({
        classId: cls.id,
        micFile: micFiles[bestIdx],
        confidence: m.confidence,
        actualDurationSec: m.actualDurationSec,
        studentName: pendingRow?.studentName ?? null,
        // count_mismatch path is always pending review, regardless of
        // individual file confidence — the pairing itself was a guess.
        adminReviewStatus: 'pending',
      });
    }
  }

  return {
    pairs,
    status: session.status,
    totalFilesInFolder: allEntries.length,
    errors: [],
    importedCount: 0,
  };
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

  const errors: Array<{ classId: string; error: string }> = [];
  let imported = 0;
  const total = pairsToImport.length;

  for (let i = 0; i < pairsToImport.length; i++) {
    const pair = pairsToImport[i];
    opts.onPairStart?.(pair, i, total);
    try {
      const cacheUri = await DjiFiles.copyFileToCache(pair.micFile.relativePath);
      await attachFileToClass({
        classId: pair.classId,
        userId,
        file: {
          uri: cacheUri,
          name: pair.micFile.fileName,
          size: pair.micFile.sizeBytes,
        },
        matched: {
          confidence: pair.confidence,
          actualDurationSec: pair.actualDurationSec,
        },
        adminReviewStatus: pair.adminReviewStatus,
      });
      imported += 1;
      opts.onPairDone?.(pair, i, total);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      errors.push({ classId: pair.classId, error: msg });
      opts.onPairDone?.(pair, i, total, err instanceof Error ? err : new Error(msg));
    }
  }

  return {
    ...plan,
    pairs: pairsToImport,
    errors,
    importedCount: imported,
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
