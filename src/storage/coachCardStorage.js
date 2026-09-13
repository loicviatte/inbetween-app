// ─── Coach card ─────────────────────────────────────────────────────────────
// The document a coach builds during onboarding and sends to prospective
// students. It lives in its own table because it has a slug, a publication
// state and a public audience — see supabase/migrations/20260913_coach_cards.sql.
import { supabase } from '../services/supabase/client';
import { getAuthUserId } from './storage';

const DANCES = {
  Latin: ['Cha Cha', 'Rumba', 'Samba', 'Paso Doble', 'Jive'],
  Ballroom: ['Waltz', 'Tango', 'Foxtrot', 'Quickstep', 'Viennese Waltz'],
  'Latin & Ballroom': ['Cha Cha', 'Rumba', 'Samba', 'Paso Doble', 'Jive',
    'Waltz', 'Tango', 'Foxtrot', 'Quickstep', 'Viennese Waltz'],
};

// ── the coach's answers, as choices ─────────────────────────────────────────
// Every answer is a tap: nothing typed, nothing an AI rewrites. Each choice
// carries the exact sentence the card shows, so what the coach picks is what a
// student reads — no interpretation is ever published that he didn't choose.
export const CORRECT_OPTIONS = [
  { v: 'dance', t: 'I dance it next to them', card: 'I correct by dancing the movement right next to you.' },
  { v: 'show', t: 'I show it, they copy it', card: 'I show you the movement, then have you copy it until it matches.' },
  { v: 'hands', t: 'I adjust them hands-on', card: 'I adjust your body hands-on until it finds the position.' },
  { v: 'explain', t: 'I explain the mechanics', card: 'I explain the mechanics until the movement makes sense to you.' },
  { v: 'break', t: 'I break it into small steps', card: 'I break the movement into small steps and rebuild it with you.' },
  { v: 'feel', t: 'I let them feel it first', card: 'I let you feel the movement first, then refine the details.' },
];
export const METHOD_OPTIONS = [
  { v: 'repeat', t: 'Repetition', card: 'A correction sticks through repetition — we go again until your body owns it.' },
  { v: 'rhythm', t: 'Rhythm and counts', card: 'I turn a movement into a rhythm you count back, again and again.' },
  { v: 'image', t: 'An image to remember', card: 'I give you an image to hold on to, so the movement comes back on its own.' },
  { v: 'contrast', t: 'Feeling right from wrong', card: 'I have you feel the wrong way and the right way until you can tell them apart.' },
  { v: 'slow', t: 'Slow, then up to tempo', card: 'I slow a movement right down and build it back up to tempo.' },
];
export const EXPERIENCE_OPTIONS = [
  { v: 'lt2', t: 'Less than 2 years', card: 'Teaching for under 2 years' },
  { v: '2to5', t: '2 to 5 years', card: 'Teaching for 2–5 years' },
  { v: '5to10', t: '5 to 10 years', card: 'Teaching for 5–10 years' },
  { v: '10to20', t: '10 to 20 years', card: 'Teaching for 10–20 years' },
  { v: '20plus', t: 'More than 20 years', card: 'Teaching for 20+ years' },
];
const cardLine = (options, v) => options.find((o) => o.v === v)?.card || null;
export const howITeachFrom = (v) => cardLine(CORRECT_OPTIONS, v);
export const myMethodFrom = (v) => cardLine(METHOD_OPTIONS, v);
export const credentialFrom = (v) => cardLine(EXPERIENCE_OPTIONS, v);

// "Marc Delaunay" → "marcdelaunay". Accents are folded rather than dropped so
// "Gaëlle" does not become "galle".
export function slugify(name) {
  return (name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '')
    .slice(0, 32) || 'coach';
}

// The card's essence line, built from the words he chose and where his hour
// goes. Kept here so the card shown on screen and the card stored are the same
// sentence — two implementations would drift on the first edit.
export function essenceFrom(words, alloc) {
  const axes = Object.keys(alloc || {});
  const top = axes.length ? [...axes].sort((a, b) => alloc[b] - alloc[a])[0] : 'Technique';
  if (!words?.length) return `${top} first, then the rest.`;
  return `${words[0]}${words[1] ? ` and ${words[1].toLowerCase()}` : ''} — ${top.toLowerCase()} first, then the rest.`;
}

// Returns { slug } or { error }. The slug is claimed on insert; a collision
// with another coach of the same name gets a short suffix rather than failing.
export async function saveCoachCard(userId, a) {
  const row = {
    user_id: userId,
    essence: essenceFrom(a.words, a.alloc),
    style_words: a.words || [],
    teaches: DANCES[a.style] || DANCES.Latin,
    works_with: a.who || [],
    how_i_teach: howITeachFrom(a.correct),
    my_method: myMethodFrom(a.signature),
    alloc: a.alloc || {},
    best_for: a.leave || [],
    credential: credentialFrom(a.cred),
    published: true,
  };

  const base = slugify(a.name);
  for (const slug of [base, `${base}${Math.random().toString(36).slice(2, 5)}`]) {
    const { error } = await supabase.from('coach_cards').upsert({ ...row, slug }, { onConflict: 'user_id' });
    if (!error) return { slug };
    // 23505 is a unique violation — on this table that can only be the slug,
    // since user_id conflicts are what upsert is resolving.
    if (error.code !== '23505') return { error: error.message };
  }
  return { error: 'Could not claim a link for your card.' };
}

export async function getMyCoachCard() {
  const userId = await getAuthUserId();
  const { data } = await supabase.from('coach_cards').select('*').eq('user_id', userId).maybeSingle();
  return data || null;
}
