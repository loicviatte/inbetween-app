import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { Fonts, Spacing } from '../theme';
import { supabase } from '../services/supabase/client';
import { getChildPhones } from '../services/childPairing';

// On a parent's account, until one of their children has a phone signed in to
// their own profile, the header offers to set it up — in one of two sizes:
//   banner  a yellow line under the header, tap to go, × to put it away
//   icon    once put away, a small yellow phone beside the avatar
// A banner put away comes back after a week; put away three times in a row,
// after three weeks. Tapping it (or the icon) opens Stats ▸ Settings, and
// tapping the banner resets the count.

const KEY = '@child_phone_nudge';
const DAY = 86400000;
const GOLD_INK = '#7F5A0B';

export function useChildPhoneNudge(enabled, navigation) {
  const [kids, setKids] = useState(null);
  const [pref, setPref] = useState(null);     // { dismissedAt, streak }
  const [uid, setUid] = useState(null);

  useFocusEffect(useCallback(() => {
    if (!enabled) return undefined;
    let alive = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const id = session?.user?.id;
      if (!id) return;
      const [phones, raw] = await Promise.all([
        getChildPhones().catch(() => null),
        AsyncStorage.getItem(`${KEY}:${id}`).catch(() => null),
      ]);
      let saved = null;
      try { saved = raw ? JSON.parse(raw) : null; } catch { /* unreadable: start over */ }
      if (!alive) return;
      setUid(id); setKids(phones); setPref(saved);
    })();
    return () => { alive = false; };
  }, [enabled]));

  function save(next) {
    setPref(next);
    if (uid) AsyncStorage.setItem(`${KEY}:${uid}`, JSON.stringify(next)).catch(() => {});
  }

  // Unknown (offline) counts as linked: never nag on a guess.
  const unlinked = enabled && !!kids?.length && kids.every((k) => k.linked === false);
  let mode = null;
  if (unlinked) {
    const waitDays = (pref?.streak ?? 0) >= 3 ? 21 : 7;
    const due = !pref?.dismissedAt || Date.now() - pref.dismissedAt >= waitDays * DAY;
    mode = due ? 'banner' : 'icon';
  }
  const first = kids?.length === 1 ? (kids[0].name || '').split(/\s+/)[0] : null;
  const openSettings = () => navigation.navigate('PROFILE', { tab: 'settings' });

  return {
    mode,
    first,
    dismiss: () => save({ dismissedAt: Date.now(), streak: (pref?.streak ?? 0) + 1 }),
    openFromBanner: () => { save({ dismissedAt: pref?.dismissedAt ?? null, streak: 0 }); openSettings(); },
    openFromIcon: openSettings,
  };
}

export function ChildPhoneBanner({ nudge, style }) {
  return (
    <View style={[st.wrap, style]}>
      <TouchableOpacity
        style={st.main}
        onPress={nudge.openFromBanner}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityHint="Opens Settings, where you get a code for their phone"
      >
        <View style={st.icon}>
          <Ionicons name="phone-portrait-outline" size={16} color={GOLD_INK} />
        </View>
        {/* One line, always: a long name shrinks the text rather than wrapping it. */}
        <Text style={st.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {nudge.first ? `Tap to set up ${nudge.first}’s own phone` : 'Tap to set up your children’s own phones'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={st.close}
        onPress={nudge.dismiss}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Hide"
      >
        <Ionicons name="close" size={17} color={GOLD_INK} />
      </TouchableOpacity>
    </View>
  );
}

export function ChildPhoneHeaderIcon({ nudge }) {
  return (
    <TouchableOpacity
      style={st.headerIcon}
      onPress={nudge.openFromIcon}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={nudge.first ? `Set up ${nudge.first}’s phone` : 'Set up your children’s phones'}
    >
      <Ionicons name="phone-portrait-outline" size={17} color={GOLD_INK} />
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: Spacing.side, marginBottom: 10,
    borderRadius: 16, backgroundColor: 'rgba(232,181,48,0.16)',
    borderWidth: 1, borderColor: 'rgba(232,181,48,0.38)',
  },
  main: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingLeft: 10 },
  icon: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, minWidth: 0, fontFamily: Fonts.bold, fontSize: 14, color: '#141311' },
  close: { width: 40, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  headerIcon: {
    width: 36, height: 36, borderRadius: 11, marginRight: 9,
    backgroundColor: '#F6D27A', alignItems: 'center', justifyContent: 'center',
  },
});
