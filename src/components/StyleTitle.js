import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fonts } from '../theme';

// The title set after the bell in a tab header (Train, Stats): the dance style —
// a menu to switch it when the dancer does both — and, underneath, whose
// training it is.
const INK = '#0A0A0A';
const INK_2 = 'rgba(10,10,10,0.65)';

const STYLES = [
  { key: 'latin', label: 'Latin' },
  { key: 'ballroom', label: 'Ballroom' },
];

// options: the menu's choices, Latin and Ballroom unless a screen offers others.
export default function StyleTitle({ label, category, canSwitch, disabled, sub, onSelect, options = STYLES }) {
  const btnRef = useRef(null);
  const [menu, setMenu] = useState(null); // { x, y } in window coordinates, or null

  // The menu opens right under the title, wherever the header puts it.
  function openMenu() {
    btnRef.current?.measureInWindow((x, y, w, h) => setMenu({ x, y: y + h + 8 }));
  }

  const title = (
    <View style={st.row}>
      <Text style={st.title} numberOfLines={1}>{label}</Text>
      {canSwitch ? <Ionicons name="chevron-down" size={13} color={INK} style={st.chev} /> : null}
    </View>
  );

  return (
    <View style={st.wrap}>
      {canSwitch ? (
        <TouchableOpacity
          ref={btnRef}
          onPress={openMenu}
          disabled={disabled}
          activeOpacity={0.6}
          style={[st.btn, disabled && { opacity: 0.4 }]}
          hitSlop={{ top: 8, bottom: 8, right: 16 }}
          accessibilityRole="button"
          accessibilityLabel={`${label}. Change style`}
        >
          {title}
        </TouchableOpacity>
      ) : title}
      {sub ? <Text style={st.sub} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{sub}</Text> : null}

      <StyleMenu
        at={menu}
        options={options}
        value={category}
        onSelect={onSelect}
        onClose={() => setMenu(null)}
      />
    </View>
  );
}

// The dark menu of styles, under whatever opened it. `at` is where its top-left
// corner goes in window coordinates; it is kept on screen, so a button at the
// right edge can pass its own right edge minus MENU_W.
export const MENU_W = 220;
export function StyleMenu({ at, options = STYLES, value, onSelect, onClose }) {
  const { width } = useWindowDimensions();
  const left = at ? Math.max(12, Math.min(at.x, width - MENU_W - 12)) : 0;
  return (
    <Modal
      visible={!!at}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={st.backdrop} onPress={onClose}>
        <View style={[st.sheet, { top: at?.y ?? 0, left }]}>
          {options.map((opt, i) => (
            <TouchableOpacity
              key={opt.key}
              style={[st.option, i > 0 && st.optionDivider]}
              activeOpacity={0.65}
              onPress={() => { onClose(); if (opt.key !== value) onSelect?.(opt.key); }}
            >
              <Text style={st.optionLabel}>{opt.label}</Text>
              {opt.key === value ? (
                <Ionicons name="checkmark" size={18} color="#FFFFFF" style={st.check} />
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, minWidth: 0 },
  btn: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontFamily: Fonts.semiBold, fontSize: 17, letterSpacing: -0.34, color: INK, flexShrink: 1 },
  chev: { marginTop: 1 },
  sub: { fontFamily: Fonts.regular, fontSize: 11.5, color: INK_2, marginTop: 1 },

  backdrop: { flex: 1, backgroundColor: 'transparent' },
  sheet: {
    position: 'absolute',
    minWidth: MENU_W,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(28,28,30,0.96)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 22,
    elevation: 14,
  },
  option: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, minWidth: MENU_W },
  optionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.15)' },
  optionLabel: { fontFamily: Fonts.semiBold, fontSize: 15, color: '#FFFFFF', flex: 1 },
  check: { marginLeft: 12 },
});
