// One way to write a date in this app.
//
// Written by hand rather than through toLocaleDateString: with no explicit
// locale that call follows the PHONE's language, which put French weekdays and
// "sept." into an otherwise English interface; with 'en-GB' it writes "Sept"
// where the rest of the app writes "Sep". So: our own tables, one format.
//
//   dayLabel   Today · Yesterday · Mon 14 Sep · Mon 14 Sep 2025
//   dateLabel  the same, but never "Today" — for a line that already says when
//   agoLabel   Today · Yesterday · 3 days ago
//   longDate   September 14, 2026 — titles only

export const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function daysAgo(date) {
  return Math.round((startOfDay(new Date()) - startOfDay(new Date(date))) / 86400000);
}

// "Mon 14 Sep", with the year when it isn't this one.
export function dateLabel(date) {
  const d = new Date(date);
  const base = `${DAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

export function dayLabel(date) {
  const n = daysAgo(date);
  if (n === 0) return 'Today';
  if (n === 1) return 'Yesterday';
  return dateLabel(date);
}

export function agoLabel(date) {
  const n = daysAgo(date);
  if (n <= 0) return 'Today';
  if (n === 1) return 'Yesterday';
  return `${n} days ago`;
}

export const weekdayLong = (date) => DAYS_LONG[new Date(date).getDay()];
export const weekdayShort = (date) => DAYS_SHORT[new Date(date).getDay()];

// For a heading that carries the date on its own.
export function longDate(date) {
  const d = new Date(date);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
