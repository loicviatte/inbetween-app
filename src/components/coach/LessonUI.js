// Start a lesson (docs/design/start-lesson.html): the pieces every step of it is
// built from — top bar, the dark readiness hero, section heads, the check card
// (focus rows, question rows), the activity timeline, the list rows of the
// picker, and the foot: gold Start, then the running timer with End lesson.

import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet, Animated, Easing } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Fonts, Spacing } from '../../theme';

export const L = {
  INK: '#0A0A0A',
  INK_62: 'rgba(10,10,10,0.62)',
  LINE: 'rgba(10,10,10,0.12)',
  PAGE: '#F2F0EB',
  GOLD: '#E8B530',
  GOLD_INK: '#8A6414',
  CREAM: '#FCEFC9',
  RED: '#A8412F',
  RED_DOT: '#D06A5A',
  RED_BTN: '#C0442D', // reads as red on the black running bar
  GREEN: '#7FB77E',
  NAVY: '#22314D',
};

export function initialsOf(name) {
  const w = (name || '').trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '?') + (w[1]?.[0] || '')).toUpperCase();
}

// Dates come from one place for the whole app (see utils/dates), and are
// re-exported here so the coach kit stays a single import.
import { daysAgo, dayLabel } from '../../utils/dates';

export { daysAgo, dayLabel };
// "since Mon 8 Sep", "since yesterday", "today"; no date → "in the last 7 days".
export function sincePhrase(date) {
  if (!date) return 'in the last 7 days';
  const n = daysAgo(date);
  if (n <= 0) return 'today';
  if (n === 1) return 'since yesterday';
  return `since ${dayLabel(date)}`;
}
export function askedLabel(date) {
  if (!date) return 'Asked';
  const n = daysAgo(date);
  if (n <= 0) return 'Asked today';
  if (n === 1) return 'Asked yesterday';
  return `Asked ${dayLabel(date)}`;
}

// ── Avatar ───────────────────────────────────────────────────────────────────
export function Avatar({ name, photoUrl, size = 36, dim }) {
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }, dim && { opacity: 0.5 }]}>
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={StyleSheet.absoluteFill} />
      ) : (
        <LinearGradient colors={['#F6D27A', L.GOLD]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.avFill}>
          <Text style={[st.avT, { fontSize: Math.round(size * 0.35) }]}>{initialsOf(name)}</Text>
        </LinearGradient>
      )}
    </View>
  );
}

// ring: the colour behind the pair (white in a card, the page in the top bar).
export function PairAvatars({ a, b, size = 36, ring = '#FFFFFF' }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      <Avatar name={a?.name} photoUrl={a?.avatarUrl || a?.photoUrl} size={size} />
      <View style={{ marginLeft: -size * 0.35, borderRadius: size / 2, borderWidth: 2, borderColor: ring }}>
        <Avatar name={b?.name} photoUrl={b?.avatarUrl || b?.photoUrl} size={size - 4} />
      </View>
    </View>
  );
}

// ── Top bar ──────────────────────────────────────────────────────────────────
export function TopBar({ icon = 'chevron-back', onBack, title, sub, right, backLabel = 'Back' }) {
  return (
    <View style={st.top}>
      {onBack ? (
        <TouchableOpacity style={st.ib} onPress={onBack} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={backLabel}>
          <Ionicons name={icon} size={18} color={L.INK} />
        </TouchableOpacity>
      ) : null}
      <View style={st.hd}>
        {!!title && <Text style={st.hdT} numberOfLines={1}>{title}</Text>}
        {!!sub && <Text style={st.hdS} numberOfLines={1}>{sub}</Text>}
      </View>
      {right}
    </View>
  );
}

// ── Gauge ────────────────────────────────────────────────────────────────────
export function Gauge({ percent, dark }) {
  const p = Math.max(0, Math.min(100, percent || 0));
  return (
    <View style={[st.gauge, dark && st.gaugeDark]}>
      <View style={[st.gaugeFill, { width: `${p}%` }]} />
      {Array.from({ length: 9 }).map((_, i) => (
        <View key={i} style={[st.gaugeNotch, dark && { backgroundColor: L.INK }, { left: `${(i + 1) * 10}%` }]} />
      ))}
    </View>
  );
}

// ── The dark hero ────────────────────────────────────────────────────────────
// big: the gold figure ('50' + '%'), or null for a dash. figures: [{ value, unit, label }].
export function Hero({ big, unit = '%', title, label, gauge, children, figures }) {
  return (
    <View style={st.hero}>
      <View style={st.heroL1}>
        <View style={st.heroPc}>
          <Text style={st.heroPcN}>{big == null ? '—' : big}</Text>
          {big != null && !!unit && <Text style={st.heroPcU}>{unit}</Text>}
        </View>
        <View style={st.heroNm}>
          <Text style={st.heroT} numberOfLines={2}>{title}</Text>
          {!!label && <Text style={st.heroLb}>{label}</Text>}
        </View>
      </View>
      {gauge != null && <Gauge percent={gauge} dark />}
      {!!children && <Text style={st.heroP}>{children}</Text>}
      {!!figures?.length && (
        <View style={st.heroFig}>
          {figures.map((f, i) => (
            <View key={f.label} style={[st.heroFigCell, i > 0 && st.heroFigLine]}>
              <Text style={st.heroFigN}>
                {f.value}
                {!!f.unit && <Text style={st.heroFigU}>{f.unit}</Text>}
              </Text>
              <Text style={st.heroFigL} numberOfLines={1}>{f.label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
export const HeroStrong = ({ children }) => <Text style={st.heroStrong}>{children}</Text>;
export const HeroAlert = ({ children }) => <Text style={st.heroAlert}>{children}</Text>;

// ── Section head ─────────────────────────────────────────────────────────────
export function SectionHead({ title, right }) {
  return (
    <View style={st.sh}>
      <Text style={st.shT}>{title}</Text>
      {!!right && <Text style={st.shR} numberOfLines={1}>{right}</Text>}
    </View>
  );
}

export function Card({ children, style }) {
  return <View style={[st.card, style]}>{children}</View>;
}

// ── A focus to check ─────────────────────────────────────────────────────────
export function TierChip({ tier }) {
  const crit = tier === 'critical';
  const label = tier === 'critical' ? 'Critical' : tier === 'important' ? 'Important' : tier === 'supporting' ? 'Supporting' : 'Focus';
  return (
    <View style={[st.chip, crit && st.chipCrit, tier === 'supporting' && st.chipSupp]}>
      <Text style={[st.chipT, crit && { color: L.RED }, tier === 'supporting' && { color: L.INK_62 }]}>{label}</Text>
    </View>
  );
}

export function CheckRow({ first, name, tier, meta, done, onPress, disabled, verdict }) {
  const notYet = verdict === 'not_yet';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [st.it, !first && st.itLine, pressed && !disabled && { backgroundColor: '#FBFAF7' }]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!done, disabled: !!disabled }}
    >
      <View style={[st.tk, done && st.tkDone, notYet && st.tkNotYet]}>
        {notYet
          ? <Ionicons name="refresh" size={11} color="#FFFFFF" />
          : <Ionicons name="checkmark" size={12} color={done ? '#FFFFFF' : 'rgba(10,10,10,0.28)'} />}
      </View>
      <View style={st.itBd}>
        <Text style={[st.itT, done && st.itTDone]} numberOfLines={2}>{name}</Text>
        <View style={st.itMetaRow}>
          {!!tier && <TierChip tier={tier} />}
          {!!meta && <Text style={st.itMeta} numberOfLines={1}>{meta}</Text>}
        </View>
      </View>
    </Pressable>
  );
}

export function QuestionRow({ first, text, meta, answered, onPress, onAnswer, disabled }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.it, st.itQ, !first && st.itLine, pressed && { backgroundColor: '#FBFAF7' }]}
      accessibilityRole="button" accessibilityLabel={`Question: ${text}`}>
      <Text style={st.qm}>“</Text>
      <View style={st.itBd}>
        <Text style={st.itT} numberOfLines={3}>{text}</Text>
        {!!meta && <Text style={st.itMeta} numberOfLines={1}>{meta}</Text>}
      </View>
      {onAnswer ? (
        <TouchableOpacity onPress={onAnswer} disabled={disabled} style={[st.vb, answered && st.vbDone, disabled && { opacity: 0.4 }]}
          activeOpacity={0.75} accessibilityRole="button" accessibilityState={{ checked: !!answered, disabled: !!disabled }}>
          <Text style={[st.vbT, answered && { color: '#3F6B3E' }]}>{answered ? 'Answered' : 'Answer'}</Text>
        </TouchableOpacity>
      ) : null}
    </Pressable>
  );
}

export function CardLabel({ children }) {
  return <Text style={st.qh}>{children}</Text>;
}

// ── Activity timeline ────────────────────────────────────────────────────────
export function TimelineRow({ first, last, label, title, detail, lesson, onPress }) {
  const body = (
    <>
      <View style={st.tlLine}>
        <View style={[st.tlSeg, first && { backgroundColor: 'transparent' }]} />
        {lesson ? <View style={st.tlHalo}><View style={st.tlDotLesson} /></View> : <View style={st.tlDot} />}
        <View style={[st.tlSeg, (last || lesson) && { backgroundColor: 'transparent' }]} />
      </View>
      <View style={[st.tlBody, lesson && { paddingBottom: 6 }]}>
        <Text style={[st.tlLabel, lesson && { color: L.GOLD_INK }]}>{label}</Text>
        <Text style={lesson ? st.tlTitleLesson : st.tlTitle} numberOfLines={2}>{title}</Text>
        {!!detail && <Text style={st.tlDetail}>{detail}</Text>}
      </View>
    </>
  );
  if (!onPress) return <View style={st.tlRow}>{body}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.tlRow, pressed && { opacity: 0.7 }]} accessibilityRole="button">
      {body}
      <Ionicons name="chevron-forward" size={13} color="rgba(10,10,10,0.28)" style={{ alignSelf: 'center' }} />
    </Pressable>
  );
}

// ── Picker rows ──────────────────────────────────────────────────────────────
export function PickRow({ first, avatar, name, meta, metaTone, right, dim, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.pr, !first && st.itLine, dim && { opacity: 0.5 }, pressed && { backgroundColor: '#FBFAF7' }]}
      accessibilityRole="button">
      {avatar}
      <View style={st.itBd}>
        <Text style={st.prName} numberOfLines={1}>{name}</Text>
        {!!meta && <Text style={[st.itMeta, metaTone === 'gold' && { color: L.GOLD_INK, fontFamily: Fonts.ttDemiBold }]} numberOfLines={1}>{meta}</Text>}
      </View>
      {right}
      <Ionicons name="chevron-forward" size={13} color="rgba(10,10,10,0.28)" />
    </Pressable>
  );
}

export function Percent({ value }) {
  if (value == null) return <Text style={[st.prPct, { color: 'rgba(10,10,10,0.34)' }]}>—</Text>;
  return <Text style={st.prPct}>{value}<Text style={st.prPctU}>%</Text></Text>;
}

// ── Underline tabs (Solo · Couple) ───────────────────────────────────────────
export function Tabs({ items, value, onChange, right }) {
  return (
    <View style={st.tabs}>
      {items.map(([key, label]) => (
        <TouchableOpacity key={key} style={[st.tab, value === key && st.tabOn]} onPress={() => onChange(key)} activeOpacity={0.7}
          accessibilityRole="tab" accessibilityState={{ selected: value === key }}>
          <Text style={[st.tabT, value === key && { color: L.INK }]}>{label}</Text>
        </TouchableOpacity>
      ))}
      {!!right && <Text style={st.tabsR}>{right}</Text>}
    </View>
  );
}

// ── Foot: Start, then the running timer with End lesson ─────────────────────
function PulseDot() {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 0.35, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[st.liveDot, { opacity: v }]} />;
}

export function StartFoot({ label = 'Start', icon = 'play', disabled, onPress, bottom = 0 }) {
  return (
    <View style={[st.foot, { paddingBottom: 14 + bottom }]} pointerEvents="box-none">
      <LinearGradient colors={['rgba(242,240,235,0)', L.PAGE]} locations={[0, 0.34]} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <TouchableOpacity style={[st.go, disabled && { opacity: 0.45 }]} onPress={onPress} disabled={disabled} activeOpacity={0.88} accessibilityRole="button">
        {!!icon && <Ionicons name={icon} size={17} color={L.INK} />}
        <Text style={st.goT}>{label}</Text>
      </TouchableOpacity>
    </View>
  );
}

export function RunningFoot({ time, source, onEnd, bottom = 0 }) {
  return (
    <View style={[st.foot, { paddingBottom: 14 + bottom }]} pointerEvents="box-none">
      <LinearGradient colors={['rgba(242,240,235,0)', L.PAGE]} locations={[0, 0.34]} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <View style={st.live} accessibilityRole="timer" accessibilityLabel={`Lesson running, ${time}`}>
        <PulseDot />
        <Text style={st.liveTime}>{time}</Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.liveLabel} numberOfLines={1}>Lesson running</Text>
          {!!source && <Text style={st.liveSource} numberOfLines={1}>{source}</Text>}
        </View>
        <TouchableOpacity style={st.liveEnd} onPress={onEnd} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="End lesson">
          <View style={st.liveEndIcon} />
          <Text style={st.liveEndT}>End</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Popups ───────────────────────────────────────────────────────────────────
// A centred card over a dim backdrop. `onDismiss` null = the coach must answer.
export function Popup({ icon, title, children, actions, onDismiss }) {
  return (
    <Pressable style={st.popBackdrop} onPress={onDismiss || undefined} accessibilityViewIsModal>
      <Pressable style={st.popCard} onPress={() => {}}>
        {!!icon && (
          <View style={st.popIcon}>
            <Ionicons name={icon} size={20} color={L.GOLD} />
          </View>
        )}
        <Text style={st.popTitle}>{title}</Text>
        {!!children && <Text style={st.popBody}>{children}</Text>}
        <View style={st.popActions}>{actions}</View>
      </Pressable>
    </Pressable>
  );
}
export const PopupStrong = ({ children }) => <Text style={st.popStrong}>{children}</Text>;

export function PopupButton({ label, tone = 'gold', onPress, style }) {
  return (
    <TouchableOpacity
      style={[st.popBtn, tone === 'dark' && st.popBtnDark, tone === 'ghost' && st.popBtnGhost, style]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
    >
      <Text style={[st.popBtnT, tone === 'dark' && { color: '#FFFFFF' }, tone === 'ghost' && { color: 'rgba(10,10,10,0.7)' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// Two-way verdict pills (Good · Not yet).
export function VerdictPills({ value, onGood, onNotYet }) {
  return (
    <View style={st.vps}>
      <TouchableOpacity onPress={onGood} activeOpacity={0.8} accessibilityRole="button" accessibilityState={{ selected: value === 'good' }}
        style={[st.vp, value === 'good' && st.vpGood]}>
        <Ionicons name="checkmark" size={12} color={value === 'good' ? '#FFFFFF' : '#3F6B3E'} />
        <Text style={[st.vpT, { color: value === 'good' ? '#FFFFFF' : '#3F6B3E' }]}>Good</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onNotYet} activeOpacity={0.8} accessibilityRole="button" accessibilityState={{ selected: value === 'not_yet' }}
        style={[st.vp, value === 'not_yet' && st.vpNotYet]}>
        <Text style={[st.vpT, { color: value === 'not_yet' ? '#FFFFFF' : '#9A5B1E' }]}>Not yet</Text>
      </TouchableOpacity>
    </View>
  );
}

export function Empty({ children }) {
  return <Text style={st.empty}>{children}</Text>;
}

export const lessonStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: L.PAGE },
  scroll: { paddingHorizontal: Spacing.side },
});

const st = StyleSheet.create({
  avFill: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  avT: { fontFamily: Fonts.ttBold, color: L.INK },

  top: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: Spacing.side, paddingTop: 6, paddingBottom: 6 },
  ib: {
    width: 36, height: 36, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    shadowColor: L.INK, shadowOpacity: 0.07, shadowOffset: { width: 0, height: 1 }, shadowRadius: 2, elevation: 1,
  },
  hd: { flex: 1, minWidth: 0 },
  hdT: { fontFamily: Fonts.ttDemiBold, fontSize: 17, letterSpacing: -0.34, color: L.INK },
  hdS: { fontFamily: Fonts.ttRegular, fontSize: 11.5, color: 'rgba(10,10,10,0.65)', marginTop: 1 },

  gauge: { height: 11, borderRadius: 4, overflow: 'hidden', backgroundColor: 'rgba(10,10,10,0.09)' },
  gaugeDark: { height: 8, backgroundColor: 'rgba(255,255,255,0.16)' },
  gaugeFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: L.GOLD, borderRadius: 4 },
  gaugeNotch: { position: 'absolute', top: 0, bottom: 0, width: 4, marginLeft: -2, backgroundColor: L.PAGE },

  hero: { marginTop: 14, borderRadius: 19, backgroundColor: L.INK, paddingVertical: 16, paddingHorizontal: 17, gap: 13 },
  heroL1: { flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
  heroPc: { flexDirection: 'row', alignItems: 'flex-start' },
  heroPcN: { fontFamily: Fonts.ttExtraBold, fontSize: 52, letterSpacing: -3.1, lineHeight: 46, color: L.GOLD, fontVariant: ['tabular-nums'] },
  heroPcU: { fontFamily: Fonts.ttBold, fontSize: 20, lineHeight: 22, color: 'rgba(232,181,48,0.75)', paddingLeft: 2, marginTop: 1 },
  heroNm: { flex: 1, minWidth: 0, paddingBottom: 1 },
  heroT: { fontFamily: Fonts.ttBold, fontSize: 20, letterSpacing: -0.7, lineHeight: 23, color: '#FFFFFF' },
  heroLb: { fontFamily: Fonts.ttDemiBold, fontSize: 9, letterSpacing: 1.35, textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)', marginTop: 5 },
  heroP: { fontFamily: Fonts.ttRegular, fontSize: 13.5, lineHeight: 20, color: 'rgba(255,255,255,0.8)' },
  heroStrong: { fontFamily: Fonts.ttDemiBold, color: '#FFFFFF' },
  heroAlert: { fontFamily: Fonts.ttDemiBold, color: '#F0A08C' },
  heroFig: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.14)', paddingTop: 12 },
  heroFigCell: { flex: 1 },
  heroFigLine: { paddingLeft: 13, borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.14)' },
  heroFigN: { fontFamily: Fonts.ttBold, fontSize: 18, letterSpacing: -0.7, lineHeight: 20, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  heroFigU: { fontFamily: Fonts.ttRegular, fontSize: 11, color: 'rgba(255,255,255,0.62)' },
  heroFigL: { fontFamily: Fonts.ttDemiBold, fontSize: 8.5, letterSpacing: 0.95, textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)', marginTop: 5 },

  sh: { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingTop: 19, paddingBottom: 9, paddingHorizontal: 2 },
  shT: { fontFamily: Fonts.ttDemiBold, fontSize: 9.5, letterSpacing: 1.6, textTransform: 'uppercase', color: L.INK_62 },
  shR: { flex: 1, textAlign: 'right', fontFamily: Fonts.ttRegular, fontSize: 11, color: L.INK_62 },

  card: { backgroundColor: '#FFFFFF', borderRadius: 17, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(10,10,10,0.06)' },
  qh: {
    paddingTop: 13, paddingBottom: 7, paddingHorizontal: 15, borderTopWidth: 1, borderTopColor: 'rgba(10,10,10,0.07)',
    fontFamily: Fonts.ttBold, fontSize: 9, letterSpacing: 1.35, textTransform: 'uppercase', color: L.INK_62,
  },
  it: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 15 },
  itQ: { alignItems: 'flex-start' },
  itLine: { borderTopWidth: 1, borderTopColor: 'rgba(10,10,10,0.07)' },
  tk: { width: 23, height: 23, borderRadius: 11.5, borderWidth: 1.5, borderColor: 'rgba(10,10,10,0.22)', alignItems: 'center', justifyContent: 'center' },
  tkDone: { backgroundColor: L.GREEN, borderColor: L.GREEN },
  tkNotYet: { backgroundColor: '#D68A3C', borderColor: '#D68A3C' },
  itBd: { flex: 1, minWidth: 0, gap: 3 },
  itT: { fontFamily: Fonts.ttDemiBold, fontSize: 14, letterSpacing: -0.25, lineHeight: 18, color: L.INK },
  itTDone: { color: 'rgba(10,10,10,0.45)', textDecorationLine: 'line-through' },
  itMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itMeta: { flexShrink: 1, fontFamily: Fonts.ttRegular, fontSize: 10.5, color: L.INK_62 },
  chip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: L.CREAM },
  chipCrit: { backgroundColor: 'rgba(168,65,47,0.1)' },
  chipSupp: { backgroundColor: 'rgba(10,10,10,0.06)' },
  chipT: { fontFamily: Fonts.ttBold, fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase', color: L.GOLD_INK },
  qm: { width: 17, fontFamily: Fonts.ttBold, fontSize: 24, lineHeight: 24, color: L.GOLD },
  vb: { height: 28, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(10,10,10,0.16)', alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  vbDone: { backgroundColor: '#EAF3E9', borderColor: '#EAF3E9' },
  vbT: { fontFamily: Fonts.ttDemiBold, fontSize: 11, color: 'rgba(10,10,10,0.68)' },

  tlRow: { flexDirection: 'row', gap: 13 },
  tlLine: { width: 22, alignItems: 'center' },
  tlSeg: { width: 1, flex: 1, backgroundColor: 'rgba(10,10,10,0.14)' },
  tlDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: L.GOLD, marginVertical: 5 },
  tlHalo: { width: 17, height: 17, borderRadius: 8.5, backgroundColor: 'rgba(10,10,10,0.1)', alignItems: 'center', justifyContent: 'center', marginVertical: 2 },
  tlDotLesson: { width: 11, height: 11, borderRadius: 5.5, backgroundColor: L.INK },
  tlBody: { flex: 1, minWidth: 0, gap: 3, paddingTop: 2, paddingBottom: 16 },
  tlLabel: { fontFamily: Fonts.ttDemiBold, fontSize: 9.5, letterSpacing: 1.2, textTransform: 'uppercase', color: L.INK_62 },
  tlTitle: { fontFamily: Fonts.ttDemiBold, fontSize: 14, letterSpacing: -0.25, lineHeight: 18, color: L.INK },
  tlTitleLesson: { fontFamily: Fonts.ttBold, fontSize: 15, letterSpacing: -0.4, lineHeight: 19, color: L.INK },
  tlDetail: { fontFamily: Fonts.ttRegular, fontSize: 11, color: L.INK_62 },

  pr: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  prName: { fontFamily: Fonts.ttDemiBold, fontSize: 14.5, letterSpacing: -0.3, color: L.INK },
  prPct: { fontFamily: Fonts.ttBold, fontSize: 17, letterSpacing: -0.7, color: L.INK, fontVariant: ['tabular-nums'] },
  prPctU: { fontFamily: Fonts.ttDemiBold, fontSize: 11, color: 'rgba(10,10,10,0.45)' },

  tabs: { flexDirection: 'row', alignItems: 'flex-end', gap: 22, marginTop: 16, borderBottomWidth: 1, borderBottomColor: L.LINE },
  tab: { paddingBottom: 9, marginBottom: -1, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: L.GOLD },
  tabT: { fontFamily: Fonts.ttDemiBold, fontSize: 15, letterSpacing: -0.3, color: 'rgba(10,10,10,0.6)' },
  tabsR: { marginLeft: 'auto', paddingBottom: 11, fontFamily: Fonts.ttRegular, fontSize: 11.5, color: L.INK_62 },

  foot: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 22, paddingHorizontal: Spacing.side },
  go: { height: 58, borderRadius: 999, backgroundColor: L.GOLD, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 11 },
  goT: { fontFamily: Fonts.ttBold, fontSize: 19, letterSpacing: -0.4, color: L.INK },
  live: { minHeight: 58, borderRadius: 999, backgroundColor: L.INK, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 20, paddingRight: 7 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: L.RED_DOT },
  liveTime: { fontFamily: Fonts.ttBold, fontSize: 24, letterSpacing: -1, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  liveLabel: { fontFamily: Fonts.ttDemiBold, fontSize: 9, letterSpacing: 1.3, textTransform: 'uppercase', color: 'rgba(255,255,255,0.62)' },
  liveSource: { fontFamily: Fonts.ttRegular, fontSize: 11, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  // Red on the black bar: ending the lesson is the one irreversible tap here.
  liveEnd: { height: 44, borderRadius: 999, paddingHorizontal: 18, backgroundColor: L.RED_BTN, flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveEndIcon: { width: 10, height: 10, borderRadius: 2, backgroundColor: '#FFFFFF' },
  liveEndT: { fontFamily: Fonts.ttBold, fontSize: 14, color: '#FFFFFF' },

  popBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,10,10,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 999 },
  popCard: { width: '100%', maxWidth: 360, backgroundColor: L.PAGE, borderRadius: 22, padding: 20, gap: 8 },
  popIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: L.INK, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  popTitle: { fontFamily: Fonts.ttBold, fontSize: 20, letterSpacing: -0.6, lineHeight: 24, color: L.INK },
  popBody: { fontFamily: Fonts.ttRegular, fontSize: 13.5, lineHeight: 20, color: 'rgba(10,10,10,0.7)' },
  popStrong: { fontFamily: Fonts.ttDemiBold, color: L.INK },
  popActions: { gap: 8, marginTop: 10 },
  popBtn: { height: 50, borderRadius: 999, backgroundColor: L.GOLD, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  popBtnDark: { backgroundColor: L.INK },
  popBtnGhost: { backgroundColor: 'transparent', height: 42 },
  popBtnT: { fontFamily: Fonts.ttBold, fontSize: 15, letterSpacing: -0.3, color: L.INK },

  vps: { flexDirection: 'row', gap: 6 },
  vp: { height: 30, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(10,10,10,0.14)', flexDirection: 'row', alignItems: 'center', gap: 4 },
  vpGood: { backgroundColor: L.GREEN, borderColor: L.GREEN },
  vpNotYet: { backgroundColor: '#D68A3C', borderColor: '#D68A3C' },
  vpT: { fontFamily: Fonts.ttDemiBold, fontSize: 11.5 },

  empty: { fontFamily: Fonts.ttRegular, fontSize: 13, lineHeight: 19, color: L.INK_62, paddingVertical: 12, paddingHorizontal: 2 },
});
