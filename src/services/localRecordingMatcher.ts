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

/**
 * A single continuous recording, possibly split by the DJI mic across
 * several files. The mic caps each WAV at ~30:50 (≈266 MB at 48 kHz /
 * 24-bit / mono) and immediately resumes into the next file, reusing the
 * same DJI index (DJI_NN_...) for every part. A MicSession stitches those
 * parts back into one logical recording so it can map to one class and
 * upload as ordered chunks.
 */
export interface MicSession {
  index: number;          // DJI index shared by all parts of the session
  parts: MicFile[];       // ordered by timestamp == chunk order (idx 0..N-1)
  startTimestamp: Date;   // first part's timestamp
  durationSec: number;    // sum of every part's duration
  sizeBytes: number;      // sum of every part's size
  fileName: string;       // first part's filename (representative / display)
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

// ─── Multi-part session grouping ───────────────────────────────────────────

// How far apart (in seconds) two parts may be and still count as one
// continuous recording. The DJI mic resumes into the next file within a
// second or two of hitting the size cap, so the real gap is ~0. We allow a
// generous window only to absorb the error in our size→duration estimate
// (a full part's duration is derived from bytes, so it can be off by a few
// seconds). A shared DJI index is required on top of this, so the window
// can be loose without risking a merge of two genuinely separate classes
// (those get distinct indices).
const SESSION_CONTIGUITY_TOLERANCE_SEC = 300;

function isContinuationOfSession(session: MicSession, file: MicFile): boolean {
  // The DJI mic reuses the same index (DJI_NN_...) for every part of a
  // recording it had to split, so a shared index is the primary signal.
  if (file.index !== session.index) return false;
  // Temporal contiguity guards against the mic reusing an index after a
  // card reformat: a "part" that starts hours/days after the previous one
  // ended is a different recording, not a continuation.
  const last = session.parts[session.parts.length - 1];
  const lastEndMs = +last.timestamp + last.durationSec * 1000;
  const gapSec = (+file.timestamp - lastEndMs) / 1000;
  return (
    gapSec >= -SESSION_CONTIGUITY_TOLERANCE_SEC &&
    gapSec <= SESSION_CONTIGUITY_TOLERANCE_SEC
  );
}

/**
 * Group DJI mic files into continuous recording sessions. Consecutive parts
 * that share a DJI index and start where the previous part ended are merged
 * into one MicSession; everything else starts a fresh session. Parts within
 * a session are ordered by timestamp (== upload chunk order).
 *
 * Example (real data): DJI_02 ×2 contiguous → one 49-min session;
 * DJI_03 ×3 contiguous → one 62-min session; the lone DJI_04 / DJI_05
 * short clips stay as their own single-part sessions.
 */
export function groupMicFilesIntoSessions(files: MicFile[]): MicSession[] {
  const sorted = [...files].sort((a, b) => +a.timestamp - +b.timestamp);
  const sessions: MicSession[] = [];
  for (const file of sorted) {
    const current = sessions[sessions.length - 1];
    if (current && isContinuationOfSession(current, file)) {
      current.parts.push(file);
      current.durationSec += file.durationSec;
      current.sizeBytes += file.sizeBytes;
    } else {
      sessions.push({
        index: file.index,
        parts: [file],
        startTimestamp: file.timestamp,
        durationSec: file.durationSec,
        sizeBytes: file.sizeBytes,
        fileName: file.fileName,
      });
    }
  }
  return sessions;
}

// ─── Session ↔ class matching ──────────────────────────────────────────────

export interface SessionMatchResult {
  class: ClassRecording;
  session: MicSession;
  confidence: MatchConfidence;
  expectedDurationSec: number;
  actualDurationSec: number;
  durationRatio: number;
  reasons: string[];
}

export interface SessionMatchSession {
  status: MatchSessionStatus;
  matches: SessionMatchResult[];
  unmatchedClasses: ClassRecording[];
  unmatchedSessions: MicSession[];
}

function scoreSessionMatch(cls: ClassRecording, session: MicSession): {
  confidence: MatchConfidence;
  expectedDurationSec: number;
  actualDurationSec: number;
  durationRatio: number;
  reasons: string[];
} {
  const expectedDurationSec = cls.endedAt
    ? Math.round((+cls.endedAt - +cls.startedAt) / 1000)
    : 0;
  const actualDurationSec = Math.round(session.durationSec);
  const ratio = expectedDurationSec > 0 ? actualDurationSec / expectedDurationSec : 0;
  const partLabel = session.parts.length === 1 ? '1 part' : `${session.parts.length} parts`;
  const reasons: string[] = [];
  let confidence: MatchConfidence;

  if (expectedDurationSec <= 0) {
    confidence = 'medium';
    reasons.push('Class has no end timestamp; falling back to chronological position only.');
  } else if (ratio >= HIGH_RATIO_MIN && ratio <= HIGH_RATIO_MAX) {
    confidence = 'high';
    reasons.push(
      `Duration matches (${actualDurationSec}s across ${partLabel} vs expected ${expectedDurationSec}s, ratio ${ratio.toFixed(2)}).`
    );
  } else if (ratio >= MEDIUM_RATIO_MIN && ratio <= MEDIUM_RATIO_MAX) {
    confidence = 'medium';
    reasons.push(
      `Duration off (${actualDurationSec}s across ${partLabel} vs expected ${expectedDurationSec}s, ratio ${ratio.toFixed(2)}). Within 50%.`
    );
  } else {
    confidence = 'low';
    reasons.push(
      `Duration far from expected (${actualDurationSec}s across ${partLabel} vs ${expectedDurationSec}s, ratio ${ratio.toFixed(2)}).`
    );
  }

  return { confidence, expectedDurationSec, actualDurationSec, durationRatio: ratio, reasons };
}

/**
 * Match recording sessions to classes — the multi-part-aware analogue of
 * matchFilesToClasses. Sessions are matched 1:1 by chronological position
 * (i-th session ↔ i-th class) and scored by total duration, exactly like
 * the single-file matcher but with split parts already stitched.
 */
export function matchSessionsToClasses(
  classes: ClassRecording[],
  sessions: MicSession[],
): SessionMatchSession {
  const sortedClasses = [...classes].sort((a, b) => +a.startedAt - +b.startedAt);
  const sortedSessions = [...sessions].sort((a, b) => +a.startTimestamp - +b.startTimestamp);

  if (sortedClasses.length === 0) {
    return { status: 'no_pending_classes', matches: [], unmatchedClasses: [], unmatchedSessions: sortedSessions };
  }
  if (sortedSessions.length === 0) {
    return { status: 'no_new_files', matches: [], unmatchedClasses: sortedClasses, unmatchedSessions: [] };
  }
  if (sortedSessions.length !== sortedClasses.length) {
    return { status: 'count_mismatch', matches: [], unmatchedClasses: sortedClasses, unmatchedSessions: sortedSessions };
  }

  const matches: SessionMatchResult[] = sortedClasses.map((cls, i) => {
    const session = sortedSessions[i];
    return { class: cls, session, ...scoreSessionMatch(cls, session) };
  });

  return { status: 'matched', matches, unmatchedClasses: [], unmatchedSessions: [] };
}

/**
 * Greedy 1-class→1-session assignment by CLOSEST DURATION, for the
 * count_mismatch case (different number of sessions vs classes). For each
 * class (oldest first), pick the still-unused session whose duration is
 * nearest the class's expected duration.
 *
 * Absolute wall-clock time is deliberately NOT used: the DJI mic's RTC
 * frequently drifts (by hours, sometimes a full day), so a file's timestamp
 * can land on a neighbouring date. Duration is the only trustworthy signal.
 *
 * Scoring is the continuous distance |ratio − 1|, so the closest match wins
 * outright. (The earlier banded score treated everything within ±15% as a
 * 0 tie, which let the earliest-by-time session win and mis-assigned a class
 * to an adjacent-day recording.) The tiny `+ i * 0.001` only breaks genuine
 * duration ties, favouring the earlier session.
 */
export function assignSessionsByDuration(
  classes: ClassRecording[],
  sessions: MicSession[],
): Array<{ class: ClassRecording; session: MicSession }> {
  const sortedClasses = [...classes].sort((a, b) => +a.startedAt - +b.startedAt);
  const sortedSessions = [...sessions].sort((a, b) => +a.startTimestamp - +b.startTimestamp);
  const used = new Set<number>();
  const out: Array<{ class: ClassRecording; session: MicSession }> = [];
  for (const cls of sortedClasses) {
    const expectedDurSec = cls.endedAt ? (+cls.endedAt - +cls.startedAt) / 1000 : 0;
    let bestIdx = -1;
    let bestScore = Infinity;
    for (let i = 0; i < sortedSessions.length; i++) {
      if (used.has(i)) continue;
      let durScore = 0;
      if (expectedDurSec > 0) {
        const ratio = sortedSessions[i].durationSec / expectedDurSec;
        durScore = Math.abs(ratio - 1) * 100;
      }
      const score = durScore + i * 0.001;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) continue;
    used.add(bestIdx);
    out.push({ class: cls, session: sortedSessions[bestIdx] });
  }
  return out;
}
