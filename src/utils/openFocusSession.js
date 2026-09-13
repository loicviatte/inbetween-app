import { Alert } from 'react-native';
import { startTrainingSession } from './algorithm';
import { getActiveSession } from '../storage/activeSession';

// Start training one focus point, from anywhere outside Train.
//
// Mirrors HomeScreen's handleStartSession: the same active-session guard, the
// same session id, the same route. Kept here rather than duplicated so the two
// entry points cannot drift — Train's carousel and Profile's readiness rows
// must land a student in exactly the same place.
//
// `rank` / `sessionCount` are Train-carousel context (position in the plan) and
// are left at their defaults here, where there is no carousel.
export async function openFocusSession(navigation, focusPointId) {
  if (!navigation || !focusPointId) return;

  // One session at a time. Train refuses silently; say why instead, since from
  // Profile the running session is not on screen to explain itself.
  if (getActiveSession()) {
    Alert.alert(
      'A session is already running',
      'Finish the one in progress on Train before starting another.',
    );
    return;
  }

  const sessionId = await startTrainingSession(focusPointId, null);
  navigation.navigate('FocusSession', { focusPointId, sessionId });
}
