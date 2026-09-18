// Two focus points that may be the same one, side by side (docs/design/action-needed.html):
// what the student already carries, what the last lesson just added, and what
// each has cost them in practice — so "Merge" or "Keep both" is answered from
// the page. `Context` opens the fuller reading in a sheet the screen owns.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Fonts } from '../../theme';
import { L, Avatar, dateLabel } from './LessonUI';

const NAVY = '#22314D';

function whereFrom(fp) {
  if (!fp) return '';
  const kind = fp.group_fp ? 'Group' : 'Private';
  const style = Array.isArray(fp.dance) ? fp.dance[0] : fp.dance;
  const head = fp.group_fp && style ? `${style} group` : kind;
  return [head, fp.created_at ? dateLabel(fp.created_at) : null].filter(Boolean).join(' · ');
}

// "practised 3× · 17 min", or that it never was.
function practiceLine(fp) {
  const times = fp?.practiceCount ?? 0;
  const minutes = fp?.practiceMinutes ?? 0;
  if (!times) return { text: 'never practised', ratio: 0 };
  return {
    text: `practised ${times}× ${minutes ? `· ${minutes} min` : ''}`.trim(),
    ratio: Math.min(1, times / 3),
  };
}

function Mini({ fp, isNew, solo }) {
  const { text, ratio } = practiceLine(fp);
  return (
    <View style={[s.mc, solo && s.mcSolo]}>
      {isNew && <Text style={s.nw}>New</Text>}
      <Text style={s.tag} numberOfLines={1}>{whereFrom(fp)}</Text>
      <Text style={s.mcName} numberOfLines={2}>{fp?.name || '—'}</Text>
      {!!fp?.subtitle && <Text style={s.mcP} numberOfLines={2}>{fp.subtitle}</Text>}
      <View style={s.tk}>
        <View style={s.track}><View style={[s.trackFill, { width: `${ratio * 100}%` }]} /></View>
        <Text style={s.tkT}>{text}</Text>
      </View>
    </View>
  );
}

export default function MergeCompareCard({ mr, studentName, onMerge, onKeepBoth, onShowContext }) {
  const a = mr.focusA;
  const b = mr.focusB;
  const olderFirst = a && b && new Date(a.created_at) <= new Date(b.created_at);
  const existing = olderFirst ? a : b;
  const incoming = olderFirst ? b : a;

  return (
    <View style={s.card}>
      <View style={s.hd}>
        <Avatar name={studentName} size={26} />
        <Text style={s.hdName} numberOfLines={1}>{studentName || 'Your student'}</Text>
        <Text style={s.hdEm}>Same idea?</Text>
      </View>

      <View style={s.mini}>
        <Mini fp={existing} solo={!existing?.group_fp} />
        <View style={s.eq}>
          <View style={s.eqDot}><Text style={s.eqDotT}>≈</Text></View>
          <Text style={s.eqT} numberOfLines={1}>Two names for one idea?</Text>
          {!!onShowContext && (
            <TouchableOpacity style={s.ctxb} activeOpacity={0.8} onPress={() => onShowContext(mr, { existing, incoming })}
              accessibilityRole="button">
              <Text style={s.ctxbT}>Context</Text>
            </TouchableOpacity>
          )}
        </View>
        <Mini fp={incoming} isNew solo={!incoming?.group_fp} />
      </View>

      <View style={s.act}>
        <TouchableOpacity style={s.ok} activeOpacity={0.88} onPress={() => onMerge(mr)} accessibilityRole="button">
          <Text style={s.okT}>Merge</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.keep} activeOpacity={0.8} onPress={() => onKeepBoth(mr)} accessibilityRole="button">
          <Text style={s.keepT}>Keep both</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 19, borderWidth: 1, borderColor: 'rgba(10,10,10,0.07)',
    overflow: 'hidden', marginBottom: 10,
  },
  hd: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 16, paddingTop: 13 },
  hdName: { flex: 1, minWidth: 0, fontFamily: Fonts.semiBold, fontSize: 13, letterSpacing: -0.2, color: L.INK },
  hdEm: { fontFamily: Fonts.semiBold, fontSize: 10, letterSpacing: 0.9, textTransform: 'uppercase', color: L.INK_62 },

  mini: { padding: 16, paddingBottom: 13, gap: 8 },
  mc: { backgroundColor: NAVY, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 13, gap: 5 },
  mcSolo: { backgroundColor: L.INK },
  nw: {
    position: 'absolute', top: 11, right: 13, fontFamily: Fonts.semiBold, fontSize: 8.5, letterSpacing: 1.2,
    textTransform: 'uppercase', color: '#F6A192',
  },
  tag: { fontFamily: Fonts.semiBold, fontSize: 8.5, letterSpacing: 1.2, textTransform: 'uppercase', color: L.GOLD },
  mcName: { fontFamily: Fonts.bold, fontSize: 16, letterSpacing: -0.56, lineHeight: 18, color: '#FFFFFF' },
  mcP: { fontFamily: Fonts.regular, fontSize: 11.5, lineHeight: 15.5, color: 'rgba(255,255,255,0.7)' },
  tk: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  track: { width: 42, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  trackFill: { height: 3, borderRadius: 2, backgroundColor: L.GOLD },
  tkT: { flex: 1, minWidth: 0, fontFamily: Fonts.regular, fontSize: 10.5, color: 'rgba(255,255,255,0.7)' },

  eq: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  eqDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: L.INK, alignItems: 'center', justifyContent: 'center' },
  eqDotT: { fontFamily: Fonts.bold, fontSize: 11, color: '#FFFFFF' },
  eqT: { flexShrink: 1, fontFamily: Fonts.semiBold, fontSize: 11, color: L.INK_62 },
  ctxb: { marginLeft: 'auto', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(10,10,10,0.14)' },
  ctxbT: { fontFamily: Fonts.semiBold, fontSize: 11.5, color: 'rgba(10,10,10,0.68)' },

  act: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14,
    borderTopWidth: 1, borderTopColor: 'rgba(10,10,10,0.07)',
  },
  ok: { flex: 1, height: 42, borderRadius: 999, backgroundColor: L.INK, alignItems: 'center', justifyContent: 'center' },
  okT: { fontFamily: Fonts.semiBold, fontSize: 14, color: '#FFFFFF' },
  keep: { height: 42, paddingHorizontal: 17, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(10,10,10,0.14)', alignItems: 'center', justifyContent: 'center' },
  keepT: { fontFamily: Fonts.semiBold, fontSize: 13.5, color: 'rgba(10,10,10,0.68)' },
});
