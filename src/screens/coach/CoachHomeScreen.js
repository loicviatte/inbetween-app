import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Spacing } from '../../theme';
import { CoachHomeScreenSkeleton } from '../../components/Skeleton';
import {
  getMyStudents,
  getPendingCoachRequests,
  respondToCoachRequest,
} from '../../storage/coachStorage';

function formatLastActive(dateStr) {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function StatusBadge({ status }) {
  if (status === 'on_track') {
    return (
      <View style={[badge.pill, badge.onTrack]}>
        <Text style={[badge.text, badge.onTrackText]}>✓</Text>
      </View>
    );
  }
  if (status === 'question') {
    return (
      <View style={[badge.pill, badge.question]}>
        <Text style={[badge.text, badge.questionText]}>?</Text>
      </View>
    );
  }
  if (status === 'attention') {
    return (
      <View style={[badge.pill, badge.attention]}>
        <Text style={[badge.text, badge.attentionText]}>!</Text>
      </View>
    );
  }
  return null;
}

function StudentCard({ student, onPress }) {
  const initials = student.name
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <TouchableOpacity style={sc.card} onPress={onPress} activeOpacity={0.75}>
      <View style={sc.avatar}>
        <Text style={sc.avatarText}>{initials}</Text>
      </View>
      <View style={sc.info}>
        <Text style={sc.name}>{student.name}</Text>
        <Text style={sc.sub}>
          {[student.danceStyle, formatLastActive(student.lastActiveDate)]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <StatusBadge status={student.status} />
      <Text style={sc.chevron}>›</Text>
    </TouchableOpacity>
  );
}

function RequestCard({ request, onAccept, onDecline }) {
  const [acting, setActing] = useState(false);
  const initials = request.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  async function act(accept) {
    setActing(true);
    await onAccept(request.id, accept);
  }

  return (
    <View style={rq.card}>
      <View style={sc.avatar}>
        <Text style={sc.avatarText}>{initials}</Text>
      </View>
      <View style={rq.info}>
        <Text style={rq.name}>{request.name}</Text>
        <Text style={rq.sub}>Wants to connect as your student</Text>
      </View>
      {acting ? (
        <ActivityIndicator size="small" color={Colors.secondary} />
      ) : (
        <View style={rq.actions}>
          <TouchableOpacity style={rq.acceptBtn} onPress={() => act(true)} activeOpacity={0.8}>
            <Text style={rq.acceptText}>Accept</Text>
          </TouchableOpacity>
          <TouchableOpacity style={rq.declineBtn} onPress={() => act(false)} activeOpacity={0.8}>
            <Text style={rq.declineText}>Decline</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function CoachHomeScreen({ navigation }) {
  const [students, setStudents] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      async function load() {
        setLoading(true);
        try {
          const [s, r] = await Promise.all([getMyStudents(), getPendingCoachRequests()]);
          if (active) { setStudents(s); setRequests(r); }
        } catch {}
        if (active) setLoading(false);
      }
      load();
      return () => { active = false; };
    }, [])
  );

  async function handleRequest(requestId, accept) {
    await respondToCoachRequest(requestId, accept);
    setRequests(prev => prev.filter(r => r.id !== requestId));
    if (accept) {
      const [s] = await Promise.all([getMyStudents()]);
      setStudents(s);
    }
  }

  const needsAttention = students.filter(s => s.status !== 'on_track');

  if (loading) {
    return <CoachHomeScreenSkeleton />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={students}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={() => (
          <>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerTop}>
                <Text style={styles.logo}>EE</Text>
                <TouchableOpacity
                  onPress={() => navigation.navigate('Notifications')}
                  style={styles.notifBtn}
                  activeOpacity={0.7}
                >
                  <Ionicons name="notifications-outline" size={24} color={Colors.black} />
                </TouchableOpacity>
              </View>
              <Text style={styles.heading}>My Students</Text>
            </View>

            {/* Pending connection requests */}
            {requests.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>NEW REQUESTS</Text>
                {requests.map(r => (
                  <RequestCard
                    key={r.id}
                    request={r}
                    onAccept={handleRequest}
                  />
                ))}
              </View>
            )}

            {/* Needs attention section */}
            {needsAttention.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, styles.attentionLabel]}>NEEDS ATTENTION</Text>
                {needsAttention.map(s => (
                  <TouchableOpacity
                    key={s.id}
                    style={attn.row}
                    onPress={() => navigation.navigate('StudentDetail', { studentId: s.id, studentName: s.name })}
                    activeOpacity={0.75}
                  >
                    <StatusBadge status={s.status} />
                    <Text style={attn.name}>{s.name}</Text>
                    <Text style={attn.status}>
                      {s.status === 'question' ? 'Has a question' : 'Needs attention'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* All students label */}
            {students.length > 0 && (
              <Text style={[styles.sectionLabel, { marginBottom: 8 }]}>ALL STUDENTS</Text>
            )}
          </>
        )}
        renderItem={({ item }) => (
          <StudentCard
            student={item}
            onPress={() => navigation.navigate('StudentDetail', { studentId: item.id, studentName: item.name })}
          />
        )}
        ListEmptyComponent={() => (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No students yet</Text>
            <Text style={styles.emptyBody}>
              Share your coach code from your profile. When students add you as their coach, they'll appear here.
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
  logo: {
    fontFamily: Fonts.monument,
    fontSize: 20,
    color: Colors.black,
    letterSpacing: 1,
  },
  notifBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 26,
    color: Colors.black,
  },
  section: { marginBottom: 20 },
  sectionLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: Colors.secondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  attentionLabel: { color: Colors.orange },

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

const sc = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(196,96,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: Colors.activeHome,
  },
  info: { flex: 1 },
  name: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 15,
    color: Colors.black,
    marginBottom: 2,
  },
  sub: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
  },
  chevron: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 18,
    color: 'rgba(17,12,17,0.25)',
    marginLeft: 4,
  },
});

const badge = StyleSheet.create({
  pill: {
    width: 24,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
  },
  onTrack: { backgroundColor: 'rgba(76,175,80,0.12)' },
  onTrackText: { color: Colors.green },
  question: { backgroundColor: 'rgba(33,150,243,0.12)' },
  questionText: { color: Colors.activeFocus },
  attention: { backgroundColor: 'rgba(255,157,0,0.12)' },
  attentionText: { color: Colors.orange },
});

const attn = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,157,0,0.05)',
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: 'rgba(255,157,0,0.2)',
    marginBottom: 8,
  },
  name: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 14,
    color: Colors.black,
    flex: 1,
  },
  status: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
  },
});

const rq = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(196,96,255,0.05)',
    borderWidth: 0.5,
    borderColor: 'rgba(196,96,255,0.2)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
    gap: 12,
  },
  info: { flex: 1 },
  name: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 14,
    color: Colors.black,
    marginBottom: 2,
  },
  sub: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
  },
  actions: { flexDirection: 'row', gap: 8 },
  acceptBtn: {
    backgroundColor: Colors.black,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  acceptText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 12,
    color: Colors.white,
  },
  declineBtn: {
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  declineText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: Colors.secondary,
  },
});
