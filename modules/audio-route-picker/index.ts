import { NativeModules, Platform } from 'react-native';

const { AudioRoutePicker } = NativeModules;

export async function presentAudioRoutePicker(): Promise<void> {
  if (Platform.OS !== 'ios' || !AudioRoutePicker) return;
  return AudioRoutePicker.presentPicker();
}
