import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Spacing } from '../theme';
import { getAllFocusPointsRanked } from '../utils/algorithm';
import { getUser } from '../storage/storage';
import { categoryFromDances } from '../utils/danceCategory';
import { GenericListSkeleton } from '../components/Skeleton';
import HeroCardGradient from '../components/HeroCardGradient';

const GOLD = '#F6D27A';

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

function FocusCard({ item, index }) {
  const cls = item.class_inputs;

  return (
    <View style={c.card}>
      <HeroCardGradient />

      {/* Top row: rank */}
      <View style={c.topRow}>
        <Text style={c.rank}>#{index + 1}</Text>
      </View>

      {/* Name */}
      <Text style={c.name}>{item.name}</Text>

      {/* Subtitle */}
      {!!item.subtitle && (
        <Text style={c.subtitle} numberOfLines={4}>{item.subtitle}</Text>
      )}

      {/* Linked class */}
      {!!cls && (
        <View style={c.classBlock}>
          <View style={c.classDivider} />
          <View style={c.classRow}>
            <Ionicons name="school-outline" size={11} color={GOLD} />
            <Text style={c.classMeta}>
              {[cls.teacher_name, cls.dance, formatDate(cls.created_at)].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {!!cls.class_summary && (
            <Text style={c.classSummary} numberOfLines={2}>{cls.class_summary}</Text>
          )}
        </View>
      )}
    </View>
  );
}

export default function AllFocusPointsScreen({ navigation }) {
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [danceStyle, setDanceStyle] = useState(null);
  const [filter, setFilter] = useState('all'); // 'all' | 'latin' | 'ballroom'

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      getAllFocusPointsRanked(),
      getUser().catch(() => null),
    ])
      .then(([data, user]) => {
        if (!active) return;
        setPoints(data);
        setDanceStyle(user?.dance_style ?? null);
        setLoading(false);
      })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []));

  const showFilter = danceStyle === 'Latin & Ballroom';
  const filteredPoints = showFilter && filter !== 'all'
    ? points.filter((p) => categoryFromDances(p.dance) === filter)
    : points;

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

      {showFilter && !loading && (
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
      ) : filteredPoints.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyTitle}>
            {points.length === 0 ? 'No focus points yet' : 'No focus points in this category'}
          </Text>
          <Text style={s.emptyBody}>
            {points.length === 0 ? 'Log a class to get started.' : 'Try another filter.'}
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.list}
        >
          <Text style={s.countLabel}>
            {filteredPoints.length} active · ordered by priority
          </Text>
          {filteredPoints.map((item, index) => (
            <FocusCard key={item.id} item={item} index={index} />
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
  rank: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: GOLD,
    letterSpacing: 1.2,
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

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: Colors.black,
  },
  emptyBody: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
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
