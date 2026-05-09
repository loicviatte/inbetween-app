// Shared helpers for the class-recording pipeline:
//   - DANCE_PROMPT: the AssemblyAI keyterms biasing prompt
//   - identifyCoachSpeaker: heuristic mapping {speakerId: 'Coach' | 'Élève'}
//   - composeTranscript: stitches per-chunk utterances into a single
//     timeline with cumulative offsets and per-chunk speaker re-labeling.
//
// Mirrors the equivalent client-side logic in StartClassScreen.js (the
// hotfix path) — when the new pipeline is the source of truth, the client
// version becomes dead code. See migration plan for cleanup timing.

export const DANCE_PROMPT =
  "This is a transcript of a partner-dance lesson (DanceSport, ballroom and Latin styles). Expect dance terminology like: quickstep, paso doble, rumba, samba, cha-cha, jive, waltz, tango, foxtrot, viennese waltz; frame, hold, posture, lead, follow, balance, connection; hip action, contra body movement (CBM), heel turn, heel pull, heel pivot; spin turn, natural turn, reverse turn, chasse, lock step, feather step, three step, change step. Coaches and students mix French and English. Preserve dance vocabulary verbatim."

export interface Utterance {
  start: number      // ms from chunk start
  end: number        // ms from chunk start
  speaker: string    // "A" | "B" | ...
  text: string
}

export interface ChunkResult {
  utterances: Utterance[]
  text: string
  durationMs: number
}

/**
 * Per-chunk heuristic: the speaker who spoke the most is "Coach", everyone
 * else is "Élève". Reliable for private (1-on-1) classes where the coach
 * dominates speaking time at ~80%, and acceptable for groups (~60%) where
 * students individually speak ~10-15% each — coach is still dominant.
 *
 * Returns a {speakerId: label} map. Pass this into composeChunkText.
 */
export function identifyCoachSpeaker(utterances: Utterance[]): Record<string, string> {
  if (!Array.isArray(utterances) || utterances.length === 0) return {}
  const totals: Record<string, number> = {}
  for (const u of utterances) {
    const dur = Math.max(0, (u.end || 0) - (u.start || 0))
    totals[u.speaker] = (totals[u.speaker] || 0) + dur
  }
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1])
  if (sorted.length === 0) return {}
  const coachId = sorted[0][0]
  const labels: Record<string, string> = {}
  for (const id of Object.keys(totals)) {
    labels[id] = id === coachId ? 'Coach' : 'Élève'
  }
  return labels
}

function fmtTs(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

/**
 * Format a single chunk's utterances with a global timestamp offset.
 * Each AssemblyAI chunk natively starts at 00:00; the offset shifts it
 * to its real position within the full class timeline.
 */
export function composeChunkText(
  utterances: Utterance[],
  offsetMs: number,
  speakerLabels: Record<string, string> | null,
): string {
  if (!Array.isArray(utterances) || utterances.length === 0) return ''
  return utterances
    .map((u) => {
      const startSec = (u.start + offsetMs) / 1000
      const endSec = (u.end + offsetMs) / 1000
      const label = (speakerLabels && speakerLabels[u.speaker]) || `Speaker ${u.speaker}`
      return `[${fmtTs(startSec)} - ${fmtTs(endSec)}] ${label}: ${String(u.text || '').trim()}`
    })
    .join('\n\n')
}

/**
 * Compose the final transcript across an ordered list of chunks. Falls back
 * to the chunk's plain `text` field if utterances are missing. Failed chunks
 * still advance the offset by `fallbackChunkMs` so subsequent chunks don't
 * collapse onto the same timeline slot.
 */
export function composeTranscript(
  chunks: Array<{
    utterances?: Utterance[] | null
    text?: string | null
    durationMs?: number | null
    speakerLabels?: Record<string, string> | null
    failed?: boolean
  }>,
  fallbackChunkMs = 3 * 60 * 1000,
): string {
  const parts: string[] = []
  let offsetMs = 0
  for (const chunk of chunks) {
    if (chunk.failed) {
      offsetMs += chunk.durationMs && chunk.durationMs > 0 ? chunk.durationMs : fallbackChunkMs
      continue
    }
    const utterances = chunk.utterances || []
    const labels = chunk.speakerLabels || identifyCoachSpeaker(utterances)
    const formatted = composeChunkText(utterances, offsetMs, labels)
    const text = formatted || chunk.text || ''
    if (text.trim()) parts.push(text.trim())
    offsetMs += chunk.durationMs && chunk.durationMs > 0 ? chunk.durationMs : fallbackChunkMs
  }
  return parts.join('\n\n').trim()
}
