import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Spacing } from '../theme';

// Placeholder notifications — replace with real data when push notifications are wired up
const MOCK_NOTIFICATIONS = [
  {
    id: '1',
    icon: 'flash-outline',
    title: 'New focus point added',
    body: 'Your coach added a new focus point. Start training now!',
    time: 'Just now',
    unread: true,
  },
  {
    id: '2',
    icon: 'checkmark-circle-outline',
    title: 'Session validated',
    body: 'Your coach validated your last training session.',
    time: '2h ago',
    unread: true,
  },
  {
    id: '3',
    icon: 'chatbubble-outline',
    title: 'New message from coach',
    body: 'Your coach left a note on your focus point.',
    time: 'Yesterday',
    unread: false,
  },
];

export default function NotificationsScreen({ navigation }) {
  const unreadCount = MOCK_NOTIFICATIONS.filter((n) => n.unread).length;

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

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {MOCK_NOTIFICATIONS.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="notifications-off-outline" size={40} color="#DADADA" />
            <Text style={styles.emptyTitle}>No notifications yet</Text>
            <Text style={styles.emptySubtitle}>You'll be notified when your coach adds focus points or validates a session.</Text>
          </View>
        ) : (
          MOCK_NOTIFICATIONS.map((notif) => (
            <View key={notif.id} style={[styles.card, notif.unread && styles.cardUnread]}>
              <View style={[styles.iconWrap, notif.unread && styles.iconWrapUnread]}>
                <Ionicons name={notif.icon} size={20} color={notif.unread ? Colors.black : '#ACADB9'} />
              </View>
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardTitle}>{notif.title}</Text>
                  <Text style={styles.cardTime}>{notif.time}</Text>
                </View>
                <Text style={styles.cardText}>{notif.body}</Text>
              </View>
              {notif.unread && <View style={styles.dot} />}
            </View>
          ))
        )}
      </ScrollView>
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
