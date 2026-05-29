import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SectionList,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../../theme';
import CoachNotesSkeleton from '../../components/CoachNotesSkeleton';
import { useCoachData } from '../../context/CoachDataContext';
import { getMyClasses } from '../../storage/coachStorage';

const SCREEN_W = Dimensions.get('window').width;

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

function groupByDate(items, dateField = 'updated_at') {
  const map = new Map();
  for (const item of items) {
    const key = getDateGroup(item[dateField] || item.created_at);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
}

// ─── Class card ──────────────────────────────────────────────────────────────

function ClassCard({ item, onPress }) {
  const isPrivate = item.lesson_type === 'private' || item.lesson_type == null;
  const accent = isPrivate ? '#2E4670' : '#E8B530';
  const accentBg = isPrivate ? 'rgba(46,70,112,0.12)' : 'rgba(232,181,48,0.16)';
  const accentBorder = isPrivate ? 'rgba(46,70,112,0.30)' : 'rgba(232,181,48,0.30)';
  const accentText = isPrivate ? '#2E4670' : '#7A5A10';

  const title =
    item.title ||
    item.ai_primary_focus ||
    (item.practice_point_1 || '').split(' ').slice(0, 6).join(' ') ||
    'Untitled class';

  const isProcessing =
    item.status === 'processing' || item.status === 'pending' || item.status === 'extracted';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.78}>
      <View style={[styles.cardAccent, { backgroundColor: accent }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardDate}>{relativeDate(item.created_at)}</Text>
          <View style={[styles.badge, { backgroundColor: accentBg, borderColor: accentBorder }]}>
            <Text style={[styles.badgeText, { color: accentText }]}>
              {isPrivate ? 'Private' : 'Group'}
            </Text>
          </View>
        </View>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {title}
        </Text>
        {item.class_summary ? (
          <Text style={styles.cardPreview} numberOfLines={2}>
            {item.class_summary}
          </Text>
        ) : isProcessing ? (
          <Text style={styles.cardPending}>Processing class…</Text>
        ) : null}
        {isPrivate && item.student?.name ? (
          <View style={styles.studentRow}>
            {item.student.photoUrl ? (
              <Image source={{ uri: item.student.photoUrl }} style={styles.studentAvatar} />
            ) : (
              <View style={[styles.studentAvatar, styles.studentAvatarFallback]}>
                <Text style={styles.studentAvatarText}>
                  {item.student.name?.[0]?.toUpperCase() || 'S'}
                </Text>
              </View>
            )}
            <Text style={styles.studentName} numberOfLines={1}>
              {item.student.name}
            </Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ─── Note card ───────────────────────────────────────────────────────────────

function NoteCard({ item, onPress }) {
  const linked = item.linkedStudent;
  const linkedClass = item.linkedClass;
  const hasVideo = item.video_clips?.length > 0;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.cardAccent, { backgroundColor: linked ? Colors.orange : '#5788E6' }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardDate}>{relativeDate(item.updated_at || item.created_at)}</Text>
          <View style={styles.badgeRow}>
            {hasVideo && (
              <View style={[styles.badge, { backgroundColor: 'rgba(87,136,230,0.12)', borderColor: 'rgba(87,136,230,0.30)' }]}>
                <Text style={[styles.badgeText, { color: '#3F62A8' }]}>
                  {item.video_clips.length} clip{item.video_clips.length > 1 ? 's' : ''}
                </Text>
              </View>
            )}
            {linkedClass && (
              <View style={[styles.badge, { backgroundColor: 'rgba(76,175,80,0.12)', borderColor: 'rgba(76,175,80,0.30)' }]}>
                <Text style={[styles.badgeText, { color: '#2F6B33' }]}>Class</Text>
              </View>
            )}
            {linked && (
              <View style={styles.linkedChip}>
                {linked.photoUrl ? (
                  <Image source={{ uri: linked.photoUrl }} style={styles.linkedAvatar} />
                ) : (
                  <View style={[styles.linkedAvatar, styles.linkedAvatarFallback]}>
                    <Text style={styles.linkedAvatarText}>
                      {linked.name?.[0]?.toUpperCase() || 'S'}
                    </Text>
                  </View>
                )}
                <Text style={styles.linkedChipText} numberOfLines={1}>
                  {linked.name}
                </Text>
              </View>
            )}
          </View>
        </View>
        {item.title ? (
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
        ) : (
          <Text style={[styles.cardTitle, { color: Colors.secondary, fontFamily: Fonts.jakartaRegular }]}>
            Untitled
          </Text>
        )}
        {item.content ? (
          <Text style={styles.cardPreview} numberOfLines={2}>{item.content}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ─── Empty states ────────────────────────────────────────────────────────────

function EmptyState({ icon, title, subtitle }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIconWrap}>
        <Ionicons name={icon} size={28} color="#ACADB9" />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{subtitle}</Text>
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function CoachClassesScreen({ navigation }) {
  const { notes, students, initialLoading: notesLoading, refresh } = useCoachData();
  const [activeTab, setActiveTab] = useState('CLASS');
  const [classes, setClasses] = useState([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      async function load() {
        try {
          const list = await getMyClasses();
          if (active) setClasses(list);
        } catch {
          if (active) setClasses([]);
        }
        if (active) setClassesLoading(false);
      }
      load();
      return () => {
        active = false;
      };
    }, []),
  );

  function switchTab(tab) {
    setActiveTab(tab);
    scrollRef.current?.scrollTo({ x: tab === 'NOTES' ? SCREEN_W : 0, animated: true });
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([
        getMyClasses().then(setClasses).catch(() => {}),
        refresh(),
      ]);
    } catch {}
    setRefreshing(false);
  }

  function handleAdd() {
    if (activeTab === 'NOTES') {
      navigation.navigate('CoachNoteDetail', {});
    } else {
      navigation.navigate('StartClass');
    }
  }

  const q = search.trim().toLowerCase();
  const filteredClasses = q
    ? classes.filter(c =>
        (c.title || '').toLowerCase().includes(q) ||
        (c.ai_primary_focus || '').toLowerCase().includes(q) ||
        (c.class_summary || '').toLowerCase().includes(q) ||
        (c.dance || '').toLowerCase().includes(q) ||
        (c.student?.name || '').toLowerCase().includes(q),
      )
    : classes;
  const filteredNotes = q
    ? notes.filter(n =>
        (n.title || '').toLowerCase().includes(q) ||
        (n.content || '').toLowerCase().includes(q) ||
        (n.linkedStudent?.name || '').toLowerCase().includes(q),
      )
    : notes;

  const groupedClasses = groupByDate(filteredClasses, 'created_at');
  const groupedNotes = groupByDate(filteredNotes, 'updated_at');

  const linkedNotesCount = notes.filter(n => n.linkedClass || n.linkedStudent).length;

  // Show skeleton if EITHER source is still loading — otherwise the screen
  // flashes a half-empty state (e.g. notes done, classes still fetching).
  if (notesLoading || classesLoading) return <CoachNotesSkeleton />;

  return (
    <View style={styles.safe}>
      {/* Top tab toggle (Class / Notes) */}
      <View style={styles.tabRow}>
        {['CLASS', 'NOTES'].map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tabPill, activeTab === tab && styles.tabPillActive]}
            onPress={() => switchTab(tab)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabPillText, activeTab === tab && styles.tabPillTextActive]}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Horizontal pager between Class and Notes */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => {
          const page = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
          setActiveTab(page === 0 ? 'CLASS' : 'NOTES');
        }}
        style={{ flex: 1 }}
      >
        {/* CLASS page */}
        <View style={{ width: SCREEN_W, flex: 1 }}>
          <SectionList
            sections={groupedClasses}
            keyExtractor={(item) => item.id}
            style={{ flex: 1 }}
            contentContainerStyle={styles.listContent}
            renderSectionHeader={({ section: { title } }) => (
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionHeaderText, { color: '#E8B530' }]}>{title}</Text>
              </View>
            )}
            renderItem={({ item }) => (
              <ClassCard
                item={item}
                onPress={() => navigation.navigate('CoachClassDetail', { classId: item.id })}
              />
            )}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            showsVerticalScrollIndicator={false}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            stickySectionHeadersEnabled={false}
            ListEmptyComponent={
              !classesLoading ? (
                <EmptyState
                  icon="school-outline"
                  title="No classes yet"
                  subtitle="Tap the plus button to start recording a class."
                />
              ) : null
            }
          />
        </View>

        {/* NOTES page */}
        <View style={{ width: SCREEN_W, flex: 1 }}>
          <SectionList
            sections={groupedNotes}
            keyExtractor={(item) => item.id}
            style={{ flex: 1 }}
            contentContainerStyle={styles.listContent}
            renderSectionHeader={({ section: { title } }) => (
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionHeaderText, { color: '#5788E6' }]}>{title}</Text>
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
              <EmptyState
                icon="create-outline"
                title="No notes yet"
                subtitle="Tap the plus button to create your first note."
              />
            }
          />
        </View>
      </ScrollView>

      {/* Bottom search + add bar */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
        <View style={styles.bottomBar}>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={18} color={Colors.activeFocus} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder={activeTab === 'NOTES' ? 'Search notes…' : 'Search classes…'}
              placeholderTextColor="#ACADB9"
              clearButtonMode="while-editing"
            />
          </View>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={handleAdd}
            activeOpacity={0.85}
          >
            <Text style={styles.addBtnText}>{activeTab === 'NOTES' ? 'NEW' : 'CLASS'}</Text>
            <View style={styles.addBtnCircle}>
              <Ionicons name="add" size={22} color="#fff" />
            </View>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  // Top toggle
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.side,
    paddingTop: 4,
    paddingBottom: 12,
    gap: 8,
  },
  tabPill: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(10,10,10,0.09)',
  },
  tabPillActive: {
    backgroundColor: '#0A0A0A',
    borderColor: '#0A0A0A',
  },
  tabPillText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: 'rgba(10,10,10,0.72)',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  tabPillTextActive: {
    color: '#F7F6F3',
  },

  // List
  listContent: {
    paddingHorizontal: Spacing.side,
    paddingTop: 4,
    paddingBottom: 16,
  },
  sectionHeader: { paddingTop: 18, paddingBottom: 6 },
  sectionHeaderText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  // Card (shared between class + note)
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
  badge: {
    paddingHorizontal: 9,
    paddingVertical: 3.5,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
  },
  badgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9.5,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  cardTitle: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: Colors.black,
    marginBottom: 3,
  },
  cardPreview: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    lineHeight: 18,
  },
  cardPending: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: Colors.orange,
  },

  // Linked student chip on the note card
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

  // Student row on private class card
  studentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  studentAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#F0F0F0',
  },
  studentAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  studentAvatarText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 10,
    color: Colors.black,
  },
  studentName: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: Colors.black,
    flexShrink: 1,
  },

  // Empty states
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

  // Bottom search + add bar
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
