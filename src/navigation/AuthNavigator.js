// Auth-only navigator. Tiny on purpose — sits between cold start and a
// signed-in user so it must mount instantly. Welcome is the only eager
// import; Login and Register parse lazily when navigated to.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import WelcomeScreen from '../screens/WelcomeScreen';

const AuthStack = createNativeStackNavigator();

export default function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Welcome" component={WelcomeScreen} />
      <AuthStack.Screen
        name="Login"
        getComponent={() => require('../screens/LoginScreen').default}
      />
      <AuthStack.Screen
        name="Register"
        getComponent={() => require('../screens/RegisterScreen').default}
      />
    </AuthStack.Navigator>
  );
}
