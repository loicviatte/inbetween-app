// Switching Latin group ↔ Ballroom group (coach Home and Students): what the
// group changes shows as pulsing bones for about a second, and until the new
// group's readiness is in, then fades back in — instead of the numbers jumping.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';

const BONE = 'rgba(10,10,10,0.08)';

// True from the render the group changes: for `min` ms at least, and until
// `ready` — never longer than `cap` ms, so a failed load can't hold it.
export function useGroupSwitch(group, ready, { min = 1000, cap = 6000 } = {}) {
  const prev = useRef(group);
  const [minWait, setMinWait] = useState(false);
  const [dataWait, setDataWait] = useState(false);
  const changed = prev.current !== group;

  useEffect(() => {
    if (prev.current === group) return;
    prev.current = group;
    setMinWait(true);
    setDataWait(true);
    const a = setTimeout(() => setMinWait(false), min);
    const b = setTimeout(() => setDataWait(false), cap);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [group, min, cap]);

  useEffect(() => { if (ready) setDataWait(false); }, [ready]);

  return changed || minWait || (dataWait && !ready);
}

export function Pulse({ children, style }) {
  const v = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const ease = Easing.inOut(Easing.quad);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 650, easing: ease, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.55, duration: 650, easing: ease, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[style, { opacity: v }]}>{children}</Animated.View>;
}

export function Bone({ w, h, r = 5, style }) {
  return <View style={[{ width: w, height: h, borderRadius: r, backgroundColor: BONE }, style]} />;
}

// What the bones give way to arrives with a short fade, not a snap.
export function FadeIn({ children, style }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [v]);
  return <Animated.View style={[style, { opacity: v }]}>{children}</Animated.View>;
}
