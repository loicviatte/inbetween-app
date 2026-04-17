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
          backgroundColor: '#E8E8E8',
          opacity,
        },
        style,
      ]}
    />
  );
}

// ─── HomeScreen skeleton ──────────────────────────────────────────────────────

export function HomeScreenSkeleton() {
  return (
    <View style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <SkeletonBox width={32} height={20} borderRadius={4} />
        <SkeletonBox width={36} height={36} borderRadius={18} />
      </View>

      {/* Hero card */}
      <View style={s.hero}>
        <SkeletonBox width={110} height={22} borderRadius={6} style={{ marginBottom: 16 }} />
        <SkeletonBox width="80%" height={34} borderRadius={6} style={{ marginBottom: 8 }} />
        <SkeletonBox width={90} height={14} borderRadius={4} style={{ marginBottom: 18 }} />
        <SkeletonBox width="100%" height={52} borderRadius={13} />
      </View>

      {/* Divider */}
      <View style={s.orRow}>
        <View style={s.orLine} />
        <SkeletonBox width={24} height={14} borderRadius={4} />
        <View style={s.orLine} />
      </View>

      {/* Alt cards row */}
      <View style={s.altRow}>
        <SkeletonBox width={150} height={80} borderRadius={14} />
        <SkeletonBox width={150} height={80} borderRadius={14} />
        <SkeletonBox width={80} height={80} borderRadius={14} />
      </View>

      {/* Bottom dock */}
      <View style={s.dock}>
        {/* Heatmap */}
        <View style={s.heatRow}>
          {[0,1,2,3,4,5,6].map(i => (
            <SkeletonBox key={i} width={38} height={48} borderRadius={10} />
          ))}
        </View>
        {/* Stats */}
        <SkeletonBox width="100%" height={52} borderRadius={14} style={{ marginBottom: 12 }} />
        {/* Share btn */}
        <SkeletonBox width="100%" height={44} borderRadius={12} />
      </View>
    </View>
  );
}

// ─── LogScreen skeleton ───────────────────────────────────────────────────────

export function LogScreenSkeleton() {
  return (
    <View style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <SkeletonBox width={32} height={20} borderRadius={4} />
        <SkeletonBox width={34} height={34} borderRadius={17} />
      </View>

      {/* Tab switcher */}
      <View style={s.tabRow}>
        <SkeletonBox width={90} height={34} borderRadius={20} />
        <SkeletonBox width={90} height={34} borderRadius={20} />
      </View>

      {/* Cards */}
      <View style={s.cards}>
        {[0,1,2,3].map(i => (
          <View key={i} style={s.card}>
            <SkeletonBox width={3} height={52} borderRadius={2} style={{ marginRight: 12 }} />
            <View style={{ flex: 1, gap: 8 }}>
              <SkeletonBox width={80} height={12} borderRadius={4} />
              <SkeletonBox width="60%" height={16} borderRadius={4} />
              <SkeletonBox width="90%" height={12} borderRadius={4} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── CoachHomeScreen skeleton ─────────────────────────────────────────────────

export function CoachHomeScreenSkeleton() {
  return (
    <View style={s.safe}>
      {/* Header top row: logo + bell */}
      <View style={s.header}>
        <SkeletonBox width={32} height={20} borderRadius={4} />
        <SkeletonBox width={36} height={36} borderRadius={18} />
      </View>

      {/* "My Students" heading */}
      <SkeletonBox width={160} height={26} borderRadius={6} style={{ marginBottom: 24 }} />

      {/* Student cards */}
      {[0,1,2,3].map(i => (
        <View key={i} style={s.studentCard}>
          <SkeletonBox width={40} height={40} borderRadius={20} />
          <View style={{ flex: 1, gap: 7 }}>
            <SkeletonBox width="55%" height={14} borderRadius={4} />
            <SkeletonBox width="75%" height={11} borderRadius={4} />
          </View>
          <SkeletonBox width={18} height={18} borderRadius={9} />
        </View>
      ))}
    </View>
  );
}

// ─── SessionsFeedScreen skeleton ─────────────────────────────────────────────

export function SessionsFeedScreenSkeleton() {
  return (
    <View style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <SkeletonBox width={32} height={20} borderRadius={4} />
      </View>

      {/* "Recent" heading */}
      <SkeletonBox width={100} height={26} borderRadius={6} style={{ marginBottom: 24 }} />

      {/* Day label */}
      <SkeletonBox width={60} height={11} borderRadius={4} style={{ marginBottom: 12 }} />

      {/* Event cards */}
      {[0,1,2,3,4].map(i => (
        <View key={i} style={s.eventCard}>
          <View style={{ flex: 1, gap: 7 }}>
            <SkeletonBox width="45%" height={13} borderRadius={4} />
            <SkeletonBox width="65%" height={11} borderRadius={4} />
          </View>
          <SkeletonBox width={44} height={11} borderRadius={4} />
        </View>
      ))}
    </View>
  );
}

// ─── CoachProfileScreen skeleton ─────────────────────────────────────────────

export function CoachProfileScreenSkeleton() {
  return (
    <View style={s.safe}>
      {/* Header: logo + edit */}
      <View style={s.header}>
        <SkeletonBox width={32} height={20} borderRadius={4} />
        <SkeletonBox width={36} height={16} borderRadius={4} />
      </View>

      {/* Avatar + name + role */}
      <View style={s.avatarSection}>
        <SkeletonBox width={80} height={80} borderRadius={40} style={{ marginBottom: 14 }} />
        <SkeletonBox width={130} height={18} borderRadius={5} style={{ marginBottom: 8 }} />
        <SkeletonBox width={60} height={12} borderRadius={4} style={{ marginBottom: 6 }} />
        <SkeletonBox width={100} height={11} borderRadius={4} />
      </View>

      {/* Stat card */}
      <View style={s.statCard}>
        <View style={{ alignItems: 'center', gap: 6 }}>
          <SkeletonBox width={40} height={28} borderRadius={5} />
          <SkeletonBox width={60} height={11} borderRadius={4} />
        </View>
      </View>

      {/* Section label */}
      <SkeletonBox width={110} height={11} borderRadius={4} style={{ marginBottom: 12 }} />

      {/* Invite card */}
      <View style={s.inviteCard}>
        <View style={{ flex: 1, gap: 8 }}>
          <SkeletonBox width={120} height={22} borderRadius={5} />
          <SkeletonBox width="90%" height={11} borderRadius={4} />
          <SkeletonBox width="70%" height={11} borderRadius={4} />
        </View>
        <SkeletonBox width={64} height={40} borderRadius={10} />
      </View>
    </View>
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
  hero: {
    backgroundColor: '#F2F2F2',
    borderRadius: 20,
    padding: 20,
    marginBottom: 12,
  },
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  orLine: { flex: 1, height: 1, backgroundColor: '#EFEFEF' },
  altRow: {
    flexDirection: 'row',
    gap: 9,
    marginBottom: 16,
  },
  dock: {
    paddingTop: 12,
    gap: 12,
  },
  heatRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 4,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  cards: {
    paddingHorizontal: 20,
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    padding: 14,
    height: 80,
    alignItems: 'center',
  },
  studentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 8,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  statCard: {
    backgroundColor: '#F8F8F8',
    borderRadius: 4,
    paddingVertical: 18,
    paddingHorizontal: 20,
    marginBottom: 28,
    alignItems: 'center',
  },
  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F8F8',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
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
