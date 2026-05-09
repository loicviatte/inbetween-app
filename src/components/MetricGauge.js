import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Fonts } from '../theme';

const TRACK = 'rgba(13,13,18,0.08)';

export default function MetricGauge({ value = 0, label }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <View style={s.row}>
      <View style={s.header}>
        <Text style={s.label}>{label}</Text>
        <Text style={s.value}>{Math.round(v)}%</Text>
      </View>
      <View style={s.track}>
        <View style={[s.fill, { width: `${v}%` }]} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'column',
    paddingVertical: 5,
    gap: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 8,
  },
  label: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 10,
    color: 'rgba(13,13,18,0.35)',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  value: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 11,
    color: 'rgba(13,13,18,0.35)',
    letterSpacing: -0.2,
  },
  track: {
    width: '100%',
    height: 3,
    backgroundColor: TRACK,
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 1.5,
    opacity: 0.3,
    backgroundColor: Colors.orange,
  },
});
