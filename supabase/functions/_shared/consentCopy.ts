// ─── The words a parent agrees to ───────────────────────────────────────────
// One source for both ways a child gets onto InBetween: a parent approving an
// invitation, and a parent setting the child up themselves. The app never
// writes this text — it asks for it — so what a parent reads on screen is
// exactly what the proof stores, under the version it was shown in.
export const TERMS_VERSION = 'minor-consent-v1-2026-09-14'

export function consentCopy(child: string, coach: string | null) {
  const coachRef = coach || 'Their coach'
  return {
    context: { title: `${child} wants to use InBetween`, subtitle: coach ? `with their coach ${coach}` : null },
    what: [
      `${coachRef} wears a clip mic during ${child}'s lessons`,
      `The audio becomes focus points for ${child} to train`,
      'The raw recording is deleted within 24 hours',
      `${coachRef} cannot listen back to the recording`,
      'You can delete everything at any time',
    ],
    checks: [
      `I am ${child}'s parent or legal guardian`,
      `I consent to ${child}'s lessons being captured and processed as described above`,
      'I understand I can withdraw this consent and delete all data at any time',
    ],
  }
}
