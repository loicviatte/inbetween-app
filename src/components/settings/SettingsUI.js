import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fonts } from '../../theme';

// The pieces Stats ▸ Settings is built from — section label, white card, row
// with a chevron, red log-out pill — so the coach's Settings looks the same.

export function SecLabel({ text }) {
  return (
    <View style={st.secLabel}>
      <Text style={st.secLabelText}>{text}</Text>
      <View style={st.secLabelRule} />
    </View>
  );
}

export function SettingsCard({ children }) {
  return <View style={st.card}>{children}</View>;
}

export function SettingRow({ label, value, onPress, isLast }) {
  return (
    <TouchableOpacity style={[st.row, !isLast && st.rowBorder]} onPress={onPress} activeOpacity={0.7}>
      <Text style={st.label}>{label}</Text>
      {!!value && <Text style={st.value}>{value}</Text>}
      <Ionicons name="chevron-forward" size={15} color="#767061" />
    </TouchableOpacity>
  );
}

export function LogoutButton({ onPress }) {
  return (
    <TouchableOpacity style={st.logoutBtn} onPress={onPress} activeOpacity={0.7} accessibilityRole="button">
      <Text style={st.logoutText}>Log out</Text>
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  secLabel: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, marginTop: 24, marginBottom: 10 },
  secLabelText: { fontFamily: Fonts.jakartaExtraBold, fontSize: 11.5, color: '#7F5A0B', letterSpacing: 1.6, textTransform: 'uppercase' },
  secLabelRule: { flex: 1, height: 1, backgroundColor: 'rgba(20,19,17,0.10)' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, paddingHorizontal: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingVertical: 15 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(20,19,17,0.10)' },
  label: { flexShrink: 0, fontFamily: Fonts.jakartaExtraBold, fontSize: 15.5, color: '#141311', letterSpacing: -0.16 },
  value: { flex: 1, textAlign: 'right', fontFamily: Fonts.jakartaRegular, fontSize: 13.5, lineHeight: 18, color: '#6B6656', marginRight: 6 },
  logoutBtn: {
    alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', marginTop: 22, minHeight: 44,
    paddingHorizontal: 18, backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(163,40,27,0.42)', borderRadius: 12,
  },
  logoutText: { fontFamily: Fonts.jakartaSemiBold, fontSize: 14.5, color: '#A3281B', letterSpacing: 0 },
});
