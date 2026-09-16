import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, StyleSheet } from 'react-native';
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

export default function StyleTitle({ label, category, canSwitch, disabled, sub, onSelect }) {
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
      {sub ? <Text style={st.sub} numberOfLines={1}>{sub}</Text> : null}

      <Modal
        visible={!!menu}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setMenu(null)}
      >
        <Pressable style={st.backdrop} onPress={() => setMenu(null)}>
          <View style={[st.sheet, { top: menu?.y ?? 0, left: menu?.x ?? 0 }]}>
            {STYLES.map((opt, i) => (
              <TouchableOpacity
                key={opt.key}
                style={[st.option, i > 0 && st.optionDivider]}
                activeOpacity={0.65}
                onPress={() => { setMenu(null); if (opt.key !== category) onSelect?.(opt.key); }}
              >
                <Text style={st.optionLabel}>{opt.label}</Text>
                {opt.key === category ? (
                  <Ionicons name="checkmark" size={18} color="#FFFFFF" style={st.check} />
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, minWidth: 0 },
  btn: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontFamily: Fonts.ttDemiBold, fontSize: 17, letterSpacing: -0.34, color: INK, flexShrink: 1 },
  chev: { marginTop: 1 },
  sub: { fontFamily: Fonts.ttRegular, fontSize: 11.5, color: INK_2, marginTop: 1 },

  backdrop: { flex: 1, backgroundColor: 'transparent' },
  sheet: {
    position: 'absolute',
    minWidth: 220,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(28,28,30,0.96)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 22,
    elevation: 14,
  },
  option: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, minWidth: 220 },
  optionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.15)' },
  optionLabel: { fontFamily: Fonts.ttDemiBold, fontSize: 15, color: '#FFFFFF', flex: 1 },
  check: { marginLeft: 12 },
});
