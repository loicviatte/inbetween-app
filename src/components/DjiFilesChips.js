// ─── DjiFilesChips ──────────────────────────────────────────────────────
// Crisp vector recreations of the two iOS Files elements a coach must tap
// when granting folder access to their DJI mic — the bottom "Browse" tab and
// the "NO NAME" drive row under Locations. Shared by both surfaces that show
// the grant instructions: MicSyncFlowModal (dark full-screen) and
// DjiSetupBanner (light setup wizard). A subtle border keeps the light chips
// legible on both the dark flow and the white card, and it replaces the old
// PNG screenshots which rendered blurry/mismatched.
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Path, Circle } from 'react-native-svg';
import { Fonts } from '../theme';

const IOS_BLUE = '#4187F5'; // the blue of the iOS Files "Browse" tab + NO NAME drive

export function BrowseTabChip() {
  const tabs = [
    { key: 'Recents', icon: 'time' },
    { key: 'Shared', icon: 'people' },
    { key: 'Browse', icon: 'folder', active: true },
  ];
  return (
    <View style={c.browseChip}>
      {tabs.map((t) => (
        <View key={t.key} style={[c.browseTab, t.active && c.browseTabActive]}>
          <Ionicons name={t.icon} size={16} color={t.active ? IOS_BLUE : '#1D1D1F'} />
          <Text style={[c.browseTabLabel, t.active && c.browseTabLabelActive]}>{t.key}</Text>
        </View>
      ))}
    </View>
  );
}

export function NoNameChip() {
  return (
    <View style={c.noNameChip}>
      <Svg width={27} height={20} viewBox="0 0 30 22">
        <Path
          d="M10 4 L20 4 L25.5 10 L25.5 15.5 Q25.5 17.5 23.5 17.5 L6.5 17.5 Q4.5 17.5 4.5 15.5 L4.5 10 Z"
          stroke={IOS_BLUE}
          strokeWidth="1.8"
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <Path d="M4.5 10 L25.5 10" stroke={IOS_BLUE} strokeWidth="1.8" strokeLinecap="round" />
        <Circle cx="9" cy="13.7" r="1.5" fill={IOS_BLUE} />
      </Svg>
      <Text style={c.noNameLabel}>NO NAME</Text>
      <Ionicons name="chevron-forward" size={14} color="#BFBFC4" />
    </View>
  );
}

const c = StyleSheet.create({
  browseChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#F3F3F5',
    borderRadius: 15,
    padding: 5,
    gap: 3,
    borderWidth: 1,
    borderColor: '#E6E6EA',
  },
  browseTab: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 6, borderRadius: 11 },
  browseTabActive: { backgroundColor: '#E4E6EB' },
  browseTabLabel: { fontFamily: Fonts.jakartaBold, fontSize: 9.5, color: '#1D1D1F', letterSpacing: 0.1 },
  browseTabLabelActive: { color: IOS_BLUE },
  noNameChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F3F5',
    borderRadius: 12,
    paddingVertical: 9,
    paddingLeft: 12,
    paddingRight: 11,
    gap: 9,
    minWidth: 176,
    borderWidth: 1,
    borderColor: '#E6E6EA',
  },
  noNameLabel: { flex: 1, fontFamily: Fonts.jakartaExtraBold, fontSize: 13.5, color: '#1C1C1E', letterSpacing: 0.4 },
});
