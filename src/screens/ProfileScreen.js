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
  linkToCoachByCodeForCategory,
  unlinkCoachForCategory,
  getMyCoachForCategory,
} from '../storage/storage';
import { supabase } from '../services/supabase/client';
import RadarChart from '../components/RadarChart';
import { useProfile } from '../context/ProfileContext';

const AVATAR_KEY = '@profile_photo';
const PROFILE_CACHE_KEY = '@cache_profile';
const HOME_CACHE_KEY = '@cache_home';

const RADAR_CATEGORIES = ['Stability', 'Technicality', 'Strength', 'Creativity', 'Musicality'];


// ─── CoachSlot ────────────────────────────────────────────────────────────────
// Renders either a linked coach row or a code-entry row.
function CoachSlot({ label, coach, code, onCodeChange, linking, linkError, onAdd, onUnlink }) {
  return (
    <View>
      {!!label && <Text style={coachStyles.slotLabel}>{label}</Text>}
      {coach ? (
        <View style={coachStyles.linkedRow}>
          <View style={coachStyles.coachAvatar}>
            <Text style={coachStyles.coachInitials}>
              {coach.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'}
            </Text>
          </View>
          <View style={coachStyles.coachInfo}>
            <Text style={coachStyles.coachName}>{coach.name}</Text>
            {!!coach.main_studio && <Text style={coachStyles.coachStudio}>{coach.main_studio}</Text>}
          </View>
          <TouchableOpacity onPress={onUnlink} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={18} color={Colors.secondary} />
          </TouchableOpacity>
        </View>
      ) : (
        <View>
          <View style={coachStyles.inputRow}>
            <TextInput
              style={coachStyles.codeInput}
              value={code}
              onChangeText={onCodeChange}
              placeholder="Invite code"
              placeholderTextColor="rgba(13,13,18,0.25)"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
            />
            <TouchableOpacity
              style={[coachStyles.addBtn, (!code?.trim() || linking) && coachStyles.addBtnDisabled]}
              onPress={onAdd}
              disabled={linking || !code?.trim()}
              activeOpacity={0.85}
            >
              {linking
                ? <ActivityIndicator color={Colors.white} size="small" />
                : <Ionicons name="arrow-forward" size={16} color={Colors.white} />
              }
            </TouchableOpacity>
          </View>
          {!!linkError && <Text style={coachStyles.linkError}>{linkError}</Text>}
        </View>
      )}
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
  const { setAvatarUri, setInitials } = useProfile();
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
  const [photoUri, _setPhotoUri] = useState(null);
  function setPhotoUri(uri) { _setPhotoUri(uri); setAvatarUri(uri); }
  const [myCoach, setMyCoach] = useState(null);
  const [coachCode, setCoachCode] = useState('');
  const [coachLinking, setCoachLinking] = useState(false);
  const [coachLinkError, setCoachLinkError] = useState('');
  const [pendingReviews, setPendingReviews] = useState(0);
  const [isTrainer, setIsTrainer] = useState(false);
  // Category-specific coaches (used when dance_style === 'Latin & Ballroom')
  const [latinCoach, setLatinCoach] = useState(null);
  const [ballroomCoach, setBallroomCoach] = useState(null);
  const [latinCode, setLatinCode] = useState('');
  const [ballroomCode, setBallroomCode] = useState('');
  const [latinLinking, setLatinLinking] = useState(false);
  const [ballroomLinking, setBallroomLinking] = useState(false);
  const [latinLinkError, setLatinLinkError] = useState('');
  const [ballroomLinkError, setBallroomLinkError] = useState('');

  async function load() {
    const [
      userData,
      classInputs,
      activeFocusPoints,
      topFocusPoints,
      { data: { session } },
      savedPhoto,
      coachData,
      latinCoachData,
      ballroomCoachData,
    ] = await Promise.all([
      getUser(),
      getClassInputs(),
      getFocusPoints(),
      getTopFocusPointsWithCounts(100),
      supabase.auth.getSession(),
      AsyncStorage.getItem(AVATAR_KEY),
      getMyCoach(),
      getMyCoachForCategory('latin'),
      getMyCoachForCategory('ballroom'),
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

    // Trainer-only: count pending reviews
    const trainerEmail = session?.user?.email;
    if (trainerEmail === 'loic@danceuniteduk.com') {
      setIsTrainer(true);
      try {
        const { count: pendingCount } = await supabase
          .from('ai_training_candidates')
          .select('id', { count: 'exact' })
          .eq('reviewed', false);
        setPendingReviews(pendingCount ?? 0);
      } catch {}
    } else {
      setIsTrainer(false);
      setPendingReviews(0);
    }

    // Count active focus points per category — more FPs = more to work on = lower score
    const catCounts = { Stability: 0, Technicality: 0, Strength: 0, Creativity: 0, Musicality: 0 };
    for (const fp of activeFocusPoints ?? []) {
      if (fp.category && catCounts[fp.category] !== undefined) catCounts[fp.category]++;
    }
    const maxCat = Math.max(...Object.values(catCounts), 1);
    const scores = RADAR_CATEGORIES.map((cat) => 1 - catCounts[cat] / maxCat);

    const stats = { totalClasses: classInputs?.length ?? 0, totalSessions, activeFocusAreas: activeFocusPoints?.length ?? 0 };
    setUser(userData);
    setStats(stats);
    setRadarScores(scores);
    if (userData?.name) {
      const ini = userData.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      setInitials(ini);
      AsyncStorage.setItem('@profile_name', userData.name).catch(() => {});
    }
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
    setLatinCoach(latinCoachData);
    setBallroomCoach(ballroomCoachData);
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
      base64: true,
    });
    if (result.canceled || !result.assets[0]?.uri) return;

    const asset = result.assets[0];
    const localUri = asset.uri;
    setPhotoUri(localUri); // optimistic update

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
    // Reload coaches after save — style change may switch between single/dual slot
    if (editStyle === 'Latin & Ballroom') {
      const [lc, bc] = await Promise.all([
        getMyCoachForCategory('latin'),
        getMyCoachForCategory('ballroom'),
      ]);
      setLatinCoach(lc);
      setBallroomCoach(bc);
    } else {
      // Switching back to single style — reload myCoach (reads latin_coach_id or ballroom_coach_id
      // based on the new dance_style, so the existing link is preserved)
      const coach = await getMyCoach();
      setMyCoach(coach);
    }
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

  async function handleLinkCoachForCategory(category) {
    const code = category === 'latin' ? latinCode : ballroomCode;
    if (!code.trim()) return;
    const setLinking = category === 'latin' ? setLatinLinking : setBallroomLinking;
    const setLinkError = category === 'latin' ? setLatinLinkError : setBallroomLinkError;
    const setCode = category === 'latin' ? setLatinCode : setBallroomCode;
    const setCoach = category === 'latin' ? setLatinCoach : setBallroomCoach;
    setLinking(true);
    setLinkError('');
    try {
      const { coach } = await linkToCoachByCodeForCategory(code, category);
      setCoach(coach);
      setCode('');
    } catch (e) {
      setLinkError(e.message || 'Could not link coach.');
    }
    setLinking(false);
  }

  async function handleUnlinkCoachForCategory(category) {
    await unlinkCoachForCategory(category);
    if (category === 'latin') setLatinCoach(null);
    else setBallroomCoach(null);
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

      {/* ── Fixed: Hero + Stats ── */}
      <View style={styles.fixedTop}>
        <View style={styles.heroSection}>
          <View style={styles.avatarWrap}>
            {photoUri
              ? <Image source={{ uri: photoUri }} style={styles.avatarPhoto} />
              : <View style={styles.avatar}><Text style={styles.avatarInitials}>{initials}</Text></View>
            }
          </View>

          <Text style={styles.name}>{user?.name || 'Your Name'}</Text>

          {!!user?.main_studio && (
            <Text style={styles.meta}>{user.main_studio}</Text>
          )}
          {!!user?.dance_style && (
            <Text style={styles.metaStyle}>{user.dance_style}</Text>
          )}
        </View>

        <View style={styles.statRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats.totalClasses}</Text>
            <Text style={styles.statLabel}>Classes</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats.totalSessions}</Text>
            <Text style={styles.statLabel}>Sessions</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats.activeFocusAreas}</Text>
            <Text style={styles.statLabel}>Focus Areas</Text>
          </View>
        </View>
      </View>

      {/* ── Scrollable: Teachers, Strengths, Logout ── */}
      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} showsVerticalScrollIndicator={false}>

        {/* ── Teacher(s) ── */}
        {user?.dance_style === 'Latin & Ballroom' ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Teachers</Text>
            <View style={styles.card}>
              <CoachSlot
                label="Latin"
                coach={latinCoach}
                code={latinCode}
                onCodeChange={text => setLatinCode(text.toUpperCase())}
                linking={latinLinking}
                linkError={latinLinkError}
                onAdd={() => handleLinkCoachForCategory('latin')}
                onUnlink={() => handleUnlinkCoachForCategory('latin')}
              />
              <View style={styles.cardSep} />
              <CoachSlot
                label="Ballroom"
                coach={ballroomCoach}
                code={ballroomCode}
                onCodeChange={text => setBallroomCode(text.toUpperCase())}
                linking={ballroomLinking}
                linkError={ballroomLinkError}
                onAdd={() => handleLinkCoachForCategory('ballroom')}
                onUnlink={() => handleUnlinkCoachForCategory('ballroom')}
              />
            </View>
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Teacher</Text>
            <View style={styles.card}>
              <CoachSlot
                coach={myCoach}
                code={coachCode}
                onCodeChange={text => setCoachCode(text.toUpperCase())}
                linking={coachLinking}
                linkError={coachLinkError}
                onAdd={handleLinkCoach}
                onUnlink={handleUnlinkCoach}
              />
            </View>
          </View>
        )}

        {/* ── Strengths ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Strengths</Text>
          <View style={styles.card}>
            <RadarChart scores={radarScores} />
          </View>
        </View>

        {/* ── Logout ── */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.5}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>

        {/* ── Trainer review badge ── */}
        {isTrainer && pendingReviews > 0 && (
          <TouchableOpacity
            style={styles.trainerReviewBtn}
            onPress={() => navigation.navigate('TrainerReview')}
            activeOpacity={0.8}
          >
            <Text style={styles.trainerReviewText}>
              {`\uD83E\uDDE0 ${pendingReviews} focus point${pendingReviews === 1 ? '' : 's'} to review`}
            </Text>
          </TouchableOpacity>
        )}

        {/* ── Trainer: students & focus point scores ── */}
        {isTrainer && (
          <TouchableOpacity
            style={styles.trainerStudentsBtn}
            onPress={() => navigation.navigate('TrainerStudents')}
            activeOpacity={0.8}
          >
            <Text style={styles.trainerStudentsText}>
              {'\uD83D\uDCCA  Students & scores'}
            </Text>
          </TouchableOpacity>
        )}

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

  fixedTop: {
    paddingTop: 4,
  },

  content: { flex: 1 },
  contentInner: {
    paddingHorizontal: Spacing.side,
    paddingTop: 28,
    paddingBottom: 56,
    gap: 28,
  },

  // ── Hero ──
  heroSection: { alignItems: 'center', paddingTop: 0, paddingBottom: 24, paddingHorizontal: Spacing.side },
  avatarWrap: { position: 'relative', marginBottom: 14 },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(255,157,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPhoto: { width: 88, height: 88, borderRadius: 44 },
  avatarInitials: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 30,
    color: Colors.orange,
  },
  name: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
    color: Colors.black,
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  meta: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    textAlign: 'center',
  },
  metaStyle: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: Colors.secondary,
    textAlign: 'center',
    marginTop: 3,
    opacity: 0.7,
  },

  // ── Stats ──
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 20,
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: Colors.statCardBorder,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statDivider: {
    width: 0.5,
    height: 32,
    backgroundColor: Colors.statCardBorder,
  },
  statValue: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 24,
    color: Colors.black,
    marginBottom: 2,
    letterSpacing: -0.5,
  },
  statLabel: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11,
    color: Colors.secondary,
  },

  // ── Sections ──
  section: { gap: 10 },
  sectionTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  card: {
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 0,
  },
  cardSep: {
    height: 0.5,
    backgroundColor: Colors.statCardBorder,
    marginVertical: 14,
  },

  // ── Logout ──
  logoutBtn: { alignItems: 'center', paddingVertical: 8 },
  logoutText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
  },

  // ── Trainer review badge ──
  trainerReviewBtn: {
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FF9D00',
    backgroundColor: 'rgba(255,157,0,0.06)',
  },
  trainerReviewText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: '#FF9D00',
  },
  trainerStudentsBtn: {
    alignSelf: 'center',
    marginTop: 10,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    backgroundColor: 'rgba(0,0,0,0.035)',
  },
  trainerStudentsText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: '#141414',
  },
});

const em = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.white,
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
    color: Colors.black,
    marginBottom: 24,
    textAlign: 'center',
    letterSpacing: -0.2,
  },

  avatarWrap: { alignSelf: 'center', position: 'relative', marginBottom: 24 },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,157,0,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarPhoto: { width: 72, height: 72, borderRadius: 36 },
  avatarInitials: { fontFamily: Fonts.jakartaExtraBold, fontSize: 24, color: Colors.orange },
  editBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.black,
    alignItems: 'center', justifyContent: 'center',
  },
  editIcon: { color: Colors.white, fontSize: 11 },

  field: { marginBottom: 18 },
  fieldLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
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
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    backgroundColor: Colors.statCardBg,
  },
  pillActive: { backgroundColor: Colors.black, borderColor: Colors.black },
  pillText: { fontFamily: Fonts.jakartaMedium, fontSize: 13, color: Colors.secondary },
  pillTextActive: { color: Colors.white },

  saveBtn: {
    backgroundColor: Colors.black,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnText: { fontFamily: Fonts.jakartaBold, fontSize: 15, color: Colors.white },
  cancelBtn: { paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { fontFamily: Fonts.jakartaRegular, fontSize: 14, color: Colors.secondary },

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
  slotLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },

  // Linked state
  linkedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  coachAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,157,0,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachInitials: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: Colors.orange,
  },
  coachInfo: { flex: 1 },
  coachName: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 14,
    color: Colors.black,
  },
  coachStudio: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
    marginTop: 1,
  },

  // Code-entry state
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  codeInput: {
    flex: 1,
    backgroundColor: Colors.background,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: Colors.black,
    letterSpacing: 2,
  },
  addBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: Colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: { backgroundColor: Colors.statCardBorder },
  linkError: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: '#E84040',
    marginTop: 6,
  },
});
