// ─── The invitation a parent receives ───────────────────────────────────────
// The link opens the approval page on the website, which works on any phone or
// computer — the app is in private beta, so a parent usually can't install it.
// Everything the student typed (their name, the parent's name) is escaped: it
// lands in someone else's inbox.

export const CONSENT_URL = 'https://www.useinbetween.com/consent'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export function inviteEmail(p: {
  parentFirstName: string
  childName: string
  coachName: string | null
  code: string          // ABCD-EFGH-JKMN
  smsSent: boolean
  ttlHours: number
}) {
  const link = `${CONSENT_URL}?token=${encodeURIComponent(p.code)}`
  const withCoach = p.coachName ? ` with their coach ${p.coachName}` : ''
  const subject = `${p.childName} needs your permission on InBetween`

  const text = [
    `Hi ${p.parentFirstName},`, '',
    `${p.childName} wants to use InBetween${withCoach}. Because ${p.childName} is under 18, nothing is recorded until you approve.`, '',
    'Review and approve here:', link, '',
    `Or go to ${CONSENT_URL.replace('https://', '')} and enter this code: ${p.code}`, '',
    ...(p.smsSent ? ["We've also texted you a 6-digit code. You'll need both.", ''] : []),
    `This invitation expires in ${p.ttlHours} hours. If you don't know ${p.childName}, ignore this email and nothing happens.`,
  ].join('\n')

  const F = 'font-family:Helvetica,Arial,sans-serif;'
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#000000;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000000;">
<tr><td align="center" style="padding:44px 20px 52px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
<tr><td style="padding:0 0 40px;"><img src="https://www.useinbetween.com/images/logo-lockup-white.png" width="150" alt="InBetween" style="display:block;width:150px;height:auto;border:0;"></td></tr>
<tr><td style="${F}font-size:15px;line-height:22px;color:#B5B5B5;padding:0 0 10px;">Hi ${esc(p.parentFirstName)},</td></tr>
<tr><td style="${F}font-size:28px;line-height:34px;font-weight:700;letter-spacing:-0.4px;color:#F7F6F3;padding:0 0 14px;">${esc(p.childName)} needs your permission</td></tr>
<tr><td style="${F}font-size:16px;line-height:25px;color:#B5B5B5;padding:0 0 30px;">${esc(p.childName)} wants to use InBetween${esc(withCoach)}. Because ${esc(p.childName)} is under 18, nothing is recorded until you approve.</td></tr>
<tr><td style="padding:0 0 34px;"><a href="${esc(link)}" style="display:inline-block;background:#F0C24A;color:#000000;${F}font-size:16px;line-height:20px;font-weight:700;text-decoration:none;padding:16px 30px;border-radius:999px;">Review and approve</a></td></tr>
<tr><td style="${F}font-size:14px;line-height:22px;color:#8A8A8A;padding:0 0 8px;">Or go to <span style="color:#F7F6F3;">useinbetween.com/consent</span> and enter this code:</td></tr>
<tr><td style="padding:0 0 30px;"><span style="display:inline-block;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:22px;line-height:28px;letter-spacing:3px;color:#F0C24A;border:1px solid #3D3D3D;border-radius:10px;padding:10px 16px;">${esc(p.code)}</span></td></tr>
${p.smsSent ? `<tr><td style="${F}font-size:14px;line-height:22px;color:#B5B5B5;padding:0 0 24px;">We&rsquo;ve also texted you a 6-digit code. You&rsquo;ll need both.</td></tr>` : ''}
<tr><td style="${F}font-size:13px;line-height:20px;color:#8A8A8A;border-top:1px solid #1F1F1F;padding:22px 0 0;">This invitation expires in ${p.ttlHours} hours. If you don&rsquo;t know ${esc(p.childName)}, ignore this email and nothing happens.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

  return { subject, text, html }
}
