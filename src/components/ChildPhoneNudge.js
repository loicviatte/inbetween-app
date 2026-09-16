import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { Fonts, Spacing } from '../theme';
import { getChildPhones } from '../services/childPairing';

// Under the header on a parent's account, until one of their children has a
// phone signed in to their own profile. It opens Stats ▸ Links, where the code is.
export default function ChildPhoneNudge({ navigation }) {
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
      style={st.wrap}
      onPress={() => navigation.navigate('PROFILE', { tab: 'links' })}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityHint="Opens Links, where you get a code for their phone"
    >
      <View style={st.icon}>
        <Ionicons name="phone-portrait-outline" size={16} color="#7F5A0B" />
      </View>
      <View style={st.text}>
        <Text style={st.title} numberOfLines={2}>
          {first ? `Want ${first} to use InBetween on their phone?` : 'Want your children to use InBetween on their phones?'}
        </Text>
        <Text style={st.sub} numberOfLines={1}>A one-time code — no password to share</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#7F5A0B" />
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: Spacing.side, marginBottom: 10,
    paddingVertical: 11, paddingLeft: 12, paddingRight: 14,
    borderRadius: 16, backgroundColor: 'rgba(232,181,48,0.16)',
    borderWidth: 1, borderColor: 'rgba(232,181,48,0.38)',
  },
  icon: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0 },
  title: { fontFamily: Fonts.ttBold, fontSize: 14, lineHeight: 18, color: '#141311' },
  sub: { fontFamily: Fonts.ttRegular, fontSize: 12.5, color: '#6B6656', marginTop: 2 },
});
