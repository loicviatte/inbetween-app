import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Deno / Supabase Edge Runtime globals ────────────────────────────────────

declare global {
  const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface NotificationRecord {
  id: string
  user_id: string
  type: string
  title: string
  body: string
  data: Record<string, unknown>
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: NotificationRecord
}

// A few database triggers call this function directly (net.http_post) rather
// than inserting a notification row: a coach's comment on a focus point, a
// focus point mastered. They send the push itself at the top level.
interface DirectPayload {
  user_id: string
  title: string
  body: string
  data?: Record<string, unknown> & { type?: string }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  let payload: WebhookPayload | null = null
  try {
    payload = await req.json()
  } catch (err) {
    console.error('[send-push] Failed to parse webhook payload:', err)
    return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 })
  }

  // Only process INSERT events. The on-notification-insert webhook is
  // configured INSERT-only, but a read-marking UPDATE (markAllNotificationsRead
  // flips read=true on the recipient's own rows) or a DELETE must never
  // re-push. Guard explicitly so a widened webhook config can't spam users.
  // (payload.type is absent on non-webhook callers → falls through, unchanged.)
  if (payload?.type && payload.type !== 'INSERT') {
    return new Response(JSON.stringify({ received: true, skipped: payload.type }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const record = toRecord(payload as WebhookPayload & Partial<DirectPayload>)
  if (!record) {
    return new Response(JSON.stringify({ error: 'No record' }), { status: 400 })
  }
  // The direct "request accepted" trigger duplicates the coach_request_accepted
  // notification row, which already pushes through the webhook.
  if (DUPLICATE_DIRECT_TYPES.has(record.type)) {
    return new Response(JSON.stringify({ received: true, skipped: record.type }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  EdgeRuntime.waitUntil(sendPush(record))

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})

// The webhook's row, or a direct call's top-level push. These direct calls used
// to be refused ("No record"), so comment and mastered pushes never went out.
function toRecord(payload: (WebhookPayload & Partial<DirectPayload>) | null): NotificationRecord | null {
  if (payload?.record) return payload.record
  if (payload?.user_id && payload?.title) {
    return {
      id: '',
      user_id: payload.user_id,
      type: String(payload.data?.type ?? 'direct'),
      title: payload.title,
      body: payload.body ?? '',
      data: payload.data ?? {},
    }
  }
  return null
}

const DUPLICATE_DIRECT_TYPES = new Set(['request_accepted'])

// ─── Recipient's notification settings ───────────────────────────────────────
// Set on the app's Notification settings screen, on the dancer's own row (for
// a managed child, the parent sets the child's). The notification row itself
// is always kept — settings only decide whether the phone is pushed.

// One switch per type a dancer can turn off (users.notification_prefs keys).
const SWITCH_BY_TYPE: Record<string, string> = {
  focus_point_added: 'new_focus_point',
  coach_comment: 'coach_comments',
  group_class_attendance: 'attendance',
  attendance_check: 'attendance',
  focus_mastered: 'milestones',
  merge_request_student: 'focus_reviews',
}

// A coach or a partner can always reach you with a request: only Push off
// silences these.
const REQUEST_TYPES = new Set([
  'coach_request_received',
  'coach_request_accepted',
  'coach_request_declined',
  'couple_request_received',
  'couple_request_accepted',
  'couple_paired',
  'couple_coach_request',
  'couple_coach_accepted',
])

const QUIET_WINDOWS: Record<string, [number, number]> = {
  '21-7': [21, 7],
  '22-8': [22, 8],
  '23-7': [23, 7],
}

interface RecipientPrefs {
  notify_lesson_ready?: boolean | null
  notification_prefs?: Record<string, unknown> | null
}

function localHour(timeZone: string): number {
  try {
    const hour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).format(new Date())
    return Number(hour) % 24
  } catch {
    return new Date().getUTCHours()
  }
}

// Why this push shouldn't go out, or null to send it.
function silencedBy(record: NotificationRecord, user: RecipientPrefs | null): string | null {
  const prefs = (user?.notification_prefs ?? {}) as Record<string, unknown>
  if (prefs.push === 'off') return 'push off'
  if (REQUEST_TYPES.has(record.type)) return null

  if (record.type === 'transcript_ready' && user?.notify_lesson_ready === false) return 'lesson summary off'
  const key = SWITCH_BY_TYPE[record.type]
  // focus_point_added is also the coach's "to validate" type (data.student_id);
  // only the dancer's version has a switch.
  const coachSide = record.type === 'focus_point_added' && !!record.data?.student_id
  if (key && !coachSide && prefs[key] === false) return `${key} off`

  const pausedUntil = typeof prefs.paused_until === 'string' ? Date.parse(prefs.paused_until) : NaN
  if (!Number.isNaN(pausedUntil) && pausedUntil > Date.now()) return 'paused'

  const window = QUIET_WINDOWS[String(prefs.quiet)]
  if (window) {
    const hour = localHour(typeof prefs.tz === 'string' ? prefs.tz : 'Europe/London')
    const [start, end] = window
    if (hour >= start || hour < end) return 'quiet hours'
  }
  return null
}

// ─── Push logic ───────────────────────────────────────────────────────────────

async function sendPush(record: NotificationRecord): Promise<void> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Fetch recipient's push token. maybeSingle() so a missing row yields
  // { data: null } instead of an error; log a real lookup error rather than
  // silently treating it as "no token".
  const { data: userRow, error: lookupErr } = await supabase
    .from('users')
    .select('push_token, notify_lesson_ready, notification_prefs')
    .eq('id', record.user_id)
    .maybeSingle()

  if (lookupErr) {
    console.error(`[send-push] user lookup failed for ${record.user_id}:`, lookupErr.message)
    return
  }

  const silenced = silencedBy(record, userRow)
  if (silenced) {
    console.log(`[send-push] ${record.type} for ${record.user_id} not pushed — ${silenced}`)
    return
  }

  // Every phone signed in to the account gets it.
  let targets = await devicesOf(supabase, record.user_id, userRow?.push_token ?? null)

  // A managed child has no device of their own: the account that follows them
  // does. Without this, every notification addressed to a child dancer reads no
  // token and silently goes nowhere.
  if (targets.length === 0) {
    const { data: guards } = await supabase
      .from('guardians')
      .select('guardian_id, users!guardians_guardian_id_fkey(push_token)')
      .eq('child_id', record.user_id)
    for (const g of (guards || []) as { guardian_id: string; users?: { push_token?: string | null } }[]) {
      targets = targets.concat(await devicesOf(supabase, g.guardian_id, g.users?.push_token ?? null))
    }
    if (targets.length > 0) {
      console.log(`[send-push] user ${record.user_id} has no device — routing to their guardian`)
    }
  }

  if (targets.length === 0) {
    console.log(`[send-push] No push token for user ${record.user_id} — skipping`)
    return
  }

  // One message per phone, in one request; Expo answers with one ticket per
  // message, in the same order.
  const message = {
    title: record.title,
    body: record.body,
    // Include the notification type so the app can route to the right
    // screen when the push is tapped (coach action-needed types go to
    // the ActionNeeded view, others fall back to the Notifications list).
    data: { ...(record.data ?? {}), type: record.type },
    sound: 'default',
  }

  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(targets.map((t) => ({ ...message, to: t.token }))),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error(`[send-push] Expo API ${res.status}: ${text}`)
      return
    }

    // Expo returns HTTP 200 even for a dead token — the per-message status
    // lives in the response BODY.
    let tickets: { status?: string; details?: { error?: string } }[] = []
    try {
      const json = await res.json()
      tickets = Array.isArray(json?.data) ? json.data : json?.data ? [json.data] : []
    } catch (parseErr) {
      console.error(`[send-push] could not parse Expo response:`, parseErr)
      return
    }

    let sent = 0
    for (let i = 0; i < targets.length; i += 1) {
      const ticket = tickets[i]
      if (ticket?.status !== 'error') { sent += 1; continue }
      const why = ticket?.details?.error ?? null
      console.error(`[send-push] Expo ticket error for user ${record.user_id}: ${why}`)
      // App uninstalled / token rotated: forget that phone so we stop pushing
      // into the void. Where it lives: for a child, on the guardian's side.
      if (why === 'DeviceNotRegistered') await forgetDevice(supabase, targets[i])
    }

    console.log(`[send-push] ✓ Push sent to user ${record.user_id} on ${sent} of ${targets.length} device(s)`)
  } catch (err) {
    console.error(`[send-push] Fetch error:`, err)
  }
}

interface Device { token: string; owner: string }

// The account's phones (push_tokens), plus the single token an app older than
// per-device tokens still writes on users.push_token — unless that phone has
// since been signed in to another account, which now owns it.
async function devicesOf(supabase: any, userId: string, legacy: string | null): Promise<Device[]> {
  const [mine, legacyRow] = await Promise.all([
    supabase.from('push_tokens').select('token').eq('user_id', userId),
    legacy
      ? supabase.from('push_tokens').select('user_id').eq('token', legacy).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  if (mine.error) console.error(`[send-push] push_tokens lookup failed for ${userId}:`, mine.error.message)
  const tokens = new Set<string>(((mine.data ?? []) as { token: string }[]).map((r) => r.token))
  if (legacy && (!legacyRow.data || legacyRow.data.user_id === userId)) tokens.add(legacy)
  return [...tokens].map((token) => ({ token, owner: userId }))
}

async function forgetDevice(supabase: any, d: Device): Promise<void> {
  const { error: rowErr } = await supabase.from('push_tokens').delete().eq('token', d.token)
  // Guard on the current value so we don't clobber a token re-registered in between.
  const { error: legacyErr } = await supabase
    .from('users')
    .update({ push_token: null })
    .eq('id', d.owner)
    .eq('push_token', d.token)
  if (rowErr || legacyErr) {
    console.error(`[send-push] failed to forget a dead device of ${d.owner}:`, (rowErr || legacyErr)!.message)
  } else {
    console.log(`[send-push] forgot a dead device of user ${d.owner}`)
  }
}
