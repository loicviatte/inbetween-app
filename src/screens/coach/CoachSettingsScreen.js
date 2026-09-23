// Coach ▸ Settings — the student's Stats ▸ Settings, for a coach: the same
// cards, rows and sheets. Account (photo, name, email), what they teach and
// where, notification delivery, and log out.

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Colors, Fonts, Spacing } from '../../theme';
import { useCoachData } from '../../context/CoachDataContext';
import { useDjiSync } from '../../context/DjiSyncContext';
import { saveUserProfile } from '../../storage/storage';
import { changeCoachStudio } from '../../storage/coachStorage';
import { getMyCouples } from '../../storage/coupleStorage';
import HoldToConfirm from '../../components/HoldToConfirm';
import { logOutCoachWithChecks } from '../../services/logout';
import AccountSheet from '../../components/AccountSheet';
import BottomSheet from '../../components/BottomSheet';
import StudioPicker from '../../components/StudioPicker';
import { SecLabel, SettingsCard, SettingRow, LogoutButton } from '../../components/settings/SettingsUI';
import { HEALTH_CONSENT, healthConsentState, giveHealthConsent, withdrawHealthConsent } from '../../services/healthConsent';

const STYLES = ['Latin', 'Ballroom', 'Latin & Ballroom'];

export default function CoachSettingsScreen({ navigation, route }) {
  const { user, students, refresh } = useCoachData();
  const djiPhase = useDjiSync()?.phase;
  const [accountOpen, setAccountOpen] = useState(false);
  const [sheet, setSheet] = useState(null);          // 'style' | 'studio' | 'studioConfirm' | null
  const [editStyle, setEditStyle] = useState('');
  const [editStudio, setEditStudio] = useState(null);
  const [saving, setSaving] = useState(false);

  const [couplesCount, setCouplesCount] = useState(null); // null until read
  const [studioError, setStudioError] = useState('');

  // The coach's own health-data permission. Withdrawing it stops them starting
  // a lesson at all — their voice is on every recording they make — and deletes
  // nothing: deletion is a separate request.
  const healthState = healthConsentState(user);
  function toggleHealthConsent() {
    if (!user?.id) return;
    if (healthState === 'withdrawn') {
      Alert.alert('Allow this again?', HEALTH_CONSENT, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'I consent', onPress: async () => { await giveHealthConsent(user.id); refresh(); } },
      ]);
      return;
    }
    Alert.alert(
      'Withdraw this permission?',
      'You stop being able to record lessons from now on. What has already been recorded stays until you ask us to delete it — that is a separate request.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Withdraw', style: 'destructive', onPress: async () => { await withdrawHealthConsent(user.id); refresh(); } },
      ],
    );
  }

  function openStyle() { setEditStyle(user?.dance_style || ''); setSheet('style'); }
  function openStudio() {
    setEditStudio(user?.studio || null);
    setStudioError('');
    setSheet('studio');
    setCouplesCount(null);
    getMyCouples().then((c) => setCouplesCount((c || []).length)).catch(() => {});
  }

  // Changing studio ends the links with current students and couples, so it
  // asks first (hold 3 s); with nobody linked it just saves. Couples not read
  // yet count as maybe linked.
  const linkedCount = students.length + (couplesCount ?? 1);
  function saveStudio() {
    const next = editStudio?.id || null;
    if (next === (user?.studio?.id || null)) { setSheet(null); return; }
    if (linkedCount === 0) { confirmStudio(); return; }
    setStudioError('');
    setSheet('studioConfirm');
  }
  async function confirmStudio() {
    if (saving) return;
    setSaving(true);
    setStudioError('');
    try {
      await changeCoachStudio(editStudio?.id || null);
      await refresh();
      setSheet(null);
    } catch (e) {
      setStudioError(e.message || 'Nothing was changed. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }
  // Home's "Add your studio" lands straight on the studio sheet.
  useEffect(() => {
    if (route?.params?.open !== 'studio') return undefined;
    navigation.setParams({ open: undefined });
    const t = setTimeout(openStudio, 350); // once the screen has slid in
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.open]);

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const linkedLabel = couplesCount == null
    ? 'current students and couples'
    : [
      students.length ? plural(students.length, 'student') : null,
      couplesCount ? plural(couplesCount, 'couple') : null,
    ].filter(Boolean).join(' and ');

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

          <SecLabel text="Permission" />
          <SettingsCard>
            <SettingRow
              label="Health data in lessons"
              value={healthState === 'withdrawn' ? 'Withdrawn' : healthState === 'given' ? 'Given' : 'Not given'}
              onPress={toggleHealthConsent}
              isLast
            />
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
              <StudioPicker value={editStudio} onChange={setEditStudio} allowCreate />
            </View>
            <Text style={em.studioNote}>Your studio decides which group lessons and students you see.</Text>
            {!!studioError && <Text style={em.error}>{studioError}</Text>}
            <TouchableOpacity style={em.saveBtn} onPress={saveStudio} activeOpacity={0.88} disabled={saving}>
              <Text style={em.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </>
        )}
        {sheet === 'studioConfirm' && (
          <>
            <Text style={em.title}>Change studio?</Text>
            <Text style={em.confirmBody}>
              Moving to {editStudio?.name || 'no studio'} removes your links with your {linkedLabel}.
              They’ll need your invite code to link to you again.
            </Text>
            {!!studioError && <Text style={em.error}>{studioError}</Text>}
            <HoldToConfirm
              label="Hold to change studio"
              busyLabel="Changing studio…"
              busy={saving}
              onConfirm={confirmStudio}
            />
            <Text style={em.holdHint}>Press and hold for 3 seconds.</Text>
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
  title: { flex: 1, fontFamily: Fonts.bold, fontSize: 24, letterSpacing: -0.84, lineHeight: 28, color: '#141311' },
  scroll: { paddingHorizontal: Spacing.side, paddingTop: 4, paddingBottom: 40 },
});

// Same sheet styles as Stats ▸ Settings' style and studio sheets.
const em = StyleSheet.create({
  sheet: { backgroundColor: Colors.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 44 },
  handle: { width: 32, height: 3, backgroundColor: 'rgba(13,13,18,0.1)', borderRadius: 2, alignSelf: 'center', marginBottom: 24 },
  title: { fontFamily: Fonts.semiBold, fontSize: 17, color: Colors.black, marginBottom: 24, textAlign: 'center', letterSpacing: -0.2 },
  field: { marginBottom: 18 },
  fieldLabel: { fontFamily: Fonts.semiBold, fontSize: 10, color: Colors.secondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 0.5, borderColor: Colors.statCardBorder, backgroundColor: Colors.statCardBg },
  pillActive: { backgroundColor: Colors.black, borderColor: Colors.black },
  pillText: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.secondary },
  pillTextActive: { color: Colors.white },
  saveBtn: { backgroundColor: Colors.black, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  saveBtnText: { fontFamily: Fonts.semiBold, fontSize: 15, color: Colors.white },
  cancelBtn: { paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.secondary },
  confirmBody: { fontFamily: Fonts.regular, fontSize: 14.5, lineHeight: 21, color: '#3D3A33', textAlign: 'center', marginTop: -10, marginBottom: 22 },
  holdHint: { fontFamily: Fonts.regular, fontSize: 12.5, color: 'rgba(13,13,18,0.5)', textAlign: 'center', marginTop: 10 },
  error: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18, color: '#A3281B', textAlign: 'center', marginBottom: 12 },
  studioNote: { fontFamily: Fonts.regular, fontSize: 12, color: 'rgba(13,13,18,0.5)', lineHeight: 16, marginTop: -6, marginBottom: 14 },
});
