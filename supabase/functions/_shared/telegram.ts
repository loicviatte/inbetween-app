// Minimal Telegram Bot API sender, shared across edge functions.
//
// Uses the same TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID secrets the
// monitor-report function already relies on. Best-effort: if the secrets
// aren't set or Telegram is unreachable, it resolves quietly instead of
// throwing, so a notification failure never breaks the calling flow.

const TG_BOT_TOKEN = () => Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const TG_CHAT_ID = () => Deno.env.get('TELEGRAM_CHAT_ID') ?? ''

export async function sendTelegramMessage(
  text: string,
  opts?: { replyMarkup?: Record<string, unknown>; disablePreview?: boolean },
): Promise<{ ok: boolean; message_id?: number }> {
  const token = TG_BOT_TOKEN()
  const chatId = TG_CHAT_ID()
  if (!token || !chatId) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — skipping')
    return { ok: false }
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: opts?.disablePreview ?? true,
        ...(opts?.replyMarkup ? { reply_markup: opts.replyMarkup } : {}),
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.warn('[telegram] sendMessage failed:', res.status, JSON.stringify(json))
      return { ok: false }
    }
    return { ok: true, message_id: json?.result?.message_id }
  } catch (err) {
    console.warn('[telegram] sendMessage threw:', err instanceof Error ? err.message : err)
    return { ok: false }
  }
}

// Escape user-supplied strings for Telegram HTML parse_mode.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
