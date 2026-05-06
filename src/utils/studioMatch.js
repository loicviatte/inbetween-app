// Lightweight fuzzy matching for the studio picker.
//
// Matches case-insensitively, ignores accents and punctuation, and tolerates
// small typos via Levenshtein distance. Studios are scored on a 0..1 scale and
// returned in descending order, so the closest match always sits at the top
// of the dropdown.

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[b.length];
}

function score(query, name) {
  const q = normalize(query);
  const n = normalize(name);
  if (!q) return 1;
  if (!n) return 0;
  if (n === q) return 1;
  if (n.startsWith(q)) return 0.95;
  if (n.includes(q)) return 0.85;

  // Word-level fuzzy fallback so "sangry" matches "SangriStudio Dancing" and
  // "marious" matches "Oti & Marius". For long studio words we score against
  // a prefix of the same length as the query — otherwise short queries get
  // dragged down by the unrelated tail of the word.
  let best = 0;
  for (const word of n.split(' ')) {
    if (!word) continue;
    if (word.startsWith(q)) { best = Math.max(best, 0.8); continue; }
    if (q.startsWith(word)) { best = Math.max(best, 0.7); continue; }

    if (word.length > q.length) {
      const prefixDist = levenshtein(q, word.slice(0, q.length));
      const prefixSim = 1 - prefixDist / q.length;
      if (prefixSim > best) best = prefixSim;
    }

    const dist = levenshtein(q, word);
    const maxLen = Math.max(q.length, word.length);
    const sim = 1 - dist / maxLen;
    if (sim > best) best = sim;
  }
  return best;
}

export function filterStudios(studios, query) {
  const q = (query || '').trim();
  // Empty query → empty list. The dropdown stays clean until the user types.
  if (!q) return [];
  // Lower threshold for short queries so a 3-letter typo still surfaces matches.
  const threshold = q.length <= 3 ? 0.55 : 0.5;
  return studios
    .map((s) => ({ studio: s, sc: score(q, s.name) }))
    .filter(({ sc }) => sc >= threshold)
    .sort((a, b) => b.sc - a.sc)
    .map(({ studio }) => studio);
}

export function hasExactMatch(studios, query) {
  const q = normalize(query);
  if (!q) return false;
  return studios.some((s) => normalize(s.name) === q);
}
