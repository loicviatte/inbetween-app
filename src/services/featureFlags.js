// Per-user feature flags. Flags are hardcoded by user_id today; move to a
// remote config table when we need to flip them without shipping a build.

// Coaches enrolled in the native iOS recorder (continuous-audio-recorder
// module). When enabled, StartClassScreen captures audio via AVAudioEngine
// with native chunk rotation instead of expo-av's Audio.Recording. Falls
// back to expo-av automatically if the native start path throws.
const NATIVE_RECORDER_USER_IDS = new Set([
  // viatteloic@gmail.com (test coach)
  'b34fc050-3431-49e7-bf8f-0df0560dcbe3',
]);

export function isNativeRecorderEnabled(user) {
  if (!user) return false;
  const id = typeof user === 'string' ? user : user?.id;
  if (!id) return false;
  return NATIVE_RECORDER_USER_IDS.has(id);
}
