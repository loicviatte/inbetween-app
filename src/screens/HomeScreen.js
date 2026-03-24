import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../theme';
import {
  getUser,
  getTrainingSessionsThisWeek,
  getFocusTrainedCount,
  getTrainingDaysThisWeek,
  getRecentClassInputs,
  getTopFocusPointsWithCounts,
} from '../services/storage';
import { getSlots, getSessionCountForFocus } from '../services/algorithm';
import { generateCoachShareSummary } from '../services/anthropic';
import LogModal from '../components/LogModal';

const SHARE_LOADING_MSGS = ['Gathering your notes...', 'Writing summary...', 'Almost ready...'];

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'MORNING';
  if (h < 18) return 'AFTERNOON';
  return 'EVENING';
}

function ordinal(n) {
  if (!n) return '1st';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function WeekHeatmap({ activeDays }) {
  const todayIdx = (new Date().getDay() + 6) % 7; // Mon=0…Sun=6
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return (
    <View style={h.row}>
      {labels.map((label, i) => {
        const done = activeDays.has(i);
        const isToday = i === todayIdx;
        return (
          <View
            key={i}
            style={[
              h.cell,
              done && h.cellDone,
              isToday && !done && h.cellToday,
            ]}
          >
            <Text
              style={[
                h.label,
                done && h.labelDone,
                isToday && !done && h.labelToday,
              ]}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function HomeScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [slot1, setSlot1] = useState(null);
  const [slot2, setSlot2] = useState(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [sessionsThisWeek, setSessionsThisWeek] = useState(0);
  const [focusCount, setFocusCount] = useState(0);
  const [activeDays, setActiveDays] = useState(new Set());
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [shareState, setShareState] = useState('default'); // 'default' | 'loading' | 'success'
  const [shareLoadingMsg, setShareLoadingMsg] = useState(SHARE_LOADING_MSGS[0]);
  const shareMsgRef = useRef(null);

  async function handleShare() {
    if (shareState === 'loading') return;
    setShareState('loading');
    setShareLoadingMsg(SHARE_LOADING_MSGS[0]);
    let msgIdx = 0;
    shareMsgRef.current = setInterval(() => {
      msgIdx = (msgIdx + 1) % SHARE_LOADING_MSGS.length;
      setShareLoadingMsg(SHARE_LOADING_MSGS[msgIdx]);
    }, 1500);
    try {
      const [recentInputs, topFocusPoints] = await Promise.all([
        getRecentClassInputs(3),
        getTopFocusPointsWithCounts(3),
      ]);
      const summary = await generateCoachShareSummary({
        recentInputs,
        topFocusPoints,
        totalFocusWorked: user?.total_focus_worked || 0,
        lastActiveDate: user?.last_active_date || null,
      });
      clearInterval(shareMsgRef.current);
      await Clipboard.setStringAsync(summary);
      setShareState('success');
    } catch {
      clearInterval(shareMsgRef.current);
      setShareState('default');
      Alert.alert('Something went wrong', 'Try again.');
    }
  }

  async function load() {
    const [u, slots, sessions, fc, days] = await Promise.all([
      getUser(),
      getSlots(),
      getTrainingSessionsThisWeek(),
      getFocusTrainedCount(),
      getTrainingDaysThisWeek(),
    ]);
    setUser(u);
    setSlot1(slots.slot1);
    setSlot2(slots.slot2);
    setSessionsThisWeek(sessions);
    setFocusCount(fc);
    setActiveDays(days || new Set());
    if (slots.slot1?.id) {
      const count = await getSessionCountForFocus(slots.slot1.id);
      setSessionCount(count);
    }
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ── */}
        <View style={s.header}>
          <Text style={s.logo}>EE</Text>
          <TouchableOpacity
            style={s.avatar}
            onPress={() => navigation.navigate('PROFILE')}
            activeOpacity={0.8}
          >
            <Text style={s.avatarText}>
              {user?.name ? user.name[0].toUpperCase() : 'A'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Time of day ── */}
        <Text style={s.timeOfDay}>{getTimeOfDay()}</Text>

        {/* ── Hero card ── */}
        <View style={s.hero}>
          <View style={s.heroBadge}>
            <Text style={s.heroBadgeText}>TODAY'S FOCUS</Text>
          </View>

          <Text style={s.heroWhy} numberOfLines={2}>
            {sessionCount > 0
              ? `You've done this ${sessionCount} time${sessionCount !== 1 ? 's' : ''} — keep drilling here.`
              : 'Your top priority right now. Start your first session.'}
          </Text>

          <Text style={s.heroFocusName} numberOfLines={2}>
            {slot1?.name || 'No focus yet'}
          </Text>

          <Text style={s.heroCount}>{ordinal(sessionCount + 1)} Session</Text>

          <TouchableOpacity
            style={s.startBtn}
            onPress={() => navigation.navigate('TRAIN')}
            activeOpacity={0.88}
          >
            <Text style={s.startBtnText}>Start Now</Text>
          </TouchableOpacity>
        </View>

        {/* ── "or" + alternatives ── */}
        <Text style={s.orLabel}>or</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.altScroll}
        >
          {slot2 && (
            <TouchableOpacity
              style={s.altCard}
              onPress={() => navigation.navigate('TRAIN')}
              activeOpacity={0.8}
            >
              <Text style={s.altLabel}>Try instead</Text>
              <Text style={s.altName} numberOfLines={2}>{slot2.name}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={s.altCard}
            onPress={() => setLogModalVisible(true)}
            activeOpacity={0.8}
          >
            <Text style={s.altLabel}>Just came back</Text>
            <Text style={s.altName}>Log Class</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* ── This Week heatmap ── */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>THIS WEEK</Text>
          <WeekHeatmap activeDays={activeDays} />
        </View>

        {/* ── Share with Coach ── */}
        <View style={s.shareWrap}>
          <Text style={s.shareHint}>Generates a short summary of your recent work and corrections — ready to paste to your coach before a lesson.</Text>
          <TouchableOpacity
            style={[
              s.shareBtn,
              shareState === 'loading' && s.shareBtnLoading,
              shareState === 'success' && s.shareBtnSuccess,
            ]}
            onPress={handleShare}
            activeOpacity={0.82}
            disabled={shareState === 'loading'}
          >
            {shareState === 'loading' ? (
              <View style={s.shareInner}>
                <ActivityIndicator size="small" color="rgba(17,12,17,0.4)" />
                <Text style={s.shareBtnTextLoading}>{shareLoadingMsg}</Text>
              </View>
            ) : shareState === 'success' ? (
              <View style={s.shareInner}>
                <Text style={s.shareBtnTextSuccess}>Copied to clipboard</Text>
                <Text style={s.shareCheckmark}>✓</Text>
              </View>
            ) : (
              <View style={s.shareInner}>
                <Text style={s.shareIconArrow}>↑</Text>
                <Text style={s.shareBtnText}>Share with Coach</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* ── Stats ── */}
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statValue}>{sessionsThisWeek}</Text>
            <Text style={s.statLabel}>This Week</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statValue}>{sessionCount}</Text>
            <Text style={s.statLabel}>Total</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statValue}>{focusCount}</Text>
            <Text style={s.statLabel}>Areas</Text>
          </View>
        </View>
      </ScrollView>

      <LogModal
        visible={logModalVisible}
        onClose={() => setLogModalVisible(false)}
        onSubmitted={() => { setLogModalVisible(false); load(); }}
      />
    </SafeAreaView>
  );
}

// ─── Heatmap styles ───────────────────────────────────────────────────────────
const h = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  cell: {
    flex: 1,
    aspectRatio: 1,
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellDone: { backgroundColor: '#F5A623' },
  cellToday: {
    backgroundColor: Colors.white,
    borderWidth: 2,
    borderColor: '#F5A623',
  },
  label: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: '#999',
  },
  labelDone: { color: Colors.white },
  labelToday: { color: '#F5A623' },
});

// ─── Main styles ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 32,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 16,
    marginBottom: 8,
  },
  logo: {
    fontFamily: Fonts.monument,
    fontSize: 22,
    color: '#111',
    letterSpacing: 1,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5E6C8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: '#8A6A2E',
  },

  // Time of day
  timeOfDay: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 12,
    color: '#999',
    letterSpacing: 0.5,
    marginBottom: 16,
  },

  // Hero card
  hero: {
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    padding: 24,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(245,166,35,0.2)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 12,
  },
  heroBadgeText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 10,
    color: '#FFB84D',
    letterSpacing: 0.5,
  },
  heroWhy: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: '#BBB',
    lineHeight: 17,
    marginBottom: 10,
  },
  heroFocusName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 26,
    color: '#fff',
    lineHeight: 30,
    marginBottom: 8,
  },
  heroCount: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: '#999',
    letterSpacing: 0.5,
    marginBottom: 16,
  },
  startBtn: {
    backgroundColor: '#F5A623',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  startBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
    color: '#fff',
    letterSpacing: 0.5,
  },

  // "or" + alternatives
  orLabel: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  altScroll: {
    gap: 10,
    paddingBottom: 4,
    marginBottom: 18,
  },
  altCard: {
    width: 140,
    backgroundColor: '#F8F8F8',
    borderWidth: 1,
    borderColor: '#E8E8E8',
    borderRadius: 14,
    padding: 12,
  },
  altLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  altName: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: '#111',
    lineHeight: 18,
  },

  // This Week
  section: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 12,
    color: '#999',
    textTransform: 'uppercase' ,
    letterSpacing: 0.5,
    marginBottom: 10,
  },

  // Share with Coach
  shareWrap: {
    paddingTop: 16,
    marginBottom: 16,
  },
  shareBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(17,12,17,0.18)',
    backgroundColor: 'rgba(17,12,17,0.03)',
  },
  shareBtnLoading: {
    borderColor: 'rgba(17,12,17,0.08)',
    backgroundColor: 'transparent',
  },
  shareBtnSuccess: {
    borderColor: '#22a861',
    backgroundColor: 'rgba(34,168,97,0.06)',
  },
  shareInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shareIconArrow: { fontSize: 14, color: 'rgba(17,12,17,0.5)' },
  shareBtnText: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: Colors.black },
  shareBtnTextLoading: { fontFamily: Fonts.jakartaRegular, fontSize: 13, color: 'rgba(17,12,17,0.4)', marginLeft: 8 },
  shareBtnTextSuccess: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: '#22a861' },
  shareCheckmark: { fontSize: 14, color: '#22a861' },
  shareHint: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11,
    color: Colors.secondary,
    lineHeight: 16,
    marginBottom: 10,
    textAlign: 'center',
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: '#111',
  },
  statLabel: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 10,
    color: '#999',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
});
