import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Spacing } from '../theme';
import { respondToAttendance } from '../storage/storage';
import { locallyRespondedAttendance } from '../storage/attendanceState';

export default function AttendanceConfirmScreen({ navigation, route }) {
  const { classInputId, coachName, classDate } = route.params ?? {};
  const [responding, setResponding] = useState(false);
  const [done, setDone] = useState(false);
  const [answer, setAnswer] = useState(null);

  async function respond(response) {
    setResponding(true);
    setAnswer(response);
    try {
      await respondToAttendance(classInputId, response);
      locallyRespondedAttendance.set(classInputId, response === 'yes');
      setDone(true);
      setTimeout(() => navigation.goBack(), 1200);
    } catch (e) {
      console.error('[AttendanceConfirm] error:', e);
      let msg = String(e?.message ?? e);
      try {
        if (e?.context) {
          const text = await e.context.clone().text();
          msg += `\n\n${e.context.status}: ${text}`;
        }
      } catch (_) {}
      Alert.alert('Error', msg);
      setResponding(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.content}>
        <View style={s.iconWrap}>
          <Text style={s.icon}>🕺</Text>
        </View>
        <Text style={s.title}>Were you at {coachName ?? 'your coach'}'s group class?</Text>
        {!!classDate && <Text style={s.date}>{classDate}</Text>}
        <Text style={s.sub}>Confirm your attendance to receive your focus points from this class.</Text>

        {done ? (
          <View style={s.doneWrap}>
            <Text style={s.doneText}>{answer === 'yes' ? '✓ Confirmed!' : '✓ Noted, no focus points for this class.'}</Text>
          </View>
        ) : (
          <View style={s.buttons}>
            <TouchableOpacity style={[s.btn, s.btnYes]} onPress={() => respond('yes')} disabled={responding} activeOpacity={0.85}>
              {responding && answer === 'yes' ? <ActivityIndicator color="#fff" /> : <Text style={s.btnYesText}>Yes, I was there</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.btnNo]} onPress={() => respond('no')} disabled={responding} activeOpacity={0.85}>
              {responding && answer === 'no' ? <ActivityIndicator color={Colors.secondary} /> : <Text style={s.btnNoText}>No, I wasn't</Text>}
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
  title: { fontFamily: Fonts.jakartaExtraBold, fontSize: 22, color: Colors.black, textAlign: 'center', letterSpacing: -0.3, marginBottom: 8 },
  date: { fontFamily: Fonts.jakartaSemiBold, fontSize: 14, color: Colors.orange, marginBottom: 12 },
  sub: { fontFamily: Fonts.jakartaRegular, fontSize: 14, color: Colors.secondary, textAlign: 'center', lineHeight: 20, marginBottom: 36 },
  buttons: { gap: 12, width: '100%' },
  btn: { borderRadius: 16, paddingVertical: 18, alignItems: 'center' },
  btnYes: { backgroundColor: Colors.black },
  btnYesText: { fontFamily: Fonts.jakartaBold, fontSize: 16, color: Colors.white },
  btnNo: { backgroundColor: Colors.statCardBg, borderWidth: 0.5, borderColor: Colors.statCardBorder },
  btnNoText: { fontFamily: Fonts.jakartaBold, fontSize: 16, color: Colors.secondary },
  doneWrap: { backgroundColor: 'rgba(76,175,80,0.1)', borderRadius: 14, paddingVertical: 16, paddingHorizontal: 24 },
  doneText: { fontFamily: Fonts.jakartaSemiBold, fontSize: 15, color: Colors.activeLog, textAlign: 'center' },
});
