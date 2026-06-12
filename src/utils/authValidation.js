// Lightweight client-side validation for the auth / onboarding screens.
// Server-side rules (Supabase) remain the source of truth; this is just to
// catch obvious mistakes inline before a round-trip.

export function isValidEmail(email) {
  // Deliberately permissive — one @, a dot in the domain, no spaces. We only
  // want to reject clearly-malformed input, not police RFC 5322.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email || '').trim());
}

// Returns { level, label } where level is 0..3:
//   0 = too short (below the 6-char Supabase minimum)
//   1 = weak · 2 = good · 3 = strong
export function passwordStrength(pw) {
  const p = pw || '';
  if (p.length === 0) return { level: 0, label: '' };
  if (p.length < 6) return { level: 0, label: 'Too short' };
  let bits = 0;
  if (p.length >= 8) bits += 1;
  if (/[0-9]/.test(p)) bits += 1;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) bits += 1;
  if (/[^a-zA-Z0-9]/.test(p)) bits += 1;
  if (bits <= 1) return { level: 1, label: 'Weak' };
  if (bits === 2) return { level: 2, label: 'Good' };
  return { level: 3, label: 'Strong' };
}
