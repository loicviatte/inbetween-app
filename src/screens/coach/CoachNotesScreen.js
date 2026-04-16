import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SectionList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Spacing } from '../../theme';
import { getCoachNotes, getMyStudents } from '../../storage/coachStorage';
import { getUser } from '../../storage/storage';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function getDateGroup(isoDate) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(isoDate);
  const itemDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today - itemDay) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return DAY_NAMES[d.getDay()];
  if (diffDays < 30) return 'Last 30 days';
  if (d.getFullYear() === now.getFullYear()) return MONTH_FULL[d.getMonth()];
  return String(d.getFullYear());
}

function relativeDate(iso) {
  const ts = new Date(iso).getTime();
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function groupByDate(items) {
  const map = new Map();
  for (const item of items) {
    const key = getDateGroup(item.updated_at || item.created_at);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
}

function NoteCard({ item, onPress }) {
  const linked = item.linkedStudent;
  const hasVideo = item.video_clips?.length > 0;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.cardAccent, { backgroundColor: linked ? Colors.orange : '#5788E6' }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardDate}>{relativeDate(item.updated_at || item.created_at)}</Text>
          <View style={styles.badgeRow}>
            {hasVideo && (
              <View style={[styles.countBadge, { backgroundColor: 'rgba(87,136,230,0.12)' }]}>
                <Text style={[styles.countBadgeText, { color: '#5788E6' }]}>
                  {item.video_clips.length} clip{item.video_clips.length > 1 ? 's' : ''}
                </Text>
              </View>
            )}
            {linked && (
              <View style={styles.linkedChip}>
                {linked.photoUrl ? (
                  <Image source={{ uri: linked.photoUrl }} style={styles.linkedAvatar} />
                ) : (
                  <View style={[styles.linkedAvatar, styles.linkedAvatarFallback]}>
                    <Text style={styles.linkedAvatarText}>{linked.name?.[0]?.toUpperCase() || 'S'}</Text>
                  </View>
                )}
                <Text style={styles.linkedChipText} numberOfLines={1}>{linked.name}</Text>
              </View>
            )}
          </View>
        </View>
        {item.title ? (
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
        ) : (
          <Text style={[styles.cardTitle, styles.cardTitleEmpty]}>Untitled</Text>
        )}
        {item.content ? (
          <Text style={styles.cardPreview} numberOfLines={2}>{item.content}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

export default function CoachNotesScreen({ navigation }) {
  const [notes, setNotes] = useState([]);
  const [user, setUser] = useState(null);
  const [studentsCount, setStudentsCount] = useState(0);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    const [n, u, s] = await Promise.all([
      getCoachNotes(),
      getUser().catch(() => null),
      getMyStudents().catch(() => []),
    ]);
    setNotes(n || []);
    setUser(u);
    setStudentsCount((s || []).length);
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  async function handleRefresh() {
    setRefreshing(true);
    try { await load(); } catch {}
    setRefreshing(false);
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? notes.filter(n =>
        (n.title || '').toLowerCase().includes(q) ||
        (n.content || '').toLowerCase().includes(q) ||
        (n.linkedStudent?.name || '').toLowerCase().includes(q)
      )
    : notes;

  const grouped = groupByDate(filtered);
  const linkedCount = notes.filter(n => n.linkedStudent).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.fixed}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.navigate('Notifications')}
            style={styles.notifBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="notifications-outline" size={24} color={Colors.black} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.avatar}
            onPress={() => navigation.navigate('CoachProfile')}
            activeOpacity={0.8}
          >
            {user?.photo_url ? (
              <Image source={{ uri: user.photo_url }} style={styles.avatarPhoto} />
            ) : (
              <Text style={styles.avatarText}>{user?.name ? user.name[0].toUpperCase() : 'C'}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Hero card */}
        <View style={styles.hero}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>NOTES</Text>
          </View>
          <Text style={styles.heroTitle}>Coach notebook</Text>
          <Text style={styles.heroSub}>
            Capture private notes and link them to a student to keep your prep tight.
          </Text>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatNum}>{notes.length}</Text>
              <Text style={styles.heroStatLabel}>Notes</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatNum}>{linkedCount}</Text>
              <Text style={styles.heroStatLabel}>Linked</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatNum}>{studentsCount}</Text>
              <Text style={styles.heroStatLabel}>Students</Text>
            </View>
          </View>
        </View>
      </View>

      {/* List */}
      <SectionList
        sections={grouped}
        keyExtractor={(item) => item.id}
        style={{ flex: 1 }}
        contentContainerStyle={styles.listContent}
        renderSectionHeader={({ section: { title } }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>{title}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <NoteCard
            item={item}
            onPress={() => navigation.navigate('CoachNoteDetail', { noteId: item.id })}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="create-outline" size={28} color="#ACADB9" />
            </View>
            <Text style={styles.emptyTitle}>No notes yet</Text>
            <Text style={styles.emptySub}>
              Tap the plus button to create your first note.
            </Text>
          </View>
        }
      />

      {/* Bottom search + add bar */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
        <View style={styles.bottomBar}>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={18} color={Colors.activeFocus} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search notes…"
              placeholderTextColor="#ACADB9"
              clearButtonMode="while-editing"
            />
          </View>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => navigation.navigate('CoachNoteDetail', {})}
            activeOpacity={0.85}
          >
            <Text style={styles.addBtnText}>NEW</Text>
            <View style={styles.addBtnCircle}>
              <Ionicons name="add" size={22} color="#fff" />
            </View>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  fixed: {},

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingTop: 4,
    paddingBottom: 8,
  },
  notifBtn: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#F0F0F0',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarPhoto: { width: 38, height: 38, borderRadius: 19 },
  avatarText: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: Colors.black },

  // Hero
  hero: {
    marginHorizontal: Spacing.side,
    backgroundColor: '#141414',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(232,168,56,0.55)',
    shadowColor: '#E8A838',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 18,
    elevation: 6,
    marginBottom: 6,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(232,168,56,0.18)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 10,
  },
  heroBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: '#E8A838',
  },
  heroTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: '#fff',
    letterSpacing: -0.4,
  },
  heroSub: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.62)',
    marginTop: 6,
    lineHeight: 19,
  },
  heroStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatNum: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
    color: '#fff',
  },
  heroStatLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.6,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  heroStatDivider: {
    width: 0.5,
    height: 26,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },

  // List
  listContent: {
    paddingHorizontal: Spacing.side,
    paddingTop: 6,
    paddingBottom: 16,
  },
  sectionHeader: { paddingTop: 18, paddingBottom: 6 },
  sectionHeaderText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    letterSpacing: 0.6,
    color: Colors.activeFocus,
    textTransform: 'uppercase',
  },

  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(13,13,18,0.08)',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 1,
  },
  cardAccent: { width: 4 },
  cardBody: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 5,
    gap: 8,
  },
  cardDate: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.secondary,
    flexShrink: 0,
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  countBadge: {
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  countBadgeText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 10,
  },
  linkedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,157,0,0.10)',
    borderRadius: 999,
    paddingLeft: 2,
    paddingRight: 9,
    paddingVertical: 2,
    maxWidth: 160,
  },
  linkedAvatar: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#F0F0F0' },
  linkedAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  linkedAvatarText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 9,
    color: Colors.black,
  },
  linkedChipText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: Colors.orange,
    flexShrink: 1,
  },
  cardTitle: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: Colors.black,
    marginBottom: 3,
  },
  cardTitleEmpty: {
    color: Colors.secondary,
    fontFamily: Fonts.jakartaRegular,
  },
  cardPreview: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    lineHeight: 18,
  },

  empty: {
    marginTop: 50,
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#F5F5F5',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: Colors.black,
    marginBottom: 4,
  },
  emptySub: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    textAlign: 'center',
    lineHeight: 19,
  },

  // Bottom bar
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingVertical: 10,
    gap: 10,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(13,13,18,0.08)',
    backgroundColor: Colors.background,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    backgroundColor: 'rgba(46,46,46,0.04)',
    borderRadius: 18,
    paddingHorizontal: 16,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: Colors.black,
    padding: 0,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    borderRadius: 22,
    backgroundColor: '#141414',
    paddingLeft: 16,
    paddingRight: 5,
    gap: 8,
  },
  addBtnText: {
    fontFamily: Fonts.monument,
    fontSize: 14,
    color: '#fff',
    letterSpacing: 0.6,
  },
  addBtnCircle: {
    width: 40, height: 40,
    borderRadius: 20,
    backgroundColor: '#E8A838',
    alignItems: 'center', justifyContent: 'center',
  },
});
