import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Animated, PanResponder } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Spacing } from '../theme';
import { getNotifications, markAllNotificationsRead, deleteNotification } from '../storage/notificationsStorage';
import { supabase } from '../services/supabase/client';
import { locallyRespondedAttendance, locallyResolvedNameMatches } from '../storage/attendanceState';

const ATTENDANCE_TYPES = new Set(['attendance_check', 'group_class_attendance']);
const ACTIONABLE_TYPES = new Set(['attendance_check', 'group_class_attendance', 'merge_request_student', 'name_match_confirm']);
// Coach-facing "action needed" notification types: tapping any of these
// routes straight to the ActionNeeded screen (where the coach can validate
// focus points, resolve merge requests, or confirm name matches).
const COACH_ACTION_TYPES = new Set([
  'focus_points_added',
  'focus_point_added',
  'merge_request',
  'name_match_confirm',
]);

const TYPE_CONFIG = {
  coach_request_accepted:  { icon: 'checkmark-circle-outline', color: '#34C759' },
  coach_request_declined:  { icon: 'close-circle-outline',     color: '#FF3B30' },
  attendance_check:        { icon: 'people-circle-outline',    color: Colors.orange, cta: 'Confirm attendance' },
  group_class_attendance:  { icon: 'people-circle-outline',    color: Colors.orange, cta: 'Confirm attendance' },
  focus_points_added:      { icon: 'star-outline',             color: '#34C759' },
  focus_point_added:       { icon: 'star-outline',             color: '#34C759' },
  merge_request:           { icon: 'git-merge-outline',        color: '#5788E6' },
  merge_request_student:   { icon: 'git-merge-outline',        color: '#5788E6', cta: 'Review' },
  name_match_confirm:      { icon: 'help-circle-outline',      color: '#FF9500', cta: 'Confirm' },
};

function formatTime(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

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
        style={{ transform: [{ translateX }] }}
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
    borderRadius: 16,
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
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [respondedClassInputIds, setRespondedClassInputIds] = useState(new Set());
  const [currentUserId, setCurrentUserId] = useState(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const initiallyUnread = useRef(new Set());

  function handleDelete(id) {
    setNotifications(prev => prev.filter(n => n.id !== id));
    deleteNotification(id);
  }

  function handleNotificationPress(notif) {
    if (notif.type === 'attendance_check' || notif.type === 'group_class_attendance') {
      if (!notif.data) return;
      const responded = respondedClassInputIds.has(notif.data.class_input_id) ||
        locallyRespondedAttendance.has(notif.data.class_input_id);
      if (responded) return;
      navigation.navigate('AttendanceConfirm', {
        classInputId: notif.data.class_input_id,
        coachName: notif.data.coach_name,
        classDate: notif.data.lesson_date ?? notif.data.class_date,
      });
    } else if (COACH_ACTION_TYPES.has(notif.type)) {
      // Coach action needed (focus point review / merge / name match) —
      // all three are handled in a single ActionNeeded screen with tabs.
      navigation.navigate('ActionNeeded');
    } else if (notif.type === 'focus_point_added') {
      navigation.replace('AllFocusPoints');
    } else if (notif.type === 'merge_request_student' && notif.data?.merge_request_id) {
      navigation.navigate('MergeReview', { mergeRequestId: notif.data.merge_request_id });
    }
  }

  async function refreshResponded() {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;
    const { data } = await supabase
      .from('attendance_responses')
      .select('class_input_id')
      .eq('student_id', userId);
    setRespondedClassInputIds(new Set((data ?? []).map(r => r.class_input_id)));
  }

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id ?? null;
      setCurrentUserId(userId);
      const [data, responsesRes] = await Promise.all([
        getNotifications(),
        userId
          ? supabase.from('attendance_responses').select('class_input_id').eq('student_id', userId)
          : Promise.resolve({ data: [] }),
      ]);
      initiallyUnread.current = new Set(data.filter(n => !n.read).map(n => n.id));
      setNotifications(data);
      setRespondedClassInputIds(new Set((responsesRes.data ?? []).map(r => r.class_input_id)));
      setLoading(false);
      setTimeout(() => markAllNotificationsRead(), 2000);
    }
    load();
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener('focus', refreshResponded);
    return unsub;
  }, [navigation]);

  const unreadCount = notifications.filter(n => initiallyUnread.current.has(n.id)).length;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={Colors.black} />
        </Pressable>
        <Text style={styles.title}>Notifications</Text>
        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount}</Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={Colors.secondary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          scrollEnabled={scrollEnabled}
        >
          {notifications.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="notifications-off-outline" size={44} color="#D8D8D8" />
              <Text style={styles.emptyTitle}>No notifications yet</Text>
              <Text style={styles.emptySubtitle}>
                You'll be notified when your coach accepts a request, adds focus points, or when a class needs attendance confirmation.
              </Text>
            </View>
          ) : (
            notifications.map((notif) => {
              const config = TYPE_CONFIG[notif.type] ?? { icon: 'notifications-outline', color: Colors.secondary };
              const alreadyResponded =
                (ATTENDANCE_TYPES.has(notif.type) && (
                  respondedClassInputIds.has(notif.data?.class_input_id) ||
                  locallyRespondedAttendance.has(notif.data?.class_input_id)
                )) ||
                (notif.type === 'name_match_confirm' && locallyResolvedNameMatches.has(notif.id));
              const isActionable = ACTIONABLE_TYPES.has(notif.type) && !alreadyResponded;
              const wasUnread = initiallyUnread.current.has(notif.id);

              const card = (
                <Pressable
                  style={({ pressed }) => [
                    styles.card,
                    isActionable && styles.cardActionable,
                    !isActionable && wasUnread && styles.cardUnread,
                    !isActionable && !wasUnread && styles.cardRead,
                    pressed && styles.cardPressed,
                  ]}
                  onPress={() => handleNotificationPress(notif)}
                >
                  {/* Left accent bar */}
                  {isActionable && (
                    <View style={[styles.accentBar, { backgroundColor: Colors.orange }]} />
                  )}
                  {!isActionable && wasUnread && (
                    <View style={[styles.accentBar, { backgroundColor: Colors.black }]} />
                  )}

                  {/* Icon */}
                  <View style={[
                    styles.iconWrap,
                    { backgroundColor: isActionable
                        ? 'rgba(255,157,0,0.13)'
                        : wasUnread
                          ? '#EFEFEF'
                          : '#F3F3F3',
                    },
                  ]}>
                    <Ionicons
                      name={config.icon}
                      size={20}
                      color={
                        isActionable ? Colors.orange
                        : wasUnread   ? Colors.black
                        :               '#B0B0B0'
                      }
                    />
                  </View>

                  {/* Body */}
                  <View style={styles.cardBody}>
                    <View style={styles.cardTop}>
                      <Text
                        style={[
                          styles.cardTitle,
                          (wasUnread || isActionable) ? styles.cardTitleBold : styles.cardTitleMuted,
                        ]}
                        numberOfLines={2}
                      >
                        {notif.title}
                      </Text>
                      <Text style={styles.cardTime}>{formatTime(notif.created_at)}</Text>
                    </View>
                    <Text
                      style={[styles.cardBody2, (!wasUnread && !isActionable) && styles.cardBody2Muted]}
                      numberOfLines={2}
                    >
                      {notif.body}
                    </Text>
                    {isActionable && config.cta && (
                      <View style={styles.ctaRow}>
                        <View style={styles.ctaPill}>
                          <Text style={styles.ctaText}>{config.cta}</Text>
                          <Ionicons name="chevron-forward" size={11} color={Colors.orange} />
                        </View>
                      </View>
                    )}
                  </View>

                  {/* Unread dot */}
                  {wasUnread && !isActionable && <View style={styles.dot} />}
                </Pressable>
              );

              return isActionable ? (
                <View key={notif.id}>{card}</View>
              ) : (
                <SwipeToDelete
                  key={notif.id}
                  id={notif.id}
                  onDelete={handleDelete}
                  onSwipeStart={() => setScrollEnabled(false)}
                  onSwipeEnd={() => setScrollEnabled(true)}
                >
                  {card}
                </SwipeToDelete>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingTop: 8,
    paddingBottom: 14,
    gap: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 2,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: Colors.black,
    flex: 1,
    letterSpacing: -0.3,
  },
  badge: {
    backgroundColor: Colors.orange,
    borderRadius: 10,
    minWidth: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: '#fff',
  },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  list: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 48,
    gap: 6,
  },

  // ── Card ──
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12,
    overflow: 'hidden',
  },
  cardActionable: {
    backgroundColor: '#FFFAF2',
    borderWidth: 1,
    borderColor: 'rgba(255,157,0,0.22)',
  },
  cardUnread: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EBEBEB',
  },
  cardRead: {
    backgroundColor: '#F6F6F6',
    borderWidth: 1,
    borderColor: '#EFEFEF',
  },
  cardPressed: {
    backgroundColor: '#F0F0F0',
  },

  accentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },

  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  cardBody: { flex: 1, gap: 3 },

  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
  },
  cardTitleBold: {
    fontFamily: Fonts.jakartaBold,
    color: Colors.black,
  },
  cardTitleMuted: {
    fontFamily: Fonts.jakartaMedium,
    color: '#999',
  },
  cardTime: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11,
    color: '#ADADAD',
    marginTop: 2,
    flexShrink: 0,
  },

  cardBody2: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    lineHeight: 18,
  },
  cardBody2Muted: {
    color: '#BDBDBD',
  },

  // CTA
  ctaRow: { marginTop: 8, flexDirection: 'row' },
  ctaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,157,0,0.11)',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 20,
  },
  ctaText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 12,
    color: Colors.orange,
  },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.black,
    marginTop: 7,
    flexShrink: 0,
  },

  emptyWrap: {
    marginTop: 80,
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: Colors.black,
    marginTop: 4,
  },
  emptySubtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.secondary,
    textAlign: 'center',
    lineHeight: 21,
  },
});
