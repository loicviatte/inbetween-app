import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../theme';
import {
  getUser,
  getTopFocusPoint,
  getRecentClassInputs,
  getSessionsThisWeek,
  getFocusTrainedCount,
} from '../services/storage';
import { generateCoachingSummary } from '../services/anthropic';
import LogModal from '../components/LogModal';

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function Logo() {
  return (
    <Text style={styles.logo}>EE</Text>
  );
}

function StatCard({ number, label, dotColor }) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statLabelRow}>
        <View style={[styles.statDot, { backgroundColor: dotColor }]} />
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <Text style={styles.statNumber}>{number}</Text>
    </View>
  );
}

export default function HomeScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [topFocus, setTopFocus] = useState(null);
  const [coachSummary, setCoachSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [sessionsThisWeek, setSessionsThisWeek] = useState(0);
  const [focusCount, setFocusCount] = useState(0);
  const [logModalVisible, setLogModalVisible] = useState(false);

  async function load() {
    const [u, fp, inputs, sessions, fc] = await Promise.all([
      getUser(),
      getTopFocusPoint(),
      getRecentClassInputs(3),
      getSessionsThisWeek(),
      getFocusTrainedCount(),
    ]);
    setUser(u);
    setTopFocus(fp);
    setSessionsThisWeek(sessions);
    setFocusCount(fc);

    setSummaryLoading(true);
    try {
      const summary = await generateCoachingSummary(inputs);
      setCoachSummary(summary);
    } catch {
      setCoachSummary(
        'Keep showing up — consistency is how progress compounds. Focus on your top priority and trust the process.'
      );
    } finally {
      setSummaryLoading(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Top nav */}
        <View style={styles.topNav}>
          <Logo />
          <TouchableOpacity
            style={styles.profileIcon}
            onPress={() => navigation.navigate('PROFILE')}
            activeOpacity={0.8}
          >
            <Text style={styles.profileInitial}>{user?.name ? user.name[0].toUpperCase() : 'A'}</Text>
          </TouchableOpacity>
        </View>

        {/* Subtitle + Title */}
        <Text style={styles.subtitle}>
          {getGreeting()} {user?.name || 'Alex'}
        </Text>
        <Text style={styles.title}>Your next focus is ready</Text>

        {/* Where you are now card */}
        <View style={styles.coachCard}>
          <Text style={styles.coachCardTitle}>Where you are now</Text>
          {summaryLoading ? (
            <ActivityIndicator color={Colors.orange} style={{ marginVertical: 12 }} />
          ) : (
            <Text style={styles.coachCardBody} numberOfLines={3}>{coachSummary}</Text>
          )}
        </View>

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsRow}>
          {/* Main Focus button */}
          <TouchableOpacity
            style={styles.mainFocusBtn}
            onPress={() => navigation.navigate('TRAIN')}
            activeOpacity={0.88}
          >
            <View style={styles.mainFocusTopRow}>
              <Text style={styles.mainFocusLabel}>Main Focus</Text>
              <Text style={styles.mainFocusArrow}>→</Text>
            </View>
            <Text style={styles.mainFocusName} numberOfLines={1}>
              {topFocus?.label || 'No focus yet'}
            </Text>
          </TouchableOpacity>

          {/* Log Class button */}
          <TouchableOpacity
            style={styles.logClassBtn}
            onPress={() => setLogModalVisible(true)}
            activeOpacity={0.88}
          >
            <Text style={styles.logClassText}>Log{'\n'}Class</Text>
          </TouchableOpacity>
        </View>

        {/* Training Rhythm */}
        <Text style={[styles.sectionTitle, { marginTop: 32 }]}>Your Training Rhythm</Text>
        <View style={styles.statsRow}>
          <StatCard
            number={sessionsThisWeek}
            label="Sessions this week"
            dotColor={Colors.activeFocus}
          />
          <StatCard
            number={focusCount}
            label="Focus trained"
            dotColor={Colors.orange}
          />
        </View>
      </View>

      <LogModal
        visible={logModalVisible}
        onClose={() => setLogModalVisible(false)}
        onSubmitted={() => {
          setLogModalVisible(false);
          load();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: {
    flex: 1,
    paddingHorizontal: Spacing.side,
    paddingBottom: 24,
    paddingTop: 0,
    justifyContent: 'space-between',
  },

  // Top nav
  topNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 20,
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

  // Header text
  subtitle: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: Colors.secondary,
    marginBottom: 4,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: Colors.black,
    marginBottom: 20,
  },

  // Coach card
  coachCard: {
    backgroundColor: Colors.coachCard,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginBottom: 28,
    shadowColor: '#C460FF',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 3,
  },
  coachCardTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#000000',
    marginBottom: 8,
  },
  coachCardBody: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: '#000000',
    lineHeight: 20,
    marginBottom: 10,
  },

  // Section title
  sectionTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
    color: Colors.secondary,
    marginBottom: 14,
  },

  // Quick Actions
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  mainFocusBtn: {
    flex: 1,
    height: 73,
    backgroundColor: Colors.orange,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    justifyContent: 'space-between',
  },
  mainFocusTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mainFocusLabel: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: '#B35E60',
  },
  mainFocusArrow: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: Colors.profileIcon,
  },
  mainFocusName: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: Colors.white,
    marginTop: 6,
  },
  logClassBtn: {
    width: 95,
    height: 73,
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logClassText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: Colors.white,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    height: 68,
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.25,
    borderColor: Colors.statCardBorder,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 1,
  },
  statLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statLabel: {
    fontFamily: Fonts.montserratMedium,
    fontSize: 11,
    color: 'rgba(17, 12, 17, 0.75)',
    flex: 1,
  },
  statNumber: {
    fontFamily: Fonts.montserratSemiBold,
    fontSize: 20,
    color: '#110C11',
    textAlign: 'right',
  },
});
