import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Animated,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import TabHeader from '../components/TabHeader';
import ProfileSkeleton from '../components/ProfileSkeleton';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Fonts, Spacing } from '../theme';
import {
  getUser,
  getClassInputs,
  getFocusPoints,
  getTopFocusPointsWithCounts,
  saveUserProfile,
  getMyCoach,
  linkToCoachByCode,
  unlinkCoach,
} from '../storage/storage';
import { supabase } from '../services/supabase/client';
import RadarChart from '../components/RadarChart';

const AVATAR_KEY = '@profile_photo';
const PROFILE_CACHE_KEY = '@cache_profile';
const HOME_CACHE_KEY = '@cache_home';

const RADAR_CATEGORIES = ['Stability', 'Technicality', 'Strength', 'Creativity', 'Musicality'];
// Checked in order of specificity — most specific first to avoid greedy matches
const CATEGORY_KEYWORDS = {
  Musicality:   ['music', 'rhythm', 'beat', 'tempo', 'phrasing', 'accent', 'musical', 'syncopation'],
  Creativity:   ['expression', 'artistry', 'performance', 'character', 'style', 'interpret', 'emotion', 'feeling', 'presentation'],
  Strength:     ['power', 'drive', 'energy', 'speed', 'strength', 'push', 'pull', 'force', 'endurance', 'stamina'],
  Technicality: ['footwork', 'technique', 'step', 'action', 'rise', 'fall', 'swing', 'sway', 'rotation', 'turn', 'cbm', 'heel', 'toe', 'alignment', 'lead', 'follow', 'timing', 'contra'],
  Stability:    ['balance', 'posture', 'hold', 'frame', 'weight', 'hip', 'standing', 'stable', 'grounding', 'position'],
};
const CATEGORY_CHECK_ORDER = ['Musicality', 'Creativity', 'Strength', 'Technicality', 'Stability'];

function categorizeFocus(name) {
  const lower = (name || '').toLowerCase();
  for (const cat of CATEGORY_CHECK_ORDER) {
    if (CATEGORY_KEYWORDS[cat].some((kw) => lower.includes(kw))) return cat;
  }
  return null; // unmatched — does not inflate any category
}


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

const PLACES_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;

function PlacesInput({ value, onChangeText, onPlaceSelect }) {
  const [suggestions, setSuggestions] = useState([]);
  const debounceRef = useRef(null);

  function handleChange(text) {
    onChangeText(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!PLACES_KEY || !text || text.length < 2) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(text)}&types=establishment&key=${PLACES_KEY}`;
        const res = await fetch(url);
        const json = await res.json();
        setSuggestions(json.predictions?.slice(0, 5) || []);
      } catch { setSuggestions([]); }
    }, 350);
  }

  function handleSelect(p) {
    const name = p.structured_formatting?.main_text || p.description;
    onChangeText(name);
    setSuggestions([]);
    onPlaceSelect(name, p.place_id);
  }

  return (
    <View>
      <TextInput
        style={em.input}
        value={value}
        onChangeText={handleChange}
        placeholder="Search for a studio or address"
        placeholderTextColor="rgba(17,12,17,0.3)"
        autoCorrect={false}
      />
      {suggestions.length > 0 && (
        <View style={em.suggestions}>
          {suggestions.map((p) => (
            <TouchableOpacity key={p.place_id} style={em.suggestion} onPress={() => handleSelect(p)} activeOpacity={0.7}>
              <Text style={em.suggestionMain} numberOfLines={1}>{p.structured_formatting?.main_text || p.description}</Text>
              {!!p.structured_formatting?.secondary_text && (
                <Text style={em.suggestionSub} numberOfLines={1}>{p.structured_formatting.secondary_text}</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

export default function ProfileScreen({ navigation }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [isLoading, setIsLoading] = useState(true);
  const hasLoadedRef = useRef(false);
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({ totalClasses: 0, totalSessions: 0, activeFocusAreas: 0 });
  const [radarScores, setRadarScores] = useState([0, 0, 0, 0, 0]);
  const [editVisible, setEditVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editStudio, setEditStudio] = useState('');
  const [editStudioPlaceId, setEditStudioPlaceId] = useState(null);
  const [editStyle, setEditStyle] = useState('');
  const [saving, setSaving] = useState(false);
  const [photoUri, setPhotoUri] = useState(null);
  const [myCoach, setMyCoach] = useState(null);
  const [coachCode, setCoachCode] = useState('');
  const [coachLinking, setCoachLinking] = useState(false);
  const [coachLinkError, setCoachLinkError] = useState('');

  async function load() {
    const [
      userData,
      classInputs,
      activeFocusPoints,
      topFocusPoints,
      { data: { session } },
      savedPhoto,
      coachData,
    ] = await Promise.all([
      getUser(),
      getClassInputs(),
      getFocusPoints(),
      getTopFocusPointsWithCounts(100),
      supabase.auth.getSession(),
      AsyncStorage.getItem(AVATAR_KEY),
      getMyCoach(),
    ]);

    let totalSessions = 0;
    if (session?.user?.id) {
      const { count } = await supabase
        .from('practice_logs')
        .select('id', { count: 'exact' })
        .eq('student_id', session.user.id)
        .not('completed_at', 'is', null);
      totalSessions = count ?? 0;
    }

    const top = topFocusPoints ?? [];
    const catCounts = { Stability: 0, Technicality: 0, Strength: 0, Creativity: 0, Musicality: 0 };
    for (const fp of top) {
      const cat = categorizeFocus(fp.name);
      if (cat) catCounts[cat] += fp.count;
    }
    const maxCat = Math.max(...Object.values(catCounts), 1);
    const scores = RADAR_CATEGORIES.map((cat) => catCounts[cat] / maxCat);

    const stats = { totalClasses: classInputs?.length ?? 0, totalSessions, activeFocusAreas: activeFocusPoints?.length ?? 0 };
    setUser(userData);
    setStats(stats);
    setRadarScores(scores);
    // Prefer remote avatar_url from DB; fallback to cached local URI
    const remoteAvatar = userData?.avatar_url
      ? `${userData.avatar_url}?t=${Math.floor(Date.now() / 60000)}` // 1-min cache busting
      : null;
    const avatarToShow = remoteAvatar || savedPhoto || null;
    if (avatarToShow) {
      setPhotoUri(avatarToShow);
      if (remoteAvatar) await AsyncStorage.setItem(AVATAR_KEY, remoteAvatar).catch(() => {});
    }
    setMyCoach(coachData);
    AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ user: userData, stats, radarScores: scores, myCoach: coachData })).catch(() => {});
  }

  useFocusEffect(useCallback(() => {
    const isFirst = !hasLoadedRef.current;
    if (isFirst) setIsLoading(true);
    async function init() {
      if (isFirst) {
        try {
          const raw = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
          if (raw) {
            const c = JSON.parse(raw);
            setUser(c.user);
            setStats(c.stats || { totalClasses: 0, totalSessions: 0, activeFocusAreas: 0 });
            setRadarScores(c.radarScores || [0, 0, 0, 0, 0]);
            setMyCoach(c.myCoach ?? null);
            setIsLoading(false);
          }
        } catch {}
      }
      try { await load(); } catch {}
      hasLoadedRef.current = true;
      setIsLoading(false);
      if (isFirst) {
        fadeAnim.setValue(0);
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      }
    }
    init();
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
    if (result.canceled || !result.assets[0]?.uri) return;

    const localUri = result.assets[0].uri;
    setPhotoUri(localUri); // optimistic update

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error('Not authenticated');

      // Read file as blob
      const response = await fetch(localUri);
      const blob = await response.blob();
      const ext = localUri.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${userId}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { upsert: true, contentType: `image/${ext}` });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(path);

      // Bust cache by appending timestamp
      const urlWithCache = `${publicUrl}?t=${Date.now()}`;

      // Save to DB and local cache
      await supabase.from('users').update({ avatar_url: publicUrl }).eq('id', userId);
      await AsyncStorage.setItem(AVATAR_KEY, urlWithCache);
      setPhotoUri(urlWithCache);
    } catch (e) {
      console.error('Avatar upload failed:', e);
      // Keep the optimistic local URI on failure
      await AsyncStorage.setItem(AVATAR_KEY, localUri);
    }
  }

  function openEdit() {
    setEditName(user?.name || '');
    setEditStudio(user?.main_studio || '');
    setEditStudioPlaceId(user?.main_studio_place_id || null);
    setEditStyle(user?.dance_style || '');
    setEditVisible(true);
  }

  async function handleSaveProfile() {
    if (saving) return;
    setSaving(true);
    const name = editName.trim();
    const main_studio = editStudio.trim();
    await saveUserProfile({ name, main_studio, main_studio_place_id: editStudioPlaceId, dance_style: editStyle });
    setUser(prev => ({ ...prev, name, main_studio, main_studio_place_id: editStudioPlaceId, dance_style: editStyle }));
    setSaving(false);
    setEditVisible(false);
  }

  async function handleLogout() {
    await AsyncStorage.multiRemove(['@cache_log', HOME_CACHE_KEY, PROFILE_CACHE_KEY]);
    await supabase.auth.signOut();
  }

  async function handleLinkCoach() {
    if (!coachCode.trim()) return;
    setCoachLinking(true);
    setCoachLinkError('');
    try {
      const { coach } = await linkToCoachByCode(coachCode);
      setMyCoach(coach);
      setCoachCode('');
    } catch (e) {
      setCoachLinkError(e.message || 'Could not link coach.');
    }
    setCoachLinking(false);
  }

  async function handleUnlinkCoach() {
    await unlinkCoach();
    setMyCoach(null);
  }

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : 'AL';

  if (isLoading) {
    return <ProfileSkeleton />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
      <TabHeader navigation={navigation} onProfilePress={openEdit} editMode />

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} showsVerticalScrollIndicator={false}>
        {/* Avatar + name */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarWrap}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.avatarPhoto} />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            )}
          </View>
          <Text style={styles.name}>{user?.name || 'Alexandra Lukey'}</Text>
          <Text style={styles.contact}>{user?.email || 'youremail@domain.com'}</Text>
          {!!user?.main_studio && (
            <Text style={styles.infoLine}>📍 {user.main_studio}</Text>
          )}
          {!!user?.dance_style && (
            <Text style={styles.infoLine}>{user.dance_style}</Text>
          )}
        </View>

        {/* 3-stat row */}
        <View style={styles.statCard}>
          <StatBox value={stats.totalClasses} label="Classes Logged" />
          <StatBox value={stats.totalSessions} label="Training Sessions" showDivider />
          <StatBox value={stats.activeFocusAreas} label="Active Focus" showDivider />
        </View>

        {/* Main Teacher */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Main Teacher</Text>
          {myCoach ? (
            <View style={coachStyles.linkedCard}>
              <View style={coachStyles.linkedInfo}>
                <Text style={coachStyles.linkedName}>{myCoach.name}</Text>
                {!!myCoach.main_studio && (
                  <Text style={coachStyles.linkedSub}>{myCoach.main_studio}</Text>
                )}
              </View>
              <TouchableOpacity onPress={handleUnlinkCoach} activeOpacity={0.7}>
                <Text style={coachStyles.unlinkText}>Unlink</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <View style={coachStyles.codeRow}>
                <TextInput
                  style={coachStyles.codeInput}
                  value={coachCode}
                  onChangeText={text => setCoachCode(text.toUpperCase())}
                  placeholder="Coach code (e.g. MARC42)"
                  placeholderTextColor={Colors.secondary}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={8}
                />
                <TouchableOpacity
                  style={[coachStyles.addBtn, !coachCode.trim() && coachStyles.addBtnDisabled]}
                  onPress={handleLinkCoach}
                  disabled={coachLinking || !coachCode.trim()}
                  activeOpacity={0.85}
                >
                  {coachLinking
                    ? <ActivityIndicator color={Colors.white} size="small" />
                    : <Text style={coachStyles.addBtnText}>Add</Text>
                  }
                </TouchableOpacity>
              </View>
              {!!coachLinkError && (
                <Text style={coachStyles.linkError}>{coachLinkError}</Text>
              )}
              <Text style={coachStyles.codeHint}>
                Ask your coach for their invite code.
              </Text>
            </View>
          )}
        </View>

        {/* Radar chart */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Current Strengths</Text>
          <View style={styles.chartCard}>
            <RadarChart scores={radarScores} />
          </View>
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
      {/* Edit Profile Modal */}
      <Modal visible={editVisible} transparent animationType="slide" onRequestClose={() => setEditVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={em.overlay} onPress={() => setEditVisible(false)}>
            <Pressable style={em.sheet} onPress={() => {}}>
              <View style={em.handle} />
              <Text style={em.title}>Edit Profile</Text>

              {/* Avatar */}
              <TouchableOpacity style={em.avatarWrap} onPress={handlePickPhoto} activeOpacity={0.85}>
                {photoUri
                  ? <Image source={{ uri: photoUri }} style={em.avatarPhoto} />
                  : <View style={em.avatar}><Text style={em.avatarInitials}>{initials}</Text></View>
                }
                <View style={em.editBadge}><Text style={em.editIcon}>✎</Text></View>
              </TouchableOpacity>

              {/* Name */}
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

              {/* Main Studio */}
              <View style={em.field}>
                <Text style={em.fieldLabel}>Main Studio</Text>
                <PlacesInput
                  value={editStudio}
                  onChangeText={setEditStudio}
                  onPlaceSelect={(name, placeId) => {
                    setEditStudio(name);
                    setEditStudioPlaceId(placeId || null);
                  }}
                />
              </View>

              {/* Dance Style */}
              <View style={em.field}>
                <Text style={em.fieldLabel}>Dance Style</Text>
                <View style={em.pillRow}>
                  {['Latin', 'Ballroom', 'Latin & Ballroom'].map((s) => (
                    <TouchableOpacity
                      key={s}
                      style={[em.pill, editStyle === s && em.pillActive]}
                      onPress={() => setEditStyle(s)}
                      activeOpacity={0.75}
                    >
                      <Text style={[em.pillText, editStyle === s && em.pillTextActive]}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Actions */}
              <TouchableOpacity style={em.saveBtn} onPress={handleSaveProfile} activeOpacity={0.88} disabled={saving}>
                <Text style={em.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={em.cancelBtn} onPress={() => setEditVisible(false)} activeOpacity={0.7}>
                <Text style={em.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      </Animated.View>
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
  notifBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
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
  profilePhoto: { width: 34, height: 34, borderRadius: 17 },

  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 40,
    gap: 20,
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
  infoLine: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
    opacity: 0.75,
    marginTop: 3,
    textAlign: 'center',
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

  editProfileBtn: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: Colors.activeFocus,
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

const em = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 40,
  },
  handle: {
    width: 36, height: 4,
    backgroundColor: 'rgba(17,12,17,0.12)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: Colors.black,
    marginBottom: 20,
    textAlign: 'center',
  },

  avatarWrap: { alignSelf: 'center', position: 'relative', marginBottom: 24 },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(215,150,255,0.2)',
    borderWidth: 3, borderColor: Colors.profileIcon,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarPhoto: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: Colors.profileIcon },
  avatarInitials: { fontFamily: Fonts.jakartaExtraBold, fontSize: 24, color: '#7A4A00' },
  editBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: Colors.black,
    alignItems: 'center', justifyContent: 'center',
  },
  editIcon: { color: Colors.white, fontSize: 12 },

  field: { marginBottom: 16 },
  fieldLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  input: {
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: Colors.black,
  },

  pillRow: { flexDirection: 'row', gap: 8 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.statCardBorder,
    backgroundColor: Colors.statCardBg,
  },
  pillActive: { backgroundColor: Colors.black, borderColor: Colors.black },
  pillText: { fontFamily: Fonts.jakartaMedium, fontSize: 13, color: Colors.secondary },
  pillTextActive: { color: Colors.white },

  saveBtn: {
    backgroundColor: Colors.orange,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnText: { fontFamily: Fonts.jakartaExtraBold, fontSize: 15, color: '#000' },
  cancelBtn: { paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { fontFamily: Fonts.jakartaMedium, fontSize: 14, color: Colors.secondary },

  suggestions: {
    backgroundColor: Colors.white,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderRadius: 12,
    marginTop: 4,
    overflow: 'hidden',
  },
  suggestion: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.statCardBorder,
  },
  suggestionMain: { fontFamily: Fonts.jakartaMedium, fontSize: 14, color: Colors.black },
  suggestionSub: { fontFamily: Fonts.jakartaRegular, fontSize: 11, color: Colors.secondary, marginTop: 1 },
});

const coachStyles = StyleSheet.create({
  linkedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  linkedInfo: { flex: 1 },
  linkedName: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 14,
    color: Colors.black,
  },
  linkedSub: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
    marginTop: 2,
  },
  unlinkText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: Colors.secondary,
  },
  codeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  codeInput: {
    flex: 1,
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.jakartaMedium,
    fontSize: 15,
    color: Colors.black,
    letterSpacing: 1.5,
  },
  addBtn: {
    backgroundColor: Colors.black,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: {
    backgroundColor: Colors.statCardBorder,
  },
  addBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: Colors.white,
  },
  linkError: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: '#E84040',
    marginTop: 6,
  },
  codeHint: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
    marginTop: 8,
  },
});
