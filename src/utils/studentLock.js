import { Alert } from 'react-native';
import { coachReviewPending, coachReviewStudentAge } from '../services/ageCheck';

// A student the coach marked under 18, still waiting on their age check: the
// coach can see they exist (greyed) but can't open them or record them. If the
// student asked the coach to look again, tapping them asks the coach instead.
export const isAwaitingVerification = (student) =>
  (student?.age_check ?? student?.ageCheck) === 'minor_pending';

export function showVerificationPopup(name, onClose) {
  const first = (name || 'This student').split(/\s+/)[0];
  Alert.alert(
    'Verification in progress',
    `${first} will be available again once their account is verified.`,
    [{ text: 'OK', onPress: onClose }],
  );
}

// "Is X 18 or over?" again, for a student who asked for it. onDone(result)
// runs after an answer: 'unlocked' | 'kept'.
export function showAgeReviewPopup(student, onDone) {
  const first = (student?.name || 'This student').split(/\s+/)[0];
  const answer = async (adult) => {
    try {
      const r = await coachReviewStudentAge(student.id, adult);
      onDone?.(r);
    } catch (e) {
      Alert.alert('Not saved', e.message || 'Try again in a moment.');
    }
  };
  Alert.alert(
    'Please double-check',
    `${first} asked you to confirm their age again. Is ${first} 18 or over? This helps us make sure we get it right.`,
    [
      { text: 'Later', style: 'cancel' },
      { text: 'Under 18', onPress: () => { answer(false); } },
      { text: '18 or over', onPress: () => { answer(true); } },
    ],
  );
}

// Open a student only if they're not waiting on verification; a review they
// asked for comes first.
export async function guardStudent(student, open, onReviewed) {
  if (!isAwaitingVerification(student)) return open();
  const pending = student?.id ? await coachReviewPending(student.id).catch(() => false) : false;
  if (pending) return showAgeReviewPopup(student, onReviewed);
  return showVerificationPopup(student?.name);
}
