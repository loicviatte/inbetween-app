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
          {/* Header: bell · style + name · links / settings */}
          <View style={sk.header}>
            <Bone width={36} height={36} radius={11} />
            <View style={sk.headerMid}>
              <Bone width={72} height={15} radius={5} />
              <Bone width={90} height={10} radius={4} style={{ marginTop: 6 }} />
            </View>
            <Bone width={36} height={36} radius={18} style={{ marginRight: 8 }} />
            <Bone width={36} height={36} radius={18} />
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
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingTop: 6,
    paddingBottom: 12,
  },
  headerMid: { flex: 1, marginHorizontal: 11 },
  row: {
    paddingHorizontal: Spacing.side,
    marginTop: 14,
  },
  bone: {
    backgroundColor: 'rgba(17,12,17,0.06)',
  },
});
