import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import BottomSheet from './BottomSheet';
import { Fonts } from '../theme';

const MIC_REC_IMG = require('../../assets/dji-setup/dji_mic_2-side.png');

// Copy per mode — mirrors the design spec (coach-mic-modals).
const COPY = {
  start: {
    eyebrow: 'Before we start',
    title: 'Press REC on your mic.',
    body: ['The ', { b: 'red tally should turn on' }, ' when your DJI mic is recording.'],
    cta: 'Red tally is on',
  },
  stop: {
    eyebrow: 'Before we end',
    title: 'Press STOP on your mic.',
    body: ['The ', { b: 'red tally should turn off' }, '. That finalizes the file so we can match it when you sync.'],
    cta: 'Red tally is off',
  },
};

/**
 * MicCueSheet — the bottom sheet that gates start/stop of a local (DJI-mic)
 * class on the coach physically pressing REC / STOP on the mic. Replaces the
 * old white centered confirm cards. Non-dismissible: the coach must Cancel or
 * confirm (they can't skip past it and silently record nothing).
 *
 * Props: visible, mode ('start'|'stop'), onCancel, onConfirm.
 */
export default function MicCueSheet({ visible, mode = 'start', onCancel, onConfirm }) {
  const copy = COPY[mode] ?? COPY.start;

  // Red "tally" pulse over the mic's REC button — a steady glow + an expanding
  // ping, looping only while the sheet is on screen.
  const glow = useRef(new Animated.Value(0)).current;
  const ping = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return undefined;
    glow.setValue(0);
    ping.setValue(0);
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    const pingLoop = Animated.loop(
      Animated.timing(ping, { toValue: 1, duration: 2200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    );
    glowLoop.start();
    pingLoop.start();
    return () => {
      glowLoop.stop();
      pingLoop.stop();
    };
  }, [visible, glow, ping]);

  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const pingScale = ping.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.9] });
  const pingOpacity = ping.interpolate({ inputRange: [0, 0.85, 1], outputRange: [0.9, 0, 0] });

  return (
    <BottomSheet
      visible={visible}
      onClose={onCancel}
      dismissable={false}
      overlayColor="rgba(0,0,0,0.55)"
      sheetStyle={s.sheet}
    >
      {/* Soft gold glow rising from the bottom edge. */}
      <LinearGradient
        colors={['rgba(232,181,48,0)', 'rgba(232,181,48,0.10)']}
        style={s.glowWash}
        pointerEvents="none"
      />
      <View style={s.handle} />

      <View style={s.content}>
        <View style={s.micWrap}>
          <Image source={MIC_REC_IMG} style={s.micImg} contentFit="contain" />
          {/* Pulsing red tally over the REC button */}
          <View style={s.tally} pointerEvents="none">
            <Animated.View style={[s.tallyPing, { transform: [{ scale: pingScale }], opacity: pingOpacity }]} />
            <Animated.View style={[s.tallyRing, { opacity: glowOpacity }]} />
          </View>
        </View>

        <View style={s.body}>
          <View style={s.eyebrowRow}>
            <View style={s.eyebrowDot} />
            <Text style={s.eyebrow}>{copy.eyebrow}</Text>
          </View>
          <Text style={s.title}>{copy.title}</Text>
          <Text style={s.bodyText}>
            {copy.body.map((part, i) =>
              typeof part === 'string'
                ? part
                : <Text key={i} style={s.bodyStrong}>{part.b}</Text>,
            )}
          </Text>
        </View>
      </View>

      <View style={s.actions}>
        <TouchableOpacity style={s.cancelBtn} activeOpacity={0.85} onPress={onCancel}>
          <Text style={s.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.primaryWrap} activeOpacity={0.9} onPress={onConfirm}>
          <LinearGradient
            colors={['#F6D27A', '#E8B530', '#C8881C']}
            locations={[0, 0.55, 1]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={s.primaryBtn}
          >
            <Text style={s.primaryText}>{copy.cta}</Text>
            <Ionicons name="checkmark" size={16} color="#0A0A0A" />
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  sheet: {
    backgroundColor: '#141210',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingTop: 12,
    paddingHorizontal: 22,
    paddingBottom: 26,
    overflow: 'hidden',
  },
  glowWash: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    height: 160,
  },
  handle: {
    width: 38, height: 4,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.28)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  micWrap: {
    width: 118, height: 118,
    alignItems: 'center', justifyContent: 'center',
  },
  micImg: { width: 118, height: 118 },
  tally: {
    position: 'absolute',
    left: '50%', top: '60%',
    width: 34, height: 34,
    marginLeft: -17, marginTop: -17,
    alignItems: 'center', justifyContent: 'center',
  },
  tallyRing: {
    position: 'absolute',
    width: 34, height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: '#E85555',
    shadowColor: '#D44545',
    shadowOpacity: 0.7,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  tallyPing: {
    position: 'absolute',
    width: 34, height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: '#E85555',
  },
  body: { flex: 1, minWidth: 0 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  eyebrowDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: '#E85555',
    shadowColor: '#E85555', shadowOpacity: 0.9, shadowRadius: 5, shadowOffset: { width: 0, height: 0 },
  },
  eyebrow: {
    fontFamily: Fonts.travelsMedium,
    fontSize: 10,
    color: '#F6A0A0',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 21,
    color: '#FFFFFF',
    letterSpacing: -0.4,
    lineHeight: 24,
    marginBottom: 7,
  },
  bodyText: {
    fontFamily: Fonts.travelsRegular,
    fontSize: 12.5,
    lineHeight: 17.5,
    color: 'rgba(255,255,255,0.55)',
  },
  bodyStrong: { color: 'rgba(255,255,255,0.9)', fontFamily: Fonts.travelsMedium },
  actions: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 18,
  },
  cancelBtn: {
    paddingVertical: 15, paddingHorizontal: 22,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  cancelText: {
    fontFamily: Fonts.travelsMedium,
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  primaryWrap: { flex: 1, borderRadius: 14, overflow: 'hidden' },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 15,
  },
  primaryText: {
    fontFamily: Fonts.ttBold,
    fontSize: 12.5,
    color: '#0A0A0A',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
