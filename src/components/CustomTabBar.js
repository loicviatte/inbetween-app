import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../theme';

const TAB_COLORS = {
  PROFILE: Colors.activeHome,
  TRAIN: Colors.activeFocus,
  LOG: Colors.activeLog,
  // Coach tabs
  STUDENTS: Colors.activeHome,
  SESSIONS: Colors.orange,
};

const HIDDEN_TABS = [];

export default function CustomTabBar({ state, navigation }) {
  const insets = useSafeAreaInsets();
  const visibleRoutes = state.routes.filter((r) => !HIDDEN_TABS.includes(r.name));

  if (HIDDEN_TABS.includes(state.routes[state.index]?.name)) return null;

  return (
    <View style={[styles.wrapper, { paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.container}>
        {visibleRoutes.map((route) => {
          const index = state.routes.findIndex((r) => r.key === route.key);
          const isFocused = state.index === index;
          const activeColor = TAB_COLORS[route.name] || Colors.activeHome;

          return (
            <TouchableOpacity
              key={route.key}
              style={[styles.tab, isFocused && styles.activeTab]}
              onPress={() => navigation.navigate(route.name)}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, { color: isFocused ? activeColor : Colors.inactive }]}>
                {route.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 20,
    backgroundColor: 'transparent',
  },
  container: {
    flexDirection: 'row',
    backgroundColor: 'rgba(116,116,128,0.10)',
    borderRadius: 36,
    padding: 5,
    height: 58,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 30,
  },
  activeTab: {
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 3,
  },
  tabText: {
    fontFamily: Fonts.monument,
    fontSize: 13,
    letterSpacing: 0.4,
  },
});
