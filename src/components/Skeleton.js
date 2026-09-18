import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

export function SkeletonBox({ width, height, borderRadius = 8, style }) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: 'rgba(10,10,10,0.07)',
          opacity,
        },
        style,
      ]}
    />
  );
}

// ─── Generic list skeleton ────────────────────────────────────────────────────
// A pragmatic default: header + title + N card rows. Used wherever we
// previously showed a centered <ActivityIndicator /> for a full-screen load.
// `rows` controls how many placeholder cards to stack, `variant` tunes card
// height/rhythm for different screen types.
export function GenericListSkeleton({
  rows = 5,
  showHeader = true,
  showTitle = true,
  variant = 'list', // 'list' | 'detail'
  background = '#FFFFFF',
}) {
  const cardHeight = variant === 'detail' ? 110 : 72;
  return (
    <View style={[s.safe, { backgroundColor: background }]}>
      {showHeader && (
        <View style={s.header}>
          <SkeletonBox width={32} height={20} borderRadius={4} />
          <SkeletonBox width={36} height={36} borderRadius={12} />
        </View>
      )}

      {showTitle && (
        <SkeletonBox
          width={160}
          height={26}
          borderRadius={6}
          style={{ marginBottom: 20 }}
        />
      )}

      {Array.from({ length: rows }).map((_, i) => (
        <View
          key={i}
          style={[
            s.genericCard,
            { height: cardHeight, marginBottom: i === rows - 1 ? 0 : 10 },
          ]}
        >
          <SkeletonBox width={36} height={36} borderRadius={12} />
          <View style={{ flex: 1, gap: 8 }}>
            <SkeletonBox width="62%" height={14} borderRadius={4} />
            <SkeletonBox width="88%" height={11} borderRadius={4} />
            {variant === 'detail' && (
              <SkeletonBox width="45%" height={11} borderRadius={4} />
            )}
          </View>
          <SkeletonBox width={40} height={20} borderRadius={6} />
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  genericCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F8F8F8',
    borderRadius: 14,
    paddingHorizontal: 14,
  },
});
