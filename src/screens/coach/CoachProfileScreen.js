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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard2 from 'expo-clipboard';
import { Colors, Fonts, Spacing } from '../../theme';
import { getUser, saveUserProfile } from '../../storage/storage';
import { getOrCreateInviteCode, getMyStudents } from '../../storage/coachStorage';
import { clearUserCaches } from '../../storage/userCaches';
import { supabase } from '../../services/supabase/client';
import { CoachProfileScreenSkeleton } from '../../components/Skeleton';
import StudioPicker from '../../components/StudioPicker';
import { Ionicons } from '@expo/vector-icons';

export default function CoachProfileScreen({ navigation }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const hasLoadedRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [studentCount, setStudentCount] = useState(0);
  const [inviteCode, setInviteCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editStudio, setEditStudio] = useState(null);
  const [editStyle, setEditStyle] = useState('');
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      async function load() {
        if (!hasLoadedRef.current) setIsLoading(true);
        let userData = null, students = [], code = '';
        try {
          [userData, students, code] = await Promise.all([
            getUser(),
            getMyStudents(),
            getOrCreateInviteCode(),
          ]);
        } catch {}
        setUser(userData);
        setStudentCount(students.length);
        setInviteCode(code);
        setIsLoading(false);
        fadeAnim.setValue(0);
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
        hasLoadedRef.current = true;
      }
      load();
    }, [])
  );

  async function handleCopyCode() {
    await Clipboard2.setStringAsync(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function openEdit() {
    setEditName(user?.name || '');
    setEditStudio(user?.studio || null);
    setEditStyle(user?.dance_style || '');
    setEditVisible(true);
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    const name = editName.trim();
    const studio_id = editStudio?.id || null;
    await saveUserProfile({ name, studio_id, dance_style: editStyle });
    setUser(prev => ({ ...prev, name, studio_id, studio: editStudio, dance_style: editStyle }));
    setSaving(false);
    setEditVisible(false);
  }

  async function handleLogout() {
    await clearUserCaches();
    await supabase.auth.signOut();
  }

  if (isLoading) {
    return <CoachProfileScreenSkeleton />;
  }

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : 'CO';

  return (
    <SafeAreaView style={styles.safe}>
      <Animated.ScrollView
        style={{ opacity: fadeAnim }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            hitSlop={12}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={24} color={Colors.black} />
          </TouchableOpacity>
          <TouchableOpacity onPress={openEdit} activeOpacity={0.7}>
            <Text style={styles.editBtn}>Edit</Text>
          </TouchableOpacity>
        </View>

        {/* Avatar + info */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
          <Text style={styles.name}>{user?.name || 'Your Name'}</Text>
          <Text style={styles.role}>Coach</Text>
          {!!user?.studio?.name && (
            <Text style={styles.info}>{user.studio.name}</Text>
          )}
          {!!user?.dance_style && (
            <Text style={styles.info}>{user.dance_style}</Text>
          )}
        </View>

        {/* Stats */}
        <View style={styles.statCard}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{studentCount}</Text>
            <Text style={styles.statLabel}>Students</Text>
          </View>
        </View>

        {/* Invite code */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>MY INVITE CODE</Text>
          <View style={styles.inviteCard}>
            <View style={styles.inviteInfo}>
              <Text style={styles.inviteCode}>{inviteCode || '——'}</Text>
              <Text style={styles.inviteHint}>
                Students enter this code in their profile to connect with you.
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.copyBtn, copied && styles.copyBtnDone]}
              onPress={handleCopyCode}
              activeOpacity={0.85}
            >
              <Text style={styles.copyBtnText}>{copied ? 'Copied ✓' : 'Copy'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </Animated.ScrollView>

      {/* Edit Modal */}
      <Modal visible={editVisible} transparent animationType="slide" onRequestClose={() => setEditVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={em.overlay} onPress={() => setEditVisible(false)}>
            <Pressable style={em.sheet} onPress={() => {}}>
              <View style={em.handle} />
              <Text style={em.title}>Edit Profile</Text>

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
                <Text style={em.fieldLabel}>Studio</Text>
                <StudioPicker
                  value={editStudio}
                  onChange={setEditStudio}
                  allowCreate
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

              <TouchableOpacity style={em.saveBtn} onPress={handleSave} activeOpacity={0.88} disabled={saving}>
                <Text style={em.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={em.cancelBtn} onPress={() => setEditVisible(false)} activeOpacity={0.7}>
                <Text style={em.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 100,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 24,
  },
  notifBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
  },
  editBtn: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: Colors.activeFocus,
  },

  avatarSection: { alignItems: 'center', marginBottom: 24 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(196,96,255,0.15)',
    borderWidth: 3,
    borderColor: 'rgba(196,96,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarInitials: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 28,
    color: Colors.activeHome,
  },
  name: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: Colors.black,
    marginBottom: 2,
  },
  role: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: Colors.activeHome,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  info: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
    marginTop: 2,
    textAlign: 'center',
  },

  statCard: {
    flexDirection: 'row',
    backgroundColor: Colors.statCardBg,
    borderColor: Colors.statCardBorder,
    borderWidth: 0.25,
    borderRadius: 4,
    paddingVertical: 18,
    paddingHorizontal: 20,
    marginBottom: 28,
  },
  statBox: { flex: 1, alignItems: 'center' },
  statValue: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 28,
    color: Colors.black,
    marginBottom: 2,
  },
  statLabel: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
  },

  section: { marginBottom: 28 },
  sectionLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: Colors.secondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },

  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(196,96,255,0.05)',
    borderWidth: 0.5,
    borderColor: 'rgba(196,96,255,0.2)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  inviteInfo: { flex: 1 },
  inviteCode: {
    fontFamily: Fonts.monument,
    fontSize: 22,
    color: Colors.black,
    letterSpacing: 3,
    marginBottom: 4,
  },
  inviteHint: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
    lineHeight: 16,
  },
  copyBtn: {
    backgroundColor: Colors.activeHome,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  copyBtnDone: { backgroundColor: Colors.green },
  copyBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: Colors.white,
  },

  logoutBtn: {
    borderWidth: 0.25,
    borderColor: Colors.statCardBorder,
    borderRadius: 4,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: Colors.statCardBg,
    marginTop: 8,
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
});
