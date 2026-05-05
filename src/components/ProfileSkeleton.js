import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
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
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={['#F7F6F3', '#F4EFDC', '#F9DF9B']}
        locations={[0, 0.55, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.95, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <SafeAreaView style={sk.safe} edges={['top']}>
        <Animated.View style={{ flex: 1, opacity: pulse }}>
          {/* Header */}
          <View style={sk.header}>
            <Bone width={44} height={44} radius={14} />
            <Bone width={56} height={32} radius={16} />
          </View>

          {/* Avatar + name */}
          <View style={sk.profile}>
            <Bone width={88} height={88} radius={44} style={{ marginBottom: 10 }} />
            <Bone width={160} height={26} radius={6} style={{ marginBottom: 6 }} />
            <Bone width={180} height={14} radius={4} />
          </View>

          {/* Glance card */}
          <View style={sk.row}>
            <Bone width={0} height={120} radius={18} style={{ flex: 1 }} />
          </View>

          {/* Readiness card */}
          <View style={sk.row}>
            <Bone width={0} height={170} radius={20} style={{ flex: 1 }} />
          </View>

          {/* Strengths card */}
          <View style={sk.row}>
            <Bone width={0} height={260} radius={20} style={{ flex: 1 }} />
          </View>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const sk = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingTop: 16,
    paddingBottom: 12,
  },
  profile: {
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  row: {
    paddingHorizontal: Spacing.side,
    marginTop: 14,
  },
  bone: {
    backgroundColor: 'rgba(17,12,17,0.06)',
  },
});
