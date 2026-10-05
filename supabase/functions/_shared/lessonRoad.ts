// The lesson Live Activity's state, computed on the server.
//
// Must stay in lockstep with src/services/micPendingActivity.js — same stages,
// same weights (Lesson 60 · Mic audio 20 · Focus points 20), same words. The app
// draws the activity while it runs; this draws it when a followed lesson moves
// on the server and the app is closed. The server never sees an import in
// progress, so it has no "uploading".

// deno-lint-ignore-file no-explicit-any

export type LessonRoadState = {
  stage: 'waiting' | 'extracting' | 'ready'
  progress: number
  title: string
  detail: string
  badge: string | null
  cta: string | null
  link: string
}

const MIC_SYNC_LINK = 'inbetween://mic-sync'
const REVIEW_LINK = 'inbetween://action-needed'
const FOLLOW_MS = 24 * 3600 * 1000

function serverStep(rec: any): { share: number; text: string } {
  const ci = rec.class_inputs
  if (!ci) {
    return rec.status === 'transcribing'
      ? { share: 0.3, text: 'Listening to the lesson' }
      : { share: 0.1, text: 'Getting the audio ready' }
  }
  if (ci.status === 'extracted') return { share: 0.75, text: 'Writing the focus points' }
  if (ci.status === 'scored') return { share: 0.9, text: 'Almost ready' }
  return { share: 0.55, text: 'Reading the lesson' }
}

export function lessonPhrase(rec: any): string {
  const name = rec.student?.name
  if (name) return `${name}’s lesson`
  if (rec.lesson_type === 'group') return 'Your group lesson'
  if (rec.lesson_type === 'couple') return 'Your couple lesson'
  return 'Your private lesson'
}

/**
 * "No audio yet" for these lessons (class_recordings rows with ended_at, and
 * student:student_id(name) for the phrase). Also what the server starts on a
 * phone with push-to-start (live-activity-restart).
 */
export function waitingState(waiting: any[]): LessonRoadState {
  const oldest = waiting.reduce((a: any, b: any) => (new Date(b.ended_at) < new Date(a.ended_at) ? b : a))
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
  }
}

/** The state for an activity following `ids`, or null when nothing is left. */
export async function lessonRoadState(supabase: any, ids: string[]): Promise<LessonRoadState | null> {
  if (!ids.length) return null
  const { data, error } = await supabase
    .from('class_recordings')
    .select(
      'id, status, lesson_type, started_at, ended_at, mic_file_name, sync_abandoned_at, class_input_id, ' +
        'student:student_id(name), class_inputs:class_input_id(status, coach_released_at)',
    )
    .in('id', ids)
  if (error) throw error
  const now = Date.now()
  const recs = (data ?? []).filter((r: any) =>
    !(r.ended_at && now - new Date(r.ended_at).getTime() > FOLLOW_MS) &&
    r.status !== 'failed' && r.status !== 'discarded' && !r.sync_abandoned_at
  )

  // Still waiting for the mic's audio.
  const waiting = recs.filter((r: any) => !r.mic_file_name && r.ended_at)
  if (waiting.length) return waitingState(waiting)

  const arrived = recs.filter((r: any) => r.mic_file_name)
  const released = arrived.filter((r: any) => r.class_inputs?.coach_released_at).map((r: any) => r.class_input_id)
  const names = new Map<string, Set<string>>()
  if (released.length) {
    for (const table of ['focus_points', 'couple_focus_points']) {
      const { data: fps, error: fpErr } = await supabase
        .from(table)
        .select('name, source_class_input_id')
        .in('source_class_input_id', released)
        .eq('status', 'pending_coach')
        .eq('is_other', false)
        .eq('is_deleted', false)
        .not('coach_review_deadline', 'is', null)
      if (fpErr) throw fpErr
      for (const fp of fps ?? []) {
        const set = names.get(fp.source_class_input_id) ?? new Set<string>()
        set.add(fp.name) // a group focus point is one row per dancer
        names.set(fp.source_class_input_id, set)
      }
    }
  }

  // Something to validate beats something still in the works.
  const ready = [...new Set(
    arrived
      .filter((r: any) => r.class_inputs?.coach_released_at)
      .flatMap((r: any) => [...(names.get(r.class_input_id) ?? [])]),
  )]
  if (ready.length) {
    const n = ready.length
    return {
      stage: 'ready',
      progress: 1,
      title: `${n} focus point${n === 1 ? '' : 's'} ready`,
      detail: n > 2 ? `${ready.slice(0, 2).join(', ')} +${n - 2}` : ready.join(', '),
      badge: `${n} ready`,
      cta: 'Validate focus points',
      link: REVIEW_LINK,
    }
  }

  const moving = arrived.filter((r: any) => !r.class_inputs?.coach_released_at).map(serverStep)
  if (moving.length) {
    // The furthest behind sets the pace.
    const slowest = moving.reduce((a: any, b: any) => (b.share < a.share ? b : a))
    return {
      stage: 'extracting',
      progress: 0.8 + 0.2 * slowest.share,
      title: 'Finding focus points',
      detail: slowest.text,
      badge: null,
      cta: null,
      link: REVIEW_LINK,
    }
  }

  return null
}
