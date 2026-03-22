import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
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
import { seedIfNeeded } from './src/services/storage';
import HomeScreen from './src/screens/HomeScreen';
import FocusScreen from './src/screens/FocusScreen';
import LogScreen from './src/screens/LogScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import ClassDetailScreen from './src/screens/ClassDetailScreen';
import NoteDetailScreen from './src/screens/NoteDetailScreen';
import FocusSessionScreen from './src/screens/FocusSessionScreen';
import CustomTabBar from './src/components/CustomTabBar';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="HOME" component={HomeScreen} />
      <Tab.Screen name="FOCUS" component={FocusScreen} />
      <Tab.Screen name="LOG" component={LogScreen} />
      {/* PROFILE: hidden from tab bar, accessible via profile icon */}
      <Tab.Screen name="PROFILE" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
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
    // Add Monument Extended here once you have the font file:
    // 'MonumentExtended-UltraBold': require('./assets/fonts/MonumentExtended-UltraBold.otf'),
  });

  useEffect(() => {
    seedIfNeeded();
  }, []);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator color="#FF9D00" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="dark" />
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
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
