import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../../theme';
import { getCoachActivityFeed } from '../../storage/coachStorage';
import { getUser } from '../../storage/storage';
import { SessionsFeedScreenSkeleton } from '../../components/Skeleton';
import { Ionicons } from '@expo/vector-icons';

function formatSectionTitle(date) {
  const now = new Date();
  const d = new Date(date);
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function sectionKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function eventLabel(event) {
  if (event.type === 'training') {
    return event.durationMin
      ? `${event.durationMin} min training session`
      : 'Training session';
  }
  if (event.type === 'class') return 'Logged a class';
  if (event.type === 'question') return 'Has a question';
  return '';
}

function EventCard({ event, onPress }) {
  const isQuestion = event.type === 'question';
  return (
    <TouchableOpacity
      style={[ev.card, isQuestion && ev.cardQuestion]}
      onPress={onPress}
      activeOpacity={0.78}
    >
      <View style={ev.body}>
        <Text style={ev.studentName}>{event.studentName}</Text>
        <Text style={[ev.label, isQuestion && ev.labelQuestion]}>
          {eventLabel(event)}
        </Text>
      </View>
      <Text style={ev.time}>{formatTime(event.date)}</Text>
      {isQuestion && <Text style={ev.replyHint}>tap to reply</Text>}
    </TouchableOpacity>
  );
}

function groupByDay(events) {
  const sections = {};
  for (const event of events) {
    const key = sectionKey(event.date);
    if (!sections[key]) {
      sections[key] = {
        title: formatSectionTitle(event.date),
        key,
        data: [],
      };
    }
    sections[key].data.push(event);
  }
  return Object.values(sections).sort((a, b) => b.key.localeCompare(a.key));
}

export default function SessionsFeedScreen({ navigation }) {
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      async function load() {
        setLoading(true);
        try {
          const [events, u] = await Promise.all([getCoachActivityFeed(), getUser()]);
          if (active) { setSections(groupByDay(events)); setUser(u); }
        } catch {}
        if (active) setLoading(false);
      }
      load();
      return () => { active = false; };
    }, [])
  );

  if (loading) {
    return <SessionsFeedScreenSkeleton />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <SectionList
        sections={sections}
        keyExtractor={(item, index) => item.id + index}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={() => (
          <View style={styles.header}>
            <View style={styles.headerTop}>
              <TouchableOpacity
                onPress={() => navigation.navigate('Notifications')}
                style={styles.notifBtn}
                activeOpacity={0.7}
              >
                <Ionicons name="notifications-outline" size={24} color={Colors.black} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.avatar}
                onPress={() => navigation.navigate('PROFILE')}
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
            <Text style={styles.heading}>Recent</Text>
          </View>
        )}
        renderSectionHeader={({ section }) => (
          <Text style={styles.dayLabel}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <EventCard
            event={item}
            onPress={() => {
              if (item.type === 'training' || item.type === 'class') {
                navigation.navigate('CoachSessionDetail', {
                  type: item.type,
                  sessionId: item.id,
                  studentName: item.studentName,
                });
              } else {
                navigation.navigate('StudentDetail', {
                  studentId: item.studentId,
                  studentName: item.studentName,
                });
              }
            }}
          />
        )}
        ListEmptyComponent={() => (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>Nothing recent yet</Text>
            <Text style={styles.emptyBody}>
              When your students practice or log classes, you'll see it here.
            </Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 100,
  },
  header: {
    paddingTop: 16,
    paddingBottom: 24,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  notifBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5E6C8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPhoto: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#8A6A2E',
  },
  heading: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 26,
    color: Colors.black,
  },
  dayLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: Colors.secondary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginTop: 8,
  },
  emptyWrap: {
    paddingTop: 60,
    alignItems: 'center',
  },
  emptyTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: Colors.black,
    marginBottom: 8,
  },
  emptyBody: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.secondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },
});

const ev = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 8,
    gap: 8,
  },
  cardQuestion: {
    backgroundColor: 'rgba(33,150,243,0.05)',
    borderColor: 'rgba(33,150,243,0.18)',
  },
  body: { flex: 1 },
  studentName: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 14,
    color: Colors.black,
    marginBottom: 2,
  },
  label: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
  },
  labelQuestion: { color: Colors.activeFocus },
  time: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11,
    color: Colors.secondary,
  },
  replyHint: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.activeFocus,
    marginLeft: 4,
  },
});
