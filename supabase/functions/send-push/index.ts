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
  let record: NotificationRecord | null = null
  try {
    const payload: WebhookPayload = await req.json()
    record = payload.record
  } catch (err) {
    console.error('[send-push] Failed to parse webhook payload:', err)
    return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 })
  }

  // Only process INSERT events
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

  // Fetch recipient's push token
  const { data: userRow } = await supabase
    .from('users')
    .select('push_token')
    .eq('id', record.user_id)
    .single()

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
    } else {
      console.log(`[send-push] ✓ Push sent to user ${record.user_id}`)
    }
  } catch (err) {
    console.error(`[send-push] Fetch error:`, err)
  }
}
