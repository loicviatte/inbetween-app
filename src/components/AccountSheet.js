import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Fonts } from '../theme';
import BottomSheet from './BottomSheet';
import { useProfile } from '../context/ProfileContext';
import { supabase } from '../services/supabase/client';
import { getAccountUser, saveAccountName } from '../storage/storage';

// Stats ▸ Settings ▸ Account — photo, name, email — lifted out of ProfileScreen
// unchanged so the avatar in any tab header can open it right where you are.
// It edits the signed-in account, never the dancer it follows: a parent edits
// themselves, not their child.
const AVATAR_KEY = '@profile_photo';

export default function AccountSheet({ visible, onClose, onSaved }) {
  const { avatarUri, setAvatarUri, setInitials } = useProfile();
  const [account, setAccount] = useState(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [photoUri, setPhotoUri] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return undefined;
    let alive = true;
    AsyncStorage.getItem(AVATAR_KEY).then((p) => { if (alive && p) setPhotoUri(p); }).catch(() => {});
    getAccountUser().then((a) => {
      if (!alive || !a) return;
      setAccount(a);
      setEditName(a.name || '');
      setEditEmail(a.email || '');
    }).catch(() => {});
    return () => { alive = false; };
  }, [visible]);

  const shownPhoto = avatarUri || photoUri;

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
    setAvatarUri(localUri);

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
      setAvatarUri(urlWithCache);
    } catch (e) {
      console.error('Avatar upload failed:', e);
      await AsyncStorage.setItem(AVATAR_KEY, localUri);
    }
  }

  async function handleSaveAccount() {
    if (saving) return;
    setSaving(true);
    const name = editName.trim();
    const newEmail = editEmail.trim();
    try {
      if (name && name !== account?.name) {
        // The name on this sheet belongs to the account, not to the dancer.
        await saveAccountName(name);
        setAccount((prev) => ({ ...prev, name }));
        const ini = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
        setInitials(ini);
        AsyncStorage.setItem('@profile_name', name).catch(() => {});
        onSaved?.({ name });
      }
      let emailNotice = false;
      if (newEmail && newEmail.toLowerCase() !== (account?.email || '').toLowerCase()) {
        const { error } = await supabase.auth.updateUser({ email: newEmail });
        if (error) throw error;
        emailNotice = true;
      }
      onClose();
      if (emailNotice) {
        Alert.alert('Confirm your new email', `We sent a confirmation link to ${newEmail}. Your email updates once you tap it.`);
      }
    } catch (e) {
      Alert.alert('Could not save', e.message || 'Please try again.');
    }
    setSaving(false);
  }

  const initials = (account?.name || '')
    .split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'AL';

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={em.sheet} avoidKeyboard>
      <View style={em.handle} />

      <Text style={em.title}>Account</Text>

      <TouchableOpacity style={em.avatarWrap} onPress={handlePickPhoto} activeOpacity={0.85}>
        {shownPhoto
          ? <Image source={{ uri: shownPhoto }} style={em.avatarPhoto} />
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

      <TouchableOpacity style={em.saveBtn} onPress={handleSaveAccount} activeOpacity={0.88} disabled={saving}>
        <Text style={em.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

const em = StyleSheet.create({
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

  saveBtn: {
    backgroundColor: Colors.black,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnText: { fontFamily: Fonts.jakartaBold, fontSize: 15, color: Colors.white },
});
