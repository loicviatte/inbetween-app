import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { Spacing } from '../theme';

function Bone({ width, height, radius = 8, style }) {
  return (
    <View style={[sk.bone, { width, height, borderRadius: radius }, style]} />
  );
}

export default function DashboardSkeleton() {
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
    <View style={sk.safe}>
      <Animated.View style={{ flex: 1, opacity: pulse }}>
        {/* Section label — matches sectionLabel in DashboardScreen
            (paddingHorizontal: Spacing.side, marginBottom: 10) */}
        <Bone
          width={70}
          height={10}
          radius={4}
          style={{ marginHorizontal: Spacing.side, marginBottom: 10 }}
        />

        {/* Student rings row */}
        <View style={sk.ringRow}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={sk.ringItem}>
              <Bone width={50} height={50} radius={25} />
              <Bone width={40} height={10} radius={4} style={{ marginTop: 6 }} />
            </View>
          ))}
        </View>

        {/* Hero dark card */}
        <View style={sk.hero}>
          <View style={sk.heroTop}>
            <Bone width={116} height={116} radius={58} style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
            <View style={{ flex: 1, gap: 10, marginLeft: 18 }}>
              <Bone width="70%" height={14} radius={4} style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
              <Bone width="55%" height={14} radius={4} style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
              <Bone width="60%" height={14} radius={4} style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
            </View>
          </View>
          <View style={sk.heroDivider} />
          <View style={sk.heroBottom}>
            <Bone width={80} height={38} radius={10} style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
            <Bone width={100} height={38} radius={12} style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
            <Bone width={54} height={38} radius={12} style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} />
          </View>
        </View>

        {/* Focus card */}
        <Bone width={160} height={10} radius={4} style={{ marginTop: 18, marginBottom: 10, marginHorizontal: Spacing.side }} />
        <View style={sk.focusCard}>
          <View style={{ flex: 1, gap: 8 }}>
            <Bone width={120} height={16} radius={4} />
            <Bone width={180} height={11} radius={4} />
          </View>
          <View style={sk.avatarStack}>
            {[0, 1, 2].map((i) => (
              <Bone key={i} width={26} height={26} radius={13} style={{ marginLeft: i === 0 ? 0 : -8 }} />
            ))}
          </View>
        </View>

        {/* Activity section */}
        <Bone width={120} height={10} radius={4} style={{ marginTop: 18, marginBottom: 10, marginHorizontal: Spacing.side }} />
        <View style={{ paddingHorizontal: Spacing.side, gap: 14 }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={sk.actRow}>
              <Bone width={18} height={18} radius={9} />
              <View style={{ flex: 1, gap: 6, marginLeft: 10 }}>
                <Bone width={60} height={10} radius={4} />
                <Bone width="75%" height={12} radius={4} />
              </View>
            </View>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

const sk = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  ringRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.side,
    gap: 10,
    marginBottom: 14,
  },
  ringItem: {
    width: 68,
    alignItems: 'center',
  },
  hero: {
    marginHorizontal: Spacing.side,
    backgroundColor: '#141414',
    borderRadius: 22,
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 16,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.10)',
    marginTop: 16,
    marginBottom: 14,
  },
  heroBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  focusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.side,
    backgroundColor: '#FFF',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bone: {
    backgroundColor: 'rgba(17,12,17,0.06)',
  },
});
