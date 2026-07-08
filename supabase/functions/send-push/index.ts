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

  const record = payload?.record
  if (!record) {
    return new Response(JSON.stringify({ error: 'No record' }), { status: 400 })
  }

  EdgeRuntime.waitUntil(sendPush(record))

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})

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
    .select('push_token')
    .eq('id', record.user_id)
    .maybeSingle()

  if (lookupErr) {
    console.error(`[send-push] user lookup failed for ${record.user_id}:`, lookupErr.message)
    return
  }

  const pushToken = userRow?.push_token
  if (!pushToken) {
    console.log(`[send-push] No push token for user ${record.user_id} — skipping`)
    return
  }

  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: pushToken,
        title: record.title,
        body: record.body,
        // Include the notification type so the app can route to the right
        // screen when the push is tapped (coach action-needed types go to
        // the ActionNeeded view, others fall back to the Notifications list).
        data: { ...(record.data ?? {}), type: record.type },
        sound: 'default',
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error(`[send-push] Expo API ${res.status}: ${text}`)
      return
    }

    // Expo returns HTTP 200 even for a dead token — the per-message status
    // lives in the response BODY. Parse it and, on DeviceNotRegistered
    // (app uninstalled / token rotated), null the stored token so we stop
    // pushing into the void. Expo returns `data` as a single ticket for a
    // single message, or an array — normalise to an array.
    let ticketStatus: string | null = null
    let ticketError: string | null = null
    try {
      const json = await res.json()
      const tickets = Array.isArray(json?.data) ? json.data : json?.data ? [json.data] : []
      const ticket = tickets[0]
      ticketStatus = ticket?.status ?? null
      ticketError = ticket?.details?.error ?? null
    } catch (parseErr) {
      console.error(`[send-push] could not parse Expo response:`, parseErr)
      return
    }

    if (ticketStatus === 'error') {
      console.error(`[send-push] Expo ticket error for user ${record.user_id}: ${ticketError}`)
      if (ticketError === 'DeviceNotRegistered') {
        // Clear the stale token so future notifications don't silently no-op.
        // Guard on the current value so we don't clobber a token the user
        // re-registered between our send and this cleanup.
        const { error: clearErr } = await supabase
          .from('users')
          .update({ push_token: null })
          .eq('id', record.user_id)
          .eq('push_token', pushToken)
        if (clearErr) {
          console.error(`[send-push] failed to clear stale token for ${record.user_id}:`, clearErr.message)
        } else {
          console.log(`[send-push] cleared stale push_token for user ${record.user_id}`)
        }
      }
      return
    }

    console.log(`[send-push] ✓ Push sent to user ${record.user_id}`)
  } catch (err) {
    console.error(`[send-push] Fetch error:`, err)
  }
}
