import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../theme';

const TAB_COLORS = {
  HOME: Colors.activeHome,
  FOCUS: Colors.activeFocus,
  LOG: Colors.activeLog,
};

const HIDDEN_TABS = ['PROFILE'];

export default function CustomTabBar({ state, navigation }) {
  const insets = useSafeAreaInsets();
  const visibleRoutes = state.routes.filter((r) => !HIDDEN_TABS.includes(r.name));

  // Don't render tab bar on hidden screens
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
              <Text
                style={[
                  styles.tabText,
                  { color: isFocused ? activeColor : Colors.inactive },
                ]}
              >
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
    paddingHorizontal: 36,
    backgroundColor: Colors.background,
  },
  container: {
    flexDirection: 'row',
    backgroundColor: Colors.tabBarBg,
    borderRadius: 16,
    padding: 4,
    height: 38,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  activeTab: {
    backgroundColor: Colors.activeTabBg,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
    elevation: 2,
  },
  tabText: {
    fontFamily: Fonts.monument,
    fontSize: 12,
    letterSpacing: 0.2,
  },
});
