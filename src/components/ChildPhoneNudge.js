import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { Fonts, Spacing } from '../theme';
import { getChildPhones } from '../services/childPairing';

// Under the header on a parent's account, until one of their children has a
// phone signed in to their own profile. It opens Stats ▸ Settings, where the code is.
export default function ChildPhoneNudge({ navigation, style }) {
  const [children, setChildren] = useState(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    getChildPhones().then((kids) => { if (alive) setChildren(kids); }).catch(() => {});
    return () => { alive = false; };
  }, []));

  // Unknown (offline) counts as linked: never nag on a guess.
  if (!children?.length || children.some((c) => c.linked !== false)) return null;

  const first = children.length === 1 ? (children[0].name || '').split(/\s+/)[0] : null;
  return (
    <TouchableOpacity
      style={[st.wrap, style]}
      onPress={() => navigation.navigate('PROFILE', { tab: 'settings' })}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityHint="Opens Settings, where you get a code for their phone"
    >
      <View style={st.icon}>
        <Ionicons name="phone-portrait-outline" size={16} color="#7F5A0B" />
      </View>
      {/* One line, always: a long name shrinks the text rather than wrapping it. */}
      <Text style={st.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {first ? `Want ${first} to use InBetween on their phone?` : 'Want your children to use InBetween on their phones?'}
      </Text>
      <Ionicons name="chevron-forward" size={16} color="#7F5A0B" />
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: Spacing.side, marginBottom: 10,
    paddingVertical: 9, paddingLeft: 10, paddingRight: 12,
    borderRadius: 16, backgroundColor: 'rgba(232,181,48,0.16)',
    borderWidth: 1, borderColor: 'rgba(232,181,48,0.38)',
  },
  icon: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, minWidth: 0, fontFamily: Fonts.ttBold, fontSize: 14, color: '#141311' },
});
