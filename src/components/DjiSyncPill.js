// ───────────────────────────────────────────────────────────────────────
// DjiSyncPill — the compact sync-status pill that lives in the coach header
// (between the notifications button and the avatar). Four states, all driven
// by DjiSyncContext; tapping any of them opens the full-screen flow on the
// screen that matches the current phase:
//
//   🔴 SYNC FILES  — files waiting; opens Connect
//   🟠 SYNCING nn% — import running; opens Importing
//   🟢 SYNCED      — done (sticky until tapped / app restart); opens Complete
//   ⚠️ ERROR       — failed; opens the typed error screen
//
// Returns null when there's nothing to show, so the header collapses cleanly.
// ───────────────────────────────────────────────────────────────────────

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle } from 'react-native-svg';
import { Fonts } from '../theme';
import { useDjiSync } from '../context/DjiSyncContext';

const RING_C = 2 * Math.PI * 8;

const GRADIENTS = {
  'sync-files': ['#C93838', '#B22A2A'],
  syncing: ['#E8781A', '#CE5F0A'],
  done: ['#4CA356', '#388542'],
  error: ['#C93838', '#B22A2A'],
};

export default function DjiSyncPill() {
  const sync = useDjiSync();
  if (!sync) return null;

  const { pillState, progressPct, openFlow } = sync;
  if (!pillState || pillState === 'hidden') return null;

  const label =
    pillState === 'sync-files'
      ? 'SYNC FILES'
      : pillState === 'syncing'
      ? 'SYNCING'
      : pillState === 'done'
      ? 'SYNCED'
      : 'ERROR';

  const pct = Math.max(0, Math.min(100, Math.round(progressPct)));
  const dash = `${(pct / 100) * RING_C} ${RING_C}`;

  return (
    <TouchableOpacity
      style={s.wrap}
      activeOpacity={0.85}
      onPress={openFlow}
      accessibilityRole="button"
      accessibilityLabel={`DJI mic sync: ${label}`}
    >
      <LinearGradient
        colors={GRADIENTS[pillState]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={s.pill}
      >
        {pillState === 'syncing' ? (
          <View style={s.ring}>
            <Svg width={20} height={20} viewBox="0 0 20 20" style={{ transform: [{ rotate: '-90deg' }] }}>
              <Circle cx="10" cy="10" r="8" stroke="rgba(255,255,255,0.20)" strokeWidth="2.5" fill="none" />
              <Circle
                cx="10"
                cy="10"
                r="8"
                stroke="#fff"
                strokeWidth="2.5"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={dash}
              />
            </Svg>
            <Text style={s.ringPct}>{pct}</Text>
          </View>
        ) : (
          <View style={s.ic}>
            <Ionicons
              name={
                pillState === 'sync-files'
                  ? 'arrow-up'
                  : pillState === 'done'
                  ? 'checkmark'
                  : 'alert'
              }
              size={12}
              color="#fff"
            />
          </View>
        )}
        <Text style={s.lbl} numberOfLines={1}>
          {label}
        </Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', marginHorizontal: 10 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingLeft: 6,
    paddingRight: 12,
    borderRadius: 999,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  ic: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  ringPct: {
    position: 'absolute',
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 7.5,
    color: '#fff',
    includeFontPadding: false,
  },
  lbl: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: '#fff',
  },
});
