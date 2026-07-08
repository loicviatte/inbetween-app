import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Fonts, Spacing } from '../theme';
import {
  getAllFocusPointsBundle,
  getSessionCountForFocus,
  startTrainingSession,
} from '../utils/algorithm';
import { getActiveSession } from '../storage/activeSession';
import { GenericListSkeleton } from '../components/Skeleton';
import HeroCardGradient from '../components/HeroCardGradient';

const GOLD = '#F6D27A';
const CBLUE = '#2E4670';
const CACHE_KEY = '@cache_all_focus_v2:'; // suffixed by dance category ('all' | 'latin' | 'ballroom')

const TIER_COLOR = {
  critical:  '#FF4B4B',
  important: Colors.orange,
  supporting:'#ACADB9',
};

const TIER_LABEL = {
  critical:  'Critical',
  important: 'Important',
  supporting:'Supporting',
};

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function FocusCard({ item, tab, accent, onPractice, starting }) {
  const cls = item.class_inputs;
  const tier = item.tier || 'supporting';
  const isCouple = tab === 'couple';
  const showProgress =
    (tab === 'solo' || tab === 'couple') &&
    Number.isFinite(item._target) && item._target > 0;
  const done = item._done || 0;
  const target = item._target || 0;
  const complete = showProgress && done >= target;

  return (
    <View style={c.card}>
      <HeroCardGradient />

      {/* Top row: tier + progress */}
      <View style={c.topRow}>
        <View style={c.tierGroup}>
          <View style={[c.tierDot, { backgroundColor: TIER_COLOR[tier] }]} />
          <Text style={c.tierLabel}>{TIER_LABEL[tier] || 'Focus'}</Text>
        </View>
        {showProgress && (
          <View style={c.progressWrap}>
            {complete && <Ionicons name="checkmark-circle" size={12} color={GOLD} />}
            <Text style={c.progressText}>{done}/{target} sessions</Text>
          </View>
        )}
      </View>

      {/* Name */}
      <Text style={c.name}>{item.name}</Text>

      {/* Subtitle */}
      {!!item.subtitle && (
        <Text style={c.subtitle} numberOfLines={4}>{item.subtitle}</Text>
      )}

      {/* Linked class (group tab) */}
      {!!cls && (
        <View style={c.classBlock}>
          <View style={c.classDivider} />
          <View style={c.classRow}>
            <Ionicons name="people-outline" size={11} color={GOLD} />
            <Text style={c.classMeta}>
              {[cls.teacher_name, cls.dance, formatDate(cls.created_at)].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {!!cls.class_summary && (
            <Text style={c.classSummary} numberOfLines={2}>{cls.class_summary}</Text>
          )}
        </View>
      )}

      {/* Practice */}
      <TouchableOpacity
        style={[c.practiceBtn, { backgroundColor: accent }]}
        activeOpacity={0.85}
        disabled={starting}
        onPress={() => onPractice(item)}
      >
        <Ionicons name="play" size={13} color={isCouple ? '#FFFFFF' : '#1C1C1E'} />
        <Text style={[c.practiceText, { color: isCouple ? '#FFFFFF' : '#1C1C1E' }]}>Practice</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function AllFocusPointsScreen({ navigation, route }) {
  // Open on the same Latin/Ballroom style the user is viewing in Train. Train
  // passes its active `category` ('latin' | 'ballroom' | null) as a route param;
  // null (single-style or no filter) maps to 'all'.
  const trainCategory = route?.params?.category;
  const initialFilter =
    trainCategory === 'latin' ? 'latin' : trainCategory === 'ballroom' ? 'ballroom' : 'all';

  const [loading, setLoading] = useState(true);
  const [danceStyle, setDanceStyle] = useState(null);
  const [couple, setCouple] = useState(null);
  const [tab, setTab] = useState('solo'); // 'solo' | 'couple' | 'group'
  const [filter, setFilter] = useState(initialFilter); // 'all' | 'latin' | 'ballroom'
  const [solo, setSolo] = useState([]);
  const [couplePts, setCouplePts] = useState([]);
  const [group, setGroup] = useState([]);
  const [starting, setStarting] = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    let freshPainted = false; // fresh network result already on screen → don't let the cache clobber it
    const cat = filter === 'all' ? null : filter;
    const key = CACHE_KEY + (cat || 'all');

    const apply = (b) => {
      setSolo(b.solo || []);
      setCouplePts(b.couple_pts || []);
      setGroup(b.group || []);
      setCouple(b.couple ?? null);        // { coupleId } | null — gates the Couple tab
      setDanceStyle(b.danceStyle ?? null);
    };

    // 1) Instant paint from the per-category cache (no skeleton on a warm cache).
    //    Cache miss → skeleton until the single RPC lands.
    AsyncStorage.getItem(key).then((raw) => {
      if (!active || freshPainted) return;
      if (raw) {
        try { apply(JSON.parse(raw)); setLoading(false); return; } catch {}
      }
      setLoading(true);
    }).catch(() => {});

    // 2) ONE round-trip — get_all_focus_points returns solo + couple_pts + group
    //    (category-scoped) + couple meta + dance_style. Replaces the old
    //    ~11-query staircase (getMyCouple alone was 4 serial queries).
    getAllFocusPointsBundle(cat).then((b) => {
      if (!active) return;
      if (b) {
        freshPainted = true;
        apply(b);
        AsyncStorage.setItem(key, JSON.stringify(b)).catch(() => {});
      }
      setLoading(false);
    }).catch(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [filter]));

  // ── Derived ──
  const showDanceFilter = danceStyle === 'Latin & Ballroom';
  const tabs = [{ key: 'solo', label: 'Solo' }];
  if (couple) tabs.push({ key: 'couple', label: 'Couple' });
  tabs.push({ key: 'group', label: 'Group' });
  const activeTab = (tab === 'couple' && !couple) ? 'solo' : tab;
  const accent = activeTab === 'couple' ? CBLUE : GOLD;
  const list = activeTab === 'solo' ? solo : activeTab === 'couple' ? couplePts : group;

  const emptyCopy = {
    solo:   { title: 'Nothing in progress', body: 'Log a private lesson to get your next focus points.' },
    couple: { title: 'No couple focus points', body: 'Your shared focus points from couple lessons show up here.' },
    group:  { title: 'No recent group focus', body: 'Focus points from your last group classes show up here.' },
  }[activeTab];

  const countLabel = {
    solo:   `${list.length} in progress · from your last private`,
    couple: `${list.length} shared · from your last couple lesson`,
    group:  `${list.length} · from your last 2 group classes`,
  }[activeTab];

  // ── Practice launch ──
  async function handlePractice(item) {
    if (starting || !item?.id) return;

    // A session is already running — resume it rather than starting a second one.
    const session = getActiveSession();
    if (session) {
      navigation.navigate('FocusSession', {
        focusPointId: session.focusPointId,
        sessionId: session.sessionId,
        rank: session.rank,
        sessionCount: session.sessionCount,
        couple: session.couple,
        coupleId: session.coupleId,
      });
      return;
    }

    setStarting(true);
    try {
      const sessionId = await startTrainingSession(item.id, null);
      if (activeTab === 'couple' && couple) {
        // Couple FP: pass the full row + couple params, exactly like the Train
        // couple card — acquireCoupleLock inside FocusSession is the atomic gate.
        navigation.navigate('FocusSession', {
          focusPointId: item.id,
          focusPointData: item,
          sessionId,
          rank: 0,
          sessionCount: 0,
          couple: true,
          coupleId: couple.coupleId,
        });
      } else {
        const count = await getSessionCountForFocus(item.id);
        navigation.navigate('FocusSession', {
          focusPointId: item.id,
          sessionId,
          rank: 0,
          sessionCount: count,
        });
      }
    } finally {
      setStarting(false);
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={Colors.black} />
        </TouchableOpacity>
        <Text style={s.title}>Focus Points</Text>
        <View style={s.backBtn} />
      </View>

      {/* Solo / Couple / Group toggle */}
      <View style={s.tabRow}>
        {tabs.map((t) => {
          const on = activeTab === t.key;
          const onColor = t.key === 'couple' ? CBLUE : Colors.black;
          return (
            <TouchableOpacity
              key={t.key}
              style={[s.tab, on && { backgroundColor: onColor }]}
              activeOpacity={0.8}
              onPress={() => setTab(t.key)}
            >
              <Text style={[s.tabText, on && s.tabTextOn]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Latin / Ballroom secondary filter (dual-style dancers only) */}
      {showDanceFilter && !loading && (
        <View style={s.filterRow}>
          {[
            { key: 'all', label: 'All' },
            { key: 'latin', label: 'Latin' },
            { key: 'ballroom', label: 'Ballroom' },
          ].map((opt) => {
            const on = filter === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[s.filterPill, on && s.filterPillOn]}
                activeOpacity={0.75}
                onPress={() => setFilter(opt.key)}
              >
                <Text style={[s.filterPillText, on && s.filterPillTextOn]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {loading ? (
        <GenericListSkeleton rows={6} showHeader={false} showTitle={false} />
      ) : list.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyTitle}>{emptyCopy.title}</Text>
          <Text style={s.emptyBody}>{emptyCopy.body}</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.list}
        >
          <Text style={s.countLabel}>{countLabel}</Text>
          {list.map((item) => (
            <FocusCard
              key={item.id}
              item={item}
              tab={activeTab}
              accent={accent}
              starting={starting}
              onPractice={handlePractice}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Card styles ──────────────────────────────────────────────────────────────
// Dark "hero" card — same brown→black gradient + gold border treatment
// used across the coach UI. <HeroCardGradient/> paints the background; the
// container only needs the border/clipping.
const c = StyleSheet.create({
  card: {
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(240,194,74,0.28)',
    overflow: 'hidden',
  },

  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tierGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tierDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  tierLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: GOLD,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  progressWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  progressText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.72)',
    letterSpacing: 0.3,
  },

  name: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: '#FFFFFF',
    letterSpacing: -0.4,
    lineHeight: 23,
    marginBottom: 8,
  },

  subtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: 'rgba(255,255,255,0.78)',
    lineHeight: 19,
    marginBottom: 2,
  },

  classBlock: {
    marginTop: 12,
  },
  classDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginBottom: 10,
  },
  classRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  classMeta: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 10.5,
    color: GOLD,
    letterSpacing: 0.3,
  },
  classSummary: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 16,
    marginLeft: 17,
  },

  practiceBtn: {
    marginTop: 14,
    height: 40,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  practiceText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    letterSpacing: 0.2,
  },
});

// ─── Screen styles ────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.white },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.side,
    paddingTop: 10,
    paddingBottom: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: Colors.black,
    letterSpacing: -0.3,
  },

  tabRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: Spacing.side,
    paddingTop: 2,
    paddingBottom: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
  },
  tabText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: Colors.secondary,
    letterSpacing: 0.2,
  },
  tabTextOn: {
    color: '#FFFFFF',
  },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 40 },
  emptyTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: Colors.black,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    textAlign: 'center',
  },

  list: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 40,
  },
  countLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 12,
    marginTop: 2,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: Spacing.side,
    paddingTop: 4,
    paddingBottom: 12,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#F0F0F0',
  },
  filterPillOn: {
    backgroundColor: Colors.black,
  },
  filterPillText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 12,
    color: Colors.secondary,
    letterSpacing: 0.2,
  },
  filterPillTextOn: {
    color: '#FFFFFF',
  },
});
