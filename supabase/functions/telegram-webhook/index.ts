// Receives Telegram updates and marks anomalies resolved.
// Two resolution paths:
//   a) Text reply "resolved ANOMALY-ID"           (legacy / manual)
//   b) Tap on inline button with callback_data
//      "resolve:ANOMALY-ID"                       (preferred, one tap)
//
// Set the webhook once, after deployment:
//   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
//        -d "url=https://<project-ref>.supabase.co/functions/v1/telegram-webhook"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESOLVE_RE = /\bresolved\s+(ANOMALY-\d{8}-\d{3})\b/i
const CALLBACK_RE = /^resolve:(ANOMALY-\d{8}-\d{3})$/i

interface Anomaly {
  id: string
  status: string
  [k: string]: unknown
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')

  const update = await req.json().catch(() => null)
  if (!update) return new Response(JSON.stringify({ ignored: true }))

  const expectedChat = Deno.env.get('TELEGRAM_CHAT_ID') ?? ''
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // ── Path A: inline button tap ──────────────────────────────────────────
  if (update.callback_query) {
    const cbChatId = String(update.callback_query.message?.chat?.id ?? '')
    if (cbChatId !== expectedChat) {
      await answerCallback(token, update.callback_query.id, 'Unauthorized chat.')
      return new Response(JSON.stringify({ ignored: true }))
    }
    const match = String(update.callback_query.data ?? '').match(CALLBACK_RE)
    if (!match) {
      await answerCallback(token, update.callback_query.id, 'Unknown action.')
      return new Response(JSON.stringify({ ignored: true }))
    }
    const anomalyId = match[1].toUpperCase()
    const n = await markResolved(sb, anomalyId)

    // Acknowledge to Telegram (stops the spinner on the button).
    await answerCallback(
      token,
      update.callback_query.id,
      n > 0 ? `✅ ${anomalyId} resolved.` : `No active anomaly matches ${anomalyId}.`,
    )

    // Update the original message so the button disappears and the status
    // shows inline.
    if (n > 0 && token && update.callback_query.message?.message_id) {
      await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: cbChatId,
          message_id: update.callback_query.message.message_id,
          reply_markup: { inline_keyboard: [] },
        }),
      })
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: cbChatId,
          text: `✅ ${anomalyId} marked as resolved.`,
          reply_to_message_id: update.callback_query.message.message_id,
        }),
      })
    }
    return new Response(JSON.stringify({ ok: true, updated: n }))
  }

  // ── Path B: text reply ─────────────────────────────────────────────────
  const text: string | undefined =
    update?.message?.text ?? update?.edited_message?.text
  const chatId: string | undefined = String(update?.message?.chat?.id ?? '')
  if (!text || !chatId || chatId !== expectedChat) {
    return new Response(JSON.stringify({ ignored: true }))
  }
  const match = text.match(RESOLVE_RE)
  if (!match) return new Response(JSON.stringify({ ignored: true }))
  const anomalyId = match[1].toUpperCase()
  const n = await markResolved(sb, anomalyId)
  await reply(token, chatId, n > 0
    ? `✅ ${anomalyId} marked as resolved.`
    : `No active anomaly matches ${anomalyId}.`)
  return new Response(JSON.stringify({ ok: true, updated: n }))
})

async function markResolved(
  sb: ReturnType<typeof createClient>,
  anomalyId: string,
): Promise<number> {
  const { data: reports } = await sb
    .from('monitoring_reports')
    .select('id, anomalies, unresolved_ids')
    .contains('unresolved_ids', [anomalyId])
    .order('created_at', { ascending: false })
  if (!reports?.length) return 0
  for (const r of reports) {
    const anomalies = (r.anomalies ?? []) as Anomaly[]
    const updated = anomalies.map((a) =>
      a.id === anomalyId ? { ...a, status: 'RESOLVED' } : a,
    )
    const unresolved = (r.unresolved_ids ?? []).filter((i: string) => i !== anomalyId)
    await sb
      .from('monitoring_reports')
      .update({ anomalies: updated, unresolved_ids: unresolved })
      .eq('id', r.id)
  }
  return reports.length
}

async function reply(token: string | undefined, chatId: string, text: string) {
  if (!token) return
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
}

async function answerCallback(
  token: string | undefined,
  callbackQueryId: string,
  text: string,
) {
  if (!token) return
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: false }),
  })
}
