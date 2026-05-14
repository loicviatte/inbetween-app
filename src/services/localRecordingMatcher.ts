// ───────────────────────────────────────────────────────────────────────
// Local recording matcher.
//
// Pairs DJI mic audio files (recorded on-device, imported via USB-C) with
// pending class_recordings entries. Pure logic — no React Native, no
// network — so it's trivially unit-testable.
//
// Strategy:
//   1. Filter classes to those in `awaiting_audio` status for the coach.
//   2. Sort classes and files chronologically by start time.
//   3. Reject the whole batch if counts don't match (anomaly → human review).
//   4. Match 1:1 by position and score each pairing by duration ratio.
//
// Why chronological order alone is enough: the DJI mic's filename index
// (DJI_NN_...) is monotonic over the lifetime of the device and the
// filename timestamp (DJI_NN_YYYYMMDD_HHMMSS) is monotonic within a day,
// even when the RTC has drifted from real wall-clock time. So as long as
// the coach starts/stops the mic in lockstep with each class, the i-th
// file in chronological order corresponds to the i-th class — full stop.
//
// Duration verification is the cheap second check: a yoga class is ~60min,
// a stray test recording is ~10sec, so the duration ratio cleanly flags
// mismatches even when the count happens to line up by coincidence.
// ───────────────────────────────────────────────────────────────────────

export interface ClassRecording {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  studentName?: string | null;
}

export interface MicFile {
  fileName: string;       // "DJI_21_20260512_132205.WAV"
  index: number;          // 21
  timestamp: Date;        // mic RTC time (may drift from real time)
  durationSec: number;
  sizeBytes: number;
  uri: string;            // local URI on phone after copy
}

export type MatchConfidence = 'high' | 'medium' | 'low';

export interface MatchResult {
  class: ClassRecording;
  file: MicFile;
  confidence: MatchConfidence;
  expectedDurationSec: number;
  actualDurationSec: number;
  durationRatio: number;
  reasons: string[];
}

export type MatchSessionStatus =
  | 'matched'             // Every class paired with a file
  | 'count_mismatch'      // Different number of files vs classes — needs manual
  | 'no_pending_classes'  // Nothing waiting on audio
  | 'no_new_files';       // No unimported files to consider

export interface MatchSession {
  status: MatchSessionStatus;
  matches: MatchResult[];
  unmatchedClasses: ClassRecording[];
  unmatchedFiles: MicFile[];
}

// ─── Filename parser ─────────────────────────────────────────────────────

// Pattern: DJI_<index>_<YYYYMMDD>_<HHMMSS>.WAV  (case-insensitive .wav)
// Example: DJI_21_20260512_132205.WAV
const DJI_NAME_RE = /^DJI_(\d+)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.wav$/i;

/**
 * Parse a DJI Mic filename. Returns null if the name doesn't match the
 * expected DJI_NN_YYYYMMDD_HHMMSS.WAV pattern (e.g. for unrelated files
 * dropped in the same folder).
 */
export function parseDjiFileName(name: string): {
  index: number;
  timestamp: Date;
} | null {
  const m = name.match(DJI_NAME_RE);
  if (!m) return null;

  const [, idxStr, yyyy, mm, dd, hh, mi, ss] = m;
  return {
    index: parseInt(idxStr, 10),
    timestamp: new Date(
      parseInt(yyyy, 10),
      parseInt(mm, 10) - 1, // JS months are 0-indexed
      parseInt(dd, 10),
      parseInt(hh, 10),
      parseInt(mi, 10),
      parseInt(ss, 10),
    ),
  };
}

// ─── Duration scoring ────────────────────────────────────────────────────

// Tolerance bands: how close must the audio file's duration be to the
// expected class duration before we trust the match?
//
//   - high   : within ±15% → solid signal, e.g. 60min class + 51-69min file
//   - medium : within ±50% → acceptable but flag for admin attention
//   - low    : outside ±50% → almost certainly the wrong file
//
// These bands are calibrated for the typical fitness/yoga class length
// (30-90 min). For very short or very long classes you'd want different
// bands, but the MVP is built for one-hour-ish sessions.
const HIGH_RATIO_MIN = 0.85;
const HIGH_RATIO_MAX = 1.15;
const MEDIUM_RATIO_MIN = 0.5;
const MEDIUM_RATIO_MAX = 1.5;

function scoreMatch(
  cls: ClassRecording,
  file: MicFile,
): {
  confidence: MatchConfidence;
  expectedDurationSec: number;
  actualDurationSec: number;
  durationRatio: number;
  reasons: string[];
} {
  const expectedDurationSec =
    cls.endedAt ? Math.round((+cls.endedAt - +cls.startedAt) / 1000) : 0;
  const actualDurationSec = Math.round(file.durationSec);
  const ratio = expectedDurationSec > 0 ? actualDurationSec / expectedDurationSec : 0;

  const reasons: string[] = [];
  let confidence: MatchConfidence;

  if (expectedDurationSec <= 0) {
    // Class never got an end timestamp — can't score by duration. Default
    // to medium so the human review screen surfaces it.
    confidence = 'medium';
    reasons.push('Class has no end timestamp; falling back to chronological position only.');
  } else if (ratio >= HIGH_RATIO_MIN && ratio <= HIGH_RATIO_MAX) {
    confidence = 'high';
    reasons.push(
      `Duration matches (${actualDurationSec}s vs expected ${expectedDurationSec}s, ratio ${ratio.toFixed(2)}).`
    );
  } else if (ratio >= MEDIUM_RATIO_MIN && ratio <= MEDIUM_RATIO_MAX) {
    confidence = 'medium';
    reasons.push(
      `Duration off (${actualDurationSec}s vs expected ${expectedDurationSec}s, ratio ${ratio.toFixed(2)}). Within 50% — could be early stop or extended class.`
    );
  } else {
    confidence = 'low';
    reasons.push(
      `Duration far from expected (${actualDurationSec}s vs ${expectedDurationSec}s, ratio ${ratio.toFixed(2)}). Likely the wrong file.`
    );
  }

  return { confidence, expectedDurationSec, actualDurationSec, durationRatio: ratio, reasons };
}

// ─── The matcher ─────────────────────────────────────────────────────────

/**
 * Match files to classes for a single coach's import session. Both arrays
 * may be in any order; the matcher sorts them internally.
 *
 * Returns one of four session statuses:
 *   - 'matched'           — every class paired with a file
 *   - 'count_mismatch'    — different number of files vs classes (manual)
 *   - 'no_pending_classes' — nothing waiting
 *   - 'no_new_files'      — classes waiting, but no files to import yet
 *
 * The caller is responsible for filtering `files` to only those NOT yet
 * imported (e.g. by checking `mic_file_index > lastImportedIndex`) before
 * passing in — this matcher doesn't track import history.
 */
export function matchFilesToClasses(
  classes: ClassRecording[],
  files: MicFile[],
): MatchSession {
  const sortedClasses = [...classes].sort(
    (a, b) => +a.startedAt - +b.startedAt
  );
  const sortedFiles = [...files].sort(
    (a, b) => +a.timestamp - +b.timestamp
  );

  if (sortedClasses.length === 0) {
    return {
      status: 'no_pending_classes',
      matches: [],
      unmatchedClasses: [],
      unmatchedFiles: sortedFiles,
    };
  }

  if (sortedFiles.length === 0) {
    return {
      status: 'no_new_files',
      matches: [],
      unmatchedClasses: sortedClasses,
      unmatchedFiles: [],
    };
  }

  if (sortedFiles.length !== sortedClasses.length) {
    return {
      status: 'count_mismatch',
      matches: [],
      unmatchedClasses: sortedClasses,
      unmatchedFiles: sortedFiles,
    };
  }

  const matches: MatchResult[] = sortedClasses.map((cls, i) => {
    const file = sortedFiles[i];
    const score = scoreMatch(cls, file);
    return {
      class: cls,
      file,
      ...score,
    };
  });

  return {
    status: 'matched',
    matches,
    unmatchedClasses: [],
    unmatchedFiles: [],
  };
}

// ─── Helper for the import flow ──────────────────────────────────────────

/**
 * Lift a list of file system entries (name + duration + size + uri) into
 * the MicFile shape, dropping anything that doesn't look like a DJI file.
 * Returns files sorted by index ascending.
 */
export function parseDjiDirectory(
  entries: Array<{ name: string; durationSec: number; sizeBytes: number; uri: string }>
): MicFile[] {
  const parsed: MicFile[] = [];
  for (const entry of entries) {
    const meta = parseDjiFileName(entry.name);
    if (!meta) continue;
    parsed.push({
      fileName: entry.name,
      index: meta.index,
      timestamp: meta.timestamp,
      durationSec: entry.durationSec,
      sizeBytes: entry.sizeBytes,
      uri: entry.uri,
    });
  }
  return parsed.sort((a, b) => a.index - b.index);
}
