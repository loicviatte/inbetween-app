import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../theme';
import { getFocusPoints, getFocusProgress } from '../services/storage';

const RANK_LABELS = ['#1 Priority', '#2 Priority'];

function Logo() {
  return <Text style={styles.logo}>EE</Text>;
}

function FocusCard({ point, rank, onPress, recommended, compact }) {
  const isTop = rank < 2;

  const inner = (
    <TouchableOpacity
      style={[
        styles.focusCard,
        isTop ? styles.focusCardDark : styles.focusCardLight,
        recommended && styles.focusCardInner,
        compact && styles.focusCardCompact,
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.focusCardTop}>
        <Text style={[styles.focusCardLabel, !isTop && styles.focusCardLabelLight]}>
          {RANK_LABELS[rank] || `#${rank + 1}`}
        </Text>
        <View style={[styles.badge, !isTop && styles.badgeLight]}>
          <Text style={[styles.badgeText, !isTop && styles.badgeTextLight, compact && styles.badgeTextCompact]}>
            {point.count}× trained
          </Text>
        </View>
      </View>
      <Text style={[styles.focusCardName, !isTop && styles.focusCardNameLight, compact && styles.focusCardNameCompact]}>
        {point.label}
      </Text>
    </TouchableOpacity>
  );

  if (recommended) {
    return (
      <View style={styles.recommendedOuter}>
        <View style={styles.recommendedHeader}>
          <Text style={styles.recommendedLabel}>RECOMMENDED</Text>
        </View>
        {inner}
      </View>
    );
  }

  return inner;
}

export default function FocusScreen({ navigation }) {
  const [focusPoints, setFocusPoints] = useState([]);

  useFocusEffect(
    useCallback(() => {
      async function load() {
        const [points, progress] = await Promise.all([getFocusPoints(), getFocusProgress()]);
        const scores = {};
        for (const p of progress) {
          scores[p.focusPointId] = (scores[p.focusPointId] || 0) + p.priorityScore;
        }
        const sorted = [...points].sort(
          (a, b) => (scores[b.id] || 0) - (scores[a.id] || 0)
        );
        setFocusPoints(sorted);
      }
      load();
    }, [])
  );

  const top2 = focusPoints.slice(0, 2);
  const rest = focusPoints.slice(2);

  function openSession(point, rank) {
    navigation.navigate('FocusSession', { focusPointId: point.id, rank });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Logo />
        <TouchableOpacity
          style={styles.profileIcon}
          onPress={() => navigation.navigate('PROFILE')}
          activeOpacity={0.8}
        >
          <Text style={styles.profileInitial}>A</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.screenHeading}>Focus</Text>
        <Text style={styles.screenSubtitle}>Choose your focus for this session.</Text>

        {/* Top 2 priority cards */}
        {top2.map((point, i) => (
          <FocusCard
            key={point.id}
            point={point}
            rank={i}
            onPress={() => openSession(point, i)}
            recommended={i === 0}
            compact={i === 1}
          />
        ))}

        {/* Next focus points — display only, not clickable */}
        {rest.length > 0 && (
          <>
            <Text style={styles.otherTitle}>Next focus points</Text>
            {rest.map((point) => (
              <View key={point.id} style={styles.otherItem}>
                <Text style={styles.otherName}>{point.label}</Text>
              </View>
            ))}
          </>
        )}

        {focusPoints.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No focus points yet. Log a class to get started.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingTop: 16,
    paddingBottom: 8,
  },
  logo: {
    fontFamily: Fonts.monument,
    fontSize: 20,
    color: Colors.black,
    letterSpacing: 1,
  },
  profileIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.profileIcon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInitial: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: '#7A4A00',
  },

  content: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 40,
  },

  screenHeading: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 24,
    color: Colors.black,
    marginBottom: 6,
  },
  screenSubtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    lineHeight: 20,
    marginBottom: 20,
  },

  // Recommended wrapper
  recommendedOuter: {
    borderWidth: 2,
    borderColor: Colors.orange,
    borderRadius: 18,
    marginBottom: 14,
    overflow: 'hidden',
  },
  recommendedHeader: {
    backgroundColor: Colors.orange,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  recommendedLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: '#FFFFFF',
    letterSpacing: 1,
  },

  // Focus card — dark (top 2)
  focusCard: {
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 18,
    marginBottom: 14,
  },
  focusCardInner: {
    borderRadius: 0,
    marginBottom: 0,
  },
  focusCardCompact: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  focusCardDark: {
    backgroundColor: Colors.focusCard,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    elevation: 6,
  },
  focusCardLight: {
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
  },
  focusCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  focusCardLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
  },
  focusCardLabelLight: {
    color: Colors.secondary,
  },
  badge: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeLight: {
    borderColor: 'rgba(17,12,17,0.15)',
  },
  badgeText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11,
    color: Colors.white,
  },
  badgeTextLight: {
    color: Colors.secondary,
  },
  focusCardName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
    color: Colors.white,
    marginBottom: 8,
  },
  focusCardNameLight: {
    color: Colors.black,
  },
  focusCardNameCompact: {
    fontSize: 14,
    marginBottom: 5,
  },
  focusCardDesc: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 18,
    marginBottom: 14,
  },
  focusCardDescLight: {
    color: Colors.secondary,
  },
  choosePill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 12,
  },
  choosePillLight: {
    backgroundColor: 'rgba(33,150,243,0.1)',
  },
  choosePillCompact: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 8,
  },
  chooseText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: '#FFFFFF',
  },
  chooseTextLight: {
    color: Colors.activeFocus,
  },
  chooseTextCompact: {
    fontSize: 10,
  },
  badgeTextCompact: {
    fontSize: 10,
  },

  // Other focus areas
  otherTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: Colors.secondary,
    marginTop: 10,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  otherItem: {
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(17,12,17,0.06)',
  },
  otherName: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: Colors.secondary,
  },

  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.secondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});
