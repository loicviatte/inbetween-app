import { Alert } from 'react-native';

// A student the coach marked under 18, still waiting on their age check: the
// coach can see they exist (greyed) but can't open them or record them until
// the student confirms they're 18 or over, or a parent gives permission.
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

// Open a student only if they're not waiting on verification.
export function guardStudent(student, open) {
  if (isAwaitingVerification(student)) return showVerificationPopup(student?.name);
  return open();
}
