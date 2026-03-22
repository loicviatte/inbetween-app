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

function FocusCard({ point, rank, onPress }) {
  const isTop = rank < 2;

  return (
    <TouchableOpacity
      style={[styles.focusCard, isTop ? styles.focusCardDark : styles.focusCardLight]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.focusCardTop}>
        <Text style={[styles.focusCardLabel, !isTop && styles.focusCardLabelLight]}>
          {RANK_LABELS[rank] || `#${rank + 1}`}
        </Text>
        <View style={[styles.badge, !isTop && styles.badgeLight]}>
          <Text style={[styles.badgeText, !isTop && styles.badgeTextLight]}>
            {point.count}× trained
          </Text>
        </View>
      </View>
      <Text style={[styles.focusCardName, !isTop && styles.focusCardNameLight]}>
        {point.label}
      </Text>
      {point.description ? (
        <Text
          style={[styles.focusCardDesc, !isTop && styles.focusCardDescLight]}
          numberOfLines={2}
        >
          {point.description}
        </Text>
      ) : null}
      <View style={[styles.chooseRow]}>
        <Text style={[styles.chooseText, !isTop && styles.chooseTextLight]}>
          Choose this focus →
        </Text>
      </View>
    </TouchableOpacity>
  );
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
          />
        ))}

        {/* Remaining focus points */}
        {rest.length > 0 && (
          <>
            <Text style={styles.otherTitle}>Other focus areas</Text>
            {rest.map((point, i) => (
              <TouchableOpacity
                key={point.id}
                style={styles.otherItem}
                onPress={() => openSession(point, i + 2)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.otherName}>{point.label}</Text>
                  {point.description ? (
                    <Text style={styles.otherDesc} numberOfLines={1}>
                      {point.description}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.otherArrow}>→</Text>
              </TouchableOpacity>
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

  // Focus card — dark (top 2)
  focusCard: {
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 18,
    marginBottom: 14,
  },
  focusCardDark: {
    backgroundColor: Colors.focusCard,
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
    fontSize: 22,
    color: Colors.white,
    marginBottom: 8,
  },
  focusCardNameLight: {
    color: Colors.black,
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
  chooseRow: {
    marginTop: 4,
  },
  chooseText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: Colors.profileIcon,
  },
  chooseTextLight: {
    color: Colors.activeFocus,
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(17,12,17,0.06)',
    gap: 12,
  },
  otherName: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: Colors.black,
    marginBottom: 2,
  },
  otherDesc: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
  },
  otherArrow: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 16,
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
