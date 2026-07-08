import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabase/client';

// How notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerPushToken(userId) {
  if (!Device.isDevice) {
    console.log('[Push] Skipped — not a physical device');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Push] Permission denied');
    return null;
  }

  // Android requires a notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#000000',
    });
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: 'e6845c91-600b-42a1-86ab-a74041006225',
  });
  const token = tokenData.data;

  // Save token to Supabase
  const { error } = await supabase
    .from('users')
    .update({ push_token: token })
    .eq('id', userId);

  if (error) console.error('[Push] Failed to save token:', error.message);
  else console.log('[Push] Token registered:', token);

  return token;
}

// Null the stored push token for a user. Call on logout so a shared device
// stops receiving pushes tied to the ended session, and so a rotated/dead
// token doesn't linger. Fire-and-forget from the caller: it issues the write
// with the still-valid session before sign-out drops it.
export async function clearPushToken(userId) {
  if (!userId) return;
  try {
    const { error } = await supabase
      .from('users')
      .update({ push_token: null })
      .eq('id', userId);
    if (error) console.warn('[Push] clearPushToken failed:', error.message);
  } catch (err) {
    console.warn('[Push] clearPushToken error:', err?.message ?? err);
  }
}

// Listen for notification taps (app in background/killed)
export function setupNotificationListeners({ onNotificationTap }) {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    if (onNotificationTap) onNotificationTap(data);
  });
  return () => subscription.remove();
}
