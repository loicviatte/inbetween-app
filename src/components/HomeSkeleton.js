import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing } from '../theme';

function Bone({ width, height, radius = 8, style }) {
  return (
    <View
      style={[
        sk.bone,
        { width, height, borderRadius: radius },
        style,
      ]}
    />
  );
}

export default function HomeSkeleton() {
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
    <SafeAreaView style={sk.safe} edges={['top', 'left', 'right']}>
      <Animated.View style={{ flex: 1, opacity: pulse }}>

        {/* Header skeleton */}
        <View style={sk.header}>
          <Bone width={36} height={36} radius={18} />
          <Bone width={36} height={36} radius={18} />
        </View>

        <View style={sk.content}>
          {/* Hero card skeleton */}
          <View style={sk.hero}>
            <Bone width={100} height={20} radius={6} style={{ marginBottom: 14 }} />
            <Bone width="80%" height={28} radius={6} style={{ marginBottom: 8 }} />
            <Bone width={90} height={14} radius={4} style={{ marginBottom: 18 }} />
            <Bone width="100%" height={50} radius={13} />
          </View>

          {/* Or divider skeleton */}
          <View style={sk.orRow}>
            <View style={sk.orLine} />
            <Bone width={20} height={14} radius={4} />
            <View style={sk.orLine} />
          </View>

          {/* Alt cards skeleton */}
          <View style={sk.altRow}>
            <Bone width={150} height={72} radius={14} style={{ marginRight: 9 }} />
            <Bone width={150} height={72} radius={14} style={{ marginRight: 9 }} />
            <Bone width={80} height={72} radius={14} />
          </View>
        </View>

        {/* Bottom dock skeleton */}
        <View style={sk.dock}>
          {/* This Week label */}
          <View style={sk.weekLabel}>
            <Bone width={80} height={12} radius={4} />
            <View style={sk.weekLine} />
          </View>
          {/* Heatmap row */}
          <View style={sk.heatRow}>
            {[1,2,3,4,5,6,7].map((i) => (
              <Bone key={i} width={0} height={42} radius={10} style={{ flex: 1 }} />
            ))}
          </View>
          {/* Stats bar */}
          <Bone width="100%" height={52} radius={14} style={{ marginTop: 14 }} />
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
    paddingBottom: 12,
  },
  content: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 8,
  },
  hero: {
    backgroundColor: '#1C1C1E',
    borderRadius: 20,
    padding: 20,
    paddingBottom: 18,
    marginBottom: 12,
  },
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  orLine: { flex: 1, height: 1, backgroundColor: '#EFEFEF' },
  altRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  dock: {
    paddingHorizontal: Spacing.side,
    paddingTop: 14,
  },
  weekLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  weekLine: { flex: 1, height: 1, backgroundColor: '#EFEFEF' },
  heatRow: {
    flexDirection: 'row',
    gap: 6,
  },
  bone: {
    backgroundColor: 'rgba(17,12,17,0.06)',
  },
});
