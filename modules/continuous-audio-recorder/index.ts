// Native iOS continuous audio recorder.
//
// Why this exists:
//   expo-audio (and expo-av before it) has a multi-year unresolved bug
//   (expo/expo#21782) where calling prepareToRecord/createAndStartRecording
//   in the background — including immediately after stopping a previous
//   recorder during chunk rotation — fails with:
//     "This experience is currently in the background, so the audio
//      session could not be activated."
//   The result in our app: chunked recording loses everything past the
//   first chunk if the coach's phone is even briefly in a non-active
//   state at the rotation moment. See the May 2026 incident with PL Tanya
//   / Group Marius / PL Erfan, all stuck at 1 chunk.
//
//   This module avoids the bug entirely by NEVER stopping the underlying
//   capture session. A single AVAudioEngine taps the input continuously
//   for the whole class. Chunk rotation is implemented at the file-output
//   layer: we close the current AVAudioFile and open a new one every N
//   seconds, with no impact on AVAudioSession state.
//
// API design mirrors expo-audio's where reasonable for easy migration in
// StartClassScreen.

import { requireNativeModule, NativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export interface ChunkReadyEvent {
  /** Absolute file:// URI to the finalized chunk on disk. */
  uri: string;
  /** Zero-based chunk index in this recording. */
  idx: number;
  /** Real captured duration in milliseconds. */
  durationMs: number;
}

export interface RecorderErrorEvent {
  /** Stable code, e.g. "audio_session", "engine_start", "tap_install". */
  code: string;
  /** Human-readable message from the underlying NSError. */
  message: string;
  /** NSError.domain when applicable. */
  domain?: string;
  /** NSError.code when applicable. */
  nativeCode?: number;
}

export interface MediaServicesResetEvent {
  /** Wall-clock time the iOS HAL crash was detected. */
  at: string;
}

export interface StartOptions {
  /**
   * Absolute directory path (no trailing slash) where chunk files will be
   * written. Caller is responsible for ensuring the directory exists.
   */
  outputDir: string;
  /** Output sample rate in Hz. Default 16000 (matches AssemblyAI). */
  sampleRate?: number;
  /** Channels: 1 (mono) or 2 (stereo). Default 1. */
  channels?: 1 | 2;
  /** AAC encoder bitrate in bits/sec. Default 24000. */
  bitRate?: number;
  /**
   * Chunk duration in ms. Each chunk file is finalized after this many ms
   * of captured audio and a chunkReady event fires. Default 180000 (3 min).
   * Set to 0 to disable rotation (single-file mode for testing).
   */
  chunkDurationMs?: number;
}

export interface StartResult {
  /** Path of the FIRST chunk being written (idx=0). Useful for logging. */
  firstChunkUri: string;
  /** Native input format actually negotiated, for forensics. */
  inputFormat: {
    sampleRate: number;
    channels: number;
  };
}

type RecorderEventsMap = {
  chunkReady: (e: ChunkReadyEvent) => void;
  error: (e: RecorderErrorEvent) => void;
  mediaServicesReset: (e: MediaServicesResetEvent) => void;
};

declare class NativeContinuousAudioRecorderModule extends NativeModule<RecorderEventsMap> {
  start(options: StartOptions): Promise<StartResult>;
  stop(): Promise<{ lastChunkUri: string | null }>;
  isRecording(): boolean;
}

let cached: NativeContinuousAudioRecorderModule | null = null;

function nativeModule(): NativeContinuousAudioRecorderModule {
  if (Platform.OS !== 'ios') {
    throw new Error('continuous-audio-recorder is iOS-only');
  }
  if (!cached) {
    cached = requireNativeModule<NativeContinuousAudioRecorderModule>(
      'ContinuousAudioRecorder',
    );
  }
  return cached;
}

export const ContinuousAudioRecorder = {
  async start(options: StartOptions): Promise<StartResult> {
    return nativeModule().start({
      sampleRate: 16000,
      channels: 1,
      bitRate: 24000,
      chunkDurationMs: 3 * 60 * 1000,
      ...options,
    });
  },

  async stop(): Promise<{ lastChunkUri: string | null }> {
    return nativeModule().stop();
  },

  isRecording(): boolean {
    return nativeModule().isRecording();
  },

  /** Subscribe to chunk-ready events. Returns a remover. */
  addChunkReadyListener(handler: (e: ChunkReadyEvent) => void): { remove: () => void } {
    return nativeModule().addListener('chunkReady', handler);
  },

  addErrorListener(handler: (e: RecorderErrorEvent) => void): { remove: () => void } {
    return nativeModule().addListener('error', handler);
  },

  addMediaServicesResetListener(
    handler: (e: MediaServicesResetEvent) => void,
  ): { remove: () => void } {
    return nativeModule().addListener('mediaServicesReset', handler);
  },
};

export default ContinuousAudioRecorder;
