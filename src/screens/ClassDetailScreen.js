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
import { LinearGradient } from 'expo-linear-gradient';
import HeroCardGradient from '../components/HeroCardGradient';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Spacing } from '../theme';
import { getClassInputs, getNotesLinkedToClass, getNotes, saveNote } from '../storage/storage';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Editorial palette — same constants used across the redesigned screens.
const GOLD_500 = '#E8B530';
const GOLD_300 = '#F6D27A';
const INK_950 = '#0A0A0A';
const FG_2 = 'rgba(10,10,10,0.72)';
const FG_3 = 'rgba(10,10,10,0.45)';
const LINE = 'rgba(10,10,10,0.09)';
const LINE_2 = 'rgba(10,10,10,0.05)';
const TILE_BG = 'rgba(255,255,255,0.65)';
const SOFT_INK_BG = 'rgba(10,10,10,0.04)';

const PAGE_GRADIENT_COLORS = ['#F2F2EF', '#F8F2E2', '#F4EAD0', '#FFFFFF', '#FFFFFF'];
const PAGE_GRADIENT_LOCATIONS = [0, 0.4, 0.7, 0.85, 1];

function formatDate(isoOrTs) {
  const d = new Date(isoOrTs);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function getInitials(name) {
  if (!name) return '';
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function isPrivateLesson(lessonType) {
  return lessonType !== 'group' && lessonType !== 'public';
}

const TIER_ORDER = { critical: 0, important: 1, supporting: 2 };

function sortFocusPoints(fps) {
  return [...fps]
    .sort((a, b) => (TIER_ORDER[a.tier] ?? 3) - (TIER_ORDER[b.tier] ?? 3));
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

// ─── Sub-components ───────────────────────────────────────────────────

function Pill({ children, variant = 'default', avatar, shrink = false }) {
  const wrap = [
    s.pill,
    variant === 'gold' && s.pillGold,
    variant === 'rec' && s.pillRec,
    shrink && { flexShrink: 1, minWidth: 0 },
  ];
  const text = [
    s.pillText,
    variant === 'gold' && s.pillTextGold,
    variant === 'rec' && s.pillTextRec,
  ];
  return (
    <View style={wrap}>
      {variant === 'rec' && <View style={s.pillRecDot} />}
      {!!avatar && (
        <View style={s.pillAvatar}>
          <Text style={s.pillAvatarText}>{avatar}</Text>
        </View>
      )}
      <Text style={text} numberOfLines={1} ellipsizeMode="tail">{children}</Text>
    </View>
  );
}

function TabBtn({ label, active, onPress, badge }) {
  return (
    <TouchableOpacity style={s.tab} onPress={onPress} activeOpacity={0.75}>
      <Text
        style={[s.tabText, active && s.tabTextActive]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {label}
      </Text>
      {badge != null ? (
        <Text style={s.tabBadge}>{badge}</Text>
      ) : (
        <View style={{ height: 6 }} />
      )}
      {active ? <View style={s.tabUnderline} /> : <View style={{ height: 2 }} />}
    </TouchableOpacity>
  );
}

function SectionEyebrow({ label }) {
  return (
    <View style={s.sectionEyebrow}>
      <Text style={s.sectionEyebrowText}>{label}</Text>
      <View style={s.sectionEyebrowRule} />
    </View>
  );
}

function FocusCard({ index, focus }) {
  return (
    <View style={s.focusCard}>
      <Text style={s.focusMeta}>Focus {index + 1}</Text>
      <Text style={s.focusTitle} numberOfLines={2}>{focus.name}</Text>
      {!!focus.subtitle && (
        <Text style={s.focusBody} numberOfLines={3}>{focus.subtitle}</Text>
      )}
    </View>
  );
}

function LinkedNoteCard({ note, onPress }) {
  return (
    <TouchableOpacity style={s.linkedNoteCard} onPress={onPress} activeOpacity={0.78}>
      <View style={s.linkedNoteIcon}>
        <Ionicons name="document-text-outline" size={16} color={FG_3} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.linkedNoteTitle} numberOfLines={1}>{note.title || 'Untitled'}</Text>
        {!!note.content && (
          <Text style={s.linkedNoteBody} numberOfLines={2}>{note.content}</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={14} color={FG_3} />
    </TouchableOpacity>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────

export default function ClassDetailScreen({ route, navigation }) {
  const { inputId } = route.params;
  const [item, setItem] = useState(null);
  const [linkedNotes, setLinkedNotes] = useState([]);
  const [allNotes, setAllNotes] = useState([]);
  const [activeTab, setActiveTab] = useState('summary');
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
    if (isLinked) {
      setLinkedNotes((prev) => prev.filter((n) => n.id !== note.id));
    } else {
      setLinkedNotes((prev) => [...prev, updated]);
    }
    setAllNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
    saveNote(updated);
  }

  if (!item) {
    return (
      <View style={{ flex: 1 }}>
        <LinearGradient
          colors={PAGE_GRADIENT_COLORS}
          locations={PAGE_GRADIENT_LOCATIONS}
          style={StyleSheet.absoluteFillObject}
        />
        <SafeAreaView style={s.safe} edges={['top']} />
      </View>
    );
  }

  const linkedIds = linkedNotes.map((n) => n.id);
  const title = item.title || item.ai_primary_focus || 'Class Log';
  const isRecorded = !!item.transcript;
  const teacherDisplay = item.teacher_name || item._teacher_fallback || null;
  const teacherInitials = getInitials(teacherDisplay);
  const focusPoints = item.focus_points ? sortFocusPoints(item.focus_points) : [];
  const lessonTypeLabel = item.lesson_type
    ? (isPrivateLesson(item.lesson_type) ? 'Private' : 'Group')
    : null;

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={PAGE_GRADIENT_COLORS}
        locations={PAGE_GRADIENT_LOCATIONS}
        style={StyleSheet.absoluteFillObject}
      />
      <SafeAreaView style={s.safe} edges={['top']}>

        {/* ── Top bar ── */}
        <View style={s.topBar}>
          <TouchableOpacity
            style={s.iconBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={20} color={INK_950} />
          </TouchableOpacity>
          <View style={{ width: 40, height: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Hero card (dark) ── */}
          <View style={s.heroCard}>
            <HeroCardGradient />
            <View style={s.heroTopRow}>
              <Text style={s.heroDate}>{formatDate(item.created_at)}</Text>
              {!!teacherDisplay && (
                <Text style={s.heroTeacher} numberOfLines={1} ellipsizeMode="tail">
                  {teacherDisplay}
                </Text>
              )}
            </View>
            <View style={s.heroPills}>
              {!!lessonTypeLabel && <Pill>{lessonTypeLabel}</Pill>}
              {isRecorded ? (
                <Pill variant="rec">Recorded</Pill>
              ) : (
                <Pill>Manual input</Pill>
              )}
            </View>
            <Text style={s.heroTitle} numberOfLines={3}>{title}</Text>
            <View style={s.heroStatsRow}>
              <View style={[s.heroStat, s.heroStatDivider]}>
                <Text style={s.heroStatN}>{focusPoints.length}</Text>
                <Text style={s.heroStatL}>Focus</Text>
              </View>
              <View style={s.heroStat}>
                <Text style={s.heroStatN}>{linkedNotes.length}</Text>
                <Text style={s.heroStatL}>Notes</Text>
              </View>
            </View>
          </View>

          {/* ── Tabs bar (Summary / Focus points / Notes) ── */}
          <View style={s.tabsBar}>
            <TabBtn
              label="Summary"
              active={activeTab === 'summary'}
              onPress={() => setActiveTab('summary')}
            />
            <TabBtn
              label="Focus points"
              active={activeTab === 'focus'}
              badge={focusPoints.length > 0 ? focusPoints.length : null}
              onPress={() => setActiveTab('focus')}
            />
            <TabBtn
              label="Notes"
              active={activeTab === 'notes'}
              badge={linkedNotes.length > 0 ? linkedNotes.length : null}
              onPress={() => setActiveTab('notes')}
            />
          </View>

          {/* ── Summary tab ── */}
          {activeTab === 'summary' && (
            <>
              {!!item.class_summary ? (
                <View style={s.summaryCard}>
                  <Text style={s.summaryText}>{item.class_summary}</Text>
                </View>
              ) : (
                <Text style={s.placeholder}>No summary yet for this class.</Text>
              )}
            </>
          )}

          {/* ── Focus points tab ── */}
          {activeTab === 'focus' && (
            <>
              {focusPoints.length > 0 ? (
                <View style={s.focusList}>
                  {focusPoints.map((fp, idx) => (
                    <FocusCard key={fp.id || idx} index={idx} focus={fp} />
                  ))}
                </View>
              ) : (
                <Text style={s.placeholder}>No focus points extracted from this class.</Text>
              )}
            </>
          )}

          {/* ── Notes tab ── */}
          {activeTab === 'notes' && (
            <>
              {linkedNotes.length === 0 ? (
                <View style={s.linkA}>
                  <View style={s.linkAIcon}>
                    <Ionicons name="link-outline" size={14} color={FG_3} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.linkATitle}>No notes linked</Text>
                    <Text style={s.linkASubtitle}>Tie a saved note to this class.</Text>
                  </View>
                  <TouchableOpacity
                    style={s.linkABtn}
                    onPress={() => setPickerVisible(true)}
                    activeOpacity={0.78}
                  >
                    <Ionicons name="add" size={11} color={INK_950} />
                    <Text style={s.linkABtnText}>Link</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ gap: 9 }}>
                  {linkedNotes.map((note) => (
                    <LinkedNoteCard
                      key={note.id}
                      note={note}
                      onPress={() => navigation.navigate('NoteDetail', { noteId: note.id, backLabel: title })}
                    />
                  ))}
                  <TouchableOpacity
                    style={s.linkMoreBtn}
                    onPress={() => setPickerVisible(true)}
                    activeOpacity={0.78}
                  >
                    <Ionicons name="add" size={11} color={FG_2} />
                    <Text style={s.linkMoreBtnText}>Link another note</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </ScrollView>

        <NotePicker
          visible={pickerVisible}
          allNotes={allNotes}
          linkedIds={linkedIds}
          onToggle={handleToggleNote}
          onDone={() => setPickerVisible(false)}
        />
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },

  // ── Top bar ──────────────────────────────────────────────
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: LINE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Scroll content ───────────────────────────────────────
  scroll: {
    paddingHorizontal: 18,
    paddingBottom: 40,
  },

  // ── Hero card (dark) ─────────────────────────────────────
  heroCard: {
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(240,194,74,0.28)',
    overflow: 'hidden',
    marginBottom: 4,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
  },
  heroDate: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 0.2,
  },
  heroTeacher: {
    flexShrink: 1,
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: GOLD_300,
    letterSpacing: 0.2,
    textAlign: 'right',
  },
  heroPills: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 10,
  },
  heroTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 24,
    color: '#FFFFFF',
    letterSpacing: -0.6,
    lineHeight: 28,
    marginBottom: 14,
  },
  heroStatsRow: {
    flexDirection: 'row',
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.10)',
  },
  heroStat: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  heroStatDivider: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: 'rgba(255,255,255,0.10)',
  },
  heroStatN: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: '#FFFFFF',
    letterSpacing: -0.36,
    lineHeight: 20,
  },
  heroStatL: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 8.5,
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  // ── Pills (inside hero) ──────────────────────────────────
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  pillGold: {
    backgroundColor: 'rgba(232,181,48,0.16)',
    borderColor: 'rgba(232,181,48,0.34)',
  },
  pillRec: {
    backgroundColor: 'rgba(212,69,69,0.14)',
    borderColor: 'rgba(212,69,69,0.34)',
  },
  pillRecDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FF6B6B',
  },
  pillAvatar: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: GOLD_500,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -2,
  },
  pillAvatarText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 6,
    color: INK_950,
    letterSpacing: 0,
  },
  pillText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 8.5,
    color: 'rgba(255,255,255,0.72)',
    letterSpacing: 0.3,
  },
  pillTextGold: {
    color: GOLD_300,
  },
  pillTextRec: {
    color: '#FF8C8C',
  },

  // ── Section eyebrow ──────────────────────────────────────
  sectionEyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 18,
    paddingBottom: 8,
    paddingHorizontal: 4,
  },
  sectionEyebrowText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 10.5,
    color: GOLD_500,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionEyebrowRule: {
    flex: 1,
    height: 1,
    backgroundColor: LINE_2,
  },

  // ── Class summary card ──────────────────────────────────
  summaryCard: {
    backgroundColor: TILE_BG,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  summaryText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13.5,
    color: INK_950,
    lineHeight: 20,
  },

  // ── Focus point cards ───────────────────────────────────
  focusList: {
    gap: 9,
  },
  focusCard: {
    backgroundColor: TILE_BG,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  focusMeta: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9.5,
    color: '#7A5A10',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  focusTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14.5,
    color: INK_950,
    letterSpacing: -0.16,
    lineHeight: 17.4,
    marginBottom: 3,
  },
  focusBody: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: FG_3,
    lineHeight: 17,
  },

  // ── Linked notes — Variation A (Ghost button) ───────────
  linkA: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  linkAIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: SOFT_INK_BG,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  linkATitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: INK_950,
    letterSpacing: -0.06,
    marginBottom: 1,
  },
  linkASubtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11,
    color: FG_3,
    lineHeight: 15,
  },
  linkABtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: 'transparent',
    flexShrink: 0,
  },
  linkABtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: INK_950,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  // ── Linked notes (when notes exist) ─────────────────────
  linkedNoteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: TILE_BG,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  linkedNoteIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: SOFT_INK_BG,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  linkedNoteTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13.5,
    color: INK_950,
    letterSpacing: -0.1,
    marginBottom: 2,
  },
  linkedNoteBody: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: FG_3,
    lineHeight: 17,
  },
  linkMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    marginTop: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: 'transparent',
  },
  linkMoreBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: FG_2,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  // ── Note picker modal (kept) ─────────────────────────────
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

  // ── Tabs bar (Summary / Focus points / Notes) ──
  tabsBar: {
    flexDirection: 'row',
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(13,13,18,0.10)',
    marginTop: 18,
    marginBottom: 18,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 0,
    gap: 0,
  },
  tabText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 15,
    color: 'rgba(13,13,18,0.45)',
    letterSpacing: -0.2,
  },
  tabTextActive: {
    fontFamily: Fonts.jakartaExtraBold,
    color: INK_950,
  },
  tabBadge: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: '#C8732B',
    letterSpacing: 0.2,
    marginTop: 0,
  },
  tabUnderline: {
    marginTop: 2,
    height: 2,
    width: 60,
    borderRadius: 2,
    backgroundColor: INK_950,
  },

  placeholder: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13.5,
    color: 'rgba(13,13,18,0.45)',
    textAlign: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
    lineHeight: 20,
  },
});
