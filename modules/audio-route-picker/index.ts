import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export async function presentAudioRoutePicker(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const mod = requireNativeModule('AudioRoutePicker');
  return mod.presentPicker();
}
