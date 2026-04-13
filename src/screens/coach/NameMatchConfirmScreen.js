import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Spacing } from '../../theme';
import { supabase } from '../../services/supabase/client';
import { locallyResolvedNameMatches } from '../../storage/attendanceState';

export default function NameMatchConfirmScreen({ navigation, route }) {
  const {
    studentId,
    studentName,
    extractedName,
    focusPointIds = [],
    notificationId,
  } = route.params ?? {};

  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(null); // 'confirmed' | 'rejected'

  async function handleConfirm() {
    setLoading(true);
    try {
      // Transition FPs from pending_name_confirm → pending_coach
      const { error } = await supabase
        .from('focus_points')
        .update({ status: 'pending_coach' })
        .in('id', focusPointIds);
      if (error) throw error;

      // Delete notification so it disappears immediately
      if (notificationId) {
        await supabase.from('notifications').delete().eq('id', notificationId);
        locallyResolvedNameMatches.add(notificationId);
      }

      setDone('confirmed');
      setTimeout(() => navigation.goBack(), 1200);
    } catch (e) {
      console.error('[NameMatchConfirm] confirm error:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleReject() {
    setLoading(true);
    try {
      // Unassign FPs — put back to unassigned pool
      const { error } = await supabase
        .from('focus_points')
        .update({ user_id: null, status: 'active' })
        .in('id', focusPointIds);
      if (error) throw error;

      // Delete notification so it disappears immediately
      if (notificationId) {
        await supabase.from('notifications').delete().eq('id', notificationId);
        locallyResolvedNameMatches.add(notificationId);
      }

      setDone('rejected');
      setTimeout(() => navigation.goBack(), 1200);
    } catch (e) {
      console.error('[NameMatchConfirm] reject error:', e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content}>
        <View style={s.iconWrap}>
          <Text style={s.icon}>🔍</Text>
        </View>

        <Text style={s.title}>Confirm student match</Text>
        <Text style={s.sub}>
          <Text style={s.highlight}>"{extractedName}"</Text>
          {' '}confirmed attendance. Is this student actually{' '}
          <Text style={s.highlight}>{studentName}</Text>?
        </Text>
        <Text style={s.count}>
          {focusPointIds.length} focus point{focusPointIds.length !== 1 ? 's' : ''} will be assigned if confirmed.
        </Text>

        {done ? (
          <View style={s.doneWrap}>
            <Text style={s.doneText}>
              {done === 'confirmed' ? '✓ Confirmed — focus points assigned.' : '✓ Rejected — focus points unassigned.'}
            </Text>
          </View>
        ) : (
          <View style={s.buttons}>
            <TouchableOpacity
              style={[s.btn, s.btnYes]}
              onPress={handleConfirm}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.btnYesText}>Yes, it's {studentName?.split(' ')[0] ?? 'them'}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.btn, s.btnNo]}
              onPress={handleReject}
              disabled={loading}
              activeOpacity={0.85}
            >
              <Text style={s.btnNoText}>No, different person</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1, paddingHorizontal: Spacing.side, justifyContent: 'center', alignItems: 'center' },
  iconWrap: { marginBottom: 24 },
  icon: { fontSize: 52 },
  title: { fontFamily: Fonts.jakartaExtraBold, fontSize: 22, color: Colors.black, textAlign: 'center', letterSpacing: -0.3, marginBottom: 16 },
  sub: { fontFamily: Fonts.jakartaRegular, fontSize: 15, color: Colors.secondary, textAlign: 'center', lineHeight: 22, marginBottom: 8 },
  highlight: { fontFamily: Fonts.jakartaBold, color: Colors.black },
  count: { fontFamily: Fonts.jakartaRegular, fontSize: 13, color: Colors.secondary, marginBottom: 36 },
  buttons: { gap: 12, width: '100%' },
  btn: { borderRadius: 16, paddingVertical: 18, alignItems: 'center' },
  btnYes: { backgroundColor: Colors.black },
  btnYesText: { fontFamily: Fonts.jakartaBold, fontSize: 16, color: Colors.white },
  btnNo: { backgroundColor: Colors.statCardBg, borderWidth: 0.5, borderColor: Colors.statCardBorder },
  btnNoText: { fontFamily: Fonts.jakartaBold, fontSize: 16, color: Colors.secondary },
  doneWrap: { backgroundColor: 'rgba(76,175,80,0.1)', borderRadius: 14, paddingVertical: 16, paddingHorizontal: 24 },
  doneText: { fontFamily: Fonts.jakartaSemiBold, fontSize: 15, color: '#4CAF50', textAlign: 'center' },
});
