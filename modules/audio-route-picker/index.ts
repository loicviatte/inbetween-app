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

// Memoised handle on the native module. Resolved lazily and cached, with a
// graceful null fallback when the module isn't built into the running
// binary (Expo Go, simulator without a recompile, etc.). Without this guard
// the very first `requireNativeModule` call throws and crashes the screen
// the moment the coach taps Start.
let _modCache: any | null | undefined;
function getMod(): any | null {
  if (Platform.OS !== 'ios') return null;
  if (_modCache !== undefined) return _modCache;
  try {
    _modCache = requireNativeModule('AudioRoutePicker');
  } catch (err) {
    if (__DEV__) {
      console.warn(
        '[audio-route-picker] Native module not found — falling back to OS defaults. Rebuild the dev client to enable the route picker.',
        err,
      );
    }
    _modCache = null;
  }
  return _modCache;
}

export async function presentAudioRoutePicker(): Promise<void> {
  const mod = getMod();
  if (!mod) return;
  return mod.presentPicker();
}

export function getCurrentInputRoute(): AudioRoute {
  const mod = getMod();
  if (!mod) return { name: null, type: 'none', isBluetooth: false };
  return mod.getCurrentInputRoute();
}

export async function listAvailableInputs(): Promise<AudioInput[]> {
  const mod = getMod();
  if (!mod) return [];
  return await mod.listAvailableInputs();
}

export async function setPreferredInput(uid: string): Promise<void> {
  const mod = getMod();
  if (!mod) return;
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
  const mod = getMod();
  if (!mod) return { remove: () => {} };
  const emitter = new EventEmitter(mod);
  const sub = emitter.addListener('onRouteChange', handler);
  return { remove: () => sub.remove() };
}
