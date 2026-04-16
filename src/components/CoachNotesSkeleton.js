import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing } from '../theme';

function Bone({ width, height, radius = 8, style }) {
  return (
    <View style={[sk.bone, { width, height, borderRadius: radius }, style]} />
  );
}

export default function CoachNotesSkeleton() {
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

        {/* Hero card */}
        <View style={sk.hero}>
          <Bone width={60} height={20} radius={6} style={{ marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.08)' }} />
          <Bone width={160} height={22} radius={6} style={{ marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.08)' }} />
          <Bone width="85%" height={12} radius={4} style={{ marginBottom: 16, backgroundColor: 'rgba(255,255,255,0.08)' }} />
          <View style={sk.heroStats}>
            <Bone width={50} height={36} radius={8} style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
            <Bone width={50} height={36} radius={8} style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
            <Bone width={50} height={36} radius={8} style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
          </View>
        </View>

        {/* Search bar */}
        <Bone width="100%" height={40} radius={12} style={{ marginHorizontal: Spacing.side, marginTop: 16, marginBottom: 16, width: 'auto', marginLeft: Spacing.side, marginRight: Spacing.side }} />

        {/* Date label */}
        <Bone width={60} height={11} radius={4} style={{ marginHorizontal: Spacing.side, marginBottom: 10 }} />

        {/* Note cards */}
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={sk.noteCard}>
            <View style={{ flex: 1, gap: 8 }}>
              <Bone width="50%" height={14} radius={4} />
              <Bone width="80%" height={11} radius={4} />
              <Bone width={70} height={10} radius={4} />
            </View>
            <Bone width={28} height={28} radius={14} />
          </View>
        ))}
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
  hero: {
    marginHorizontal: Spacing.side,
    backgroundColor: '#141414',
    borderRadius: 22,
    padding: 20,
  },
  heroStats: {
    flexDirection: 'row',
    gap: 16,
  },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.side,
    backgroundColor: '#F8F8F8',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  bone: {
    backgroundColor: 'rgba(17,12,17,0.06)',
  },
});
