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

export const isLiveActivitiesAvailable = (): boolean => !!native;
