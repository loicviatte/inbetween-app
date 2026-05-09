import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Fonts, Spacing } from '../theme';
import { useProfile } from '../context/ProfileContext';
import { getNotifications } from '../storage/notificationsStorage';
import { locallyRespondedAttendance } from '../storage/attendanceState';

export default function TabHeader({ navigation, onProfilePress, editMode = false, center = null }) {
  const { avatarUri, initials: contextInitials } = useProfile();

  const [cachedPhoto, setCachedPhoto] = useState(null);
  const [cachedInitials, setCachedInitials] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);

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
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.notifBtn}
        onPress={() => navigation.navigate('Notifications')}
        activeOpacity={0.7}
      >
        <Ionicons name="notifications-outline" size={24} color={Colors.black} />
        {unreadCount > 0 && (
          <View style={styles.notifBadge}>
            <Text style={styles.notifBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
          </View>
        )}
      </TouchableOpacity>

      {center && (
        <View style={styles.center} pointerEvents="box-none">
          {center}
        </View>
      )}

      {editMode ? (
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
            <Text style={styles.avatarText}>{initials}</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

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
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
  },
  notifBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: Colors.orange,
    borderRadius: 8,
    minWidth: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  notifBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9,
    color: '#fff',
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#F0D9A0',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  avatarText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: '#8A6A2E',
  },
  avatarPhoto: {
    width: 46,
    height: 46,
    borderRadius: 23,
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
