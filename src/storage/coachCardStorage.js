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
    how_i_teach: a.correct || null,
    my_method: a.signature || null,
    alloc: a.alloc || {},
    best_for: a.leave || [],
    credential: a.cred || null,
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
