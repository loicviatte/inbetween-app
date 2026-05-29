// ─── Root app ────────────────────────────────────────────────────────────────
// Cold-start critical path. Everything imported at the top is parsed before
// the first useful frame, so we keep the eager surface tiny:
//   - React Navigation root + the auth + student navigators
//   - Supabase client + role cache helpers
//   - Batched AsyncStorage hydration
//
// Coach + trainer navigators are conditionally `require()`d inside the
// render function so their modules only parse when the role actually needs
// them. With Hermes inline-requires, an entire branch of the screen graph
// is skipped on a student cold start.

import React, { useEffect, useRef, useState } from 'react';
import { View, Image, AppState } from 'react-native';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { supabase } from './src/services/supabase/client';
import { reconcileAuthUser } from './src/storage/userCaches';
import { hydrateAllFromCold } from './src/storage/hydrate';
import { readCachedRole, loadFreshRole } from './src/services/auth/role';
import { getOrCreateInviteCode } from './src/storage/coachStorage';
import {
  trackAppOpen,
  trackAppClose,
  trackScreenView,
  resetAnalyticsUser,
} from './src/services/analytics';
import AuthNavigator from './src/navigation/AuthNavigator';
import StudentAppNavigator from './src/navigation/StudentAppNavigator';

const navigationRef = createNavigationContainerRef();

const TRAINER_EMAIL = 'loic@danceuniteduk.com';

const AppTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: '#FFFFFF' },
};

const COACH_ACTION_TYPES = new Set([
  'focus_points_added',
  'focus_point_added',
  'merge_request',
  'name_match_confirm',
]);

function handleNotificationTap(data) {
  if (!navigationRef.isReady()) return;
  const type = data?.type;
  if (type === 'transcript_ready') {
    navigationRef.navigate('Dashboard');
    return;
  }
  if (type === 'coach_request_received') {
    navigationRef.navigate('CoachMainTabs', { screen: 'STUDENTS' });
    return;
  }
  if (type && COACH_ACTION_TYPES.has(type)) {
    navigationRef.navigate('ActionNeeded');
  } else {
    navigationRef.navigate('Notifications');
  }
}

export default function App() {
  const [session, setSession] = useState(undefined);
  const [userRole, setUserRole] = useState(null);
  const [userEmail, setUserEmail] = useState(null);

  // Buffer for a notification tap that arrived before the navigator was
  // mounted (cold launch via push). Drained from NavigationContainer.onReady.
  const pendingNotifTapRef = useRef(null);

  // Kick off the batched AsyncStorage hydration. Singleton promise so any
  // coach-side useEffect that awaits it later doesn't double the IO.
  useEffect(() => {
    hydrateAllFromCold();
  }, []);

  // App-open / app-close analytics. AppState only fires on transitions —
  // the very first 'active' frame is lost without an explicit call here.
  useEffect(() => {
    trackAppOpen();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        trackAppOpen();
      } else if (state === 'background' || state === 'inactive') {
        trackAppClose();
      }
    });
    return () => sub.remove();
  }, []);

  // Role resolution with cache-first strategy. Reads session metadata +
  // AsyncStorage cache for an instant optimistic render, then verifies via
  // DB in the background and hot-swaps if it differs. Brand-new sign-ins
  // (no cache, no metadata role) await the DB so we don't flash the wrong
  // navigator on first launch.
  async function loadRoleFor(s) {
    if (!s?.user?.id) {
      setUserRole(null);
      // Drop the cached user_id so the next signed-in user doesn't inherit
      // any buffered events from the previous session.
      resetAnalyticsUser();
      return;
    }
    const cached = await readCachedRole(s);
    if (cached) {
      setUserRole(cached);
      if (cached === 'coach') {
        try { await getOrCreateInviteCode(); } catch {}
      }
      loadFreshRole(s.user.id).then((fresh) => {
        if (fresh && fresh !== cached) setUserRole(fresh);
      });
    } else {
      const fresh = await loadFreshRole(s.user.id);
      const role = fresh || 'student';
      setUserRole(role);
      if (role === 'coach') {
        try { await getOrCreateInviteCode(); } catch {}
      }
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      await reconcileAuthUser(s?.user?.id ?? null);
      setSession(s ?? null);
      setUserEmail(s?.user?.email ?? null);
      loadRoleFor(s);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, s) => {
      await reconcileAuthUser(s?.user?.id ?? null);
      setSession(s ?? null);
      setUserEmail(s?.user?.email ?? null);
      loadRoleFor(s);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (navigationRef.isReady()) {
        handleNotificationTap(data);
      } else {
        pendingNotifTapRef.current = data;
      }
    });
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data;
      if (navigationRef.isReady()) {
        handleNotificationTap(data);
      } else {
        pendingNotifTapRef.current = data;
      }
    });
    return () => sub.remove();
  }, []);

  function drainPendingNotifTap() {
    const data = pendingNotifTapRef.current;
    if (!data) return;
    pendingNotifTapRef.current = null;
    handleNotificationTap(data);
  }

  // Show loading until session + role are resolved. Fonts are embedded
  // natively (expo-font config plugin), so no fontsLoaded gate.
  const isLoading = session === undefined || (session !== null && userRole === null);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0E0E0E' }}>
        <Image
          source={require('./assets/icon.png')}
          style={{ width: 120, height: 120 }}
          resizeMode="contain"
        />
      </View>
    );
  }

  let activeNavigator;
  if (!session) {
    activeNavigator = <AuthNavigator />;
  } else if (userEmail === TRAINER_EMAIL) {
    const TrainerNavigator = require('./src/navigation/TrainerNavigator').default;
    activeNavigator = <TrainerNavigator />;
  } else if (userRole === 'coach') {
    const CoachAppNavigator = require('./src/navigation/CoachAppNavigator').default;
    activeNavigator = <CoachAppNavigator navigationRef={navigationRef} />;
  } else {
    activeNavigator = <StudentAppNavigator />;
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer
        theme={AppTheme}
        ref={navigationRef}
        onReady={() => {
          drainPendingNotifTap();
          // Capture the landing screen on cold start — onStateChange
          // doesn't fire for the initial route.
          try {
            const route = navigationRef.getCurrentRoute();
            if (route?.name) trackScreenView(route.name);
          } catch {}
        }}
        onStateChange={() => {
          try {
            const route = navigationRef.getCurrentRoute();
            if (route?.name) trackScreenView(route.name);
          } catch {}
        }}
      >
        <StatusBar style="dark" />
        {activeNavigator}
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
