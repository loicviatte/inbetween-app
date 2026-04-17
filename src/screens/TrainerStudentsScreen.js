import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, Spacing } from '../theme';
import { supabase } from '../services/supabase/client';
import { GenericListSkeleton } from '../components/Skeleton';

const BG = '#0D0D12';
const CARD_BG = '#18181F';
const BORDER = 'rgba(255,255,255,0.08)';
const WHITE = '#FFFFFF';
const MUTED = 'rgba(255,255,255,0.55)';
const ORANGE = '#FF9D00';
const GREEN = '#4CAF50';
const RED = '#E84040';

const TIER_COLOR = {
  critical: RED,
  important: ORANGE,
  supporting: GREEN,
};

const PRACTICE_WEIGHT = { critical: 0.8, important: 1.0, supporting: 1.2 };
const TIER_MODIFIER = { critical: 3, important: 2, supporting: 1 };
const GRACE_DAYS = { critical: 4, important: 7, supporting: 999 };
const INACTION_DELTA = { critical: 1.0, important: 0.5, supporting: 0.0 };

function computeRecency(daysSince) {
  if (daysSince === 0) return 3;
  if (daysSince <= 3) return 2;
  if (daysSince <= 6) return 1;
  return 0;
}

function computeInactionPenalty(tier, daysSincePractice) {
  const grace = GRACE_DAYS[tier] ?? 999;
  const delta = INACTION_DELTA[tier] ?? 0;
  const weeks = Math.floor(Math.max(0, daysSincePractice - grace) / 7);
  return Math.min(3, delta * weeks);
}

function computePriority(fp, now = new Date()) {
  const tier = fp.tier || 'important';
  const refDate = fp.last_mentioned_at ? new Date(fp.last_mentioned_at) : new Date(fp.created_at);
  const daysSinceMentioned = Math.floor((now - refDate) / 86400000);
  const lastPracticed = fp.last_exposed_at ? new Date(fp.last_exposed_at) : null;
  const daysSincePractice = lastPracticed ? Math.floor((now - lastPracticed) / 86400000) : 999;

  const raw =
    Number(fp.base_score ?? 0)
    - Number(fp.practice_count ?? 0) * (PRACTICE_WEIGHT[tier] ?? 1.0)
    + computeRecency(daysSinceMentioned)
    + (TIER_MODIFIER[tier] ?? 2)
    + Number(fp.coach_signal ?? 0)
    + computeInactionPenalty(tier, daysSincePractice);
  return Math.max(0, Math.min(20, raw));
}

export default function TrainerStudentsScreen({ navigation }) {
  const [students, setStudents] = useState([]);
  const [focusPointsByUser, setFocusPointsByUser] = useState({});
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  const screenWidth = Dimensions.get('window').width;
  const pagerRef = useRef(null);
  const tabStripRef = useRef(null);
  const horizontalScrollX = useRef(new Animated.Value(0)).current;
  const firstMount = useRef(true);

  useEffect(() => {
    if (students.length === 0) return;
    const targetX = activeIdx * screenWidth;
    if (firstMount.current) {
      horizontalScrollX.setValue(targetX);
      pagerRef.current?.scrollTo({ x: targetX, animated: false });
      firstMount.current = false;
    } else {
      pagerRef.current?.scrollTo({ x: targetX, animated: true });
    }
    // Auto-scroll the tab strip so the active pill stays in view
    tabStripRef.current?.scrollTo({ x: Math.max(0, activeIdx * 120 - screenWidth / 2 + 60), animated: true });
  }, [activeIdx, screenWidth, students.length]);

  const load = useCallback(async () => {
    try {
      // Fetch all users with at least one focus_point (cheaper than loading every user).
      // Match client getSlots() filters exactly so the ordering shown here
      // mirrors what each student sees on their home. getSlots does NOT
      // filter by is_archived, and restricts status to the "visible" set.
      const { data: fpsRaw } = await supabase
        .from('focus_points')
        .select('id, user_id, name, tier, base_score, count, practice_count, coach_signal, status, is_deleted, is_archived, last_mentioned_at, last_exposed_at, created_at')
        .eq('is_deleted', false)
        .eq('is_other', false)
        .is('alias_of', null);

      const fps = (fpsRaw ?? []).filter(
        (p) => !p.status || p.status === 'active' || p.status === 'cooling_down' || p.status === 'past_candidate'
      );

      // Sort per student by the real priority.
      fps.sort((a, b) => computePriority(b) - computePriority(a));

      const userIds = [...new Set((fps ?? []).map((f) => f.user_id).filter(Boolean))];
      let userMap = {};
      if (userIds.length > 0) {
        const { data: users, error: usersErr } = await supabase
          .from('users')
          .select('id, name, role')
          .in('id', userIds);
        if (usersErr) {
          console.warn('[TrainerStudents] users query error:', usersErr.message);
        } else {
          console.log('[TrainerStudents] fetched', (users ?? []).length, 'users of', userIds.length, 'requested');
        }
        for (const u of users ?? []) userMap[u.id] = u;
      }

      const grouped = {};
      for (const fp of fps ?? []) {
        if (!grouped[fp.user_id]) grouped[fp.user_id] = [];
        grouped[fp.user_id].push(fp);
      }

      const studentList = Object.keys(grouped)
        .map((id) => ({ ...(userMap[id] || { id, name: 'Unknown' }), id, fpCount: grouped[id].length }))
        .sort((a, b) => b.fpCount - a.fpCount);

      setStudents(studentList);
      setFocusPointsByUser(grouped);
    } catch (err) {
      console.warn('[TrainerStudents] load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <GenericListSkeleton rows={6} background={BG} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={WHITE} />
        </TouchableOpacity>
        <Text style={s.title}>Students & scores</Text>
        <View style={{ width: 22 }} />
      </View>

      {students.length === 0 ? (
        <View style={s.emptyWrap}>
          <Text style={s.empty}>No focus points in the system.</Text>
        </View>
      ) : (
        <>
          {/* Student tab strip */}
          <ScrollView
            ref={tabStripRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.tabStrip}
            style={{ flexGrow: 0 }}
          >
            {students.map((student, idx) => {
              const isActive = idx === activeIdx;
              return (
                <TouchableOpacity
                  key={student.id}
                  style={[s.tabPill, isActive && s.tabPillActive]}
                  onPress={() => setActiveIdx(idx)}
                  activeOpacity={0.75}
                >
                  <Text style={[s.tabPillText, isActive && s.tabPillTextActive]} numberOfLines={1}>
                    {student.name || 'Unknown'}
                  </Text>
                  <View style={[s.tabPillBadge, isActive && s.tabPillBadgeActive]}>
                    <Text style={[s.tabPillBadgeText, isActive && s.tabPillBadgeTextActive]}>
                      {student.fpCount}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Horizontal pager — one student per page */}
          <Animated.ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            bounces={false}
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={Animated.event(
              [{ nativeEvent: { contentOffset: { x: horizontalScrollX } } }],
              { useNativeDriver: false }
            )}
            onMomentumScrollEnd={(e) => {
              const page = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, screenWidth));
              if (page !== activeIdx && students[page]) setActiveIdx(page);
            }}
            style={{ flex: 1 }}
          >
            {students.map((student) => {
              const fps = focusPointsByUser[student.id] || [];
              return (
                <ScrollView
                  key={student.id}
                  style={{ width: screenWidth }}
                  contentContainerStyle={s.pageScroll}
                  showsVerticalScrollIndicator={false}
                >
                  <Text style={s.studentMetaTop} numberOfLines={1}>
                    {fps.length} focus point{fps.length > 1 ? 's' : ''}
                    {student.role ? ` · ${student.role}` : ''}
                  </Text>

                  {fps.map((fp, i) => (
                    <TouchableOpacity
                      key={fp.id}
                      style={s.fpRow}
                      onPress={() => navigation.navigate('TrainerFocusHistory', { focusPointId: fp.id, name: fp.name })}
                      activeOpacity={0.7}
                    >
                      <Text style={s.fpRank}>{i + 1}</Text>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.fpName} numberOfLines={1}>{fp.name}</Text>
                        <View style={s.fpMetaRow}>
                          <View style={[s.tierDot, { backgroundColor: TIER_COLOR[fp.tier] || MUTED }]} />
                          <Text style={s.fpMetaText}>{(fp.tier || '').toUpperCase()}</Text>
                          <Text style={s.fpMetaDot}>·</Text>
                          <Text style={s.fpMetaText}>{fp.count ?? 0}× mentioned</Text>
                          <Text style={s.fpMetaDot}>·</Text>
                          <Text style={s.fpMetaText}>{fp.practice_count ?? 0}× practiced</Text>
                          {fp.status !== 'active' && (
                            <>
                              <Text style={s.fpMetaDot}>·</Text>
                              <Text style={[s.fpMetaText, { color: ORANGE }]}>{fp.status}</Text>
                            </>
                          )}
                        </View>
                      </View>
                      <Text style={s.fpScore}>{computePriority(fp).toFixed(1)}</Text>
                      <Ionicons name="chevron-forward" size={14} color={MUTED} style={{ marginLeft: 6 }} />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              );
            })}
          </Animated.ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingTop: 8,
    paddingBottom: 14,
    gap: 12,
  },
  title: {
    flex: 1,
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: WHITE,
    letterSpacing: -0.3,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: MUTED,
    textAlign: 'center',
  },

  // Tab strip (horizontal, scrollable student selector)
  tabStrip: {
    paddingHorizontal: Spacing.side,
    paddingTop: 2,
    paddingBottom: 14,
    gap: 8,
  },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabPillActive: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.25)',
  },
  tabPillText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 12,
    color: MUTED,
    letterSpacing: 0.1,
    maxWidth: 160,
  },
  tabPillTextActive: {
    color: WHITE,
  },
  tabPillBadge: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabPillBadgeActive: {
    backgroundColor: ORANGE,
  },
  tabPillBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: MUTED,
    letterSpacing: 0.2,
  },
  tabPillBadgeTextActive: {
    color: '#0D0D12',
  },

  // Page content
  pageScroll: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 40,
  },
  studentMetaTop: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: MUTED,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  fpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
    backgroundColor: CARD_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 8,
  },
  fpRank: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: MUTED,
    width: 20,
    letterSpacing: 0.4,
  },
  fpName: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13.5,
    color: WHITE,
    letterSpacing: -0.1,
  },
  fpMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  tierDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  fpMetaText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 10,
    color: MUTED,
    letterSpacing: 0.3,
  },
  fpMetaDot: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
  },
  fpScore: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
    color: WHITE,
    letterSpacing: -0.3,
    minWidth: 38,
    textAlign: 'right',
  },
});
