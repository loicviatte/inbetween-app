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
  getUserSummary,
  getTrainingDaysThisWeek,
  getRecentClassInputs,
  getTopFocusPointsWithCounts,
} from '../services/storage';
import { getSlots, refreshNudgeMessage, getSessionCountForFocus } from '../services/algorithm';
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

function truncateSummary(text, maxChars = 110) {
  if (!text || text.length <= maxChars) return text;
  const cut = text.lastIndexOf(' ', maxChars);
  return text.slice(0, cut > 0 ? cut : maxChars) + '…';
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
          <View key={i} style={[h.cell, done && h.cellDone, isToday && !done && h.cellToday]}>
            <Text style={[h.label, done && h.labelDone, isToday && !done && h.labelToday]}>
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
  const [coachSummary, setCoachSummary] = useState('');
  const [sessionsThisWeek, setSessionsThisWeek] = useState(0);
  const [focusCount, setFocusCount] = useState(0);
  const [activeDays, setActiveDays] = useState(new Set());
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [shareState, setShareState] = useState('default');
  const [shareLoadingMsg, setShareLoadingMsg] = useState(SHARE_LOADING_MSGS[0]);
  const shareMsgRef = useRef(null);

  async function load() {
    const [u, slots, sessions, fc, summary, days] = await Promise.all([
      getUser(),
      getSlots(),
      getTrainingSessionsThisWeek(),
      getFocusTrainedCount(),
      getUserSummary(),
      getTrainingDaysThisWeek(),
    ]);
    setUser(u);
    setSlot1(slots.slot1);
    setSlot2(slots.slot2);
    setSessionsThisWeek(sessions);
    setFocusCount(fc);
    setActiveDays(days);
    setCoachSummary(
      summary || "Log your first class to receive personalized coaching insights."
    );
    if (slots.slot1?.id) {
      const count = await getSessionCountForFocus(slots.slot1.id);
      setSessionCount(count);
    }
    // Fire nudge refresh in background
    refreshNudgeMessage();
  }

  useFocusEffect(useCallback(() => { load(); }, []));

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

  const heroMessage = truncateSummary(coachSummary);

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

          {!!heroMessage && (
            <Text style={s.heroWhy} numberOfLines={2}>{heroMessage}</Text>
          )}

          <Text style={s.heroFocusName} numberOfLines={2}>
            {slot1?.name || 'No focus yet'}
          </Text>

          <Text style={s.heroCount}>
            {ordinal(sessionCount + 1)} session
          </Text>

          <TouchableOpacity
            style={s.startBtn}
            onPress={() => navigation.navigate('TRAIN')}
            activeOpacity={0.88}
          >
            <Text style={s.startBtnText}>Start Now</Text>
          </TouchableOpacity>

        </View>

        {/* ── "or" divider + alternatives ── */}
        {slot2 && (
          <>
            <Text style={s.orLabel}>or</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.altScroll}
            >
              <TouchableOpacity
                style={s.altCard}
                onPress={() => navigation.navigate('TRAIN')}
                activeOpacity={0.8}
              >
                <Text style={s.altLabel}>Try instead</Text>
                <Text style={s.altName} numberOfLines={2}>{slot2.name}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.altCard, s.altCardDark]}
                onPress={() => setLogModalVisible(true)}
                activeOpacity={0.8}
              >
                <Text style={[s.altLabel, s.altLabelDark]}>Just came back</Text>
                <Text style={[s.altName, s.altNameDark]}>Log Class</Text>
              </TouchableOpacity>
            </ScrollView>
          </>
        )}

        {!slot2 && (
          <TouchableOpacity
            style={s.logClassRow}
            onPress={() => setLogModalVisible(true)}
            activeOpacity={0.7}
          >
            <Text style={s.logClassText}>Log a class →</Text>
          </TouchableOpacity>
        )}

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
            <Text style={s.statLabel}>Sessions{'\n'}this week</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statValue}>{focusCount}</Text>
            <Text style={s.statLabel}>Areas{'\n'}trained</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statValue}>{sessionCount}</Text>
            <Text style={s.statLabel}>Sessions on{'\n'}top focus</Text>
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

// ─── Week heatmap styles ──────────────────────────────────────────────────────
const h = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  cell: {
    flex: 1,
    aspectRatio: 1,
    backgroundColor: 'rgba(17,12,17,0.05)',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellDone: { backgroundColor: Colors.orange },
  cellToday: { borderWidth: 1.5, borderColor: Colors.orange, backgroundColor: Colors.white },
  label: { fontFamily: Fonts.jakartaBold, fontSize: 12, color: 'rgba(17,12,17,0.3)' },
  labelDone: { color: Colors.white },
  labelToday: { color: Colors.orange },
});

// ─── Main styles ─────────────────────────────────────────────────────────────
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
    fontSize: 20,
    color: Colors.black,
    letterSpacing: 1,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.profileIcon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: '#7A4A00',
  },

  // Time of day
  timeOfDay: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: Colors.secondary,
    letterSpacing: 0.8,
    marginBottom: 14,
  },

  // Hero card
  hero: {
    backgroundColor: Colors.black,
    borderRadius: 20,
    padding: 22,
    marginBottom: 14,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,157,0,0.18)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 14,
  },
  heroBadgeText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 10,
    color: '#FFB84D',
    letterSpacing: 0.5,
  },
  heroWhy: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 19,
    marginBottom: 10,
  },
  heroFocusName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 28,
    color: Colors.white,
    lineHeight: 34,
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  heroCount: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
    letterSpacing: 0.4,
    marginBottom: 20,
    textTransform: 'uppercase',
  },
  startBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  startBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
    color: '#000',
    letterSpacing: 0.3,
  },
  shareWrap: {
    marginBottom: 16,
  },
  shareHint: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11,
    color: Colors.secondary,
    lineHeight: 16,
    marginBottom: 10,
    textAlign: 'center',
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

  // "or" + alternatives
  orLabel: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
    textAlign: 'center',
    marginBottom: 12,
  },
  altScroll: {
    gap: 10,
    paddingBottom: 2,
    marginBottom: 24,
  },
  altCard: {
    width: 148,
    backgroundColor: Colors.statCardBg,
    borderWidth: 1,
    borderColor: Colors.statCardBorder,
    borderRadius: 14,
    padding: 14,
  },
  altCardDark: {
    backgroundColor: 'rgba(17,12,17,0.06)',
    borderColor: 'rgba(17,12,17,0.12)',
  },
  altLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 10,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  altLabelDark: { color: Colors.secondary },
  altName: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: Colors.black,
    lineHeight: 19,
  },
  altNameDark: { color: Colors.black },

  // Log class link (when no slot2)
  logClassRow: {
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 20,
  },
  logClassText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: Colors.secondary,
  },

  // Sections
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 10,
    color: Colors.secondary,
    letterSpacing: 0.8,
    marginBottom: 10,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.25,
    borderColor: Colors.statCardBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: 'flex-start',
  },
  statValue: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: Colors.black,
    marginBottom: 4,
  },
  statLabel: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 10,
    color: Colors.secondary,
    lineHeight: 14,
  },
});
