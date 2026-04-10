import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing } from '../theme';

function Bone({ width, height, radius = 8, style }) {
  return (
    <View style={[sk.bone, { width, height, borderRadius: radius }, style]} />
  );
}

export default function LogSkeleton() {
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

        {/* Tab pills */}
        <View style={sk.tabs}>
          <Bone width={80} height={34} radius={10} />
          <Bone width={80} height={34} radius={10} />
        </View>

        {/* Cards */}
        <View style={sk.list}>
          <Bone width={60} height={12} radius={4} style={{ marginBottom: 10 }} />
          {[1, 2, 3, 4].map((i) => (
            <View key={i} style={sk.card}>
              <Bone width={4} height="100%" radius={2} />
              <View style={sk.cardBody}>
                <Bone width={80} height={12} radius={4} style={{ marginBottom: 8 }} />
                <Bone width="70%" height={16} radius={4} style={{ marginBottom: 6 }} />
                <Bone width="100%" height={14} radius={4} />
              </View>
            </View>
          ))}
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
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.side,
    marginBottom: 16,
    gap: 8,
  },
  list: {
    paddingHorizontal: Spacing.side,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: 'rgba(17,12,17,0.04)',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 10,
    height: 72,
  },
  cardBody: {
    flex: 1,
    padding: 12,
    justifyContent: 'center',
  },
  bone: {
    backgroundColor: 'rgba(17,12,17,0.06)',
  },
});
