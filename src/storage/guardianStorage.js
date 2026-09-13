// ─── Guardians ───────────────────────────────────────────────────────────────
// A parent holds the account; the dancers are their children. The rest of the
// app never sees this: storage.getUserId() resolves to whichever child is being
// followed, so focus points, practice logs and the dashboard all read that one.
// This module is only for the screens that manage the relationship itself.
import { supabase } from '../services/supabase/client';
import { getAuthUserId, clearSubjectCache, invalidateCache } from './storage';

export async function isGuardian() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.user_metadata?.account_for === 'child';
}

// [{ id, name, danceStyle, active }] — oldest link first, so the order is stable.
export async function listChildren() {
  const authId = await getAuthUserId();
  const [{ data: me }, { data: links }] = await Promise.all([
    supabase.from('users').select('active_child_id').eq('id', authId).maybeSingle(),
    supabase
      .from('guardians')
      .select('child_id, created_at, users!guardians_child_id_fkey(id, name, dance_style)')
      .eq('guardian_id', authId)
      .order('created_at'),
  ]);
  const rows = (links || []).map((l) => ({
    id: l.child_id,
    name: l.users?.name || 'Your child',
    danceStyle: l.users?.dance_style || null,
  }));
  const active = rows.some((r) => r.id === me?.active_child_id) ? me.active_child_id : rows[0]?.id;
  return rows.map((r) => ({ ...r, active: r.id === active }));
}

export async function setActiveChild(childId) {
  const authId = await getAuthUserId();
  const { error } = await supabase.from('users').update({ active_child_id: childId }).eq('id', authId);
  if (error) throw new Error(error.message);
  // Everything cached downstream belongs to the child we just left.
  clearSubjectCache();
  invalidateCache();
}
