import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  FlatList,
  Alert,
  Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import HeroCardGradient from '../../components/HeroCardGradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../../theme';
import { GenericListSkeleton } from '../../components/Skeleton';
import {
  getCoachClassDetail,
  setStudentAttendance,
  getMyStudents,
  getCoachUnlinkedNotes,
  linkNoteToClass,
  unlinkNoteFromClass,
} from '../../storage/coachStorage';

// ─── Palette ────────────────────────────────────────────────────────────────
const INK_950 = '#0A0A0A';
const INK_50 = '#F7F6F3';
const PAPER = '#FFFFFF';
const FG_2 = 'rgba(10,10,10,0.55)';
const FG_3 = 'rgba(10,10,10,0.30)';
const LINE = 'rgba(10,10,10,0.09)';
const LINE_2 = 'rgba(10,10,10,0.05)';
const GOLD_500 = '#E8B530';
const GOLD_300 = '#F6D27A';

// State accents
const SUCCESS = '#4CAF50';
const SUCCESS_BG = 'rgba(76,175,80,0.15)';
const SUCCESS_BORDER = 'rgba(76,175,80,0.35)';
const DANGER = '#E84545';
const DANGER_BG = 'rgba(232,69,69,0.10)';
const DANGER_BORDER = 'rgba(232,69,69,0.35)';
const WARN_TEXT = '#B8732B';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDatePill(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) {
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
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

// ─── Pill (matches the student-side hero pills, 1:1) ───────────────────────

function Pill({ children, variant = 'default' }) {
  return (
    <View style={[s.pill, variant === 'rec' && s.pillRec]}>
      {variant === 'rec' && <View style={s.pillRecDot} />}
      <Text
        style={[s.pillText, variant === 'rec' && s.pillTextRec]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {children}
      </Text>
    </View>
  );
}

// ─── Mismatch / status helpers ──────────────────────────────────────────────

// Returns the meta line shown under each student's name. The student's
// reply gets the spotlight (green/red/gray) — the coach's mark is shown
// next to it on the explicit Present/Absent toggle.
function attendanceStatus(att) {
  const c = att.attendance || 'pending';
  const sr = att.studentResponse;
  const studentSaid = sr ? (sr.attended ? 'yes' : 'no') : null;

  // Mismatch (coach decided + student replied with the opposite answer)
  if (c !== 'pending' && studentSaid && c !== studentSaid) {
    return {
      kind: 'mismatch',
      meta: studentSaid === 'yes'
        ? '⚠ Mismatch — they said present'
        : '⚠ Mismatch — they said absent',
    };
  }

  if (!studentSaid) {
    return { kind: 'no-reply', meta: 'Awaiting their reply' };
  }
  if (studentSaid === 'yes') {
    return { kind: 'said-yes', meta: 'Said present' };
  }
  return { kind: 'said-no', meta: 'Said absent' };
}

// ─── Segmented Present/Absent toggle (the coach's mark) ─────────────────────
//
// Two labelled cells in a rounded pill. Tapping a cell sets that value;
// the active cell is filled (green for Present, red for Absent). When
// `disabled` (private lessons), the active cell is shown muted and taps
// are ignored.

function SegmentedToggle({ value, studentSaid, onChange, disabled }) {
  const onPick = (v) => { if (!disabled) onChange?.(v); };

  // Each cell is in one of three visual states:
  //   - active   → coach has explicitly chosen this side (bright fill)
  //   - greyed   → student replied with this side, coach hasn't chosen (or
  //                chose the opposite) — surfaces the student's voice
  //   - neutral  → nothing to show
  const yesActive = value === 'yes';
  const noActive = value === 'no';
  const yesGreyed = !yesActive && studentSaid === 'yes';
  const noGreyed = !noActive && studentSaid === 'no';

  return (
    <View style={[seg.outer, disabled && seg.outerDisabled]}>
      <TouchableOpacity
        activeOpacity={disabled ? 1 : 0.75}
        onPress={() => onPick('yes')}
        style={[
          seg.cell,
          yesActive && (disabled ? seg.cellActiveYesMuted : seg.cellActiveYes),
          yesGreyed && seg.cellGreyedYes,
        ]}
      >
        <Text
          style={[
            seg.cellText,
            yesActive && seg.cellTextActive,
            yesGreyed && seg.cellTextGreyedYes,
          ]}
        >
          Present
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        activeOpacity={disabled ? 1 : 0.75}
        onPress={() => onPick('no')}
        style={[
          seg.cell,
          noActive && (disabled ? seg.cellActiveNoMuted : seg.cellActiveNo),
          noGreyed && seg.cellGreyedNo,
        ]}
      >
        <Text
          style={[
            seg.cellText,
            noActive && seg.cellTextActive,
            noGreyed && seg.cellTextGreyedNo,
          ]}
        >
          Absent
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const seg = StyleSheet.create({
  outer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(10,10,10,0.04)',
    borderRadius: 999,
    padding: 2,
    height: 30,
  },
  outerDisabled: { opacity: 0.7 },
  cell: {
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 56,
  },
  cellActiveYes: { backgroundColor: SUCCESS },
  cellActiveNo: { backgroundColor: DANGER },
  cellActiveYesMuted: { backgroundColor: 'rgba(76,175,80,0.45)' },
  cellActiveNoMuted: { backgroundColor: 'rgba(232,69,69,0.45)' },
  // Faded fill that surfaces the student's reply on whichever side they
  // picked, without overshadowing the coach's own bright mark.
  cellGreyedYes: { backgroundColor: 'rgba(76,175,80,0.16)' },
  cellGreyedNo: { backgroundColor: 'rgba(232,69,69,0.10)' },
  cellText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: FG_2,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  cellTextActive: { color: '#fff' },
  cellTextGreyedYes: { color: '#3D7A40' },
  cellTextGreyedNo: { color: '#9F4040' },
});

// ─── Attendance row ─────────────────────────────────────────────────────────

function AttendanceRow({
  att,
  status,
  onSetCoach,
  busy,
}) {
  const isMismatch = status.kind === 'mismatch';
  const isSaidYes = status.kind === 'said-yes';
  const isSaidNo = status.kind === 'said-no';

  // Avatar ring + bg colors follow the row state.
  const ringColor = isMismatch ? DANGER : GOLD_500;
  const avatarBg = isMismatch ? '#F7D8D8' : '#4E6A5C';
  const avatarTextColor = isMismatch ? DANGER : '#fff';

  return (
    <View style={[rowS.row, isMismatch && rowS.rowMismatch]}>
      <View style={[rowS.avRing, { borderColor: ringColor }]}>
        {att.photoUrl ? (
          <Image source={{ uri: att.photoUrl }} style={rowS.avPhoto} />
        ) : (
          <View style={[rowS.avFallback, { backgroundColor: avatarBg }]}>
            <Text style={[rowS.avText, { color: avatarTextColor }]}>
              {att.name?.[0]?.toUpperCase() || 'S'}
            </Text>
          </View>
        )}
      </View>

      <View style={rowS.body}>
        <Text style={rowS.name} numberOfLines={1}>{att.name}</Text>
        <Text
          style={[
            rowS.meta,
            isMismatch && rowS.metaMismatch,
            isSaidYes && rowS.metaSaidYes,
            isSaidNo && rowS.metaSaidNo,
          ]}
          numberOfLines={1}
        >
          {status.meta}
        </Text>
      </View>

      <SegmentedToggle
        value={att.attendance || 'pending'}
        studentSaid={
          att.studentResponse
            ? (att.studentResponse.attended ? 'yes' : 'no')
            : null
        }
        onChange={(v) => onSetCoach?.(att, v)}
        disabled={att.isPrivateOnly || busy}
      />

      {busy ? (
        <ActivityIndicator
          size="small"
          color={GOLD_500}
          style={{ position: 'absolute', right: 8, top: 8 }}
        />
      ) : null}
    </View>
  );
}

const rowS = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: PAPER,
    borderWidth: 1,
    borderColor: LINE,
    marginBottom: 8,
    position: 'relative',
  },
  rowMismatch: {
    borderColor: 'rgba(232,69,69,0.35)',
  },
  avRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  avPhoto: { width: 36, height: 36, borderRadius: 18 },
  avFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  name: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: INK_950,
    letterSpacing: -0.3,
  },
  meta: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12.5,
    color: FG_2,
    lineHeight: 17,
  },
  metaMismatch: {
    color: WARN_TEXT,
    fontFamily: Fonts.jakartaSemiBold,
  },
  metaSaidYes: {
    color: '#2F6B33',
    fontFamily: Fonts.jakartaSemiBold,
  },
  metaSaidNo: {
    color: '#9F2F2F',
    fontFamily: Fonts.jakartaSemiBold,
  },
});

// ─── Modals ─────────────────────────────────────────────────────────────────

function StudentPickerModal({ visible, existingIds, onClose, onSelect }) {
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    getMyStudents()
      .then(s => setStudents(s || []))
      .catch(() => setStudents([]))
      .finally(() => setLoading(false));
  }, [visible]);

  const q = search.trim().toLowerCase();
  const remaining = students.filter(s => !existingIds.has(s.id));
  const filtered = q
    ? remaining.filter(s => (s.name || '').toLowerCase().includes(q))
    : remaining;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={picker.overlay}>
        <View style={picker.sheet}>
          <View style={picker.handle} />
          <View style={picker.header}>
            <Text style={picker.title}>Add student to class</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={20} color={FG_2} />
            </TouchableOpacity>
          </View>
          <View style={picker.searchWrap}>
            <Ionicons name="search" size={16} color={FG_2} />
            <TextInput
              style={picker.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search students…"
              placeholderTextColor={FG_3}
              autoCorrect={false}
            />
          </View>
          {loading ? (
            <View style={{ paddingVertical: 30, alignItems: 'center' }}>
              <ActivityIndicator color={GOLD_500} />
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={i => i.id}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={picker.item}
                  onPress={() => onSelect(item)}
                  activeOpacity={0.7}
                >
                  {item.photoUrl ? (
                    <Image source={{ uri: item.photoUrl }} style={picker.itemAvatar} />
                  ) : (
                    <View style={[picker.itemAvatar, picker.itemAvatarFallback]}>
                      <Text style={picker.itemAvatarText}>
                        {item.name?.[0]?.toUpperCase() || 'S'}
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={picker.itemName}>{item.name || 'Student'}</Text>
                    {item.danceStyle ? (
                      <Text style={picker.itemSub}>{item.danceStyle}</Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={picker.empty}>
                  {remaining.length === 0
                    ? 'All your students are already on this class.'
                    : 'No students match your search.'}
                </Text>
              }
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

function NotePickerModal({ visible, onClose, onSelect, onCreateNew }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    getCoachUnlinkedNotes()
      .then(n => setItems(n || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [visible]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? items.filter(n =>
        (n.title || '').toLowerCase().includes(q) ||
        (n.content || '').toLowerCase().includes(q),
      )
    : items;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={picker.overlay}>
        <View style={picker.sheet}>
          <View style={picker.handle} />
          <View style={picker.header}>
            <Text style={picker.title}>Link a note to this class</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={20} color={FG_2} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={picker.createNew} onPress={onCreateNew} activeOpacity={0.75}>
            <Ionicons name="add-circle-outline" size={20} color={Colors.orange} />
            <Text style={picker.createNewText}>Create a new note</Text>
          </TouchableOpacity>
          <View style={picker.searchWrap}>
            <Ionicons name="search" size={16} color={FG_2} />
            <TextInput
              style={picker.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search existing notes…"
              placeholderTextColor={FG_3}
              autoCorrect={false}
            />
          </View>
          {loading ? (
            <View style={{ paddingVertical: 30, alignItems: 'center' }}>
              <ActivityIndicator color={GOLD_500} />
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={i => i.id}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={picker.noteItem}
                  onPress={() => onSelect(item)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={picker.noteTitle} numberOfLines={1}>
                      {item.title || 'Untitled'}
                    </Text>
                    {item.content ? (
                      <Text style={picker.noteContent} numberOfLines={2}>
                        {item.content}
                      </Text>
                    ) : null}
                    <Text style={picker.noteDate}>
                      {relativeDate(item.updated_at || item.created_at)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={FG_3} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={picker.empty}>
                  {items.length === 0
                    ? 'No unlinked notes. Create a new one above.'
                    : 'No notes match your search.'}
                </Text>
              }
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Main screen ────────────────────────────────────────────────────────────

export default function CoachClassDetailScreen({ route, navigation }) {
  const { classId } = route.params;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('attendance'); // open on Attendance to match the spec
  const [busyStudentId, setBusyStudentId] = useState(null);
  const [studentPickerOpen, setStudentPickerOpen] = useState(false);
  const [notePickerOpen, setNotePickerOpen] = useState(false);

  const loadDetail = useCallback(async () => {
    try {
      const detail = await getCoachClassDetail(classId);
      setData(detail);
    } catch (err) {
      console.warn('[CoachClassDetail] load failed:', err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        if (active) await loadDetail();
      })();
      return () => {
        active = false;
      };
    }, [loadDetail]),
  );

  const cls = data?.class;
  const linkedNotes = data?.linkedNotes || [];
  const focusCount = data?.focusCount || 0;
  const isPrivate = !cls ? false : (cls.lesson_type === 'private' || cls.lesson_type == null);

  const attendees = useMemo(() => {
    if (!data) return [];
    if (isPrivate && cls?.student && data.attendees.length === 0) {
      return [
        {
          ...cls.student,
          attendance: 'yes',
          studentResponse: null,
          isPrivateOnly: true,
        },
      ];
    }
    return data.attendees;
  }, [data, isPrivate, cls?.student]);

  // Pending edits to attendance. The toggle writes here, not to the server.
  // Map of studentId → 'yes' | 'no' | 'pending'. Cleared on successful save.
  const [pendingAttendance, setPendingAttendance] = useState({});
  const [savingAttendance, setSavingAttendance] = useState(false);

  const attendeesWithStatus = useMemo(
    () => attendees.map(att => {
      const override = pendingAttendance[att.id];
      const effective = override !== undefined
        ? { ...att, attendance: override }
        : att;
      return {
        att: effective,
        status: attendanceStatus(effective),
        hasUnsaved: override !== undefined,
      };
    }),
    [attendees, pendingAttendance],
  );

  const mismatchCount = attendeesWithStatus.filter(x => x.status.kind === 'mismatch').length;
  const yesCount = attendeesWithStatus.filter(x => x.att.attendance === 'yes').length;
  const totalCount = attendees.length;
  const pendingCount = Object.keys(pendingAttendance).length;

  // ── Mutations ─────────────────────────────────────────────────────────────

  // Coach picks Present or Absent on a row's segmented toggle. The change
  // accumulates in `pendingAttendance` — nothing hits the server until the
  // coach taps "Save changes" below. Tapping the already-active value
  // toggles back to pending. Overriding a student's reply still triggers
  // the destructive-action confirmation up front, but no FPs are deleted
  // until save.
  function handleSetCoach(att, value) {
    const current = att.attendance || 'pending';
    const next = current === value ? 'pending' : value;

    const studentSaid = att.studentResponse
      ? (att.studentResponse.attended ? 'yes' : 'no')
      : null;

    const overridingStudent =
      !!studentSaid && next !== 'pending' && next !== studentSaid;

    if (overridingStudent) {
      const studentLabel = studentSaid === 'yes' ? 'present' : 'absent';
      const newLabel = next === 'yes' ? 'present' : 'absent';
      const tail = next === 'no'
        ? ' On save, the focus points assigned to them from this class will be removed.'
        : '';
      Alert.alert(
        "Override student's reply?",
        `${att.name || 'This student'} said they were ${studentLabel}. Marking them ${newLabel} replaces their answer.${tail}`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Override',
            style: 'destructive',
            onPress: () => stagePending(att.id, next),
          },
        ],
      );
      return;
    }
    stagePending(att.id, next);
  }

  // Add (or clear) a pending entry. If the new value matches what's already
  // on the server, drop the entry — the coach un-did their own edit.
  function stagePending(studentId, value) {
    setPendingAttendance(prev => {
      const updated = { ...prev };
      const serverValue =
        data?.attendees.find(a => a.id === studentId)?.attendance || 'pending';
      if (serverValue === value) {
        delete updated[studentId];
      } else {
        updated[studentId] = value;
      }
      return updated;
    });
  }

  function handleDiscardChanges() {
    if (pendingCount === 0) return;
    Alert.alert(
      'Discard changes?',
      `You have ${pendingCount} unsaved change${pendingCount > 1 ? 's' : ''}.`,
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => setPendingAttendance({}),
        },
      ],
    );
  }

  async function handleSaveChanges() {
    if (savingAttendance) return;
    const entries = Object.entries(pendingAttendance);
    if (entries.length === 0) return;
    setSavingAttendance(true);
    try {
      // Persist sequentially so we surface the first failure cleanly. Each
      // call also triggers the server-side FP cleanup when value === 'no'.
      for (const [studentId, value] of entries) {
        await setStudentAttendance(classId, studentId, value);
      }
      setPendingAttendance({});
      await loadDetail();
    } catch (err) {
      Alert.alert('Could not save', String(err?.message || err));
    } finally {
      setSavingAttendance(false);
    }
  }

  async function handleAddStudent(student) {
    setStudentPickerOpen(false);
    setBusyStudentId(student.id);
    // Reset any stale pending for this id; the server is now the truth.
    setPendingAttendance(prev => {
      if (prev[student.id] === undefined) return prev;
      const { [student.id]: _, ...rest } = prev;
      return rest;
    });
    try {
      await setStudentAttendance(classId, student.id, 'yes');
      await loadDetail();
    } catch (err) {
      Alert.alert('Could not add', String(err?.message || err));
    } finally {
      setBusyStudentId(null);
    }
  }

  async function handleLinkExistingNote(note) {
    setNotePickerOpen(false);
    try {
      await linkNoteToClass(note.id, classId);
      await loadDetail();
    } catch (err) {
      Alert.alert('Could not link note', String(err?.message || err));
    }
  }

  function handleCreateNoteForClass() {
    setNotePickerOpen(false);
    navigation.navigate('CoachNoteDetail', { linkedClassInputId: classId });
  }

  async function handleUnlinkNote(note) {
    Alert.alert('Unlink note', 'Remove this note from the class? The note itself stays.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unlink',
        style: 'destructive',
        onPress: async () => {
          setData(prev =>
            prev
              ? { ...prev, linkedNotes: prev.linkedNotes.filter(n => n.id !== note.id) }
              : prev,
          );
          try {
            await unlinkNoteFromClass(note.id);
          } catch (err) {
            Alert.alert('Could not unlink', String(err?.message || err));
            await loadDetail();
          }
        },
      },
    ]);
  }

  // ── Render guards ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <TopBar onBack={() => navigation.goBack()} />
        <GenericListSkeleton rows={4} variant="detail" showHeader={false} showTitle={false} />
      </SafeAreaView>
    );
  }
  if (!data) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <TopBar onBack={() => navigation.goBack()} />
        <View style={s.errorWrap}>
          <Text style={s.errorText}>Class not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Header pieces ────────────────────────────────────────────────────────

  const isProcessing =
    cls.status === 'processing' || cls.status === 'pending' || cls.status === 'extracted';
  const title =
    cls.title ||
    cls.ai_primary_focus ||
    (cls.practice_point_1 || '').split(' ').slice(0, 6).join(' ') ||
    (isPrivate ? 'Private lesson' : 'Group class');

  const datePill = formatDatePill(cls.created_at);

  // Top-right of the dark card — mirrors the student-side card where the
  // teacher's name lives. For coaches: the student name on a private class,
  // or the size of the group on a group class.
  const heroRight = isPrivate
    ? (cls.student?.name || '')
    : (totalCount > 0 ? `${totalCount} student${totalCount === 1 ? '' : 's'}` : '');

  const attendedLabel = totalCount > 0 ? `${yesCount}/${totalCount}` : (isPrivate ? '1/1' : '—');

  const existingAttendeeIds = new Set(attendees.map(a => a.id));

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <TopBar onBack={() => navigation.goBack()} />

      {/* ── Fixed: dark hero card (matches student-side ClassDetail) ── */}
      <View style={s.heroCard}>
        <HeroCardGradient />
        <View style={s.heroTopRow}>
          <Text style={s.heroDate}>{datePill}</Text>
          {!!heroRight && (
            <Text style={s.heroTeacher} numberOfLines={1} ellipsizeMode="tail">
              {heroRight}
            </Text>
          )}
        </View>
        <View style={s.heroPills}>
          <Pill>{isPrivate ? 'Private' : 'Group'}</Pill>
          {cls.recorded ? <Pill variant="rec">Recorded</Pill> : null}
        </View>
        <Text style={s.heroTitle} numberOfLines={3}>{title}</Text>
        <View style={s.heroStatsRow}>
          {cls.durationMin != null && (
            <View style={[s.heroStat, s.heroStatDivider]}>
              <Text style={s.heroStatN}>{String(cls.durationMin)}</Text>
              <Text style={s.heroStatL}>Min</Text>
            </View>
          )}
          <View style={[s.heroStat, s.heroStatDivider]}>
            <Text style={s.heroStatN}>{String(focusCount)}</Text>
            <Text style={s.heroStatL}>Focus</Text>
          </View>
          <View style={s.heroStat}>
            <Text style={s.heroStatN}>{attendedLabel}</Text>
            <Text style={s.heroStatL}>Attended</Text>
          </View>
        </View>
      </View>

      {/* ── Fixed: tab strip ── */}
      <View style={s.tabsBar}>
        <TabBtn
          label="Summary"
          active={activeTab === 'summary'}
          onPress={() => setActiveTab('summary')}
        />
        <TabBtn
          label="Attendance"
          active={activeTab === 'attendance'}
          badge={mismatchCount > 0 ? mismatchCount : null}
          onPress={() => setActiveTab('attendance')}
        />
        <TabBtn
          label="Notes"
          active={activeTab === 'notes'}
          badge={linkedNotes.length > 0 ? linkedNotes.length : null}
          onPress={() => setActiveTab('notes')}
        />
      </View>

      {/* ── Scrollable: tab content only ── */}
      <ScrollView
        style={s.scrollWrap}
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.tabContent}>
          {activeTab === 'summary' && (
            <SummaryTab cls={cls} isProcessing={isProcessing} />
          )}
          {activeTab === 'attendance' && (
            <AttendanceTab
              attendeesWithStatus={attendeesWithStatus}
              busyStudentId={busyStudentId}
              onSetCoach={handleSetCoach}
              onAdd={() => setStudentPickerOpen(true)}
              isPrivate={isPrivate}
            />
          )}
          {activeTab === 'notes' && (
            <NotesTab
              notes={linkedNotes}
              onOpen={(n) => navigation.navigate('CoachNoteDetail', { noteId: n.id })}
              onUnlink={handleUnlinkNote}
              onLink={() => setNotePickerOpen(true)}
            />
          )}
        </View>
      </ScrollView>

      {activeTab === 'attendance' && pendingCount > 0 && (
        <SaveBar
          count={pendingCount}
          saving={savingAttendance}
          onDiscard={handleDiscardChanges}
          onSave={handleSaveChanges}
        />
      )}

      <StudentPickerModal
        visible={studentPickerOpen}
        existingIds={existingAttendeeIds}
        onClose={() => setStudentPickerOpen(false)}
        onSelect={handleAddStudent}
      />
      <NotePickerModal
        visible={notePickerOpen}
        onClose={() => setNotePickerOpen(false)}
        onSelect={handleLinkExistingNote}
        onCreateNew={handleCreateNoteForClass}
      />
    </SafeAreaView>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function TopBar({ onBack }) {
  return (
    <View style={s.topBar}>
      <TouchableOpacity style={s.iconBtn} onPress={onBack} activeOpacity={0.7}>
        <Ionicons name="chevron-back" size={20} color={INK_950} />
      </TouchableOpacity>
      <View style={{ flex: 1 }} />
    </View>
  );
}

function SaveBar({ count, saving, onDiscard, onSave }) {
  return (
    <View style={s.saveBar} pointerEvents="box-none">
      <View style={s.saveBarPill}>
        <View style={s.saveBarText}>
          <Text style={s.saveBarCount}>
            {count} unsaved change{count > 1 ? 's' : ''}
          </Text>
          <Text style={s.saveBarHint}>Tap save to apply.</Text>
        </View>
        <TouchableOpacity
          onPress={onDiscard}
          disabled={saving}
          activeOpacity={0.7}
          style={s.saveBarDiscard}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        >
          <Text style={s.saveBarDiscardText}>Discard</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onSave}
          disabled={saving}
          activeOpacity={0.85}
          style={[s.saveBarSave, saving && { opacity: 0.7 }]}
        >
          {saving ? (
            <ActivityIndicator size="small" color={INK_950} />
          ) : (
            <Text style={s.saveBarSaveText}>Save changes</Text>
          )}
        </TouchableOpacity>
      </View>
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

function SummaryTab({ cls, isProcessing }) {
  const hasSummary = !!cls.class_summary;
  const hasPracticePoints = !!(cls.practice_point_1 || cls.practice_point_2);
  const hasFocus = !!(cls.ai_primary_focus || cls.ai_secondary_focus);

  if (!hasSummary && !hasPracticePoints && !hasFocus) {
    return (
      <Text style={s.placeholder}>
        {isProcessing
          ? 'Class is still being processed. Summary will appear once transcription completes.'
          : 'No summary yet for this class.'}
      </Text>
    );
  }

  return (
    <>
      {hasSummary && (
        <Section eyebrow="Summary">
          <Text style={s.summaryText}>{cls.class_summary}</Text>
        </Section>
      )}

      {hasPracticePoints && (
        <Section eyebrow="Practice points">
          {cls.practice_point_1 && (
            <View style={s.practiceRow}>
              <View style={s.practiceDot} />
              <Text style={s.practiceText}>{cls.practice_point_1}</Text>
            </View>
          )}
          {cls.practice_point_2 && (
            <View style={s.practiceRow}>
              <View style={s.practiceDot} />
              <Text style={s.practiceText}>{cls.practice_point_2}</Text>
            </View>
          )}
        </Section>
      )}

      {hasFocus && (
        <Section eyebrow="Focus areas">
          {cls.ai_primary_focus && (
            <View style={s.focusChip}>
              <View style={[s.focusBullet, { backgroundColor: GOLD_500 }]} />
              <Text style={s.focusText}>{cls.ai_primary_focus}</Text>
            </View>
          )}
          {cls.ai_secondary_focus && (
            <View style={s.focusChip}>
              <View style={[s.focusBullet, { backgroundColor: GOLD_300 }]} />
              <Text style={s.focusText}>{cls.ai_secondary_focus}</Text>
            </View>
          )}
        </Section>
      )}
    </>
  );
}

function AttendanceTab({
  attendeesWithStatus,
  busyStudentId,
  onSetCoach,
  onRemove,
  onAdd,
  isPrivate,
}) {
  if (attendeesWithStatus.length === 0) {
    return (
      <View style={s.emptyState}>
        <Text style={s.placeholder}>No students recorded for this class yet.</Text>
        {!isPrivate && (
          <TouchableOpacity style={s.bigAddBtn} onPress={onAdd} activeOpacity={0.85}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={s.bigAddBtnText}>Add a student</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <>
      {attendeesWithStatus.map(({ att, status }) => (
        <AttendanceRow
          key={att.id}
          att={att}
          status={status}
          onSetCoach={onSetCoach}
          onRemove={onRemove}
          busy={busyStudentId === att.id}
          showRemove={!isPrivate}
        />
      ))}

      <Text style={s.attHint}>
        {isPrivate
          ? 'Private class — attendance is locked to the booked student.'
          : 'Tap Present or Absent to mark each student. Rows where your mark disagrees with the student’s reply are highlighted.'}
      </Text>

      {!isPrivate && (
        <TouchableOpacity style={s.smallAddBtn} onPress={onAdd} activeOpacity={0.85}>
          <Ionicons name="add" size={14} color={INK_950} />
          <Text style={s.smallAddBtnText}>Add student</Text>
        </TouchableOpacity>
      )}
    </>
  );
}

function NotesTab({ notes, onOpen, onUnlink, onLink }) {
  return (
    <>
      <TouchableOpacity style={s.linkNoteBtn} onPress={onLink} activeOpacity={0.85}>
        <Ionicons name="link-outline" size={16} color={INK_950} />
        <Text style={s.linkNoteBtnText}>Link a note</Text>
      </TouchableOpacity>
      {notes.length === 0 ? (
        <Text style={s.placeholder}>No notes linked to this class yet.</Text>
      ) : (
        notes.map(note => (
          <View key={note.id} style={s.noteRow}>
            <TouchableOpacity
              style={{ flex: 1, minWidth: 0 }}
              onPress={() => onOpen(note)}
              activeOpacity={0.75}
            >
              <Text style={s.noteTitle} numberOfLines={1}>
                {note.title || 'Untitled'}
              </Text>
              {note.content ? (
                <Text style={s.notePreview} numberOfLines={2}>
                  {note.content}
                </Text>
              ) : null}
              <Text style={s.noteDate}>
                {relativeDate(note.updated_at || note.created_at)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onUnlink(note)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ paddingLeft: 8 }}
            >
              <Ionicons name="unlink-outline" size={18} color={FG_3} />
            </TouchableOpacity>
          </View>
        ))
      )}
    </>
  );
}

function Section({ eyebrow, children }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionEyebrow}>{eyebrow}</Text>
      {children}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: INK_50 },

  // Top bar — large rounded-square buttons matching the mockup
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 14,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },

  // Outer ScrollView wrapper. flex:1 makes it fill the space left under
  // the fixed hero + tab strip so the inner content can scroll.
  scrollWrap: {
    flex: 1,
  },
  scroll: {
    // Padded so the last attendance row never sits underneath the floating
    // Save bar that pops up when there are unsaved changes.
    paddingBottom: 120,
  },

  // ── Hero card (dark) — copied 1:1 from src/screens/ClassDetailScreen.js ──
  heroCard: {
    marginHorizontal: Spacing.side,
    marginBottom: 4,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(240,194,74,0.28)',
    overflow: 'hidden',
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
    color: '#F6D27A',
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

  // ── Pills (inside hero) — copied from student-side ──
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
  pillText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 8.5,
    color: 'rgba(255,255,255,0.72)',
    letterSpacing: 0.3,
  },
  pillTextRec: {
    color: '#FF8C8C',
  },

  // ── Tabs ──
  tabsBar: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.side,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
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
    color: FG_3,
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

  // ── Tab content ──
  tabContent: {
    paddingHorizontal: Spacing.side,
  },

  // Section blocks (Summary tab)
  section: {
    marginBottom: 24,
  },
  sectionEyebrow: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: FG_2,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  summaryText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: INK_950,
    lineHeight: 24,
  },
  placeholder: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: FG_2,
    fontStyle: 'italic',
    lineHeight: 20,
  },

  // Practice points
  practiceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: LINE_2,
  },
  practiceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: SUCCESS,
    marginTop: 7,
    flexShrink: 0,
  },
  practiceText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: INK_950,
    flex: 1,
    lineHeight: 21,
  },

  // Focus chips
  focusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: LINE_2,
  },
  focusBullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  focusText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 14,
    color: INK_950,
    flex: 1,
  },

  // Attendance tab
  attHint: {
    marginTop: 14,
    paddingHorizontal: 4,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: FG_2,
    lineHeight: 19,
  },
  smallAddBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(232,181,48,0.20)',
    marginTop: 14,
  },
  smallAddBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: INK_950,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  emptyState: {
    alignItems: 'center',
    paddingVertical: 30,
    gap: 12,
  },
  bigAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: INK_950,
  },
  bigAddBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#fff',
    letterSpacing: 0.6,
  },

  // Notes tab
  linkNoteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.65)',
    borderWidth: 1,
    borderColor: LINE,
    marginBottom: 12,
  },
  linkNoteBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
    color: INK_950,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: PAPER,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: LINE,
    marginBottom: 8,
    gap: 8,
  },
  noteTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: INK_950,
    letterSpacing: -0.2,
  },
  notePreview: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12.5,
    color: FG_2,
    lineHeight: 18,
    marginTop: 2,
  },
  noteDate: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 10,
    color: FG_3,
    marginTop: 4,
  },

  errorWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: FG_2,
  },

  // Floating "Save changes" bar that surfaces when the coach has staged
  // attendance edits. Sits over the scroll area; tapping Save commits all
  // edits to the server in one pass (and triggers FP cleanup for any row
  // moved to Absent).
  saveBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    paddingHorizontal: 12,
  },
  saveBarPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: INK_950,
    borderRadius: 18,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 8,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
    elevation: 10,
  },
  saveBarText: {
    flex: 1,
    minWidth: 0,
  },
  saveBarCount: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#fff',
    letterSpacing: -0.2,
  },
  saveBarHint: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 1,
  },
  saveBarDiscard: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  saveBarDiscardText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.2,
  },
  saveBarSave: {
    minWidth: 130,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: GOLD_500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBarSaveText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
    color: INK_950,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});

const picker = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '78%',
    paddingBottom: 32,
    paddingTop: 10,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: 'rgba(17,12,17,0.12)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: LINE,
  },
  title: { fontFamily: Fonts.jakartaExtraBold, fontSize: 16, color: INK_950 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 14,
    marginBottom: 8,
    backgroundColor: 'rgba(46,46,46,0.04)',
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 44,
  },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: INK_950,
    padding: 0,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: LINE_2,
    gap: 12,
  },
  itemAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#F0F0F0',
  },
  itemAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  itemAvatarText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: INK_950,
  },
  itemName: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: INK_950,
  },
  itemSub: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: FG_2,
    marginTop: 1,
  },
  empty: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: FG_2,
    textAlign: 'center',
    paddingVertical: 30,
  },
  createNew: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,157,0,0.10)',
    borderRadius: 14,
  },
  createNewText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: Colors.orange,
  },
  noteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: LINE_2,
    gap: 8,
  },
  noteTitle: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: INK_950,
  },
  noteContent: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: FG_2,
    marginTop: 3,
    lineHeight: 17,
  },
  noteDate: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 10,
    color: FG_3,
    marginTop: 4,
  },
});
