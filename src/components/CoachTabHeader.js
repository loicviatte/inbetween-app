import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../theme';
import { useCoachData } from '../context/CoachDataContext';

export default function CoachTabHeader() {
  const navigation = useNavigation();
  const { user, unreadCount } = useCoachData();

  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={() => navigation.navigate('Notifications')}
        style={styles.notifBtn}
        activeOpacity={0.7}
      >
        <Ionicons name="notifications-outline" size={24} color={Colors.black} />
        {unreadCount > 0 && (
          <View style={styles.notifBadge}>
            <Text style={styles.notifBadgeText}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.avatar}
        onPress={() => navigation.navigate('CoachProfile')}
        activeOpacity={0.8}
      >
        {user?.photo_url ? (
          <Image source={{ uri: user.photo_url }} style={styles.avatarPhoto} />
        ) : (
          <Text style={styles.avatarText}>
            {user?.name ? user.name[0].toUpperCase() : 'C'}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 16,
    paddingHorizontal: Spacing.side,
    paddingBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  notifBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: Colors.orange,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
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
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5E6C8',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarPhoto: { width: 36, height: 36, borderRadius: 18 },
  avatarText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#8A6A2E',
  },
});
