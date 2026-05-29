// Trainer navigator gated by hardcoded email. Lazy-required from App.js
// so trainer screens never load for normal coach / student users.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

const TrainerStack = createNativeStackNavigator();

export default function TrainerNavigator() {
  return (
    <TrainerStack.Navigator screenOptions={{ headerShown: false }}>
      <TrainerStack.Screen
        name="TrainerReview"
        getComponent={() => require('../screens/TrainerReviewScreen').default}
      />
      <TrainerStack.Screen
        name="TrainerStudents"
        getComponent={() => require('../screens/TrainerStudentsScreen').default}
      />
      <TrainerStack.Screen
        name="TrainerFocusHistory"
        getComponent={() => require('../screens/TrainerFocusHistoryScreen').default}
      />
    </TrainerStack.Navigator>
  );
}
