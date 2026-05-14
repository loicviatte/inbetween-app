import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { Fonts, Spacing } from '../theme';
import { useCoachData } from '../context/CoachDataContext';
import RecordingProcessingIndicator from './RecordingProcessingIndicator';
import DjiSetupBanner from './DjiSetupBanner';

// May 2026 design refresh — gold/ink scale aligned with DashboardScreen.
const GOLD_500 = '#E8B530';
const GOLD_300 = '#F6D27A';
const GOLD_200 = '#F9DF9B';
const INK_50 = '#F7F6F3';
const INK_950 = '#0A0A0A';
const LINE = 'rgba(10,10,10,0.09)';

export default function CoachTabHeader() {
  const navigation = useNavigation();
  const { user, unreadCount } = useCoachData();
  const initial = user?.name ? user.name[0].toUpperCase() : 'C';

  return (
    <View style={styles.header}>
      <View style={styles.leftGroup}>
        <TouchableOpacity
          onPress={() => navigation.navigate('Notifications')}
          style={styles.notifBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="notifications-outline" size={18} color={INK_950} />
          {unreadCount > 0 && (
            <View style={styles.notifBadge}>
              <Text style={styles.notifBadgeText}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Tiny pill that surfaces when an upload/transcription is in
            flight in the background. Self-hides when nothing's pending. */}
        <RecordingProcessingIndicator />
      </View>

      {/* First-run DJI auto-sync prompt. Only visible when a coach in
          local-recording mode has a pending class but no folder
          bookmark yet. Tap → guided setup modal. Self-hides once the
          bookmark is set. */}
      <DjiSetupBanner />

      {/* Avatar with white inner ring + gold halo via shadow. The
          borderWidth on the wrap acts as the white ring, the shadow
          blooms the gold halo around the outside. */}
      <TouchableOpacity
        style={styles.avatarWrap}
        onPress={() => navigation.navigate('CoachProfile')}
        activeOpacity={0.85}
      >
        {user?.photo_url ? (
          <Image source={{ uri: user.photo_url }} style={styles.avatarPhoto} />
        ) : (
          <LinearGradient
            colors={[GOLD_200, GOLD_300]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatarGradient}
          >
            <Text style={styles.avatarText}>{initial}</Text>
          </LinearGradient>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 8,
    paddingHorizontal: Spacing.side,
    paddingBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  // Rounded-square translucent button, 40×40 with 12px radius. The
  // backdrop-filter from the CSS mockup isn't available in RN — we settle
  // for a translucent white that reads correctly on the warm paper bg.
  notifBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: LINE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: GOLD_500,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: INK_50,
  },
  notifBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9,
    color: INK_950,
    lineHeight: 11,
    includeFontPadding: false,
  },

  // The wrap is 40×40 with a 2px white inset border (the inner ring).
  // The gold halo is approximated as a soft shadow of GOLD_500 with
  // opacity 0.45 — it blooms around the outside since RN can't stack
  // multiple borders.
  avatarWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: INK_50,
    backgroundColor: INK_50,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: GOLD_500,
    shadowOpacity: 0.45,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  avatarGradient: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPhoto: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: INK_950,
    lineHeight: 18,
    includeFontPadding: false,
  },
});
