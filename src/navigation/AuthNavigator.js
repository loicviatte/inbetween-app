// Auth-only navigator. Tiny on purpose — sits between cold start and a
// signed-in user so it must mount instantly.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from '../screens/LoginScreen';

const AuthStack = createNativeStackNavigator();

export default function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen
        name="Register"
        getComponent={() => require('../screens/RegisterScreen').default}
      />
    </AuthStack.Navigator>
  );
}
