// A parent's onboarding describes a child, not themselves. The child needs a
// real student row — coaches attach classes and focus points to a student_id —
// and a student row needs an auth account, which only the service role can
// create. So the whole creation happens in one server call, made with the
// parent's own JWT: see supabase/functions/create-child-account.
import { supabase } from './supabase/client';

export async function createChildAccount(profile) {
  const { data, error } = await supabase.functions.invoke('create-child-account', { body: profile });
  if (error) {
    let detail = '';
    try { detail = (await error.context?.json?.())?.error || ''; } catch { /* body already read */ }
    return { error: detail || 'Could not set up your child’s profile.' };
  }
  if (!data?.childId) return { error: 'Could not set up your child’s profile.' };
  return { childId: data.childId };
}
