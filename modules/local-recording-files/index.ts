// ───────────────────────────────────────────────────────────────────────
// local-recording-files
//
// JS wrapper for the native iOS folder picker + bookmark reader used by
// the DJI mic local-recording workflow. See LocalRecordingFilesModule.swift
// for the deeper implementation notes.
//
// Usage:
//   import * as DjiFiles from 'local-recording-files';
//
//   // First time: prompt the coach to grant folder access.
//   if (!DjiFiles.hasFolder()) {
//     const name = await DjiFiles.pickFolder();
//     if (!name) return; // coach cancelled
//   }
//
//   // Every subsequent import: silently list files in the bookmarked folder.
//   const files = await DjiFiles.listFiles();
//   // → [{ name: 'DJI_21_20260512_132205.WAV', sizeBytes: 4200000,
//   //     modificationDate: '2026-05-12T13:22:05Z' }, …]
//
//   // For the file we want to upload, copy it into the app's cache and
//   // pass the local URI to fetch() / supabase.storage.upload().
//   const localUri = await DjiFiles.copyFileToCache(files[0].name);
// ───────────────────────────────────────────────────────────────────────

import { requireNativeModule, EventSubscription } from 'expo-modules-core';
import { Platform } from 'react-native';

export type DjiFileEntry = {
  /** Leaf filename, e.g. "DJI_21_20260512_132205.WAV" — used by the matcher
   *  for filename parsing. */
  name: string;
  /** Path relative to the picked folder, e.g. "DJI_Audio_001/DJI_21_…WAV".
   *  Pass this to copyFileToCache, not `name`. */
  relativePath: string;
  /** File size in bytes. */
  sizeBytes: number;
  /** ISO-8601 string of the file's modification date (iOS-side). */
  modificationDate: string;
};

// Lazy native-module handle. Same defensive pattern as audio-route-picker
// so the JS layer doesn't crash in Expo Go / on a build that hasn't
// recompiled the native pod.
let _modCache: any | null | undefined;
function getMod(): any | null {
  if (Platform.OS !== 'ios') return null;
  if (_modCache !== undefined) return _modCache;
  try {
    _modCache = requireNativeModule('LocalRecordingFiles');
  } catch (err) {
    if (__DEV__) {
      console.warn(
        '[local-recording-files] Native module not found — rebuild the dev client to enable DJI file imports.',
        err,
      );
    }
    _modCache = null;
  }
  return _modCache;
}

/**
 * Presents the iOS folder picker. The coach navigates to the DJI mic in
 * the Files app and selects the audio folder ("DJI_Audio_001"). On Allow,
 * we persist a security-scoped bookmark for future calls; no further
 * permission prompts will appear until the bookmark goes stale (e.g. mic
 * reformatted) or the coach calls clearFolder().
 *
 * Resolves with the chosen folder's display name on success, or null if
 * the coach cancelled the picker.
 */
export async function pickFolder(): Promise<string | null> {
  const mod = getMod();
  if (!mod) return null;
  return await mod.pickFolder();
}

/** True iff we have a saved folder bookmark. Synchronous. */
export function hasFolder(): boolean {
  const mod = getMod();
  if (!mod) return false;
  return !!mod.hasFolder();
}

/** Drops the saved bookmark. Next call to listFiles() will fail until
 * the coach re-runs pickFolder(). */
export function clearFolder(): void {
  const mod = getMod();
  if (!mod) return;
  mod.clearFolder();
}

/**
 * Enumerates files in the bookmarked folder. Metadata only — for the
 * actual bytes call copyFileToCache(name) with the file you want.
 *
 * Throws if no folder has been picked yet. Catch and prompt for
 * pickFolder() in that case.
 */
export async function listFiles(): Promise<DjiFileEntry[]> {
  const mod = getMod();
  if (!mod) return [];
  return await mod.listFiles();
}

/**
 * Copies a file out of the bookmarked folder into the app's cache
 * directory, returning the local file:// URI of the copy. The copy
 * survives the iOS security scope, so fetch() / supabase.storage.upload()
 * can read it transparently like any other local file.
 *
 * `relativePath` is the entry's relativePath from listFiles() — supports
 * nested subdirectories (e.g. "DJI_Audio_001/DJI_21_…WAV"). The
 * destination filename in the cache is always the leaf name.
 */
export async function copyFileToCache(relativePath: string): Promise<string> {
  const mod = getMod();
  if (!mod) throw new Error('LocalRecordingFiles module unavailable on this platform');
  return await mod.copyFileToCache(relativePath);
}

/**
 * Compresses a (large, uncompressed) WAV into a small AAC/.m4a in the app
 * cache and returns its local file:// URI. The DJI mic records 48 kHz /
 * 24-bit WAV (~8.6 MB/min) — far too big for Supabase's 50 MB free-tier
 * per-object limit and needlessly heavy to upload over mobile. AAC is
 * plenty for speech transcription (AssemblyAI handles m4a natively).
 *
 * `inputUri` is a local file:// URI (e.g. from copyFileToCache or the
 * document picker). Returns the .m4a file:// URI ready to upload.
 */
export async function transcodeToM4A(inputUri: string): Promise<string> {
  const mod = getMod();
  if (!mod) throw new Error('LocalRecordingFiles module unavailable on this platform');
  return await mod.transcodeToM4A(inputUri);
}

// ─── Audio route monitor ─────────────────────────────────────────────────
//
// Pre-class hook for first-time setup: while the coach is on the dashboard
// without a folder bookmark yet, we activate an `.ambient` audio session
// (output-only, mixes with other audio) just to receive route change
// notifications. When a USB-C audio device matching DJI is plugged in,
// the native side emits `onDjiDeviceDetected` and JS pops a setup modal.
//
// Why `.ambient`: it does NOT make iOS demote a connected Bluetooth
// speaker to HFP (phone-call mode) the way `.record` / `.playAndRecord`
// would. So we get the plug-in detection essentially for free, without
// disturbing the coach's Spotify-on-BT-speaker session.
//
// IMPORTANT: stopAudioRouteMonitor() MUST be called before a class
// starts. Local-recording mode's invariant is "no audio session active
// during the cours" — that's what keeps the BT speaker in A2DP while
// the mic records on its own storage. Leaving the monitor active during
// class would defeat that.

export interface DjiDeviceDetectedEvent {
  /** iOS port name, e.g. "DJI Mic Mobile Receiver", "USB-C". */
  deviceName: string;
  /** Underlying AVAudioSessionPortDescription.portType raw value. */
  portType: string;
}

/**
 * Begins listening for audio route changes. Calls resolve once the
 * session is active and the observer is attached. Idempotent — calling
 * twice without an intervening stop is a no-op on the second call.
 */
export async function startAudioRouteMonitor(): Promise<boolean> {
  const mod = getMod();
  if (!mod) return false;
  try {
    return !!(await mod.startAudioRouteMonitor());
  } catch (err) {
    if (__DEV__) console.warn('[local-recording-files] startAudioRouteMonitor failed:', err);
    return false;
  }
}

/**
 * Tears down the listener and deactivates the audio session. Safe to
 * call even when the monitor isn't running.
 */
export async function stopAudioRouteMonitor(): Promise<boolean> {
  const mod = getMod();
  if (!mod) return false;
  try {
    return !!(await mod.stopAudioRouteMonitor());
  } catch (err) {
    if (__DEV__) console.warn('[local-recording-files] stopAudioRouteMonitor failed:', err);
    return false;
  }
}

/**
 * Subscribes to `onDjiDeviceDetected` events emitted while the route
 * monitor is active. Returns a subscription handle — call `.remove()`
 * in your cleanup to unsubscribe.
 */
export function addDjiDeviceDetectedListener(
  handler: (event: DjiDeviceDetectedEvent) => void,
): EventSubscription | null {
  const mod = getMod();
  if (!mod) return null;
  return mod.addListener('onDjiDeviceDetected', handler);
}
