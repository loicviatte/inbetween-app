import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Loading state for Lessons — same frame as the screen (header, season tiles,
// filter tabs, a month of lesson rows) so the content lands without a jump.
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
        {/* Header: bell · title · calendar · notes · avatar */}
        <View style={sk.header}>
          <Bone width={36} height={36} radius={11} />
          <View style={sk.headerMid}>
            <Bone width={72} height={15} radius={5} />
            <Bone width={120} height={10} radius={4} style={{ marginTop: 6 }} />
          </View>
          <Bone width={36} height={36} radius={11} style={{ marginRight: 9 }} />
          <Bone width={36} height={36} radius={11} style={{ marginRight: 9 }} />
          <Bone width={36} height={36} radius={18} />
        </View>

        {/* Season tiles */}
        <View style={sk.tiles}>
          {[0, 1, 2].map((i) => <View key={i} style={sk.tile} />)}
        </View>

        {/* All · Group · Private */}
        <View style={sk.tabs}>
          <Bone width={24} height={13} radius={4} />
          <Bone width={46} height={13} radius={4} />
          <Bone width={52} height={13} radius={4} />
        </View>

        {/* A month of lessons */}
        <View style={sk.list}>
          <Bone width={110} height={9} radius={3} style={{ marginBottom: 10 }} />
          <View style={sk.card}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[sk.row, i > 0 && sk.rowSep]}>
                <Bone width={36} height={36} radius={10} />
                <View style={{ flex: 1, gap: 7 }}>
                  <Bone width="78%" height={13} radius={4} />
                  <Bone width="46%" height={9} radius={3} />
                </View>
              </View>
            ))}
          </View>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const sk = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F2F0EB' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 6 },
  headerMid: { flex: 1, marginHorizontal: 11 },
  tiles: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 },
  tile: { flex: 1, height: 64, borderRadius: 13, backgroundColor: '#FFFFFF' },
  tabs: { flexDirection: 'row', gap: 22, paddingHorizontal: 20, paddingBottom: 12, marginHorizontal: 20, paddingLeft: 0, borderBottomWidth: 1, borderBottomColor: 'rgba(10,10,10,0.12)' },
  list: { paddingHorizontal: 20, paddingTop: 20 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 13, paddingHorizontal: 15 },
  rowSep: { borderTopWidth: 1, borderTopColor: 'rgba(10,10,10,0.07)' },
  bone: { backgroundColor: 'rgba(10,10,10,0.07)' },
});
