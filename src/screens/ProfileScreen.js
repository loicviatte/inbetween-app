import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Fonts, Spacing } from '../theme';
import {
  getUser,
  getClassInputs,
  getFocusTrainedCount,
  getTopFocusPointsWithCounts,
} from '../services/storage';
import { supabase } from '../lib/supabase';
import RadarChart from '../components/RadarChart';

const AVATAR_KEY = '@profile_photo';

function Logo() { return <Text style={styles.logo}>EE</Text>; }

function StatBox({ value, label, showDivider }) {
  return (
    <View style={styles.statBoxRow}>
      {showDivider && <View style={styles.statDivider} />}
      <View style={styles.statBox}>
        <Text style={styles.statValue}>{value ?? '—'}</Text>
        <Text style={styles.statLabel}>{label}</Text>
      </View>
    </View>
  );
}

function TopFocusRow({ name, count, maxCount }) {
  const fill = maxCount > 0 ? count / maxCount : 0;
  return (
    <View style={styles.focusRow}>
      <View style={styles.focusRowTop}>
        <Text style={styles.focusName} numberOfLines={1}>{name}</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>{count}</Text>
        </View>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { flex: fill }]} />
        <View style={{ flex: 1 - fill }} />
      </View>
    </View>
  );
}

export default function ProfileScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({ totalClasses: 0, totalSessions: 0, activeFocusAreas: 0 });
  const [topFocus, setTopFocus] = useState([]);
  const [photoUri, setPhotoUri] = useState(null);

  useFocusEffect(useCallback(() => {
    async function load() {
      const [
        userData,
        classInputs,
        activeFocusAreas,
        topFocusPoints,
        { data: { user: authUser } },
        savedPhoto,
      ] = await Promise.all([
        getUser(),
        getClassInputs(),
        getFocusTrainedCount(),
        getTopFocusPointsWithCounts(3),
        supabase.auth.getUser(),
        AsyncStorage.getItem(AVATAR_KEY),
      ]);

      let totalSessions = 0;
      if (authUser?.id) {
        const { count } = await supabase
          .from('training_sessions')
          .select('id', { count: 'exact' })
          .eq('user_id', authUser.id)
          .not('completed_at', 'is', null);
        totalSessions = count ?? 0;
      }

      setUser(userData);
      setStats({ totalClasses: classInputs?.length ?? 0, totalSessions, activeFocusAreas: activeFocusAreas ?? 0 });
      setTopFocus(topFocusPoints ?? []);
      if (savedPhoto) setPhotoUri(savedPhoto);
    }
    load();
  }, []));

  async function handlePickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      const uri = result.assets[0].uri;
      setPhotoUri(uri);
      await AsyncStorage.setItem(AVATAR_KEY, uri);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  const maxCount = topFocus.length > 0 ? Math.max(...topFocus.map((f) => f.count)) : 1;
  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : 'AL';

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Logo />
        <TouchableOpacity style={styles.profileIcon} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text style={styles.profileInitial}>{user?.name ? user.name[0].toUpperCase() : 'A'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {/* Avatar + name */}
        <View style={styles.avatarSection}>
          <TouchableOpacity style={styles.avatarWrap} onPress={handlePickPhoto} activeOpacity={0.85}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.avatarPhoto} />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            )}
            <View style={styles.editBadge}>
              <Text style={styles.editIcon}>✎</Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.name}>{user?.name || 'Alexandra Lukey'}</Text>
          <Text style={styles.contact}>{user?.email || 'youremail@domain.com'}</Text>
        </View>

        {/* 3-stat row */}
        <View style={styles.statCard}>
          <StatBox value={stats.totalClasses} label="Classes Logged" />
          <StatBox value={stats.totalSessions} label="Focus Sessions" showDivider />
          <StatBox value={stats.activeFocusAreas} label="Active Areas" showDivider />
        </View>

        {/* Top focus areas */}
        {topFocus.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top Focus Areas</Text>
            <View style={styles.focusCard}>
              {topFocus.map((fp, i) => (
                <View key={fp.id ?? i}>
                  {i > 0 && <View style={styles.focusSep} />}
                  <TopFocusRow name={fp.name} count={fp.count} maxCount={maxCount} />
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Radar chart */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Current Strengths</Text>
          <View style={styles.chartCard}>
            <RadarChart scores={[0.7, 0.55, 0.82, 0.5, 0.65]} />
          </View>
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </View>
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
    paddingBottom: 12,
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
    flex: 1,
    paddingHorizontal: Spacing.side,
    paddingBottom: 24,
    justifyContent: 'space-between',
  },

  avatarSection: { alignItems: 'center' },
  avatarWrap: { position: 'relative', marginBottom: 12 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(215,150,255,0.2)',
    borderWidth: 3,
    borderColor: Colors.profileIcon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPhoto: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: Colors.profileIcon,
  },
  avatarInitials: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 28,
    color: '#7A4A00',
  },
  editBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editIcon: { color: Colors.white, fontSize: 12 },
  name: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: Colors.black,
    marginBottom: 2,
  },
  contact: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
  },

  statCard: {
    flexDirection: 'row',
    backgroundColor: Colors.statCardBg,
    borderColor: Colors.statCardBorder,
    borderWidth: 0.25,
    borderRadius: 4,
    paddingVertical: 14,
  },
  statBoxRow: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  statDivider: {
    width: 0.5,
    alignSelf: 'stretch',
    backgroundColor: Colors.statCardBorder,
    marginVertical: 4,
  },
  statBox: { flex: 1, alignItems: 'center' },
  statValue: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: Colors.black,
    marginBottom: 2,
  },
  statLabel: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11,
    color: Colors.secondary,
    textAlign: 'center',
  },

  section: {},
  sectionTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
    color: Colors.secondary,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  focusCard: {
    backgroundColor: Colors.statCardBg,
    borderColor: Colors.statCardBorder,
    borderWidth: 0.25,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  focusSep: { height: 0.5, backgroundColor: Colors.statCardBorder, marginVertical: 8 },
  focusRow: { paddingVertical: 2 },
  focusRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  focusName: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: Colors.black,
    flex: 1,
    marginRight: 8,
  },
  countBadge: {
    backgroundColor: Colors.orange,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  countBadgeText: { fontFamily: Fonts.jakartaBold, fontSize: 11, color: Colors.white },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.statCardBorder,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  progressFill: { height: 3, backgroundColor: Colors.orange, borderRadius: 2 },

  chartCard: {
    backgroundColor: Colors.statCardBg,
    borderColor: Colors.statCardBorder,
    borderWidth: 0.25,
    borderRadius: 4,
    alignItems: 'center',
    paddingVertical: 8,
  },

  logoutBtn: {
    borderWidth: 0.25,
    borderColor: Colors.statCardBorder,
    borderRadius: 4,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: Colors.statCardBg,
  },
  logoutText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: Colors.secondary,
  },
});
