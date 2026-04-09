import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Spacing } from '../theme';
import { getClassInputs, getNotesLinkedToClass, getNotes, saveNote } from '../storage/storage';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(isoOrTs) {
  const d = new Date(isoOrTs);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function UrgencyDots({ value }) {
  return (
    <View style={styles.urgencyDots}>
      {[1, 2, 3, 4, 5].map((n) => (
        <View key={n} style={[styles.urgencyDot, n <= value && { backgroundColor: Colors.activeLog }]} />
      ))}
    </View>
  );
}

function NotePicker({ visible, allNotes, linkedIds, onToggle, onDone }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onDone}>
      <View style={styles.pickerOverlay}>
        <View style={styles.pickerSheet}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Link a note</Text>
            <TouchableOpacity onPress={onDone} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.pickerDone}>Done</Text>
            </TouchableOpacity>
          </View>
          {allNotes.length === 0 ? (
            <Text style={styles.pickerEmpty}>No notes yet. Create a note first.</Text>
          ) : (
            <FlatList
              data={allNotes}
              keyExtractor={(n) => n.id}
              contentContainerStyle={{ paddingHorizontal: Spacing.side, paddingBottom: 32 }}
              renderItem={({ item }) => {
                const isLinked = linkedIds.includes(item.id);
                return (
                  <TouchableOpacity
                    style={[styles.pickerItem, isLinked && styles.pickerItemActive]}
                    onPress={() => onToggle(item)}
                    activeOpacity={0.75}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.pickerItemTitle, isLinked && styles.pickerItemTitleActive]}>
                        {item.title || 'Untitled'}
                      </Text>
                      {item.content ? (
                        <Text style={styles.pickerItemPreview} numberOfLines={1}>{item.content}</Text>
                      ) : null}
                    </View>
                    <View style={[styles.pickerCheck, isLinked && styles.pickerCheckActive]}>
                      {isLinked && <Text style={styles.pickerCheckMark}>✓</Text>}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

export default function ClassDetailScreen({ route, navigation }) {
  const { inputId } = route.params;
  const [item, setItem] = useState(null);
  const [linkedNotes, setLinkedNotes] = useState([]);
  const [allNotes, setAllNotes] = useState([]);
  const [pickerVisible, setPickerVisible] = useState(false);

  async function load() {
    const [inputs, notes, linked] = await Promise.all([
      getClassInputs(), getNotes(), getNotesLinkedToClass(inputId),
    ]);
    const found = inputs.find((i) => i.id === inputId);
    setItem(found || null);
    setLinkedNotes(linked);
    setAllNotes(notes);
  }

  useEffect(() => { load(); }, [inputId]);

  function handleToggleNote(note) {
    const isLinked = note.linked_class_input_id === inputId;
    const updated = { ...note, linked_class_input_id: isLinked ? null : inputId };
    // Optimistic update — instant feedback, no reload
    if (isLinked) {
      setLinkedNotes(prev => prev.filter(n => n.id !== note.id));
    } else {
      setLinkedNotes(prev => [...prev, updated]);
    }
    setAllNotes(prev => prev.map(n => n.id === note.id ? updated : n));
    saveNote(updated); // fire-and-forget
  }

  if (!item) return null;

  const linkedIds = linkedNotes.map((n) => n.id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backLabel}>Log</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{item.title || 'Class Log'}</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.date}>{formatDate(item.created_at)}</Text>

        {/* ── Your Notes (user input) ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Your Notes</Text>

          {item.class_summary ? (
            <View style={[styles.card, { marginBottom: 10 }]}>
              <Text style={styles.noteInputLabel}>What you worked on</Text>
              <Text style={styles.cardText}>{item.class_summary}</Text>
            </View>
          ) : null}

          {item.practice_point_1 ? (
            <View style={[styles.card, { marginBottom: item.practice_point_2 ? 10 : 0 }]}>
              <Text style={styles.noteInputLabel}>To improve</Text>
              <Text style={styles.cardText}>{item.practice_point_1}</Text>
              {item.priority_score_1 != null && (
                <View style={styles.urgencyRow}>
                  <Text style={styles.urgencyLabel}>Urgency</Text>
                  <UrgencyDots value={item.priority_score_1} />
                </View>
              )}
            </View>
          ) : null}

          {item.practice_point_2 ? (
            <View style={styles.card}>
              <Text style={styles.noteInputLabel}>Also to improve</Text>
              <Text style={styles.cardText}>{item.practice_point_2}</Text>
              {item.priority_score_2 != null && (
                <View style={styles.urgencyRow}>
                  <Text style={styles.urgencyLabel}>Urgency</Text>
                  <UrgencyDots value={item.priority_score_2} />
                </View>
              )}
            </View>
          ) : null}
        </View>

        {/* ── Divider ── */}
        {(item.ai_primary_focus || item.ai_secondary_focus) ? (
          <View style={styles.divider} />
        ) : null}

        {/* ── Linked Focus (AI generated) ── */}
        {(item.ai_primary_focus || item.ai_secondary_focus) ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Linked Focus</Text>

            {item.ai_primary_focus ? (
              <View style={[styles.focusChip, { marginBottom: item.ai_secondary_focus ? 8 : 0 }]}>
                <View style={styles.fpDot} />
                <Text style={styles.focusChipText}>{item.ai_primary_focus}</Text>
              </View>
            ) : null}

            {item.ai_secondary_focus ? (
              <View style={styles.focusChip}>
                <View style={[styles.fpDot, { backgroundColor: Colors.activeFocus }]} />
                <Text style={styles.focusChipText}>{item.ai_secondary_focus}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Linked notes */}
        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>Linked notes</Text>
            <TouchableOpacity onPress={() => setPickerVisible(true)} activeOpacity={0.7}>
              <Text style={styles.linkBtn}>+ Link note</Text>
            </TouchableOpacity>
          </View>

          {linkedNotes.length === 0 ? (
            <Text style={styles.emptyNoteText}>No notes linked yet.</Text>
          ) : (
            linkedNotes.map((note) => (
              <TouchableOpacity
                key={note.id}
                style={styles.noteItem}
                onPress={() => navigation.navigate('NoteDetail', { noteId: note.id })}
                activeOpacity={0.75}
              >
                <View style={styles.noteAccent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.noteTitle}>{note.title || 'Untitled'}</Text>
                  {note.content ? (
                    <Text style={styles.notePreview} numberOfLines={2}>{note.content}</Text>
                  ) : null}
                </View>
                <Text style={styles.noteArrow}>→</Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>

      <NotePicker
        visible={pickerVisible}
        allNotes={allNotes}
        linkedIds={linkedIds}
        onToggle={handleToggleNote}
        onDone={() => setPickerVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.side,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backArrow: { fontSize: 16, color: Colors.black },
  backLabel: { fontFamily: Fonts.jakartaMedium, fontSize: 15, color: Colors.black },
  headerTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
    color: Colors.black,
    flex: 1,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  headerRight: { width: 60 },

  content: { paddingHorizontal: Spacing.side, paddingTop: 6, paddingBottom: 48 },

  date: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: Colors.secondary,
    marginBottom: 24,
    letterSpacing: 0.3,
  },

  section: { marginBottom: 24 },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },

  question: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: Colors.black,
    marginBottom: 10,
  },

  card: {
    backgroundColor: Colors.statCardBg,
    borderRadius: 12,
    padding: 16,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
  },
  cardText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: Colors.black,
    lineHeight: 23,
  },

  divider: {
    height: 1,
    backgroundColor: Colors.statCardBorder,
    marginBottom: 24,
  },
  focusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.statCardBg,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
  },
  focusChipText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: Colors.black,
    flex: 1,
  },
  noteInputLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: Colors.black,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  fpDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.activeLog },
  urgencyRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 10 },
  urgencyLabel: { fontFamily: Fonts.jakartaMedium, fontSize: 11, color: Colors.secondary },
  urgencyDots: { flexDirection: 'row', gap: 5 },
  urgencyDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(17,12,17,0.12)' },

  linkBtn: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: Colors.activeFocus,
  },
  emptyNoteText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    marginBottom: 4,
  },
  noteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.statCardBg,
    borderRadius: 12,
    padding: 14,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    marginBottom: 8,
  },
  noteAccent: { width: 3, alignSelf: 'stretch', backgroundColor: '#5788E6', borderRadius: 2 },
  noteTitle: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: Colors.black, marginBottom: 3 },
  notePreview: { fontFamily: Fonts.jakartaRegular, fontSize: 12, color: Colors.secondary, lineHeight: 18 },
  noteArrow: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: Colors.secondary },

  // Note picker modal
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  pickerSheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '75%',
    paddingTop: 12,
    paddingBottom: 32,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.side,
    paddingBottom: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.statCardBorder,
    marginBottom: 12,
  },
  pickerTitle: { fontFamily: Fonts.jakartaExtraBold, fontSize: 16, color: Colors.black },
  pickerDone: { fontFamily: Fonts.jakartaBold, fontSize: 15, color: Colors.activeFocus },
  pickerEmpty: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.secondary,
    textAlign: 'center',
    paddingTop: 32,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.statCardBorder,
    gap: 12,
  },
  pickerItemActive: { opacity: 1 },
  pickerItemTitle: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: Colors.black, marginBottom: 2 },
  pickerItemTitleActive: { color: Colors.activeFocus },
  pickerItemPreview: { fontFamily: Fonts.jakartaRegular, fontSize: 12, color: Colors.secondary },
  pickerCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.statCardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCheckActive: { backgroundColor: Colors.activeFocus, borderColor: Colors.activeFocus },
  pickerCheckMark: { color: Colors.white, fontSize: 13, fontWeight: 'bold' },
});
