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
import { getClassInputs, getFocusPoints, getNotes } from '../services/storage';
import LogModal from '../components/LogModal';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(ts) {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function Logo() {
  return <Text style={styles.logo}>EE</Text>;
}

function ClassItem({ item, focusMap, onPress }) {
  const fp = focusMap[item.ai_primary_focus];
  const sfp = focusMap[item.ai_secondary_focus];

  return (
    <TouchableOpacity style={styles.logItem} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.dateText}>{formatDate(item.createdAt)}</Text>
      {fp && <Text style={styles.focusTitle}>{fp.label}</Text>}
      <Text style={styles.descText}>1. {item.input1}</Text>
      {sfp && item.input2 ? (
        <>
          <Text style={[styles.focusTitle, { marginTop: 6 }]}>{sfp.label}</Text>
          <Text style={styles.descText}>2. {item.input2}</Text>
        </>
      ) : null}
    </TouchableOpacity>
  );
}

function NoteItem({ item, onPress }) {
  return (
    <TouchableOpacity style={styles.logItem} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.dateText}>{formatDate(item.updatedAt || item.createdAt)}</Text>
      {item.title ? <Text style={styles.focusTitle}>{item.title}</Text> : null}
      {item.content ? (
        <Text style={styles.descText} numberOfLines={2}>
          {item.content}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

export default function LogScreen({ navigation }) {
  const [activeTab, setActiveTab] = useState('CLASS');
  const [inputs, setInputs] = useState([]);
  const [notes, setNotes] = useState([]);
  const [focusMap, setFocusMap] = useState({});
  const [search, setSearch] = useState('');
  const [modalVisible, setModalVisible] = useState(false);

  // Swipe-right gesture on NOTES tab to create new note
  const swipeStartX = useRef(0);
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => activeTab === 'NOTES',
      onMoveShouldSetPanResponder: (_, g) => activeTab === 'NOTES' && Math.abs(g.dx) > 10 && Math.abs(g.dy) < 20,
      onPanResponderGrant: (e) => {
        swipeStartX.current = e.nativeEvent.pageX;
      },
      onPanResponderRelease: (e, g) => {
        if (activeTab === 'NOTES' && g.dx > 60) {
          navigation.navigate('NoteDetail', {});
        }
      },
    })
  ).current;

  async function load() {
    const [allInputs, points, allNotes] = await Promise.all([
      getClassInputs(),
      getFocusPoints(),
      getNotes(),
    ]);
    setInputs([...allInputs].sort((a, b) => b.createdAt - a.createdAt));
    setNotes([...allNotes].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)));
    const map = {};
    for (const p of points) map[p.id] = p;
    setFocusMap(map);
  }

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

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
        const fp = focusMap[i.ai_primary_focus];
        return (
          i.input1?.toLowerCase().includes(q) ||
          i.input2?.toLowerCase().includes(q) ||
          fp?.label?.toLowerCase().includes(q)
        );
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
      {/* Header */}
      <View style={styles.header}>
        <Logo />
        <TouchableOpacity
          style={styles.profileIcon}
          onPress={() => navigation.navigate('PROFILE')}
          activeOpacity={0.8}
        >
          <Text style={styles.profileInitial}>A</Text>
        </TouchableOpacity>
      </View>

      {/* CLASS / NOTES tab switcher */}
      <View style={styles.tabRow}>
        {['CLASS', 'NOTES'].map((tab) => (
          <TouchableOpacity
            key={tab}
            style={styles.tabItem}
            onPress={() => setActiveTab(tab)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab}
            </Text>
            {activeTab === tab && <View style={styles.tabUnderline} />}
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
              <ClassItem
                item={item}
                focusMap={focusMap}
                onPress={() => navigation.navigate('ClassDetail', { inputId: item.id })}
              />
            )}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No logs yet. Tap ADD to log your first class.</Text>
              </View>
            }
          />
        ) : (
          <FlatList
            data={filteredNotes}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <NoteItem
                item={item}
                onPress={() => navigation.navigate('NoteDetail', { noteId: item.id })}
              />
            )}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No notes yet. Tap ADD or swipe right to create one.</Text>
              </View>
            }
          />
        )}
      </View>

      {/* Bottom bar: search + ADD */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={90}
      >
        <View style={styles.bottomBar}>
          <View style={styles.searchWrap}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search..."
              placeholderTextColor={Colors.secondary}
              clearButtonMode="while-editing"
            />
          </View>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={handleAdd}
            activeOpacity={0.85}
          >
            <Text style={styles.addBtnText}>ADD</Text>
            <View style={styles.addPlusCircle}>
              <Text style={styles.addPlus}>+</Text>
            </View>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <LogModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSubmitted={() => {
          setModalVisible(false);
          load();
        }}
      />
    </SafeAreaView>
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
    paddingBottom: 12,
  },
  logo: {
    fontFamily: Fonts.monument,
    fontSize: 20,
    color: Colors.black,
    letterSpacing: 1,
  },
  profileIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.profileIcon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInitial: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: '#7A4A00',
  },

  // CLASS / NOTES switcher
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.side,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,12,17,0.06)',
    marginBottom: 8,
  },
  tabItem: {
    marginRight: 28,
    paddingBottom: 10,
    alignItems: 'center',
  },
  tabText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: Colors.secondary,
    letterSpacing: 0.5,
  },
  tabTextActive: {
    color: Colors.activeLog,
  },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: Colors.activeLog,
    borderRadius: 1,
  },

  // List
  listContent: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 16,
  },
  logItem: {
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(17,12,17,0.06)',
  },
  dateText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.activeLog,
    marginBottom: 2,
  },
  focusTitle: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: Colors.activeLog,
    marginBottom: 3,
  },
  descText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    lineHeight: 18,
  },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontFamily: Fonts.jakartaRegular, fontSize: 14, color: Colors.secondary },

  // Bottom search + ADD bar
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingVertical: 12,
    gap: 12,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(17,12,17,0.06)',
    backgroundColor: Colors.background,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
  },
  searchIcon: { fontSize: 13 },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.black,
    padding: 0,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.activeLog,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 6,
  },
  addBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: Colors.white,
    letterSpacing: 0.5,
  },
  addPlusCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPlus: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: 'bold',
    lineHeight: 18,
  },
});
