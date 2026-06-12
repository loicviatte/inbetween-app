// InBetweenLoader — brand loader (balayage / sweep).
//
// A warm glint slides along the diagonal of the gold InBetween mark, clipped
// to the logo's exact shape by a MaskedView. The animation runs on the native
// driver (60fps, off the JS thread), so it's safe to show on the cold-start
// critical path.
//
// Deps: @react-native-masked-view/masked-view (native) + expo-linear-gradient.
// Should a build ever lack the masked-view native module, the sweep is caught
// and dropped, leaving the static mark — the launch screen never dies.

import React, { useEffect, useRef } from 'react';
import { View, Image, Animated, Easing, StyleSheet } from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';

// The transparent gold mark — same asset as the native splash, so the native
// splash → JS loader handoff is seamless (logo stays put, then starts to glint).
const LOGO = require('../../assets/splash-icon.png');

// Diagonal slope of the mark, measured in px (0.73 ≈ 36°).
const DIAGONAL_SLOPE = 0.73;

// Catches a render failure from MaskedView (native module absent) and renders
// the fallback instead, so the loader degrades to the static mark.
class SweepBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function InBetweenLoader({ size = 120, cycle = 1600, style }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(t, {
        toValue: 1,
        duration: cycle,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => anim.stop();
  }, [cycle, t]);

  // The glint travels in over the first 60% of the cycle, then pauses.
  const travel = size * 1.7;
  const translateX = t.interpolate({
    inputRange: [0, 0.6, 1],
    outputRange: [-travel, travel, travel],
  });
  const translateY = Animated.multiply(translateX, DIAGONAL_SLOPE);

  return (
    <View style={[{ width: size, height: size }, style]}>
      {/* the mark, always visible */}
      <Image source={LOGO} resizeMode="contain" style={{ width: size, height: size }} />

      {/* the glint, clipped to the mark's exact shape by the mask */}
      <SweepBoundary fallback={null}>
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <Image source={LOGO} resizeMode="contain" style={{ width: size, height: size }} />
          }
        >
          <Animated.View
            style={[StyleSheet.absoluteFill, { transform: [{ translateX }, { translateY }] }]}
          >
            <LinearGradient
              colors={[
                'rgba(255,248,230,0)',
                'rgba(255,248,230,0.95)',
                'rgba(255,248,230,0)',
              ]}
              locations={[0.38, 0.5, 0.62]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ width: size, height: size }}
            />
          </Animated.View>
        </MaskedView>
      </SweepBoundary>
    </View>
  );
}
