// Auth-only navigator. Onboarding is the first thing a logged-out person sees
// — it opens on its own welcome screen — so it is the eager import; Welcome
// (the previous entry) and the account screens parse lazily.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import OnboardingScreen from '../screens/OnboardingScreen';

const AuthStack = createNativeStackNavigator();

export default function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Onboarding" component={OnboardingScreen} />
      <AuthStack.Screen
        name="Login"
        getComponent={() => require('../screens/LoginScreen').default}
      />
      {/* kept registered: the form-first flow this replaced, and its welcome */}
      <AuthStack.Screen
        name="Welcome"
        getComponent={() => require('../screens/WelcomeScreen').default}
      />
      <AuthStack.Screen
        name="Register"
        getComponent={() => require('../screens/RegisterScreen').default}
      />
    </AuthStack.Navigator>
  );
}
