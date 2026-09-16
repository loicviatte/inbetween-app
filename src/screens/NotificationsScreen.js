import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Animated, PanResponder, Modal, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fonts } from '../theme';
import { getNotifications, markAllNotificationsRead, deleteNotification } from '../storage/notificationsStorage';
import { supabase } from '../services/supabase/client';
import { readCachedRole } from '../services/auth/role';
import { locallyRespondedAttendance, locallyResolvedNameMatches } from '../storage/attendanceState';
import { respondToAttendance } from '../storage/storage';
import { GenericListSkeleton } from '../components/Skeleton';
import NotificationDetailSheet from '../components/NotificationDetailSheet';
import PullLogo, { usePullRefresh } from '../components/PullLogo';

// ─── Notifications (docs/design/notifications-list.html) ──────────────────────
const PAGE = '#F2F0EB';
const INK = '#0A0A0A';
const INK_72 = 'rgba(10,10,10,0.72)';
const INK_65 = 'rgba(10,10,10,0.65)';
const INK_60 = 'rgba(10,10,10,0.6)';
const INK_55 = 'rgba(10,10,10,0.55)';
const INK_50 = 'rgba(10,10,10,0.5)';
const INK_45 = 'rgba(10,10,10,0.45)';
const INK_34 = 'rgba(10,10,10,0.34)';
const LINE = 'rgba(10,10,10,0.12)';
const HAIR = 'rgba(10,10,10,0.07)';
const GOLD = '#E8B530';
const GOLD_100 = '#FCEFC9';
const GOLD_INK = '#8A6414';
const TILE = '#F4F2EC';
const SIDE = 20;

const ATTENDANCE_TYPES = new Set(['attendance_check', 'group_class_attendance']);
const ACTIONABLE_TYPES = new Set(['attendance_check', 'group_class_attendance', 'merge_request_student', 'name_match_confirm']);
// Coach-facing "action needed" notification types: tapping any of these
// routes straight to the ActionNeeded screen (where the coach can validate
// focus points, resolve merge requests, or confirm name matches).
const COACH_ACTION_TYPES = new Set([
  'focus_points_added',
  'focus_point_added',
  'focus_reconcile_needed',
  'merge_request',
  'name_match_confirm',
]);
// Read-only notif types — tapping opens an info popup instead of navigating.
const POPUP_READONLY_TYPES = new Set([
  'coach_request_accepted',
  'coach_request_declined',
  'focus_point_rejected',
]);

// Which tab a type belongs to ('coach' | 'class' | other → All only), its
// glyph, and the call to action it offers.
const TYPE_META = {
  transcript_ready:        { group: 'coach', icon: 'document-text-outline', cta: 'Read the summary' },
  focus_point_added:       { group: 'coach', icon: 'locate-outline', cta: 'See your focus points', coachCta: 'Review' },
  focus_points_added:      { group: 'coach', icon: 'locate-outline', cta: 'Review' },
  focus_point_rejected:    { group: 'coach', icon: 'close-circle-outline' },
  focus_reconcile_needed:  { group: 'coach', icon: 'swap-horizontal-outline', cta: 'Pick which to keep' },
  merge_request:           { group: 'coach', icon: 'git-merge-outline', cta: 'Review' },
  merge_request_student:   { group: 'coach', icon: 'git-merge-outline', cta: 'Review' },
  coach_request_received:  { group: 'coach', icon: 'person-add-outline', cta: 'Review' },
  coach_request_accepted:  { group: 'coach', icon: 'checkmark-circle-outline' },
  coach_request_declined:  { group: 'coach', icon: 'close-circle-outline' },
  couple_coach_request:    { group: 'coach', icon: 'people-outline' },
  couple_coach_accepted:   { group: 'coach', icon: 'people-outline' },
  attendance_check:        { group: 'class', icon: 'time-outline', cta: 'Confirm attendance' },
  group_class_attendance:  { group: 'class', icon: 'time-outline', cta: 'Confirm attendance' },
  sync_reminder:           { group: 'class', icon: 'cloud-upload-outline', cta: 'Import audio' },
  name_match_confirm:      { group: 'class', icon: 'id-card-outline', cta: 'Confirm' },
  couple_request_received: { group: 'other', icon: 'people-outline' },
  couple_request_accepted: { group: 'other', icon: 'people-outline' },
  couple_paired:           { group: 'other', icon: 'heart-outline' },
  child_phone_linked:      { group: 'other', icon: 'phone-portrait-outline', cta: 'See their phone' },
};
const DEFAULT_META = { group: 'other', icon: 'notifications-outline' };

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function daysAgo(iso) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(iso);
  return Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
}

// Today → "2h" / "5m"; this week → "Wed"; before → "1 Sep".
function formatTime(dateStr) {
  if (!dateStr) return '';
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return '';
  const ago = daysAgo(dateStr);
  if (ago === 0) {
    const mins = Math.floor((Date.now() - t) / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h`;
  }
  const d = new Date(dateStr);
  if (ago < 7) return WEEKDAY_SHORT[d.getDay()];
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

function groupOf(dateStr) {
  const ago = daysAgo(dateStr);
  return ago === 0 ? 'Today' : ago === 1 ? 'Yesterday' : 'Earlier';
}

const firstName = (name) => (name || '').trim().split(/\s+/)[0] || '';

// ─── Swipe to delete ──────────────────────────────────────────────────────────

const DELETE_ZONE_WIDTH = 80;
const SNAP_THRESHOLD = 44;

function SwipeToDelete({ id, onDelete, onSwipeStart, onSwipeEnd, children }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);
  // Only render delete zone after swipe starts — prevents it showing on long press
  const [swipeStarted, setSwipeStarted] = useState(false);

  const deleteOpacity = translateX.interpolate({
    inputRange: [-DELETE_ZONE_WIDTH, -SNAP_THRESHOLD * 0.4, 0],
    outputRange: [1, 0.4, 0],
    extrapolate: 'clamp',
  });

  const iconScale = translateX.interpolate({
    inputRange: [-DELETE_ZONE_WIDTH, -SNAP_THRESHOLD, 0],
    outputRange: [1, 0.7, 0.5],
    extrapolate: 'clamp',
  });

  function slideOut() {
    isOpen.current = false;
    onSwipeEnd?.();
    Animated.timing(translateX, { toValue: -500, duration: 240, useNativeDriver: true })
      .start(() => onDelete(id));
  }

  function snapOpen() {
    isOpen.current = true;
    onSwipeEnd?.();
    Animated.spring(translateX, { toValue: -DELETE_ZONE_WIDTH, useNativeDriver: true, tension: 90, friction: 10 }).start();
  }

  function snapClose() {
    isOpen.current = false;
    onSwipeEnd?.();
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 90, friction: 12 }).start();
  }

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dx, dy }) =>
        Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8,
      onPanResponderGrant: () => {
        setSwipeStarted(true);
        onSwipeStart?.();
      },
      onPanResponderMove: (_, { dx }) => {
        const base = isOpen.current ? -DELETE_ZONE_WIDTH : 0;
        translateX.setValue(Math.min(8, Math.max(base + dx, -DELETE_ZONE_WIDTH * 2)));
      },
      onPanResponderRelease: (_, { dx, vx }) => {
        const base = isOpen.current ? -DELETE_ZONE_WIDTH : 0;
        const finalX = base + dx;
        if (vx < -1.0 || finalX < -DELETE_ZONE_WIDTH * 1.4) {
          slideOut();
        } else if (isOpen.current && finalX > -DELETE_ZONE_WIDTH * 0.4) {
          snapClose();
        } else if (finalX < -SNAP_THRESHOLD) {
          snapOpen();
        } else {
          snapClose();
        }
      },
      onPanResponderTerminate: () => {
        onSwipeEnd?.();
        if (isOpen.current) snapOpen(); else snapClose();
      },
    })
  ).current;

  return (
    <View style={swipeStyles.row}>
      {swipeStarted && (
        <Animated.View style={[swipeStyles.deleteZone, { opacity: deleteOpacity }]}>
          <Pressable onPress={slideOut} style={swipeStyles.deleteBtn} hitSlop={12}>
            <Animated.View style={{ transform: [{ scale: iconScale }] }}>
              <Ionicons name="trash-outline" size={22} color="#fff" />
            </Animated.View>
          </Pressable>
        </Animated.View>
      )}
      <Animated.View
        style={{ transform: [{ translateX }], backgroundColor: '#FFFFFF' }}
        pointerEvents={isOpen.current ? 'none' : 'auto'}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const swipeStyles = StyleSheet.create({
  row: { position: 'relative' },
  deleteZone: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: DELETE_ZONE_WIDTH,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtn: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NotificationsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [respondedAttendances, setRespondedAttendances] = useState(new Map());
  const [pendingClassInputIds, setPendingClassInputIds] = useState(new Set());
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [activeNotif, setActiveNotif] = useState(null);
  // What was unread when the screen opened: it keeps its dot (the rows are
  // marked read in the background) until "Mark all read".
  const [unreadIds, setUnreadIds] = useState(new Set());
  const [filter, setFilter] = useState('all'); // 'all' | 'coach' | 'class'
  // Who's reading: the second tab is "From <coach>" for a dancer, "Students"
  // for a coach (who also has no settings button).
  const [isCoach, setIsCoach] = useState(false);
  const [coachName, setCoachName] = useState(null);

  const scrollRef = useRef(null);
  const pull = usePullRefresh({
    refreshing,
    onRefresh: () => handleRefresh(),
    scrollToTop: () => scrollRef.current?.scrollTo({ y: 0, animated: true }),
  });

  async function refreshCoachPending() {
    // For coach-action notifs (focus_point_added etc.), find which linked
    // class_inputs still have unresolved pending_coach FPs. Resolved notifs
    // fall back to normal read/unread fading.
    const { data } = await supabase
      .from('focus_points')
      .select('source_class_input_id')
      .eq('status', 'pending_coach')
      .eq('is_deleted', false);
    setPendingClassInputIds(new Set((data ?? []).map(r => r.source_class_input_id).filter(Boolean)));
  }

  function handleDelete(id) {
    setNotifications(prev => prev.filter(n => n.id !== id));
    deleteNotification(id);
  }

  function getPriorAttendance(classInputId) {
    if (!classInputId) return undefined;
    if (locallyRespondedAttendance.has(classInputId)) {
      return locallyRespondedAttendance.get(classInputId);
    }
    if (respondedAttendances.has(classInputId)) {
      return respondedAttendances.get(classInputId);
    }
    return undefined;
  }

  async function handleAttendanceChange(classInputId, attended) {
    const response = attended ? 'yes' : 'no';
    await respondToAttendance(classInputId, response);
    locallyRespondedAttendance.set(classInputId, attended);
    setRespondedAttendances(prev => {
      const next = new Map(prev);
      next.set(classInputId, attended);
      return next;
    });
  }

  function handleNotificationPress(notif) {
    if (notif.type === 'attendance_check' || notif.type === 'group_class_attendance') {
      if (!notif.data) return;
      const prior = getPriorAttendance(notif.data.class_input_id);
      if (typeof prior === 'boolean') {
        // Already responded — open the edit popup instead of re-routing.
        setActiveNotif(notif);
        return;
      }
      navigation.navigate('AttendanceConfirm', {
        classInputId: notif.data.class_input_id,
        coachName: notif.data.coach_name,
        classDate: notif.data.lesson_date ?? notif.data.class_date,
      });
    } else if (notif.type === 'transcript_ready' && !isCoach && notif.data?.class_input_id) {
      // "Read the summary" — straight to the lesson.
      navigation.navigate('ClassDetail', { inputId: notif.data.class_input_id });
    } else if (POPUP_READONLY_TYPES.has(notif.type)) {
      setActiveNotif(notif);
    } else if (COACH_ACTION_TYPES.has(notif.type)) {
      // The same type ('focus_point_added' singular) is reused by two
      // unrelated triggers: a coach-side one (data has student_id) and a
      // student-side one fired when the coach validates a focus point
      // (data has focus_point_id). Route by payload, not just by type.
      const isStudentSide = !!notif.data?.focus_point_id && !notif.data?.student_id;
      if (isStudentSide) {
        navigation.replace('AllFocusPoints');
      } else {
        navigation.navigate('ActionNeeded');
      }
    } else if (notif.type === 'merge_request_student') {
      // No dedicated merge-review screen exists; TrainerReview surfaces the
      // student's focus points with the merge-request badge, so it's the
      // actionable landing spot. (Was navigating to an unregistered
      // 'MergeReview' route → dead no-op.)
      navigation.navigate('TrainerReview');
    } else if (notif.type === 'child_phone_linked') {
      // A parent's account: the phone is managed from Stats ▸ Links.
      navigation.navigate('MainTabs', { screen: 'PROFILE', params: { tab: 'links' } });
    } else if (notif.type === 'coach_request_received') {
      // CoachHomeScreen is the STUDENTS tab inside CoachMainTabs and surfaces
      // pending requests at the top of the list with accept/reject buttons.
      navigation.navigate('CoachMainTabs', { screen: 'STUDENTS' });
    } else if (notif.type === 'sync_reminder') {
      // Coach-only nudge to import unsynced DJI audio → the same full-screen
      // reminder the push opens (it names the waiting classes and leads into
      // the mic import), rather than the bare upload screen. Requested lazily
      // so the student build never pulls the coach-only module in.
      require('../services/syncReminder').requestReminderOpen();
    } else {
      // Fallback for any unknown type — at least show the content rather than no-op.
      setActiveNotif(notif);
    }
  }

  async function refreshResponded() {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;
    const { data } = await supabase
      .from('attendance_responses')
      .select('class_input_id, attended')
      .eq('student_id', userId);
    const map = new Map();
    for (const r of (data ?? [])) map.set(r.class_input_id, r.attended);
    setRespondedAttendances(map);
  }

  async function load({ first = false } = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id ?? null;
    const [data, responsesRes] = await Promise.all([
      getNotifications(),
      userId
        ? supabase.from('attendance_responses').select('class_input_id, attended').eq('student_id', userId)
        : Promise.resolve({ data: [] }),
    ]);
    if (first) setUnreadIds(new Set(data.filter(n => !n.read).map(n => n.id)));
    else setUnreadIds((prev) => new Set([...prev, ...data.filter(n => !n.read).map(n => n.id)]));
    setNotifications(data);
    const map = new Map();
    for (const r of (responsesRes.data ?? [])) map.set(r.class_input_id, r.attended);
    setRespondedAttendances(map);
    await refreshCoachPending();
  }

  async function handleRefresh() {
    setRefreshing(true);
    try { await load(); } catch {}
    setRefreshing(false);
  }

  useEffect(() => {
    (async () => {
      try { await load({ first: true }); } catch {}
      setLoading(false);
      setTimeout(() => markAllNotificationsRead(), 2000);
    })();
    // Who's reading: a coach, or a dancer (and their coach's name).
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const role = await readCachedRole(session).catch(() => null);
      if (role === 'coach') { setIsCoach(true); return; }
      AsyncStorage.getItem('@cache_profile').then((profile) => {
        const p = profile && JSON.parse(profile);
        const coach = p?.myCoach?.name || p?.latinCoach?.name || p?.ballroomCoach?.name;
        if (coach) setCoachName(coach);
      }).catch(() => {});
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      refreshResponded();
      refreshCoachPending();
    });
    return unsub;
  }, [navigation]);

  function markAllRead() {
    setUnreadIds(new Set());
    markAllNotificationsRead();
  }

  const unreadCount = notifications.filter(n => unreadIds.has(n.id)).length;
  const coachFirst = firstName(coachName);
  const tabs = [
    ['all', 'All'],
    ['coach', isCoach ? 'Students' : coachFirst ? `From ${coachFirst}` : 'From coach'],
    ['class', 'Classes'],
  ];
  const shown = notifications.filter((n) => filter === 'all' || (TYPE_META[n.type] || DEFAULT_META).group === filter);
  const groups = [];
  for (const n of shown) {
    const g = groupOf(n.created_at);
    if (!groups.length || groups[groups.length - 1].title !== g) groups.push({ title: g, items: [] });
    groups[groups.length - 1].items.push(n);
  }

  function renderRow(notif, index) {
    const meta = TYPE_META[notif.type] || DEFAULT_META;
    const alreadyResponded =
      (ATTENDANCE_TYPES.has(notif.type) && (
        respondedAttendances.has(notif.data?.class_input_id) ||
        locallyRespondedAttendance.has(notif.data?.class_input_id)
      )) ||
      (notif.type === 'name_match_confirm' && locallyResolvedNameMatches.has(notif.id));
    const isActionable = ACTIONABLE_TYPES.has(notif.type) && !alreadyResponded;
    // Coach-action notifs stay "unread" until the coach actually resolves the
    // action; once the linked class has no more pending_coach FPs, they fade.
    const linkedClassInputId = notif.data?.class_input_id;
    const stillHasPending =
      COACH_ACTION_TYPES.has(notif.type) &&
      (!linkedClassInputId || pendingClassInputIds.has(linkedClassInputId));
    const lookUnread = unreadIds.has(notif.id) || stillHasPending || isActionable;
    const isStudentSideFocus = notif.type === 'focus_point_added' && !notif.data?.student_id;
    const cta = isActionable || lookUnread || notif.type === 'transcript_ready' || isStudentSideFocus
      ? (isCoach && meta.coachCta) || meta.cta
      : null;
    // A lesson's own news carries the coach's initial, like a message from them.
    const fromCoach = !isCoach && coachFirst && (notif.type === 'transcript_ready' || isStudentSideFocus);

    const row = (
      <Pressable
        style={({ pressed }) => [st.row, index > 0 && st.rowSep, pressed && { backgroundColor: '#FBFAF7' }]}
        onPress={() => handleNotificationPress(notif)}
      >
        {fromCoach ? (
          <LinearGradient colors={['#F6D27A', GOLD]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.avatar}>
            <Text style={st.avatarTxt}>{coachFirst.charAt(0).toUpperCase()}</Text>
          </LinearGradient>
        ) : (
          <View style={[st.icon, isActionable && st.iconWarm]}>
            <Ionicons
              name={meta.icon}
              size={17}
              color={isActionable ? GOLD_INK : lookUnread ? INK : INK_50}
            />
          </View>
        )}
        <View style={st.body}>
          <View style={st.headline}>
            <Text style={[st.title, !lookUnread && st.titleRead]} numberOfLines={2}>{notif.title}</Text>
            <Text style={st.time}>{formatTime(notif.created_at)}</Text>
          </View>
          {!!notif.body && <Text style={st.text} numberOfLines={2}>{notif.body}</Text>}
          {cta ? <Text style={st.cta}>{cta} →</Text> : null}
        </View>
        <View style={[st.dot, !(unreadIds.has(notif.id) || isActionable) && { backgroundColor: 'transparent' }]} />
      </Pressable>
    );

    return isActionable ? (
      <View key={notif.id}>{row}</View>
    ) : (
      <SwipeToDelete
        key={notif.id}
        id={notif.id}
        onDelete={handleDelete}
        onSwipeStart={() => setScrollEnabled(false)}
        onSwipeEnd={() => setScrollEnabled(true)}
      >
        {row}
      </SwipeToDelete>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: PAGE }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        {/* Just the way back and the page's name. */}
        <View style={st.titleRow}>
          <TouchableOpacity
            style={st.back}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={19} color={INK} />
          </TouchableOpacity>
          <Text style={st.pageTitle} numberOfLines={1}>Notifications</Text>
          <TouchableOpacity onPress={markAllRead} disabled={unreadCount === 0} hitSlop={{ top: 10, bottom: 10, left: 10 }}>
            <Text style={[st.markAll, unreadCount === 0 && { color: INK_34 }]}>Mark all read</Text>
          </TouchableOpacity>
        </View>

        <View style={st.tabs}>
          {tabs.map(([key, label]) => {
            const on = filter === key;
            return (
              <TouchableOpacity
                key={key}
                style={[st.tab, on && st.tabOn]}
                onPress={() => setFilter(key)}
                activeOpacity={0.7}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[st.tabLabel, on && { color: INK }]} numberOfLines={1}>{label}</Text>
              </TouchableOpacity>
            );
          })}
          <Text style={st.count}>{unreadCount ? `${unreadCount} unread` : 'All read'}</Text>
        </View>

        {loading ? (
          <GenericListSkeleton rows={6} showHeader={false} showTitle={false} />
        ) : (
          <View style={{ flex: 1 }}>
            {pull.ios ? (
              <View pointerEvents="none" style={st.pullLogo}>
                <PullLogo ref={pull.logoRef} refreshing={refreshing} />
              </View>
            ) : null}
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={[st.list, { paddingBottom: insets.bottom + 96 }]}
              showsVerticalScrollIndicator={false}
              scrollEnabled={scrollEnabled}
              {...pull.scrollProps}
            >
              {notifications.length === 0 ? (
                <View style={st.empty}>
                  <Text style={st.emptyTitle}>No notifications yet</Text>
                  <Text style={st.emptyText}>
                    You’ll hear here when your coach accepts a request, adds focus points, or when a class needs your attendance.
                  </Text>
                </View>
              ) : groups.length === 0 ? (
                <Text style={st.emptyText}>Nothing here yet.</Text>
              ) : groups.map((g) => (
                <View key={g.title}>
                  <View style={st.group}>
                    <Text style={st.groupTitle}>{g.title}</Text>
                    <Text style={st.groupCount}>{g.items.length}</Text>
                  </View>
                  <View style={st.card}>
                    {g.items.map((n, i) => renderRow(n, i))}
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Notification settings: a round button in the corner, like Lessons' +.
            (Dancers only — the settings screen lives in the student app.) */}
        {!isCoach ? (
          <TouchableOpacity
            style={[st.fab, { bottom: insets.bottom + 14 }]}
            onPress={() => navigation.navigate('NotificationSettings', { coachName })}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Notification settings"
          >
            <Ionicons name="settings-outline" size={24} color={INK} />
          </TouchableOpacity>
        ) : null}

        <Modal
          visible={!!activeNotif}
          transparent
          animationType="slide"
          onRequestClose={() => setActiveNotif(null)}
        >
          {activeNotif && (
            <NotificationDetailSheet
              notif={activeNotif}
              priorAttendance={
                ATTENDANCE_TYPES.has(activeNotif.type)
                  ? getPriorAttendance(activeNotif.data?.class_input_id)
                  : undefined
              }
              onClose={() => setActiveNotif(null)}
              onAttendanceChange={(attended) =>
                handleAttendanceChange(activeNotif.data?.class_input_id, attended)
              }
            />
          )}
        </Modal>
      </SafeAreaView>
    </View>
  );
}

const st = StyleSheet.create({
  // Same height and place as the tab headers' first row.
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingTop: 6, paddingHorizontal: SIDE },
  back: { width: 36, height: 36, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: INK, shadowOpacity: 0.07, shadowOffset: { width: 0, height: 1 }, shadowRadius: 2, elevation: 1 },
  pageTitle: { flex: 1, fontFamily: Fonts.ttBold, fontSize: 24, letterSpacing: -0.84, lineHeight: 28, color: INK },
  markAll: { fontFamily: Fonts.ttDemiBold, fontSize: 12, color: GOLD_INK },
  tabs: { flexDirection: 'row', alignItems: 'flex-end', gap: 22, marginTop: 20, marginHorizontal: SIDE, borderBottomWidth: 1, borderBottomColor: LINE },
  tab: { paddingBottom: 9, marginBottom: -1, borderBottomWidth: 2, borderBottomColor: 'transparent', flexShrink: 1 },
  tabOn: { borderBottomColor: GOLD },
  tabLabel: { fontFamily: Fonts.ttDemiBold, fontSize: 15, letterSpacing: -0.3, color: INK_65 },
  count: { marginLeft: 'auto', paddingBottom: 11, fontFamily: Fonts.ttRegular, fontSize: 11.5, color: INK_55 },
  pullLogo: { position: 'absolute', top: 14, left: 0, right: 0, alignItems: 'center' },
  list: { paddingHorizontal: SIDE },
  group: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 18, paddingBottom: 8, paddingHorizontal: 2 },
  groupTitle: { fontFamily: Fonts.ttDemiBold, fontSize: 9.5, letterSpacing: 1.6, textTransform: 'uppercase', color: INK_45 },
  groupCount: { fontFamily: Fonts.ttMedium, fontSize: 9.5, letterSpacing: 0.57, color: INK_45 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: HAIR, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 13, paddingVertical: 14, paddingHorizontal: 15, backgroundColor: '#FFFFFF' },
  rowSep: { borderTopWidth: 1, borderTopColor: HAIR },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: TILE, alignItems: 'center', justifyContent: 'center' },
  iconWarm: { backgroundColor: GOLD_100 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: Fonts.ttBold, fontSize: 12.5, color: INK },
  body: { flex: 1, minWidth: 0, gap: 3 },
  headline: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  title: { flex: 1, minWidth: 0, fontFamily: Fonts.ttDemiBold, fontSize: 14.5, lineHeight: 19, letterSpacing: -0.22, color: INK },
  titleRead: { fontFamily: Fonts.ttMedium, color: INK_72 },
  time: { fontFamily: Fonts.ttRegular, fontSize: 10.5, color: INK_45 },
  text: { fontFamily: Fonts.ttRegular, fontSize: 12.5, lineHeight: 17.5, color: INK_60 },
  cta: { marginTop: 5, fontFamily: Fonts.ttDemiBold, fontSize: 11.5, color: GOLD_INK },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: GOLD, marginTop: 6 },
  empty: { paddingTop: 40, paddingHorizontal: 12, alignItems: 'center', gap: 6 },
  emptyTitle: { fontFamily: Fonts.ttDemiBold, fontSize: 15.5, color: INK, textAlign: 'center' },
  emptyText: { paddingTop: 20, fontFamily: Fonts.ttRegular, fontSize: 13, lineHeight: 19, color: INK_50, textAlign: 'center' },
  fab: {
    position: 'absolute',
    right: SIDE,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7A5710',
    shadowOpacity: 0.28,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 6,
  },
});
