// Answers to a dancer's questions they haven't read yet — the badge on Train's
// Questions button. "Read" means the Questions screen was opened after the
// answer arrived; the moment is kept on the phone, per account.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase/client';
import { getUserId } from './storage';

const SEEN_KEY = 'questionsSeenAt.v1:';

export async function markQuestionsSeen() {
  const userId = await getUserId();
  if (!userId) return;
  try {
    await AsyncStorage.setItem(SEEN_KEY + userId, new Date().toISOString());
  } catch {}
}

// Written answers only: one given in a lesson carries no replied_at.
export async function countUnseenAnswers() {
  const userId = await getUserId();
  if (!userId) return 0;
  let since = null;
  try {
    since = await AsyncStorage.getItem(SEEN_KEY + userId);
  } catch {}
  let query = supabase
    .from('coach_messages')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', userId)
    .eq('status', 'replied')
    .not('replied_at', 'is', null);
  if (since) query = query.gt('replied_at', since);
  const { count } = await query;
  return count || 0;
}
