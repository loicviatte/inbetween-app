import { useRef, useState } from 'react';
import { Animated, PanResponder } from 'react-native';
import * as Haptics from 'expo-haptics';

// Pull a fixed (non-scrolling) part of a page down to refresh, as on Train:
// the page follows the finger with some give, the InBetween mark draws itself
// (logoRef → PullLogo.setProgress), a haptic marks the trigger, and on release
// the page rests open while onRefresh runs, the line turning round the mark.
//
// Spread panHandlers on the area that starts the pull, translate the page by
// pullY, and put <PullLogo ref={logoRef} refreshing={refreshing} /> behind it
// in a view styled with logoOpacity.
export const PULL_TRIGGER = 64;
export const PULL_REST = 52;
const damp = (dy) => Math.min(Math.max(0, dy) * 0.5, 120);

export default function usePullDown(onRefresh) {
  const [refreshing, setRefreshing] = useState(false);
  const pullY = useRef(new Animated.Value(0)).current;
  const logoRef = useRef(null);
  const state = useRef({ busy: false, armed: false, onRefresh });
  state.current.onRefresh = onRefresh;

  const settle = () => Animated.spring(pullY, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 18 })
    .start(() => logoRef.current?.setProgress(0));

  const responder = useRef(PanResponder.create({
    // Capture: a pull that starts on a title, a chip or a button is still a pull.
    onMoveShouldSetPanResponderCapture: (_, g) => !state.current.busy && g.dy > 10 && g.dy > Math.abs(g.dx) * 1.5,
    onPanResponderMove: (_, g) => {
      const y = damp(g.dy);
      pullY.setValue(y);
      logoRef.current?.setProgress(y / PULL_TRIGGER);
      const p = state.current;
      if (!p.armed && y >= PULL_TRIGGER) {
        p.armed = true;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      } else if (p.armed && y < PULL_TRIGGER) {
        p.armed = false;
      }
    },
    onPanResponderRelease: (_, g) => {
      const p = state.current;
      p.armed = false;
      if (damp(g.dy) < PULL_TRIGGER) return settle();
      p.busy = true;
      setRefreshing(true);
      Animated.spring(pullY, { toValue: PULL_REST, useNativeDriver: true, bounciness: 0, speed: 18 }).start();
      Promise.resolve(p.onRefresh?.()).catch(() => {}).finally(() => {
        setRefreshing(false);
        Animated.timing(pullY, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
          p.busy = false;
          logoRef.current?.setProgress(0);
        });
      });
    },
    onPanResponderTerminate: () => { state.current.armed = false; settle(); },
    onPanResponderTerminationRequest: () => false,
  })).current;

  const logoOpacity = pullY.interpolate({ inputRange: [0, 6], outputRange: [0, 1], extrapolate: 'clamp' });
  return { pullY, logoRef, refreshing, panHandlers: responder.panHandlers, logoOpacity };
}
