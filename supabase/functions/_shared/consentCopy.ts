// ─── The words a parent agrees to ───────────────────────────────────────────
// One source for both ways a child gets onto InBetween: a parent approving an
// invitation, and a parent setting the child up themselves. The app never
// writes this text — it asks for it — so what a parent reads on screen is
// exactly what the proof stores, under the version it was shown in.
//
// Every sentence here has to be true of the system as it is, not as intended.
// v2 removed three that were not:
//   · "The raw recording is deleted within 24 hours" — nothing purges audio;
//     it stays until the child's data is deleted.
//   · "<coach> cannot listen back to the recording" — the app has no player, but
//     the coach's account can read the files it uploads (uploads are upserts,
//     which need read access), so the claim can't be made honestly.
//   · "delete everything / all data" — a withdrawal deletes the child's data but
//     deliberately keeps the record that permission was given and withdrawn.
// Bump TERMS_VERSION with every change: an app showing older wording is refused.
export const TERMS_VERSION = 'minor-consent-v2-2026-09-14'

export function consentCopy(child: string, coach: string | null) {
  const coachRef = coach || 'Their coach'
  return {
    context: { title: `${child} wants to use InBetween`, subtitle: coach ? `with their coach ${coach}` : null },
    what: [
      `${coachRef} wears a clip mic during ${child}'s lessons`,
      `The audio is transcribed and turned into focus points for ${child} to train`,
      `The recording is kept until you delete ${child}'s data`,
      `You can delete ${child}'s data at any time. We only keep a record that you gave, or withdrew, permission`,
    ],
    checks: [
      `I am ${child}'s parent or legal guardian`,
      `I consent to ${child}'s lessons being captured and processed as described above`,
      `I understand I can withdraw this consent and delete ${child}'s data at any time`,
    ],
  }
}
