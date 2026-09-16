import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Animated, Easing, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { G, Path } from 'react-native-svg';

// ─── Pull-to-refresh mark ─────────────────────────────────────────────────────
// The InBetween knot redrawn as two strokes (dark gold, light gold) along the
// centreline of assets/splash-icon.png: each is a loop, a diagonal band and the
// start of the other loop, and the light one is the dark one turned 180°.
//
//   pulling    the strokes draw themselves as the page comes down (setProgress)
//   refreshing the mark stays as a faint track while a stroke runs along each
//              half — being point-symmetric, the pair reads as the line going
//              round the knot, not the logo spinning.
//
// Geometry measured on the source image's pixels, in its 2000px space: loops
// centred (770, 1000) and (1236, 1000), centreline radius 270; the bands run
// at 38.66°, tangent to the far loop; stroke 100 wide.
const DARK = '#CC9A06';
const LIGHT = '#FFCA66';
const SW = 100;
const VIEWBOX = '420 660 1165 685';
const ASPECT = 1165 / 685;

// loop arc → band → the other loop's lower arc
const DARK_TOUR = 'M922.3 1222.9 A270 270 0 0 1 572.7 815.3 L1067.3 1210.8 A270 270 0 0 0 1348.8 1245.3';
const DARK_TIP = 'M460 725.1 L572.7 815.3';
const LIGHT_TOUR = 'M1083.7 777.1 A270 270 0 0 1 1433.3 1184.7 L938.7 789.2 A270 270 0 0 0 657.2 754.7';
const LIGHT_TIP = 'M1546 1274.9 L1433.3 1184.7';
const TOUR_LEN = 1721;
const TIP_LEN = 144.4;
// The running stroke's length, as a share of a half.
const RUN_LEN = TOUR_LEN * 0.42;

const AnimatedPath = Animated.createAnimatedComponent(Path);

function Drawn({ d, len, color, progress }) {
  return (
    <Path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={SW}
      strokeDasharray={[len, len]}
      strokeDashoffset={len * (1 - progress)}
    />
  );
}

const PullLogo = forwardRef(function PullLogo({ width = 46, refreshing = false }, ref) {
  const [progress, setProgress] = useState(0);
  const lastRef = useRef(0);
  useImperativeHandle(ref, () => ({
    setProgress: (p) => {
      const next = Math.round(Math.max(0, Math.min(1, p)) * 40) / 40; // 40 steps is smooth enough
      if (next !== lastRef.current) { lastRef.current = next; setProgress(next); }
    },
  }), []);

  const run = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!refreshing) return undefined;
    run.setValue(0);
    const loop = Animated.loop(
      Animated.timing(run, { toValue: 1, duration: 1150, easing: Easing.linear, useNativeDriver: false }),
    );
    loop.start();
    return () => loop.stop();
  }, [refreshing, run]);

  // The dash starts hidden before the path and leaves past its end.
  const offset = run.interpolate({ inputRange: [0, 1], outputRange: [RUN_LEN, -TOUR_LEN] });

  return (
    <Svg width={width} height={width / ASPECT} viewBox={VIEWBOX}>
      {refreshing ? (
        <>
          <G opacity={0.22}>
            <Path d={DARK_TOUR} fill="none" stroke={DARK} strokeWidth={SW} />
            <Path d={DARK_TIP} fill="none" stroke={DARK} strokeWidth={SW} />
            <Path d={LIGHT_TOUR} fill="none" stroke={LIGHT} strokeWidth={SW} />
            <Path d={LIGHT_TIP} fill="none" stroke={LIGHT} strokeWidth={SW} />
          </G>
          <AnimatedPath
            d={DARK_TOUR}
            fill="none"
            stroke={DARK}
            strokeWidth={SW}
            strokeDasharray={[RUN_LEN, TOUR_LEN + RUN_LEN]}
            strokeDashoffset={offset}
          />
          <AnimatedPath
            d={LIGHT_TOUR}
            fill="none"
            stroke={LIGHT}
            strokeWidth={SW}
            strokeDasharray={[RUN_LEN, TOUR_LEN + RUN_LEN]}
            strokeDashoffset={offset}
          />
        </>
      ) : progress > 0 ? (
        <>
          <Drawn d={DARK_TIP} len={TIP_LEN} color={DARK} progress={progress} />
          <Drawn d={DARK_TOUR} len={TOUR_LEN} color={DARK} progress={progress} />
          <Drawn d={LIGHT_TIP} len={TIP_LEN} color={LIGHT} progress={progress} />
          <Drawn d={LIGHT_TOUR} len={TOUR_LEN} color={LIGHT} progress={progress} />
        </>
      ) : null}
    </Svg>
  );
});

export default PullLogo;

// ─── Pull to refresh on a scrolling list (iOS) ────────────────────────────────
// The system RefreshControl can't be told to hide its spinner reliably (a
// transparent tint still shows it on the first pull), so on iOS the pull is
// read straight off the scroll: the mark follows the overscroll, releasing
// past PULL_TRIGGER refreshes, and a top content inset holds the gap open
// while it runs. Android returns no scroll props — keep the RefreshControl
// there.
//
//   const pull = usePullRefresh({ refreshing, onRefresh, scrollToTop });
//   <ScrollView {...pull.scrollProps} refreshControl={pull.ios ? undefined : …}>
//   <PullLogo ref={pull.logoRef} refreshing={refreshing} />
const PULL_TRIGGER = 64;
const PULL_HOLD = 56;

export function usePullRefresh({ refreshing, onRefresh, scrollToTop, logoRef: sharedLogoRef }) {
  const ios = Platform.OS === 'ios';
  const ownLogoRef = useRef(null);
  const logoRef = sharedLogoRef || ownLogoRef;   // a screen that also drives the mark itself shares its ref
  const armedRef = useRef(false);
  const wasRefreshingRef = useRef(refreshing);

  // Done: drop the inset (already gone this render) and glide back to the top.
  useEffect(() => {
    if (ios && wasRefreshingRef.current && !refreshing) {
      requestAnimationFrame(() => scrollToTop?.());
    }
    wasRefreshingRef.current = refreshing;
  }, [refreshing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ios) return { ios, logoRef, scrollProps: {} };

  return {
    ios,
    logoRef,
    scrollProps: {
      scrollEventThrottle: 16,
      alwaysBounceVertical: true,
      contentInset: { top: refreshing ? PULL_HOLD : 0 },
      onScroll: (e) => {
        const pulled = -e.nativeEvent.contentOffset.y;
        logoRef.current?.setProgress((pulled - 8) / (PULL_TRIGGER - 8));
        if (!armedRef.current && pulled >= PULL_TRIGGER && !refreshing) {
          armedRef.current = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        } else if (armedRef.current && pulled < PULL_TRIGGER) {
          armedRef.current = false;
        }
      },
      onScrollEndDrag: (e) => {
        armedRef.current = false;
        if (!refreshing && -e.nativeEvent.contentOffset.y >= PULL_TRIGGER) onRefresh?.();
      },
    },
  };
}
