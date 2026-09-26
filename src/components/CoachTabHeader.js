import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { Fonts, Spacing } from '../theme';
import { useCoachData } from '../context/CoachDataContext';
import DjiSetupBanner from './DjiSetupBanner';
import DjiSyncPill from './DjiSyncPill';
import StyleTitle from './StyleTitle';
import AccountSheet from './AccountSheet';
import { useDjiSync } from '../context/DjiSyncContext';
import { logOutCoachWithChecks } from '../services/logout';
import { useCoachTabView } from '../context/CoachTabView';

// May 2026 design refresh — gold/ink scale aligned with DashboardScreen.
const GOLD_500 = '#E8B530';
const GOLD_300 = '#F6D27A';
const GOLD_200 = '#F9DF9B';
const INK_50 = '#F7F6F3';
const INK_950 = '#0A0A0A';
const LINE = 'rgba(10,10,10,0.09)';

const CLASS_STYLES = [
  { key: 'all', label: 'All lessons' },
  { key: 'latin', label: 'Latin' },
  { key: 'ballroom', label: 'Ballroom' },
];

// mode 'group': Home and Students put "Latin ▾" after the bell — the style
// their numbers are for (a menu when the coach teaches both).
// mode 'classes': the Class tab's "Classes ▾", then its calendar and notes buttons.
// links: the Students tab's link button beside settings, which opens its Links.
export default function CoachTabHeader({ mode = null, links = false }) {
  const navigation = useNavigation();
  const { user, unreadCount, styleFilter, setStyleFilter, canSwitchStyle, notes, refresh } = useCoachData();
  const djiPhase = useDjiSync()?.phase;
  // The avatar opens Account (photo, name, email) with Settings and Log out, as for a student.
  const [accountOpen, setAccountOpen] = useState(false);
  const tabView = useCoachTabView();
  const classes = {
    view: tabView.classesView, setView: tabView.setClassesView,
    style: tabView.classesStyle, setStyle: tabView.setClassesStyle,
  };
  const initial = user?.name ? user.name[0].toUpperCase() : 'C';
  const classesLabel = classes.style === 'latin' ? 'Latin' : classes.style === 'ballroom' ? 'Ballroom' : 'Lessons';
  const toggleView = (v) => classes.setView(classes.view === v ? 'list' : v);

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
      </View>

      {mode === 'group' && (
        <StyleTitle
          label={styleFilter === 'ballroom' ? 'Ballroom' : 'Latin'}
          category={styleFilter}
          canSwitch={canSwitchStyle}
          onSelect={setStyleFilter}
        />
      )}
      {mode === 'classes' && (
        <StyleTitle
          label={classesLabel}
          category={classes.style}
          canSwitch={canSwitchStyle}
          options={CLASS_STYLES}
          onSelect={classes.setStyle}
        />
      )}

      {/* The one-time mic setup flow. Nothing of it shows in the header any
          more — that step lives on the dashboard's main button, where Start a
          lesson would be. Mounted here so it can be opened from any coach tab. */}
      <DjiSetupBanner />

      {/* Sync-status pill (folder already set up). 4 states — red "Sync
          files" / orange "Syncing %" / green "Synced" / "! Error". Tap
          opens the full-screen flow. Self-hides when there's nothing to
          sync, and stays hidden while the mic has never been linked. */}
      <DjiSyncPill />

      {/* Right: settings (the student's Stats button, exactly) beside the avatar. */}
      <View style={styles.rightGroup}>
        {mode === 'classes' && (
          <>
            <TouchableOpacity
              onPress={() => toggleView('cal')}
              style={[styles.viewBtn, classes.view === 'cal' && styles.viewBtnOn]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Calendar view"
              accessibilityState={{ selected: classes.view === 'cal' }}
            >
              <Ionicons name="calendar-clear-outline" size={17} color={classes.view === 'cal' ? '#FFFFFF' : INK_950} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => toggleView('notes')}
              style={[styles.viewBtn, classes.view === 'notes' && styles.viewBtnOn]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Notes, ${notes.length} saved`}
              accessibilityState={{ selected: classes.view === 'notes' }}
            >
              <Ionicons name="document-text-outline" size={17} color={classes.view === 'notes' ? '#FFFFFF' : INK_950} />
              {notes.length > 0 && (
                <View style={styles.viewBadge}>
                  <Text style={styles.viewBadgeText}>{notes.length > 99 ? '99+' : notes.length}</Text>
                </View>
              )}
            </TouchableOpacity>
          </>
        )}
        {links && (
          <TouchableOpacity
            onPress={() => tabView.setLinksOpen(!tabView.linksOpen)}
            style={[styles.settingsBtn, tabView.linksOpen && styles.settingsBtnOn]}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Links: your invite code and coach card"
            accessibilityState={{ selected: tabView.linksOpen }}
          >
            <Ionicons name="link-outline" size={18} color={tabView.linksOpen ? '#FFFFFF' : '#141311'} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={() => navigation.navigate('CoachSettings')}
          style={styles.settingsBtn}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Settings"
        >
          <Ionicons name="options-outline" size={18} color="#141311" />
        </TouchableOpacity>

        {/* Avatar with white inner ring + gold halo via shadow. The
            borderWidth on the wrap acts as the white ring, the shadow
            blooms the gold halo around the outside. */}
        <TouchableOpacity
          style={styles.avatarWrap}
          onPress={() => setAccountOpen(true)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Account"
        >
          {user?.avatar_url ? (
            <Image source={{ uri: user.avatar_url }} style={styles.avatarPhoto} />
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

      <AccountSheet
        visible={accountOpen}
        onClose={() => { setAccountOpen(false); refresh(); }}
        onSaved={() => refresh()}
        onOpenSettings={() => navigation.navigate('CoachSettings')}
        onLogout={() => logOutCoachWithChecks({ djiUploading: djiPhase === 'syncing' })}
      />
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
    gap: 10,
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
    fontFamily: Fonts.semiBold,
    fontSize: 9,
    color: INK_950,
    lineHeight: 11,
    includeFontPadding: false,
  },

  // The wrap is 40×40 with a 2px white inset border (the inner ring).
  // The gold halo is approximated as a soft shadow of GOLD_500 with
  // opacity 0.45 — it blooms around the outside since RN can't stack
  // multiple borders.
  rightGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Class tab: calendar and notes (docs/design/coach-classes.html .ib).
  viewBtn: {
    width: 36, height: 36, borderRadius: 11, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: INK_950, shadowOpacity: 0.07, shadowOffset: { width: 0, height: 1 }, shadowRadius: 2, elevation: 1,
  },
  viewBtnOn: { backgroundColor: INK_950, shadowOpacity: 0, elevation: 0 },
  viewBadge: {
    position: 'absolute', top: -4, right: -4, minWidth: 15, height: 15, paddingHorizontal: 3, borderRadius: 999,
    backgroundColor: GOLD_500, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#F2F0EB',
  },
  viewBadgeText: { fontFamily: Fonts.semiBold, fontSize: 9, lineHeight: 11, color: INK_950, includeFontPadding: false },
  // Stats ▸ header button (StatsScreen styles.heroActBtn), unchanged.
  settingsBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    shadowColor: '#282214', shadowOpacity: 0.10, shadowOffset: { width: 0, height: 4 }, shadowRadius: 10,
    elevation: 2,
  },
  settingsBtnOn: { backgroundColor: '#141311' },
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
    fontFamily: Fonts.semiBold,
    fontSize: 14,
    color: INK_950,
    lineHeight: 18,
    includeFontPadding: false,
  },
});
