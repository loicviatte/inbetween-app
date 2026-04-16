import React, { useRef, useEffect, useState, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, PanResponder } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../theme';

const TAB_COLORS = {
  PROFILE: Colors.activeHome,
  TRAIN: Colors.activeFocus,
  LOG: Colors.activeLog,
  STUDENTS: Colors.activeHome,
  SESSIONS: Colors.orange,
  DASHBOARD: Colors.activeFocus,
  NOTES: Colors.orange,
};

const HIDDEN_TABS = [];
const PADDING = 5;
const DRAG_THRESHOLD = 8;

export default function CustomTabBar({ state, navigation }) {
  const insets = useSafeAreaInsets();
  const visibleRoutes = state.routes.filter((r) => !HIDDEN_TABS.includes(r.name));
  const [containerWidth, setContainerWidth] = useState(0);
  const [dragIndex, setDragIndex] = useState(-1);

  const activeIndex = visibleRoutes.findIndex(
    (r) => r.key === state.routes[state.index]?.key
  );

  const tabCount = visibleRoutes.length;
  const pillWidth = containerWidth > 0 ? (containerWidth - PADDING * 2) / tabCount : 0;

  // Refs so PanResponder reads fresh values
  const pillWidthRef = useRef(pillWidth);
  const tabCountRef = useRef(tabCount);
  const activeIndexRef = useRef(activeIndex);
  const visibleRoutesRef = useRef(visibleRoutes);
  const navigationRef = useRef(navigation);
  pillWidthRef.current = pillWidth;
  tabCountRef.current = tabCount;
  activeIndexRef.current = activeIndex;
  visibleRoutesRef.current = visibleRoutes;
  navigationRef.current = navigation;

  const pillX = useRef(new Animated.Value(0)).current;
  const baseX = useRef(0);
  const isDragging = useRef(false);

  // Liquid glass effect values
  const grabScale = useRef(new Animated.Value(1)).current;
  const stretchX = useRef(new Animated.Value(1)).current;
  const stretchY = useRef(new Animated.Value(1)).current;
  const glassOpacity = useRef(new Animated.Value(0)).current; // 0 = solid, 1 = glass mode
  const lastVx = useRef(0);

  // Snap pill when tab changes (not dragging)
  useEffect(() => {
    if (pillWidth === 0 || isDragging.current) return;
    const target = PADDING + activeIndex * pillWidth;
    baseX.current = target;
    Animated.spring(pillX, {
      toValue: target,
      useNativeDriver: true,
      speed: 22,
      bounciness: 0,
    }).start();
  }, [activeIndex, pillWidth]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > DRAG_THRESHOLD,

    onPanResponderGrant: () => {
      isDragging.current = true;
      pillX.stopAnimation((val) => {
        baseX.current = val;
      });

      // Grab: slight scale down + switch to glass mode
      Animated.parallel([
        Animated.spring(grabScale, {
          toValue: 0.95,
          useNativeDriver: true,
          speed: 30,
          bounciness: 0,
        }),
        Animated.timing(glassOpacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    },

    onPanResponderMove: (_, gesture) => {
      const pw = pillWidthRef.current;
      const tc = tabCountRef.current;
      if (pw === 0) return;
      const minX = PADDING;
      const maxX = PADDING + (tc - 1) * pw;
      const next = Math.max(minX, Math.min(maxX, baseX.current + gesture.dx));
      pillX.setValue(next);

      // Liquid stretch based on velocity
      const vx = gesture.vx;
      lastVx.current = vx;
      const absVx = Math.min(Math.abs(vx), 3);
      const sx = 1 + absVx * 0.04;  // stretch horizontally with speed
      const sy = 1 - absVx * 0.025; // squash vertically
      stretchX.setValue(sx);
      stretchY.setValue(sy);

      const hovered = Math.round((next - PADDING) / pw);
      setDragIndex(Math.max(0, Math.min(tc - 1, hovered)));
    },

    onPanResponderRelease: (_, gesture) => {
      isDragging.current = false;
      const pw = pillWidthRef.current;
      const tc = tabCountRef.current;
      if (pw === 0) return;

      const minX = PADDING;
      const maxX = PADDING + (tc - 1) * pw;
      const released = Math.max(minX, Math.min(maxX, baseX.current + gesture.dx));

      const nearest = Math.round((released - PADDING) / pw);
      const snapped = Math.max(0, Math.min(tc - 1, nearest));
      const snapX = PADDING + snapped * pw;

      baseX.current = snapX;
      setDragIndex(-1);

      // Release: spring back to normal shape + solid mode
      Animated.parallel([
        Animated.spring(pillX, {
          toValue: snapX,
          useNativeDriver: true,
          speed: 20,
          bounciness: 8,
        }),
        Animated.spring(grabScale, {
          toValue: 1,
          useNativeDriver: true,
          speed: 14,
          bounciness: 12,
        }),
        Animated.spring(stretchX, {
          toValue: 1,
          useNativeDriver: true,
          speed: 14,
          bounciness: 14,
        }),
        Animated.spring(stretchY, {
          toValue: 1,
          useNativeDriver: true,
          speed: 14,
          bounciness: 14,
        }),
        Animated.timing(glassOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      const routes = visibleRoutesRef.current;
      const nav = navigationRef.current;
      const target = routes[snapped];
      if (target) nav.navigate(target.name);
    },

    onPanResponderTerminate: () => {
      isDragging.current = false;
      const pw = pillWidthRef.current;
      const ai = activeIndexRef.current;
      const snapX = PADDING + ai * pw;
      baseX.current = snapX;
      setDragIndex(-1);

      Animated.parallel([
        Animated.spring(pillX, { toValue: snapX, useNativeDriver: true, speed: 22, bounciness: 0 }),
        Animated.spring(grabScale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 0 }),
        Animated.spring(stretchX, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 0 }),
        Animated.spring(stretchY, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 0 }),
        Animated.timing(glassOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    },
  }), []);

  if (HIDDEN_TABS.includes(state.routes[state.index]?.name)) return null;

  // Glass opacity: 1 when dragging (frosted), 0 when idle (solid white)
  const solidOpacity = glassOpacity.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  return (
    <View style={[styles.wrapper, { paddingBottom: insets.bottom + 8 }]}>
      <View
        style={styles.container}
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
        {...panResponder.panHandlers}
      >
        {/* Sliding pill with liquid glass */}
        {containerWidth > 0 && (
          <Animated.View
            style={[
              styles.pillWrap,
              {
                width: pillWidth,
                transform: [
                  { translateX: pillX },
                  { scaleX: Animated.multiply(grabScale, stretchX) },
                  { scaleY: Animated.multiply(grabScale, stretchY) },
                ],
              },
            ]}
          >
            {/* Solid white layer — visible when not dragging */}
            <Animated.View style={[styles.pillSolid, { opacity: solidOpacity }]} />

            {/* Frosted glass layer — visible when dragging */}
            <Animated.View style={[styles.pillGlass, { opacity: glassOpacity }]}>
              <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill} />
            </Animated.View>
          </Animated.View>
        )}

        {/* Tab labels */}
        {visibleRoutes.map((route, visIdx) => {
          const routeIdx = state.routes.findIndex((r) => r.key === route.key);
          const isFocused = dragIndex >= 0 ? dragIndex === visIdx : state.index === routeIdx;
          const activeColor = TAB_COLORS[route.name] || Colors.activeHome;

          return (
            <Pressable
              key={route.key}
              style={styles.tab}
              onPress={() => navigation.navigate(route.name)}
            >
              <Text style={[styles.tabText, { color: isFocused ? activeColor : Colors.inactive }]}>
                {route.name}
              </Text>
            </Pressable>
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
    position: 'relative',
  },
  pillWrap: {
    position: 'absolute',
    top: 5,
    bottom: 5,
    borderRadius: 30,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 10,
    elevation: 4,
  },
  pillSolid: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
  },
  pillGlass: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 30,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 30,
    zIndex: 1,
  },
  tabText: {
    fontFamily: Fonts.monument,
    fontSize: 13,
    letterSpacing: 0.4,
  },
});
