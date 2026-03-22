import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { Colors, Fonts, Spacing } from '../theme';
import {
  getSlots,
  getSessionCountForFocus,
  getSessionLabel,
  startTrainingSession,
} from '../services/algorithm';
import { getFocusPoints, getRecentClassInputs, getTopFocusPointsWithCounts, getUser } from '../services/storage';
import { generateCoachShareSummary } from '../services/anthropic';

const SHARE_LOADING_MSGS = ['Gathering your notes...', 'Writing summary...', 'Almost ready...'];

function Logo() {
  return <Text style={styles.logo}>EE</Text>;
}

function Slot1Card({ point, sessionCount, onStart, loading }) {
  const label = getSessionLabel(sessionCount);
  return (
    <View style={styles.slot1Card}>
      <View style={styles.slot1CardTop}>
        <Text style={styles.slot1Label}>Main Focus</Text>
        <View style={styles.slot1Badge}>
          <Text style={styles.slot1BadgeText}>{label}</Text>
        </View>
      </View>
      <Text style={styles.slot1Name} numberOfLines={2}>{point.name}</Text>
      <TouchableOpacity
        style={styles.slot1Btn}
        onPress={onStart}
        activeOpacity={0.85}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#000" />
        ) : (
          <Text style={styles.slot1BtnText}>START SESSION</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

function Slot2Card({ point, sessionCount, onStart, loading }) {
  const label = getSessionLabel(sessionCount);
  return (
    <TouchableOpacity
      style={styles.slot2Card}
      onPress={onStart}
      activeOpacity={0.82}
      disabled={loading}
    >
      <View style={styles.slot2Left}>
        <Text style={styles.slot2Label} numberOfLines={1}>Secondary  ·  {label}</Text>
        <Text style={styles.slot2Name} numberOfLines={1}>{point.name}</Text>
      </View>
      <View style={styles.slot2Btn}>
        {loading ? (
          <ActivityIndicator size="small" color="#1A1A1A" />
        ) : (
          <Text style={styles.slot2BtnText}>Choose this instead →</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function FocusScreen({ navigation }) {
  const [slot1, setSlot1] = useState(null);
  const [slot2, setSlot2] = useState(null);
  const [slot1Count, setSlot1Count] = useState(0);
  const [slot2Count, setSlot2Count] = useState(0);
  const [upcoming, setUpcoming] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [starting, setStarting] = useState(null); // 1 | 2 | null
  const [shareState, setShareState] = useState('default'); // 'default' | 'loading' | 'success'
  const [shareLoadingMsg, setShareLoadingMsg] = useState(SHARE_LOADING_MSGS[0]);
  const shareMsgRef = useRef(null);

  useFocusEffect(
    useCallback(() => {
      setShareState('default');
      setShareLoadingMsg(SHARE_LOADING_MSGS[0]);
      async function load() {
        setLoaded(false);
        const [{ slot1: s1, slot2: s2 }, allPoints] = await Promise.all([
          getSlots(),
          getFocusPoints(),
        ]);
        setSlot1(s1);
        setSlot2(s2);
        const [c1, c2] = await Promise.all([
          s1 ? getSessionCountForFocus(s1.id) : Promise.resolve(0),
          s2 ? getSessionCountForFocus(s2.id) : Promise.resolve(0),
        ]);
        setSlot1Count(c1);
        setSlot2Count(c2);
        const activeIds = new Set([s1?.id, s2?.id].filter(Boolean));
        setUpcoming(allPoints.filter((p) => !activeIds.has(p.id)));
        setLoaded(true);
      }
      load();
    }, [])
  );

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
      const [recentInputs, topFocusPoints, user] = await Promise.all([
        getRecentClassInputs(3),
        getTopFocusPointsWithCounts(3),
        getUser(),
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

  async function handleStart(slotNumber) {
    if (!slot1) return;
    setStarting(slotNumber);
    const focusPointId = slotNumber === 1 ? slot1.id : slot2?.id;
    if (!focusPointId) { setStarting(null); return; }

    const sessionId = await startTrainingSession(slot1.id, slot2?.id || null);
    setStarting(null);
    navigation.navigate('FocusSession', {
      focusPointId,
      sessionId,
      rank: slotNumber - 1,
      sessionCount: slotNumber === 1 ? slot1Count : slot2Count,
    });
  }

  if (!loaded) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Logo />
        </View>
        <View style={styles.loading}>
          <ActivityIndicator color={Colors.black} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Logo />
        <TouchableOpacity
          style={styles.profileIcon}
          onPress={() => navigation.navigate('PROFILE')}
          activeOpacity={0.8}
        >
          <Text style={styles.profileInitial}>A</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.screenHeading}>Focus</Text>
        <Text style={styles.screenSubtitle}>Your priorities for this training session.</Text>

        {!slot1 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No focus points yet.{'\n'}Log your first class to get your focus.
            </Text>
          </View>
        ) : (
          <>
            <Slot1Card
              point={slot1}
              sessionCount={slot1Count}
              onStart={() => handleStart(1)}
              loading={starting === 1}
            />

            {slot2 ? (
              <>
                <View style={styles.orDivider}>
                  <View style={styles.orLine} />
                  <Text style={styles.orText}>or</Text>
                  <View style={styles.orLine} />
                </View>
                <Slot2Card
                  point={slot2}
                  sessionCount={slot2Count}
                  onStart={() => handleStart(2)}
                  loading={starting === 2}
                />
              </>
            ) : (
              <View style={styles.slot2Empty}>
                <Text style={styles.slot2EmptyText}>
                  Log more classes to unlock your secondary focus.
                </Text>
              </View>
            )}

            {upcoming.length > 0 && (
              <View style={styles.upcomingSection}>
                <Text style={styles.upcomingHeading}>Coming up</Text>
                {upcoming.map((p) => (
                  <View key={p.id} style={styles.upcomingRow}>
                    <View style={styles.upcomingDot} />
                    <Text style={styles.upcomingName} numberOfLines={1}>{p.name}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        <View style={styles.shareWrap}>
          <Text style={styles.shareHint}>Generates a short summary of your recent work and corrections — ready to paste to your coach before a lesson.</Text>
          <TouchableOpacity
            style={[
              styles.shareBtn,
              shareState === 'loading' && styles.shareBtnLoading,
              shareState === 'success' && styles.shareBtnSuccess,
            ]}
            onPress={handleShare}
            activeOpacity={0.82}
            disabled={shareState === 'loading'}
          >
            {shareState === 'loading' ? (
              <View style={styles.shareInner}>
                <ActivityIndicator size="small" color="rgba(17,12,17,0.4)" />
                <Text style={styles.shareBtnTextLoading}>{shareLoadingMsg}</Text>
              </View>
            ) : shareState === 'success' ? (
              <View style={styles.shareInner}>
                <Text style={styles.shareBtnTextSuccess}>Copied to clipboard</Text>
                <Text style={styles.shareCheckmark}>✓</Text>
              </View>
            ) : (
              <View style={styles.shareInner}>
                <Text style={styles.shareIconArrow}>↑</Text>
                <Text style={styles.shareBtnText}>Share with Coach</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingTop: 16,
    paddingBottom: 8,
  },
  logo: { fontFamily: Fonts.monument, fontSize: 20, color: Colors.black, letterSpacing: 1 },
  profileIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.profileIcon,
    alignItems: 'center', justifyContent: 'center',
  },
  profileInitial: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: '#7A4A00' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  content: { flex: 1, paddingHorizontal: Spacing.side, paddingBottom: 24 },

  screenHeading: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 24,
    color: Colors.black,
    marginBottom: 6,
  },
  screenSubtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    lineHeight: 20,
    marginBottom: 24,
  },

  // ── Slot 1 card (dominant / recommended) ─────────────────────────────────
  slot1Card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#FF9D00',
    padding: 20,
    marginBottom: 10,
    shadowColor: '#FF9D00',
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 18,
    elevation: 8,
  },
  slot1CardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  slot1Label: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: '#FF9D00',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  slot1Badge: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  slot1BadgeText: { fontFamily: Fonts.jakartaRegular, fontSize: 11, color: 'rgba(255,255,255,0.6)' },
  slot1Name: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 24,
    color: Colors.white,
    marginBottom: 20,
    lineHeight: 30,
  },
  slot1Btn: {
    backgroundColor: '#FF9D00',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slot1BtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    letterSpacing: 1,
    color: '#000000',
  },

  // ── Or divider ────────────────────────────────────────────────────────────
  orDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 14,
    paddingHorizontal: 4,
  },
  orLine: {
    flex: 1,
    height: 0.5,
    backgroundColor: 'rgba(17,12,17,0.12)',
  },
  orText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.secondary,
    paddingHorizontal: 12,
    letterSpacing: 0.5,
  },

  // ── Slot 2 card (secondary / optional) ───────────────────────────────────
  slot2Card: {
    backgroundColor: Colors.statCardBg,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  slot2Left: {
    flex: 1,
    gap: 4,
  },
  slot2Label: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.secondary,
    letterSpacing: 0.3,
  },
  slot2Name: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: Colors.black,
    lineHeight: 22,
  },
  slot2Btn: {
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(17,12,17,0.18)',
    backgroundColor: '#fff',
    marginLeft: 12,
  },
  slot2BtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    letterSpacing: 0.3,
    color: '#1A1A1A',
  },

  // Empty states
  slot2Empty: {
    borderWidth: 1,
    borderColor: Colors.statCardBorder,
    borderRadius: 16,
    borderStyle: 'dashed',
    padding: 20,
    alignItems: 'center',
  },
  slot2EmptyText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },

  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.secondary,
    textAlign: 'center',
    lineHeight: 22,
  },

  // ── Upcoming section ──────────────────────────────────────────────────────
  upcomingSection: {
    marginTop: 28,
    paddingTop: 20,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(17,12,17,0.08)',
  },
  upcomingHeading: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.secondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  upcomingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(17,12,17,0.06)',
    gap: 10,
  },
  upcomingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(17,12,17,0.2)',
  },
  upcomingName: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: 'rgba(17,12,17,0.45)',
    flex: 1,
  },

  // ── Share with Coach ──────────────────────────────────────────────────────
  shareWrap: {
    marginTop: 'auto',
    paddingTop: 16,
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
});
