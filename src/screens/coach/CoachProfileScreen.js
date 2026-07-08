import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Share,
  ScrollView,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard2 from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Fonts, Spacing } from '../../theme';
import { getUser, saveUserProfile } from '../../storage/storage';
import {
  getOrCreateInviteCode,
  getMyStudents,
  getMyClasses,
  getTotalCoachedMinutes,
} from '../../storage/coachStorage';
import { clearUserCaches } from '../../storage/userCaches';
import { clearPushToken } from '../../services/notifications';
import { getActiveCoachClass, clearActiveCoachClass } from '../../storage/activeCoachClass';
import { useDjiSync } from '../../context/DjiSyncContext';
import { supabase } from '../../services/supabase/client';
import { CoachProfileScreenSkeleton } from '../../components/Skeleton';
import StudioPicker from '../../components/StudioPicker';
import BottomSheet from '../../components/BottomSheet';

const AVATAR_KEY = '@coach_profile_photo';
const CACHE_KEY = '@cache_coach_profile';

// ─── Palette (aligned with the May 2026 refresh — same as DashboardScreen) ──
const INK_950 = '#0A0A0A';
const FG_2 = 'rgba(10,10,10,0.55)';
const FG_3 = 'rgba(10,10,10,0.30)';
const LINE = 'rgba(10,10,10,0.09)';
const GOLD_500 = '#E8B530';

export default function CoachProfileScreen({ navigation }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const hasLoadedRef = useRef(false);
  // DJI import phase — used to warn before logging out mid-upload. Defensive
  // read: null if ever rendered outside DjiSyncProvider.
  const djiPhase = useDjiSync()?.phase;

  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [studentCount, setStudentCount] = useState(0);
  const [classCount, setClassCount] = useState(0);
  const [coachedHours, setCoachedHours] = useState(0);
  const [inviteCode, setInviteCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [photoUri, setPhotoUri] = useState(null);
  const [activeTab, setActiveTab] = useState('code'); // 'code' | 'settings'
  const tabSlide = useRef(new Animated.Value(0)).current; // sliding pill (0=code, 1=settings)
  const [subtabW, setSubtabW] = useState(0);
  const selectTab = (key) => {
    setActiveTab(key);
    Animated.spring(tabSlide, {
      toValue: key === 'settings' ? 1 : 0,
      useNativeDriver: true,
      friction: 9,
      tension: 90,
    }).start();
  };

  const [editVisible, setEditVisible] = useState(false);
  const [editMode, setEditMode] = useState('account'); // 'account' | 'studio' | 'style'
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editStudio, setEditStudio] = useState(null);
  const [editStyle, setEditStyle] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const [
      userData,
      students,
      classes,
      coachedMinutes,
      code,
      savedPhoto,
    ] = await Promise.all([
      getUser().catch(() => null),
      getMyStudents().catch(() => []),
      getMyClasses().catch(() => []),
      getTotalCoachedMinutes().catch(() => 0),
      getOrCreateInviteCode().catch(() => ''),
      AsyncStorage.getItem(AVATAR_KEY).catch(() => null),
    ]);

    setUser(userData);
    setStudentCount(students.length);
    setClassCount(classes.length);

    const hours = Math.round(coachedMinutes / 60);
    setCoachedHours(hours);

    setInviteCode(code || '');

    const remoteAvatar = userData?.avatar_url
      ? `${userData.avatar_url}?t=${Math.floor(Date.now() / 60000)}`
      : null;
    const avatarToShow = remoteAvatar || savedPhoto || null;
    if (avatarToShow) {
      setPhotoUri(avatarToShow);
      if (remoteAvatar) {
        await AsyncStorage.setItem(AVATAR_KEY, remoteAvatar).catch(() => {});
      }
    }

    AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        user: userData,
        studentCount: students.length,
        classCount: classes.length,
        coachedHours: hours,
        inviteCode: code || '',
      }),
    ).catch(() => {});
  }

  useFocusEffect(
    useCallback(() => {
      const isFirst = !hasLoadedRef.current;
      if (isFirst) setIsLoading(true);
      async function init() {
        if (isFirst) {
          try {
            const raw = await AsyncStorage.getItem(CACHE_KEY);
            if (raw) {
              const c = JSON.parse(raw);
              setUser(c.user);
              setStudentCount(c.studentCount || 0);
              setClassCount(c.classCount || 0);
              setCoachedHours(c.coachedHours || 0);
              setInviteCode(c.inviteCode || '');
              setIsLoading(false);
            }
          } catch {}
        }
        try { await load(); } catch {}
        hasLoadedRef.current = true;
        setIsLoading(false);
        if (isFirst) {
          fadeAnim.setValue(0);
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }).start();
        }
      }
      init();
    }, []),
  );

  // ── Photo picker ─────────────────────────────────────────────────────────

  async function handlePickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: true,
    });
    if (result.canceled || !result.assets[0]?.uri) return;

    const asset = result.assets[0];
    const localUri = asset.uri;
    setPhotoUri(localUri);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error('Not authenticated');
      if (!asset.base64) throw new Error('No base64 data from picker');

      const bin = global.atob(asset.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

      const ext = (localUri.split('.').pop() || 'jpg').toLowerCase();
      const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
      const path = `${userId}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, bytes, { upsert: true, contentType });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(path);
      const urlWithCache = `${publicUrl}?t=${Date.now()}`;

      await supabase.from('users').update({ avatar_url: publicUrl }).eq('id', userId);
      await AsyncStorage.setItem(AVATAR_KEY, urlWithCache);
      setPhotoUri(urlWithCache);
    } catch (e) {
      console.error('Avatar upload failed:', e);
      await AsyncStorage.setItem(AVATAR_KEY, localUri).catch(() => {});
    }
  }

  // ── Invite code actions ─────────────────────────────────────────────────

  async function handleCopyCode() {
    if (!inviteCode) return;
    await Clipboard2.setStringAsync(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShareCode() {
    if (!inviteCode) return;
    const firstName = user?.name ? user.name.split(' ')[0] : 'your coach';
    const message = `Join me on InBetween — I'll send your focus points after every class.\n\nUse my invite code: ${inviteCode}`;
    try {
      await Share.share({
        message,
        title: `Connect with ${firstName} on InBetween`,
      });
    } catch (err) {
      Alert.alert('Could not share', String(err?.message || err));
    }
  }

  // ── Edit modal ──────────────────────────────────────────────────────────

  function openEdit(mode = 'account') {
    setEditMode(mode);
    setEditName(user?.name || '');
    setEditEmail(user?.email || '');
    setEditStudio(user?.studio || null);
    setEditStyle(user?.dance_style || '');
    setEditVisible(true);
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    const name = editName.trim();
    const studio_id = editStudio?.id || null;
    const newEmail = editEmail.trim();
    try {
      await saveUserProfile({ name, studio_id, dance_style: editStyle });
      setUser(prev => ({
        ...prev,
        name,
        studio_id,
        studio: editStudio,
        dance_style: editStyle,
      }));
      let emailNotice = false;
      if (newEmail && newEmail.toLowerCase() !== (user?.email || '').toLowerCase()) {
        const { error } = await supabase.auth.updateUser({ email: newEmail });
        if (error) throw error;
        emailNotice = true;
      }
      setEditVisible(false);
      if (emailNotice) {
        Alert.alert('Confirm your new email', `We sent a confirmation link to ${newEmail}. Your email updates once you tap it.`);
      }
    } catch (e) {
      Alert.alert('Could not save', e.message || 'Please try again.');
    }
    setSaving(false);
  }

  // Warn before signing out if a class recording is still active or a DJI
  // import is uploading — logging out discards the in-flight work, and the
  // active-class holder (like activeSession) survives clearUserCaches() and
  // would otherwise bleed into the next account on this device.
  function handleLogout() {
    const activeClass = getActiveCoachClass();
    const djiUploading = djiPhase === 'syncing';
    if (activeClass || djiUploading) {
      const what = activeClass ? 'a class is still recording' : 'a DJI import is still uploading';
      Alert.alert(
        'In progress',
        `You have ${what}. Logging out will discard it. Continue?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Discard & log out', style: 'destructive', onPress: () => { performLogout(); } },
        ],
      );
      return;
    }
    performLogout();
  }

  async function performLogout() {
    // Clear the active-class holder (memory + storage) so a running class can't
    // survive into the next account on this device.
    clearActiveCoachClass();
    await clearUserCaches();
    // Drop this device's push token before sign-out (shared-device hygiene).
    const { data: { session } } = await supabase.auth.getSession();
    clearPushToken(session?.user?.id);
    // scope:'local' → instant on-device sign-out, no network token-revoke wait.
    await supabase.auth.signOut({ scope: 'local' });
  }

  if (isLoading) {
    return <CoachProfileScreenSkeleton />;
  }

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : 'CO';

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={['#F7F6F3', '#F4EFDC', '#F9DF9B']}
        locations={[0, 0.55, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.95, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          {/* Top bar */}
          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={18} color={INK_950} />
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              style={styles.editPill}
              onPress={openEdit}
              activeOpacity={0.75}
            >
              <Text style={styles.editPillText}>Edit</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {/* ── Hero ── */}
            <View style={styles.heroSection}>
              <TouchableOpacity
                style={styles.avatarWrap}
                onPress={handlePickPhoto}
                activeOpacity={0.85}
              >
                <View style={styles.avatarRing}>
                  {photoUri ? (
                    <Image source={{ uri: photoUri }} style={styles.avatarPhoto} />
                  ) : (
                    <View style={styles.avatarFallback}>
                      <Text style={styles.avatarInitials}>{initials}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>

              <Text style={styles.name} numberOfLines={1}>
                {user?.name || 'Your Name'}
              </Text>

              <View style={styles.coachBadge}>
                <Ionicons name="star" size={10} color={INK_950} />
                <Text style={styles.coachBadgeText}>Coach</Text>
              </View>

              {!!user?.studio?.name && (
                <Text style={styles.studioName} numberOfLines={1} ellipsizeMode="tail">
                  {user.studio.name}
                </Text>
              )}
              {!!user?.dance_style && (
                <Text style={styles.danceStyle} numberOfLines={1}>
                  {user.dance_style}
                </Text>
              )}
            </View>

            {/* ── Glance stats card ── */}
            <View style={glance.card}>
              <View style={glance.statsRow}>
                <View style={glance.cell}>
                  <Text style={glance.cellNum}>{studentCount}</Text>
                  <Text style={glance.cellLbl}>Students</Text>
                </View>
                <View style={glance.cellDivider} />
                <View style={glance.cell}>
                  <Text style={glance.cellNum}>{classCount}</Text>
                  <Text style={glance.cellLbl}>Classes</Text>
                </View>
                <View style={glance.cellDivider} />
                <View style={glance.cell}>
                  <Text style={glance.cellNum}>{coachedHours}</Text>
                  <Text style={glance.cellLbl}>Hours</Text>
                </View>
              </View>
            </View>

            {/* ── Code | Settings subtabs (sliding pill) ── */}
            <View
              style={subtab.bar}
              onLayout={(e) => setSubtabW(e.nativeEvent.layout.width)}
            >
              {subtabW > 0 && (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    subtab.thumb,
                    {
                      width: (subtabW - 8) / 2,
                      transform: [{
                        translateX: tabSlide.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, (subtabW - 8) / 2],
                        }),
                      }],
                    },
                  ]}
                />
              )}
              {[{ key: 'code', label: 'Code' }, { key: 'settings', label: 'Settings' }].map((t) => {
                const on = activeTab === t.key;
                return (
                  <TouchableOpacity
                    key={t.key}
                    style={subtab.btn}
                    onPress={() => selectTab(t.key)}
                    activeOpacity={0.8}
                  >
                    <Text style={[subtab.btnTxt, on && subtab.btnTxtOn]}>{t.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* ── Code tab: invite code ── */}
            {activeTab === 'code' && (
            <View style={styles.section}>
              <View style={styles.sectionRow}>
                <Text style={styles.sectionLabel}>YOUR INVITE CODE</Text>
                <View style={styles.sectionRule} />
              </View>

              <View style={invite.card}>
                <Text style={invite.eyebrow}>Share with your students</Text>
                <Text style={invite.tagline}>
                  Students enter this code in their profile to connect with you and
                  start receiving focus points after every class.
                </Text>

                <View style={invite.codeWrap}>
                  <Text style={invite.code}>{inviteCode || '——'}</Text>
                  <TouchableOpacity
                    style={[invite.copyChip, copied && invite.copyChipDone]}
                    onPress={handleCopyCode}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name={copied ? 'checkmark' : 'copy-outline'}
                      size={12}
                      color={copied ? '#7FB77E' : '#F6D27A'}
                    />
                    <Text
                      style={[
                        invite.copyChipText,
                        copied && invite.copyChipTextDone,
                      ]}
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={invite.shareBtn}
                  onPress={handleShareCode}
                  activeOpacity={0.88}
                  disabled={!inviteCode}
                >
                  <Ionicons name="share-outline" size={16} color={INK_950} />
                  <Text style={invite.shareBtnText}>Share with a student</Text>
                </TouchableOpacity>

                {studentCount > 0 ? (
                  <Text style={invite.foot}>
                    <Text style={invite.footStrong}>
                      {studentCount} student{studentCount === 1 ? '' : 's'}
                    </Text>{' '}
                    connected so far.
                  </Text>
                ) : (
                  <Text style={invite.foot}>
                    No students yet — share your code to get your first connection.
                  </Text>
                )}
              </View>
            </View>
            )}

            {/* ── Settings tab: account + log out ── */}
            {activeTab === 'settings' && (
            <View style={styles.section}>
              <View style={styles.sectionRow}>
                <Text style={styles.sectionLabel}>ACCOUNT</Text>
                <View style={styles.sectionRule} />
              </View>

              <View style={set.card}>
                <TouchableOpacity style={set.row} onPress={() => openEdit('account')} activeOpacity={0.7}>
                  <Ionicons name="person-outline" size={18} color={INK_950} />
                  <View style={set.rowMid}>
                    <Text style={set.rowLabel}>Account</Text>
                    <Text style={set.rowValue} numberOfLines={1}>{user?.name || '—'}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="rgba(10,10,10,0.3)" />
                </TouchableOpacity>
                <TouchableOpacity style={set.row} onPress={() => openEdit('studio')} activeOpacity={0.7}>
                  <Ionicons name="business-outline" size={18} color={INK_950} />
                  <View style={set.rowMid}>
                    <Text style={set.rowLabel}>Studio</Text>
                    <Text style={set.rowValue} numberOfLines={1}>{user?.studio?.name || 'Not set'}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="rgba(10,10,10,0.3)" />
                </TouchableOpacity>
                <TouchableOpacity style={[set.row, set.rowLast]} onPress={() => openEdit('style')} activeOpacity={0.7}>
                  <Ionicons name="musical-notes-outline" size={18} color={INK_950} />
                  <View style={set.rowMid}>
                    <Text style={set.rowLabel}>Dance style</Text>
                    <Text style={set.rowValue} numberOfLines={1}>{user?.dance_style || 'Not set'}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="rgba(10,10,10,0.3)" />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.logoutBtn}
                onPress={handleLogout}
                activeOpacity={0.7}
              >
                <Text style={styles.logoutText}>Log out</Text>
              </TouchableOpacity>
            </View>
            )}
          </ScrollView>

          {/* Edit Modal */}
          <BottomSheet
            visible={editVisible}
            onClose={() => setEditVisible(false)}
            sheetStyle={em.sheet}
            avoidKeyboard
          >
            <View style={em.handle} />
            <Text style={em.title}>
              {editMode === 'studio' ? 'Studio' : editMode === 'style' ? 'Dance style' : 'Account'}
            </Text>

            {editMode === 'account' && (
              <>
                <TouchableOpacity
                  style={em.avatarWrap}
                  onPress={handlePickPhoto}
                  activeOpacity={0.85}
                >
                  {photoUri ? (
                    <Image source={{ uri: photoUri }} style={em.avatarPhoto} />
                  ) : (
                    <View style={em.avatar}>
                      <Text style={em.avatarInitials}>{initials}</Text>
                    </View>
                  )}
                  <View style={em.editBadge}>
                    <Text style={em.editIcon}>✎</Text>
                  </View>
                </TouchableOpacity>

                <View style={em.field}>
                  <Text style={em.fieldLabel}>Name</Text>
                  <TextInput
                    style={em.input}
                    value={editName}
                    onChangeText={setEditName}
                    placeholder="Your name"
                    placeholderTextColor="rgba(17,12,17,0.3)"
                    autoCorrect={false}
                  />
                </View>

                <View style={em.field}>
                  <Text style={em.fieldLabel}>Email</Text>
                  <TextInput
                    style={em.input}
                    value={editEmail}
                    onChangeText={setEditEmail}
                    placeholder="you@email.com"
                    placeholderTextColor="rgba(17,12,17,0.3)"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                  />
                </View>
              </>
            )}

            {editMode === 'studio' && (
              <View style={em.field}>
                <Text style={em.fieldLabel}>Studio</Text>
                <StudioPicker
                  value={editStudio}
                  onChange={setEditStudio}
                  allowCreate
                />
              </View>
            )}

            {editMode === 'style' && (
              <View style={em.field}>
                <Text style={em.fieldLabel}>Dance Style</Text>
                <View style={em.pillRow}>
                  {['Latin', 'Ballroom', 'Latin & Ballroom'].map(s => (
                    <TouchableOpacity
                      key={s}
                      style={[em.pill, editStyle === s && em.pillActive]}
                      onPress={() => setEditStyle(s)}
                      activeOpacity={0.75}
                    >
                      <Text
                        style={[
                          em.pillText,
                          editStyle === s && em.pillTextActive,
                        ]}
                      >
                        {s}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            <TouchableOpacity
              style={em.saveBtn}
              onPress={handleSave}
              activeOpacity={0.88}
              disabled={saving}
            >
              <Text style={em.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={em.cancelBtn}
              onPress={() => setEditVisible(false)}
              activeOpacity={0.7}
            >
              <Text style={em.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </BottomSheet>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingTop: 4,
    paddingBottom: 4,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.65)',
    borderWidth: 1,
    borderColor: LINE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.65)',
    borderWidth: 1,
    borderColor: LINE,
  },
  editPillText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
    color: INK_950,
    letterSpacing: 0.4,
  },

  content: {
    paddingHorizontal: Spacing.side,
    paddingTop: 6,
    paddingBottom: 40,
  },

  // Hero
  heroSection: {
    alignItems: 'center',
    paddingTop: 0,
    paddingBottom: 14,
  },
  avatarWrap: { marginBottom: 8 },
  avatarRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    padding: 3,
    backgroundColor: 'rgba(232,181,48,0.45)',
    shadowColor: GOLD_500,
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 4,
  },
  avatarPhoto: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#F7F6F3',
    borderWidth: 2,
    borderColor: '#F7F6F3',
  },
  avatarFallback: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#4E6A5C',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#F7F6F3',
  },
  avatarInitials: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 30,
    color: '#F7F6F3',
  },
  name: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 26,
    color: INK_950,
    letterSpacing: -0.6,
    marginTop: 4,
    marginBottom: 6,
  },
  coachBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: GOLD_500,
    marginBottom: 6,
  },
  coachBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: INK_950,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  studioName: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12,
    color: INK_950,
    textAlign: 'center',
    paddingHorizontal: 16,
    marginTop: 2,
  },
  danceStyle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11,
    color: FG_2,
    textAlign: 'center',
    marginTop: 2,
  },

  // Section eyebrow
  section: { marginTop: 18 },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 4,
    paddingBottom: 10,
  },
  sectionLabel: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 10.5,
    color: GOLD_500,
    letterSpacing: 1.4,
  },
  sectionRule: { flex: 1, height: 1, backgroundColor: LINE },

  // Logout pill
  logoutBtn: {
    alignSelf: 'center',
    marginTop: 28,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: 'rgba(212,69,69,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(212,69,69,0.30)',
    borderRadius: 999,
  },
  logoutText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12,
    color: '#D44545',
    letterSpacing: 0.4,
  },
});

const glance = StyleSheet.create({
  card: {
    marginTop: 6,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cell: { flex: 1, alignItems: 'center', gap: 3 },
  cellNum: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 26,
    color: INK_950,
    letterSpacing: -0.6,
    lineHeight: 28,
  },
  cellLbl: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 9.5,
    color: FG_2,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  cellDivider: { width: 1, height: 32, backgroundColor: LINE },
});

const subtab = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(10,10,10,0.09)',
    borderRadius: 999,
    padding: 4,
    marginTop: 22,
    marginBottom: 18,
  },
  btn: { flex: 1, borderRadius: 999, paddingVertical: 9, alignItems: 'center', justifyContent: 'center' },
  thumb: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    borderRadius: 999,
    backgroundColor: '#0A0A0A',
    shadowColor: '#0A0A0A',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  btnTxt: { fontFamily: Fonts.jakartaSemiBold, fontSize: 12.5, color: 'rgba(10,10,10,0.45)', letterSpacing: 0.1 },
  btnTxtOn: { color: '#fff' },
});

const set = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(10,10,10,0.08)',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(10,10,10,0.06)',
  },
  rowLast: { borderBottomWidth: 0 },
  rowMid: { flex: 1, minWidth: 0 },
  rowLabel: { fontFamily: Fonts.jakartaSemiBold, fontSize: 13, color: INK_950 },
  rowValue: { fontFamily: Fonts.jakartaRegular, fontSize: 12, color: 'rgba(10,10,10,0.5)', marginTop: 2 },
});

const invite = StyleSheet.create({
  card: {
    backgroundColor: '#1F1810',
    borderWidth: 1,
    borderColor: 'rgba(240,194,74,0.32)',
    borderRadius: 22,
    padding: 20,
    overflow: 'hidden',
    shadowColor: '#0A0A0A',
    shadowOpacity: 0.45,
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 22,
    elevation: 8,
  },
  eyebrow: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10.5,
    color: '#F6D27A',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  tagline: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.62)',
    lineHeight: 18,
    marginBottom: 16,
  },
  codeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 14,
  },
  code: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 28,
    color: '#F6D27A',
    letterSpacing: 6,
  },
  copyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
  },
  copyChipDone: {
    backgroundColor: 'rgba(127,183,126,0.15)',
    borderColor: 'rgba(127,183,126,0.40)',
  },
  copyChipText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: '#F6D27A',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  copyChipTextDone: {
    color: '#7FB77E',
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: GOLD_500,
    borderRadius: 14,
    paddingVertical: 14,
  },
  shareBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: INK_950,
    letterSpacing: 0.4,
  },
  foot: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 14,
    textAlign: 'center',
  },
  footStrong: {
    fontFamily: Fonts.jakartaExtraBold,
    color: '#F6D27A',
  },
});

const em = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 44,
  },
  handle: {
    width: 32, height: 3,
    backgroundColor: 'rgba(13,13,18,0.1)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 24,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: INK_950,
    marginBottom: 24,
    textAlign: 'center',
    letterSpacing: -0.2,
  },

  avatarWrap: { alignSelf: 'center', position: 'relative', marginBottom: 24 },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(232,181,48,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarPhoto: { width: 72, height: 72, borderRadius: 36 },
  avatarInitials: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 24,
    color: GOLD_500,
  },
  editBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: INK_950,
    alignItems: 'center', justifyContent: 'center',
  },
  editIcon: { color: '#fff', fontSize: 11 },

  field: { marginBottom: 18 },
  fieldLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: FG_2,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  input: {
    backgroundColor: 'rgba(17,12,17,0.04)',
    borderWidth: 0.5,
    borderColor: 'rgba(17,12,17,0.08)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: INK_950,
  },
  pillRow: { flexDirection: 'row', gap: 8 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: 'rgba(17,12,17,0.08)',
    backgroundColor: 'rgba(17,12,17,0.04)',
  },
  pillActive: { backgroundColor: INK_950, borderColor: INK_950 },
  pillText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: FG_2,
  },
  pillTextActive: { color: '#fff' },

  saveBtn: {
    backgroundColor: INK_950,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnText: { fontFamily: Fonts.jakartaBold, fontSize: 15, color: '#fff' },
  cancelBtn: { paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { fontFamily: Fonts.jakartaRegular, fontSize: 14, color: FG_2 },
});
