import { requireNativeModule, EventEmitter } from 'expo-modules-core';
import { Platform } from 'react-native';

export type AudioRouteType =
  | 'bluetooth' | 'builtin' | 'wired' | 'usb' | 'airplay' | 'none' | string;

export type AudioRoute = {
  name: string | null;
  uid?: string | null;
  type: AudioRouteType;
  isBluetooth: boolean;
};

export type AudioInput = {
  uid: string;
  name: string;
  type: AudioRouteType;
  isBluetooth: boolean;
  isCurrent: boolean;
};

export async function presentAudioRoutePicker(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const mod = requireNativeModule('AudioRoutePicker');
  return mod.presentPicker();
}

export function getCurrentInputRoute(): AudioRoute {
  if (Platform.OS !== 'ios') return { name: null, type: 'none', isBluetooth: false };
  const mod = requireNativeModule('AudioRoutePicker');
  return mod.getCurrentInputRoute();
}

export async function listAvailableInputs(): Promise<AudioInput[]> {
  if (Platform.OS !== 'ios') return [];
  const mod = requireNativeModule('AudioRoutePicker');
  return await mod.listAvailableInputs();
}

export async function setPreferredInput(uid: string): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const mod = requireNativeModule('AudioRoutePicker');
  await mod.setPreferredInput(uid);
}

export type RouteChangeReason =
  | 'oldDeviceUnavailable' | 'newDeviceAvailable' | 'categoryChange'
  | 'override' | 'wakeFromSleep' | 'noSuitableRouteForCategory'
  | 'routeConfigurationChange' | 'unknown';

export type RouteChangeEvent = {
  reason: RouteChangeReason;
  name: string | null;
  uid: string | null;
  type: AudioRouteType;
  isBluetooth: boolean;
};

export function addRouteChangeListener(handler: (e: RouteChangeEvent) => void): { remove: () => void } {
  if (Platform.OS !== 'ios') return { remove: () => {} };
  const mod = requireNativeModule('AudioRoutePicker');
  const emitter = new EventEmitter(mod);
  const sub = emitter.addListener('onRouteChange', handler);
  return { remove: () => sub.remove() };
}
