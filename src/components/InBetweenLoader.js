// InBetweenLoader — brand loader (balayage / sweep).
//
// A warm glint slides diagonally across the gold InBetween mark, clipped to the
// logo's exact silhouette by an SVG mask (so it shows ONLY on the logo, never on
// the black tile around it). Uses react-native-svg (already a dependency) — no
// native module to add, works in any build with just a Metro reload.
//
// Why not @react-native-masked-view/masked-view (what `main` uses)? Its native
// module wasn't registering in this branch's dev build (RNCMaskedView "view
// config not found" — uncatchable). SVG masking needs no extra native module.
// The sweep is JS-driven (SVG props aren't native-driver-able), which is fine
// for the ~2s launch hold; the base mark renders first so a slow frame just
// means a momentarily-still logo, never a blank/crash.

import React, { useEffect, useRef } from 'react';
import { View, Image, Animated, Easing, StyleSheet } from 'react-native';
import Svg, { Defs, Mask, Image as SvgImage, Rect, LinearGradient, Stop } from 'react-native-svg';

// The transparent gold mark — same asset as the native splash, so the native
// splash → JS loader handoff is seamless (logo stays put, then starts to glint).
const LOGO = require('../../assets/splash-icon.png');
const LOGO_URI = Image.resolveAssetSource(LOGO).uri;

const AnimatedRect = Animated.createAnimatedComponent(Rect);

export default function InBetweenLoader({ size = 120, cycle = 1600, style }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(t, {
        toValue: 1,
        duration: cycle,
        easing: Easing.inOut(Easing.ease),
        // SVG geometry isn't native-driver-able.
        useNativeDriver: false,
      })
    );
    anim.start();
    return () => anim.stop();
  }, [cycle, t]);

  // The bright diagonal band (carried by the gradient, centred in the rect)
  // travels across over the first 60% of the cycle, then pauses.
  const x = t.interpolate({
    inputRange: [0, 0.6, 1],
    outputRange: [-size, size, size],
  });

  return (
    <View style={[{ width: size, height: size }, style]}>
      {/* the mark, always visible (and the safe fallback if the glint can't draw) */}
      <Image source={LOGO} resizeMode="contain" style={{ width: size, height: size }} />

      {/* the glint, clipped to the mark's silhouette by the SVG mask */}
      <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <Mask
            id="logoMask"
            x="0"
            y="0"
            width={size}
            height={size}
            maskUnits="userSpaceOnUse"
            maskContentUnits="userSpaceOnUse"
          >
            <SvgImage
              href={{ uri: LOGO_URI }}
              x="0"
              y="0"
              width={size}
              height={size}
              preserveAspectRatio="xMidYMid meet"
            />
          </Mask>
          <LinearGradient id="glint" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFF8E6" stopOpacity="0" />
            <Stop offset="0.4" stopColor="#FFF8E6" stopOpacity="0" />
            <Stop offset="0.5" stopColor="#FFF8E6" stopOpacity="0.9" />
            <Stop offset="0.6" stopColor="#FFF8E6" stopOpacity="0" />
            <Stop offset="1" stopColor="#FFF8E6" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <AnimatedRect
          x={x}
          y="0"
          width={size}
          height={size}
          fill="url(#glint)"
          mask="url(#logoMask)"
        />
      </Svg>
    </View>
  );
}
