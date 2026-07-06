import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Animated, PanResponder, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Colors, Fonts, Spacing } from '../theme';
import { getNotifications, markAllNotificationsRead, deleteNotification } from '../storage/notificationsStorage';
import { supabase } from '../services/supabase/client';
import { locallyRespondedAttendance, locallyResolvedNameMatches } from '../storage/attendanceState';
import { respondToAttendance } from '../storage/storage';
import { GenericListSkeleton } from '../components/Skeleton';
import NotificationDetailSheet from '../components/NotificationDetailSheet';

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

// Typographic category labels. Used instead of iconography to convey notification
// type — feels editorial / premium rather than cluttered with mismatched glyphs.
const TYPE_CONFIG = {
  coach_request_received:  { label: 'Request',     color: Colors.orange, cta: 'Review' },
  coach_request_accepted:  { label: 'Request',     color: '#34C759' },
  coach_request_declined:  { label: 'Request',     color: '#FF3B30' },
  attendance_check:        { label: 'Attendance',  color: Colors.orange, cta: 'Confirm attendance' },
  group_class_attendance:  { label: 'Attendance',  color: Colors.orange, cta: 'Confirm attendance' },
  focus_points_added:      { label: 'Review',      color: Colors.orange },
  focus_point_added:       { label: 'Review',      color: Colors.orange },
  focus_reconcile_needed:  { label: 'Reconcile',   color: '#FF3B30', cta: 'Pick which to keep' },
  focus_point_rejected:    { label: 'Declined',    color: '#FF3B30' },
  merge_request:           { label: 'Merge',       color: '#5788E6' },
  merge_request_student:   { label: 'Merge',       color: '#5788E6', cta: 'Review' },
  name_match_confirm:      { label: 'Name match',  color: '#FF9500', cta: 'Confirm' },
  sync_reminder:           { label: 'Sync',        color: Colors.orange, cta: 'Import audio' },
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
  const [respondedAttendances, setRespondedAttendances] = useState(new Map());
  const [pendingClassInputIds, setPendingClassInputIds] = useState(new Set());
  const [currentUserId, setCurrentUserId] = useState(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [activeNotif, setActiveNotif] = useState(null);
  const initiallyUnread = useRef(new Set());

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
    } else if (notif.type === 'coach_request_received') {
      // CoachHomeScreen is the STUDENTS tab inside CoachMainTabs and surfaces
      // pending requests at the top of the list with accept/reject buttons.
      navigation.navigate('CoachMainTabs', { screen: 'STUDENTS' });
    } else if (notif.type === 'sync_reminder') {
      // Coach-only nudge to import unsynced DJI audio → the upload screen.
      navigation.navigate('LocalUpload');
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

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id ?? null;
      setCurrentUserId(userId);
      const [data, responsesRes] = await Promise.all([
        getNotifications(),
        userId
          ? supabase.from('attendance_responses').select('class_input_id, attended').eq('student_id', userId)
          : Promise.resolve({ data: [] }),
      ]);
      initiallyUnread.current = new Set(data.filter(n => !n.read).map(n => n.id));
      setNotifications(data);
      const map = new Map();
      for (const r of (responsesRes.data ?? [])) map.set(r.class_input_id, r.attended);
      setRespondedAttendances(map);
      await refreshCoachPending();
      setLoading(false);
      setTimeout(() => markAllNotificationsRead(), 2000);
    }
    load();
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      refreshResponded();
      refreshCoachPending();
    });
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
        <GenericListSkeleton rows={6} showHeader={false} showTitle={false} />
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
                  respondedAttendances.has(notif.data?.class_input_id) ||
                  locallyRespondedAttendance.has(notif.data?.class_input_id)
                )) ||
                (notif.type === 'name_match_confirm' && locallyResolvedNameMatches.has(notif.id));
              const isActionable = ACTIONABLE_TYPES.has(notif.type) && !alreadyResponded;
              const wasUnread = initiallyUnread.current.has(notif.id);
              // Coach-action notifs stay in full "unread" color until the coach
              // actually resolves the action — the read-dot still disappears on tap,
              // but the card color doesn't fade. Once the underlying class_input
              // has no more pending_coach FPs, the notif fades normally.
              const coachActionType = COACH_ACTION_TYPES.has(notif.type);
              const linkedClassInputId = notif.data?.class_input_id;
              const stillHasPending =
                coachActionType &&
                (!linkedClassInputId || pendingClassInputIds.has(linkedClassInputId));
              const lookUnread = wasUnread || stillHasPending;

              const card = (
                <Pressable
                  style={({ pressed }) => [
                    styles.card,
                    pressed && styles.cardPressed,
                  ]}
                  onPress={() => handleNotificationPress(notif)}
                >
                  <View style={styles.cardBody}>
                    {/* Category + time header */}
                    <View style={styles.metaHeader}>
                      {!!config.label && (
                        <Text
                          style={[
                            styles.categoryLabel,
                            { color: (lookUnread || isActionable) ? (config.color ?? Colors.black) : '#C8C8C8' },
                          ]}
                        >
                          {config.label}
                        </Text>
                      )}
                      {wasUnread && !isActionable && <View style={[styles.unreadDot, { backgroundColor: config.color ?? Colors.orange }]} />}
                      <View style={{ flex: 1 }} />
                      <Text style={[styles.cardTime, (!lookUnread && !isActionable) && styles.cardTimeMuted]}>
                        {formatTime(notif.created_at)}
                      </Text>
                    </View>

                    {/* Title */}
                    <Text
                      style={[
                        styles.cardTitle,
                        (lookUnread || isActionable) ? styles.cardTitleBold : styles.cardTitleMuted,
                      ]}
                      numberOfLines={2}
                    >
                      {notif.title}
                    </Text>

                    {/* Body */}
                    {!!notif.body && (
                      <Text
                        style={[styles.cardBody2, (!lookUnread && !isActionable) && styles.cardBody2Muted]}
                        numberOfLines={2}
                      >
                        {notif.body}
                      </Text>
                    )}

                    {/* CTA */}
                    {isActionable && config.cta && (
                      <View style={styles.ctaRow}>
                        <Text style={[styles.ctaInline, { color: config.color ?? Colors.orange }]}>
                          {config.cta}
                        </Text>
                        <Ionicons name="arrow-forward" size={12} color={config.color ?? Colors.orange} />
                      </View>
                    )}
                  </View>
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
    paddingBottom: 48,
  },

  // ── Card ── editorial, full-width, hairline-separated
  card: {
    paddingHorizontal: Spacing.side,
    paddingTop: 16,
    paddingBottom: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFEFEF',
  },
  cardPressed: {
    backgroundColor: 'rgba(0,0,0,0.025)',
  },

  cardBody: {
    gap: 4,
  },

  metaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 4,
  },
  categoryLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  cardTitle: {
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.2,
  },
  cardTitleBold: {
    fontFamily: Fonts.jakartaBold,
    color: Colors.black,
  },
  cardTitleMuted: {
    fontFamily: Fonts.jakartaMedium,
    color: '#9A9A9A',
  },

  cardBody2: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13.5,
    color: '#5C6370',
    lineHeight: 19,
    marginTop: 1,
  },
  cardBody2Muted: {
    color: '#B5B5B5',
  },

  cardTime: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: '#9A9A9A',
    letterSpacing: 0.1,
  },
  cardTimeMuted: {
    color: '#C8C8C8',
  },

  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 10,
  },
  ctaInline: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
    letterSpacing: 0.2,
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
