import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
import CustomTabBar from './src/components/CustomTabBar';

// Coach screens
import CoachHomeScreen from './src/screens/coach/CoachHomeScreen';
import StudentDetailScreen from './src/screens/coach/StudentDetailScreen';
import SessionsFeedScreen from './src/screens/coach/SessionsFeedScreen';
import CoachProfileScreen from './src/screens/coach/CoachProfileScreen';
import CoachSessionDetailScreen from './src/screens/coach/CoachSessionDetailScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const AuthStack = createNativeStackNavigator();
const CoachStack = createNativeStackNavigator();

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
    <Stack.Navigator screenOptions={{ headerShown: false }}>
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
    </Stack.Navigator>
  );
}

// ─── Coach Navigator ──────────────────────────────────────────────────────────

function CoachMainTabs() {
  return (
    <Tab.Navigator
      initialRouteName="STUDENTS"
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: 'transparent', borderTopWidth: 0, elevation: 0 },
      }}
    >
      <Tab.Screen name="STUDENTS" component={CoachHomeScreen} />
      <Tab.Screen name="SESSIONS" component={SessionsFeedScreen} />
      <Tab.Screen name="PROFILE" component={CoachProfileScreen} />
    </Tab.Navigator>
  );
}

function CoachAppNavigator() {
  return (
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
    </CoachStack.Navigator>
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s ?? null);
      if (s?.user?.id) loadRole(s.user.id);
      else if (!s) setUserRole(null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null);
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
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' }}>
        {fontsLoaded && (
          <Text style={{ fontFamily: 'Montserrat_800ExtraBold', fontSize: 20, color: '#0D0D12', letterSpacing: 1 }}>EE</Text>
        )}
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={AppTheme}>
        <StatusBar style="dark" />
        {session
          ? (userRole === 'coach' ? <CoachAppNavigator /> : <AppNavigator />)
          : <AuthNavigator />
        }
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
