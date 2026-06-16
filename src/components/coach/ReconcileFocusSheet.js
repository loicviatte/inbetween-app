import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fonts } from '../../theme';
import HeroCardGradient from '../HeroCardGradient';

// Coach reconciliation sheet — shown (from Action Needed) when a new private
// class leaves a student with 4 focus points and the carried-over one was a
// `supporting`, so the coach must pick which of the three lower-ranked focuses
// to drop. The new critical is always kept (the locked hero). The two survivors
// are re-ranked server-side; the carried-over focus keeps its count and its
// target grows by +2 (shown in the note).
//
// Props:
//   student   { name, initials }
//   coachName string
//   kept      { name, tier, done, target }            — always-kept hero (new critical)
//   candidates[] { id, name, carried, done, target }  — the 3 "drop one" options
//   defaultRemovedId? string                          — preselected drop (else the last)
//   onConfirm(removedIds[])  onClose()  — coach keeps 1–3 (critical always kept)

const C = {
  sheet: '#FBFAF6',
  ink: '#0A0A0A',
  ink2: 'rgba(10,10,10,0.62)',
  ink3: 'rgba(10,10,10,0.42)',
  line: 'rgba(10,10,10,0.10)',
  gold: '#E8B530',
  gold300: '#F6D27A',
  crit: '#BC4B36',
  critTint: 'rgba(188,75,54,0.05)',
  critLine: 'rgba(188,75,54,0.5)',
};

export default function ReconcileFocusSheet({
  student = { name: 'Student', initials: '?' },
  coachName = 'your coach',
  kept = { name: '—', tier: 'critical', done: 0, target: 3 },
  candidates = [],
  onConfirm,
  onClose,
}) {
  const [removed, setRemoved] = useState(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const [infoFp, setInfoFp] = useState(null); // { name, concept } for the "?" popup
  const [showErr, setShowErr] = useState(false);

  // The critical hero is always kept (1). The coach may end with 1–3 total, i.e.
  // remove candidates until at most 2 remain. Confirm is enabled once kept ≤ 3.
  const keptCount = 1 + candidates.filter((c) => !removed.has(c.id)).length;
  const valid = keptCount <= 3;
  const carried = candidates.find((c) => c.carried);
  const carriedKept = carried && !removed.has(carried.id);

  function toggle(id) {
    setRemoved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setShowErr(false);
  }

  async function handleConfirm() {
    if (submitting) return;
    if (!valid) { setShowErr(true); return; }
    setSubmitting(true);
    try {
      await onConfirm?.(Array.from(removed));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={s.overlay}>
      <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose} />

      <View style={s.sheet}>
        <View style={s.grab} />

        {/* Header */}
        <View style={s.shead}>
          <View style={s.aw}>
            <Text style={s.awText}>{student.initials}</Text>
          </View>
          <View style={s.fmid}>
            <Text style={s.nm} numberOfLines={1}>{student.name}</Text>
            <Text style={s.mt} numberOfLines={1}>Debrief with {coachName}</Text>
          </View>
          <TouchableOpacity style={s.closeb} onPress={onClose} activeOpacity={0.7}>
            <Ionicons name="close" size={16} color={C.ink} />
          </TouchableOpacity>
        </View>

        <Text style={s.intro}>
          This lesson left <Text style={s.introB}>{1 + candidates.length} focus points</Text>. Keep up to 3 — remove the rest.
        </Text>

        {/* Always-kept hero */}
        <View style={s.hero}>
          <HeroCardGradient />
          <View style={s.kheadrow}>
            <Text style={s.keyebrow}>Critical focus point for next class</Text>
            <View style={s.klock}>
              <Ionicons name="lock-closed" size={12} color={C.gold300} />
            </View>
          </View>
          <Text style={s.kname} numberOfLines={1}>{kept.name}</Text>
          <View style={s.kmeta}>
            <Text style={s.ktrained}>{kept.done}/{kept.target} trained</Text>
          </View>
        </View>

        {/* Tap to remove — keep up to 3 */}
        <View style={s.dropk}>
          <Text style={s.dropkLabel}>TAP TO REMOVE</Text>
          <Text style={[s.dropkN, !valid && { color: C.crit }]}>keeping {keptCount}</Text>
        </View>

        <View style={s.list}>
          {candidates.map((c) => {
            const isRemoved = removed.has(c.id);
            return (
              <TouchableOpacity
                key={c.id}
                style={[s.fp, isRemoved && s.fpRemoved]}
                activeOpacity={0.75}
                onPress={() => toggle(c.id)}
              >
                <View style={[s.dot, isRemoved && s.dotRemoved]} />
                <View style={s.fmid}>
                  <Text style={[s.name, isRemoved && s.nameRemoved]} numberOfLines={1}>{c.name}</Text>
                  <Text style={[s.stt, isRemoved && s.sttRemoved]}>
                    {c.carried ? 'CARRIED OVER' : 'NEW'}
                  </Text>
                </View>
                {!!c.concept && (
                  <TouchableOpacity
                    style={s.infoBtn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    onPress={() => setInfoFp({ name: c.name, concept: c.concept })}
                  >
                    <Ionicons name="help" size={13} color={C.ink2} />
                  </TouchableOpacity>
                )}
                {isRemoved ? (
                  <View style={s.remWrap}>
                    <Ionicons name="close" size={11} color={C.crit} />
                    <Text style={s.remText}>REMOVED</Text>
                  </View>
                ) : (
                  <Text style={s.frac}>{c.done}/{c.carried ? c.target + 2 : c.target}</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {carriedKept ? (
          <Text style={s.note}>
            <Text style={s.noteB}>{carried.name}</Text> is carried over, so its target grows by two (now {carried.done}/{carried.target + 2}).
          </Text>
        ) : (
          <Text style={s.note}>The remaining focus points stay as they are.</Text>
        )}

        <View style={s.sfoot}>
          {showErr && !valid && (
            <Text style={s.errMsg}>
              {removed.size === 0
                ? 'Select a focus point to remove from training plan.'
                : `Remove ${keptCount - 3} more to keep 3 or fewer.`}
            </Text>
          )}
          <TouchableOpacity
            style={[s.confirm, (!valid || submitting) && s.confirmDisabled]}
            activeOpacity={0.85}
            onPress={handleConfirm}
            disabled={submitting}
          >
            <Text style={s.confirmText}>{submitting ? 'Saving…' : 'Confirm'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {infoFp && (
        <View style={s.infoOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setInfoFp(null)} />
          <View style={s.infoCard}>
            <Text style={s.infoTitle}>{infoFp.name}</Text>
            <Text style={s.infoBody}>{infoFp.concept}</Text>
            <TouchableOpacity style={s.infoClose} activeOpacity={0.85} onPress={() => setInfoFp(null)}>
              <Text style={s.infoCloseText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,10,10,0.42)' },

  sheet: {
    backgroundColor: C.sheet,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingBottom: 28,
  },
  grab: { width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(10,10,10,0.16)', alignSelf: 'center', marginTop: 11, marginBottom: 5 },

  shead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 14 },
  aw: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#F0C24A', alignItems: 'center', justifyContent: 'center' },
  awText: { fontFamily: Fonts.jakartaExtraBold, fontSize: 14, color: C.ink },
  fmid: { flex: 1, minWidth: 0 },
  nm: { fontFamily: Fonts.jakartaExtraBold, fontSize: 18, color: C.ink, letterSpacing: -0.2 },
  mt: { fontFamily: Fonts.travelsRegular, fontSize: 12, color: C.ink3, marginTop: 1 },
  closeb: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(10,10,10,0.05)', alignItems: 'center', justifyContent: 'center' },

  intro: { fontFamily: Fonts.travelsRegular, fontSize: 13.5, lineHeight: 20, color: C.ink2, paddingHorizontal: 20 },
  introB: { fontFamily: Fonts.jakartaExtraBold, color: C.ink },

  hero: { marginHorizontal: 20, marginTop: 14, borderRadius: 18, padding: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(240,194,74,0.3)' },
  kheadrow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  keyebrow: { fontFamily: Fonts.travelsMedium, fontSize: 10.5, letterSpacing: 0.3, color: C.gold300 },
  klock: { width: 24, height: 24, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  kname: { fontFamily: Fonts.jakartaExtraBold, fontSize: 27, color: '#FFFFFF', letterSpacing: -0.6, marginTop: 9 },
  kmeta: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 14 },
  kpill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.gold, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 4 },
  kpillText: { fontFamily: Fonts.travelsMedium, fontSize: 9.5, letterSpacing: 1.1, color: C.ink },
  ktrained: { fontFamily: Fonts.travelsMedium, fontSize: 12, color: 'rgba(247,246,243,0.62)' },

  dropk: { flexDirection: 'row', alignItems: 'baseline', paddingHorizontal: 22, paddingTop: 18, paddingBottom: 9 },
  dropkLabel: { fontFamily: Fonts.travelsMedium, fontSize: 10, letterSpacing: 1.6, color: C.ink3 },
  dropkN: { marginLeft: 'auto', fontFamily: Fonts.travelsMedium, fontSize: 11, color: C.ink3 },

  list: { paddingHorizontal: 20, gap: 8 },
  fp: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 14 },
  fpRemoved: { borderColor: C.critLine, backgroundColor: C.critTint },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.gold },
  dotRemoved: { backgroundColor: C.crit },
  name: { fontFamily: Fonts.jakartaExtraBold, fontSize: 16, color: C.ink, letterSpacing: -0.2 },
  nameRemoved: { color: C.ink3, textDecorationLine: 'line-through' },
  stt: { fontFamily: Fonts.travelsMedium, fontSize: 10, letterSpacing: 1.1, color: C.ink3, marginTop: 3 },
  sttRemoved: { textDecorationLine: 'line-through' },
  frac: { fontFamily: Fonts.jakartaExtraBold, fontSize: 15, color: C.ink },
  remWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  remText: { fontFamily: Fonts.travelsMedium, fontSize: 10, letterSpacing: 0.5, color: C.crit },

  note: { fontFamily: Fonts.travelsRegular, fontSize: 12, lineHeight: 18, color: C.ink3, paddingHorizontal: 20, paddingTop: 13 },
  noteB: { fontFamily: Fonts.travelsMedium, color: C.ink2 },

  sfoot: { paddingHorizontal: 20, paddingTop: 15 },
  errMsg: { fontFamily: Fonts.travelsMedium, fontSize: 12, color: C.crit, marginBottom: 8, textAlign: 'center' },
  confirm: { backgroundColor: C.ink, borderRadius: 15, paddingVertical: 16, alignItems: 'center' },
  confirmDisabled: { opacity: 0.45 },
  confirmText: { fontFamily: Fonts.jakartaExtraBold, fontSize: 16, color: '#FFFFFF' },

  infoBtn: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,10,10,0.05)' },
  infoOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,10,10,0.5)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  infoCard: { backgroundColor: C.sheet, borderRadius: 18, padding: 18, maxWidth: 320, width: '100%' },
  infoTitle: { fontFamily: Fonts.jakartaExtraBold, fontSize: 18, color: C.ink, letterSpacing: -0.3 },
  infoBody: { fontFamily: Fonts.travelsRegular, fontSize: 14, lineHeight: 21, color: C.ink2, marginTop: 8 },
  infoClose: { marginTop: 16, alignSelf: 'flex-end', backgroundColor: C.ink, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 20 },
  infoCloseText: { fontFamily: Fonts.jakartaExtraBold, fontSize: 14, color: '#FFFFFF' },
});
