import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing } from 'react-native';

// A toggle that slides like Train's Solo ↔ Couple: the control answers the
// tap at once, the content slides out towards the side being left, swaps
// (`shown` lags `value` by the exit) and slides in from the other edge. A tap
// back mid-slide brings the content that never left back in.
//
// `right` is the right-hand option of a two-way toggle, or every option in
// order, left to right.
export default function useSlideSwap(value, right) {
  const [shown, setShown] = useState(value);
  const x = useRef(new Animated.Value(0)).current;
  const o = useRef(new Animated.Value(1)).current;
  const target = useRef(value);
  target.current = value;
  useEffect(() => {
    if (shown === value) {
      Animated.parallel([
        Animated.timing(x, { toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(o, { toValue: 1, duration: 160, useNativeDriver: true }),
      ]).start();
      return;
    }
    // A later option (to the right) pushes the content left.
    const dir = Array.isArray(right)
      ? (right.indexOf(value) > right.indexOf(shown) ? -1 : 1)
      : (value === right ? -1 : 1);
    const shift = Dimensions.get('window').width * 0.45;
    x.stopAnimation();
    o.stopAnimation();
    Animated.parallel([
      Animated.timing(x, { toValue: dir * shift, duration: 150, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(o, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (!finished) return;
      setShown(target.current);
      x.setValue(-dir * shift);
      Animated.parallel([
        Animated.timing(x, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(o, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return [shown, { opacity: o, transform: [{ translateX: x }] }];
}
