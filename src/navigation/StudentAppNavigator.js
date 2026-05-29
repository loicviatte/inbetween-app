// Student navigator extracted from App.js so the coach + trainer modules
// stay off the cold-start critical path for student users.

import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import HomeScreen from '../screens/HomeScreen';
import LogScreen from '../screens/LogScreen';
import ProfileScreen from '../screens/ProfileScreen';
import CustomTabBar from '../components/CustomTabBar';
import { ProfileProvider } from '../context/ProfileContext';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function MainTabs() {
  const [activeRoute, setActiveRoute] = useState('TRAIN');
  return (
    <View style={{ flex: 1 }}>
      {activeRoute === 'PROFILE' && (
        <LinearGradient
          colors={['#F7F6F3', '#F4EFDC', '#F9DF9B']}
          locations={[0, 0.55, 1]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.95, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
      )}
      <Tab.Navigator
        initialRouteName="TRAIN"
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
        <Tab.Screen name="PROFILE" component={ProfileScreen} />
        <Tab.Screen name="TRAIN" component={HomeScreen} />
        <Tab.Screen name="LOG" component={LogScreen} />
      </Tab.Navigator>
    </View>
  );
}

export default function StudentAppNavigator() {
  return (
    <ProfileProvider>
      <Stack.Navigator screenOptions={{ headerShown: false, detachInactiveScreens: false }}>
        <Stack.Screen name="MainTabs" component={MainTabs} />
        <Stack.Screen
          name="ClassDetail"
          getComponent={() => require('../screens/ClassDetailScreen').default}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="NoteDetail"
          getComponent={() => require('../screens/NoteDetailScreen').default}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="FocusSession"
          getComponent={() => require('../screens/FocusSessionScreen').default}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="Notifications"
          getComponent={() => require('../screens/NotificationsScreen').default}
          options={{ animation: 'slide_from_left' }}
        />
        <Stack.Screen
          name="AllFocusPoints"
          getComponent={() => require('../screens/AllFocusPointsScreen').default}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="TrainerReview"
          getComponent={() => require('../screens/TrainerReviewScreen').default}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="TrainerStudents"
          getComponent={() => require('../screens/TrainerStudentsScreen').default}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="TrainerFocusHistory"
          getComponent={() => require('../screens/TrainerFocusHistoryScreen').default}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="AttendanceConfirm"
          getComponent={() => require('../screens/AttendanceConfirmScreen').default}
          options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
        />
      </Stack.Navigator>
    </ProfileProvider>
  );
}
