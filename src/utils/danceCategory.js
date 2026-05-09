// Shared partition between Latin and Ballroom/Standard. Single source of truth
// — algorithm.js, studentMetrics.js, FocusScreen, AllFocusPointsScreen, and
// storage.js all import from here so the mapping never drifts.

export const LATIN_DANCES = ['Cha Cha', 'Samba', 'Rumba', 'Paso Doble', 'Jive'];

export function categoryFromStyle(danceStyle) {
  const ds = (danceStyle || '').toLowerCase();
  if (ds === 'latin') return 'latin';
  if (ds === 'ballroom' || ds === 'standard') return 'ballroom';
  return null;
}

export function categoryFromDances(dances) {
  if (!Array.isArray(dances) || dances.length === 0) return null;
  return LATIN_DANCES.some((d) => dances.includes(d)) ? 'latin' : 'ballroom';
}

// Whether a focus point belongs in a given category's ranking. Untagged
// focuses (no `dance` array) appear in BOTH categories — generic technique
// like posture or frame is relevant regardless of the style trained that day.
export function focusMatchesCategory(focus, category) {
  if (!category) return true;
  const fpCat = categoryFromDances(focus?.dance);
  return fpCat === null || fpCat === category;
}
