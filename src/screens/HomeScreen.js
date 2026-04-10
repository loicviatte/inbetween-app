import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  Animated,
  Modal,
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import TabHeader from '../components/TabHeader';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../theme';
import {
  getUser,
  getTrainingSessionsThisWeek,
  getSessionsThisWeek,
  getFocusTrainedThisWeek,
  getWeekActivity,
  getRecentClassInputs,
  getTopFocusPointsWithCounts,
} from '../storage/storage';
import { getSlots, getSessionCountForFocus, startTrainingSession } from '../utils/algorithm';
import {
  getActiveSession,
  clearActiveSession,
  subscribeToActiveSession,
  getSessionTimeLeft,
} from '../storage/activeSession';
import { generateCoachShareSummary } from '../services/ai/anthropic';
import LogModal from '../components/LogModal';
import HomeSkeleton from '../components/HomeSkeleton';

const SHARE_LOADING_MSGS = ['Gathering your notes...', 'Writing summary...', 'Almost ready...'];
const HOME_CACHE_KEY = '@cache_home';

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sc = (s % 60).toString().padStart(2, '0');
  return `${m}:${sc}`;
}

function ordinal(n) {
  if (!n) return '1st';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const FEELING_EMOJI = { Hard: '😤', Struggled: '😰', Okay: '😐', Good: '🙂', Great: '🔥' };

function fmtTime(iso) {
  const d = new Date(iso);
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function WeekHeatmap({ activity, onDayPress }) {
  const todayIdx = (new Date().getDay() + 6) % 7;
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return (
    <View style={h.row}>
      {labels.map((label, i) => {
        const day = activity[i];
        const hasSessions = (day?.sessions?.length ?? 0) > 0;
        const hasClasses = (day?.classes?.length ?? 0) > 0;
        const hasActivity = hasSessions || hasClasses;
        const isToday = i === todayIdx;
        return (
          <TouchableOpacity
            key={i}
            style={[h.cell, isToday && h.cellToday]}
            onPress={() => hasActivity && onDayPress(i)}
            activeOpacity={hasActivity ? 0.7 : 1}
          >
            <Text style={[h.label, isToday && h.labelToday]}>{label}</Text>
            <View style={h.dots}>
              {hasSessions && <View style={[h.dot, h.dotSession]} />}
              {hasClasses && <View style={[h.dot, h.dotClass]} />}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function HomeScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [slot1, setSlot1] = useState(null);
  const [slot2, setSlot2] = useState(null);
  const [slot3, setSlot3] = useState(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [slot2Count, setSlot2Count] = useState(0);
  const [comingUpModal, setComingUpModal] = useState(false);
  const [starting, setStarting] = useState(false);
  const [activeSession, setActiveSessionState] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const [homeOverTime, setHomeOverTime] = useState(0);
  const [sessionsThisWeek, setSessionsThisWeek] = useState(0);
  const [classesThisWeek, setClassesThisWeek] = useState(0);
  const [focusTrainedThisWeek, setFocusTrainedThisWeek] = useState(0);
  const [weekActivity, setWeekActivity] = useState({});
  const [dayModal, setDayModal] = useState(null);
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [photoUri, setPhotoUri] = useState(null);
  const [shareState, setShareState] = useState('default');
  const [shareLoadingMsg, setShareLoadingMsg] = useState(SHARE_LOADING_MSGS[0]);
  const shareMsgRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [isLoading, setIsLoading] = useState(true);
  const hasLoadedRef = useRef(false);

  async function load() {
    const [u, slots, sessions, classes, focusTrained, wa, savedPhoto] = await Promise.all([
      getUser(),
      getSlots(),
      getTrainingSessionsThisWeek(),
      getSessionsThisWeek(),
      getFocusTrainedThisWeek(),
      getWeekActivity(),
      AsyncStorage.getItem('@profile_photo'),
    ]);
    setUser(u);
    setSlot1(slots.slot1);
    setSlot2(slots.slot2);
    setSlot3(slots.slot3);
    setSessionsThisWeek(sessions);
    setClassesThisWeek(classes);
    setFocusTrainedThisWeek(focusTrained);
    setWeekActivity(wa || {});
    setPhotoUri(savedPhoto || null);
    const [c1, c2] = await Promise.all([
      slots.slot1?.id ? getSessionCountForFocus(slots.slot1.id) : Promise.resolve(0),
      slots.slot2?.id ? getSessionCountForFocus(slots.slot2.id) : Promise.resolve(0),
    ]);
    setSessionCount(c1);
    setSlot2Count(c2);
    AsyncStorage.setItem(HOME_CACHE_KEY, JSON.stringify({
      user: u, slot1: slots.slot1, slot2: slots.slot2, slot3: slots.slot3,
      sessionCount: c1, slot2Count: c2,
      sessionsThisWeek: sessions, classesThisWeek: classes,
      focusTrainedThisWeek: focusTrained, weekActivity: wa || {},
    })).catch(() => {});
  }

  useFocusEffect(useCallback(() => {
    setShareState('default');
    const isFirst = !hasLoadedRef.current;
    if (isFirst) setIsLoading(true);
    async function init() {
      if (isFirst) {
        try {
          const raw = await AsyncStorage.getItem(HOME_CACHE_KEY);
          if (raw) {
            const c = JSON.parse(raw);
            setUser(c.user);
            setSlot1(c.slot1);
            setSlot2(c.slot2);
            setSlot3(c.slot3 || null);
            setSessionCount(c.sessionCount || 0);
            setSlot2Count(c.slot2Count || 0);
            setSessionsThisWeek(c.sessionsThisWeek || 0);
            setClassesThisWeek(c.classesThisWeek || 0);
            setFocusTrainedThisWeek(c.focusTrainedThisWeek || 0);
            setWeekActivity(c.weekActivity || {});
            setIsLoading(false);
          }
        } catch {}
      }
      try { await load(); } catch {}
      hasLoadedRef.current = true;
      setIsLoading(false);
      if (isFirst) {
        fadeAnim.setValue(0);
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      }
    }
    init();

    // Sync active session state
    const current = getActiveSession();
    setActiveSessionState(current);
    setCountdown(Math.floor(getSessionTimeLeft()));

    const unsub = subscribeToActiveSession((s) => {
      setActiveSessionState(s);
      setCountdown(s ? Math.floor(getSessionTimeLeft()) : 0);
    });

    const tick = setInterval(() => {
      const s = getActiveSession();
      if (s) {
        const tl = Math.floor(getSessionTimeLeft());
        setCountdown(tl);
        if (tl <= 0) {
          const over = Math.floor((Date.now() - s.startedAt) / 1000 - s.duration * 60);
          setHomeOverTime(Math.max(0, over));
        } else {
          setHomeOverTime(0);
        }
      }
    }, 1000);

    return () => {
      unsub();
      clearInterval(tick);
    };
  }, []));

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

  async function handleStartSession(focusPoint, rank, count) {
    if (starting || !focusPoint?.id) return;
    if (getActiveSession()) return;
    setStarting(true);
    const sessionId = await startTrainingSession(slot1?.id, slot2?.id || null);
    setStarting(false);
    navigation.navigate('FocusSession', {
      focusPointId: focusPoint.id,
      sessionId,
      rank,
      sessionCount: count,
    });
  }

  const isSessionActive = !!activeSession;
  const activeFocusName = isSessionActive
    ? (activeSession.focusPointName ?? slot1?.name)
    : slot1?.name;

  const heroMessage = slot1?.subtitle || null;

  if (isLoading) {
    return <HomeSkeleton />;
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>

      <TabHeader navigation={navigation} />

      {/* ── Top section ── */}
      <View style={[s.scroll, s.scrollContent]}>

        {/* Hero card */}
        <View style={s.hero}>
          <View style={s.heroBadge}>
            <Text style={s.heroBadgeText}>{isSessionActive ? 'SESSION STARTED' : "TODAY'S FOCUS"}</Text>
          </View>
          <Text style={s.heroFocusName} numberOfLines={2}>
            {activeFocusName || 'No focus yet'}
          </Text>
          <Text style={s.heroSession}>{ordinal(sessionCount + 1)} Session</Text>
          {!isSessionActive && heroMessage ? (
            <Text style={s.heroMessage} numberOfLines={3}>{heroMessage}</Text>
          ) : null}
          {activeSession ? (
            <TouchableOpacity
              style={s.inProgressBtn}
              onPress={() => navigation.navigate('FocusSession', {
                focusPointId: activeSession.focusPointId,
                sessionId: activeSession.sessionId,
                rank: activeSession.rank,
                sessionCount: activeSession.sessionCount,
              })}
              activeOpacity={0.75}
            >
              <View style={s.inProgressLeft}>
                <View style={s.inProgressDot} />
                <Text style={s.inProgressLabel}>In Progress</Text>
              </View>
              <View style={s.inProgressRight}>
                {countdown > 0 ? (
                  <Text style={s.inProgressTimer}>{formatTime(countdown)}</Text>
                ) : (
                  <Text style={[s.inProgressTimer, { color: '#FF9D00' }]}>
                    + {formatTime(homeOverTime)}
                  </Text>
                )}
                <Text style={s.inProgressArrow}>›</Text>
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[s.startBtn, starting && { opacity: 0.6 }]}
              onPress={() => handleStartSession(slot1, 0, sessionCount)}
              activeOpacity={0.88}
              disabled={starting}
            >
              <Text style={s.startBtnText}>{starting ? 'Starting…' : 'Start Now'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* "or" divider */}
        <View style={s.orRow}>
          <View style={s.orLine} />
          <Text style={s.orText}>or</Text>
          <View style={s.orLine} />
        </View>

        {/* Alt row: scrollable cards + All Focus Points */}
        <View style={s.altRow}>
          <View style={s.altScrollWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.altScroll}
            >
              {slot2 && (
                <TouchableOpacity
                  style={[s.altCard, isSessionActive && s.altCardLocked]}
                  onPress={() => handleStartSession(slot2, 1, slot2Count)}
                  activeOpacity={0.8}
                  disabled={starting || isSessionActive}
                >
                  <View style={s.altCardHeader}>
                    <Text style={s.altTryLabel}>Try instead</Text>
                    {isSessionActive && <Text style={s.altLockIcon}>🔒</Text>}
                  </View>
                  <Text style={s.altName} numberOfLines={2}>{slot2.name}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[s.altCard, s.altCardComingUp]}
                onPress={() => setComingUpModal(true)}
                activeOpacity={0.8}
              >
                <View style={s.altCardHeader}>
                  <Text style={s.altTryLabel}>Coming up</Text>
                </View>
                <Text style={s.altName} numberOfLines={2}>
                  {slot3 ? slot3.name : '—'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
          <View style={s.altFixed}>
            <TouchableOpacity
              style={s.allFocusBtn}
              onPress={() => navigation.navigate('AllFocusPoints')}
              activeOpacity={0.8}
            >
              <Text style={s.allFocusBtnText}>All focus{'\n'}points</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ── Bottom dock ── */}
      <View style={s.bottomDock}>
        {/* This Week heatmap */}
        <View style={s.weekSection}>
          <View style={s.sectionLabelRow}>
            <Text style={s.sectionLabel}>THIS WEEK</Text>
            <View style={s.sectionLabelLine} />
          </View>
          <WeekHeatmap activity={weekActivity} onDayPress={(i) => setDayModal(i)} />
        </View>

        {/* Stats bar */}
        <View style={s.statsBar}>
          <View style={s.statItem}>
            <Text style={s.statValue}>{sessionsThisWeek}</Text>
            <Text style={s.statLabel}>Training</Text>
          </View>
          <View style={s.statSep} />
          <View style={s.statItem}>
            <Text style={s.statValue}>{classesThisWeek}</Text>
            <Text style={s.statLabel}>Class</Text>
          </View>
          <View style={s.statSep} />
          <View style={s.statItem}>
            <Text style={s.statValue}>{focusTrainedThisWeek}</Text>
            <Text style={s.statLabel}>Focus Trained</Text>
          </View>
        </View>

      </View>

      <LogModal
        visible={logModalVisible}
        onClose={() => setLogModalVisible(false)}
        onSubmitted={() => { setLogModalVisible(false); load(); }}
      />

      <Modal visible={comingUpModal} transparent animationType="fade" onRequestClose={() => setComingUpModal(false)}>
        <TouchableOpacity style={s.comingUpOverlay} activeOpacity={1} onPress={() => setComingUpModal(false)}>
          <TouchableOpacity style={s.comingUpSheet} activeOpacity={1} onPress={() => {}}>
            <Text style={s.comingUpEmoji}>🎯</Text>
            <Text style={s.comingUpTitle}>Work on the most important focus first</Text>
            <Text style={s.comingUpBody}>Complete your primary focus point before moving to the next one. Focused repetition builds mastery faster.</Text>
            <TouchableOpacity style={s.comingUpDismiss} onPress={() => setComingUpModal(false)} activeOpacity={0.8}>
              <Text style={s.comingUpDismissText}>Got it</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={dayModal !== null} transparent animationType="slide" onRequestClose={() => setDayModal(null)}>
        <TouchableOpacity style={dm.overlay} activeOpacity={1} onPress={() => setDayModal(null)}>
          <TouchableOpacity style={dm.sheet} activeOpacity={1} onPress={() => {}}>
            <View style={dm.handle} />
            <Text style={dm.dayName}>{dayModal !== null ? DAY_NAMES[dayModal] : ''}</Text>
            {(weekActivity[dayModal]?.sessions?.length ?? 0) > 0 && (
              <View style={dm.section}>
                <Text style={dm.sectionLabel}>Training Sessions</Text>
                {weekActivity[dayModal].sessions.map((s) => (
                  <View key={s.id} style={dm.row}>
                    <View style={[dm.dot, dm.dotSession]} />
                    <View style={{ flex: 1 }}>
                      <Text style={dm.rowText}>{fmtTime(s.started_at)}</Text>
                      {!!s.focusName && <Text style={dm.rowSub} numberOfLines={1}>{s.focusName}</Text>}
                    </View>
                    {!!s.feeling && <Text style={dm.feeling}>{FEELING_EMOJI[s.feeling] ?? s.feeling}</Text>}
                  </View>
                ))}
              </View>
            )}
            {(weekActivity[dayModal]?.classes?.length ?? 0) > 0 && (
              <View style={dm.section}>
                <Text style={dm.sectionLabel}>Class Logs</Text>
                {weekActivity[dayModal].classes.map((c) => (
                  <View key={c.id} style={dm.row}>
                    <View style={[dm.dot, dm.dotClass]} />
                    <View style={{ flex: 1 }}>
                      <Text style={dm.rowText}>{fmtTime(c.created_at)}</Text>
                      {!!(c.title || c.ai_primary_focus || c.practice_point_1) && (
                        <Text style={dm.rowSub} numberOfLines={1}>{c.title || c.ai_primary_focus || c.practice_point_1}</Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
      </Animated.View>
    </SafeAreaView>
  );
}

// ─── Heatmap styles ───────────────────────────────────────────────────────────
const h = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  cell: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: '#F2F2F2',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cellToday: { backgroundColor: '#fff', borderColor: '#F5A623' },
  label: { fontFamily: Fonts.jakartaBold, fontSize: 12, color: '#C8C8C8' },
  labelToday: { color: '#F5A623' },
  dots: { flexDirection: 'row', gap: 3, marginTop: 4, height: 5 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  dotSession: { backgroundColor: '#4A90D9' },
  dotClass: { backgroundColor: '#4CD964' },
});

// ─── Day modal styles ─────────────────────────────────────────────────────────
const dm = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 22,
    paddingBottom: 36,
    paddingTop: 12,
  },
  handle: {
    width: 36, height: 4,
    backgroundColor: 'rgba(17,12,17,0.12)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 18,
  },
  dayName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: '#111',
    marginBottom: 16,
  },
  section: { marginBottom: 16 },
  sectionLabel: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 10,
    color: '#ACADB9',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F2F2F2',
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  dotSession: { backgroundColor: '#4A90D9' },
  dotClass: { backgroundColor: '#4CD964' },
  rowText: { fontFamily: Fonts.jakartaMedium, fontSize: 14, color: '#111' },
  rowSub: { fontFamily: Fonts.jakartaRegular, fontSize: 12, color: '#ACADB9', marginTop: 2 },
  feeling: { fontSize: 16, marginLeft: 'auto' },
});

// ─── Main styles ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  scroll: {},
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  notifBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    fontFamily: Fonts.monument,
    fontSize: 20,
    color: Colors.black,
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
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#8A6A2E',
  },
  avatarPhoto: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },

  // Hero card
  hero: {
    backgroundColor: '#1C1C1E',
    borderRadius: 20,
    padding: 20,
    paddingBottom: 18,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.09,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 12,
    elevation: 8,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#F5A623',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 14,
  },
  heroBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: '#fff',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  heroFocusName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 30,
    color: '#fff',
    letterSpacing: -0.8,
    lineHeight: 34,
    marginBottom: 4,
  },
  heroSession: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
    marginBottom: 10,
  },
  heroMessage: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: '#FFFFFF',
    lineHeight: 20,
    marginBottom: 18,
  },
  startBtn: {
    backgroundColor: '#F5A623',
    borderRadius: 13,
    paddingVertical: 16,
    alignItems: 'center',
  },
  startBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: '#fff',
  },
  inProgressBtn: {
    backgroundColor: '#1C1C1E',
    borderRadius: 13,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 10,
    elevation: 4,
  },
  inProgressLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inProgressRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inProgressDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#4CD964',
    shadowColor: '#4CD964',
    shadowOpacity: 0.8,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 5,
  },
  inProgressLabel: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: '#fff',
  },
  inProgressTimer: {
    fontFamily: Fonts.monument,
    fontSize: 14,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 1,
  },
  inProgressArrow: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 20,
    color: 'rgba(255,255,255,0.3)',
    lineHeight: 22,
  },

  // "or" divider
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  orLine: { flex: 1, height: 1, backgroundColor: '#EFEFEF' },
  orText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: '#C8C8C8',
  },

  // Alt row
  altRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: 4,
  },
  altScrollWrap: {
    flex: 1,
    overflow: 'hidden',
  },
  altScroll: {
    gap: 9,
    paddingBottom: 2,
  },
  altCard: {
    width: 150,
    backgroundColor: '#F2F2F2',
    borderRadius: 14,
    padding: 13,
    paddingHorizontal: 14,
  },
  altCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  altTryLabel: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 9,
    color: '#C8C8C8',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  altName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#111',
    letterSpacing: -0.3,
  },
  altCardLocked: {
    opacity: 0.4,
  },
  altLockIcon: {
    fontSize: 9,
    color: '#C8C8C8',
  },
  altFixed: {
    marginLeft: 9,
  },
  altCardComingUp: {
    opacity: 0.6,
  },
  allFocusBtn: {
    width: 80,
    flex: 1,
    backgroundColor: '#F2F2F2',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allFocusBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    textAlign: 'center',
    lineHeight: 14,
  },

  // Coming up modal
  comingUpOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  comingUpSheet: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    width: '100%',
  },
  comingUpEmoji: {
    fontSize: 36,
    marginBottom: 14,
  },
  comingUpTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: '#111',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: 10,
  },
  comingUpBody: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  comingUpDismiss: {
    backgroundColor: '#111',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 32,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  comingUpDismissText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: '#fff',
  },

  // Bottom dock
  bottomDock: {
    flexShrink: 0,
    paddingHorizontal: 20,
    paddingTop: 14,
    backgroundColor: '#fff',
  },
  dockSep: {
    width: 72,
    height: 1,
    backgroundColor: '#D8D8D8',
    alignSelf: 'center',
    marginBottom: 14,
  },

  // This Week
  weekSection: { marginBottom: 14 },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  sectionLabelLine: { flex: 1, height: 1, backgroundColor: '#EFEFEF' },
  sectionLabel: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // Stats bar
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F2F2F2',
    borderRadius: 14,
    paddingVertical: 11,
    marginBottom: 11,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statSep: { width: 1, height: 22, backgroundColor: '#E2E2E2' },
  statValue: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: '#111',
    letterSpacing: -0.4,
    marginBottom: 2,
  },
  statLabel: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 9,
    color: '#C8C8C8',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  // Share with Coach
  shareSection: { marginBottom: 5 },
  shareDesc: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11,
    color: '#C8C8C8',
    lineHeight: 16,
    textAlign: 'center',
    marginBottom: 9,
  },
  shareBtn: {
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#E8E8E8',
    backgroundColor: 'transparent',
  },
  shareBtnLoading: { borderColor: 'rgba(17,12,17,0.08)' },
  shareBtnSuccess: { borderColor: '#22a861', backgroundColor: 'rgba(34,168,97,0.06)' },
  shareInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shareIconArrow: { fontSize: 13, color: '#888' },
  shareBtnText: { fontFamily: Fonts.jakartaSemiBold, fontSize: 12, color: '#888' },
  shareBtnTextLoading: { fontFamily: Fonts.jakartaRegular, fontSize: 13, color: 'rgba(17,12,17,0.4)', marginLeft: 8 },
  shareBtnTextSuccess: { fontFamily: Fonts.jakartaBold, fontSize: 13, color: '#22a861' },
});
