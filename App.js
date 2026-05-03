import React, { useEffect, useRef, useState } from 'react';
import { View, Image, Alert, AppState } from 'react-native';
import {
  getActiveCoachRecordings as laGetActiveCoachRecordings,
  endAllCoachRecordings as laEndAllCoachRecordings,
} from 'live-activities';
import { hydrateActiveSession } from './src/storage/activeSession';
import { hydrateRecordingQueue } from './src/storage/recordingQueue';
import { pokeUploadWorker } from './src/services/uploadWorker';
import {
  hydrateActiveCoachClass,
  getActiveCoachClass,
  patchActiveCoachClass,
} from './src/storage/activeCoachClass';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  useFonts,
  PlusJakartaSans_300Light,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_800ExtraBold,
} from '@expo-google-fonts/montserrat';
import { supabase } from './src/services/supabase/client';
import { getOrCreateInviteCode } from './src/storage/coachStorage';
import { ProfileProvider } from './src/context/ProfileContext';
import { CoachDataProvider } from './src/context/CoachDataContext';
import CoachTabHeader from './src/components/CoachTabHeader';

const navigationRef = createNavigationContainerRef();

// Student screens
import HomeScreen from './src/screens/HomeScreen';
import LogScreen from './src/screens/LogScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import ClassDetailScreen from './src/screens/ClassDetailScreen';
import NoteDetailScreen from './src/screens/NoteDetailScreen';
import FocusSessionScreen from './src/screens/FocusSessionScreen';
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import AllFocusPointsScreen from './src/screens/AllFocusPointsScreen';
import CustomTabBar from './src/components/CustomTabBar';
import TrainerReviewScreen from './src/screens/TrainerReviewScreen';
import TrainerStudentsScreen from './src/screens/TrainerStudentsScreen';
import TrainerFocusHistoryScreen from './src/screens/TrainerFocusHistoryScreen';
import AttendanceConfirmScreen from './src/screens/AttendanceConfirmScreen';

// Coach screens
import CoachHomeScreen from './src/screens/coach/CoachHomeScreen';
import FocusValidationScreen from './src/screens/coach/FocusValidationScreen';
import StudentDetailScreen from './src/screens/coach/StudentDetailScreen';
import DashboardScreen from './src/screens/coach/DashboardScreen';
import CoachProfileScreen from './src/screens/coach/CoachProfileScreen';
import CoachSessionDetailScreen from './src/screens/coach/CoachSessionDetailScreen';
import NameMatchConfirmScreen from './src/screens/coach/NameMatchConfirmScreen';
import CoachNotesScreen from './src/screens/coach/CoachNotesScreen';
import CoachNoteDetailScreen from './src/screens/coach/CoachNoteDetailScreen';
import StartClassScreen from './src/screens/coach/StartClassScreen';
import ActionNeededScreen from './src/screens/coach/ActionNeededScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const AuthStack = createNativeStackNavigator();
const CoachStack = createNativeStackNavigator();
const TrainerStack = createNativeStackNavigator();

const TRAINER_EMAIL = 'loic@danceuniteduk.com';

const AppTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: '#FFFFFF' },
};

// ─── Student Navigator ────────────────────────────────────────────────────────

function MainTabs() {
  return (
    <Tab.Navigator
      initialRouteName="TRAIN"
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        lazy: false,
        tabBarStyle: { backgroundColor: 'transparent', borderTopWidth: 0, elevation: 0 },
      }}
    >
      <Tab.Screen name="PROFILE" component={ProfileScreen} />
      <Tab.Screen name="TRAIN" component={HomeScreen} />
      <Tab.Screen name="LOG" component={LogScreen} />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, detachInactiveScreens: false }}>
      <Stack.Screen name="MainTabs" component={MainTabs} />
      <Stack.Screen
        name="ClassDetail"
        component={ClassDetailScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="NoteDetail"
        component={NoteDetailScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="FocusSession"
        component={FocusSessionScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ animation: 'slide_from_left' }}
      />
      <Stack.Screen
        name="AllFocusPoints"
        component={AllFocusPointsScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="TrainerReview"
        component={TrainerReviewScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="TrainerStudents"
        component={TrainerStudentsScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="TrainerFocusHistory"
        component={TrainerFocusHistoryScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen name="AttendanceConfirm" component={AttendanceConfirmScreen} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
    </Stack.Navigator>
  );
}

// ─── Coach Navigator ──────────────────────────────────────────────────────────

function CoachMainTabs() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }} edges={['top']}>
      <CoachTabHeader />
      <Tab.Navigator
        initialRouteName="DASHBOARD"
        tabBar={(props) => <CustomTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          lazy: false,
          tabBarStyle: { backgroundColor: 'transparent', borderTopWidth: 0, elevation: 0 },
        }}
      >
        <Tab.Screen name="STUDENTS" component={CoachHomeScreen} />
        <Tab.Screen name="DASHBOARD" component={DashboardScreen} />
        <Tab.Screen name="NOTES" component={CoachNotesScreen} />
      </Tab.Navigator>
    </SafeAreaView>
  );
}

function CoachAppNavigator() {
  return (
    <CoachDataProvider>
    <CoachStack.Navigator screenOptions={{ headerShown: false }}>
      <CoachStack.Screen name="CoachMainTabs" component={CoachMainTabs} />
      <CoachStack.Screen
        name="StudentDetail"
        component={StudentDetailScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <CoachStack.Screen
        name="CoachSessionDetail"
        component={CoachSessionDetailScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <CoachStack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ animation: 'slide_from_left' }}
      />
      <CoachStack.Screen name="StartClass" component={StartClassScreen} options={{ animation: 'slide_from_bottom' }} />
      <CoachStack.Screen name="ActionNeeded" component={ActionNeededScreen} options={{ animation: 'slide_from_right' }} />
      <CoachStack.Screen name="FocusValidation" component={FocusValidationScreen} options={{ animation: 'slide_from_right' }} />
      <CoachStack.Screen name="NameMatchConfirm" component={NameMatchConfirmScreen} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <CoachStack.Screen name="CoachProfile" component={CoachProfileScreen} options={{ animation: 'slide_from_right' }} />
      <CoachStack.Screen name="CoachNoteDetail" component={CoachNoteDetailScreen} options={{ animation: 'slide_from_right' }} />
    </CoachStack.Navigator>
    </CoachDataProvider>
  );
}

// ─── Trainer Navigator ───────────────────────────────────────────────────────

function TrainerNavigator() {
  return (
    <TrainerStack.Navigator screenOptions={{ headerShown: false }}>
      <TrainerStack.Screen name="TrainerReview" component={TrainerReviewScreen} />
      <TrainerStack.Screen name="TrainerStudents" component={TrainerStudentsScreen} />
      <TrainerStack.Screen name="TrainerFocusHistory" component={TrainerFocusHistoryScreen} />
    </TrainerStack.Navigator>
  );
}

// ─── Auth Navigator ───────────────────────────────────────────────────────────

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
    </AuthStack.Navigator>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [userRole, setUserRole] = useState(null);    // null = not yet loaded
  const [userEmail, setUserEmail] = useState(null);

  // App-wide check on launch: if a coach Live Activity is still alive but
  // we have no in-memory state, the app was killed mid-recording. End the
  // orphan LA, cancel any pending kill notifications still queued, and let
  // the coach know the audio was lost.
  useEffect(() => {
    let cancelled = false;
    let appStateSub = null;
    (async () => {
      // Restore the student focus session in-memory store from disk so the
      // chrono picks up where it left off across app kills.
      await hydrateActiveSession();
      // Same for the coach's active class — we need it in memory to know
      // who was being recorded, when it started, and the LA we left behind.
      await hydrateActiveCoachClass();
      // Persistent upload queue for the new server-side recording pipeline.
      // Hydrating loads any chunks left over from a previous session (e.g.
      // app was killed mid-class) so the worker can finish them off.
      await hydrateRecordingQueue();
      pokeUploadWorker();
      // And re-poke whenever the app comes back to the foreground — that's
      // when iOS gives us network/JS time again after a lock screen pause.
      appStateSub = AppState.addEventListener('change', (state) => {
        if (state === 'active') pokeUploadWorker();
      });
      if (cancelled) return;
      try {
        const ids = await laGetActiveCoachRecordings();
        if (cancelled) return;
        if (ids.length === 0) return;

        // Cancel any pending kill notifications still queued and clear the
        // app icon badge — the coach is back in the app.
        try { await Notifications.cancelAllScheduledNotificationsAsync(); } catch {}
        try { await Notifications.setBadgeCountAsync(0); } catch {}

        const persisted = getActiveCoachClass();

        // Always end the orphan LA — we'll start a fresh one on resume.
        await laEndAllCoachRecordings();

        if (persisted) {
          Alert.alert(
            'Recording interrupted',
            'Keep the app open to continue recording the class. Tap Continue to pick up where you left off.',
            [
              {
                text: 'Continue',
                style: 'default',
                onPress: () => {
                  patchActiveCoachClass({ pendingResume: true });
                  if (navigationRef.isReady()) {
                    try { navigationRef.navigate('StartClass'); } catch {}
                  }
                },
              },
            ],
          );
        } else {
          Alert.alert(
            'Recording interrupted',
            'Your previous recording was interrupted. The class was not saved. Please start a new one.',
            [{ text: 'OK', style: 'default' }],
          );
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
      try { appStateSub?.remove?.(); } catch {}
    };
  }, []);
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_300Light,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_800ExtraBold,
  });

  async function loadRole(userId) {
    let role = null;
    // Try DB first (available after migration)
    try {
      const { data } = await supabase
        .from('users')
        .select('role')
        .eq('id', userId)
        .single();
      if (data?.role) role = data.role;
    } catch {}
    // Fallback: role stored in auth metadata at signup
    if (!role) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        role = user?.user_metadata?.role || 'student';
      } catch {
        role = 'student';
      }
    }
    setUserRole(role);
    // Ensure coach invite code exists as soon as they log in
    if (role === 'coach') {
      try { await getOrCreateInviteCode(); } catch {}
    }
  }

  // Coach-facing "action needed" notification types — tapping any of these
  // should land the coach directly on the ActionNeeded screen instead of
  // the generic Notifications list.
  const COACH_ACTION_TYPES = new Set([
    'focus_points_added',
    'focus_point_added',
    'merge_request',
    'name_match_confirm',
  ]);

  // Route a tapped push notification to the right screen, based on the
  // `type` we now stash in the push `data` payload.
  function handleNotificationTap(data) {
    if (!navigationRef.isReady()) return;
    const type = data?.type;
    if (type === 'transcript_ready') {
      // The new server-side recording pipeline emits this when a class has
      // been transcribed and a class_inputs row was created. Best UX is to
      // land the coach right on the freshly-scored class. The class_inputs
      // id is in data.class_input_id; for now we just open the coach
      // dashboard which surfaces the latest class at the top.
      navigationRef.navigate('Dashboard');
      return;
    }
    if (type && COACH_ACTION_TYPES.has(type)) {
      navigationRef.navigate('ActionNeeded');
    } else {
      navigationRef.navigate('Notifications');
    }
  }

  // Buffer for a notification that opened the app from cold launch. The
  // NavigationContainer hasn't mounted yet at that moment, so we can't
  // navigate immediately; we drain this buffer on `onReady`.
  const pendingNotifTapRef = useRef(null);

  useEffect(() => {
    // App in background — tapped notification
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (navigationRef.isReady()) {
        handleNotificationTap(data);
      } else {
        pendingNotifTapRef.current = data;
      }
    });
    // App killed — launched from notification. Buffer the data and replay
    // once the NavigationContainer is ready (handled by onReady prop on
    // <NavigationContainer>). Calling navigate() right now would silently
    // drop the deep-link.
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

  // Drain pending notification tap once navigation is ready.
  function drainPendingNotifTap() {
    const data = pendingNotifTapRef.current;
    if (!data) return;
    pendingNotifTapRef.current = null;
    handleNotificationTap(data);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s ?? null);
      setUserEmail(s?.user?.email ?? null);
      if (s?.user?.id) loadRole(s.user.id);
      else if (!s) setUserRole(null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null);
      setUserEmail(s?.user?.email ?? null);
      if (s?.user?.id) {
        loadRole(s.user.id);
      } else {
        setUserRole(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Show loading until fonts, session, and role are all resolved
  const isLoading = !fontsLoaded || session === undefined || (session !== null && userRole === null);

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

  return (
    <ProfileProvider>
      <SafeAreaProvider>
        <NavigationContainer theme={AppTheme} ref={navigationRef} onReady={drainPendingNotifTap}>
          <StatusBar style="dark" />
          {session
            ? (userEmail === TRAINER_EMAIL
                ? <TrainerNavigator />
                : userRole === 'coach'
                  ? <CoachAppNavigator />
                  : <AppNavigator />)
            : <AuthNavigator />
          }
        </NavigationContainer>
      </SafeAreaProvider>
    </ProfileProvider>
  );
}
