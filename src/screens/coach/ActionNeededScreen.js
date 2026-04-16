import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, Spacing } from '../../theme';
import { useCoachData } from '../../context/CoachDataContext';
import {
  getPendingFocusPoints,
  approveFocusPoint,
  deletePendingFocusPoint,
  approveAllPendingForStudent,
} from '../../storage/coachStorage';
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
          .select('id, name, user_id')
          .in('id', fpIds);
        const fpMap = {};
        for (const fp of fpRows || []) fpMap[fp.id] = fp;
        setMergeRequests(mrList.map(m => ({
          ...m,
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

  // Actions
  const handleApprove = async (fpId) => {
    try {
      await approveFocusPoint(fpId);
      setPendingFPs(prev => prev.filter(fp => fp.id !== fpId));
      refresh();
    } catch {}
  };

  const handleDelete = async (fpId) => {
    try {
      await deletePendingFocusPoint(fpId);
      setPendingFPs(prev => prev.filter(fp => fp.id !== fpId));
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
      await supabase.from('merge_requests').update({ status: 'rejected', resolved_at: new Date().toISOString(), resolved_by: 'coach' }).eq('id', mr.id);
      setMergeRequests(prev => prev.filter(m => m.id !== mr.id));
    } catch {}
  };

  const tabs = [
    { key: 'focus', label: 'Focus points', count: pendingFPs.length },
    { key: 'merge', label: 'Merge', count: mergeRequests.length },
    { key: 'name', label: 'Names', count: nameMatches.length },
  ];

  const totalCount = pendingFPs.length + mergeRequests.length + nameMatches.length;

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

      {/* Tabs */}
      <View style={s.tabRow}>
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[s.tab, activeTab === tab.key && s.tabActive]}
            onPress={() => { setActiveTab(tab.key); setExpandedId(null); }}
            activeOpacity={0.7}
          >
            <Text style={[s.tabText, activeTab === tab.key && s.tabTextActive]}>{tab.label}</Text>
            {tab.count > 0 && (
              <View style={[s.tabBadge, activeTab === tab.key && s.tabBadgeActive]}>
                <Text style={[s.tabBadgeText, activeTab === tab.key && s.tabBadgeTextActive]}>{tab.count}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: Spacing.side, paddingBottom: 100 }}>

        {/* ── Focus Points Tab ── */}
        {activeTab === 'focus' && (
          <>
            <Text style={s.tabIntro}>
              AI-generated focus points from your recent classes. Approve, edit or reject before they auto-publish to your students.
            </Text>

            {/* Bulk actions */}
            {pendingFPs.length > 0 && (
              <View style={s.bulkRow}>
                <Text style={s.bulkLabel}>{pendingFPs.length} to review</Text>
                <TouchableOpacity style={s.bulkBtn} onPress={handleApproveAll} activeOpacity={0.8}>
                  <Text style={s.bulkBtnText}>Approve all</Text>
                </TouchableOpacity>
              </View>
            )}

            {pendingFPs.map(fp => {
              const isExpanded = expandedId === `fp-${fp.id}`;
              const student = studentMap[fp.user_id];
              const hoursLeft = fp.coach_review_deadline
                ? Math.max(0, Math.ceil((new Date(fp.coach_review_deadline) - Date.now()) / 3600000))
                : null;
              const isUrgent = hoursLeft !== null && hoursLeft < 3;

              return (
                <TouchableOpacity
                  key={fp.id}
                  style={[s.fpCard, isUrgent && s.fpCardUrgent]}
                  activeOpacity={0.85}
                  onPress={() => setExpandedId(isExpanded ? null : `fp-${fp.id}`)}
                >
                  {/* Header */}
                  <View style={s.fpHeader}>
                    <View style={s.fpAvatar}>
                      <Text style={s.fpAvatarText}>{student ? initials(student.name) : '?'}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.fpName} numberOfLines={1}>{fp.name}</Text>
                      <Text style={s.fpStudent}>{student?.name || 'Student'}</Text>
                    </View>
                    {hoursLeft !== null && (
                      <View style={[s.timerBadge, isUrgent && s.timerBadgeUrgent]}>
                        <Ionicons name="time-outline" size={10} color={isUrgent ? C.red : C.orange} />
                        <Text style={[s.timerText, isUrgent && { color: C.red }]}>{hoursLeft}h</Text>
                      </View>
                    )}
                  </View>

                  {/* Detail */}
                  {!!fp.context && (
                    <Text style={s.fpDetail} numberOfLines={isExpanded ? undefined : 2}>{fp.context}</Text>
                  )}

                  {/* Expanded */}
                  {isExpanded && (
                    <View style={s.fpExpanded}>
                      {!!fp.drill && (
                        <View style={s.aiBox}>
                          <View style={s.aiBoxHeader}>
                            <Ionicons name="star" size={12} color="#fff" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={s.aiBoxLabel}>Drill suggestion</Text>
                            <Text style={s.aiBoxText}>{fp.drill}</Text>
                          </View>
                        </View>
                      )}

                      <View style={s.fpActions}>
                        <TouchableOpacity
                          style={s.approveBtn}
                          onPress={() => handleApprove(fp.id)}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="checkmark" size={14} color="#fff" />
                          <Text style={s.approveBtnText}>Approve</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={s.editBtn}
                          onPress={() => navigation.navigate('FocusValidation', { studentId: fp.user_id })}
                          activeOpacity={0.8}
                        >
                          <Text style={s.editBtnText}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={s.rejectBtn}
                          onPress={() => handleDelete(fp.id)}
                          activeOpacity={0.8}
                        >
                          <Text style={s.rejectBtnText}>Reject</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}

            {pendingFPs.length === 0 && !fpLoading && (
              <View style={s.emptyState}>
                <Ionicons name="checkmark-circle" size={40} color={C.green} />
                <Text style={s.emptyTitle}>All clear</Text>
                <Text style={s.emptySub}>No pending focus points to review.</Text>
              </View>
            )}
          </>
        )}

        {/* ── Merge Requests Tab ── */}
        {activeTab === 'merge' && (
          <>
            <Text style={s.tabIntro}>
              AI detected similar focus points that could be merged into one to keep things clean for your students.
            </Text>

            {mergeRequests.map(mr => {
              const student = studentMap[mr.student_id];
              return (
                <View key={mr.id} style={s.mergeCard}>
                  <View style={s.mergeHeader}>
                    <View style={s.mergeIcon}>
                      <Ionicons name="git-merge-outline" size={14} color={C.orange} />
                    </View>
                    <Text style={s.mergeTitleText} numberOfLines={1}>
                      "{mr.focusAName}" & "{mr.focusBName}"
                    </Text>
                  </View>

                  {student && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
                      <Ionicons name="person-outline" size={14} color={C.gray} />
                      <Text style={s.mergeMeta}>{student.name}</Text>
                    </View>
                  )}

                  <View style={s.nameActions}>
                    <TouchableOpacity style={s.confirmBtn} onPress={() => handleMerge(mr)} activeOpacity={0.8}>
                      <Text style={s.confirmBtnText}>Merge</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.denyBtn} onPress={() => handleRejectMerge(mr)} activeOpacity={0.8}>
                      <Text style={s.denyBtnText}>Ignore</Text>
                    </TouchableOpacity>
                  </View>
                </View>
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
        )}

        {/* ── Name Matching Tab ── */}
        {activeTab === 'name' && (
          <>
            <Text style={s.tabIntro}>
              We found names from class attendance that might match your students. Confirm the right ones so focus points land in the right place.
            </Text>

            {nameMatches.map(notif => {
              const d = notif.data || {};
              return (
                <View key={notif.id} style={s.nameCard}>
                  <View style={s.nameHeader}>
                    <View style={s.nameAvatar}>
                      <Text style={s.nameAvatarText}>{initials(d.student_name)}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.nameName}>{d.student_name || 'Unknown'}</Text>
                      <Text style={s.nameSource}>Attendance</Text>
                    </View>
                    <View style={s.pendingBadge}>
                      <Text style={s.pendingBadgeText}>Pending</Text>
                    </View>
                  </View>

                  <View style={s.matchRow}>
                    <Text style={s.matchLabel}>Matches</Text>
                    <Text style={s.matchValue}>{d.extracted_name || '—'}</Text>
                    <Ionicons name="chevron-forward" size={14} color="#CCC" />
                  </View>

                  <View style={s.nameActions}>
                    <TouchableOpacity
                      style={s.confirmBtn}
                      onPress={() => handleConfirmName(notif)}
                      activeOpacity={0.8}
                    >
                      <Text style={s.confirmBtnText}>Confirm</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.denyBtn}
                      onPress={() => handleRejectName(notif)}
                      activeOpacity={0.8}
                    >
                      <Text style={s.denyBtnText}>Not a match</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}

            {nameMatches.length === 0 && (
              <View style={s.emptyState}>
                <Ionicons name="checkmark-circle" size={40} color={C.green} />
                <Text style={s.emptyTitle}>All matched</Text>
                <Text style={s.emptySub}>No name matches to review.</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
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
    flexDirection: 'row',
    paddingHorizontal: Spacing.side,
    borderBottomWidth: 1,
    borderBottomColor: C.lightGray,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderBottomWidth: 2.5,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: C.dark,
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

  // Focus point card
  fpCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  fpCardUrgent: {
    borderColor: 'rgba(212,69,69,0.2)',
  },
  fpHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  fpAvatar: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fpAvatarText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: C.text,
  },
  fpName: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: C.text,
  },
  fpStudent: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: C.gray,
    marginTop: 2,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(232,168,56,0.08)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  timerBadgeUrgent: {
    backgroundColor: 'rgba(212,69,69,0.08)',
  },
  timerText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: C.orange,
  },
  fpDetail: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: C.text,
    lineHeight: 19,
    marginTop: 10,
    paddingLeft: 52,
  },
  fpExpanded: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: C.lightGray,
  },
  aiBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(232,168,56,0.06)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  aiBoxHeader: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: C.orange,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  aiBoxLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: C.orange,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  aiBoxText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: C.text,
    lineHeight: 18,
  },
  fpActions: {
    flexDirection: 'row',
    gap: 8,
  },
  approveBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: C.dark,
    borderRadius: 12,
    paddingVertical: 11,
  },
  approveBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: '#fff',
  },
  editBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: C.lightGray,
    borderRadius: 12,
    paddingVertical: 11,
  },
  editBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: C.text,
  },
  rejectBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(212,69,69,0.2)',
    borderRadius: 12,
    paddingVertical: 11,
  },
  rejectBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: C.red,
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
