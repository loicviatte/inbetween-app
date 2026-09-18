import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase/client';

// This phone's Expo token, kept so logging out can take back exactly this
// phone — and leave the account's other phones receiving.
const TOKEN_KEY = '@push_token';
let deviceToken = null;
AsyncStorage.getItem(TOKEN_KEY).then((t) => { if (t && !deviceToken) deviceToken = t; }).catch(() => {});

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
  deviceToken = token;
  AsyncStorage.setItem(TOKEN_KEY, token).catch(() => {});

  // One row per phone, so every phone signed in to the account is pushed (a
  // coach and whoever follows on the same account). users.push_token is still
  // written for the send-push of apps that predate per-device tokens.
  const [device, legacy] = await Promise.all([
    supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS }),
    supabase.from('users').update({ push_token: token }).eq('id', userId),
  ]);
  const error = device.error || legacy.error;
  if (error) console.error('[Push] Failed to save token:', error.message);
  else console.log('[Push] Token registered:', token);

  return token;
}

// On logout: this phone stops receiving the account's pushes; its other phones
// keep theirs. Await it before signing out — it needs the session — it gives up
// after 2.5s so a phone offline can still log out.
export async function clearPushToken(userId) {
  const token = deviceToken || (await AsyncStorage.getItem(TOKEN_KEY).catch(() => null));
  if (!userId || !token) return;
  const work = Promise.all([
    supabase.rpc('unregister_push_token', { p_token: token }),
    supabase.from('users').update({ push_token: null }).eq('id', userId).eq('push_token', token),
  ]).then(([device, legacy]) => {
    const error = device.error || legacy.error;
    if (error) console.warn('[Push] clearPushToken failed:', error.message);
  }).catch((err) => console.warn('[Push] clearPushToken error:', err?.message ?? err));
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 2500))]);
}

// Listen for notification taps (app in background/killed)
export function setupNotificationListeners({ onNotificationTap }) {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    if (onNotificationTap) onNotificationTap(data);
  });
  return () => subscription.remove();
}
