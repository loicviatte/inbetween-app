// Single source of truth for focus point name normalization.
//
// Used by every site that reads or writes `focus_points.normalized_name`:
//   - supabase/functions/student-class-score/index.ts   (insert)
//   - supabase/functions/yoda-score/index.ts            (inserts)
//   - client: src/storage/coachStorage.js               (manual edits)
//
// Rules:
//   - lowercase
//   - any run of non-alphanumeric chars (spaces, dashes, punctuation,
//     invisible chars, accents, etc.) collapses to a single space
//   - leading/trailing whitespace trimmed
//
// So "Hip Settlement", "hip settlement", "HipSettlement", "hip-settlement",
// and "Hip  Settlement!" all normalize to the same key — "hip settlement" /
// "hipsettlement" depending on whether they had an internal separator, which
// is why we *collapse separators to space* rather than stripping them — that
// way the presence of a separator matters (a conscious choice from the
// original student-class-score logic) but the *kind* of separator does not.
//
// If you want "hipsettlement" and "hip settlement" to be equal, swap the
// replace call to strip non-alphanumeric entirely — but do it here and only
// here, so every caller stays in sync.
export function normalizeFocusName(input: string | null | undefined): string {
  return (input ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
