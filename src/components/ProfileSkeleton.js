import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing } from '../theme';

function Bone({ width, height, radius = 8, style }) {
  return (
    <View style={[sk.bone, { width, height, borderRadius: radius }, style]} />
  );
}

export default function ProfileSkeleton() {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <SafeAreaView style={sk.safe} edges={['top']}>
      <Animated.View style={{ flex: 1, opacity: pulse }}>
        {/* Header */}
        <View style={sk.header}>
          <Bone width={36} height={36} radius={18} />
          <Bone width={36} height={36} radius={18} />
        </View>

        {/* Avatar + name */}
        <View style={sk.profile}>
          <Bone width={72} height={72} radius={36} style={{ marginBottom: 14 }} />
          <Bone width={140} height={20} radius={6} style={{ marginBottom: 6 }} />
          <Bone width={100} height={14} radius={4} />
        </View>

        {/* Stats row */}
        <View style={sk.statsRow}>
          <Bone width={0} height={60} radius={14} style={{ flex: 1 }} />
        </View>

        {/* Radar placeholder */}
        <View style={sk.radar}>
          <Bone width={180} height={180} radius={90} />
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const sk = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingTop: 16,
    paddingBottom: 14,
  },
  profile: {
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 24,
  },
  statsRow: {
    paddingHorizontal: Spacing.side,
    marginBottom: 24,
  },
  radar: {
    alignItems: 'center',
    marginTop: 10,
  },
  bone: {
    backgroundColor: 'rgba(17,12,17,0.06)',
  },
});
