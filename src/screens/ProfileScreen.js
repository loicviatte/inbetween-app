import React, { useCallback, useState } from 'react';
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
import { getUser } from '../services/storage';
import RadarChart from '../components/RadarChart';

function Logo() {
  return <Text style={styles.logo}>EE</Text>;
}

function Avatar({ name }) {
  const initials = name
    ? name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : 'AL';
  return (
    <View style={styles.avatarWrap}>
      <View style={styles.avatar}>
        <Text style={styles.avatarInitials}>{initials}</Text>
      </View>
      <TouchableOpacity style={styles.editBadge} activeOpacity={0.7}>
        <Text style={styles.editIcon}>✎</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ProfileScreen({ navigation }) {
  const [user, setUser] = useState(null);

  useFocusEffect(
    useCallback(() => {
      getUser().then(setUser);
    }, [])
  );

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Logo />
        <TouchableOpacity
          style={styles.profileIcon}
          onPress={() => navigation.goBack()}
          activeOpacity={0.8}
        >
          <Text style={styles.profileInitial}>
            {user?.name ? user.name[0].toUpperCase() : 'A'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <Avatar name={user?.name} />
          <Text style={styles.name}>{user?.name || 'Alexandra Lukey'}</Text>
          <Text style={styles.contact}>
            {user?.email || 'youremail@domain.com'} | {user?.phone || '+01 234 567 89'}
          </Text>
        </View>

        {/* Current Strengths */}
        <Text style={styles.sectionTitle}>Current Strengths</Text>
        <View style={styles.chartCard}>
          <RadarChart scores={[0.7, 0.55, 0.82, 0.5, 0.65]} />
        </View>
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
    paddingHorizontal: Spacing.side,
    paddingBottom: 32,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 36,
  },
  avatarWrap: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(215,150,255,0.2)',
    borderWidth: 3,
    borderColor: Colors.profileIcon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 36,
    color: '#7A4A00',
  },
  editBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editIcon: {
    color: Colors.white,
    fontSize: 13,
  },
  name: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
    color: Colors.black,
    marginBottom: 4,
  },
  contact: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
    textAlign: 'center',
  },
  sectionTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
    color: Colors.heading,
    marginBottom: 20,
  },
  chartCard: {
    backgroundColor: Colors.background,
    alignItems: 'center',
  },
});
