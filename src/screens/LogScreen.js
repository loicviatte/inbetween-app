import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  SectionList,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Image,
  Animated,
  Dimensions,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cacheSet, cacheGet } from '../storage/cache';

const SCREEN_W = Dimensions.get('window').width;
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../theme';
import { getClassInputs, getNotes } from '../storage/storage';
import { supabase } from '../services/supabase/client';
import LogModal from '../components/LogModal';
import { Ionicons } from '@expo/vector-icons';
import { LogScreenSkeleton } from '../components/Skeleton';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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

function groupByDate(items, dateField = 'created_at') {
  const map = new Map();
  for (const item of items) {
    const key = getDateGroup(item[dateField] || item.created_at);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
}

function relativeDate(isoOrTs) {
  const ts = typeof isoOrTs === 'string' ? new Date(isoOrTs).getTime() : isoOrTs;
  const now = Date.now();
  const diff = now - ts;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function NotifButton({ onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.notifBtn} activeOpacity={0.7}>
      <Ionicons name="notifications-outline" size={24} color={Colors.black} />
    </TouchableOpacity>
  );
}

function ClassItem({ item, onPress }) {
  const hasTwo = item.practice_point_2 && item.ai_secondary_focus;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.cardAccent, { backgroundColor: Colors.activeLog }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardDate}>{relativeDate(item.created_at)}</Text>
          {hasTwo && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>2 points</Text>
            </View>
          )}
        </View>
        <Text style={styles.cardFocus}>{item.title || item.ai_primary_focus || item.practice_point_1?.split(' ').slice(0, 4).join(' ')}</Text>
        <Text style={styles.cardInput} numberOfLines={2}>{item.practice_point_1}</Text>
        {hasTwo && (
          <Text style={styles.cardSecondary} numberOfLines={1}>+ {item.ai_secondary_focus}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

function NoteItem({ item, onPress }) {
  const hasVideo = item.video_clips?.length > 0;
  const isLinked = !!item.linked_class_input_id;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.cardAccent, { backgroundColor: '#5788E6' }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardDate}>{relativeDate(item.updated_at || item.created_at)}</Text>
          <View style={styles.noteBadges}>
            {hasVideo && (
              <View style={[styles.countBadge, { backgroundColor: 'rgba(87,136,230,0.12)' }]}>
                <Text style={[styles.countBadgeText, { color: '#5788E6' }]}>
                  {item.video_clips.length} clip{item.video_clips.length > 1 ? 's' : ''}
                </Text>
              </View>
            )}
            {isLinked && (
              <View style={[styles.countBadge, { backgroundColor: 'rgba(76,175,80,0.1)' }]}>
                <Text style={[styles.countBadgeText, { color: Colors.activeLog }]}>Linked</Text>
              </View>
            )}
          </View>
        </View>
        {item.title ? (
          <Text style={styles.cardFocus}>{item.title}</Text>
        ) : (
          <Text style={[styles.cardFocus, { color: Colors.secondary, fontFamily: Fonts.jakartaRegular }]}>
            Untitled
          </Text>
        )}
        {item.content ? (
          <Text style={styles.cardInput} numberOfLines={2}>{item.content}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

export default function LogScreen({ navigation }) {
  const [activeTab, setActiveTab] = useState('CLASS');
  const [inputs, setInputs] = useState([]);
  const [notes, setNotes] = useState([]);
  const [search, setSearch] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [photoUri, setPhotoUri] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const hasLoadedRef = useRef(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef(null);

  async function load() {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    const [allInputs, allNotes, savedPhoto] = await Promise.all([
      getClassInputs(),
      getNotes(),
      AsyncStorage.getItem('@profile_photo_' + (authUser?.id || 'default')),
    ]);
    setInputs(allInputs);
    setNotes(allNotes);
    setPhotoUri(savedPhoto || null);
    setIsOffline(false);
    await cacheSet('log', { allInputs, allNotes });
  }

  function switchTab(tab) {
    setActiveTab(tab);
    scrollRef.current?.scrollTo({ x: tab === 'NOTES' ? SCREEN_W : 0, animated: true });
  }

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  useFocusEffect(useCallback(() => {
    if (!hasLoadedRef.current) setIsLoading(true);
    load()
      .then(() => {
        hasLoadedRef.current = true;
        setIsLoading(false);
        fadeAnim.setValue(0);
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      })
      .catch(async (e) => {
        console.error('LogScreen load error:', e);
        const cached = await cacheGet('log');
        if (cached) {
          setInputs(cached.allInputs || []);
          setNotes(cached.allNotes || []);
          setIsOffline(true);
        } else {
          Alert.alert('Connection error', 'Could not load your logs. Check your connection and try again.');
        }
        hasLoadedRef.current = true;
        setIsLoading(false);
        fadeAnim.setValue(0);
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      });
  }, []));

  function handleAdd() {
    if (activeTab === 'NOTES') {
      navigation.navigate('NoteDetail', {});
    } else {
      setModalVisible(true);
    }
  }

  const filteredInputs = search.trim()
    ? inputs.filter((i) => {
        const q = search.toLowerCase();
        return i.practice_point_1?.toLowerCase().includes(q) || i.practice_point_2?.toLowerCase().includes(q) || i.ai_primary_focus?.toLowerCase().includes(q);
      })
    : inputs;

  const filteredNotes = search.trim()
    ? notes.filter((n) => {
        const q = search.toLowerCase();
        return n.title?.toLowerCase().includes(q) || n.content?.toLowerCase().includes(q);
      })
    : notes;

  const groupedInputs = groupByDate(filteredInputs, 'created_at');
  const groupedNotes = groupByDate(filteredNotes, 'updated_at');

  if (isLoading) {
    return <LogScreenSkeleton />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>

      {/* ── Offline banner ── */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>Offline — showing cached data</Text>
        </View>
      )}

      <View style={styles.header}>
        <NotifButton onPress={() => navigation.navigate('Notifications')} />
        <TouchableOpacity style={styles.profileIcon} onPress={() => navigation.navigate('PROFILE')} activeOpacity={0.8}>
          {photoUri
            ? <Image source={{ uri: photoUri }} style={styles.profilePhoto} />
            : <Text style={styles.profileInitial}>A</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Tab switcher */}
      <View style={styles.tabRow}>
        {['CLASS', 'NOTES'].map((tab) => (
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

      {/* List */}
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
          <View style={{ width: SCREEN_W, height: '100%' }}>
            <SectionList
              sections={groupedInputs}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <ClassItem item={item} onPress={() => navigation.navigate('ClassDetail', { inputId: item.id })} />
              )}
              renderSectionHeader={({ section: { title } }) => (
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionHeaderText, { color: Colors.activeLog }]}>{title}</Text>
                </View>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={<ClassEmptyState onAdd={() => setModalVisible(true)} />}
              refreshing={refreshing}
              onRefresh={handleRefresh}
              stickySectionHeadersEnabled={false}
            />
          </View>
          <View style={{ width: SCREEN_W, height: '100%' }}>
            <SectionList
              sections={groupedNotes}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <NoteItem item={item} onPress={() => navigation.navigate('NoteDetail', { noteId: item.id })} />
              )}
              renderSectionHeader={({ section: { title } }) => (
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionHeaderText, { color: Colors.activeFocus }]}>{title}</Text>
                </View>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={<EmptyState text="No notes yet. Tap ADD to create one." />}
              refreshing={refreshing}
              onRefresh={handleRefresh}
              stickySectionHeadersEnabled={false}
            />
          </View>
      </ScrollView>

      {/* Bottom bar */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
        <View style={styles.bottomBar}>
          <View style={styles.searchWrap}>
            <Text style={[styles.searchIcon, { color: activeTab === 'CLASS' ? Colors.activeLog : Colors.activeFocus }]}>⌕</Text>
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search..."
              placeholderTextColor="#ACADB9"
              clearButtonMode="while-editing"
            />
          </View>
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: activeTab === 'CLASS' ? '#E3FFA1' : '#DDE3FF' }]}
            onPress={handleAdd}
            activeOpacity={0.85}
          >
            <Text style={styles.addBtnText}>ADD</Text>
            <View style={[styles.addBtnCircle, { backgroundColor: activeTab === 'CLASS' ? '#009B12' : '#5788E6' }]}>
              <View style={styles.addBtnPlusH} />
              <View style={styles.addBtnPlusV} />
            </View>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <LogModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSubmitted={() => { setModalVisible(false); load(); }}
      />
      </Animated.View>
    </SafeAreaView>
  );
}

function ClassEmptyState({ onAdd }) {
  return (
    <View style={styles.emptyCard}>
      <View style={styles.emptyIconWrap}>
        <Ionicons name="journal-outline" size={28} color="#ACADB9" />
      </View>
      <Text style={styles.emptyTitle}>Your classes will appear here</Text>
      <Text style={styles.emptySubtitle}>After each lesson, log what your coach worked on with you.</Text>
      <TouchableOpacity style={styles.emptyBtn} onPress={onAdd} activeOpacity={0.85}>
        <Text style={styles.emptyBtnText}>Log your first class</Text>
      </TouchableOpacity>
    </View>
  );
}

function EmptyState({ text }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  offlineBanner: {
    backgroundColor: '#FFF3CD',
    paddingVertical: 6,
    alignItems: 'center',
  },
  offlineBannerText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: '#856404',
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingTop: 16,
    paddingBottom: 14,
  },
  notifBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  profileIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.profileIcon,
    alignItems: 'center', justifyContent: 'center',
  },
  profileInitial: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: '#7A4A00' },
  profilePhoto: { width: 34, height: 34, borderRadius: 17 },

  // Tab switcher — pill style
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.side,
    marginBottom: 16,
    gap: 8,
  },
  tabPill: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
  },
  tabPillActive: {
    backgroundColor: Colors.black,
    borderColor: Colors.black,
  },
  tabPillText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
    color: Colors.secondary,
    letterSpacing: 0.5,
  },
  tabPillTextActive: {
    color: Colors.white,
  },

  // Cards
  listContent: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 16,
  },
  sectionHeader: {
    paddingTop: 20,
    paddingBottom: 8,
  },
  sectionHeaderText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  card: {
    flexDirection: 'row',
    backgroundColor: Colors.statCardBg,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 1,
  },
  cardAccent: {
    width: 4,
  },
  cardBody: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  cardDate: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.secondary,
  },
  noteBadges: { flexDirection: 'row', gap: 5 },
  countBadge: {
    backgroundColor: 'rgba(76,175,80,0.1)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  countBadgeText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 10,
    color: Colors.activeLog,
  },
  cardFocus: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: Colors.black,
    marginBottom: 3,
  },
  cardInput: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    lineHeight: 18,
  },
  cardSecondary: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
    marginTop: 4,
    fontStyle: 'italic',
  },

  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontFamily: Fonts.jakartaRegular, fontSize: 14, color: Colors.secondary, textAlign: 'center', lineHeight: 22 },
  emptyCard: {
    marginTop: 40,
    marginHorizontal: 20,
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#EFEFEF',
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: Colors.black,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyBtn: {
    marginTop: 8,
    backgroundColor: Colors.black,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 28,
  },
  emptyBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: Colors.white,
    letterSpacing: 0.3,
  },

  // Bottom bar
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingVertical: 10,
    gap: 10,
    borderTopWidth: 0.5,
    borderTopColor: Colors.statCardBorder,
    backgroundColor: Colors.background,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 53,
    backgroundColor: 'rgba(46,46,46,0.03)',
    borderRadius: 18,
    paddingLeft: 18,
    paddingRight: 12,
    gap: 10,
  },
  searchIcon: { fontSize: 20 },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: Colors.black,
    letterSpacing: -0.28,
    padding: 0,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 119,
    height: 53,
    borderRadius: 22,
    paddingLeft: 14,
    paddingRight: 5,
    gap: 6,
  },
  addBtnText: {
    fontFamily: Fonts.monument,
    fontSize: 16,
    color: '#000000',
    flex: 1,
  },
  addBtnCircle: {
    width: 43,
    height: 43,
    borderRadius: 1000,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnPlusH: {
    position: 'absolute',
    width: 17,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#fff',
  },
  addBtnPlusV: {
    position: 'absolute',
    width: 3,
    height: 17,
    borderRadius: 2,
    backgroundColor: '#fff',
  },
});
