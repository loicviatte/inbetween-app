import { useCallback, useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { AppState, Linking, Platform } from 'react-native';
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

// Where this phone stands with notifications, for a screen that offers to turn
// them on. The phone asks the person exactly once: after a refusal,
// requestPermissionsAsync() returns 'denied' without showing anything, and only
// the app's page in Settings can change it — which is how a coach can go a week
// without a single reminder reaching her and nobody, her included, knowing.
//   'granted'     — on; this phone's token is (re)sent to the server
//   'ask'         — never asked: enable() shows the system prompt
//   'settings'    — refused before: enable() opens Settings
//   'unsupported' — simulator, or the check failed
export function usePushPermission(userId) {
  const [state, setState] = useState('unsupported');
  // Once per screen is enough: the screen re-reads the permission every time
  // the app comes back to the foreground, which during a lesson is often.
  const sentRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!Device.isDevice) { setState('unsupported'); return 'unsupported'; }
    try {
      const p = await Notifications.getPermissionsAsync();
      const on = p.status === 'granted'
        || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
      if (on) {
        // Granted is not enough on its own: the server may have dropped this
        // phone's token (Expo reports a reinstalled or silenced app as gone).
        if (userId && !sentRef.current) {
          sentRef.current = true;
          registerPushToken(userId).catch(() => { sentRef.current = false; });
        }
        setState('granted');
        return 'granted';
      }
      const next = p.canAskAgain ? 'ask' : 'settings';
      setState(next);
      return next;
    } catch {
      setState('unsupported');
      return 'unsupported';
    }
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Back from Settings: read it again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); });
    return () => sub.remove();
  }, [refresh]);

  const enable = useCallback(async () => {
    if (state === 'settings') {
      Linking.openSettings().catch(() => {});
      return;
    }
    // Shows the system prompt, and on yes sends this phone's token.
    if (userId) await registerPushToken(userId).catch(() => {});
    await refresh();
  }, [state, userId, refresh]);

  return { state, enable };
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
