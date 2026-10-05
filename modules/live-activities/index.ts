import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

const native = Platform.OS === 'ios' ? requireOptionalNativeModule('LiveActivities') : null;

export type CoachActivityKind = 'private' | 'group';

export type CoachActivityArgs = {
  kind: CoachActivityKind;
  studentName?: string | null;
  startedAt: number; // ms epoch
};

export type FocusActivityArgs = {
  focusPointName: string;
  startedAt: number; // ms epoch
  targetSec?: number | null; // null = open session
};

export async function startCoachRecording(args: CoachActivityArgs): Promise<string | null> {
  if (!native) return null;
  return await native.startCoachRecording(args);
}

export async function updateCoachRecording(
  activityId: string,
  patch: { isInterrupted?: boolean; staleSeconds?: number }
): Promise<void> {
  if (!native) return;
  await native.updateCoachRecording({ activityId, ...patch });
}

export async function endCoachRecording(activityId: string): Promise<void> {
  if (!native) return;
  await native.endCoachRecording({ activityId });
}

export async function getActiveCoachRecordings(): Promise<string[]> {
  if (!native) return [];
  return await native.getActiveCoachRecordings();
}

export async function endAllCoachRecordings(): Promise<void> {
  if (!native) return;
  await native.endAllCoachRecordings();
}

export async function startFocusPoint(args: FocusActivityArgs): Promise<string | null> {
  if (!native) return null;
  return await native.startFocusPoint(args);
}

export async function updateFocusPoint(
  activityId: string,
  patch: { isPaused?: boolean }
): Promise<void> {
  if (!native) return;
  await native.updateFocusPoint({ activityId, ...patch });
}

export async function endFocusPoint(activityId: string, targetReached?: boolean): Promise<void> {
  if (!native) return;
  await native.endFocusPoint({ activityId, targetReached: !!targetReached });
}

export type MicPendingState = {
  stage: 'waiting' | 'uploading' | 'extracting' | 'ready';
  progress: number; // overall 0...1 — Lesson 60%, Mic audio 20%, Focus points 20%
  title: string;
  detail: string;
  badge: string | null; // compact Dynamic Island text in place of the %
  cta: string | null; // button label, none when null
  link: string; // where a tap goes
};

export async function startMicPending(state: MicPendingState): Promise<string | null> {
  if (!native?.startMicPending) return null;
  return await native.startMicPending(state);
}

/** Rewrites every live mic-pending activity; resolves how many it reached. */
export async function updateMicPending(state: MicPendingState): Promise<number> {
  if (!native?.updateMicPending) return 0;
  return await native.updateMicPending(state);
}

export async function endMicPending(): Promise<void> {
  if (!native?.endMicPending) return;
  await native.endMicPending();
}

export type MicPendingPushToken = { activityId: string; token: string };

/** Push tokens of the live mic-pending activities (ones started earlier too). */
export async function micPendingPushTokens(): Promise<MicPendingPushToken[]> {
  if (!native?.micPendingPushTokens) return [];
  return await native.micPendingPushTokens();
}

/** Called with each activity's push token as Apple hands it over. */
export function addMicPendingPushTokenListener(fn: (e: MicPendingPushToken) => void): { remove: () => void } {
  if (!native?.addListener) return { remove: () => {} };
  return native.addListener('onMicPendingPushToken', fn);
}

/** The token the server uses to start an activity on this phone (iOS 17.2+). */
export async function micPendingPushToStartToken(): Promise<string | null> {
  if (!native?.micPendingPushToStartToken) return null;
  return await native.micPendingPushToStartToken();
}

/** Called with the push-to-start token as iOS hands it over (and rotates it). */
export function addMicPendingPushToStartTokenListener(fn: (e: { token: string }) => void): { remove: () => void } {
  if (!native?.addListener) return { remove: () => {} };
  return native.addListener('onMicPendingPushToStartToken', fn);
}

/** 'sandbox' for a development-signed build, 'production' otherwise. */
export function apnsEnvironment(): 'sandbox' | 'production' {
  return native?.apnsEnvironment?.() ?? 'production';
}

export const isLiveActivitiesAvailable = (): boolean => !!native;
