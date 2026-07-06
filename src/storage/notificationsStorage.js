import { supabase } from '../services/supabase/client';

export async function getNotifications() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return [];
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

export async function deleteNotification(id) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;
    await supabase
      .from('notifications')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
  } catch {}
}

// Coach "action needed" review notifications whose read state is the SOURCE of
// the bell badge until the coach actually reviews the focus points. These must
// NOT be flipped to read just because the coach opened the notifications list —
// otherwise the bell drops to 0 while the work still sits in ActionNeeded. They
// are marked read by the review action itself (markFocusAddedNotificationsRead*
// in coachStorage/coupleStorage). Students never receive these types, so the
// exclusion is a no-op on the student side.
const KEEP_UNREAD_UNTIL_ACTIONED = [
  'focus_point_added',
  'focus_points_added',
  'focus_reconcile_needed',
];

export async function markAllNotificationsRead() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false)
      .not('type', 'in', `(${KEEP_UNREAD_UNTIL_ACTIONED.join(',')})`);
  } catch {}
}
