import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  LayoutAnimation,
  Platform,
  UIManager,
  Alert,
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const EXPAND_ANIMATION = {
  duration: 220,
  update: { type: LayoutAnimation.Types.easeInEaseOut },
  create: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
};
import { Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fonts, Spacing } from '../../theme';
import { useCoachData } from '../../context/CoachDataContext';
import {
  getPendingFocusPoints,
  approveFocusPoint,
  editAndApproveFocusPoint,
  approveAllPendingForStudent,
  rejectPendingFocusPoint,
  getReconcileNeeded,
  applyReconcile,
  getPendingQuestions,
} from '../../storage/coachStorage';
import {
  getPendingCoupleFocusPoints,
  approveCoupleFocusPoint,
  rejectCoupleFocusPoint,
  approveAllPendingCoupleFocusPoints,
} from '../../storage/coupleStorage';
import FocusPointEditSheet from '../../components/FocusPointEditSheet';
import QuestionSheet, { splitFocusTag } from '../../components/coach/QuestionSheet';
import { dateLabel } from '../../components/coach/LessonUI';
import { getQuestionContext } from '../../storage/coachStorage';
import ClassContextSheet from '../../components/coach/ClassContextSheet';
import ApproveConfirmSheet from '../../components/coach/ApproveConfirmSheet';
import MergeCompareCard from '../../components/coach/MergeCompareCard';
import PendingFocusCard from '../../components/coach/PendingFocusCard';
import RejectFocusSheet from '../../components/coach/RejectFocusSheet';
import ReconcileFocusSheet from '../../components/coach/ReconcileFocusSheet';
import { SkeletonBox } from '../../components/Skeleton';
import { supabase } from '../../services/supabase/client';

function daysAgoLabel(date) {
  const n = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}

// ── Palette ────────────────────────────────────────────────────────────────
const INK = '#0A0A0A';
const INK_62 = 'rgba(10,10,10,0.62)';
const PAGE = '#F2F0EB';
const GOLD = '#E8B530';
const RED = '#A8412F';

// ════════════════════════════════════════════════════════════════════════════
export default function ActionNeededScreen({ navigation, route }) {
  const { students, refresh } = useCoachData();
  const [expandedId, setExpandedId] = useState(null);

  // Focus points
  const [pendingFPs, setPendingFPs] = useState([]);
  const [pendingCoupleFPs, setPendingCoupleFPs] = useState([]);
  const [fpLoading, setFpLoading] = useState(true);
  const [editingFp, setEditingFp] = useState(null);
  const [rejectingFp, setRejectingFp] = useState(null);
  const [contextFp, setContextFp] = useState(null);
  const [approvingFp, setApprovingFp] = useState(null);

  // Merge requests
  const [mergeRequests, setMergeRequests] = useState([]);

  // Questions students asked
  const [questions, setQuestions] = useState([]);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [questionSheetVisible, setQuestionSheetVisible] = useState(false);
  const [questionReply, setQuestionReply] = useState('');

  const [comparing, setComparing] = useState(null); // { mr, existing, incoming }
  // The focus point a question was asked from, opened from the question itself.
  const [focusPopup, setFocusPopup] = useState(null); // { name, ctx } — ctx null while loading
  // What the coach got through in this sitting — shown once nothing is left.
  const [done, setDone] = useState({ approved: 0, answered: 0, merged: 0 });
  const [reconcileGroups, setReconcileGroups] = useState([]);
  const [reconciling, setReconciling] = useState(null);
  const [coachName, setCoachName] = useState('your coach');

  const studentMap = {};
  for (const s of students) studentMap[s.id] = s;

  const loadData = useCallback(async () => {
    setFpLoading(true);
    try {
      const [fps, coupleFps, qs, { data: merges }] = await Promise.all([
        getPendingFocusPoints(null).catch(() => []),
        getPendingCoupleFocusPoints().catch(() => []),
        getPendingQuestions().catch(() => []),
        supabase
          .from('merge_requests')
          .select('id, student_id, focus_a, focus_b, status, created_at')
          .eq('status', 'pending_coach')
          .order('created_at', { ascending: false }),
      ]);
      setPendingFPs(fps || []);
      setPendingCoupleFPs(coupleFps || []);
      setQuestions(qs || []);

      // Enrich merge requests with focus point names
      const mrList = merges || [];
      if (mrList.length > 0) {
        const fpIds = [...new Set(mrList.flatMap(m => [m.focus_a, m.focus_b]))];
        const { data: fpRows } = await supabase
          .from('focus_points')
          .select('id, name, user_id, subtitle, context, dance, drill, tier, category, created_at, class_input_id, source_class_input_id')
          .in('id', fpIds);
        // What each one has cost the student so far — the card weighs the two
        // by their practice, so "Merge" doesn't quietly throw sessions away.
        const { data: logs } = await supabase
          .from('practice_logs')
          .select('focus_point_id, duration_minutes, completed_at')
          .in('focus_point_id', fpIds)
          .not('completed_at', 'is', null);
        const practice = {};
        for (const l of logs || []) {
          const p = practice[l.focus_point_id] || { count: 0, minutes: 0 };
          p.count += 1;
          p.minutes += l.duration_minutes || 0;
          practice[l.focus_point_id] = p;
        }
        const fpMap = {};
        for (const fp of fpRows || []) {
          fpMap[fp.id] = {
            ...fp,
            practiceCount: practice[fp.id]?.count || 0,
            practiceMinutes: practice[fp.id]?.minutes || 0,
          };
        }
        setMergeRequests(mrList.map(m => ({
          ...m,
          focusA: fpMap[m.focus_a] || null,
          focusB: fpMap[m.focus_b] || null,
          focusAName: fpMap[m.focus_a]?.name || '?',
          focusBName: fpMap[m.focus_b]?.name || '?',
        })));
      } else {
        setMergeRequests([]);
      }
    } catch {}
    setFpLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Reconciliation groups (students with >3 active focus points → keep 3).
  const loadReconcile = useCallback(() => {
    const ids = students.map((s) => s.id);
    if (ids.length === 0) { setReconcileGroups([]); return; }
    getReconcileNeeded(ids).then(setReconcileGroups).catch(() => setReconcileGroups([]));
  }, [students]);
  useEffect(() => { loadReconcile(); }, [loadReconcile]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const uid = data?.session?.user?.id;
      if (!uid) return;
      supabase.from('users').select('name').eq('id', uid).single()
        .then(({ data: u }) => { if (u?.name) setCoachName(u.name); });
    }).catch(() => {});
  }, []);

  // Actions. Group focus points are aggregated in the UI (1 card per
  // shared_group_id), so handlers must operate on all underlying rows when
  // an aggregate is passed via `_rows`.
  const handleApprove = async (fpId) => {
    try {
      await approveFocusPoint(fpId);
      setPendingFPs(prev => prev.filter(fp => fp.id !== fpId));
      setDone((d) => ({ ...d, approved: d.approved + 1 }));
      refresh();
    } catch {}
  };

  const handleApproveGroup = async (rowIds) => {
    try {
      await Promise.all(rowIds.map(id => approveFocusPoint(id)));
      const set = new Set(rowIds);
      setPendingFPs(prev => prev.filter(fp => !set.has(fp.id)));
      setDone((d) => ({ ...d, approved: d.approved + 1 }));
      refresh();
    } catch {}
  };

  // Approve flow goes through a confirmation modal: tapping "Approve" on a
  // card opens the sheet via openApprove*, and the sheet's "Yes, send"
  // button calls handleConfirmApprove below.
  const openApproveForSolo = (fp) => {
    const student = studentMap[fp.user_id];
    setApprovingFp({ ...fp, _studentNames: student ? [student.name] : [] });
  };

  const openApproveForGroup = (agg) => {
    setApprovingFp({ ...agg, _isGroup: true });
  };

  const handleConfirmApprove = async () => {
    if (!approvingFp) return;
    if (approvingFp._rows) {
      await handleApproveGroup(approvingFp._rows.map(r => r.id));
    } else {
      await handleApprove(approvingFp.id);
    }
    setApprovingFp(null);
  };

  const handleReject = (fp) => {
    setRejectingFp(fp);
  };

  const handleConfirmReject = async (reason) => {
    if (!rejectingFp) return;
    const rows = rejectingFp._rows || [{ id: rejectingFp.id, user_id: rejectingFp.user_id }];
    try {
      await Promise.all(rows.map(r => rejectPendingFocusPoint({
        fpId: r.id,
        studentId: r.user_id,
        fpName: rejectingFp.name,
        reason,
      })));
      const set = new Set(rows.map(r => r.id));
      setPendingFPs(prev => prev.filter(fp => !set.has(fp.id)));
      setRejectingFp(null);
      refresh();
    } catch {}
  };

  const handleSaveEdit = async (fpId, updates) => {
    const rowIds = editingFp?._rows ? editingFp._rows.map(r => r.id) : [fpId];
    try {
      await Promise.all(rowIds.map(id => editAndApproveFocusPoint(id, updates)));
      const set = new Set(rowIds);
      setPendingFPs(prev => prev.filter(fp => !set.has(fp.id)));
      setEditingFp(null);
      refresh();
    } catch {}
  };

  const handleApproveAll = async () => {
    try {
      const studentIds = [...new Set(pendingFPs.map(fp => fp.user_id).filter(Boolean))];
      await Promise.all(studentIds.map(id => approveAllPendingForStudent(id)));
      setPendingFPs([]);
      const coupleIds = [...new Set(pendingCoupleFPs.map(fp => fp.couple_id).filter(Boolean))];
      await Promise.all(coupleIds.map(id => approveAllPendingCoupleFocusPoints(id)));
      setPendingCoupleFPs([]);
      refresh();
    } catch {}
  };

  // ── Couple focus point review ──
  const handleApproveCouple = async (fp) => {
    try {
      await approveCoupleFocusPoint(fp.id);
      setPendingCoupleFPs(prev => prev.filter(x => x.id !== fp.id));
      refresh();
    } catch {}
  };

  const handleRejectCouple = (fp) => {
    Alert.alert(
      'Decline couple focus?',
      `"${fp.name}" won't be shown to ${fp.coupleName || 'the couple'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            try {
              await rejectCoupleFocusPoint({ fpId: fp.id, coupleId: fp.couple_id, fpName: fp.name });
              setPendingCoupleFPs(prev => prev.filter(x => x.id !== fp.id));
              refresh();
            } catch {}
          },
        },
      ],
    );
  };

  const openQuestionFocus = (q, focusName) => {
    setFocusPopup({ name: focusName, ctx: null });
    getQuestionContext(q.student_id, focusName)
      .then((ctx) => setFocusPopup((p) => (p && p.name === focusName ? { ...p, ctx } : p)))
      .catch(() => setFocusPopup((p) => (p ? { ...p, ctx: { focus: null } } : p)));
  };

  const handleMerge = async (mr) => {
    try {
      // Keep focus_a, delete focus_b, mark merged. Carry focus_b's
      // class_input_id onto focus_a so the readiness card anchors to the
      // class that surfaced this merge (otherwise focus_a stays pinned to
      // its original creation class and disappears from the latest
      // private's checklist). source_class_input_id locks the original
      // creation class — backfilled from focus_a.class_input_id for legacy
      // rows where it was never set.
      const a = mr.focusA;
      const b = mr.focusB;
      if (a && b?.class_input_id) {
        await supabase
          .from('focus_points')
          .update({
            class_input_id: b.class_input_id,
            source_class_input_id: a.source_class_input_id ?? a.class_input_id ?? b.class_input_id,
          })
          .eq('id', mr.focus_a);
      }
      await supabase.from('focus_points').update({ is_deleted: true, status: 'past' }).eq('id', mr.focus_b);
      await supabase.from('merge_requests').update({ status: 'merged', resolved_at: new Date().toISOString(), resolved_by: 'coach' }).eq('id', mr.id);
      setMergeRequests(prev => prev.filter(m => m.id !== mr.id));
      setDone((d) => ({ ...d, merged: d.merged + 1 }));
      refresh();
    } catch {}
  };

  const handleRejectMerge = async (mr) => {
    try {
      // "Keep both" means the new (incoming) focus point is NOT a duplicate
      // after all, so send it through the normal coach review flow: bump it
      // to pending_coach with a fresh deadline. The older (existing) one is
      // left alone — it's already published.
      const a = mr.focusA;
      const b = mr.focusB;
      const olderFirst = a && b && new Date(a.created_at) <= new Date(b.created_at);
      const incoming = olderFirst ? b : a;

      if (incoming) {
        const deadline = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        await supabase
          .from('focus_points')
          .update({ status: 'pending_coach', coach_review_deadline: deadline })
          .eq('id', incoming.id);
      }

      await supabase.from('merge_requests')
        .update({ status: 'rejected', resolved_at: new Date().toISOString(), resolved_by: 'coach' })
        .eq('id', mr.id);
      setMergeRequests(prev => prev.filter(m => m.id !== mr.id));
      loadData();
      refresh();
    } catch {}
  };

  // ── What's waiting, in the order the coach should meet it ────────────────
  // Group focus points sharing a shared_group_id are one card listing the
  // whole group, not one card per student row.
  const groupAggMap = new Map();
  for (const fp of pendingFPs) {
    if (!fp.group_fp) continue;
    const key = fp.shared_group_id || `single-${fp.id}`;
    if (!groupAggMap.has(key)) groupAggMap.set(key, { ...fp, _rows: [], _students: [] });
    const agg = groupAggMap.get(key);
    agg._rows.push({ id: fp.id, user_id: fp.user_id });
    const student = studentMap[fp.user_id];
    if (student) agg._students.push(student);
  }
  const groupAggregates = Array.from(groupAggMap.values());
  const soloFPs = pendingFPs.filter((fp) => !fp.group_fp);
  const toValidate = soloFPs.length + groupAggregates.length + pendingCoupleFPs.length;
  const totalCount = toValidate + questions.length + mergeRequests.length + reconcileGroups.length;
  const allClear = !fpLoading && totalCount === 0;

  const expand = (key) => {
    LayoutAnimation.configureNext(EXPAND_ANIMATION);
    setExpandedId(expandedId === key ? null : key);
  };

  const Marker = ({ title, count }) => (
    <View style={s.mk}>
      <Text style={s.mkT}>{title}</Text>
      <View style={s.mkLine} />
      <Text style={s.mkN}>{count}</Text>
    </View>
  );

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.top}>
        <TouchableOpacity style={s.ib} onPress={() => navigation.goBack()} activeOpacity={0.7}
          accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={18} color={INK} />
        </TouchableOpacity>
        <Text style={s.h1} numberOfLines={1}>Action needed</Text>
      </View>

      {!allClear && (
        <View style={s.count}>
          <Text style={s.countN}>{fpLoading && totalCount === 0 ? '—' : totalCount}</Text>
          <Text style={s.countL}>things waiting{'\n'}on you</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={s.feed} showsVerticalScrollIndicator={false}>
        {fpLoading && totalCount === 0 && (
          <View style={{ gap: 10, paddingTop: 18 }}>
            {[0, 1].map((i) => (
              <View key={i} style={s.skel}>
                <SkeletonBox width="45%" height={10} borderRadius={4} />
                <SkeletonBox width="80%" height={22} borderRadius={6} style={{ marginTop: 12 }} />
                <SkeletonBox width="60%" height={12} borderRadius={4} style={{ marginTop: 10 }} />
                <SkeletonBox width="100%" height={48} borderRadius={24} style={{ marginTop: 16 }} />
              </View>
            ))}
          </View>
        )}

        {/* ── Focus points to validate ── */}
        {toValidate > 0 && (
          <>
            <Marker title="To validate" count={toValidate} />
            {groupAggregates.map((agg) => {
              const key = agg.shared_group_id || agg.id;
              return (
                <PendingFocusCard
                  key={`g-${key}`}
                  fp={agg}
                  isExpanded={expandedId === `group-${key}`}
                  onToggle={() => expand(`group-${key}`)}
                  studentName={agg._students.length === 1 ? agg._students[0].name : `${agg._students.length} students`}
                  onApprove={() => openApproveForGroup(agg)}
                  onEdit={() => setEditingFp(agg)}
                  onDelete={() => handleReject(agg)}
                  onShowContext={setContextFp}
                />
              );
            })}
            {soloFPs.map((fp) => (
              <PendingFocusCard
                key={fp.id}
                fp={fp}
                isExpanded={expandedId === `fp-${fp.id}`}
                onToggle={() => expand(`fp-${fp.id}`)}
                studentName={studentMap[fp.user_id]?.name || 'Student'}
                onApprove={() => openApproveForSolo(fp)}
                onEdit={setEditingFp}
                onDelete={handleReject}
                onShowContext={setContextFp}
              />
            ))}
            {pendingCoupleFPs.map((fp) => (
              <PendingFocusCard
                key={`c-${fp.id}`}
                fp={{ ...fp, group_fp: false }}
                isExpanded={expandedId === `couple-${fp.id}`}
                onToggle={() => expand(`couple-${fp.id}`)}
                studentName={fp.coupleName || 'The couple'}
                onApprove={() => handleApproveCouple(fp)}
                onEdit={() => setEditingFp(fp)}
                onDelete={() => handleRejectCouple(fp)}
              />
            ))}
            {toValidate > 1 && (
              <TouchableOpacity style={s.bulk} activeOpacity={0.8} onPress={handleApproveAll} accessibilityRole="button">
                <Text style={s.bulkT}>Approve all {toValidate}</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* ── Questions students asked ── */}
        {questions.length > 0 && (
          <>
            <Marker title="Questions" count={questions.length} />
            {questions.map((q) => {
              const { text, focusName } = splitFocusTag(q.message);
              return (
                <View key={q.id} style={s.qCard}>
                  <View style={s.q}>
                    <Text style={s.qT}>{text || q.message}</Text>
                    <Text style={s.qS}>{q.studentName} · {daysAgoLabel(q.created_at)}</Text>
                  </View>
                  {!!focusName && (
                    <Pressable
                      style={({ pressed }) => [s.fpx, pressed && { backgroundColor: '#F4F2EC' }]}
                      onPress={() => openQuestionFocus(q, focusName)}
                      accessibilityRole="button"
                      accessibilityLabel={`About ${focusName}`}
                    >
                      <View style={s.fpxDot} />
                      <Text style={s.fpxT} numberOfLines={1}>{focusName}</Text>
                      <Ionicons name="chevron-forward" size={13} color="rgba(10,10,10,0.3)" />
                    </Pressable>
                  )}
                  <View style={s.act}>
                    <TouchableOpacity
                      style={s.ok}
                      activeOpacity={0.88}
                      accessibilityRole="button"
                      accessibilityLabel={`See ${q.studentName}'s question`}
                      onPress={() => {
                        if (q.id !== activeQuestion?.id) setQuestionReply('');
                        setActiveQuestion(q);
                        setQuestionSheetVisible(true);
                      }}
                    >
                      <Text style={s.okT}>See</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </>
        )}

        {/* ── Possible duplicates ── */}
        {mergeRequests.length > 0 && (
          <>
            <Marker title="Duplicates" count={mergeRequests.length} />
            {mergeRequests.map((mr) => (
              <MergeCompareCard
                key={mr.id}
                mr={mr}
                studentName={studentMap[mr.student_id]?.name || 'Your student'}
                onMerge={handleMerge}
                onKeepBoth={handleRejectMerge}
                onShowContext={(m, pair) => setComparing({ mr: m, ...pair })}
              />
            ))}
          </>
        )}

        {/* ── Too many focus points at once ── */}
        {reconcileGroups.length > 0 && (
          <>
            <Marker title="Too many focus points" count={reconcileGroups.length} />
            {reconcileGroups.map((g) => {
              const st = studentMap[g.userId];
              const total = 1 + g.candidates.length;
              return (
                <TouchableOpacity
                  key={`${g.userId}:${g.category || 'all'}`}
                  style={s.rec}
                  activeOpacity={0.85}
                  onPress={() => setReconciling(g)}
                  accessibilityRole="button"
                >
                  <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <Text style={s.recName} numberOfLines={1}>{st?.name || 'Student'}</Text>
                    <Text style={s.recSub} numberOfLines={2}>
                      {total} focus points at once{g.category ? ` in ${g.category}` : ''} — keep three.
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color="rgba(10,10,10,0.3)" />
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </ScrollView>

      {/* ── Nothing left ── */}
      {allClear && (
        <View style={s.clear}>
          <View style={s.tick}><Ionicons name="checkmark" size={30} color="#FFFFFF" /></View>
          <Text style={s.clearH}>All clear</Text>
          <Text style={s.clearP}>Thanks for checking everything — your students have it all.</Text>
          {(done.approved > 0 || done.answered > 0 || done.merged > 0) && (
            <View style={s.nums}>
              {[['Approved', done.approved], ['Answered', done.answered], ['Merged', done.merged]]
                .filter(([, n]) => n > 0)
                .map(([label, n]) => (
                  <View key={label} style={{ gap: 6 }}>
                    <Text style={s.numsN}>{n}</Text>
                    <Text style={s.numsL}>{label}</Text>
                  </View>
                ))}
            </View>
          )}
          <TouchableOpacity style={s.out} activeOpacity={0.88} onPress={() => navigation.goBack()} accessibilityRole="button">
            <Text style={s.outT}>Back to your students</Text>
          </TouchableOpacity>
        </View>
      )}

      <QuestionSheet
        visible={questionSheetVisible}
        question={activeQuestion}
        studentId={activeQuestion?.student_id}
        studentName={activeQuestion?.studentName}
        focusPoints={[]}
        reply={questionReply}
        onReplyChange={setQuestionReply}
        onClose={() => setQuestionSheetVisible(false)}
        onDone={() => {
          setQuestionSheetVisible(false);
          setQuestions((prev) => prev.filter((x) => x.id !== activeQuestion?.id));
          setActiveQuestion(null);
          setQuestionReply('');
          setDone((d) => ({ ...d, answered: d.answered + 1 }));
          refresh();
        }}
      />

      <Modal visible={!!editingFp} transparent animationType="fade" onRequestClose={() => setEditingFp(null)}>
        {editingFp && (
          <FocusPointEditSheet
            fp={editingFp}
            onSave={handleSaveEdit}
            onClose={() => setEditingFp(null)}
            saveLabel="Save & Approve"
          />
        )}
      </Modal>

      <RejectFocusSheet
        visible={!!rejectingFp}
        fp={rejectingFp}
        onConfirm={handleConfirmReject}
        onClose={() => setRejectingFp(null)}
      />

      <Modal visible={!!approvingFp} transparent animationType="fade" onRequestClose={() => setApprovingFp(null)}>
        {approvingFp && (
          <ApproveConfirmSheet fp={approvingFp} onConfirm={handleConfirmApprove} onCancel={() => setApprovingFp(null)} />
        )}
      </Modal>

      <ClassContextSheet visible={!!contextFp} fp={contextFp} onClose={() => setContextFp(null)} />

      {!!reconciling && (
          <ReconcileFocusSheet
            visible
            student={{
              name: studentMap[reconciling.userId]?.name || 'Student',
              initials: (studentMap[reconciling.userId]?.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase(),
            }}
            coachName={coachName}
            kept={reconciling.kept}
            candidates={reconciling.candidates}
            onConfirm={async (removedId) => { await applyReconcile(removedId); setReconciling(null); loadReconcile(); loadData(); }}
            onClose={() => setReconciling(null)}
          />
      )}

      {/* The focus point a question came from. */}
      <Modal visible={!!focusPopup} transparent animationType="fade" onRequestClose={() => setFocusPopup(null)}>
        {focusPopup && (
          <FocusPopup popup={focusPopup} onClose={() => setFocusPopup(null)} />
        )}
      </Modal>

      {/* The two focus points, read side by side before merging. */}
      <Modal visible={!!comparing} transparent animationType="fade" onRequestClose={() => setComparing(null)}>
        {comparing && (
          <MergeContextSheet
            pair={comparing}
            studentName={studentMap[comparing.mr.student_id]?.name || 'Your student'}
            onClose={() => setComparing(null)}
            onMerge={() => { const m = comparing.mr; setComparing(null); handleMerge(m); }}
            onKeepBoth={() => { const m = comparing.mr; setComparing(null); handleRejectMerge(m); }}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

// ─── The focus point behind a question ──────────────────────────────────────
function FocusPopup({ popup, onClose }) {
  const ctx = popup.ctx;
  const fp = ctx?.focus || null;
  const lesson = ctx?.lesson || null;
  const rows = !ctx
    ? []
    : [
        fp?.tier ? ['Tier', TIER_LABEL[fp.tier] || 'Focus point'] : null,
        ['Practice', ctx.done > 0 ? `${ctx.done} of ${ctx.target} sessions done` : 'No practice yet'],
        lesson ? ['Set in', `${lesson.title || lesson.dance || 'A lesson'} · ${dateLabel(lesson.created_at)}`] : null,
        fp?.subtitle ? ['The cue', fp.subtitle] : null,
        fp?.drill ? ['Drill', fp.drill] : null,
      ].filter(Boolean);

  return (
    <Pressable style={s.popBack} onPress={onClose}>
      <Pressable style={s.popBox} onPress={() => {}}>
        <Text style={s.popH}>{fp?.name || popup.name}</Text>
        <TouchableOpacity style={s.popCl} onPress={onClose} activeOpacity={0.8}
          accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={14} color={INK} />
        </TouchableOpacity>

        {!ctx ? (
          <View style={{ paddingVertical: 30, alignItems: 'center' }}><ActivityIndicator color={GOLD} /></View>
        ) : !fp ? (
          <Text style={s.popNote}>“{popup.name}” isn’t on their plan any more.</Text>
        ) : (
          <View style={s.sh}>
            {rows.map(([dt, dd]) => (
              <View key={dt}>
                <Text style={s.shDt}>{dt}</Text>
                <Text style={s.shDd}>{dd}</Text>
              </View>
            ))}
          </View>
        )}
      </Pressable>
    </Pressable>
  );
}

const TIER_LABEL = { critical: 'Critical focus', important: 'Important focus', supporting: 'Supporting focus' };

// ─── The two focus points, read side by side ────────────────────────────────
function MergeContextSheet({ pair, studentName, onClose, onMerge, onKeepBoth }) {
  const { existing, incoming } = pair;
  const Section = ({ fp, isNew, rows }) => (
    <View style={s.sh}>
      <View style={s.hh}>
        <View style={s.hhDot} />
        <Text style={s.hhT} numberOfLines={2}>{fp?.name || '—'}</Text>
        {isNew && <Text style={s.hhNew}>New</Text>}
      </View>
      {rows.map(([dt, dd]) => (
        <View key={dt}>
          <Text style={s.shDt}>{dt}</Text>
          <Text style={s.shDd}>{dd}</Text>
        </View>
      ))}
    </View>
  );
  const first = (studentName || 'Your student').split(' ')[0];
  const practice = (fp) => (fp?.practiceCount
    ? `${fp.practiceCount} session${fp.practiceCount === 1 ? '' : 's'}${fp.practiceMinutes ? ` · ${fp.practiceMinutes} min` : ''}`
    : 'Never practised');

  return (
    <Pressable style={s.popBack} onPress={onClose}>
      <Pressable style={s.popBox} onPress={() => {}}>
        <Text style={s.popH}>Same idea?</Text>
        <TouchableOpacity style={s.popCl} onPress={onClose} activeOpacity={0.8}
          accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={14} color={INK} />
        </TouchableOpacity>

        <Section
          fp={existing}
          rows={[
            ['Set in', existing?.created_at ? dateLabel(existing.created_at) : '—'],
            ['Practice', practice(existing)],
            ...(existing?.subtitle ? [['The cue', existing.subtitle]] : []),
            ...(existing?.drill ? [['Drill', existing.drill]] : []),
          ]}
        />
        <Section
          fp={incoming}
          isNew
          rows={[
            ['Set in', incoming?.created_at ? dateLabel(incoming.created_at) : '—'],
            ['Practice', practice(incoming)],
            ...(incoming?.subtitle ? [['The cue', incoming.subtitle]] : []),
            ...(incoming?.drill ? [['Drill', incoming.drill]] : []),
          ]}
        />

        <Text style={s.popNote}>
          {first} keeps <Text style={s.popNoteB}>{existing?.name}</Text>
          {existing?.practiceMinutes ? ` and its ${existing.practiceMinutes} min of practice` : ''}; the new cue is added to it.
        </Text>

        <View style={s.popAct}>
          <TouchableOpacity style={s.ok} activeOpacity={0.88} onPress={onMerge} accessibilityRole="button">
            <Text style={s.okT}>Merge</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.keep} activeOpacity={0.8} onPress={onKeepBoth} accessibilityRole="button">
            <Text style={s.keepT}>Keep both</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Pressable>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAGE },

  top: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: Spacing.side, paddingTop: 2 },
  ib: {
    width: 36, height: 36, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    shadowColor: INK, shadowOpacity: 0.07, shadowOffset: { width: 0, height: 1 }, shadowRadius: 2, elevation: 1,
  },
  h1: { flex: 1, minWidth: 0, fontFamily: Fonts.bold, fontSize: 26, letterSpacing: -1.04, color: INK },

  count: { flexDirection: 'row', alignItems: 'baseline', gap: 9, paddingHorizontal: Spacing.side, paddingTop: 20 },
  countN: { fontFamily: Fonts.extraBold, fontSize: 52, letterSpacing: -2.6, lineHeight: 47, color: RED, fontVariant: ['tabular-nums'] },
  countL: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 17.5, color: INK_62, paddingBottom: 5 },

  feed: { paddingHorizontal: Spacing.side, paddingBottom: 40 },
  mk: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 18, paddingBottom: 9, paddingHorizontal: 2 },
  mkT: { fontFamily: Fonts.semiBold, fontSize: 9.5, letterSpacing: 1.6, textTransform: 'uppercase', color: INK_62 },
  mkLine: { flex: 1, height: 1, backgroundColor: 'rgba(10,10,10,0.12)' },
  mkN: { fontFamily: Fonts.bold, fontSize: 12, color: INK, fontVariant: ['tabular-nums'] },

  skel: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, marginBottom: 10 },

  bulk: { alignSelf: 'flex-start', marginTop: 2, paddingHorizontal: 15, height: 38, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(10,10,10,0.14)', alignItems: 'center', justifyContent: 'center' },
  bulkT: { fontFamily: Fonts.semiBold, fontSize: 12.5, color: 'rgba(10,10,10,0.68)' },

  // Questions
  qCard: { backgroundColor: '#FFFFFF', borderRadius: 19, borderWidth: 1, borderColor: 'rgba(10,10,10,0.07)', overflow: 'hidden', marginBottom: 10 },
  q: { paddingHorizontal: 16, paddingTop: 15, paddingBottom: 13, gap: 6 },
  qT: { fontFamily: Fonts.semiBold, fontSize: 16, letterSpacing: -0.32, lineHeight: 21.5, color: INK },
  qS: { fontFamily: Fonts.regular, fontSize: 11, color: INK_62 },
  fpx: {
    flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 16, paddingVertical: 11,
    borderTopWidth: 1, borderTopColor: 'rgba(10,10,10,0.07)', backgroundColor: '#FBFAF7',
  },
  fpxDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD },
  fpxT: { flex: 1, minWidth: 0, fontFamily: Fonts.semiBold, fontSize: 14, letterSpacing: -0.25, color: INK },

  act: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14,
    borderTopWidth: 1, borderTopColor: 'rgba(10,10,10,0.07)',
  },
  ok: { flex: 1, height: 42, borderRadius: 999, backgroundColor: INK, alignItems: 'center', justifyContent: 'center' },
  okT: { fontFamily: Fonts.semiBold, fontSize: 14, color: '#FFFFFF' },
  keep: { height: 42, paddingHorizontal: 17, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(10,10,10,0.14)', alignItems: 'center', justifyContent: 'center' },
  keepT: { fontFamily: Fonts.semiBold, fontSize: 13.5, color: 'rgba(10,10,10,0.68)' },

  // Too many focus points
  rec: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderRadius: 17,
    borderWidth: 1, borderColor: 'rgba(168,65,47,0.26)', paddingVertical: 14, paddingHorizontal: 16, marginBottom: 10,
  },
  recName: { fontFamily: Fonts.semiBold, fontSize: 14.5, letterSpacing: -0.3, color: INK },
  recSub: { fontFamily: Fonts.regular, fontSize: 12, lineHeight: 16.5, color: INK_62 },

  // Nothing left
  clear: {
    ...StyleSheet.absoluteFillObject, backgroundColor: '#1F5F3F', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 44,
  },
  tick: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', alignItems: 'center', justifyContent: 'center',
  },
  clearH: { fontFamily: Fonts.bold, fontSize: 34, letterSpacing: -1.5, lineHeight: 36, color: '#FFFFFF', marginTop: 26 },
  clearP: { fontFamily: Fonts.regular, fontSize: 14.5, lineHeight: 21, color: 'rgba(255,255,255,0.76)', textAlign: 'center', marginTop: 11 },
  nums: {
    flexDirection: 'row', gap: 26, marginTop: 30, paddingTop: 22,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)',
  },
  numsN: { fontFamily: Fonts.bold, fontSize: 22, letterSpacing: -0.9, lineHeight: 22, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  numsL: { fontFamily: Fonts.semiBold, fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.62)' },
  out: { marginTop: 38, borderRadius: 999, backgroundColor: '#FFFFFF', paddingHorizontal: 26, paddingVertical: 14 },
  outT: { fontFamily: Fonts.semiBold, fontSize: 14.5, color: INK },

  // Merge context
  popBack: { flex: 1, backgroundColor: 'rgba(10,10,10,0.45)', justifyContent: 'flex-end' },
  popBox: { backgroundColor: PAGE, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 30, maxHeight: '82%' },
  popH: { fontFamily: Fonts.bold, fontSize: 20, letterSpacing: -0.7, color: INK },
  popCl: {
    position: 'absolute', top: 18, right: 18, width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: 'rgba(10,10,10,0.1)', alignItems: 'center', justifyContent: 'center',
  },
  sh: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(10,10,10,0.07)', padding: 15, marginTop: 11, gap: 8 },
  hh: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  hhDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: GOLD },
  hhT: { flex: 1, minWidth: 0, fontFamily: Fonts.semiBold, fontSize: 14.5, letterSpacing: -0.26, color: INK },
  hhNew: { fontFamily: Fonts.semiBold, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: RED },
  shDt: { fontFamily: Fonts.semiBold, fontSize: 9, letterSpacing: 1.35, textTransform: 'uppercase', color: INK_62 },
  shDd: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19, color: INK, marginTop: 3 },
  popNote: { marginTop: 13, padding: 14, borderRadius: 14, backgroundColor: 'rgba(10,10,10,0.045)', fontFamily: Fonts.regular, fontSize: 12.5, lineHeight: 18, color: INK },
  popNoteB: { fontFamily: Fonts.semiBold },
  popAct: { flexDirection: 'row', gap: 8, marginTop: 15 },
});
