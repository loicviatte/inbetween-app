import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  PanResponder,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../theme';
import { getClassInputs, getNotes } from '../services/storage';
import LogModal from '../components/LogModal';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

function Logo() {
  return <Text style={styles.logo}>EE</Text>;
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

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dy) < 20,
      onPanResponderRelease: (_, g) => {
        if (g.dx > 60) {
          navigation.navigate('NoteDetail', {});
        }
      },
    })
  ).current;

  async function load() {
    const [allInputs, allNotes] = await Promise.all([getClassInputs(), getNotes()]);
    setInputs(allInputs); // already sorted by created_at desc from Supabase
    setNotes(allNotes);   // already sorted by updated_at desc from Supabase
  }

  useFocusEffect(useCallback(() => { load(); }, []));

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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Logo />
        <TouchableOpacity style={styles.profileIcon} onPress={() => navigation.navigate('PROFILE')} activeOpacity={0.8}>
          <Text style={styles.profileInitial}>A</Text>
        </TouchableOpacity>
      </View>

      {/* Tab switcher */}
      <View style={styles.tabRow}>
        {['CLASS', 'NOTES'].map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tabPill, activeTab === tab && styles.tabPillActive]}
            onPress={() => setActiveTab(tab)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabPillText, activeTab === tab && styles.tabPillTextActive]}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      <View style={{ flex: 1 }} {...(activeTab === 'NOTES' ? panResponder.panHandlers : {})}>
        {activeTab === 'CLASS' ? (
          <FlatList
            data={filteredInputs}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ClassItem item={item} onPress={() => navigation.navigate('ClassDetail', { inputId: item.id })} />
            )}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<EmptyState text="No class logs yet. Tap ADD to log your first session." />}
          />
        ) : (
          <FlatList
            data={filteredNotes}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <NoteItem item={item} onPress={() => navigation.navigate('NoteDetail', { noteId: item.id })} />
            )}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<EmptyState text="No notes yet. Tap ADD or swipe right to create one." />}
          />
        )}
      </View>

      {/* Bottom bar */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
        <View style={styles.bottomBar}>
          <View style={styles.searchWrap}>
            <Text style={styles.searchIcon}>⌕</Text>
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
    </SafeAreaView>
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
  logo: { fontFamily: Fonts.monument, fontSize: 20, color: Colors.black, letterSpacing: 1 },
  profileIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.profileIcon,
    alignItems: 'center', justifyContent: 'center',
  },
  profileInitial: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: '#7A4A00' },

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
    gap: 10,
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
  searchIcon: { fontSize: 20, color: '#006FFD' },
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
