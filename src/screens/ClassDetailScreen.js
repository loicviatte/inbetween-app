import React, { useEffect, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Spacing } from '../theme';
import { getClassInputs, getNotesLinkedToClass, getNotes, saveNote } from '../storage/storage';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(isoOrTs) {
  const d = new Date(isoOrTs);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function MetaChip({ icon, label }) {
  if (!label) return null;
  return (
    <View style={s.metaChip}>
      {icon && <Ionicons name={icon} size={11} color={Colors.secondary} />}
      <Text style={s.metaChipText}>{label}</Text>
    </View>
  );
}

function SectionTitle({ label, action, onAction }) {
  return (
    <View style={s.sectionTitleRow}>
      <Text style={s.sectionTitle}>{label}</Text>
      {action && (
        <TouchableOpacity onPress={onAction} activeOpacity={0.7}>
          <Text style={s.sectionAction}>{action}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function ContentCard({ label, text, urgency }) {
  if (!text) return null;
  const filled = Math.round(urgency ?? 0);
  return (
    <View style={s.contentCard}>
      <Text style={s.contentCardLabel}>{label}</Text>
      <Text style={s.contentCardText}>{text}</Text>
      {urgency != null && (
        <View style={s.urgencyRow}>
          <Text style={s.urgencyLabel}>Urgency</Text>
          <View style={s.urgencyBar}>
            {[1,2,3,4,5].map((n) => (
              <View
                key={n}
                style={[s.urgencySegment, n <= filled && s.urgencySegmentFilled]}
              />
            ))}
          </View>
          <Text style={s.urgencyValue}>{filled}/5</Text>
        </View>
      )}
    </View>
  );
}


const TIER_COLOR = { critical: '#FF4B4B', important: '#F5A623', supporting: '#ACADB9' };
const TIER_ORDER = { critical: 0, important: 1, supporting: 2 };

function sortFocusPoints(fps) {
  return [...fps]
    .sort((a, b) => (TIER_ORDER[a.tier] ?? 3) - (TIER_ORDER[b.tier] ?? 3))
    .slice(0, 3);
}

function NotePicker({ visible, allNotes, linkedIds, onToggle, onDone }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onDone}>
      <View style={s.pickerOverlay}>
        <View style={s.pickerSheet}>
          <View style={s.pickerHandle} />
          <View style={s.pickerHeader}>
            <Text style={s.pickerTitle}>Link a note</Text>
            <TouchableOpacity onPress={onDone} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={s.pickerDone}>Done</Text>
            </TouchableOpacity>
          </View>
          {allNotes.length === 0 ? (
            <Text style={s.pickerEmpty}>No notes yet. Create a note first.</Text>
          ) : (
            <FlatList
              data={allNotes}
              keyExtractor={(n) => n.id}
              contentContainerStyle={{ paddingHorizontal: Spacing.side, paddingBottom: 32 }}
              renderItem={({ item }) => {
                const isLinked = linkedIds.includes(item.id);
                return (
                  <TouchableOpacity
                    style={[s.pickerItem, isLinked && s.pickerItemActive]}
                    onPress={() => onToggle(item)}
                    activeOpacity={0.75}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[s.pickerItemTitle, isLinked && s.pickerItemTitleActive]}>
                        {item.title || 'Untitled'}
                      </Text>
                      {item.content ? (
                        <Text style={s.pickerItemPreview} numberOfLines={1}>{item.content}</Text>
                      ) : null}
                    </View>
                    <View style={[s.pickerCheck, isLinked && s.pickerCheckActive]}>
                      {isLinked && <Ionicons name="checkmark" size={13} color={Colors.white} />}
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

  useEffect(() => {
    if (!item) return;
    const label = item.title || item.ai_primary_focus || 'Class';
    navigation.setOptions({ headerBackTitle: label, title: label });
  }, [item]);

  function handleToggleNote(note) {
    const isLinked = note.linked_class_input_id === inputId;
    const updated = { ...note, linked_class_input_id: isLinked ? null : inputId };
    if (isLinked) {
      setLinkedNotes(prev => prev.filter(n => n.id !== note.id));
    } else {
      setLinkedNotes(prev => [...prev, updated]);
    }
    setAllNotes(prev => prev.map(n => n.id === note.id ? updated : n));
    saveNote(updated);
  }

  if (!item) return null;

  const linkedIds = linkedNotes.map((n) => n.id);
  const title = item.title || item.ai_primary_focus || 'Class Log';
  const isAutomatic = !!item.transcript;
  const teacherDisplay = item.teacher_name || item._teacher_fallback || null;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={Colors.black} />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* ── Meta row ── */}
        <View style={s.metaRow}>
          <MetaChip icon="calendar-outline" label={formatDate(item.created_at)} />
          {!!item.dance && <MetaChip icon="musical-notes-outline" label={item.dance} />}
          {!!item.lesson_type && <MetaChip label={item.lesson_type} />}
        </View>

        {/* ── Badges row: teacher + input type ── */}
        <View style={s.badgeRow}>
          {!!teacherDisplay && (
            <View style={s.teacherBadge}>
              <Ionicons name="person-circle-outline" size={13} color="#7A4A00" />
              <Text style={s.teacherBadgeText}>{teacherDisplay}</Text>
            </View>
          )}
          <View style={[s.inputBadge, isAutomatic ? s.inputBadgeAuto : s.inputBadgeManual]}>
            <Ionicons
              name={isAutomatic ? 'sparkles-outline' : 'create-outline'}
              size={11}
              color={isAutomatic ? '#4A6FD4' : '#7A7A8A'}
            />
            <Text style={[s.inputBadgeText, isAutomatic ? s.inputBadgeTextAuto : s.inputBadgeTextManual]}>
              {isAutomatic ? 'AI extracted' : 'Manual input'}
            </Text>
          </View>
        </View>

        {/* ── Class Summary ── */}
        {!!item.class_summary && (
          <View style={s.section}>
            <SectionTitle label="Class Summary" />
            <View style={s.metaCard}>
              <Text style={s.metaCardText}>{item.class_summary}</Text>
            </View>
          </View>
        )}

        {/* ── Focus Points ── */}
        {item.focus_points?.length > 0 && (() => {
          const fps = sortFocusPoints(item.focus_points);
          return (
            <View style={s.section}>
              <SectionTitle label="Focus Points" />
              <View style={s.metaCard}>
                {fps.map((fp, idx) => {
                  const color = TIER_COLOR[fp.tier] || Colors.activeLog;
                  return (
                    <React.Fragment key={fp.id || idx}>
                      {idx > 0 && <View style={s.metaDivider} />}
                      <View style={s.fpRow}>
                        <View style={[s.fpDot, { backgroundColor: color }]} />
                        <View style={s.fpText}>
                          <Text style={s.fpName}>{fp.name}</Text>
                          {!!fp.subtitle && (
                            <Text style={s.fpSubtitle}>{fp.subtitle}</Text>
                          )}
                        </View>
                      </View>
                    </React.Fragment>
                  );
                })}
              </View>
            </View>
          );
        })()}

        {/* ── Linked Notes ── */}
        <View style={s.section}>
          <SectionTitle
            label="Linked Notes"
            action="+ Link"
            onAction={() => setPickerVisible(true)}
          />
          {linkedNotes.length === 0 ? (
            <View style={s.emptyNotes}>
              <Text style={s.emptyNotesText}>No notes linked yet.</Text>
            </View>
          ) : (
            linkedNotes.map((note) => (
              <TouchableOpacity
                key={note.id}
                style={s.noteItem}
                onPress={() => navigation.navigate('NoteDetail', { noteId: note.id, backLabel: title })}
                activeOpacity={0.75}
              >
                <View style={s.noteAccent} />
                <View style={{ flex: 1 }}>
                  <Text style={s.noteTitle}>{note.title || 'Untitled'}</Text>
                  {note.content ? (
                    <Text style={s.notePreview} numberOfLines={2}>{note.content}</Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={16} color="#ACADB9" />
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

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAFAFA' },

  // ── Header ──────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.side,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: '#FAFAFA',
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
    color: Colors.black,
    flex: 1,
    textAlign: 'center',
    paddingHorizontal: 8,
    letterSpacing: -0.2,
  },

  // ── Content ──────────────────────────────────────────────
  content: {
    paddingHorizontal: Spacing.side,
    paddingTop: 4,
    paddingBottom: 52,
  },

  // ── Meta chips row ───────────────────────────────────────
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginBottom: 24,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.white,
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#EFEFEF',
  },
  metaChipText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: Colors.secondary,
    textTransform: 'capitalize',
  },

  // ── Badges row ───────────────────────────────────────────
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 24,
    marginTop: -10,
  },
  teacherBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(245,166,35,0.1)',
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.22)',
  },
  teacherBadgeText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 12,
    color: '#7A4A00',
  },
  inputBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderWidth: 1,
  },
  inputBadgeAuto: {
    backgroundColor: 'rgba(74,111,212,0.08)',
    borderColor: 'rgba(74,111,212,0.18)',
  },
  inputBadgeManual: {
    backgroundColor: 'rgba(122,122,138,0.07)',
    borderColor: 'rgba(122,122,138,0.18)',
  },
  inputBadgeText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
  },
  inputBadgeTextAuto: { color: '#4A6FD4' },
  inputBadgeTextManual: { color: '#7A7A8A' },

  // ── Section ──────────────────────────────────────────────
  section: { marginBottom: 24 },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionAction: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: Colors.activeFocus,
  },

  // ── Meta card (white, bordered) ──────────────────────────
  metaCard: {
    backgroundColor: Colors.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EFEFEF',
    paddingHorizontal: 16,
    paddingVertical: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 1,
    gap: 10,
  },
  metaCardLabel: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 10,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  metaCardText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: Colors.black,
    lineHeight: 23,
  },
  metaDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#F0F0F0',
    marginVertical: 4,
  },

  // ── Urgency ──────────────────────────────────────────────
  urgencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  urgencyLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.secondary,
  },
  urgencyBar: {
    flexDirection: 'row',
    gap: 3,
    flex: 1,
  },
  urgencySegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#F0F0F0',
  },
  urgencySegmentFilled: {
    backgroundColor: Colors.activeLog,
  },
  urgencyValue: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.secondary,
  },

  // ── Focus point rows (inside metaCard) ───────────────────
  fpRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  fpDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
    flexShrink: 0,
  },
  fpText: {
    flex: 1,
  },
  fpName: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: Colors.black,
    marginBottom: 2,
  },
  fpSubtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    lineHeight: 19,
  },

  // ── Empty notes ──────────────────────────────────────────
  emptyNotes: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EFEFEF',
    padding: 16,
    alignItems: 'center',
  },
  emptyNotesText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
  },

  // ── Note items ───────────────────────────────────────────
  noteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EFEFEF',
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
    elevation: 1,
  },
  noteAccent: {
    width: 3,
    alignSelf: 'stretch',
    backgroundColor: '#5788E6',
    borderRadius: 2,
  },
  noteTitle: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: Colors.black,
    marginBottom: 3,
  },
  notePreview: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
    lineHeight: 17,
  },

  // ── Note picker modal ────────────────────────────────────
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '75%',
    paddingBottom: 32,
  },
  pickerHandle: {
    width: 36,
    height: 4,
    backgroundColor: 'rgba(17,12,17,0.12)',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.side,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFEFEF',
    marginBottom: 8,
  },
  pickerTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: Colors.black,
  },
  pickerDone: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: Colors.activeFocus,
  },
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
    paddingHorizontal: Spacing.side,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F5F5F5',
    gap: 12,
  },
  pickerItemActive: {},
  pickerItemTitle: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: Colors.black,
    marginBottom: 2,
  },
  pickerItemTitleActive: { color: Colors.activeFocus },
  pickerItemPreview: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
  },
  pickerCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#DEDEDE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCheckActive: {
    backgroundColor: Colors.activeFocus,
    borderColor: Colors.activeFocus,
  },
});
