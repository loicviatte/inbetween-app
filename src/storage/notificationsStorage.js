import { supabase } from '../services/supabase/client';
import { getUserId } from './storage';

export async function getNotifications() {
  try {
    const userId = await getUserId();
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data ?? [];
  } catch {
    return [];
  }
}

export async function markAllNotificationsRead() {
  try {
    const userId = await getUserId();
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);
  } catch {}
}
