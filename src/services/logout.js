// Logging out, with the questions it has to ask first. Shared by Stats ▸
// Settings and the Account sheet opened from the header avatar.
import { Alert } from 'react-native';
import { endFocusPoint as laEndFocusPoint } from 'live-activities';
import { supabase } from './supabase/client';
import { clearPushToken } from './notifications';
import { pairedChildInfo, forgetPairedChild, forgetChildPhones } from './childPairing';
import { clearUserCaches } from '../storage/userCaches';
import { invalidateCache, clearSubjectCache } from '../storage/storage';
import { getActiveSession, clearActiveSession, clearChatMessages } from '../storage/activeSession';
import { getActiveCoachClass, clearActiveCoachClass } from '../storage/activeCoachClass';

// resetProfile clears the in-memory avatar and initials (ProfileContext) so the
// next account never flashes this one's photo.
export async function logOutWithChecks({ resetProfile } = {}) {
  // A child signed in with their parent's code has no password: logging out
  // means asking for a new code, so it's said before it happens.
  const paired = await pairedChildInfo().catch(() => null);
  if (paired) {
    Alert.alert(
      'Log out?',
      `You’ll need a new code from ${paired.parentName || 'your parent'} to sign back in.`,
      [
        { text: 'Stay signed in', style: 'cancel' },
        { text: 'Log out', style: 'destructive', onPress: () => afterSessionCheck(resetProfile) },
      ],
    );
    return;
  }
  afterSessionCheck(resetProfile);
}

function afterSessionCheck(resetProfile) {
  if (getActiveSession()) {
    Alert.alert(
      'Session in progress',
      'You have a focus session running. Logging out will discard it. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discard & log out', style: 'destructive', onPress: () => { performLogout(resetProfile); } },
      ],
    );
    return;
  }
  performLogout(resetProfile);
}

// The in-memory reads (lessons, teacher context, whose training this is, a
// parent's child phones) aren't keyed by account: the next person signing in
// on this phone would get them for up to a minute.
function forgetMemoryCaches() {
  invalidateCache();
  clearSubjectCache();
  forgetChildPhones();
}

async function performLogout(resetProfile) {
  // A focus session runs off a plain JS module (activeSession) whose in-memory
  // holder survives clearUserCaches() (that only wipes AsyncStorage): cleared
  // here, or the running chrono bleeds into the next account on this device.
  const active = getActiveSession();
  if (active?.liveActivityId) { try { laEndFocusPoint(active.liveActivityId, false); } catch {} }
  clearActiveSession();
  clearChatMessages();
  resetProfile?.();
  await clearUserCaches();
  forgetMemoryCaches();
  forgetPairedChild();
  // This phone stops receiving the account's pushes BEFORE sign-out (it needs
  // the session); the account's other phones keep theirs.
  const { data: { session } } = await supabase.auth.getSession();
  await clearPushToken(session?.user?.id);
  await supabase.auth.signOut({ scope: 'local' });
}

// A coach: a class still recording or a DJI import still uploading would be
// discarded, so that's asked first (same as the coach profile's log out).
export function logOutCoachWithChecks({ djiUploading = false } = {}) {
  const activeClass = getActiveCoachClass();
  const go = async () => {
    clearActiveCoachClass();
    await clearUserCaches();
    forgetMemoryCaches();
    const { data: { session } } = await supabase.auth.getSession();
    await clearPushToken(session?.user?.id);
    await supabase.auth.signOut({ scope: 'local' });
  };
  if (activeClass || djiUploading) {
    const what = activeClass ? 'a lesson is still recording' : 'a DJI import is still uploading';
    Alert.alert('In progress', `You have ${what}. Logging out will discard it. Continue?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard & log out', style: 'destructive', onPress: () => { go(); } },
    ]);
    return;
  }
  go();
}
