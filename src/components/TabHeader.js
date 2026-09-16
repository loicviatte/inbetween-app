import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Fonts, Spacing } from '../theme';
import { useProfile } from '../context/ProfileContext';
import { getNotifications } from '../storage/notificationsStorage';
import { locallyRespondedAttendance } from '../storage/attendanceState';
import { supabase } from '../services/supabase/client';

// A parent's account shows their child's training through the same screens,
// so the header says, on every tab, whose account this is.
export function useIsParentAccount() {
  const [isParent, setIsParent] = useState(false);

  useEffect(() => {
    let alive = true;
    const read = (session) => session?.user?.user_metadata?.account_for === 'child';
    supabase.auth.getSession().then(({ data: { session } }) => { if (alive) setIsParent(read(session)); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setIsParent(read(session)));
    return () => { alive = false; sub?.subscription?.unsubscribe(); };
  }, []);

  return isParent;
}

export default function TabHeader({ navigation, onProfilePress, editMode = false, center = null, right = null, lead = null, style = null }) {
  const { avatarUri, initials: contextInitials } = useProfile();

  const [cachedPhoto, setCachedPhoto] = useState(null);
  const [cachedInitials, setCachedInitials] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const isParent = useIsParentAccount();

  useEffect(() => {
    async function load() {
      const [photo, name] = await Promise.all([
        AsyncStorage.getItem('@profile_photo'),
        AsyncStorage.getItem('@profile_name'),
      ]);
      setCachedPhoto(photo || null);
      if (name) {
        setCachedInitials(name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase());
      }
    }
    load();
  }, []);

  useEffect(() => {
    async function loadUnread() {
      const notifs = await getNotifications();

      // Load DB-persisted attendance responses to avoid false positives after app restart
      let respondedIds = new Set();
      try {
        const { supabase: sb } = await import('../services/supabase/client');
        const { data: { session } } = await sb.auth.getSession();
        if (session?.user?.id) {
          const { data } = await sb
            .from('attendance_responses')
            .select('class_input_id')
            .eq('student_id', session.user.id);
          respondedIds = new Set((data ?? []).map(r => r.class_input_id));
        }
      } catch {}

      const count = notifs.filter(n => {
        if (n.type === 'attendance_check' || n.type === 'group_class_attendance') {
          // Only count if not yet responded (check both local Set and DB)
          return !respondedIds.has(n.data?.class_input_id) &&
                 !locallyRespondedAttendance.has(n.data?.class_input_id);
        }
        if (n.type === 'merge_request_student') return true;
        if (n.type === 'name_match_confirm') return true;
        return !n.read;
      }).length;
      setUnreadCount(count);
    }
    loadUnread();
    const unsub = navigation?.addListener?.('focus', loadUnread);
    return () => unsub?.();
  }, [navigation]);

  const photoUri = avatarUri || cachedPhoto;
  const initials = contextInitials || cachedInitials || 'ME';

  function handleProfilePress() {
    if (onProfilePress) {
      onProfilePress();
    } else {
      navigation.navigate('PROFILE');
    }
  }

  return (
    <View>
    <View style={[styles.header, style]}>
      <TouchableOpacity
        style={styles.notifBtn}
        onPress={() => navigation.navigate('Notifications')}
        activeOpacity={0.7}
        accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
      >
        <Ionicons name="notifications-outline" size={19} color={Colors.black} />
        {unreadCount > 0 && (
          <View style={styles.notifBadge}>
            <Text style={styles.notifBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* A screen's own title, set right after the bell (Train: the style and
          whose training it is — which already says "parent's account"). */}
      {lead ? <View style={styles.lead}>{lead}</View> : null}

      {/* The middle of the row: a screen's own control if it passes one, or —
          on every tab of a parent's account — whose account this is, level with
          the bell and the avatar. */}
      {lead ? null : center ? (
        <View style={styles.center} pointerEvents="box-none">
          {center}
        </View>
      ) : isParent ? (
        <View style={styles.center} pointerEvents="none">
          <View style={styles.parentPill} accessibilityRole="text" accessibilityLabel="Parent's account">
            <Ionicons name="people-outline" size={11} color={PARENT_INK} />
            <Text style={styles.parentText}>Parent's account</Text>
          </View>
        </View>
      ) : null}

      {/* A caller that supplies `right` owns that slot outright — otherwise the
          avatar would still render and land in the middle of the row. */}
      {right || (editMode ? (
        <TouchableOpacity
          onPress={handleProfilePress}
          activeOpacity={0.7}
          style={styles.editPill}
          hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
        >
          <Text style={styles.editLabel}>Edit</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.avatar} onPress={handleProfilePress} activeOpacity={0.8}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.avatarPhoto} />
          ) : (
            <LinearGradient colors={['#F6D27A', '#E8B530']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatarFill}>
              <Text style={styles.avatarText}>{initials}</Text>
            </LinearGradient>
          )}
        </TouchableOpacity>
      ))}
    </View>

    </View>
  );
}

// ≥5.2:1 on the pill's tint over any of the app's light grounds
const PARENT_INK = '#7A5710';

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingTop: 16,
    paddingBottom: 12,
  },
  center: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0A0A0A',
    shadowOpacity: 0.07,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  // Sits on the bell's corner with a ring in the page colour.
  notifBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#E8B530',
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#F2F0EB',
    minWidth: 19,
    height: 19,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  notifBadgeText: {
    fontFamily: Fonts.ttBold,
    fontSize: 9.5,
    color: '#0A0A0A',
  },
  lead: {
    flex: 1,
    minWidth: 0,
    marginLeft: 11,
    marginRight: 11,
  },
  parentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 9,
    backgroundColor: 'rgba(232,181,48,0.18)',
  },
  parentText: {
    fontFamily: Fonts.travelsMedium,
    fontSize: 11,
    letterSpacing: 0.1,
    color: PARENT_INK,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E8B530',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarFill: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: Fonts.ttBold,
    fontSize: 12.5,
    color: '#0A0A0A',
  },
  avatarPhoto: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  editPill: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(10,10,10,0.09)',
    borderRadius: 999,
  },
  editLabel: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12,
    color: 'rgba(10,10,10,0.72)',
    letterSpacing: 0.4,
  },
});
