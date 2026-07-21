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
import { View, AppState, StyleSheet, Animated, Platform } from 'react-native';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { registerPushToken } from './src/services/notifications';
import { useFonts } from 'expo-font';
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
import { isFirstScreenReady, onFirstScreenReady } from './src/utils/firstPaint';
import InBetweenLoader from './src/components/InBetweenLoader';
import RootErrorBoundary from './src/components/RootErrorBoundary';

const navigationRef = createNavigationContainerRef();

// Android: hold the native splash on screen until the JS logo loader paints, so
// the static splash logo hands off seamlessly to the shimmering InBetweenLoader
// (kills the flash/gap between the two). NOT on iOS — SplashScreen.hideAsync
// from JS crashes iOS 26 + iPhone 17 Pro in distribution builds
// (facebook/react-native#53960), so iOS keeps the default auto-hide behaviour.
if (Platform.OS === 'android') {
  SplashScreen.preventAutoHideAsync().catch(() => {});
}

// Brand logo on the cold-start background. Same visual whether shown alone
// (while session/role resolve) or as the overlay (while the first page loads),
// so the logo stays put across the whole launch instead of swapping/flashing.
function LogoLoader() {
  return (
    <View style={styles.loader}>
      <InBetweenLoader size={200} />
    </View>
  );
}

// Sits on TOP of the (already mounted, still-loading) navigator and fades out
// the moment the first screen signals it has painted — so a kill→reopen shows
// the logo continuously until real content is ready. Never mounts on a warm
// start (firstScreenReady already true) or when there's no signalling screen.
function ColdStartOverlay({ done }) {
  const [mounted, setMounted] = useState(!done);
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!done || !mounted) return;
    Animated.timing(opacity, { toValue: 0, duration: 280, useNativeDriver: true })
      .start(() => setMounted(false));
  }, [done, mounted, opacity]);
  if (!mounted) return null;
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.loader, { opacity }]}
      pointerEvents={done ? 'none' : 'auto'}
    >
      <InBetweenLoader size={200} />
    </Animated.View>
  );
}

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
    // Recipient may be a coach or a student (separate navigators, and there is
    // no 'Dashboard' route in either — the old target was a dead no-op). Land on
    // the Notifications list, which is registered in both navigators.
    navigationRef.navigate('Notifications');
    return;
  }
  if (type === 'sync_reminder') {
    // Coach-only nudge → the full-screen evening reminder, which names the
    // classes and leads straight into the mic import. Required lazily: this
    // file is the cold-start critical path, and the module is only ever
    // needed once a reminder is actually tapped. The bus latches the request
    // when the tap cold-starts the app (DjiSyncProvider subscribes later).
    require('./src/services/syncReminder').requestReminderOpen();
    return;
  }
  if (type === 'coach_request_received') {
    // Carry the request id so the Students screen pops an Accept/Decline modal
    // right away (payload uses snake_case; older pushes used camelCase).
    navigationRef.navigate('CoachMainTabs', {
      screen: 'STUDENTS',
      params: {
        coachRequestId: data.request_id || data.requestId || null,
        coachRequestStudentId: data.student_id || data.studentId || null,
      },
    });
    return;
  }
  // Partner-linking notifications (dancer↔dancer) → Profile ▸ Links, where the
  // partnership row + handshake lives. These only ever target students.
  if (type === 'couple_request_received' || type === 'couple_request_accepted' || type === 'couple_paired') {
    navigationRef.navigate('MainTabs', { screen: 'PROFILE', params: { tab: 'links' } });
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
  // Cold-start: hold the logo until the first screen has painted (Home /
  // Dashboard call markFirstScreenReady). The 6s timeout is a pure hang-guard —
  // a wired screen normally signals well before it.
  const [firstReady, setFirstReady] = useState(isFirstScreenReady());
  // Android: React has now committed its first frame (the logo loader / cold-start
  // overlay is on screen), so drop the native splash we held at module load. The
  // handoff is invisible — both draw the same gold mark on the same black bg. On
  // iOS this is a no-op (we never held the splash there — see top-of-file guard).
  useEffect(() => {
    if (Platform.OS === 'android') SplashScreen.hideAsync().catch(() => {});
  }, []);
  useEffect(() => {
    if (firstReady) return;
    const off = onFirstScreenReady(() => setFirstReady(true));
    const t = setTimeout(() => setFirstReady(true), 6000);
    return () => { off(); clearTimeout(t); };
  }, []);
  // Minimum on-screen time for the cold-start logo, counted from launch. With a
  // warm cache the first screen is ready in ~100ms, which would flash the logo
  // for a fraction of a second — hold it ~2s so the brand glint actually lands.
  // Already-ready (warm foreground) → starts true so the overlay never shows.
  const [minElapsed, setMinElapsed] = useState(isFirstScreenReady());
  useEffect(() => {
    if (minElapsed) return;
    const t = setTimeout(() => setMinElapsed(true), 2000);
    return () => clearTimeout(t);
  }, []);

  // Buffer for a notification tap that arrived before the navigator was
  // mounted (cold launch via push). Drained from NavigationContainer.onReady.
  const pendingNotifTapRef = useRef(null);

  // Push-token registration lives here (not just at password login) so a session
  // restored on cold launch — or any SIGNED_IN — (re)writes users.push_token.
  // Deduped per user per app run; the rotation listener below forces a refresh.
  const currentUserIdRef = useRef(null);
  const registeredPushUsersRef = useRef(new Set());
  function maybeRegisterPush(userId) {
    if (!userId) {
      currentUserIdRef.current = null;
      return;
    }
    currentUserIdRef.current = userId;
    if (registeredPushUsersRef.current.has(userId)) return;
    registeredPushUsersRef.current.add(userId);
    registerPushToken(userId).catch(() => {}); // fire-and-forget
  }

  // TT Travels Next powers the onboarding / auth flow. In dev & production
  // builds these are embedded natively (expo-font config plugin) so they
  // paint on the first frame; in Expo Go the config-plugin fonts aren't
  // available, so we also register them at runtime. We deliberately do NOT
  // gate the first frame on this — text simply re-flows once they resolve.
  useFonts({
    'TTTravelsNextTrl-Lt': require('./assets/fonts/TTTravelsNext-Light.ttf'),
    'TTTravelsNextTrl-Rg': require('./assets/fonts/TTTravelsNext-Regular.ttf'),
    'TTTravelsNextTrl-Md': require('./assets/fonts/TTTravelsNext-Medium.ttf'),
    'TTTravelsNextTrl-DmBd': require('./assets/fonts/TTTravelsNext-DemiBold.ttf'),
    'TTTravelsNextTrl-Bd': require('./assets/fonts/TTTravelsNext-Bold.ttf'),
    'TTTravelsNextTrl-XBd': require('./assets/fonts/TTTravelsNext-ExtraBold.ttf'),
  });

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
    // Guard against a fast account switch (A signs out, B signs in): a
    // background role fetch for A can resolve AFTER B is active and clobber
    // B's navigator. currentUserIdRef is set synchronously by maybeRegisterPush
    // on each auth event (before this runs), so bail if we're no longer the
    // active user before any setUserRole / invite-code side effect.
    const uid = s.user.id;
    const stillCurrent = () => uid === currentUserIdRef.current;
    const cached = await readCachedRole(s);
    if (cached) {
      if (!stillCurrent()) return;
      setUserRole(cached);
      if (cached === 'coach') {
        try { await getOrCreateInviteCode(); } catch {}
      }
      loadFreshRole(uid).then((fresh) => {
        if (stillCurrent() && fresh && fresh !== cached) setUserRole(fresh);
      });
    } else {
      const fresh = await loadFreshRole(uid);
      if (!stillCurrent()) return;
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
      maybeRegisterPush(s?.user?.id ?? null);
      loadRoleFor(s);
      // Refresh the token in the background so the session's user_metadata
      // (esp. `role`) reflects any change made AFTER the user last signed in —
      // e.g. a student later promoted to coach. Otherwise they keep running on
      // a stale JWT (misrouted to the legacy recording flow) until a manual
      // re-login. Fires TOKEN_REFRESHED → the onAuthStateChange handler below
      // re-applies the fresh session. Non-blocking, so it never delays paint.
      if (s?.user) supabase.auth.refreshSession().catch(() => {});
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, s) => {
      await reconcileAuthUser(s?.user?.id ?? null);
      setSession(s ?? null);
      setUserEmail(s?.user?.email ?? null);
      maybeRegisterPush(s?.user?.id ?? null);
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

  // NOTE: no Notifications.addPushTokenListener here. Calling getExpoPushTokenAsync
  // (inside registerPushToken) itself fires that listener, so re-registering from
  // it creates an infinite loop. Token rotation is rare and is covered by
  // re-registering on the next SIGNED_IN + send-push nulling DeviceNotRegistered
  // tokens, so we deliberately don't listen for rotation.

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
    // Session/role not resolved yet — no navigator to mount, so the logo is all
    // there is. It carries straight over to the overlay below once we render.
    return <LogoLoader />;
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
      <RootErrorBoundary>
      <View style={{ flex: 1 }}>
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
        {/* The navigator mounts + loads underneath; the logo overlay covers it
            until the first screen paints. `!session` (logged-out → Auth) has no
            signalling screen, so it resolves done=true and never shows. The
            trainer navigator likewise has no screen that calls
            markFirstScreenReady(), so gate it on minElapsed instead of firstReady
            — otherwise the overlay blocks all taps until the 6s hang-guard. */}
        <ColdStartOverlay done={(firstReady && minElapsed) || !session || (userEmail === TRAINER_EMAIL && minElapsed)} />
      </View>
      </RootErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // Matches the native splash backgroundColor (app.json) + the splash-icon
    // mark InBetweenLoader draws, so native splash → JS loader is seamless.
    backgroundColor: '#000000',
  },
});
