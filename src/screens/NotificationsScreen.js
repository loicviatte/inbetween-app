import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Spacing } from '../theme';
import { getNotifications, markAllNotificationsRead } from '../storage/notificationsStorage';

const TYPE_ICON = {
  coach_request_accepted: 'checkmark-circle-outline',
  coach_request_declined: 'close-circle-outline',
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

export default function NotificationsScreen({ navigation }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const data = await getNotifications();
      setNotifications(data);
      setLoading(false);
      // Mark all as read after displaying
      markAllNotificationsRead();
    }
    load();
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={Colors.black} />
        </TouchableOpacity>
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
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {notifications.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="notifications-off-outline" size={40} color="#DADADA" />
              <Text style={styles.emptyTitle}>No notifications yet</Text>
              <Text style={styles.emptySubtitle}>
                You'll be notified when your coach accepts or declines your connection request.
              </Text>
            </View>
          ) : (
            notifications.map((notif) => (
              <View key={notif.id} style={[styles.card, !notif.read && styles.cardUnread]}>
                <View style={[styles.iconWrap, !notif.read && styles.iconWrapUnread]}>
                  <Ionicons
                    name={TYPE_ICON[notif.type] ?? 'notifications-outline'}
                    size={20}
                    color={!notif.read ? Colors.black : '#ACADB9'}
                  />
                </View>
                <View style={styles.cardBody}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardTitle}>{notif.title}</Text>
                    <Text style={styles.cardTime}>{formatTime(notif.created_at)}</Text>
                  </View>
                  <Text style={styles.cardText}>{notif.body}</Text>
                </View>
                {!notif.read && <View style={styles.dot} />}
              </View>
            ))
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
    paddingBottom: 16,
    gap: 10,
  },
  backBtn: { marginRight: 4 },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: Colors.black,
    flex: 1,
  },
  badge: {
    backgroundColor: Colors.black,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: Colors.white,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 40,
    gap: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: '#EFEFEF',
  },
  cardUnread: {
    borderColor: '#E0E0E0',
    backgroundColor: '#FAFAFA',
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F2F2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapUnread: {
    backgroundColor: '#EBEBEB',
  },
  cardBody: { flex: 1 },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardTitle: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: Colors.black,
    flex: 1,
  },
  cardTime: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
    marginLeft: 8,
  },
  cardText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    lineHeight: 18,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.black,
    marginTop: 6,
  },
  emptyWrap: {
    marginTop: 80,
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: Colors.black,
  },
  emptySubtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
