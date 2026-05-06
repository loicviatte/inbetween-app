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
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
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
  saveUserProfile,
  getMyCoach,
  linkToCoachByCode,
  unlinkCoach,
  linkToCoachByCodeForCategory,
  unlinkCoachForCategory,
  getMyCoachForCategory,
  getLessonReadiness,
} from '../storage/storage';
import { supabase } from '../services/supabase/client';
import RadarChart, { RADAR_LABELS } from '../components/RadarChart';
import { useProfile } from '../context/ProfileContext';

const AVATAR_KEY = '@profile_photo';
const PROFILE_CACHE_KEY = '@cache_profile';
const HOME_CACHE_KEY = '@cache_home';

const RADAR_CATEGORIES = ['Stability', 'Technicality', 'Strength', 'Creativity', 'Musicality'];

// ─── Readiness meter (semi-circle SVG ring) ──────────────────────────────────
function ReadinessMeter({ percent = 0, size = 84, stroke = 6 }) {
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, percent)) / 100) * circumference;
  const remainder = circumference - filled;
  return (
    <View style={[meterStyles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        {/* Track */}
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke="rgba(255,255,255,0.10)"
          strokeWidth={stroke}
          fill="none"
        />
        {/* Fill */}
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke="#E8B530"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${filled} ${remainder}`}
          strokeLinecap="round"
        />
      </Svg>
      <View style={meterStyles.inner} />
      <View style={meterStyles.labelWrap}>
        <Text style={meterStyles.pct}>
          {Math.round(percent)}<Text style={meterStyles.pctSm}>%</Text>
        </Text>
      </View>
    </View>
  );
}

// ─── Focus row inside readiness card ─────────────────────────────────────────
function FocusReadyRow({ row, isLast }) {
  if (!row) return null;
  const partial = row.done > 0;
  const labelText = row.kind === 'primary' ? 'Primary focus · from last private' : 'Secondary focus · from last private';
  return (
    <View style={[ready.focusRow, !isLast && ready.focusRowBorder]}>
      <View style={[ready.check, partial && ready.checkPartial]}>
        {partial ? (
          <Ionicons name="checkmark" size={11} color="#F6D27A" />
        ) : (
          <View />
        )}
      </View>
      <View style={ready.focusBody}>
        <Text style={ready.focusName} numberOfLines={1}>{row.name}</Text>
        <Text style={ready.focusMeta} numberOfLines={1}>{labelText}</Text>
      </View>
      <Text style={ready.focusProgress}>
        {row.done}<Text style={ready.focusProgressOf}>/{row.target}</Text>
      </Text>
    </View>
  );
}

// ─── CoachSlot — compact row for the glance card ──────────────────────────────
function GlanceTeacher({ category, coach, onPress }) {
  const isAdd = !coach;
  const isPending = !!coach?.pending;
  const initials = coach?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '+';
  const displayName = isPending
    ? 'Waiting to accept…'
    : (coach?.name || 'Add teacher');
  const muted = isAdd || isPending;
  return (
    <TouchableOpacity style={glance.tCard} onPress={onPress} activeOpacity={0.75}>
      <View style={[glance.tAvatar, muted && glance.tAvatarAdd]}>
        <Text style={[glance.tAvatarText, muted && glance.tAvatarTextAdd]}>{initials}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[glance.tDance, muted && glance.tDanceAdd]}>{category.toUpperCase()}</Text>
        <Text style={[glance.tName, muted && glance.tNameAdd]} numberOfLines={1}>
          {displayName}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Old CoachSlot (for the edit-modal flow / single-style users) ────────────
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
            {coach.pending
              ? <Text style={coachStyles.coachStudio}>Waiting for {coach.name?.split(' ')[0] || 'coach'} to accept…</Text>
              : (!!coach.main_studio && <Text style={coachStyles.coachStudio}>{coach.main_studio}</Text>)
            }
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
  const [readiness, setReadiness] = useState(null);
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
  const [latinCoach, setLatinCoach] = useState(null);
  const [ballroomCoach, setBallroomCoach] = useState(null);
  const [latinCode, setLatinCode] = useState('');
  const [ballroomCode, setBallroomCode] = useState('');
  const [latinLinking, setLatinLinking] = useState(false);
  const [ballroomLinking, setBallroomLinking] = useState(false);
  const [latinLinkError, setLatinLinkError] = useState('');
  const [ballroomLinkError, setBallroomLinkError] = useState('');
  const [coachModal, setCoachModal] = useState(null); // { category: 'latin' | 'ballroom' | null }

  async function load() {
    const [
      userData,
      classInputs,
      activeFocusPoints,
      { data: { session } },
      savedPhoto,
      coachData,
      latinCoachData,
      ballroomCoachData,
      readinessValue,
    ] = await Promise.all([
      getUser(),
      getClassInputs(),
      getFocusPoints(),
      supabase.auth.getSession(),
      AsyncStorage.getItem(AVATAR_KEY),
      getMyCoach(),
      getMyCoachForCategory('latin'),
      getMyCoachForCategory('ballroom'),
      getLessonReadiness().catch(() => null),
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

    // Radar — fewer active focuses per category = stronger area
    const catCounts = { Stability: 0, Technicality: 0, Strength: 0, Creativity: 0, Musicality: 0 };
    for (const fp of activeFocusPoints ?? []) {
      if (fp.category && catCounts[fp.category] !== undefined) catCounts[fp.category]++;
    }
    const maxCat = Math.max(...Object.values(catCounts), 1);
    const scores = RADAR_CATEGORIES.map((cat) => 1 - catCounts[cat] / maxCat);

    const s = {
      totalClasses: classInputs?.length ?? 0,
      totalSessions,
      activeFocusAreas: activeFocusPoints?.length ?? 0,
    };
    setUser(userData);
    setStats(s);
    setRadarScores(scores);
    setReadiness(readinessValue);
    if (userData?.name) {
      const ini = userData.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      setInitials(ini);
      AsyncStorage.setItem('@profile_name', userData.name).catch(() => {});
    }
    const remoteAvatar = userData?.avatar_url
      ? `${userData.avatar_url}?t=${Math.floor(Date.now() / 60000)}`
      : null;
    const avatarToShow = remoteAvatar || savedPhoto || null;
    if (avatarToShow) {
      setPhotoUri(avatarToShow);
      if (remoteAvatar) await AsyncStorage.setItem(AVATAR_KEY, remoteAvatar).catch(() => {});
    }
    setMyCoach(coachData);
    setLatinCoach(latinCoachData);
    setBallroomCoach(ballroomCoachData);
    AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({
      user: userData,
      stats: s,
      radarScores: scores,
      myCoach: coachData,
      readiness: readinessValue,
    })).catch(() => {});
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
            setReadiness(c.readiness || null);
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
    if (editStyle === 'Latin & Ballroom') {
      const [lc, bc] = await Promise.all([
        getMyCoachForCategory('latin'),
        getMyCoachForCategory('ballroom'),
      ]);
      setLatinCoach(lc);
      setBallroomCoach(bc);
    } else {
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
      setCoachModal(null);
    } catch (e) {
      setCoachLinkError(e.message || 'Could not link coach.');
    }
    setCoachLinking(false);
  }

  async function handleUnlinkCoach() {
    await unlinkCoach();
    setMyCoach(null);
    setCoachModal(null);
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
      setCoachModal(null);
    } catch (e) {
      setLinkError(e.message || 'Could not link coach.');
    }
    setLinking(false);
  }

  async function handleUnlinkCoachForCategory(category) {
    await unlinkCoachForCategory(category);
    if (category === 'latin') setLatinCoach(null);
    else setBallroomCoach(null);
    setCoachModal(null);
  }

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : 'AL';

  // Strongest radar area — for the strengths-card footer + the larger vertex
  const strongestIdx = radarScores.reduce(
    (best, s, i, arr) => (s > arr[best] ? i : best),
    0
  );
  const strongestLabel = RADAR_LABELS[strongestIdx];

  const isDual = user?.dance_style === 'Latin & Ballroom';

  const readinessTitle = (() => {
    if (!readiness) return 'Log your last private to start.';
    if (readiness.percent >= 100) return 'Ready for your next private.';
    if (readiness.percent >= 50) return 'Almost ready for your next private.';
    return 'Train your focus points to get ready.';
  })();

  const readinessSubtitle = (() => {
    if (!readiness) return 'After a class log, your focus targets show up here.';
    if (readiness.minutesRemaining === 0) {
      return `Both focus points trained — keep the streak going.`;
    }
    return `Train your two focus points from the last lesson — ~${readiness.minutesRemaining} min to go.`;
  })();

  if (isLoading) {
    return <ProfileSkeleton />;
  }

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
          <TabHeader navigation={navigation} onProfilePress={openEdit} editMode />

          {/* ── Fixed top — never scrolls ── */}
          <View style={styles.fixedTop}>
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

              <Text style={styles.name} numberOfLines={1}>{user?.name || 'Your Name'}</Text>

              {!!user?.main_studio && (
                <Text style={styles.studioName} numberOfLines={1} ellipsizeMode="tail">
                  {user.main_studio}
                </Text>
              )}
              {!!user?.dance_style && (
                <Text style={styles.danceStyle} numberOfLines={1}>
                  {user.dance_style}
                </Text>
              )}
            </View>

            <View style={glance.card}>
              <View style={glance.statsRow}>
                <View style={glance.cell}>
                  <Text style={glance.cellNum}>{stats.totalClasses}</Text>
                  <Text style={glance.cellLbl}>Classes</Text>
                </View>
                <View style={glance.cellDivider} />
                <View style={glance.cell}>
                  <Text style={glance.cellNum}>{stats.totalSessions}</Text>
                  <Text style={glance.cellLbl}>Sessions</Text>
                </View>
                <View style={glance.cellDivider} />
                <View style={glance.cell}>
                  <Text style={glance.cellNum}>{stats.activeFocusAreas}</Text>
                  <Text style={glance.cellLbl}>Focus</Text>
                </View>
              </View>

              <View style={glance.statsBorder} />

              {isDual ? (
                <View style={glance.teachersRow}>
                  <GlanceTeacher
                    category="Latin"
                    coach={latinCoach}
                    onPress={() => setCoachModal({ category: 'latin' })}
                  />
                  <View style={glance.teachersDivider} />
                  <GlanceTeacher
                    category="Ballroom"
                    coach={ballroomCoach}
                    onPress={() => setCoachModal({ category: 'ballroom' })}
                  />
                </View>
              ) : (
                <View style={glance.teachersRow}>
                  <GlanceTeacher
                    category={user?.dance_style || 'Teacher'}
                    coach={myCoach}
                    onPress={() => setCoachModal({ category: null })}
                  />
                </View>
              )}
            </View>
          </View>

          {/* ── Scrollable from Lesson Readiness onward ── */}
          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentInner}
            showsVerticalScrollIndicator={false}
            bounces={false}
            overScrollMode="never"
          >
            <View style={styles.section}>
              <View style={styles.sectionRow}>
                <Text style={styles.sectionLabel}>LESSON READINESS</Text>
                <View style={styles.sectionRule} />
              </View>

              <View style={ready.card}>
                <View style={ready.meterRow}>
                  <ReadinessMeter percent={readiness?.percent || 0} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={ready.title}>{readinessTitle}</Text>
                    <Text style={ready.subtitle}>{readinessSubtitle}</Text>
                  </View>
                </View>

                <View style={ready.divider} />

                {readiness?.primary && <FocusReadyRow row={readiness.primary} />}
                {readiness?.secondary && (
                  <FocusReadyRow row={readiness.secondary} isLast />
                )}
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionRow}>
                <Text style={styles.sectionLabel}>STRENGTHS</Text>
                <View style={styles.sectionRule} />
                <Text style={styles.sectionRight}>Last 30 days</Text>
              </View>

              <View style={strengths.card}>
                <RadarChart scores={radarScores} strongestIndex={strongestIdx} />
              </View>
            </View>

            {isTrainer && pendingReviews > 0 && (
              <TouchableOpacity
                style={styles.trainerReviewBtn}
                onPress={() => navigation.navigate('TrainerReview')}
                activeOpacity={0.8}
              >
                <Text style={styles.trainerReviewText}>
                  {`🧠 ${pendingReviews} focus point${pendingReviews === 1 ? '' : 's'} to review`}
                </Text>
              </TouchableOpacity>
            )}

            {isTrainer && (
              <TouchableOpacity
                style={styles.trainerStudentsBtn}
                onPress={() => navigation.navigate('TrainerStudents')}
                activeOpacity={0.8}
              >
                <Text style={styles.trainerStudentsText}>
                  {'📊  Students & scores'}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.7}>
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

                  <TouchableOpacity style={em.avatarWrap} onPress={handlePickPhoto} activeOpacity={0.85}>
                    {photoUri
                      ? <Image source={{ uri: photoUri }} style={em.avatarPhoto} />
                      : <View style={em.avatar}><Text style={em.avatarInitials}>{initials}</Text></View>
                    }
                    <View style={em.editBadge}><Text style={em.editIcon}>✎</Text></View>
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

          {/* Coach Linking Modal — opens when tapping a teacher slot */}
          <Modal visible={!!coachModal} transparent animationType="slide" onRequestClose={() => setCoachModal(null)}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
              <Pressable style={em.overlay} onPress={() => setCoachModal(null)}>
                <Pressable style={em.sheet} onPress={() => {}}>
                  <View style={em.handle} />
                  <Text style={em.title}>
                    {coachModal?.category === 'latin' ? 'Latin Teacher'
                      : coachModal?.category === 'ballroom' ? 'Ballroom Teacher'
                      : 'Teacher'}
                  </Text>

                  {coachModal && (coachModal.category === null ? (
                    <CoachSlot
                      coach={myCoach}
                      code={coachCode}
                      onCodeChange={(t) => setCoachCode(t.toUpperCase())}
                      linking={coachLinking}
                      linkError={coachLinkError}
                      onAdd={handleLinkCoach}
                      onUnlink={handleUnlinkCoach}
                    />
                  ) : coachModal.category === 'latin' ? (
                    <CoachSlot
                      coach={latinCoach}
                      code={latinCode}
                      onCodeChange={(t) => setLatinCode(t.toUpperCase())}
                      linking={latinLinking}
                      linkError={latinLinkError}
                      onAdd={() => handleLinkCoachForCategory('latin')}
                      onUnlink={() => handleUnlinkCoachForCategory('latin')}
                    />
                  ) : (
                    <CoachSlot
                      coach={ballroomCoach}
                      code={ballroomCode}
                      onCodeChange={(t) => setBallroomCode(t.toUpperCase())}
                      linking={ballroomLinking}
                      linkError={ballroomLinkError}
                      onAdd={() => handleLinkCoachForCategory('ballroom')}
                      onUnlink={() => handleUnlinkCoachForCategory('ballroom')}
                    />
                  ))}

                  <TouchableOpacity style={[em.cancelBtn, { marginTop: 16 }]} onPress={() => setCoachModal(null)} activeOpacity={0.7}>
                    <Text style={em.cancelBtnText}>Close</Text>
                  </TouchableOpacity>
                </Pressable>
              </Pressable>
            </KeyboardAvoidingView>
          </Modal>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },

  fixedTop: {
    paddingHorizontal: Spacing.side,
    paddingTop: 0,
    marginTop: -8,
  },

  content: { flex: 1 },
  contentInner: {
    paddingHorizontal: Spacing.side,
    paddingTop: 4,
    // Tuned so the visible gap between Log out and the floating tab bar is
    // ~2× the marginTop above Log out (≈ 36 px).
    paddingBottom: 30,
    gap: 0,
  },

  // ── Hero ──
  heroSection: { alignItems: 'center', paddingTop: 0, paddingBottom: 6 },
  avatarWrap: { marginBottom: 4 },
  avatarRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    padding: 2.5,
    backgroundColor: 'rgba(232,181,48,0.45)',
    shadowColor: '#E8B530',
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 4,
  },
  avatarPhoto: {
    width: 75,
    height: 75,
    borderRadius: 37.5,
    backgroundColor: '#F7F6F3',
    borderWidth: 2,
    borderColor: '#F7F6F3',
  },
  avatarFallback: {
    width: 75,
    height: 75,
    borderRadius: 37.5,
    backgroundColor: '#4E6A5C',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#F7F6F3',
  },
  avatarInitials: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 26,
    color: '#F7F6F3',
  },
  name: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 24,
    color: '#0A0A0A',
    letterSpacing: -0.6,
    marginTop: 2,
    marginBottom: 2,
  },
  studioName: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12,
    color: '#0A0A0A',
    textAlign: 'center',
    paddingHorizontal: 16,
    marginTop: 0,
  },
  danceStyle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11,
    color: 'rgba(10,10,10,0.55)',
    textAlign: 'center',
    marginTop: 2,
    letterSpacing: 0,
  },

  // ── Sections ──
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
    color: '#E8B530',
    letterSpacing: 1.4,
  },
  sectionRule: { flex: 1, height: 1, backgroundColor: 'rgba(10,10,10,0.06)' },
  sectionRight: {
    fontSize: 10,
    color: 'rgba(10,10,10,0.45)',
    fontFamily: Fonts.jakartaRegular,
    letterSpacing: 0.4,
  },

  // ── Logout — red pill, sits at the end of the scroll, just above the
  // floating tab bar.
  logoutBtn: {
    alignSelf: 'center',
    marginTop: 18,
    paddingHorizontal: 16,
    paddingVertical: 9,
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

  // ── Trainer-only ──
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

const glance = StyleSheet.create({
  card: {
    marginTop: 6,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(10,10,10,0.09)',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cell: { flex: 1, alignItems: 'center', gap: 3 },
  cellNum: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 24,
    color: '#0A0A0A',
    letterSpacing: -0.6,
    lineHeight: 26,
  },
  cellLbl: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 9.5,
    color: 'rgba(10,10,10,0.45)',
    letterSpacing: 1.2,
  },
  cellDivider: { width: 1, height: 28, backgroundColor: 'rgba(10,10,10,0.09)' },

  statsBorder: {
    height: 1,
    backgroundColor: 'rgba(10,10,10,0.09)',
    marginTop: 12,
  },

  teachersRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  teachersDivider: { width: 1, height: 32, backgroundColor: 'rgba(10,10,10,0.09)' },

  tCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    minWidth: 0,
  },
  tAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F0C24A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tAvatarAdd: {
    backgroundColor: 'rgba(46,70,112,0.12)',
  },
  tAvatarText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: '#0A0A0A',
  },
  tAvatarTextAdd: {
    color: '#2E4670',
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
  },
  tDance: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 8.5,
    color: '#E8B530',
    letterSpacing: 1.4,
  },
  tDanceAdd: { color: '#2E4670' },
  tName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#0A0A0A',
    letterSpacing: -0.05,
    marginTop: 1,
  },
  tNameAdd: { color: 'rgba(10,10,10,0.45)' },
});

const meterStyles = StyleSheet.create({
  wrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    bottom: 6,
    borderRadius: 999,
    backgroundColor: '#0F0C0A',
  },
  labelWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pct: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: '#fff',
    letterSpacing: -0.6,
  },
  pctSm: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
  },
});

const ready = StyleSheet.create({
  card: {
    backgroundColor: '#1F1810',
    borderWidth: 1,
    borderColor: 'rgba(240,194,74,0.28)',
    borderRadius: 20,
    padding: 18,
    paddingBottom: 6,
    overflow: 'hidden',
    shadowColor: '#0A0A0A',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 22,
    elevation: 8,
  },
  meterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 14,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14.5,
    color: '#fff',
    letterSpacing: -0.2,
    lineHeight: 19,
  },
  subtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 5,
    lineHeight: 16,
  },
  divider: {
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.10)',
    marginHorizontal: -18,
  },
  focusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  focusRowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkPartial: {
    borderColor: '#E8B530',
    backgroundColor: 'rgba(232,181,48,0.18)',
  },
  focusBody: { flex: 1, minWidth: 0 },
  focusName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13.5,
    color: '#fff',
    letterSpacing: -0.05,
    lineHeight: 16,
  },
  focusMeta: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 3,
  },
  focusProgress: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#F6D27A',
    letterSpacing: -0.2,
  },
  focusProgressOf: {
    fontFamily: Fonts.jakartaSemiBold,
    color: 'rgba(246,210,122,0.5)',
  },
});

const strengths = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(10,10,10,0.09)',
    borderRadius: 20,
    paddingTop: 12,
    paddingHorizontal: 10,
    paddingBottom: 12,
  },
  foot: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(10,10,10,0.09)',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  star: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E8B530',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footText: {
    flex: 1,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: 'rgba(10,10,10,0.72)',
    lineHeight: 16,
  },
  footStrong: {
    fontFamily: Fonts.jakartaExtraBold,
    color: '#0A0A0A',
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
