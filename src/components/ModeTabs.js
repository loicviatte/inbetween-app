import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Fonts } from '../theme';

// Solo | Couple tabs, shared by Train and Stats: an underline in the side's own
// colour — gold for Solo, blue for Couple.
export const SOLO_GOLD = '#E8B530';
export const COUPLE_BLUE = '#3C66AE';

const TABS = [
  { key: 'solo', label: 'Solo', color: SOLO_GOLD },
  { key: 'couple', label: 'Couple', color: COUPLE_BLUE },
];

export default function ModeTabs({ mode, onChange, disabled, style }) {
  return (
    <View style={[md.row, style]} accessibilityRole="tablist">
      {TABS.map(({ key, label, color }) => {
        const on = mode === key;
        return (
          <TouchableOpacity
            key={key}
            style={[md.tab, on && { borderBottomColor: color }]}
            onPress={() => onChange(key)}
            disabled={disabled}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Text style={[md.label, on && md.labelOn]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const md = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 24, borderBottomWidth: 1, borderBottomColor: 'rgba(10,10,10,0.12)' },
  tab: { paddingBottom: 9, marginBottom: -1, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  label: { fontFamily: Fonts.semiBold, fontSize: 17, letterSpacing: -0.34, color: 'rgba(10,10,10,0.65)' },
  labelOn: { color: '#0A0A0A' },
});
