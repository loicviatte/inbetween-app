import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Easing } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Fonts } from '../theme';

// A destructive action that can't happen by accident: press and keep holding
// while the button fills (3 s by default); letting go early drains it back.
// A screen reader's activate runs it directly — holding isn't possible there.

const RED = '#A3281B';

export default function HoldToConfirm({ label, holdingLabel = 'Keep holding…', busyLabel, busy = false, duration = 3000, onConfirm, disabled }) {
  const fill = useRef(new Animated.Value(0)).current;
  const [holding, setHolding] = useState(false);
  const [width, setWidth] = useState(0);
  const done = useRef(false);

  useEffect(() => { if (!busy) { done.current = false; fill.setValue(0); } }, [busy, fill]);

  function start() {
    if (disabled || busy || done.current) return;
    setHolding(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    fill.stopAnimation();
    Animated.timing(fill, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: false }).start(({ finished }) => {
      if (!finished) return;
      done.current = true;
      setHolding(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      onConfirm?.();
    });
  }

  function release() {
    if (done.current) return;
    setHolding(false);
    fill.stopAnimation();
    Animated.timing(fill, { toValue: 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }

  const text = busy ? (busyLabel || label) : holding ? holdingLabel : label;

  return (
    <Pressable
      onPressIn={start}
      onPressOut={release}
      disabled={disabled || busy}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width - 2)} // inside the 1 px border
      style={[st.btn, (disabled) && { opacity: 0.4 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={`Press and hold for ${Math.round(duration / 1000)} seconds`}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'activate' && !busy && !disabled) onConfirm?.(); }}
    >
      {/* Red text on white, and over it the red fill carrying the same text in
          white, so the label turns white exactly where the fill has reached. */}
      <View style={st.row} pointerEvents="none">
        <Text style={st.t}>{text}</Text>
      </View>
      <Animated.View
        pointerEvents="none"
        style={[st.fill, { width: busy ? width : fill.interpolate({ inputRange: [0, 1], outputRange: [0, width || 1] }) }]}
      >
        <View style={[st.row, { width }]}>
          <Text style={[st.t, { color: '#FFFFFF' }]}>{text}</Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  btn: {
    minHeight: 52, borderRadius: 14, overflow: 'hidden', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(163,40,27,0.42)', backgroundColor: '#FFFFFF',
  },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: RED, overflow: 'hidden', justifyContent: 'center' },
  row: { alignItems: 'center', justifyContent: 'center', paddingVertical: 15, paddingHorizontal: 18 },
  t: { fontFamily: Fonts.jakartaBold, fontSize: 15, color: RED },
});
