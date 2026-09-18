import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Spacing } from '../theme';
import { Pulse, Bone } from './GroupSwitchSkeleton';

// Loading state for Stats — the page's own frame (header, trend, readiness,
// momentum · streak), so the content lands without anything jumping.
// StatsBones is also what the dashboard shows while a style or scope reloads.

const DARK = '#231F18';
const ON_DARK = { backgroundColor: 'rgba(255,255,255,0.12)' };
const BARS = [0.36, 0.52, 0.3, 0.6, 0.44, 0.7, 0.5, 0.66, 0.56, 0.82];

export function StatsBones() {
  return (
    <Pulse>
      {/* Trend */}
      <View style={sk.card}>
        <Bone w={64} h={10} r={4} />
        <View style={sk.bars}>
          {BARS.map((f, i) => <Bone key={i} w={0} h={Math.round(f * 76)} r={3} style={{ flex: 1 }} />)}
        </View>
      </View>

      {/* Get ready for next private lesson */}
      <View style={sk.sect}>
        <Bone w={200} h={15} r={5} />
        <View style={sk.rule} />
      </View>
      <View style={[sk.card, sk.dark]}>
        <Bone w={130} h={10} r={4} style={ON_DARK} />
        {[0, 1, 2].map((i) => (
          <View key={i} style={[sk.frow, i > 0 && sk.frowSep]}>
            <Bone w={30} h={30} r={15} style={ON_DARK} />
            <View style={{ flex: 1, gap: 7 }}>
              <Bone w={i % 2 ? '48%' : '62%'} h={13} r={4} style={ON_DARK} />
              <Bone w="34%" h={9} r={4} style={ON_DARK} />
            </View>
            <Bone w={24} h={14} r={4} style={ON_DARK} />
          </View>
        ))}
      </View>

      {/* Momentum · Streak */}
      <View style={sk.duo}>
        {[0, 1].map((i) => (
          <View key={i} style={[sk.card, sk.duoCard]}>
            <Bone w={70} h={10} r={4} />
            <Bone w={58} h={30} r={6} style={{ marginTop: 16 }} />
            <Bone w="100%" h={6} r={3} style={{ marginTop: 16 }} />
            <Bone w="80%" h={9} r={4} style={{ marginTop: 14 }} />
          </View>
        ))}
      </View>
    </Pulse>
  );
}

export default function ProfileSkeleton() {
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
        {/* Header: bell · style + name · links / settings */}
        <Pulse style={sk.header}>
          <Bone w={36} h={36} r={11} style={sk.tile} />
          <View style={sk.headerMid}>
            <Bone w={72} h={15} r={5} />
            <Bone w={90} h={10} r={4} style={{ marginTop: 6 }} />
          </View>
          <Bone w={36} h={36} r={18} style={[sk.tile, { marginRight: 8 }]} />
          <Bone w={36} h={36} r={18} style={sk.tile} />
        </Pulse>
        <View style={sk.content}>
          <StatsBones />
        </View>
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
    paddingBottom: 14,
  },
  headerMid: { flex: 1, marginHorizontal: 11 },
  tile: { backgroundColor: '#FFFFFF' },
  content: { paddingHorizontal: Spacing.side, paddingTop: 6 },

  card: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 18, marginBottom: 12 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 76, marginTop: 16 },
  sect: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 10, paddingBottom: 12 },
  rule: { flex: 1, height: 1, backgroundColor: 'rgba(20,19,17,0.10)' },
  dark: { backgroundColor: DARK, padding: 20, paddingBottom: 6 },
  frow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16 },
  frowSep: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.09)' },
  duo: { flexDirection: 'row', gap: 12 },
  duoCard: { flex: 1, padding: 16 },
});
