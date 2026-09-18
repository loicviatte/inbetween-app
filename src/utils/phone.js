// ─── Phone numbers typed the way people know them ───────────────────────────
// The server wants E.164 (+447482552037), but nobody types that: they pick a
// country and write the number as they'd dial it at home — 07482 552037 or
// 7482 552037. `trunk` is the domestic prefix dropped once the country code is
// in front (the UK's 0, Russia's 8, North America's 1). Countries without one
// keep every digit: an Italian mobile starts with 3, a Spanish one with 6 or 7.

export const COUNTRIES = [
  { iso: 'GB', flag: '🇬🇧', name: 'United Kingdom', dial: '44', trunk: '0', example: '7700 900123' },
  { iso: 'IE', flag: '🇮🇪', name: 'Ireland', dial: '353', trunk: '0', example: '85 123 4567' },
  { iso: 'FR', flag: '🇫🇷', name: 'France', dial: '33', trunk: '0', example: '6 12 34 56 78' },
  { iso: 'BE', flag: '🇧🇪', name: 'Belgium', dial: '32', trunk: '0', example: '470 12 34 56' },
  { iso: 'NL', flag: '🇳🇱', name: 'Netherlands', dial: '31', trunk: '0', example: '6 12345678' },
  { iso: 'DE', flag: '🇩🇪', name: 'Germany', dial: '49', trunk: '0', example: '1512 3456789' },
  { iso: 'CH', flag: '🇨🇭', name: 'Switzerland', dial: '41', trunk: '0', example: '78 123 45 67' },
  { iso: 'AT', flag: '🇦🇹', name: 'Austria', dial: '43', trunk: '0', example: '664 123456' },
  { iso: 'IT', flag: '🇮🇹', name: 'Italy', dial: '39', trunk: null, example: '312 345 6789' },
  { iso: 'ES', flag: '🇪🇸', name: 'Spain', dial: '34', trunk: null, example: '612 34 56 78' },
  { iso: 'PT', flag: '🇵🇹', name: 'Portugal', dial: '351', trunk: null, example: '912 345 678' },
  { iso: 'DK', flag: '🇩🇰', name: 'Denmark', dial: '45', trunk: null, example: '20 12 34 56' },
  { iso: 'SE', flag: '🇸🇪', name: 'Sweden', dial: '46', trunk: '0', example: '70 123 45 67' },
  { iso: 'NO', flag: '🇳🇴', name: 'Norway', dial: '47', trunk: null, example: '406 12 345' },
  { iso: 'FI', flag: '🇫🇮', name: 'Finland', dial: '358', trunk: '0', example: '41 2345678' },
  { iso: 'PL', flag: '🇵🇱', name: 'Poland', dial: '48', trunk: null, example: '512 345 678' },
  { iso: 'UA', flag: '🇺🇦', name: 'Ukraine', dial: '380', trunk: '0', example: '50 123 4567' },
  { iso: 'RU', flag: '🇷🇺', name: 'Russia', dial: '7', trunk: '8', example: '912 345 67 89' },
  { iso: 'US', flag: '🇺🇸', name: 'United States / Canada', dial: '1', trunk: '1', example: '201 555 0123' },
  { iso: 'AU', flag: '🇦🇺', name: 'Australia', dial: '61', trunk: '0', example: '412 345 678' },
];

export const DEFAULT_COUNTRY = 'GB';

export const countryByIso = (iso) => COUNTRIES.find((c) => c.iso === iso) || COUNTRIES[0];

// "07482 552037" with GB → "+447482552037". A number typed with its own
// international prefix (+33…, 0033…) is taken as it is, whatever is selected.
export function toE164(iso, raw) {
  const typed = String(raw || '').trim();
  if (!typed) return '';
  if (/^(\+|00)/.test(typed)) return `+${typed.replace(/^00/, '').replace(/\D/g, '')}`;
  const c = countryByIso(iso);
  let national = typed.replace(/\D/g, '');
  // The UK's 0 is always a prefix; North America's 1 and Russia's 8 only when
  // the rest is a full 10-digit number.
  if (c.trunk === '0' && national.startsWith('0')) national = national.slice(1);
  else if (c.trunk && c.trunk !== '0' && national.length === 11 && national.startsWith(c.trunk)) national = national.slice(1);
  return national ? `+${c.dial}${national}` : '';
}

// Back from E.164 to what the field shows, for an invitation reopened on the
// device: the longest matching country code wins (+353 before +35…).
export function splitE164(e164) {
  const v = String(e164 || '');
  if (!v.startsWith('+')) return { iso: DEFAULT_COUNTRY, national: v };
  const digits = v.slice(1);
  const match = [...COUNTRIES]
    .sort((x, y) => y.dial.length - x.dial.length)
    .find((c) => digits.startsWith(c.dial));
  return match ? { iso: match.iso, national: digits.slice(match.dial.length) } : { iso: DEFAULT_COUNTRY, national: v };
}
