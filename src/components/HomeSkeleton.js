import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Loading state for Train — same frame as the screen (header, week rail, dial,
// focus cards) so the content lands without anything jumping.
function Bone({ width, height, radius = 8, color = 'rgba(10,10,10,0.07)', style }) {
  return (
    <View
      style={[
        { width, height, borderRadius: radius, backgroundColor: color },
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

  const cardWidth = Dimensions.get('window').width - 40 - 46;
  const onDark = 'rgba(255,255,255,0.12)';

  return (
    <SafeAreaView style={sk.safe} edges={['top', 'left', 'right']}>
      <Animated.View style={{ flex: 1, opacity: pulse }}>

        {/* Header: bell · title · avatar */}
        <View style={sk.header}>
          <Bone width={36} height={36} radius={11} color="#FFFFFF" />
          <View style={sk.headerMid}>
            <Bone width={72} height={15} radius={5} />
            <Bone width={130} height={10} radius={4} style={{ marginTop: 6 }} />
          </View>
          <Bone width={36} height={36} radius={18} />
        </View>

        {/* This week rail */}
        <View style={sk.rail}>
          <View style={sk.railTop}>
            <Bone width={70} height={9} radius={3} />
            <Bone width={120} height={9} radius={3} />
          </View>
          <View style={sk.segs}>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <Bone key={i} width={0} height={3} radius={2} style={{ flex: 1 }} />
            ))}
          </View>
        </View>

        {/* Readiness dial + copy */}
        <View style={sk.head}>
          <Bone width={104} height={104} radius={52} />
          <View style={sk.headCopy}>
            <Bone width="90%" height={15} radius={5} />
            <Bone width="60%" height={15} radius={5} />
            <Bone width="75%" height={10} radius={4} />
          </View>
        </View>

        {/* Focus cards */}
        <View style={sk.label}>
          <Bone width={90} height={9} radius={3} />
        </View>
        <View style={sk.track}>
          <View style={[sk.card, { width: cardWidth }]}>
            <Bone width={96} height={9} radius={3} color={onDark} />
            <Bone width="80%" height={26} radius={6} color={onDark} style={{ marginTop: 18 }} />
            <Bone width="100%" height={12} radius={4} color={onDark} style={{ marginTop: 16 }} />
            <Bone width="100%" height={48} radius={24} color={onDark} style={{ marginTop: 'auto' }} />
          </View>
          <View style={[sk.card, { width: cardWidth }]} />
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const sk = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F2F0EB' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 6,
  },
  headerMid: { flex: 1, marginHorizontal: 11 },
  rail: { paddingTop: 15, paddingHorizontal: 20 },
  railTop: { flexDirection: 'row', justifyContent: 'space-between' },
  segs: { flexDirection: 'row', gap: 5, marginTop: 11 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingTop: 34,
    paddingHorizontal: 20,
  },
  headCopy: { flex: 1, gap: 9 },
  label: { paddingTop: 18, paddingBottom: 11, paddingHorizontal: 20 },
  track: { flexDirection: 'row', gap: 11, paddingHorizontal: 20 },
  card: {
    height: 290,
    borderRadius: 20,
    paddingVertical: 17,
    paddingHorizontal: 18,
    backgroundColor: '#0A0A0A',
  },
});
