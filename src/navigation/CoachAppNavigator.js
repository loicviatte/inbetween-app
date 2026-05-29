// Coach navigator — only loaded when the resolved role is `coach`. Lives in
// its own module so a student cold start never pays for parsing the coach
// screen graph, live-activities, DJI files, useDjiAutoSync, etc.
//
// The orphan Live Activity check + upload-worker poke also live here:
// they're coach-only concerns.

import React, { useEffect, useState } from 'react';
import { View, Alert, AppState } from 'react-native';
import {
  getActiveCoachRecordings as laGetActiveCoachRecordings,
  endAllCoachRecordings as laEndAllCoachRecordings,
} from 'live-activities';
import * as Notifications from 'expo-notifications';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  getActiveCoachClass,
  patchActiveCoachClass,
} from '../storage/activeCoachClass';
import { hydrateAllFromCold } from '../storage/hydrate';
import { pokeUploadWorker } from '../services/uploadWorker';
import { CoachDataProvider } from '../context/CoachDataContext';
import CoachTabHeader from '../components/CoachTabHeader';
import CustomTabBar from '../components/CustomTabBar';
import CoachHomeScreen from '../screens/coach/CoachHomeScreen';
import DashboardScreen from '../screens/coach/DashboardScreen';
import CoachClassesScreen from '../screens/coach/CoachClassesScreen';

const Tab = createBottomTabNavigator();
const CoachStack = createNativeStackNavigator();

function CoachMainTabs() {
  const [activeRoute, setActiveRoute] = useState('DASHBOARD');
  const headerBg = activeRoute === 'DASHBOARD' ? '#F2F2EF' : '#FFFFFF';
  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <SafeAreaView style={{ backgroundColor: headerBg }} edges={['top']}>
        <CoachTabHeader />
      </SafeAreaView>
      <View style={{ flex: 1 }}>
        <Tab.Navigator
          initialRouteName="DASHBOARD"
          tabBar={(props) => <CustomTabBar {...props} />}
          screenListeners={{
            state: (e) => {
              const r = e.data?.state?.routes?.[e.data.state.index];
              if (r?.name) setActiveRoute(r.name);
            },
          }}
          screenOptions={{
            headerShown: false,
            tabBarStyle: { backgroundColor: 'transparent', borderTopWidth: 0, elevation: 0 },
          }}
        >
          <Tab.Screen name="STUDENTS" component={CoachHomeScreen} />
          <Tab.Screen name="DASHBOARD" component={DashboardScreen} />
          <Tab.Screen name="CLASS" component={CoachClassesScreen} />
        </Tab.Navigator>
      </View>
    </View>
  );
}

/** Coach-only side effects: orphan Live Activity recovery, upload worker. */
function useCoachStartupEffects(navigationRef) {
  useEffect(() => {
    let cancelled = false;
    let appStateSub = null;
    (async () => {
      // hydrateAllFromCold is a singleton promise — awaiting here is free
      // if App.js already kicked it off, but ensures the recording queue
      // is populated before we poke the upload worker.
      await hydrateAllFromCold();
      if (cancelled) return;
      pokeUploadWorker();
      appStateSub = AppState.addEventListener('change', (state) => {
        if (state === 'active') pokeUploadWorker();
      });

      if (cancelled) return;
      try {
        const ids = await laGetActiveCoachRecordings();
        if (cancelled || ids.length === 0) return;

        try { await Notifications.cancelAllScheduledNotificationsAsync(); } catch {}
        try { await Notifications.setBadgeCountAsync(0); } catch {}

        const persisted = getActiveCoachClass();
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
                  if (navigationRef?.isReady?.()) {
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
  }, [navigationRef]);
}

export default function CoachAppNavigator({ navigationRef }) {
  useCoachStartupEffects(navigationRef);
  return (
    <CoachDataProvider>
      <CoachStack.Navigator screenOptions={{ headerShown: false }}>
        <CoachStack.Screen name="CoachMainTabs" component={CoachMainTabs} />
        <CoachStack.Screen
          name="StudentDetail"
          getComponent={() => require('../screens/coach/StudentDetailScreen').default}
          options={{ animation: 'slide_from_right' }}
        />
        <CoachStack.Screen
          name="CoachSessionDetail"
          getComponent={() => require('../screens/coach/CoachSessionDetailScreen').default}
          options={{ animation: 'slide_from_right' }}
        />
        <CoachStack.Screen
          name="Notifications"
          getComponent={() => require('../screens/NotificationsScreen').default}
          options={{ animation: 'slide_from_left' }}
        />
        <CoachStack.Screen
          name="StartClass"
          getComponent={() => require('../screens/coach/StartClassScreen').default}
          options={{ animation: 'slide_from_bottom' }}
        />
        <CoachStack.Screen
          name="LocalUpload"
          getComponent={() => require('../screens/coach/LocalUploadScreen').default}
          options={{ animation: 'slide_from_right' }}
        />
        <CoachStack.Screen
          name="ActionNeeded"
          getComponent={() => require('../screens/coach/ActionNeededScreen').default}
          options={{ animation: 'slide_from_right' }}
        />
        <CoachStack.Screen
          name="FocusValidation"
          getComponent={() => require('../screens/coach/FocusValidationScreen').default}
          options={{ animation: 'slide_from_right' }}
        />
        <CoachStack.Screen
          name="NameMatchConfirm"
          getComponent={() => require('../screens/coach/NameMatchConfirmScreen').default}
          options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
        />
        <CoachStack.Screen
          name="CoachProfile"
          getComponent={() => require('../screens/coach/CoachProfileScreen').default}
          options={{ animation: 'slide_from_right' }}
        />
        <CoachStack.Screen
          name="CoachNoteDetail"
          getComponent={() => require('../screens/coach/CoachNoteDetailScreen').default}
          options={{ animation: 'slide_from_right' }}
        />
        <CoachStack.Screen
          name="CoachClassDetail"
          getComponent={() => require('../screens/coach/CoachClassDetailScreen').default}
          options={{ animation: 'slide_from_right' }}
        />
      </CoachStack.Navigator>
    </CoachDataProvider>
  );
}
