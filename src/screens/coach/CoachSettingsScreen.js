// Coach ▸ Settings — the student's Stats ▸ Settings, for a coach: the same
// cards, rows and sheets. Account (photo, name, email), what they teach and
// where, notification delivery, and log out.

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Colors, Fonts, Spacing } from '../../theme';
import { useCoachData } from '../../context/CoachDataContext';
import { useDjiSync } from '../../context/DjiSyncContext';
import { saveUserProfile } from '../../storage/storage';
import { logOutCoachWithChecks } from '../../services/logout';
import AccountSheet from '../../components/AccountSheet';
import BottomSheet from '../../components/BottomSheet';
import StudioPicker from '../../components/StudioPicker';
import { SecLabel, SettingsCard, SettingRow, LogoutButton } from '../../components/settings/SettingsUI';

const STYLES = ['Latin', 'Ballroom', 'Latin & Ballroom'];

export default function CoachSettingsScreen({ navigation }) {
  const { user, refresh } = useCoachData();
  const djiPhase = useDjiSync()?.phase;
  const [accountOpen, setAccountOpen] = useState(false);
  const [sheet, setSheet] = useState(null);          // 'style' | 'studio' | null
  const [editStyle, setEditStyle] = useState('');
  const [editStudio, setEditStudio] = useState(null);
  const [saving, setSaving] = useState(false);

  function openStyle() { setEditStyle(user?.dance_style || ''); setSheet('style'); }
  function openStudio() { setEditStudio(user?.studio || null); setSheet('studio'); }

  async function save(patch) {
    if (saving) return;
    setSaving(true);
    try {
      await saveUserProfile(patch);
      await refresh();
      setSheet(null);
    } catch {
      Alert.alert('Could not save', 'Nothing was changed. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
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
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <View style={st.titleRow}>
          <TouchableOpacity style={st.back} onPress={() => navigation.goBack()} activeOpacity={0.7}
            accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={19} color="#141311" />
          </TouchableOpacity>
          <Text style={st.title}>Settings</Text>
        </View>

        <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
          <SecLabel text="Account" />
          <SettingsCard>
            <SettingRow label={user?.name || 'Account'} value="Name, email and photo" onPress={() => setAccountOpen(true)} isLast />
          </SettingsCard>

          <SecLabel text="Teaching" />
          <SettingsCard>
            <SettingRow label="Dance style" value={user?.dance_style} onPress={openStyle} />
            <SettingRow label="Dance studio" value={user?.studio?.name} onPress={openStudio} isLast />
          </SettingsCard>

          <SecLabel text="Notifications" />
          <SettingsCard>
            <SettingRow label="Notification settings" value="Delivery and quiet hours"
              onPress={() => navigation.navigate('NotificationSettings', { coach: true })} isLast />
          </SettingsCard>

          <LogoutButton onPress={() => logOutCoachWithChecks({ djiUploading: djiPhase === 'syncing' })} />
        </ScrollView>
      </SafeAreaView>

      <AccountSheet visible={accountOpen} onClose={() => { setAccountOpen(false); refresh(); }} onSaved={() => refresh()} />

      <BottomSheet visible={!!sheet} onClose={() => setSheet(null)} sheetStyle={em.sheet} avoidKeyboard>
        <View style={em.handle} />
        {sheet === 'style' && (
          <>
            <Text style={em.title}>Dance style</Text>
            <View style={em.field}>
              <View style={em.pillRow}>
                {STYLES.map((s) => (
                  <TouchableOpacity key={s} style={[em.pill, editStyle === s && em.pillActive]} onPress={() => setEditStyle(s)} activeOpacity={0.75}>
                    <Text style={[em.pillText, editStyle === s && em.pillTextActive]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <TouchableOpacity style={em.saveBtn} onPress={() => save({ dance_style: editStyle })} activeOpacity={0.88} disabled={saving || !editStyle}>
              <Text style={em.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </>
        )}
        {sheet === 'studio' && (
          <>
            <Text style={em.title}>Dance studio</Text>
            <View style={em.field}>
              <Text style={em.fieldLabel}>Main studio</Text>
              <StudioPicker value={editStudio} onChange={setEditStudio} />
            </View>
            <Text style={em.studioNote}>Your studio decides which group classes and students you see.</Text>
            <TouchableOpacity style={em.saveBtn} onPress={() => save({ studio_id: editStudio?.id || null })} activeOpacity={0.88} disabled={saving}>
              <Text style={em.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity style={em.cancelBtn} onPress={() => setSheet(null)} activeOpacity={0.7}>
          <Text style={em.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </BottomSheet>
    </View>
  );
}

const st = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingTop: 6, paddingHorizontal: Spacing.side },
  back: {
    width: 36, height: 36, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#141311', shadowOpacity: 0.07, shadowOffset: { width: 0, height: 1 }, shadowRadius: 2, elevation: 1,
  },
  title: { flex: 1, fontFamily: Fonts.ttBold, fontSize: 24, letterSpacing: -0.84, lineHeight: 28, color: '#141311' },
  scroll: { paddingHorizontal: Spacing.side, paddingTop: 4, paddingBottom: 40 },
});

// Same sheet styles as Stats ▸ Settings' style and studio sheets.
const em = StyleSheet.create({
  sheet: { backgroundColor: Colors.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 44 },
  handle: { width: 32, height: 3, backgroundColor: 'rgba(13,13,18,0.1)', borderRadius: 2, alignSelf: 'center', marginBottom: 24 },
  title: { fontFamily: Fonts.jakartaExtraBold, fontSize: 17, color: Colors.black, marginBottom: 24, textAlign: 'center', letterSpacing: -0.2 },
  field: { marginBottom: 18 },
  fieldLabel: { fontFamily: Fonts.jakartaExtraBold, fontSize: 10, color: Colors.secondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 0.5, borderColor: Colors.statCardBorder, backgroundColor: Colors.statCardBg },
  pillActive: { backgroundColor: Colors.black, borderColor: Colors.black },
  pillText: { fontFamily: Fonts.jakartaMedium, fontSize: 13, color: Colors.secondary },
  pillTextActive: { color: Colors.white },
  saveBtn: { backgroundColor: Colors.black, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  saveBtnText: { fontFamily: Fonts.jakartaBold, fontSize: 15, color: Colors.white },
  cancelBtn: { paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { fontFamily: Fonts.jakartaRegular, fontSize: 14, color: Colors.secondary },
  studioNote: { fontFamily: Fonts.jakartaRegular, fontSize: 12, color: 'rgba(13,13,18,0.5)', lineHeight: 16, marginTop: -6, marginBottom: 14 },
});
