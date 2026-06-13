// Standalone check for the DJI multi-part grouping + session matching.
// No test framework needed — run with sucrase-node:
//
//   ./node_modules/.bin/sucrase-node scripts/test-dji-matcher.ts
//
// Uses the real 9-file listing observed on the mic (DJI_Audio_001) to prove
// that split parts (DJI splits at ~30:50 / 266 MB, reusing the same index)
// get stitched into one session and matched to the right pending class.

import {
  parseDjiFileName,
  groupMicFilesIntoSessions,
  matchSessionsToClasses,
  assignSessionsByDuration,
  type MicFile,
  type ClassRecording,
} from '../src/services/localRecordingMatcher';

const BYTES_PER_SEC = 144000;
const dur = (b: number) => Math.max(0, Math.round((b - 44) / BYTES_PER_SEC));
const mb = (n: number) => Math.round(n * 1_000_000);
const kb = (n: number) => Math.round(n * 1000);

// The 9 files from the screenshot. iOS appends " 2" to the duplicate DJI_01 —
// that variant won't parse, which is the correct behaviour.
const RAW: Array<[string, number]> = [
  ['DJI_05_20260603_035827.WAV', kb(531)],
  ['DJI_04_20260603_035531.WAV', kb(845)],
  ['DJI_03_20260603_035318.WAV', mb(4.1)],
  ['DJI_03_20260603_032229.WAV', mb(266.3)],
  ['DJI_03_20260603_025139.WAV', mb(266.3)],
  ['DJI_02_20260603_022338.WAV', mb(157.1)],
  ['DJI_02_20260603_015249.WAV', mb(266.3)],
  ['DJI_01_20260530_223203 2.WAV', mb(2)],
  ['DJI_01_20260530_223203.WAV', mb(2)],
];

const files: MicFile[] = [];
for (const [name, size] of RAW) {
  const meta = parseDjiFileName(name);
  if (!meta) { console.log(`  (unparseable, dropped) ${name}`); continue; }
  files.push({ fileName: name, index: meta.index, timestamp: meta.timestamp, durationSec: dur(size), sizeBytes: size, uri: '' });
}

const sessions = groupMicFilesIntoSessions(files);
console.log(`\n=== ${sessions.length} sessions ===`);
for (const s of sessions) {
  const m = Math.floor(s.durationSec / 60), sec = s.durationSec % 60;
  console.log(`  idx ${s.index} | ${s.parts.length} part(s) | ${m}m${String(sec).padStart(2, '0')}s | ${s.parts.map((p) => p.fileName.replace('.WAV', '')).join(' + ')}`);
}

const realSessions = sessions.filter((s) => s.durationSec >= 60);
console.log(`\nSessions >=60s: ${realSessions.length} (drops the short false-starts)`);

const classes: ClassRecording[] = [
  { id: 'PRIVATE', startedAt: new Date('2026-06-02T17:54:17Z'), endedAt: new Date('2026-06-02T18:48:00Z'), studentName: 'Esther' },
  { id: 'GROUP',   startedAt: new Date('2026-06-02T18:53:11Z'), endedAt: new Date('2026-06-02T19:55:36Z'), studentName: null },
];

const result = matchSessionsToClasses(classes, realSessions);
console.log(`\n=== match status: ${result.status} ===`);
for (const m of result.matches) {
  console.log(`  ${m.class.id} <- idx ${m.session.index} (${m.session.parts.length} parts, ${m.actualDurationSec}s) | ${m.confidence} | ratio ${m.durationRatio.toFixed(2)}`);
}

const ok =
  realSessions.length === 2 &&
  realSessions.find((s) => s.index === 2)?.parts.length === 2 &&
  realSessions.find((s) => s.index === 3)?.parts.length === 3 &&
  result.status === 'matched' &&
  result.matches.every((m) => m.confidence === 'high') &&
  result.matches.find((m) => m.class.id === 'PRIVATE')?.session.index === 2 &&
  result.matches.find((m) => m.class.id === 'GROUP')?.session.index === 3;

console.log(`\n${ok ? '✅ PASS' : '❌ FAIL'} — multi-part grouping + session match`);

// ── Scenario 2: count_mismatch + DJI clock drift (Tanya's "Why no pairs?") ──
// Mic holds 3 real sessions across 06-03 and 06-05 (the mic RTC is ~+8h off,
// so the 04-June class was stamped 05-June). Only ONE class is pending. The
// banded scorer used to tie idx3 (3729s, ratio 0.85) with idx6 (4270s, ratio
// 0.97) and pick the *earlier* one (idx3, wrong day). assignSessionsByDuration
// must pick idx6 — the closest duration — instead.
const RAW2: Array<[string, number]> = [
  ['DJI_01_20260530_223203.WAV', mb(2)],       // 14s false start
  ['DJI_02_20260603_015249.WAV', mb(266.4)],   // idx2 part 1 (1850s)
  ['DJI_02_20260603_022338.WAV', mb(157.1)],   // idx2 part 2 (1091s)  -> 2941s
  ['DJI_03_20260603_025139.WAV', mb(266.4)],   // idx3 part 1 (1850s)
  ['DJI_03_20260603_032229.WAV', mb(266.4)],   // idx3 part 2 (1850s)
  ['DJI_03_20260603_035318.WAV', mb(4.1)],     // idx3 part 3 (29s)    -> 3729s
  ['DJI_04_20260603_035531.WAV', kb(845)],     // 6s false start
  ['DJI_05_20260603_035827.WAV', kb(531)],     // 4s false start
  ['DJI_06_20260605_022249.WAV', mb(266.4)],   // idx6 part 1 (1850s)
  ['DJI_06_20260605_025339.WAV', mb(266.4)],   // idx6 part 2 (1850s)
  ['DJI_06_20260605_032428.WAV', mb(82.08)],   // idx6 part 3 (570s)   -> 4270s
];

const files2: MicFile[] = [];
for (const [name, size] of RAW2) {
  const meta = parseDjiFileName(name);
  if (!meta) continue;
  files2.push({ fileName: name, index: meta.index, timestamp: meta.timestamp, durationSec: dur(size), sizeBytes: size, uri: '' });
}
const sessions2 = groupMicFilesIntoSessions(files2).filter((s) => s.durationSec >= 60);

// One pending class on 06-04, ~73 min. Its real audio is idx6 (stamped 06-05).
const classes2: ClassRecording[] = [
  { id: 'ESTHER', startedAt: new Date('2026-06-04T18:24:15Z'), endedAt: new Date('2026-06-04T19:37:14Z'), studentName: 'Esther' },
];

const status2 = matchSessionsToClasses(classes2, sessions2).status;
const assigned = assignSessionsByDuration(classes2, sessions2);
const pickedIdx = assigned.find((a) => a.class.id === 'ESTHER')?.session.index;
console.log(`\n=== scenario 2: ${sessions2.length} sessions vs 1 class — status ${status2} ===`);
for (const s of sessions2) console.log(`  idx ${s.index} | ${s.durationSec}s`);
console.log(`  ESTHER <- idx ${pickedIdx} (expected idx 6, the closest duration)`);

const ok2 = status2 === 'count_mismatch' && sessions2.length === 3 && pickedIdx === 6;
console.log(`${ok2 ? '✅ PASS' : '❌ FAIL'} — closest-duration assignment beats clock drift`);

process.exit(ok && ok2 ? 0 : 1);
