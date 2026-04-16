import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { Fonts, Spacing } from '../../theme';
import { getMyStudents, getPendingCoachRequests, respondToCoachRequest } from '../../storage/coachStorage';
import { getUser } from '../../storage/storage';
import { getNotifications } from '../../storage/notificationsStorage';

// ── Palette ─────────────────────────────────────────────────────────────────
const C = {
  bg: '#FFFFFF',
  surface: '#F5F5F5',
  surfaceAlt: '#FAFAFA',
  dark: '#0E0E0E',
  orange: '#E8A838',
  green: '#4AAF52',
  red: '#D44545',
  text: '#0E0E0E',
  sub: '#8A8A8A',
  muted: '#B0B0B0',
  white: '#FFFFFF',
  cardBorder: 'rgba(0,0,0,0.05)',
};

const AVATAR_PALETTE = [
  '#D44545',
  '#E8A838',
  '#7C5CFC',
  '#4AAF52',
  '#3DA5D9',
  '#EC6B8B',
  '#6C63FF',
];

function initialOf(name) {
  if (!name) return '?';
  return name.trim()[0].toUpperCase();
}

function avatarColorFor(id) {
  if (!id) return AVATAR_PALETTE[0];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

function shortRelative(iso) {
  if (!iso) return 'a while';
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) {
    const m = Math.max(1, Math.floor(ms / 60000));
    return `${m}m`;
  }
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Health ring ─────────────────────────────────────────────────────────────
function HealthRing({ value = 0, size = 42, strokeWidth = 3 }) {
  const color = value >= 75 ? C.green : value >= 55 ? C.orange : C.red;
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const off = circ - (Math.max(0, Math.min(100, value)) / 100) * circ;
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.surface} strokeWidth={strokeWidth} />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={`${circ}`}
        strokeDashoffset={off}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// ── Avatar badge (letter or photo) ──────────────────────────────────────────
function AvatarBadge({ student, size = 30, fontSize = 13 }) {
  const color = avatarColorFor(student.id);
  if (student.photoUrl) {
    return (
      <Image
        source={{ uri: student.photoUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontFamily: Fonts.jakartaExtraBold, fontSize, color: C.white }}>
        {initialOf(student.name)}
      </Text>
    </View>
  );
}

// ── Pending question chip ───────────────────────────────────────────────────
function PendingQChip({ count }) {
  if (!count) return null;
  return (
    <View style={styles.pendingQChip}>
      <Ionicons name="chatbubble-ellipses" size={10} color={C.orange} />
      <Text style={styles.pendingQChipText}>{count}</Text>
    </View>
  );
}

// ── Alert line (attention students) ────────────────────────────────────────
function AlertLine({ alert }) {
  if (!alert) return null;
  let icon = 'alert-circle-outline';
  let color = C.red;
  if (alert.kind === 'stuck') {
    icon = 'repeat';
    color = C.red;
  } else if (alert.kind === 'question') {
    icon = 'chatbubble-outline';
    color = C.orange;
  } else if (alert.kind === 'review') {
    icon = 'git-pull-request-outline';
    color = C.orange;
  } else if (alert.kind === 'inactive') {
    icon = 'warning-outline';
    color = C.red;
  }
  return (
    <View style={styles.alertRow}>
      <Ionicons name={icon} size={12} color={color} />
      <Text style={[styles.alertText, { color }]} numberOfLines={1}>
        {alert.text}
      </Text>
    </View>
  );
}

// ── Attention student card ──────────────────────────────────────────────────
function AttentionCard({ student, onPress }) {
  return (
    <Pressable style={styles.attentionCard} onPress={onPress}>
      <View style={styles.ringWrap}>
        <HealthRing value={student.health} size={42} strokeWidth={3} />
        <View style={[styles.ringAvatar, { width: 30, height: 30 }]}>
          <AvatarBadge student={student} size={30} fontSize={13} />
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.nameRow}>
          <Text style={styles.attentionName} numberOfLines={1}>
            {student.name}
          </Text>
          <PendingQChip count={student.pendingQuestions} />
        </View>
        <AlertLine alert={student.alert} />
      </View>
      <Ionicons name="chevron-forward" size={16} color={C.muted} />
    </Pressable>
  );
}

// ── On-track student row (compact) ──────────────────────────────────────────
function OnTrackRow({ student, onPress, isLast }) {
  return (
    <Pressable
      style={[styles.onTrackRow, !isLast && styles.onTrackRowDivider]}
      onPress={onPress}
    >
      <View style={styles.ringWrap}>
        <HealthRing value={student.health} size={38} strokeWidth={2.5} />
        <View style={[styles.ringAvatar, { width: 28, height: 28 }]}>
          <AvatarBadge student={student} size={28} fontSize={11} />
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.nameRow}>
          <Text style={styles.onTrackName} numberOfLines={1}>
            {student.name}
          </Text>
          <PendingQChip count={student.pendingQuestions} />
        </View>
        <Text style={styles.onTrackMeta}>
          {student.lastActiveDate ? `${shortRelative(student.lastActiveDate)} ago` : 'No recent practice'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={C.muted} />
    </Pressable>
  );
}

// ── Last-private-lesson row ─────────────────────────────────────────────────
function LastPrivateRow({ student, onPress, isLast }) {
  const days = student.lastPrivateDays;
  let timeLabel = 'never';
  let timeColor = C.sub;
  if (days !== null && days !== undefined) {
    if (days === 0) timeLabel = 'today';
    else if (days === 1) timeLabel = 'yesterday';
    else timeLabel = `${days}d ago`;
    if (days >= 14) timeColor = C.red;
    else if (days >= 7) timeColor = C.orange;
    else timeColor = C.sub;
  }

  return (
    <Pressable
      style={[styles.lpRow, !isLast && styles.onTrackRowDivider]}
      onPress={onPress}
    >
      <View style={styles.lpAvatar}>
        <AvatarBadge student={student} size={38} fontSize={13} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.nameRow}>
          <Text style={styles.onTrackName} numberOfLines={1}>
            {student.name}
          </Text>
          <PendingQChip count={student.pendingQuestions} />
        </View>
        <Text style={styles.onTrackMeta}>
          {student.lastPrivateClassDate ? shortDate(student.lastPrivateClassDate) : 'No private lesson yet'}
        </Text>
      </View>
      <View style={styles.lpTimeWrap}>
        <Text style={[styles.lpTime, { color: timeColor }]}>{timeLabel}</Text>
        <Ionicons name="chevron-forward" size={16} color={C.muted} />
      </View>
    </Pressable>
  );
}

// ── Request Row (pending coach requests at top) ─────────────────────────────
function RequestRow({ student, onAccept, onReject }) {
  return (
    <View style={styles.requestRow}>
      <View style={styles.lpAvatar}>
        <AvatarBadge student={{ id: student.id, name: student.name }} size={38} fontSize={13} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.onTrackName} numberOfLines={1}>
          {student.name}
        </Text>
        <Text style={styles.requestSub}>Wants to be coached</Text>
      </View>
      <TouchableOpacity style={styles.rejectBtn} onPress={onReject} activeOpacity={0.8}>
        <Ionicons name="close" size={16} color={C.sub} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.acceptBtn} onPress={onAccept} activeOpacity={0.85}>
        <Ionicons name="checkmark" size={16} color={C.white} />
      </TouchableOpacity>
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────
export default function CoachHomeScreen({ navigation }) {
  const [students, setStudents] = useState([]);
  const [requests, setRequests] = useState([]);
  const [user, setUser] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [filter, setFilter] = useState('all'); // 'all' | 'last_private'
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      async function load() {
        setLoading(true);
        try {
          const [s, r, u, notifs] = await Promise.all([
            getMyStudents(),
            getPendingCoachRequests().catch(() => []),
            getUser().catch(() => null),
            getNotifications().catch(() => []),
          ]);
          if (!active) return;
          setStudents(s || []);
          setRequests(r || []);
          setUser(u);
          setUnreadCount(
            (notifs || []).filter(
              (n) =>
                !n.read ||
                n.type === 'merge_request_student' ||
                n.type === 'name_match_confirm'
            ).length
          );
        } catch (e) {
          console.error('CoachHomeScreen load error:', e);
        }
        if (active) setLoading(false);
      }
      load();
      return () => {
        active = false;
      };
    }, [])
  );

  async function handleAccept(requestId) {
    await respondToCoachRequest(requestId, true);
    setRequests((prev) => prev.filter((r) => r.id !== requestId));
    const s = await getMyStudents();
    setStudents(s || []);
  }
  async function handleReject(requestId) {
    await respondToCoachRequest(requestId, false);
    setRequests((prev) => prev.filter((r) => r.id !== requestId));
  }

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => (s.name || '').toLowerCase().includes(q));
  }, [students, searchQuery]);

  const attention = filteredStudents.filter((s) => s.status !== 'on_track');
  const onTrack = filteredStudents.filter((s) => s.status === 'on_track');

  const byLastPrivate = useMemo(() => {
    return [...filteredStudents].sort((a, b) => {
      const da = a.lastPrivateDays === null || a.lastPrivateDays === undefined ? 99999 : a.lastPrivateDays;
      const db = b.lastPrivateDays === null || b.lastPrivateDays === undefined ? 99999 : b.lastPrivateDays;
      return db - da; // oldest first
    });
  }, [filteredStudents]);

  const openStudent = (s) =>
    navigation.navigate('StudentDetail', { studentId: s.id, studentName: s.name });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Top row: notif + avatar ── */}
        <View style={styles.topRow}>
          <TouchableOpacity
            onPress={() => navigation.navigate('Notifications')}
            style={styles.notifBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="notifications-outline" size={24} color={C.text} />
            {unreadCount > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.avatarBtn}
            onPress={() => navigation.navigate('CoachProfile')}
            activeOpacity={0.8}
          >
            {user?.photo_url ? (
              <Image source={{ uri: user.photo_url }} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarText}>
                {user?.name ? user.name[0].toUpperCase() : 'C'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* ── Title + search toggle ── */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>Students</Text>
          <TouchableOpacity
            onPress={() => {
              setSearchOpen((v) => !v);
              if (searchOpen) setSearchQuery('');
            }}
            style={styles.searchBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="search" size={18} color={C.muted} />
          </TouchableOpacity>
        </View>

        {searchOpen && (
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color={C.muted} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search students…"
              placeholderTextColor={C.muted}
              autoFocus
              clearButtonMode="while-editing"
            />
          </View>
        )}

        {/* ── Filter tabs ── */}
        <View style={styles.filterWrap}>
          <View style={styles.filterRow}>
            {[
              { id: 'all', label: 'All' },
              { id: 'last_private', label: 'Last private lesson' },
            ].map((f) => {
              const isActive = filter === f.id;
              return (
                <TouchableOpacity
                  key={f.id}
                  onPress={() => setFilter(f.id)}
                  style={styles.filterBtn}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.filterLabel,
                      {
                        color: isActive ? C.text : C.muted,
                        fontFamily: isActive ? Fonts.jakartaBold : Fonts.jakartaMedium,
                      },
                    ]}
                  >
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.filterTrack} />
          <View
            style={[
              styles.filterUnderline,
              { left: filter === 'all' ? '0%' : '50%' },
            ]}
          />
        </View>

        {/* ── Pending coach requests ── */}
        {requests.length > 0 && (
          <View style={styles.requestsWrap}>
            <Text style={styles.sectionLabel}>PENDING REQUESTS</Text>
            {requests.map((r) => (
              <RequestRow
                key={r.id}
                student={{ id: r.studentId, name: r.name }}
                onAccept={() => handleAccept(r.id)}
                onReject={() => handleReject(r.id)}
              />
            ))}
          </View>
        )}

        {/* ══════════════════════════════════════════ */}
        {/* ── ALL (grouped) VIEW ── */}
        {/* ══════════════════════════════════════════ */}
        {filter === 'all' && !loading && (
          <View style={styles.content}>
            {filteredStudents.length === 0 && (
              <View style={styles.empty}>
                <Ionicons name="people-outline" size={40} color={C.muted} />
                <Text style={styles.emptyTitle}>No students yet</Text>
                <Text style={styles.emptyText}>
                  Share your invite code from the profile page to add students.
                </Text>
              </View>
            )}

            {attention.length > 0 && (
              <View style={{ marginBottom: 24 }}>
                <View style={styles.groupHeader}>
                  <View style={[styles.groupDot, { backgroundColor: C.red }]} />
                  <Text style={styles.groupLabel}>Needs attention</Text>
                </View>
                <View style={{ gap: 8 }}>
                  {attention.map((s) => (
                    <AttentionCard key={s.id} student={s} onPress={() => openStudent(s)} />
                  ))}
                </View>
              </View>
            )}

            {onTrack.length > 0 && (
              <View>
                <View style={styles.groupHeader}>
                  <View style={[styles.groupDot, { backgroundColor: C.green }]} />
                  <Text style={styles.groupLabel}>On track</Text>
                </View>
                <View>
                  {onTrack.map((s, i) => (
                    <OnTrackRow
                      key={s.id}
                      student={s}
                      onPress={() => openStudent(s)}
                      isLast={i === onTrack.length - 1}
                    />
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        {/* ══════════════════════════════════════════ */}
        {/* ── LAST PRIVATE LESSON VIEW ── */}
        {/* ══════════════════════════════════════════ */}
        {filter === 'last_private' && !loading && (
          <View style={styles.content}>
            {byLastPrivate.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="calendar-outline" size={40} color={C.muted} />
                <Text style={styles.emptyTitle}>Nothing to show</Text>
              </View>
            ) : (
              byLastPrivate.map((s, i) => (
                <LastPrivateRow
                  key={s.id}
                  student={s}
                  onPress={() => openStudent(s)}
                  isLast={i === byLastPrivate.length - 1}
                />
              ))
            )}
          </View>
        )}

        {loading && (
          <View style={{ paddingTop: 40, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={C.muted} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  // Top row
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingTop: 4,
    paddingBottom: 4,
  },
  notifBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: C.red,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  notifBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9,
    color: C.white,
  },
  avatarBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: 38, height: 38, borderRadius: 19 },
  avatarText: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: C.text },

  // Title
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 28,
    color: C.text,
    letterSpacing: -1.2,
  },
  searchBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Search input
  searchWrap: {
    marginHorizontal: 24,
    marginTop: 12,
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: C.text,
    padding: 0,
  },

  // Filter
  filterWrap: {
    marginHorizontal: 24,
    marginTop: 18,
    position: 'relative',
  },
  filterRow: { flexDirection: 'row' },
  filterBtn: {
    flex: 1,
    paddingTop: 12,
    paddingBottom: 11,
    alignItems: 'center',
  },
  filterLabel: {
    fontSize: 13,
    letterSpacing: -0.1,
  },
  filterTrack: {
    height: 1,
    backgroundColor: C.surface,
  },
  filterUnderline: {
    position: 'absolute',
    bottom: 0,
    height: 2.5,
    width: '50%',
    borderRadius: 2,
    backgroundColor: C.dark,
  },

  // Content
  content: { paddingHorizontal: 24, paddingTop: 20 },

  // Group headers
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  groupDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  groupLabel: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 12,
    color: C.sub,
    letterSpacing: 0.3,
  },

  // Attention card
  attentionCard: {
    backgroundColor: C.white,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: C.cardBorder,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 10,
    elevation: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ringWrap: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringAvatar: {
    position: 'absolute',
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  attentionName: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: C.text,
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 5,
  },
  alertText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    flexShrink: 1,
  },

  // On-track row
  onTrackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  onTrackRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  onTrackName: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 14,
    color: C.text,
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  onTrackMeta: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11,
    color: C.sub,
    marginTop: 2,
  },

  // Pending question chip
  pendingQChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(232,168,56,0.1)',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  pendingQChipText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: C.orange,
  },

  // Last-private row
  lpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
  },
  lpAvatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    overflow: 'hidden',
  },
  lpTimeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  lpTime: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    letterSpacing: -0.2,
  },

  // Requests
  requestsWrap: {
    paddingHorizontal: 24,
    marginTop: 16,
  },
  sectionLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: C.orange,
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.surface,
  },
  requestSub: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: C.sub,
    marginTop: 2,
  },
  rejectBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Empty state
  empty: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  emptyTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: C.text,
  },
  emptyText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: C.sub,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});
