import { supabase } from '../services/supabase/client';
import { getUserId } from './storage';

export async function listStudios() {
  const { data } = await supabase
    .from('studios')
    .select('id, name')
    .order('name', { ascending: true });
  return data || [];
}

export async function createStudio(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Studio name is required.');
  const userId = await getUserId().catch(() => null);
  const { data, error } = await supabase
    .from('studios')
    .insert({ name: trimmed, created_by: userId })
    .select('id, name')
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('A studio with that name already exists.');
    throw error;
  }
  return data;
}

export async function setMyStudio(studioId) {
  const userId = await getUserId();
  await supabase.from('users').update({ studio_id: studioId }).eq('id', userId);
}
