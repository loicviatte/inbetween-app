import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, Pressable, ScrollView, Keyboard, Dimensions,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { Fonts } from '../theme';
import { COUNTRIES, countryByIso } from '../utils/phone';

// The onboarding's field look (uppercase label, white 50pt box, gold when
// focused), shared by every screen that asks for a parent's details.

const T = {
  card: '#FFFFFF', ink: '#0A0A0A', ink2: 'rgba(10,10,10,0.65)', ink3: 'rgba(10,10,10,0.42)',
  line2: 'rgba(10,10,10,0.10)', line3: 'rgba(10,10,10,0.14)', gold: '#E8B530',
};
const haptic = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

export function TextField({ label, value, onChange, placeholder, ...rest }) {
  const [focus, setFocus] = useState(false);
  return (
    <View>
      <Text style={st.lbl}>{label}</Text>
      <View style={[st.fieldIn, focus && st.fieldOn]}>
        <TextInput style={st.input} value={value} onChangeText={onChange} placeholder={placeholder}
          placeholderTextColor={T.ink3} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} {...rest} />
      </View>
    </View>
  );
}

// A mobile number the way people know it: the country code picked from a
// dropdown, the rest typed as dialled at home (07482 552037 or 7482 552037).
const DIAL_MENU_H = 340;
export default function PhoneField({ label, country, onCountry, value, onChange }) {
  const [focus, setFocus] = useState(false);
  const [menu, setMenu] = useState(null);   // { x, width, top } in window coordinates
  const box = useRef(null);
  const c = countryByIso(country);

  function openMenu() {
    haptic();
    box.current?.measureInWindow((x, y, w, h) => {
      // Below the field when it fits above the keyboard, otherwise above it.
      const kb = Keyboard.isVisible() ? (Keyboard.metrics()?.height || 0) : 0;
      const room = Dimensions.get('window').height - kb;
      const below = y + h + 6;
      setMenu({ x, width: w, top: below + DIAL_MENU_H <= room ? below : Math.max(56, y - DIAL_MENU_H - 6) });
    });
  }

  return (
    <View>
      <Text style={st.lbl}>{label}</Text>
      <View ref={box} collapsable={false} style={[st.fieldIn, st.phoneIn, focus && st.fieldOn]}>
        <TouchableOpacity style={st.dial} onPress={openMenu} activeOpacity={0.6} accessibilityRole="button"
          accessibilityLabel={`Country code, ${c.name}, plus ${c.dial}. Change`}>
          <Text style={st.dialFlag}>{c.flag}</Text>
          <Text style={st.dialT}>+{c.dial}</Text>
          <Svg width={10} height={10} viewBox="0 0 10 10">
            <Path d="M2 3.5l3 3 3-3" stroke={T.ink2} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </TouchableOpacity>
        <View style={st.dialSep} />
        <TextInput style={[st.input, st.phoneInput]} value={value} onChangeText={onChange}
          placeholder={c.example} placeholderTextColor={T.ink3} keyboardType="phone-pad"
          textContentType="telephoneNumber" autoComplete="tel-national"
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} />
      </View>

      <Modal visible={!!menu} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setMenu(null)}>
        <Pressable style={st.dialBackdrop} onPress={() => setMenu(null)}>
          <View style={[st.dialMenu, { top: menu?.top ?? 0, left: menu?.x ?? 0, width: menu?.width ?? 280 }]}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
              {COUNTRIES.map((opt, i) => {
                const on = opt.iso === c.iso;
                return (
                  <TouchableOpacity key={opt.iso} style={[st.dialOpt, i > 0 && st.dialOptLine, on && st.dialOptOn]}
                    activeOpacity={0.6} accessibilityRole="button" accessibilityState={{ selected: on }}
                    onPress={() => { haptic(); setMenu(null); onCountry(opt.iso); }}>
                    <Text style={st.dialFlag}>{opt.flag}</Text>
                    <Text style={st.dialOptName} numberOfLines={1}>{opt.name}</Text>
                    <Text style={st.dialOptCode}>+{opt.dial}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  lbl: { marginBottom: 9, fontFamily: Fonts.medium, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: T.ink2 },
  fieldIn: { borderWidth: 1, borderColor: T.line3, borderRadius: 10, backgroundColor: T.card, height: 50, paddingHorizontal: 14, justifyContent: 'center' },
  fieldOn: { borderColor: T.gold },
  input: { fontFamily: Fonts.regular, fontSize: 15, color: T.ink, padding: 0 },
  phoneIn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', paddingLeft: 0 },
  dial: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'stretch', paddingLeft: 14, paddingRight: 10 },
  dialFlag: { fontSize: 17 },
  dialT: { fontFamily: Fonts.medium, fontSize: 15, color: T.ink },
  dialSep: { width: 1, height: 22, backgroundColor: T.line3, marginRight: 12 },
  phoneInput: { flex: 1, alignSelf: 'stretch' },
  dialBackdrop: { flex: 1 },
  dialMenu: {
    position: 'absolute', maxHeight: DIAL_MENU_H, borderRadius: 14, overflow: 'hidden',
    backgroundColor: T.card, borderWidth: 1, borderColor: T.line2,
    shadowColor: '#000', shadowOpacity: 0.16, shadowOffset: { width: 0, height: 10 }, shadowRadius: 24, elevation: 12,
  },
  dialOpt: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  dialOptLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line2 },
  dialOptOn: { backgroundColor: 'rgba(232,181,48,0.14)' },
  dialOptName: { flex: 1, fontFamily: Fonts.regular, fontSize: 14.5, color: T.ink },
  dialOptCode: { fontFamily: Fonts.medium, fontSize: 14, color: T.ink2 },
});
