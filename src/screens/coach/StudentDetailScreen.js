import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../../theme';
import {
  getStudentProfile,
  getStudentFocusPoints,
  getStudentRecentActivity,
  getStudentQuestions,
  getStudentPendingValidations,
  getStudentArchivedFocusPoints,
  replyToQuestion,
  dismissQuestion,
  respondToFocusCompletion,
  respondToFlaggedFocus,
  updateFocusPoint,
} from '../../storage/coachStorage';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeDate(date) {
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function practiceLabel(count) {
  if (count === 0) return 'Not practiced yet this week';
  if (count === 1) return 'Practiced 1× this week';
  return `Practiced ${count}× this week`;
}

// ─── Focus Card ───────────────────────────────────────────────────────────────

function FocusCard({ focus, onEdit }) {
  const hasPending = !!focus.validationPending;
  const isCompletion = focus.validationPending?.type === 'completion';
  const isFlagged = focus.validationPending?.type === 'flagged';

  return (
    <TouchableOpacity style={[fc.card, hasPending && fc.cardHighlighted]} onPress={onEdit} activeOpacity={0.75}>
      <View style={fc.row}>
        <Text style={fc.name}>{focus.name}</Text>
        {isCompletion && (
          <View style={[fc.badge, fc.completionBadge]}>
            <Text style={[fc.badgeText, fc.completionBadgeText]}>✓</Text>
          </View>
        )}
        {isFlagged && (
          <View style={[fc.badge, fc.flaggedBadge]}>
            <Text style={[fc.badgeText, fc.flaggedBadgeText]}>!</Text>
          </View>
        )}
        <Text style={fc.editHint}>Edit</Text>
      </View>
      <Text style={fc.sub}>{practiceLabel(focus.weekCount)}</Text>
      {!!focus.coachNote && (
        <Text style={fc.notePreview} numberOfLines={1}>{focus.coachNote}</Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Focus Edit Sheet ─────────────────────────────────────────────────────────

function FocusEditSheet({ focus, visible, onClose, onSave }) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible && focus) {
      setName(focus.name || '');
      setNote(focus.coachNote || '');
    }
  }, [visible, focus]);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    await onSave(focus.id, { name: name.trim(), coach_note: note.trim() || null });
    setSaving(false);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={es.overlay} onPress={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
          <Pressable style={es.sheet} onPress={() => {}}>
            <View style={es.handle} />
            <Text style={es.title}>Edit Focus Point</Text>

            <Text style={es.label}>NAME</Text>
            <TextInput
              style={es.input}
              value={name}
              onChangeText={setName}
              placeholder="Focus point name"
              placeholderTextColor="rgba(13,13,18,0.3)"
              returnKeyType="next"
              maxLength={80}
            />

            <Text style={es.label}>COACH NOTE</Text>
            <TextInput
              style={[es.input, es.inputMulti]}
              value={note}
              onChangeText={setNote}
              placeholder="Add a tip or instruction for your student…"
              placeholderTextColor="rgba(13,13,18,0.3)"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              maxLength={300}
            />

            <TouchableOpacity
              style={[es.saveBtn, (!name.trim() || saving) && es.saveBtnDisabled]}
              onPress={handleSave}
              activeOpacity={0.8}
            >
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={es.saveBtnText}>Save</Text>
              }
            </TouchableOpacity>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

// ─── Activity Row ─────────────────────────────────────────────────────────────

function ActivityRow({ event }) {
  const label = event.type === 'class' ? 'Logged a class' : 'Training session';
  const detail = event.durationMin ? `${event.durationMin} min` : '';
  return (
    <View style={ar.row}>
      <View style={ar.dot} />
      <Text style={ar.date}>{formatRelativeDate(event.date)}</Text>
      <Text style={ar.sep}>–</Text>
      <Text style={ar.label}>{label}</Text>
      {!!detail && <Text style={ar.detail}>{detail}</Text>}
    </View>
  );
}

// ─── Validation Sheet ─────────────────────────────────────────────────────────

function ValidationSheet({ visible, validation, studentName, onClose, onDone }) {
  const insets = useSafeAreaInsets();
  const [acting, setActing] = useState(false);

  if (!validation) return null;

  const isCompletion = validation.type === 'completion';

  async function act(action) {
    setActing(true);
    if (isCompletion) {
      await respondToFocusCompletion(validation.id, action === 'approve');
    } else {
      await respondToFlaggedFocus(validation.id, action);
    }
    setActing(false);
    onDone();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={sh.overlay} onPress={onClose}>
        <Pressable style={[sh.sheet, { paddingBottom: insets.bottom + 20 }]} onPress={() => {}}>
          <View style={sh.handle} />

          {isCompletion ? (
            <>
              <Text style={sh.title}>{studentName} thinks she's got this</Text>
              <View style={sh.focusCard}>
                <Text style={sh.focusName}>{validation.focusName}</Text>
              </View>
              <Text style={sh.body}>
                Does this match what you saw in your last lesson?
              </Text>
              {acting ? (
                <ActivityIndicator color={Colors.secondary} style={{ marginTop: 20 }} />
              ) : (
                <View style={sh.btnRow}>
                  <TouchableOpacity style={[sh.btn, sh.btnGreen]} onPress={() => act('approve')} activeOpacity={0.85}>
                    <Text style={[sh.btnText, sh.btnGreenText]}>Yes, close this focus</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[sh.btn, sh.btnOutline]} onPress={() => act('reject')} activeOpacity={0.85}>
                    <Text style={[sh.btnText, sh.btnOutlineText]}>Keep working on it</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          ) : (
            <>
              <Text style={sh.title}>{studentName} flagged a focus</Text>
              <View style={sh.focusCard}>
                <Text style={sh.focusName}>{validation.focusName}</Text>
                {!!validation.studentNote && (
                  <Text style={sh.focusSub}>"{validation.studentNote}"</Text>
                )}
              </View>
              {acting ? (
                <ActivityIndicator color={Colors.secondary} style={{ marginTop: 20 }} />
              ) : (
                <View style={sh.flagActions}>
                  <TouchableOpacity style={sh.flagBtn} onPress={() => act('keep')} activeOpacity={0.85}>
                    <Text style={sh.flagBtnText}>This focus is correct, keep going</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={sh.flagBtn} onPress={() => act('address')} activeOpacity={0.85}>
                    <Text style={sh.flagBtnText}>I'll address this next lesson</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => act('dismiss')} activeOpacity={0.7}>
                    <Text style={sh.dismissText}>Dismiss this focus</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Question Sheet ───────────────────────────────────────────────────────────

function QuestionSheet({ visible, question, onClose, onDone }) {
  const insets = useSafeAreaInsets();
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  async function handleReply() {
    if (!reply.trim()) return;
    setSending(true);
    await replyToQuestion(question.id, reply.trim());
    setSending(false);
    setReply('');
    onDone();
  }

  async function handleDismiss() {
    await dismissQuestion(question.id);
    onDone();
  }

  if (!question) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={sh.overlay} onPress={onClose}>
          <Pressable style={[sh.sheet, { paddingBottom: insets.bottom + 20 }]} onPress={() => {}}>
            <View style={sh.handle} />
            <Text style={sh.title}>Question from student</Text>

            <View style={qs.bubble}>
              <Text style={qs.bubbleText}>{question.message}</Text>
            </View>

            <View style={qs.inputRow}>
              <TextInput
                style={qs.input}
                value={reply}
                onChangeText={setReply}
                placeholder="Type your reply…"
                placeholderTextColor={Colors.secondary}
                multiline
                maxLength={500}
              />
              <TouchableOpacity
                style={[qs.sendBtn, !reply.trim() && qs.sendBtnDisabled]}
                onPress={handleReply}
                disabled={sending || !reply.trim()}
                activeOpacity={0.8}
              >
                {sending
                  ? <ActivityIndicator color={Colors.white} size="small" />
                  : <Text style={qs.sendIcon}>↑</Text>
                }
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={qs.dismissBtn} onPress={handleDismiss} activeOpacity={0.7}>
              <Text style={qs.dismissText}>I'll explain in person</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function StudentDetailScreen({ route, navigation }) {
  const { studentId, studentName } = route.params;
  const [profile, setProfile] = useState(null);
  const [focusPoints, setFocusPoints] = useState([]);
  const [activity, setActivity] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [validations, setValidations] = useState([]);
  const [archivedFocuses, setArchivedFocuses] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showAllActivity, setShowAllActivity] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const [activeQuestion, setActiveQuestion] = useState(null);
  const [questionSheetVisible, setQuestionSheetVisible] = useState(false);

  const [activeValidation, setActiveValidation] = useState(null);
  const [validationSheetVisible, setValidationSheetVisible] = useState(false);

  const [editingFocus, setEditingFocus] = useState(null);
  const [focusEditVisible, setFocusEditVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      async function load() {
        setLoading(true);
        const [p, fp, act, qs, vs, arch] = await Promise.all([
          getStudentProfile(studentId),
          getStudentFocusPoints(studentId),
          getStudentRecentActivity(studentId, 8),
          getStudentQuestions(studentId),
          getStudentPendingValidations(studentId),
          getStudentArchivedFocusPoints(studentId),
        ]);
        if (active) {
          setProfile(p);
          setFocusPoints(fp);
          setActivity(act);
          setQuestions(qs);
          setValidations(vs);
          setArchivedFocuses(arch);
          setLoading(false);
        }
      }
      load();
      return () => { active = false; };
    }, [studentId])
  );

  async function reload() {
    const [fp, qs, vs] = await Promise.all([
      getStudentFocusPoints(studentId),
      getStudentQuestions(studentId),
      getStudentPendingValidations(studentId),
    ]);
    setFocusPoints(fp);
    setQuestions(qs);
    setValidations(vs);
  }

  async function handleSaveFocus(focusId, updates) {
    await updateFocusPoint(focusId, updates);
    setFocusPoints(prev => prev.map(fp => fp.id === focusId ? { ...fp, name: updates.name, coachNote: updates.coach_note || null } : fp));
  }

  const displayName = profile?.name || studentName || 'Student';
  const initials = displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const visibleActivity = showAllActivity ? activity : activity.slice(0, 4);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingWrap}>
          <Text style={styles.logo}>EE</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Nav Header */}
      <View style={styles.navHeader}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>{displayName}</Text>
        <View style={styles.navAvatar}>
          <Text style={styles.navAvatarText}>{initials}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Question Banner — shown first if pending */}
        {questions.length > 0 && (
          <TouchableOpacity
            style={qb.card}
            onPress={() => {
              setActiveQuestion(questions[0]);
              setQuestionSheetVisible(true);
            }}
            activeOpacity={0.85}
          >
            <View style={qb.iconWrap}>
              <Text style={qb.icon}>?</Text>
            </View>
            <View style={qb.info}>
              <Text style={qb.label}>
                {questions.length === 1 ? 'Has a question' : `${questions.length} questions`}
              </Text>
              <Text style={qb.preview} numberOfLines={1}>{questions[0].message}</Text>
            </View>
            <Text style={qb.cta}>Reply ›</Text>
          </TouchableOpacity>
        )}

        {/* Working On */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>WORKING ON</Text>
          {focusPoints.length === 0 ? (
            <Text style={styles.emptyLine}>Focus points will appear after your next lesson.</Text>
          ) : (
            focusPoints.map(fp => (
              <FocusCard
                key={fp.id}
                focus={fp}
                onEdit={() => { setEditingFocus(fp); setFocusEditVisible(true); }}
              />
            ))
          )}
        </View>

        {/* Recent Activity */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>RECENT ACTIVITY</Text>
          {activity.length === 0 ? (
            <Text style={styles.emptyLine}>No activity this week.</Text>
          ) : (
            <>
              {visibleActivity.map((ev, i) => <ActivityRow key={ev.id + i} event={ev} />)}
              {activity.length > 4 && (
                <TouchableOpacity onPress={() => setShowAllActivity(v => !v)} activeOpacity={0.7}>
                  <Text style={styles.seeMore}>{showAllActivity ? 'Show less' : 'See more'}</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        {/* Pending Action Cards */}
        {validations.length > 0 && (
          <View style={styles.section}>
            {validations.map(v => (
              <TouchableOpacity
                key={v.id}
                style={ac.card}
                onPress={() => {
                  setActiveValidation(v);
                  setValidationSheetVisible(true);
                }}
                activeOpacity={0.85}
              >
                <View style={ac.bar} />
                <View style={ac.body}>
                  <Text style={ac.title}>
                    {v.type === 'completion'
                      ? `${displayName} thinks she's got this`
                      : `${displayName} flagged a focus`}
                  </Text>
                  <Text style={ac.focusName}>{v.focusName}</Text>
                  {!!v.studentNote && (
                    <Text style={ac.note}>"{v.studentNote}"</Text>
                  )}
                  <Text style={ac.tap}>Tap to respond ›</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Previous Focuses */}
        {archivedFocuses.length > 0 && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.sectionToggleRow}
              onPress={() => setShowArchived(v => !v)}
              activeOpacity={0.7}
            >
              <Text style={styles.sectionLabel}>PREVIOUS FOCUSES</Text>
              <Text style={styles.seeMore}>{showArchived ? 'hide' : 'show'}</Text>
            </TouchableOpacity>
            {showArchived && (
              <View style={pf.wrap}>
                {archivedFocuses.map(f => (
                  <View key={f.id} style={pf.chip}>
                    <Text style={pf.chipText}>{f.name}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

      </ScrollView>

      {/* Sheets */}
      <QuestionSheet
        visible={questionSheetVisible}
        question={activeQuestion}
        onClose={() => setQuestionSheetVisible(false)}
        onDone={() => {
          setQuestionSheetVisible(false);
          reload();
        }}
      />

      <ValidationSheet
        visible={validationSheetVisible}
        validation={activeValidation}
        studentName={displayName}
        onClose={() => setValidationSheetVisible(false)}
        onDone={() => {
          setValidationSheetVisible(false);
          reload();
        }}
      />

      <FocusEditSheet
        focus={editingFocus}
        visible={focusEditVisible}
        onClose={() => setFocusEditVisible(false)}
        onSave={handleSaveFocus}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: { fontFamily: Fonts.monument, fontSize: 20, color: Colors.black, letterSpacing: 1 },

  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingTop: 12,
    paddingBottom: 16,
  },
  backBtn: { marginRight: 12 },
  backText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 24,
    color: Colors.black,
    lineHeight: 28,
  },
  navTitle: {
    flex: 1,
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: Colors.black,
    textAlign: 'center',
  },
  navAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(196,96,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  navAvatarText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: Colors.activeHome,
  },

  content: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 100,
  },
  section: { marginBottom: 28 },
  sectionLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: Colors.secondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  sectionToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  emptyLine: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    fontStyle: 'italic',
  },
  seeMore: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: Colors.secondary,
    marginTop: 8,
  },
});

const fc = StyleSheet.create({
  card: {
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
  },
  cardHighlighted: {
    borderColor: 'rgba(255,157,0,0.3)',
    backgroundColor: 'rgba(255,157,0,0.04)',
  },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  name: {
    flex: 1,
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 15,
    color: Colors.black,
  },
  sub: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
  },
  badge: {
    width: 20,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  badgeText: { fontFamily: Fonts.jakartaExtraBold, fontSize: 10 },
  completionBadge: { backgroundColor: 'rgba(76,175,80,0.12)' },
  completionBadgeText: { color: Colors.green },
  flaggedBadge: { backgroundColor: 'rgba(255,157,0,0.12)' },
  flaggedBadgeText: { color: Colors.orange },
  editHint: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.secondary,
    marginLeft: 8,
  },
  notePreview: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.activeFocus,
    marginTop: 4,
    fontStyle: 'italic',
  },
});

const es = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 36,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(13,13,18,0.15)',
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: Colors.black,
    marginBottom: 20,
  },
  label: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: Colors.secondary,
    letterSpacing: 0.6,
    marginBottom: 6,
    marginTop: 14,
  },
  input: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: Colors.black,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.statCardBg,
  },
  inputMulti: {
    minHeight: 80,
    paddingTop: 10,
  },
  saveBtn: {
    marginTop: 24,
    backgroundColor: Colors.black,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: Colors.white,
  },
});

const ar = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.statCardBorder,
  },
  date: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: Colors.secondary,
    width: 80,
  },
  sep: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.statCardBorder,
  },
  label: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.black,
    flex: 1,
  },
  detail: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
  },
});

const qb = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(33,150,243,0.06)',
    borderWidth: 0.5,
    borderColor: 'rgba(33,150,243,0.18)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 24,
    gap: 12,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(33,150,243,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: Colors.activeFocus,
  },
  info: { flex: 1 },
  label: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 14,
    color: Colors.black,
    marginBottom: 2,
  },
  preview: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
  },
  cta: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: Colors.activeFocus,
  },
});

const ac = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,157,0,0.05)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,157,0,0.22)',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 10,
  },
  bar: {
    width: 3,
    backgroundColor: Colors.orange,
  },
  body: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  title: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 14,
    color: Colors.black,
    marginBottom: 4,
  },
  focusName: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: Colors.secondary,
    marginBottom: 2,
  },
  note: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
    fontStyle: 'italic',
    marginBottom: 6,
  },
  tap: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12,
    color: Colors.orange,
    marginTop: 4,
  },
});

const pf = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
  },
  chipText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: 'rgba(17,12,17,0.45)',
  },
});

const sh = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: 'rgba(17,12,17,0.12)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 24,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: Colors.black,
    marginBottom: 16,
  },
  focusCard: {
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 16,
  },
  focusName: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 15,
    color: Colors.black,
  },
  focusSub: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    marginTop: 4,
    fontStyle: 'italic',
  },
  body: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.secondary,
    marginBottom: 20,
    lineHeight: 20,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  btn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
  },
  btnGreen: { backgroundColor: Colors.green },
  btnGreenText: { color: Colors.white },
  btnOutline: {
    borderWidth: 1,
    borderColor: Colors.statCardBorder,
    backgroundColor: Colors.statCardBg,
  },
  btnOutlineText: { color: Colors.black },
  flagActions: { gap: 10 },
  flagBtn: {
    borderWidth: 1,
    borderColor: Colors.statCardBorder,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: Colors.statCardBg,
  },
  flagBtnText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: Colors.black,
  },
  dismissText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    textAlign: 'center',
    paddingVertical: 10,
  },
});

const qs = StyleSheet.create({
  bubble: {
    backgroundColor: 'rgba(33,150,243,0.07)',
    borderWidth: 0.5,
    borderColor: 'rgba(33,150,243,0.2)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 16,
  },
  bubbleText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.black,
    lineHeight: 20,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.black,
    minHeight: 46,
    maxHeight: 120,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.activeFocus,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: Colors.statCardBorder,
  },
  sendIcon: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: Colors.white,
  },
  dismissBtn: { paddingVertical: 8, alignItems: 'center' },
  dismissText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: Colors.secondary,
  },
});
