// ───────────────────────────────────────────────────────────────────────
// SyncReminderModal — the evening "your class audio is still missing" wall.
//
// The nightly push tells a coach; this makes sure they can't drift past it.
// Purely presentational: WHEN it shows is decided by services/syncReminder.js
// through DjiSyncContext. Mounted once at the coach-navigator level (next to
// MicSyncFlowModal) so it covers every coach screen.
//
// Built to the "warm dark premium" design: one focal point (the student's
// face, not a mic), one sentence, hairlines instead of cards, an ember glow
// low on the screen. Escalation is temperature — gold at night 1, amber from
// night 3 — never a warning triangle.
//
// It is always skippable, but the way out costs more each night (see
// skipDelayMsFor / asksReason):
//   night 1   "Not tonight" is right there
//   night 2   it appears after 5s, then asks what's blocking
//   night 3+  10s, same question, amber
//
// Views: a (the ask) · reasons · lost (confirm) · done (1.5s, self-dismissing)
// ───────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Animated,
  Easing,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  Image as SvgImage,
  Pattern,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { Fonts } from '../theme';
import { useDjiSync } from '../context/DjiSyncContext';
import { skipDelayMsFor, asksReason, nightsWaiting, MAX_TIER } from '../services/syncReminder';

const GRAIN_IMG = require('../../assets/grain-warm.png');

// ─── Palette ────────────────────────────────────────────────────────────
const BG = '#0A0806';
const GOLD = '#E8B530';
const GOLD_S = '#F6D27A';
const AMBER = '#E0872C';
const AMBER_S = '#F3BA83';
const FG = '#F8F3EA';
const FG2 = 'rgba(248,243,234,0.54)';
const FG3 = 'rgba(248,243,234,0.30)';
const HAIR = 'rgba(255,235,200,0.10)';
const HAIR2 = 'rgba(255,235,200,0.16)';

// Fixed by design: the lesson is taught, the notes are written — the import is
// genuinely the last step. It's a statement, not a measurement.
const PROGRESS_PCT = 90;
const ROWS_MAX_H = 200;
const DONE_DWELL_MS = 1500;
const EXPAND_MS = 320;
// Faces stop reading as faces past a handful — beyond this the hero becomes a
// cluster instead of one portrait.
const CLUSTER_FROM = 5;

const AVATAR_PALETTE = ['#C9873A', '#4AAF52', '#3DA5D9', '#EC6B8B', '#6C63FF'];

function initialOf(name) {
  const t = (name || '').trim();
  return t ? t[0].toUpperCase() : '?';
}

function avatarColorFor(id) {
  if (!id) return AVATAR_PALETTE[0];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

// ─── Formatters ─────────────────────────────────────────────────────────
function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isYesterday(date, now) {
  return sameDay(date, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
}

/** Row meta — today shows the hour it ended, anything older shows the day. */
function fmtWhen(date, now) {
  if (sameDay(date, now)) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  if (isYesterday(date, now)) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'short' });
}

/** Prose form — "tonight" / "yesterday" / "Monday" / "Mon 13 Jul" past a week. */
function fmtWhenLong(date, now) {
  if (sameDay(date, now)) return 'tonight';
  if (isYesterday(date, now)) return 'yesterday';
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()) -
      new Date(date.getFullYear(), date.getMonth(), date.getDate())) /
      86400000,
  );
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtDuration(sec) {
  if (!sec || sec <= 0) return null;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}`;
}

/** Before noon — the side of the day that decides "tonight" vs "tomorrow". */
function isMorningNow() {
  return new Date().getHours() < 12;
}

function labelFor(row) {
  if (row.studentName) return row.studentName;
  if (row.lessonType === 'group') return 'Group class';
  if (row.lessonType === 'couple') return 'Couple class';
  return 'Private class';
}

const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const ORD = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth'];
const numWord = (n) => NUM[n] ?? String(n);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ─── Copy ladder ────────────────────────────────────────────────────────
// Every headline is [before, highlighted, after] so the accent colour can
// carry the escalation without a second string to keep in sync.
function copyFor({ tier, nights, rows, oldest, now }) {
  const count = rows.length;
  const who = labelFor(oldest);
  const when = fmtWhenLong(oldest.endedAt ?? oldest.startedAt, now);
  const auto = 'Everything after the import is automatic.';

  if (tier >= MAX_TIER) {
    return {
      eyebrow: nights <= 9 ? `${ORD[nights]} night` : `${nights} nights waiting`,
      hot: true,
      title:
        count >= CLUSTER_FROM
          ? [`${cap(numWord(count))} lessons, and `, `${who} since ${when}`, '.']
          : [`${who} has been waiting `, `${numWord(nights)} nights`, '.'],
      sub:
        count >= CLUSTER_FROM
          ? 'One import clears the whole backlog.'
          : `Nothing to train with since ${when}. ${auto}`,
    };
  }

  if (tier === 2) {
    return {
      eyebrow: 'Second night',
      hot: false,
      title:
        count === 1
          ? [`${who} has been waiting `, 'two nights', '.']
          : [`${cap(numWord(count))} lessons have been waiting `, `since ${when}`, '.'],
      sub: `Nothing to train with since ${when}. ${auto}`,
    };
  }

  return {
    eyebrow: 'Tonight',
    hot: false,
    title:
      count === 1
        ? [`${who} is waiting for `, 'their focus points', '.']
        : [`${cap(numWord(count))} lessons are waiting for `, 'their focus points', '.'],
    sub: 'Plug in the receiver and the rest happens on its own.',
  };
}

// ─── Bits ───────────────────────────────────────────────────────────────

/**
 * `fill` makes it stretch to its parent instead of taking a fixed size — that's
 * what lets the portrait ride the container's shrink animation smoothly rather
 * than snapping between two hard sizes when the list opens.
 */
function Avatar({ row, size, fontSize, fill }) {
  const box = fill
    ? { width: '100%', height: '100%' }
    : { width: size, height: size, borderRadius: size / 2 };
  const uri = row.studentAvatarUrl;
  if (uri) {
    return <Image source={{ uri }} style={box} contentFit="cover" />;
  }
  return (
    <View style={[s.avFallback, box, { backgroundColor: `${avatarColorFor(row.id)}2E` }]}>
      <Text style={[s.avLetter, { fontSize }]}>{initialOf(labelFor(row))}</Text>
    </View>
  );
}

/**
 * The ember low on the screen, the halo lifting the portrait, and the grain
 * over both.
 *
 * The grain is an SVG <Pattern> rather than an <Image resizeMode="repeat">:
 * that resize mode draws the texture ONCE at its natural size (a visible
 * 96pt square in the corner) instead of tiling. A pattern tiles for real, and
 * it costs nothing extra — the glows already needed this Svg layer.
 */
function Backdrop({ hot }) {
  const c = hot ? '224,135,44' : '232,181,48';
  const h = hot ? '224,135,44' : '246,210,122';
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id="emb" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={`rgb(${c})`} stopOpacity={hot ? 0.24 : 0.22} />
          <Stop offset="0.45" stopColor={`rgb(${c})`} stopOpacity={0.06} />
          <Stop offset="0.68" stopColor={`rgb(${c})`} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={`rgb(${h})`} stopOpacity={hot ? 0.12 : 0.11} />
          <Stop offset="0.64" stopColor={`rgb(${h})`} stopOpacity={0} />
        </RadialGradient>
        <Pattern id="grain" patternUnits="userSpaceOnUse" x="0" y="0" width="96" height="96">
          <SvgImage href={GRAIN_IMG} x="0" y="0" width="96" height="96" preserveAspectRatio="none" />
        </Pattern>
      </Defs>
      <Ellipse cx="50%" cy="100%" rx="260" ry="200" fill="url(#emb)" />
      <Ellipse cx="50%" cy="150" rx="150" ry="115" fill="url(#halo)" />
      {/* Last, so the texture sits over the glows as it does in the mockup. */}
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#grain)" opacity={0.09} />
    </Svg>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Countdown ring that empties while "Not tonight" is still hidden. */
function SkipRing({ progress }) {
  const C = 2 * Math.PI * 8;
  return (
    <Svg width={14} height={14} viewBox="0 0 20 20">
      <Circle cx="10" cy="10" r="8" fill="none" stroke="rgba(248,243,234,0.12)" strokeWidth="2" />
      <AnimatedCircle
        cx="10"
        cy="10"
        r="8"
        fill="none"
        stroke="rgba(248,243,234,0.4)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={progress.interpolate({ inputRange: [0, 1], outputRange: [C, 0] })}
        transform="rotate(-90 10 10)"
      />
    </Svg>
  );
}

export default function SyncReminderModal() {
  const sync = useDjiSync();
  const insets = useSafeAreaInsets();

  const {
    reminderOpen = false,
    reminderTier = 1,
    reminderNights = 1,
    reminderPending = [],
    reminderImportNow,
    snoozeReminder,
    remindTomorrowMorning,
    dismissReminder,
    abandonReminderPending,
    hasFolderAccess = true,
  } = sync ?? {};

  const [view, setView] = useState('a');
  const [reason, setReason] = useState('tomorrow');
  const [doneKind, setDoneKind] = useState('later');
  const [skipReady, setSkipReady] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [rowsScrollable, setRowsScrollable] = useState(false);
  const [rowsAtEnd, setRowsAtEnd] = useState(false);
  const [rowsContentH, setRowsContentH] = useState(0);

  const expand = useRef(new Animated.Value(0)).current;
  const countdown = useRef(new Animated.Value(0)).current;
  const enter = useRef(new Animated.Value(0)).current;
  // What to run once the "done" card has had its moment on screen. Every one of
  // these closes the modal, so the action IS the dismissal.
  const doneActionRef = useRef(null);

  const now = useMemo(() => new Date(), [reminderOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = reminderPending;
  const count = rows.length;
  const oldest = useMemo(() => {
    if (!count) return null;
    return rows.reduce((acc, r) =>
      (r.endedAt ?? r.startedAt) < (acc.endedAt ?? acc.startedAt) ? r : acc,
    );
  }, [rows, count]);

  const copy = oldest ? copyFor({ tier: reminderTier, nights: reminderNights, rows, oldest, now }) : null;
  const hot = !!copy?.hot;
  const accent = hot ? AMBER : GOLD;
  const accentSoft = hot ? AMBER_S : GOLD_S;

  // ─── Open: reset everything, run the entrance, arm the skip delay ──────
  // Entrance — replayed on every view change so the reasons / lost / done
  // screens arrive with the same cascade rather than snapping into place.
  useEffect(() => {
    if (!reminderOpen) return;
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [reminderOpen, view, enter]);

  useEffect(() => {
    if (!reminderOpen) return undefined;
    setView('a');
    setReason('tomorrow');
    setExpanded(false);
    expand.setValue(0);

    const delay = skipDelayMsFor(reminderTier);
    countdown.setValue(0);
    if (delay <= 0) {
      setSkipReady(true);
      return undefined;
    }
    setSkipReady(false);
    Animated.timing(countdown, {
      toValue: 1,
      duration: delay,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
    const t = setTimeout(() => setSkipReady(true), delay);
    return () => clearTimeout(t);
  }, [reminderOpen, reminderTier, expand, enter, countdown]);

  // ─── The done card dwells, then its action closes the modal ───────────
  useEffect(() => {
    if (view !== 'done') return undefined;
    const t = setTimeout(() => {
      const run = doneActionRef.current;
      doneActionRef.current = null;
      run?.();
    }, DONE_DWELL_MS);
    return () => clearTimeout(t);
  }, [view]);

  const goDone = useCallback((kind, action) => {
    setDoneKind(kind);
    doneActionRef.current = action;
    setView('done');
  }, []);

  const toggleList = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    Animated.timing(expand, {
      toValue: next ? 1 : 0,
      duration: EXPAND_MS,
      // Symmetric ease-in-out. The aggressive ease-out curves (CSS's
      // .2,.7,.2,1 and ease-out-quint) launch fast and coast — lively, but it
      // reads as whippy on a block of text and type. A restrained S-curve is
      // the sober register this screen is asking for.
      easing: Easing.inOut(Easing.cubic),
      // Layout props (width / fontSize / maxHeight) can't use the native
      // driver. The cost is per animated PROPERTY per frame, so the smoothness
      // work was cutting their number (constant border radii and cluster
      // offsets instead of animated ones), not changing the curve.
      useNativeDriver: false,
      isInteraction: false,
    }).start();
  }, [expanded, expand]);

  const onSkip = useCallback(() => {
    if (!skipReady) return;
    if (asksReason(reminderTier)) setView('reasons');
    else dismissReminder?.();
  }, [skipReady, reminderTier, dismissReminder]);

  const onConfirmReason = useCallback(() => {
    if (reason === 'lost') {
      setView('lost');
      return;
    }
    if (reason === 'mic') {
      // "The mic isn't with me" means "not right now" — so we come back at the
      // next moment they plausibly have it, which depends on when they're
      // answering. Read the clock at CONFIRM time, not at open: the wall can sit
      // on screen a while, and a card promising "tonight" at 12:01 would be a
      // lie by one minute.
      if (isMorningNow()) {
        // Answering in the morning: the evening gate fires on its own tonight,
        // so there's nothing to schedule — just close.
        goDone('micTonight', () => dismissReminder?.());
      } else {
        goDone('micMorning', () => remindTomorrowMorning?.());
      }
      return;
    }
    goDone('morning', () => remindTomorrowMorning?.());
  }, [reason, goDone, dismissReminder, remindTomorrowMorning]);

  // Android back mirrors the visible exit — never a dead end, never a free pass
  // while the skip is still counting down.
  const onRequestClose = useCallback(() => {
    if (view === 'lost') setView('reasons');
    else if (view === 'reasons') setView('a');
    else if (view === 'a') onSkip();
  }, [view, onSkip]);

  if (!sync || !oldest) return null;

  // ─── Interpolations for the "hero gives its space to the list" move ────
  const i = (from, to) => expand.interpolate({ inputRange: [0, 1], outputRange: [from, to] });

  // Fade the list's bottom edge only while there's more to scroll to — at the
  // end the mask would just dim the last row for no reason.
  const showRowsFade = rowsScrollable && !rowsAtEnd;

  // The one animated layout property on this screen. `rowsWrap` adds a top
  // hairline and 8pt of padding, hence the +9.
  const openH = Math.min(rowsContentH, ROWS_MAX_H) + (rowsContentH > 0 ? 9 : 0);
  const listHeight = expand.interpolate({ inputRange: [0, 1], outputRange: [0, openH] });

  const doneSubRaw = DONE_COPY[doneKind]?.s;
  const doneSub = typeof doneSubRaw === 'function' ? doneSubRaw(labelFor(oldest)) : doneSubRaw;

  /**
   * Staggered entrance. One value drives every block through a sliding slice of
   * its own, so they rise in sequence without six timers. JS-driven on purpose:
   * these same nodes carry the layout animations of the expand, and a node
   * can't mix native- and JS-driven props.
   */
  const rise = (order) => {
    const from = order * 0.09;
    const to = from + 0.45;
    return {
      opacity: enter.interpolate({ inputRange: [from, to], outputRange: [0, 1], extrapolate: 'clamp' }),
      transform: [
        {
          translateY: enter.interpolate({
            inputRange: [from, to],
            outputRange: [14, 0],
            extrapolate: 'clamp',
          }),
        },
      ],
    };
  };
  const ringSize = i(104, 62);
  const faceSize = i(70, 44);
  const clusterSize = i(56, 40);

  const names = rows.map((r) => labelFor(r));
  const summary =
    count === 1
      ? names[0]
      : `${names.slice(0, 2).join(', ')}${count > 2 ? ` +${count - 2}` : ''}`;

  return (
    <Modal
      visible={reminderOpen}
      animationType="fade"
      transparent={false}
      onRequestClose={onRequestClose}
      statusBarTranslucent
    >
      <View style={s.stage}>
        <Backdrop hot={hot} />

        <View
          style={[
            s.safe,
            {
              paddingTop: Math.max(insets.top, 10) + 6,
              paddingBottom: Math.max(insets.bottom, 10),
            },
          ]}
        >
          {/* ── A · the ask ────────────────────────────────────────────── */}
          {view === 'a' && (
            <View style={s.view}>
              <ScrollView
                style={s.zone}
                contentContainerStyle={s.zoneContent}
                showsVerticalScrollIndicator={false}
                bounces={false}
              >
                <Animated.View style={[s.eyebrowRow, { marginTop: 'auto' }, rise(0)]}>
                  <View style={[s.eyebrowDot, { backgroundColor: accent }]} />
                  <Text style={[s.eyebrow, { color: accentSoft }]}>
                    {copy.eyebrow.toUpperCase()}
                  </Text>
                </Animated.View>

                <Animated.View style={[s.focal, rise(1)]}>
                  {count >= CLUSTER_FROM ? (
                    <View style={s.cluster}>
                      {rows.slice(0, 3).map((r, idx) => (
                        <Animated.View
                          key={r.id}
                          style={[
                            s.clusterItem,
                            {
                              marginLeft: idx === 0 ? 0 : -15,
                            },
                          ]}
                        >
                          <Avatar row={r} fill fontSize={17} />
                        </Animated.View>
                      ))}
                      <Animated.View
                        style={[
                          s.clusterItem,
                          s.clusterMore,
                          {
                            marginLeft: -15,
                          },
                        ]}
                      >
                        <Text style={s.clusterMoreText}>+{count - 3}</Text>
                      </Animated.View>
                    </View>
                  ) : (
                    <View style={s.ring}>
                      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 104 104">
                        <Circle
                          cx="52"
                          cy="52"
                          r="49"
                          fill="none"
                          stroke={hot ? 'rgba(224,135,44,0.66)' : 'rgba(246,210,122,0.5)'}
                          strokeWidth={hot ? 1.4 : 1.3}
                          strokeDasharray="3 10"
                          strokeLinecap="round"
                        />
                      </Svg>
                      <View style={s.face}>
                        <Avatar row={oldest} fill fontSize={23} />
                      </View>
                    </View>
                  )}
                </Animated.View>

                {/* NOTHING up here resizes on expand. The only thing that
                    animates is the list's height below; because the block is
                    optically centred between two auto margins, growing it
                    lifts everything above on its own. That's the whole move —
                    no shrinking type, no reflowing headline, no six properties
                    fighting each other on the JS thread. */}
                <Animated.View style={rise(2)}>
                  <Text style={s.h1}>
                    {copy.title[0]}
                    <Text style={{ color: accentSoft }}>{copy.title[1]}</Text>
                    {copy.title[2]}
                  </Text>
                </Animated.View>

                <Animated.Text style={[s.sub, rise(3)]}>{copy.sub}</Animated.Text>

                <Animated.View style={[s.prog, rise(4)]}>
                  <View style={s.progRow}>
                    <View style={s.track}>
                      <View style={[s.fill, { width: `${PROGRESS_PCT}%` }]}>
                        <LinearGradient
                          colors={[`${accent}73`, accent]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={StyleSheet.absoluteFill}
                        />
                      </View>
                      {/* Sits outside the clipped fill so the glowing head can
                          overhang the 3px track. */}
                      <View
                        style={[s.fillHead, { left: `${PROGRESS_PCT}%`, backgroundColor: accent }]}
                      />
                    </View>
                    <Text style={[s.progVal, { color: accentSoft }]}>{PROGRESS_PCT}%</Text>
                  </View>
                  <Text style={s.progHint}>ONLY THE IMPORT IS LEFT</Text>
                </Animated.View>

                {/* Quiet hairline block — a card here would look like an alert */}
                <Animated.View style={[s.pending, { marginBottom: 'auto' }, rise(5)]}>
                  <TouchableOpacity style={s.pendHead} onPress={toggleList} activeOpacity={0.75}>
                    <View style={s.miniStack}>
                      {rows.slice(0, 3).map((r, idx) => (
                        <View key={r.id} style={[s.mini, idx > 0 && { marginLeft: -9 }]}>
                          <Avatar row={r} size={24} fontSize={10.5} />
                        </View>
                      ))}
                    </View>
                    <Text style={s.pendName} numberOfLines={1}>
                      {summary}
                    </Text>
                    <Text style={s.pendCount}>
                      {count} {count === 1 ? 'lesson' : 'lessons'}
                    </Text>
                    <Animated.View
                      style={{
                        transform: [
                          { rotate: i('0deg', '180deg') },
                        ],
                      }}
                    >
                      <Ionicons name="chevron-down" size={14} color={FG3} />
                    </Animated.View>
                  </TouchableOpacity>

                  {/* Always mounted, opened by height — a conditional render
                      would pop the list in at full size while the margins
                      around it animated, which is what made the old version
                      feel broken. `openH` is the measured content, capped, so
                      one row opens to one row's worth. */}
                  <Animated.View style={{ height: listHeight, overflow: 'hidden' }}>
                    <View style={s.rowsWrap}>
                      {/* A real alpha mask, like the mockup's mask-image — the
                          rows dissolve instead of being cut. An overlay
                          gradient can't do this here: it would have to fake the
                          background, and the ember glow behind the list isn't a
                          flat colour. */}
                      <MaskedView
                        style={{ maxHeight: ROWS_MAX_H }}
                        maskElement={
                          <LinearGradient
                            colors={
                              showRowsFade
                                ? ['#000', '#000', 'rgba(0,0,0,0.55)', 'transparent']
                                : ['#000', '#000']
                            }
                            locations={showRowsFade ? [0, 0.62, 0.84, 1] : [0, 1]}
                            style={{ flex: 1 }}
                          />
                        }
                      >
                      <ScrollView
                        style={{ maxHeight: ROWS_MAX_H }}
                        nestedScrollEnabled
                        showsVerticalScrollIndicator={false}
                        onContentSizeChange={(_w, h) => {
                          setRowsScrollable(h > ROWS_MAX_H + 2);
                          // Drives how far the block opens — one row opens to
                          // one row, six open to the cap.
                          setRowsContentH((prev) => (prev === h ? prev : h));
                        }}
                        scrollEventThrottle={16}
                        onScroll={(e) => {
                          const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
                          const atEnd =
                            contentOffset.y + layoutMeasurement.height >= contentSize.height - 2;
                          // Only on the transition — this fires every frame.
                          setRowsAtEnd((prev) => (prev === atEnd ? prev : atEnd));
                        }}
                      >
                        {rows.map((r, idx) => {
                          const when = r.endedAt ?? r.startedAt;
                          const n = nightsWaiting(when, now);
                          const dur = fmtDuration(r.durationSec);
                          return (
                            <View key={r.id} style={[s.lrow, idx > 0 && s.lrowSep]}>
                              <View style={s.lavatar}>
                                <Avatar row={r} size={24} fontSize={10.5} />
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={s.lname} numberOfLines={1}>
                                  {labelFor(r)}
                                </Text>
                                <Text style={s.lmeta}>
                                  {fmtWhen(when, now)}
                                  {dur ? `  ·  ${dur}` : ''}
                                </Text>
                              </View>
                              <Text style={[s.lnights, n >= MAX_TIER && { color: accentSoft }]}>
                                {n} {n === 1 ? 'NIGHT' : 'NIGHTS'}
                              </Text>
                            </View>
                          );
                        })}
                      </ScrollView>
                      </MaskedView>
                    </View>
                  </Animated.View>
                </Animated.View>
              </ScrollView>

              <Animated.View style={rise(6)}>
                <TouchableOpacity style={s.cta} onPress={reminderImportNow} activeOpacity={0.9}>
                  <LinearGradient
                    colors={['#F2C654', '#E2A81C']}
                    style={StyleSheet.absoluteFill}
                  />
                  <Text style={s.ctaText}>
                    {hasFolderAccess ? 'Plug in and import' : 'Set up the mic'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => goDone('later', () => snoozeReminder?.())}
                  activeOpacity={0.7}
                >
                  <Text style={s.textBtn}>Remind me in 2 hours</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={onSkip} disabled={!skipReady} activeOpacity={0.7}>
                  <View style={s.exitRow}>
                    {!skipReady && <SkipRing progress={countdown} />}
                    <Text style={[s.exit, !skipReady && s.exitLocked]}>Not tonight</Text>
                  </View>
                </TouchableOpacity>
              </Animated.View>
            </View>
          )}

          {/* ── B · what's blocking ────────────────────────────────────── */}
          {view === 'reasons' && (
            <View style={s.view}>
              <View style={s.eyebrowRow}>
                <View style={[s.eyebrowDot, { backgroundColor: accent }]} />
                <Text style={[s.eyebrow, { color: accentSoft }]}>BEFORE YOU GO</Text>
              </View>
              <Text style={[s.h1, s.h1Small]}>What is stopping the import?</Text>
              <Text style={[s.sub, { marginTop: 13 }]}>
                So tomorrow’s reminder lands the right way.
              </Text>

              <View style={{ marginTop: 20 }}>
                {[
                  {
                    key: 'tomorrow',
                    title: 'I will do it tomorrow',
                    desc: 'Reminder at 08:00',
                    suggested: true,
                  },
                  {
                    key: 'mic',
                    title: 'The mic is not with me',
                    // Must agree with the card that follows, or the sheet
                    // promises one thing and the confirmation another.
                    desc: isMorningNow() ? 'We ask again tonight' : 'Reminder tomorrow morning',
                  },
                  {
                    key: 'lost',
                    title: 'The audio is lost',
                    desc: 'Stops the reminders',
                    warn: true,
                  },
                ].map((opt, idx) => {
                  const sel = reason === opt.key;
                  const tint = opt.warn ? AMBER : GOLD;
                  const tintSoft = opt.warn ? AMBER_S : GOLD_S;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      style={[s.opt, idx === 0 && s.optFirst]}
                      onPress={() => setReason(opt.key)}
                      activeOpacity={0.75}
                    >
                      <View
                        style={[
                          s.radio,
                          sel && { borderColor: tint, backgroundColor: tint },
                        ]}
                      >
                        {sel && <Ionicons name="checkmark" size={12} color="#14110A" />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.optTitle, sel && { color: tintSoft }]}>{opt.title}</Text>
                        <Text style={s.optDesc}>{opt.desc}</Text>
                      </View>
                      {opt.suggested && <Text style={s.suggested}>SUGGESTED</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={{ flex: 1, minHeight: 10 }} />

              <TouchableOpacity style={s.cta} onPress={onConfirmReason} activeOpacity={0.9}>
                <LinearGradient colors={['#F2C654', '#E2A81C']} style={StyleSheet.absoluteFill} />
                <Text style={s.ctaText}>Confirm</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setView('a')} activeOpacity={0.7}>
                <View style={s.backRow}>
                  <Ionicons name="chevron-back" size={13} color={FG3} />
                  <Text style={s.back}>Back to import</Text>
                </View>
              </TouchableOpacity>
            </View>
          )}

          {/* ── C · mark as lost ───────────────────────────────────────── */}
          {view === 'lost' && (
            <View style={s.view}>
              <View style={s.eyebrowRow}>
                <View style={[s.eyebrowDot, { backgroundColor: AMBER }]} />
                <Text style={[s.eyebrow, { color: AMBER_S }]}>MARK AS LOST</Text>
              </View>
              <Text style={[s.h1, s.h1Small]}>
                {count === 1 ? `${labelFor(oldest)} gets ` : `${cap(numWord(count))} lessons get `}
                <Text style={{ color: AMBER_S }}>no focus points</Text>
                {count === 1 ? ' from this lesson.' : '.'}
              </Text>
              <Text style={[s.sub, { marginTop: 13 }]}>
                We stop reminding you. Nothing from{' '}
                {count === 1 ? 'this lesson' : 'these lessons'} ever reaches{' '}
                {count === 1 ? 'them' : 'your students'}.
              </Text>

              <View style={s.affect}>
                {rows.slice(0, 2).map((r) => (
                  <View key={r.id} style={s.affectRow}>
                    <View style={s.lavatar}>
                      <Avatar row={r} size={24} fontSize={10.5} />
                    </View>
                    <Text style={s.affectName}>{labelFor(r)}</Text>
                    <Text style={s.affectMeta}>
                      {fmtWhen(r.endedAt ?? r.startedAt, now)}
                      {fmtDuration(r.durationSec) ? ` · ${fmtDuration(r.durationSec)}` : ''}
                    </Text>
                  </View>
                ))}
                {count > 2 && (
                  <View style={s.affectRow}>
                    <View style={[s.lavatar, s.affectMore]}>
                      <Text style={s.affectMoreText}>+{count - 2}</Text>
                    </View>
                    <Text style={s.affectName}>
                      {cap(numWord(count - 2))} more
                    </Text>
                  </View>
                )}
              </View>

              <Text style={s.reassure}>
                If the {count === 1 ? 'file' : 'files'} ever appear on the receiver,{' '}
                {count === 1 ? 'it' : 'they'} still import on their own.
              </Text>

              <View style={{ flex: 1, minHeight: 10 }} />

              <TouchableOpacity style={s.cta} onPress={() => setView('a')} activeOpacity={0.9}>
                <LinearGradient colors={['#F2C654', '#E2A81C']} style={StyleSheet.absoluteFill} />
                <Text style={s.ctaText}>Keep the reminder</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => goDone('lost', () => abandonReminderPending?.())}
                activeOpacity={0.7}
              >
                <Text style={s.danger}>
                  Mark {count} {count === 1 ? 'lesson' : 'lessons'} as lost
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── D · acknowledgement, then it closes itself ─────────────── */}
          {view === 'done' && (
            <View style={[s.view, s.doneWrap]}>
              <View style={[s.doneRing, { borderColor: `${accent}52` }]}>
                <Ionicons name="checkmark" size={30} color={accent} />
              </View>
              <View>
                <Text style={s.doneH}>{DONE_COPY[doneKind]?.h ?? 'Done'}</Text>
                {/* Some cards are a headline on its own — rendering an empty
                    Text would still push its top margin. */}
                {!!doneSub && <Text style={s.doneS}>{doneSub}</Text>}
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const DONE_COPY = {
  later: { h: 'See you in 2 hours', s: (who) => `${who} stays first in the queue.` },
  morning: { h: 'See you at 08:00' },
  // "The mic isn't with me", answered on either side of noon.
  micTonight: { h: 'See you tonight' },
  micMorning: { h: 'See you tomorrow morning' },
  // "Lost" is the only answer with no way back on the coach's side, so it ends
  // on a human picking it up rather than on a dead end. The ops Telegram alert
  // fires off the same write (notify-audio-lost) — this line is a promise, and
  // it has to be one we actually keep.
  lost: { h: 'Marked as lost', s: "We'll get in touch about this one." },
};

const s = StyleSheet.create({
  stage: { flex: 1, backgroundColor: BG },
  safe: { flex: 1 },
  view: { flex: 1, paddingHorizontal: 26, paddingBottom: 8 },

  zone: { flex: 1 },
  zoneContent: { flexGrow: 1 },

  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 9, alignSelf: 'center' },
  eyebrowDot: { width: 4, height: 4, borderRadius: 2 },
  eyebrow: { fontFamily: Fonts.ttBold, fontSize: 9, letterSpacing: 3.2 },

  focal: { alignItems: "center", marginTop: 26 },
  ring: { width: 104, height: 104, alignItems: "center", justifyContent: "center" },
  face: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,235,200,0.07)',
    borderWidth: 1,
    borderColor: HAIR2,
  },
  avFallback: { alignItems: 'center', justifyContent: 'center' },
  avLetter: { fontFamily: Fonts.ttBold, color: FG },

  cluster: { flexDirection: 'row', alignItems: 'center' },
  clusterItem: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,235,200,0.07)',
    borderWidth: 1,
    borderColor: HAIR2,
  },
  clusterMore: { backgroundColor: 'rgba(255,235,200,0.04)' },
  clusterMoreText: { fontFamily: Fonts.ttDemiBold, fontSize: 13, color: FG2 },

  h1: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 28,
    marginTop: 26,
    color: FG,
    letterSpacing: -0.9,
    lineHeight: 33,
    textAlign: 'center',
  },
  h1Small: { fontSize: 26, marginTop: 26 },
  sub: {
    fontFamily: Fonts.travelsRegular,
    marginTop: 13,
    fontSize: 14,
    lineHeight: 21,
    color: FG2,
    textAlign: 'center',
    overflow: 'hidden',
  },

  prog: { alignSelf: "stretch", marginTop: 24 },
  progRow: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  track: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,235,200,0.11)' },
  fill: { height: '100%', borderRadius: 2, overflow: 'hidden' },
  fillHead: {
    position: 'absolute',
    top: -1,
    marginLeft: -2.5,
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  progVal: { fontFamily: Fonts.ttBold, fontSize: 12.5, letterSpacing: -0.1 },
  progHint: {
    marginTop: 11,
    textAlign: 'center',
    fontFamily: Fonts.ttBold,
    fontSize: 9,
    letterSpacing: 2.4,
    color: FG3,
  },

  pending: { alignSelf: "stretch", marginTop: 26, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIR },
  pendHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15 },
  miniStack: { flexDirection: 'row', alignItems: 'center' },
  mini: {
    width: 26,
    height: 26,
    borderRadius: 13,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,235,200,0.08)',
    borderWidth: 1,
    borderColor: HAIR2,
  },
  pendName: { flex: 1, fontFamily: Fonts.ttDemiBold, fontSize: 14, color: FG, letterSpacing: -0.14 },
  pendCount: { fontFamily: Fonts.ttDemiBold, fontSize: 11.5, color: FG3 },

  rowsWrap: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIR, paddingBottom: 8 },
  lrow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  lrowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,235,200,0.06)' },
  lavatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,235,200,0.07)',
    borderWidth: 1,
    borderColor: HAIR2,
  },
  lname: { fontFamily: Fonts.ttDemiBold, fontSize: 13.5, color: FG },
  lmeta: { fontFamily: Fonts.travelsRegular, fontSize: 11, color: FG3, marginTop: 2 },
  lnights: {
    fontFamily: Fonts.ttBold,
    fontSize: 9.5,
    letterSpacing: 1.2,
    color: FG3,
  },

  cta: {
    alignSelf: 'stretch',
    height: 54,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  ctaText: {
    fontFamily: Fonts.ttBold,
    fontSize: 16,
    letterSpacing: -0.16,
    color: '#14110A',
  },
  textBtn: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 14.5,
    color: FG,
    textAlign: 'center',
    paddingVertical: 14,
  },
  exitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  exit: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 13,
    color: FG3,
    textAlign: 'center',
    paddingVertical: 10,
  },
  exitLocked: { color: 'rgba(248,243,234,0.16)' },

  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 17,
    paddingHorizontal: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIR,
  },
  optFirst: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIR },
  radio: {
    width: 21,
    height: 21,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: HAIR2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optTitle: { fontFamily: Fonts.ttDemiBold, fontSize: 15.5, color: FG, letterSpacing: -0.16 },
  optDesc: { fontFamily: Fonts.travelsRegular, fontSize: 11.5, color: FG3, marginTop: 3 },
  suggested: {
    fontFamily: Fonts.ttBold,
    fontSize: 9,
    letterSpacing: 1.6,
    color: 'rgba(232,181,48,0.7)',
  },
  backRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  back: { fontFamily: Fonts.ttDemiBold, fontSize: 13, color: FG3, paddingVertical: 14 },

  affect: { marginTop: 22, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIR },
  affectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIR,
  },
  affectName: { fontFamily: Fonts.ttDemiBold, fontSize: 14, color: FG },
  affectMeta: { marginLeft: 'auto', fontFamily: Fonts.travelsMedium, fontSize: 11, color: FG3 },
  affectMore: { backgroundColor: 'rgba(255,235,200,0.04)' },
  affectMoreText: { fontFamily: Fonts.ttDemiBold, fontSize: 10.5, color: FG2 },
  reassure: {
    marginTop: 18,
    fontFamily: Fonts.travelsRegular,
    fontSize: 12.5,
    lineHeight: 19,
    color: 'rgba(232,181,48,0.72)',
    textAlign: 'center',
  },
  danger: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 14,
    color: AMBER_S,
    textAlign: 'center',
    paddingVertical: 16,
  },

  doneWrap: { alignItems: 'center', justifyContent: 'center', gap: 18 },
  doneRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(232,181,48,0.1)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneH: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 21,
    color: FG,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  doneS: {
    fontFamily: Fonts.travelsRegular,
    fontSize: 13.5,
    lineHeight: 21,
    color: FG2,
    textAlign: 'center',
    marginTop: 7,
  },
});
