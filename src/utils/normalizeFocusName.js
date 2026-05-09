// Must stay in lockstep with supabase/functions/_shared/normalize.ts.
// Any change here MUST be mirrored there, otherwise the client and the edge
// functions will produce divergent normalized_name values and duplicate focus
// points will reappear.
export function normalizeFocusName(input) {
  return (input ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
