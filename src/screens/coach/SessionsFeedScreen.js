import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../../theme';
import { getCoachActivityFeed } from '../../services/coachStorage';

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

  useFocusEffect(
    useCallback(() => {
      let active = true;
      async function load() {
        setLoading(true);
        try {
          const events = await getCoachActivityFeed();
          if (active) setSections(groupByDay(events));
        } catch {}
        if (active) setLoading(false);
      }
      load();
      return () => { active = false; };
    }, [])
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingWrap}>
          <Text style={styles.logo}>EE</Text>
        </View>
      </SafeAreaView>
    );
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
            <Text style={styles.logo}>EE</Text>
            <Text style={styles.heading}>Recent</Text>
          </View>
        )}
        renderSectionHeader={({ section }) => (
          <Text style={styles.dayLabel}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <EventCard
            event={item}
            onPress={() =>
              navigation.navigate('StudentDetail', {
                studentId: item.studentId,
                studentName: item.studentName,
              })
            }
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
  logo: {
    fontFamily: Fonts.monument,
    fontSize: 20,
    color: Colors.black,
    letterSpacing: 1,
    marginBottom: 12,
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
