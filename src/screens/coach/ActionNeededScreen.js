import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Animated,
  Dimensions,
  LayoutAnimation,
  Platform,
  UIManager,
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
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fonts, Spacing } from '../../theme';
import { useCoachData } from '../../context/CoachDataContext';
import {
  getPendingFocusPoints,
  approveFocusPoint,
  deletePendingFocusPoint,
  editAndApproveFocusPoint,
  approveAllPendingForStudent,
  rejectPendingFocusPoint,
} from '../../storage/coachStorage';
import FocusPointEditSheet from '../../components/FocusPointEditSheet';
import ClassContextSheet from '../../components/coach/ClassContextSheet';
import ApproveConfirmSheet from '../../components/coach/ApproveConfirmSheet';
import MergeCompareCard from '../../components/coach/MergeCompareCard';
import NameMatchCard from '../../components/coach/NameMatchCard';
import PendingFocusCard from '../../components/coach/PendingFocusCard';
import RejectFocusSheet from '../../components/coach/RejectFocusSheet';
import { SkeletonBox } from '../../components/Skeleton';
import { getNotifications, deleteNotification } from '../../storage/notificationsStorage';
import { supabase } from '../../services/supabase/client';

// ── Palette ────────────────────────────────────────────────────────────────
const C = {
  bg: '#FAFAFA',
  surface: '#F0F0F0',
  card: '#FFFFFF',
  dark: '#141414',
  orange: '#E8A838',
  green: '#4AAF52',
  red: '#D44545',
  gray: '#999',
  lightGray: '#E5E5E5',
  text: '#0E0E0E',
};

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();
}

// ════════════════════════════════════════════════════════════════════════════
export default function ActionNeededScreen({ navigation }) {
  const { students, refresh } = useCoachData();
  const [activeTab, setActiveTab] = useState('focus');
  const [expandedId, setExpandedId] = useState(null);

  // Focus points
  const [pendingFPs, setPendingFPs] = useState([]);
  const [fpLoading, setFpLoading] = useState(true);
  const [editingFp, setEditingFp] = useState(null);
  const [rejectingFp, setRejectingFp] = useState(null);
  const [contextFp, setContextFp] = useState(null);
  const [approvingFp, setApprovingFp] = useState(null);

  // Merge requests
  const [mergeRequests, setMergeRequests] = useState([]);

  // Name matching
  const [nameMatches, setNameMatches] = useState([]);

  const studentMap = {};
  for (const s of students) studentMap[s.id] = s;

  const loadData = useCallback(async () => {
    setFpLoading(true);
    try {
      const [fps, notifs, { data: merges }] = await Promise.all([
        getPendingFocusPoints(null).catch(() => []),
        getNotifications().catch(() => []),
        supabase
          .from('merge_requests')
          .select('id, student_id, focus_a, focus_b, status, created_at')
          .eq('status', 'pending_coach')
          .order('created_at', { ascending: false }),
      ]);
      setPendingFPs(fps || []);
      setNameMatches(
        (notifs || []).filter(n => n.type === 'name_match_confirm')
      );

      // Enrich merge requests with focus point names
      const mrList = merges || [];
      if (mrList.length > 0) {
        const fpIds = [...new Set(mrList.flatMap(m => [m.focus_a, m.focus_b]))];
        const { data: fpRows } = await supabase
          .from('focus_points')
          .select('id, name, user_id, subtitle, context, dance, drill, tier, category, created_at')
          .in('id', fpIds);
        const fpMap = {};
        for (const fp of fpRows || []) fpMap[fp.id] = fp;
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

  // Auto-select the right tab on first landing based on priority:
  // Names > Merge > Focus. Once the coach manually changes tab, we never
  // override their choice — the ref locks us in.
  const didAutoSelectTab = useRef(false);
  useEffect(() => {
    if (didAutoSelectTab.current) return;
    if (fpLoading) return; // wait for the initial load to complete
    if (nameMatches.length > 0) setActiveTab('name');
    else if (mergeRequests.length > 0) setActiveTab('merge');
    else setActiveTab('focus');
    didAutoSelectTab.current = true;
  }, [fpLoading, nameMatches.length, mergeRequests.length]);

  // Actions. Group focus points are aggregated in the UI (1 card per
  // shared_group_id), so handlers must operate on all underlying rows when
  // an aggregate is passed via `_rows`.
  const handleApprove = async (fpId) => {
    try {
      await approveFocusPoint(fpId);
      setPendingFPs(prev => prev.filter(fp => fp.id !== fpId));
      refresh();
    } catch {}
  };

  const handleApproveGroup = async (rowIds) => {
    try {
      await Promise.all(rowIds.map(id => approveFocusPoint(id)));
      const set = new Set(rowIds);
      setPendingFPs(prev => prev.filter(fp => !set.has(fp.id)));
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
      refresh();
    } catch {}
  };

  const handleConfirmName = async (notif) => {
    try {
      const { student_id, focus_point_ids } = notif.data || {};
      if (focus_point_ids?.length > 0) {
        await supabase
          .from('focus_points')
          .update({ status: 'pending_coach' })
          .in('id', focus_point_ids);
      }
      await deleteNotification(notif.id);
      setNameMatches(prev => prev.filter(n => n.id !== notif.id));
      loadData();
    } catch {}
  };

  const handleRejectName = async (notif) => {
    try {
      const { focus_point_ids } = notif.data || {};
      if (focus_point_ids?.length > 0) {
        await supabase
          .from('focus_points')
          .update({ user_id: null, status: 'active' })
          .in('id', focus_point_ids);
      }
      await deleteNotification(notif.id);
      setNameMatches(prev => prev.filter(n => n.id !== notif.id));
    } catch {}
  };

  const handleMerge = async (mr) => {
    try {
      // Keep focus_a, delete focus_b, mark merged
      await supabase.from('focus_points').update({ is_deleted: true, status: 'past' }).eq('id', mr.focus_b);
      await supabase.from('merge_requests').update({ status: 'merged', resolved_at: new Date().toISOString(), resolved_by: 'coach' }).eq('id', mr.id);
      setMergeRequests(prev => prev.filter(m => m.id !== mr.id));
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

  // Count of cards the coach will see — group FPs sharing a shared_group_id
  // collapse into one card, so the visible "review count" is less than the
  // underlying row count when group focuses exist.
  const reviewCount = (() => {
    const sharedIds = new Set();
    let solo = 0;
    for (const fp of pendingFPs) {
      if (fp.group_fp) sharedIds.add(fp.shared_group_id || `single-${fp.id}`);
      else solo++;
    }
    return sharedIds.size + solo;
  })();

  const tabs = [
    { key: 'focus', label: 'Focus points', count: reviewCount },
    { key: 'merge', label: 'Merge', count: mergeRequests.length },
    { key: 'name', label: 'Names', count: nameMatches.length },
  ];

  const totalCount = reviewCount + mergeRequests.length + nameMatches.length;

  // Horizontal pager: sync tab selection <-> swipe gesture, drive a moving underline.
  const screenWidth = Dimensions.get('window').width;
  const pagerRef = useRef(null);
  const horizontalScrollX = useRef(new Animated.Value(0)).current;
  const tabIndex = Math.max(0, tabs.findIndex(t => t.key === activeTab));
  const firstMount = useRef(true);

  useEffect(() => {
    const targetX = tabIndex * screenWidth;
    if (firstMount.current) {
      horizontalScrollX.setValue(targetX);
      pagerRef.current?.scrollTo({ x: targetX, animated: false });
      firstMount.current = false;
    } else {
      pagerRef.current?.scrollTo({ x: targetX, animated: true });
    }
  }, [tabIndex, screenWidth]);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={12} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Action needed</Text>
        {totalCount > 0 && (
          <View style={s.totalBadge}>
            <Text style={s.totalBadgeText}>{totalCount}</Text>
          </View>
        )}
      </View>

      {/* Tabs with moving underline */}
      <View style={s.tabRow}>
        {tabs.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={s.tab}
              onPress={() => { setActiveTab(tab.key); setExpandedId(null); }}
              activeOpacity={0.7}
            >
              <View style={s.tabLabelRow}>
                <Text style={[s.tabText, isActive && s.tabTextActive]}>{tab.label}</Text>
                {tab.count > 0 && (
                  <View style={[s.tabBadge, isActive && s.tabBadgeActive]}>
                    <Text style={[s.tabBadgeText, isActive && s.tabBadgeTextActive]}>{tab.count}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
        <Animated.View
          pointerEvents="none"
          style={[
            s.tabUnderline,
            {
              // Underline position via transform (native driver) instead of
              // animating `left` (layout, JS-thread). Same visual result, but
              // the swipe-driven slide no longer chokes when cards are
              // expanding behind the pager.
              left: 0,
              transform: [{
                translateX: horizontalScrollX.interpolate({
                  inputRange: [0, Math.max(1, screenWidth), Math.max(2, 2 * screenWidth)],
                  outputRange: [
                    screenWidth * 0.05,
                    screenWidth * 0.38333,
                    screenWidth * 0.71667,
                  ],
                  extrapolate: 'clamp',
                }),
              }],
            },
          ]}
        />
      </View>

      {/* Pager — swipe between tabs */}
      <Animated.ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: horizontalScrollX } } }],
          { useNativeDriver: true }
        )}
        onMomentumScrollEnd={(e) => {
          const page = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, screenWidth));
          const next = tabs[page]?.key;
          if (next && next !== activeTab) {
            setActiveTab(next);
            setExpandedId(null);
          }
        }}
        style={{ flex: 1 }}
      >
      {/* ── Page 1: Focus Points ── */}
      <ScrollView style={{ width: screenWidth }} contentContainerStyle={{ padding: Spacing.side, paddingBottom: 100 }}>
        <>
            <Text style={s.tabIntro}>
              AI-generated focus points from your recent classes. Approve, edit or reject before they auto-publish to your students.
            </Text>

            {fpLoading && pendingFPs.length === 0 && (
              <View style={{ gap: 12 }}>
                {[0, 1, 2].map(i => (
                  <View key={i} style={s.skeletonCard}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                      <SkeletonBox width={32} height={32} borderRadius={16} />
                      <View style={{ flex: 1, gap: 6 }}>
                        <SkeletonBox width="55%" height={14} borderRadius={4} />
                        <SkeletonBox width="35%" height={11} borderRadius={4} />
                      </View>
                      <SkeletonBox width={44} height={18} borderRadius={6} />
                    </View>
                    <SkeletonBox width="90%" height={12} borderRadius={4} style={{ marginBottom: 6 }} />
                    <SkeletonBox width="75%" height={12} borderRadius={4} />
                  </View>
                ))}
              </View>
            )}

            {/* Bulk actions */}
            {pendingFPs.length > 0 && (
              <View style={s.bulkRow}>
                <Text style={s.bulkLabel}>{reviewCount} to review</Text>
                <TouchableOpacity style={s.bulkBtn} onPress={handleApproveAll} activeOpacity={0.8}>
                  <Text style={s.bulkBtnText}>Approve all</Text>
                </TouchableOpacity>
              </View>
            )}

            {(() => {
              // Aggregate group FPs by shared_group_id so each group focus
              // shows as one card listing all affected students (instead of
              // N duplicate cards, one per student row in the DB).
              const groupAggMap = new Map();
              for (const fp of pendingFPs) {
                if (!fp.group_fp) continue;
                const key = fp.shared_group_id || `single-${fp.id}`;
                if (!groupAggMap.has(key)) {
                  groupAggMap.set(key, { ...fp, _rows: [], _students: [] });
                }
                const agg = groupAggMap.get(key);
                agg._rows.push({ id: fp.id, user_id: fp.user_id });
                const student = studentMap[fp.user_id];
                if (student) agg._students.push(student);
              }
              const groupAggregates = Array.from(groupAggMap.values());
              const soloFPs = pendingFPs.filter(fp => !fp.group_fp);

              const renderSoloCard = (fp) => {
                const isExpanded = expandedId === `fp-${fp.id}`;
                const student = studentMap[fp.user_id];
                return (
                  <PendingFocusCard
                    key={fp.id}
                    fp={fp}
                    isExpanded={isExpanded}
                    onToggle={() => {
                      LayoutAnimation.configureNext(EXPAND_ANIMATION);
                      setExpandedId(isExpanded ? null : `fp-${fp.id}`);
                    }}
                    studentName={student?.name || 'Student'}
                    onApprove={() => openApproveForSolo(fp)}
                    onEdit={setEditingFp}
                    onDelete={handleReject}
                    onShowContext={setContextFp}
                  />
                );
              };

              const renderGroupCard = (agg) => {
                const cardKey = agg.shared_group_id || agg.id;
                const isExpanded = expandedId === `group-${cardKey}`;
                const rowIds = agg._rows.map(r => r.id);
                return (
                  <PendingFocusCard
                    key={cardKey}
                    fp={agg}
                    isExpanded={isExpanded}
                    onToggle={() => {
                      LayoutAnimation.configureNext(EXPAND_ANIMATION);
                      setExpandedId(isExpanded ? null : `group-${cardKey}`);
                    }}
                    onApprove={() => openApproveForGroup(agg)}
                    onEdit={() => setEditingFp(agg)}
                    onDelete={() => handleReject(agg)}
                    onShowContext={setContextFp}
                  />
                );
              };

              return (
                <>
                  {groupAggregates.length > 0 && (
                    <>
                      <Text style={s.sectionHeader}>Group focus points · {groupAggregates.length}</Text>
                      {groupAggregates.map(renderGroupCard)}
                    </>
                  )}
                  {soloFPs.length > 0 && (
                    <>
                      <Text style={[s.sectionHeader, groupAggregates.length > 0 && s.sectionHeaderSpaced]}>
                        Solo focus points · {soloFPs.length}
                      </Text>
                      {soloFPs.map(renderSoloCard)}
                    </>
                  )}
                </>
              );
            })()}

            {pendingFPs.length === 0 && !fpLoading && (
              <View style={s.emptyState}>
                <Ionicons name="checkmark-circle" size={40} color={C.green} />
                <Text style={s.emptyTitle}>All clear</Text>
                <Text style={s.emptySub}>No pending focus points to review.</Text>
              </View>
            )}
        </>
      </ScrollView>

      {/* ── Page 2: Merge Requests ── */}
      <ScrollView style={{ width: screenWidth }} contentContainerStyle={{ padding: Spacing.side, paddingBottom: 100 }}>
        <>
            <Text style={s.tabIntro}>
              AI detected similar focus points that could be merged into one to keep things clean for your students.
            </Text>

            {mergeRequests.map(mr => {
              const student = studentMap[mr.student_id];
              return (
                <MergeCompareCard
                  key={mr.id}
                  mr={mr}
                  studentName={student?.name}
                  onMerge={() => handleMerge(mr)}
                  onKeepBoth={() => handleRejectMerge(mr)}
                />
              );
            })}

            {mergeRequests.length === 0 && (
              <View style={s.emptyState}>
                <Ionicons name="checkmark-circle" size={40} color={C.green} />
                <Text style={s.emptyTitle}>No merges</Text>
                <Text style={s.emptySub}>No merge suggestions right now.</Text>
              </View>
            )}
        </>
      </ScrollView>

      {/* ── Page 3: Name Matching ── */}
      <ScrollView style={{ width: screenWidth }} contentContainerStyle={{ padding: Spacing.side, paddingBottom: 100 }}>
        <>
            <Text style={s.tabIntro}>
              While transcribing your class audio, our AI picked up names it couldn't confidently match to your roster. Confirm each one so the focus points from that lesson land on the right student.
            </Text>

            {nameMatches.map(notif => (
              <NameMatchCard
                key={notif.id}
                notif={notif}
                onConfirm={() => handleConfirmName(notif)}
                onReject={() => handleRejectName(notif)}
              />
            ))}

            {nameMatches.length === 0 && (
              <View style={s.emptyState}>
                <Ionicons name="checkmark-circle" size={40} color={C.green} />
                <Text style={s.emptyTitle}>All matched</Text>
                <Text style={s.emptySub}>No name matches to review.</Text>
              </View>
            )}
        </>
      </ScrollView>
      </Animated.ScrollView>

      <Modal visible={!!editingFp} transparent animationType="slide" onRequestClose={() => setEditingFp(null)}>
        {editingFp && (
          <FocusPointEditSheet
            fp={editingFp}
            onSave={handleSaveEdit}
            onClose={() => setEditingFp(null)}
            saveLabel="Save & Approve"
          />
        )}
      </Modal>

      <Modal visible={!!rejectingFp} transparent animationType="slide" onRequestClose={() => setRejectingFp(null)}>
        {rejectingFp && (
          <RejectFocusSheet
            fp={rejectingFp}
            onConfirm={handleConfirmReject}
            onClose={() => setRejectingFp(null)}
          />
        )}
      </Modal>

      <Modal visible={!!contextFp} transparent animationType="slide" onRequestClose={() => setContextFp(null)}>
        {contextFp && (
          <ClassContextSheet
            fp={contextFp}
            onClose={() => setContextFp(null)}
          />
        )}
      </Modal>

      <Modal visible={!!approvingFp} transparent animationType="fade" onRequestClose={() => setApprovingFp(null)}>
        {approvingFp && (
          <ApproveConfirmSheet
            fp={approvingFp}
            onConfirm={handleConfirmApprove}
            onCancel={() => setApprovingFp(null)}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingTop: 8,
    paddingBottom: 14,
    gap: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 2,
  },
  headerTitle: {
    flex: 1,
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: C.text,
    letterSpacing: -0.3,
  },
  totalBadge: {
    backgroundColor: C.orange,
    borderRadius: 10,
    minWidth: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  totalBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: '#fff',
  },

  // Tabs
  tabRow: {
    position: 'relative',
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: C.lightGray,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  tabLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tabUnderline: {
    position: 'absolute',
    bottom: -1,
    width: '23.333%',
    height: 2.5,
    borderRadius: 2,
    backgroundColor: C.dark,
  },
  tabText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: C.gray,
  },
  tabTextActive: {
    fontFamily: Fonts.jakartaBold,
    color: C.text,
  },
  tabBadge: {
    backgroundColor: C.surface,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  tabBadgeActive: {
    backgroundColor: C.dark,
  },
  tabBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: C.gray,
  },
  tabBadgeTextActive: {
    color: '#fff',
  },

  // Banner
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(212,69,69,0.06)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(212,69,69,0.12)',
  },
  bannerTitle: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: C.text,
  },
  bannerSub: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: C.gray,
    marginTop: 2,
    lineHeight: 16,
  },

  // Bulk
  bulkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  bulkLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: C.gray,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bulkBtn: {
    backgroundColor: C.dark,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  bulkBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: '#fff',
  },
  sectionHeader: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: C.gray,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  sectionHeaderSpaced: {
    marginTop: 14,
  },

  // Focus point card — editorial, minimal
  fpCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 18,
    marginBottom: 10,
    overflow: 'hidden',
    // Subtle shadow instead of border — gives depth without boxiness
    shadowColor: '#000',
    shadowOpacity: 0.035,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 1,
  },
  fpCardExpanded: {
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 3,
  },
  urgentAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2.5,
    backgroundColor: C.red,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  metaCategory: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: C.orange,
    textTransform: 'uppercase',
  },
  metaSep: {
    fontSize: 10,
    color: '#C8C8C8',
    marginHorizontal: -2,
  },
  metaStudent: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: C.gray,
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  metaTime: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: C.orange,
    letterSpacing: 0.1,
  },
  metaTimeUrgent: {
    color: C.red,
  },
  fpName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.3,
    color: C.text,
  },
  fpDetail: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13.5,
    color: '#5C6370',
    lineHeight: 20,
    marginTop: 8,
  },
  fpExpanded: {
    marginTop: 18,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E8E8E8',
  },
  skeletonCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.lightGray,
  },
  // Quote-style blocks (replacing boxy gray sections)
  quoteBlock: {
    marginBottom: 16,
  },
  quoteLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: C.gray,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 7,
  },
  quoteRow: {
    flexDirection: 'row',
    gap: 12,
  },
  quoteBar: {
    width: 2,
    backgroundColor: '#E0E0E0',
    borderRadius: 1,
  },
  quoteText: {
    flex: 1,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13.5,
    color: C.text,
    lineHeight: 20,
  },
  fpActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 6,
  },
  approveBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.dark,
    borderRadius: 999,
    paddingVertical: 12,
  },
  approveBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#fff',
    letterSpacing: 0.2,
  },
  textBtn: {
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  editBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: C.text,
    letterSpacing: 0.1,
  },
  rejectBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: C.red,
    letterSpacing: 0.1,
  },

  // Tab intro
  tabIntro: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: C.gray,
    lineHeight: 22,
    marginBottom: 20,
  },

  // Name matching
  nameCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 18,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(232,168,56,0.3)',
  },
  nameHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nameAvatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(232,168,56,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameAvatarText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: C.orange,
  },
  nameName: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: C.text,
  },
  nameSource: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: C.gray,
    marginTop: 2,
  },
  pendingBadge: {
    backgroundColor: 'rgba(232,168,56,0.08)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pendingBadgeText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 12,
    color: C.orange,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.bg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 12,
  },
  matchLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: C.gray,
  },
  matchValue: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: C.text,
    flex: 1,
  },
  nameActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  confirmBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.dark,
    borderRadius: 12,
    paddingVertical: 10,
  },
  confirmBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: '#fff',
  },
  denyBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: C.lightGray,
    borderRadius: 12,
    paddingVertical: 10,
  },
  denyBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: C.gray,
  },

  // Merge card
  mergeCard: {
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: C.lightGray,
  },
  mergeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mergeIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(232,168,56,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mergeTitleText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: C.text,
    flex: 1,
  },
  mergeMeta: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: C.gray,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: C.text,
  },
  emptySub: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: C.gray,
  },
});
