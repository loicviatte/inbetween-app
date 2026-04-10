import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Fonts, Spacing } from '../theme';

export default function TabHeader({ navigation, onProfilePress, editMode = false }) {
  const [photoUri, setPhotoUri] = useState(null);
  const [initial, setInitial] = useState('');

  useEffect(() => {
    async function load() {
      const [photo, name] = await Promise.all([
        AsyncStorage.getItem('@profile_photo'),
        AsyncStorage.getItem('@profile_name'),
      ]);
      setPhotoUri(photo || null);
      setInitial(name ? name[0].toUpperCase() : 'A');
    }
    load();
  }, []);

  function handleProfilePress() {
    if (onProfilePress) {
      onProfilePress();
    } else {
      navigation.navigate('PROFILE');
    }
  }

  return (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.notifBtn}
        onPress={() => navigation.navigate('Notifications')}
        activeOpacity={0.7}
      >
        <Ionicons name="notifications-outline" size={24} color={Colors.black} />
      </TouchableOpacity>

      {editMode ? (
        <TouchableOpacity onPress={handleProfilePress} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
          <Text style={styles.editLabel}>Edit</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.avatar} onPress={handleProfilePress} activeOpacity={0.8}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.avatarPhoto} />
          ) : (
            <Text style={styles.avatarText}>{initial}</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingTop: 16,
    paddingBottom: 12,
  },
  notifBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F0D9A0',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#8A6A2E',
  },
  avatarPhoto: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  editLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: Colors.black,
  },
});
