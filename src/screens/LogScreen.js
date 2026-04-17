import React, { useState, useCallback, useRef } from 'react';
import {
  Alert,
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
  Modal,
  Switch,
} from 'react-native';

const SCREEN_W = Dimensions.get('window').width;
const LOG_CACHE_KEY = '@cache_log';
const SKIP_ADD_REMINDER_KEY = '@skip_add_class_reminder';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../theme';
import { getClassInputs, getNotes } from '../storage/storage';
import {
  getPendingClasses,
  addPendingClass,
  updatePendingClass,
  removePendingClass,
} from '../storage/pendingClasses';
import { processClassDraft } from '../services/classSubmission';
import LogModal from '../components/LogModal';
import { Ionicons } from '@expo/vector-icons';
import TabHeader from '../components/TabHeader';
import LogSkeleton from '../components/LogSkeleton';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DANCE_ABBR = {
  'Cha Cha': 'CCC',
  'Samba': 'S',
  'Rumba': 'R',
  'Paso Doble': 'PD',
  'Jive': 'J',
  'Waltz': 'W',
  'Tango': 'T',
  'V. Waltz': 'VW',
  'Foxtrot': 'F',
  'Quickstep': 'Q',
};
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


function formatCountdown(isoDeadline) {
  const ms = new Date(isoDeadline) - Date.now();
  if (ms <= 0) return null;
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
}

function getDanceAbbrs(item) {
  // Primary: dance field on class_input (single string)
  if (item.dance) {
    return DANCE_ABBR[item.dance] || item.dance.substring(0, 3).toUpperCase();
  }
  // Fallback: collect dances from linked focus_points (text[] per focus point)
  if (item.focus_points?.length > 0) {
    const seen = new Set();
    for (const fp of item.focus_points) {
      if (Array.isArray(fp.dance)) {
        for (const d of fp.dance) if (d) seen.add(d);
      } else if (typeof fp.dance === 'string' && fp.dance) {
        seen.add(fp.dance);
      }
    }
    if (seen.size > 0) {
      return [...seen].map(d => DANCE_ABBR[d] || d.substring(0, 3).toUpperCase()).join(' · ');
    }
  }
  return null;
}

function ClassItem({ item, onPress, onRetry }) {
  const hasTwo = item.practice_point_2 && item.ai_secondary_focus;
  const teacherName = item.teacher_name || item._teacher_fallback || null;
  const lessonType = item.lesson_type || null;
  const isGroup = lessonType === 'group' || lessonType === 'public';
  const countdown = item._pendingDeadline ? formatCountdown(item._pendingDeadline) : null;
  const isAnalysing = !item._pendingDeadline && (item.status === 'processing' || item.status === 'extracted' || item.status === 'pending');
  const isLocalPending = !!item._localPending && !item._failed;
  const isLocalFailed = !!item._failed;
  const showPendingBadge = !!countdown || isAnalysing || !!item._hasPendingFPs || isLocalPending || isLocalFailed;

  function handlePress() {
    if (isLocalFailed) {
      onRetry?.(item._draft);
      return;
    }
    if (isLocalPending) {
      Alert.alert(
        'Saving class',
        'Your class is being processed. It will appear fully in a moment.',
        [{ text: 'OK' }]
      );
      return;
    }
    if (isAnalysing) {
      Alert.alert(
        'Being analysed',
        "Your coach's notes are being processed. Focus points will appear shortly.",
        [{ text: 'OK' }]
      );
      return;
    }
    if (item._hasPendingFPs) {
      Alert.alert(
        'Coach review in progress',
        'Your coach is reviewing the focus points from this class before they\'re shared with you.',
        [{ text: 'OK' }]
      );
      return;
    }
    onPress();
  }

  const accentColor = isLocalFailed
    ? '#E84040'
    : item._hasPendingFPs
      ? Colors.orange
      : Colors.activeLog;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isLocalPending && styles.cardDisabled,
        isLocalFailed && styles.cardFailed,
      ]}
      onPress={handlePress}
      activeOpacity={0.75}
    >
      <View style={[styles.cardAccent, { backgroundColor: accentColor }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardDate}>
            {relativeDate(item.created_at)}
            {teacherName ? <Text style={styles.cardDateSep}>{' · '}</Text> : null}
            {teacherName ? <Text style={styles.cardDateTeacher}>{teacherName}</Text> : null}
          </Text>
          {!!lessonType && (
            <View style={[styles.lessonTypeBadge, isGroup ? styles.lessonTypeBadgeGroup : styles.lessonTypeBadgePrivate]}>
              <Text style={[styles.lessonTypeBadgeText, isGroup ? styles.lessonTypeBadgeTextGroup : styles.lessonTypeBadgeTextPrivate]}>
                {isGroup ? 'Group Class' : 'Private Lesson'}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.cardFocus}>{item.title || item.ai_primary_focus || item.practice_point_1?.split(' ').slice(0, 4).join(' ')}</Text>
        {!showPendingBadge && <Text style={styles.cardInput} numberOfLines={2}>{item.practice_point_1}</Text>}
        {hasTwo && !showPendingBadge && (
          <Text style={styles.cardSecondary} numberOfLines={1}>+ {item.ai_secondary_focus}</Text>
        )}
        {showPendingBadge && (
          <View style={[
            styles.pendingBadge,
            isLocalFailed && styles.pendingBadgeFailed,
          ]}>
            <Text style={[
              styles.pendingBadgeText,
              isLocalFailed && styles.pendingBadgeTextFailed,
            ]}>
              {isLocalFailed
                ? 'Failed — tap to try again'
                : isLocalPending
                  ? 'Saving…'
                  : isAnalysing
                    ? 'Analysing class…'
                    : countdown
                      ? `Focus creation in progress · ready in ${countdown}`
                      : 'Pending coach approval'}
            </Text>
          </View>
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
  const [reminderVisible, setReminderVisible] = useState(false);
  const [dontRemind, setDontRemind] = useState(false);
  const [photoUri, setPhotoUri] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [pending, setPending] = useState([]);
  const [retryDraft, setRetryDraft] = useState(null);
  const hasLoadedRef = useRef(false);
  const processingIdsRef = useRef(new Set());
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef(null);

  async function load() {
    const [allInputs, allNotes, savedPhoto, pendingList] = await Promise.all([
      getClassInputs(),
      getNotes(),
      AsyncStorage.getItem('@profile_photo'),
      getPendingClasses(),
    ]);
    setInputs(allInputs);
    setNotes(allNotes);
    setPending(pendingList);
    setPhotoUri(savedPhoto || null);
    AsyncStorage.setItem(LOG_CACHE_KEY, JSON.stringify({ inputs: allInputs, notes: allNotes })).catch(() => {});
  }

  function draftToDisplayItem(draft) {
    return {
      id: draft._pendingId,
      created_at: draft.createdAt,
      practice_point_1: draft.practicePoint1,
      practice_point_2: draft.showSecond ? draft.practicePoint2 : null,
      teacher_name: draft.teacherName || null,
      lesson_type: draft.lessonType || null,
      dance: draft.selectedDances?.length ? draft.selectedDances.join(', ') : null,
      title: (draft.practicePoint1 || '').split(' ').slice(0, 6).join(' '),
      _localPending: true,
      _failed: !!draft._failed,
      _draft: draft,
    };
  }

  function startProcessing(draft) {
    processClassDraft(draft)
      .then(async () => {
        await removePendingClass(draft._pendingId);
        await load();
      })
      .catch(async (err) => {
        console.warn('[LogScreen] class submit failed:', err);
        await updatePendingClass(draft._pendingId, { _failed: true });
        const list = await getPendingClasses();
        setPending(list);
      });
  }

  async function handleModalSubmit(draft) {
    // If retrying, replace the failed draft with the fresh one
    if (retryDraft) {
      await removePendingClass(retryDraft._pendingId);
    }
    const clean = { ...draft, _failed: false };
    await addPendingClass(clean);
    const list = await getPendingClasses();
    setPending(list);
    setModalVisible(false);
    setRetryDraft(null);
    startProcessing(clean);
  }

  function handleRetry(draft) {
    setRetryDraft(draft);
    setModalVisible(true);
  }

  function handleModalClose() {
    setModalVisible(false);
    setRetryDraft(null);
  }

  function switchTab(tab) {
    setActiveTab(tab);
    scrollRef.current?.scrollTo({ x: tab === 'NOTES' ? SCREEN_W : 0, animated: true });
  }

  async function handleRefresh() {
    setRefreshing(true);
    try { await load(); } catch {}
    setRefreshing(false);
  }

  useFocusEffect(useCallback(() => {
    const isFirst = !hasLoadedRef.current;
    if (isFirst) setIsLoading(true);
    async function init() {
      if (isFirst) {
        try {
          const raw = await AsyncStorage.getItem(LOG_CACHE_KEY);
          if (raw) {
            const { inputs: ci, notes: cn } = JSON.parse(raw);
            setInputs(ci || []);
            setNotes(cn || []);
            setIsLoading(false);
          }
        } catch {}
      }
      try { await load(); } catch {}
      hasLoadedRef.current = true;
      setIsLoading(false);
      if (isFirst) {
        fadeAnim.setValue(0);
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
        // Resume any orphaned pending drafts (e.g. app was killed mid-processing)
        try {
          const orphans = await getPendingClasses();
          orphans.filter((d) => !d._failed && !processingIdsRef.current.has(d._pendingId))
            .forEach((d) => {
              processingIdsRef.current.add(d._pendingId);
              startProcessing(d);
            });
        } catch {}
      }
    }
    init();
  }, []));

  async function handleAdd() {
    if (activeTab === 'NOTES') {
      navigation.navigate('NoteDetail', {});
      return;
    }
    const skip = await AsyncStorage.getItem(SKIP_ADD_REMINDER_KEY);
    if (skip === 'true') {
      setModalVisible(true);
    } else {
      setDontRemind(false);
      setReminderVisible(true);
    }
  }

  async function handleReminderContinue() {
    if (dontRemind) {
      await AsyncStorage.setItem(SKIP_ADD_REMINDER_KEY, 'true');
    }
    setReminderVisible(false);
    setModalVisible(true);
  }

  const pendingDisplay = pending.map(draftToDisplayItem);
  const mergedInputs = [...pendingDisplay, ...inputs].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );

  const filteredInputs = search.trim()
    ? mergedInputs.filter((i) => {
        const q = search.toLowerCase();
        return i.practice_point_1?.toLowerCase().includes(q) || i.practice_point_2?.toLowerCase().includes(q) || i.ai_primary_focus?.toLowerCase().includes(q);
      })
    : mergedInputs;

  const filteredNotes = search.trim()
    ? notes.filter((n) => {
        const q = search.toLowerCase();
        return n.title?.toLowerCase().includes(q) || n.content?.toLowerCase().includes(q);
      })
    : notes;

  const groupedInputs = groupByDate(filteredInputs, 'created_at');
  const groupedNotes = groupByDate(filteredNotes, 'updated_at');

  if (isLoading) {
    return <LogSkeleton />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
      <TabHeader navigation={navigation} />

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
                <ClassItem
                  item={item}
                  onPress={() => navigation.navigate('ClassDetail', { inputId: item.id })}
                  onRetry={handleRetry}
                />
              )}
              renderSectionHeader={({ section: { title } }) => (
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionHeaderText, { color: Colors.activeLog }]}>{title}</Text>
                </View>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={<ClassEmptyState />}
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
        onClose={handleModalClose}
        onSubmitted={handleModalSubmit}
        initialDraft={retryDraft}
      />

      {/* Add class reminder */}
      <Modal visible={reminderVisible} transparent animationType="fade" onRequestClose={() => setReminderVisible(false)}>
        <TouchableOpacity style={styles.reminderOverlay} activeOpacity={1} onPress={() => setReminderVisible(false)}>
          <TouchableOpacity style={styles.reminderSheet} activeOpacity={1} onPress={() => {}}>
            <View style={styles.reminderIconWrap}>
              <Ionicons name="information-circle-outline" size={28} color={Colors.activeLog} />
            </View>
            <Text style={styles.reminderTitle}>Classes are added automatically</Text>
            <Text style={styles.reminderBody}>
              Your coach logs classes directly from their sessions. Only add a class manually if your coach is not yet on InBetween.
            </Text>
            <TouchableOpacity
              style={styles.reminderToggleRow}
              onPress={() => setDontRemind(v => !v)}
              activeOpacity={0.7}
            >
              <Text style={styles.reminderToggleLabel}>Don't remind me again</Text>
              <Switch
                value={dontRemind}
                onValueChange={setDontRemind}
                trackColor={{ false: '#E0E0E0', true: Colors.activeLog }}
                thumbColor="#fff"
              />
            </TouchableOpacity>
            <TouchableOpacity style={styles.reminderBtn} onPress={handleReminderContinue} activeOpacity={0.85}>
              <Text style={styles.reminderBtnText}>Add manually anyway</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setReminderVisible(false)} activeOpacity={0.7} style={{ marginTop: 10 }}>
              <Text style={styles.reminderCancel}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
      </Animated.View>
    </SafeAreaView>
  );
}

function ClassEmptyState() {
  return (
    <View style={styles.emptyCard}>
      <View style={styles.emptyIconWrap}>
        <Ionicons name="journal-outline" size={28} color="#ACADB9" />
      </View>
      <Text style={styles.emptyTitle}>Your classes will appear here</Text>
      <Text style={styles.emptySubtitle}>Once your coach submits a class, it'll show up here, even while the focus points are still being generated.</Text>
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

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingTop: 16,
    paddingBottom: 14,
  },
  notifBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  logo: { fontFamily: Fonts.monument, fontSize: 20, color: Colors.black, letterSpacing: 1 },
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
    paddingTop: 12,
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
  cardDisabled: {
    opacity: 0.5,
  },
  cardFailed: {
    backgroundColor: 'rgba(232,64,64,0.06)',
    borderColor: 'rgba(232,64,64,0.35)',
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
    flexShrink: 1,
  },
  cardDateSep: {
    color: Colors.secondary,
  },
  cardDateTeacher: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.secondary,
  },
  lessonTypeBadge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  lessonTypeBadgePrivate: {
    backgroundColor: 'rgba(76,175,80,0.1)',
  },
  lessonTypeBadgeGroup: {
    backgroundColor: 'rgba(255,200,0,0.15)',
  },
  lessonTypeBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  lessonTypeBadgeTextPrivate: {
    color: Colors.activeLog,
  },
  lessonTypeBadgeTextGroup: {
    color: '#B8860B',
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
  pendingBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,157,0,0.10)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 4,
    borderWidth: 0.5,
    borderColor: 'rgba(255,157,0,0.25)',
  },
  pendingBadgeText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.orange,
  },
  pendingBadgeFailed: {
    backgroundColor: 'rgba(232,64,64,0.12)',
    borderColor: 'rgba(232,64,64,0.35)',
  },
  pendingBadgeTextFailed: {
    color: '#E84040',
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

  // ── Add class reminder modal ──────────────────────────────
  reminderOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  reminderSheet: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 24,
    elevation: 10,
  },
  reminderIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(76,175,80,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  reminderTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: Colors.black,
    textAlign: 'center',
    marginBottom: 10,
  },
  reminderBody: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.secondary,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
  },
  reminderToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    backgroundColor: Colors.statCardBg,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  reminderToggleLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: Colors.black,
  },
  reminderBtn: {
    width: '100%',
    backgroundColor: Colors.black,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  reminderBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#fff',
    letterSpacing: 0.2,
  },
  reminderCancel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: Colors.secondary,
    paddingVertical: 4,
  },
});
