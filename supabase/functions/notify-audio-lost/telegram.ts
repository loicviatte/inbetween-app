// Minimal Telegram sender — plain Bot API, no SDK. A local copy of the
// monitor-report sendMessage helper (we don't import that module to avoid
// pulling its unrelated sendDocument/Blob typing into this function's bundle).
// Uses the SAME TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID secrets.

const TG_BOT_TOKEN = () => Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const TG_CHAT_ID = () => Deno.env.get('TELEGRAM_CHAT_ID') ?? ''

export async function sendMessage(
  text: string,
  replyMarkup?: Record<string, unknown>,
): Promise<{ message_id?: number }> {
  if (!TG_BOT_TOKEN() || !TG_CHAT_ID()) return {}
  const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN()}/sendMessage`, {
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
