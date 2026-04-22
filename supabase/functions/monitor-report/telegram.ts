// Telegram helpers. Uses plain Bot API — no SDK required.

const TG_BOT_TOKEN = () => Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const TG_CHAT_ID = () => Deno.env.get('TELEGRAM_CHAT_ID') ?? ''

function apiUrl(method: string) {
  return `https://api.telegram.org/bot${TG_BOT_TOKEN()}/${method}`
}

export async function sendMessage(
  text: string,
  replyMarkup?: Record<string, unknown>,
): Promise<{ message_id?: number }> {
  if (!TG_BOT_TOKEN() || !TG_CHAT_ID()) return {}
  const res = await fetch(apiUrl('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TG_CHAT_ID(),
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  })
  const json = await res.json().catch(() => ({}))
  return { message_id: json?.result?.message_id }
}

export function resolveButton(anomalyId: string) {
  return {
    inline_keyboard: [[
      { text: `✅ Mark ${anomalyId} as resolved`, callback_data: `resolve:${anomalyId}` },
    ]],
  }
}

export async function sendDocument(
  filename: string,
  bytes: Uint8Array,
  caption?: string,
): Promise<void> {
  if (!TG_BOT_TOKEN() || !TG_CHAT_ID()) return
  const form = new FormData()
  form.append('chat_id', TG_CHAT_ID())
  if (caption) form.append('caption', caption)
  // Browser Blob works inside Deno Edge runtime.
  form.append('document', new Blob([bytes]), filename)
  await fetch(apiUrl('sendDocument'), { method: 'POST', body: form })
}

export function formatCriticalAlert(
  anomalyId: string,
  description: string,
  supabaseUrl: string,
): string {
  return [
    `🚨 <b>InBetween Alert — ${anomalyId}</b>`,
    description,
    supabaseUrl,
    `Reply "resolved ${anomalyId}" to mark as resolved.`,
  ].join('\n')
}
