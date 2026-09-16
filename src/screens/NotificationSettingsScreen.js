import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fonts } from '../theme';
import { getUser, saveUserPreferences } from '../storage/storage';
import TabHeader, { useIsParentAccount } from '../components/TabHeader';
import StyleTitle from '../components/StyleTitle';

// ─── Notification settings (docs/design/notifications.html) ───────────────────
// One switch per notification the app really sends a dancer, under the
// design's four headings. "Lesson summary ready" keeps its existing column
// (notify_lesson_ready); the rest live in users.notification_prefs. Requests
// from a coach or a partner aren't switchable. Saved only for now: nothing
// that sends notifications reads them yet.
const PAGE = '#F2F0EB';
const INK = '#0A0A0A';
const INK_55 = 'rgba(10,10,10,0.55)';
const INK_50 = 'rgba(10,10,10,0.5)';
const INK_45 = 'rgba(10,10,10,0.45)';
const INK_42 = 'rgba(10,10,10,0.42)';
const HAIR = 'rgba(10,10,10,0.07)';
const GOLD = '#E8B530';
const GOLD_INK = '#8A6414';
const SIDE = 20;

const DEFAULT_PREFS = {
  new_focus_point: true,   // focus_point_added — the coach validated one
  coach_comments: true,    // a comment on one of your focus points
  attendance: true,        // group_class_attendance / attendance_check
  milestones: true,        // a focus point mastered
  focus_reviews: true,     // merge_request_student — two may be the same
  push: 'on',
  quiet: 'off',
  paused_until: null,
};
const QUIET_HOURS = [
  { key: 'off', label: 'Off' },
  { key: '21-7', label: '21:00 – 7:00' },
  { key: '22-8', label: '22:00 – 8:00' },
  { key: '23-7', label: '23:00 – 7:00' },
];

const labelOf = (list, key) => (list.find((o) => o.key === key) || list[0]).label;
const firstName = (name) => (name || '').trim().split(/\s+/)[0] || '';

function Toggle({ value, onChange, disabled }) {
  const t = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: value ? 1 : 0, duration: 200, useNativeDriver: false }).start();
  }, [value, t]);
  return (
    <TouchableOpacity
      onPress={() => !disabled && onChange(!value)}
      activeOpacity={disabled ? 1 : 0.8}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Animated.View
        style={[sw.track, {
          backgroundColor: t.interpolate({ inputRange: [0, 1], outputRange: ['rgba(10,10,10,0.16)', GOLD] }),
        }, disabled && { opacity: 0.55 }]}
      >
        <Animated.View style={[sw.knob, { transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, 18] }) }] }]} />
      </Animated.View>
    </TouchableOpacity>
  );
}

function Section({ title, side }) {
  return (
    <View style={st.section}>
      <Text style={st.sectionTitle}>{title}</Text>
      {side ? <Text style={st.sectionSide} numberOfLines={1}>{side}</Text> : null}
    </View>
  );
}

function RowText({ title, sub, dim }) {
  return (
    <View style={st.rowText}>
      <Text style={[st.rowTitle, dim && { color: INK_50 }]}>{title}</Text>
      {sub ? <Text style={st.rowSub} numberOfLines={2}>{sub}</Text> : null}
    </View>
  );
}

function SwitchRow({ title, sub, value, onChange, disabled, first }) {
  return (
    <View style={[st.row, !first && st.rowSep]}>
      <RowText title={title} sub={sub} dim={!value} />
      <Toggle value={value} onChange={onChange} disabled={disabled} />
    </View>
  );
}

function ValueRow({ title, sub, value, onPress, disabled, first }) {
  return (
    <TouchableOpacity
      style={[st.row, !first && st.rowSep, disabled && { opacity: 0.45 }]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <RowText title={title} sub={sub} />
      <Text style={st.value} numberOfLines={1}>{value}</Text>
      <Ionicons name="chevron-forward" size={13} color="rgba(10,10,10,0.3)" />
    </TouchableOpacity>
  );
}

function SegRow({ title, sub, options, value, onChange, first }) {
  return (
    <View style={[st.row, !first && st.rowSep]}>
      <RowText title={title} sub={sub} />
      <View style={st.seg}>
        {options.map((o) => {
          const on = o.key === value;
          return (
            <TouchableOpacity
              key={o.key}
              style={[st.segBtn, on && st.segBtnOn]}
              onPress={() => onChange(o.key)}
              activeOpacity={0.8}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
            >
              <Text style={[st.segTxt, on && st.segTxtOn]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function pausedLabel(iso) {
  const until = new Date(iso);
  const now = new Date();
  const time = `${until.getHours()}:${String(until.getMinutes()).padStart(2, '0')}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  return `Paused until ${sameDay(until, now) ? 'today' : sameDay(until, tomorrow) ? 'tomorrow' : until.toLocaleDateString()} ${time}`;
}

export default function NotificationSettingsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const isParent = useIsParentAccount();
  const [user, setUser] = useState(null);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [lessonReady, setLessonReady] = useState(true);
  const [coachName, setCoachName] = useState(route?.params?.coachName || null);
  const [partnerName, setPartnerName] = useState(null);

  useEffect(() => {
    let alive = true;
    getUser().then((u) => {
      if (!alive || !u) return;
      setUser(u);
      setPrefs({ ...DEFAULT_PREFS, ...(u.notification_prefs || {}) });
      setLessonReady(u.notify_lesson_ready ?? true);
    }).catch(() => {});
    // Coach and partner names from the Stats and Train caches — no round-trip.
    AsyncStorage.multiGet(['@cache_profile', '@cache_home_couple']).then(([[, profile], [, couple]]) => {
      if (!alive) return;
      const p = profile && JSON.parse(profile);
      const coach = p?.myCoach?.name || p?.latinCoach?.name || p?.ballroomCoach?.name;
      if (coach) setCoachName((n) => n || coach);
      const partner = couple && JSON.parse(couple)?.couple?.partner?.name;
      if (partner) setPartnerName(partner);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  function notSaved() {
    Alert.alert('Could not save', 'That setting was not changed. Check your connection and try again.');
  }

  function setPref(key, value) {
    const before = prefs;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    saveUserPreferences({ notification_prefs: next }).catch(() => { setPrefs(before); notSaved(); });
  }

  function setColumn(field, value, set, before) {
    set(value);
    saveUserPreferences({ [field]: value }).catch(() => { set(before); notSaved(); });
  }

  function pick(title, options, key) {
    Alert.alert(title, undefined, [
      ...options.map((o) => ({ text: o.label, onPress: () => setPref(key, o.key) })),
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const paused = prefs.paused_until && new Date(prefs.paused_until) > new Date();
  const coachFirst = firstName(coachName);
  const who = coachFirst || 'Your coach';

  const dancerStyle = user?.dance_style || '';
  const styleLabel = dancerStyle.includes('Latin') && dancerStyle.includes('Ballroom') ? 'Latin & Ballroom'
    : dancerStyle.includes('Ballroom') ? 'Ballroom'
    : dancerStyle.includes('Latin') ? 'Latin'
    : 'Notifications';
  const dancers = [firstName(user?.name), firstName(partnerName)].filter(Boolean).join(' & ');
  const headerSub = [dancers, isParent ? 'parent’s account' : null].filter(Boolean).join(' · ') || null;

  return (
    <View style={{ flex: 1, backgroundColor: PAGE }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <TabHeader
          navigation={navigation}
          style={st.header}
          onBack={() => navigation.goBack()}
          lead={<StyleTitle label={styleLabel} sub={headerSub} />}
        />

        <Text style={st.title}>Notification settings</Text>
        <Text style={st.lead}>
          {who} and your partner can always reach you with a request — everything else is yours to switch off.
        </Text>

        <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
          <Section title="From your coach" side={coachName} />
          <View style={st.card}>
            <SwitchRow first title="New focus points"
              sub={`When ${coachFirst || 'your coach'} validates a focus point from your lesson`}
              value={prefs.new_focus_point} onChange={(v) => setPref('new_focus_point', v)} />
            <SwitchRow title="Lesson summary ready" sub="When your lesson is transcribed and ready to read"
              value={lessonReady} onChange={(v) => setColumn('notify_lesson_ready', v, setLessonReady, lessonReady)} />
            <SwitchRow title="Comments"
              sub={`When ${coachFirst || 'your coach'} comments on one of your focus points`}
              value={prefs.coach_comments} onChange={(v) => setPref('coach_comments', v)} />
          </View>

          <Section title="Classes" />
          <View style={st.card}>
            <SwitchRow first title="Attendance check-ins"
              sub={`When ${coachFirst || 'your coach'} asks whether you were at a group class`}
              value={prefs.attendance} onChange={(v) => setPref('attendance', v)} />
          </View>

          <Section title="Your training" />
          <View style={st.card}>
            <SwitchRow first title="Focus points mastered" sub="When one of your focus points is cleared"
              value={prefs.milestones} onChange={(v) => setPref('milestones', v)} />
            <SwitchRow title="Possible duplicates" sub="When two of your focus points may be the same"
              value={prefs.focus_reviews} onChange={(v) => setPref('focus_reviews', v)} />
          </View>

          <Section title="Delivery" />
          <View style={st.card}>
            <SegRow first title="Push" sub="On this phone"
              options={[{ key: 'on', label: 'ON' }, { key: 'off', label: 'OFF' }]}
              value={prefs.push} onChange={(v) => setPref('push', v)} />
            <ValueRow title="Quiet hours" sub="Nothing buzzes between these times"
              value={labelOf(QUIET_HOURS, prefs.quiet)}
              onPress={() => pick('Quiet hours', QUIET_HOURS, 'quiet')} />
          </View>
          <Text style={st.note}>Everything still lands in Notifications — these settings only decide what reaches your phone.</Text>
        </ScrollView>

        <View style={[st.foot, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <LinearGradient
            colors={['rgba(242,240,235,0)', PAGE]}
            locations={[0, 0.34]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <TouchableOpacity
            style={[st.mute, paused && st.muteOn]}
            onPress={() => setPref('paused_until', paused ? null : new Date(Date.now() + 24 * 3600 * 1000).toISOString())}
            activeOpacity={0.85}
          >
            <Ionicons name="notifications-off-outline" size={16} color={paused ? '#FFFFFF' : INK} />
            <Text style={[st.muteTxt, paused && { color: '#FFFFFF' }]}>
              {paused ? pausedLabel(prefs.paused_until) : 'Pause all for 24 hours'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const sw = StyleSheet.create({
  track: { width: 46, height: 28, borderRadius: 14, padding: 3 },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', shadowColor: INK, shadowOpacity: 0.28, shadowOffset: { width: 0, height: 1 }, shadowRadius: 3, elevation: 2 },
});

const st = StyleSheet.create({
  header: { paddingTop: 6, paddingBottom: 0 },
  title: { fontFamily: Fonts.ttBold, fontSize: 25, letterSpacing: -0.88, lineHeight: 28, color: INK, paddingTop: 18, paddingHorizontal: SIDE },
  lead: { fontFamily: Fonts.ttRegular, fontSize: 12.5, lineHeight: 18, color: INK_55, paddingTop: 6, paddingHorizontal: SIDE, maxWidth: 300 },
  scroll: { paddingHorizontal: SIDE, paddingTop: 4, paddingBottom: 14 },
  section: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, paddingTop: 18, paddingBottom: 8, paddingHorizontal: 2 },
  sectionTitle: { fontFamily: Fonts.ttDemiBold, fontSize: 9.5, letterSpacing: 1.6, textTransform: 'uppercase', color: INK_45 },
  sectionSide: { fontFamily: Fonts.ttRegular, fontSize: 11, letterSpacing: 0.44, color: INK_42, flexShrink: 1 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: HAIR, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 13, paddingHorizontal: 15 },
  rowSep: { borderTopWidth: 1, borderTopColor: HAIR },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontFamily: Fonts.ttDemiBold, fontSize: 14.5, letterSpacing: -0.22, lineHeight: 19, color: INK },
  rowSub: { fontFamily: Fonts.ttRegular, fontSize: 11.5, lineHeight: 15.5, color: INK_55 },
  value: { fontFamily: Fonts.ttDemiBold, fontSize: 13, color: GOLD_INK, flexShrink: 0 },
  seg: { flexDirection: 'row', gap: 3, backgroundColor: '#F4F2EC', borderRadius: 999, padding: 3 },
  segBtn: { borderRadius: 999, paddingVertical: 6, paddingHorizontal: 11 },
  segBtnOn: { backgroundColor: INK },
  segTxt: { fontFamily: Fonts.ttBold, fontSize: 10.5, letterSpacing: 0.63, color: INK_50 },
  segTxtOn: { color: '#FFFFFF' },
  note: { paddingTop: 12, paddingHorizontal: 4, fontFamily: Fonts.ttRegular, fontSize: 11.5, lineHeight: 17, color: INK_50 },
  foot: { paddingHorizontal: SIDE, paddingTop: 10 },
  mute: { height: 52, borderRadius: 999, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(10,10,10,0.12)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  muteOn: { backgroundColor: INK, borderColor: INK },
  muteTxt: { fontFamily: Fonts.ttDemiBold, fontSize: 14.5, letterSpacing: -0.15, color: INK },
});
