import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import HeroCardGradient from '../HeroCardGradient';
import { Ionicons } from '@expo/vector-icons';
import { Fonts } from '../../theme';

const GOLD = '#F6D27A';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function FocusSide({ label, dateLabel, fp }) {
  if (!fp) return null;
  return (
    <View style={s.side}>
      <View style={s.sideHeader}>
        <Text style={s.sideLabel}>{label}</Text>
        {!!dateLabel && <Text style={s.sideDate}>{dateLabel.toUpperCase()}</Text>}
      </View>
      <Text style={s.sideName}>{fp.name}</Text>
      {!!fp.subtitle && <Text style={s.sideSubtitle}>{fp.subtitle}</Text>}
      {!!fp.context && (
        <Text style={s.sideContext} numberOfLines={4}>
          {fp.context}
        </Text>
      )}
      {!!fp.drill && (
        <View style={s.drillBlock}>
          <Text style={s.drillLabel}>DRILL</Text>
          <Text style={s.drillText} numberOfLines={3}>{fp.drill}</Text>
        </View>
      )}
    </View>
  );
}

export default function MergeCompareCard({ mr, studentName, onMerge, onKeepBoth }) {
  const a = mr.focusA;
  const b = mr.focusB;
  const olderFirst = a && b && new Date(a.created_at) <= new Date(b.created_at);
  const existing = olderFirst ? a : b;
  const incoming = olderFirst ? b : a;

  return (
    <View style={s.card}>
      <HeroCardGradient />

      {/* Top meta */}
      <View style={s.topRow}>
        <Text style={s.topLabel}>POSSIBLE DUPLICATE</Text>
        {!!studentName && <Text style={s.topStudent}>{studentName}</Text>}
      </View>

      {/* Existing side */}
      <FocusSide
        label="EXISTING"
        dateLabel={formatDate(existing?.created_at)}
        fp={existing}
      />

      {/* VS divider */}
      <View style={s.vsRow}>
        <View style={s.vsLine} />
        <View style={s.vsChip}>
          <Text style={s.vsChipText}>VS</Text>
        </View>
        <View style={s.vsLine} />
      </View>

      {/* Incoming side */}
      <FocusSide
        label="NEW FROM THIS CLASS"
        dateLabel={formatDate(incoming?.created_at)}
        fp={incoming}
      />

      {/* Actions */}
      <View style={s.actions}>
        <TouchableOpacity style={s.mergeBtn} onPress={onMerge} activeOpacity={0.85}>
          <Ionicons name="git-merge-outline" size={15} color="#0A0A0A" />
          <Text style={s.mergeBtnText}>Merge into existing</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.keepBtn} onPress={onKeepBoth} activeOpacity={0.7}>
          <Text style={s.keepBtnText}>Keep both</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(240,194,74,0.28)',
    overflow: 'hidden',
  },

  // ── Top meta ──
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  topLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: GOLD,
  },
  topStudent: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: -0.1,
  },

  // ── Sides ──
  side: {
    paddingVertical: 4,
  },
  sideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sideLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9.5,
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 1.2,
  },
  sideDate: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 9.5,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.6,
  },
  sideName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
    color: '#FFFFFF',
    letterSpacing: -0.5,
    lineHeight: 24,
  },
  sideSubtitle: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12,
    color: GOLD,
    lineHeight: 17,
    marginTop: 4,
  },
  sideContext: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.72)',
    lineHeight: 18,
    marginTop: 8,
  },
  drillBlock: {
    marginTop: 10,
  },
  drillLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 8.5,
    color: GOLD,
    letterSpacing: 1,
    marginBottom: 3,
  },
  drillText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.78)',
    lineHeight: 17,
  },

  // ── VS divider ──
  vsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
    gap: 10,
  },
  vsLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(240,194,74,0.30)',
  },
  vsChip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(240,194,74,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(240,194,74,0.45)',
  },
  vsChipText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: GOLD,
    letterSpacing: 1.5,
  },

  // ── Actions ──
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 20,
  },
  mergeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 12,
  },
  mergeBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#0A0A0A',
    letterSpacing: 0.1,
  },
  keepBtn: {
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  keepBtnText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: 'rgba(255,255,255,0.65)',
    letterSpacing: 0.1,
  },
});
