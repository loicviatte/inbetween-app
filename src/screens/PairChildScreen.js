// Pair — a child signs in on their own phone with the code their parent got
// from Stats ▸ Links. Cream + gold, like Login.

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform,
  ActivityIndicator, ScrollView, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Fonts, Spacing, Onboard } from '../theme';
import { signInWithPairingCode } from '../services/childPairing';
import { registerPushToken } from '../services/notifications';
import { clearPendingInvite } from '../services/minorConsent';

const LEN = 6;
const clean = (t) => t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, LEN);

export default function PairChildScreen({ navigation }) {
  const [code, setCode] = useState('');
  const [focused, setFocused] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 350);
    return () => clearTimeout(t);
  }, []);

  async function submit(value = code) {
    if (busy || value.length !== LEN) return;
    setBusy(true); setError('');
    try {
      const { user } = await signInWithPairingCode(value);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      clearPendingInvite();
      if (user?.id) registerPushToken(user.id).catch(() => {});
      // The signed-in app takes over from here.
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setError(e.message);
      setBusy(false);
    }
  }

  const boxes = Array.from({ length: LEN }, (_, i) => code[i] || '');

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.kv}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            {navigation.canGoBack() && (
              <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7} hitSlop={8}
                accessibilityRole="button" accessibilityLabel="Back">
                <Ionicons name="chevron-back" size={16} color={Onboard.ink} />
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.h1}>Enter the code{'\n'}from your parent</Text>
          <Text style={styles.sub}>
            They get it in their InBetween app: <Text style={styles.subStrong}>Stats ▸ Links ▸ Get a code</Text>. It works once, for 10 minutes.
          </Text>

          {/* One real input behind six boxes: paste, autofill and delete all behave. */}
          <Pressable style={styles.boxes} onPress={() => input.current?.focus()} accessibilityRole="none">
            {boxes.map((ch, i) => {
              const current = focused && (i === code.length || (i === LEN - 1 && code.length === LEN));
              return (
                <View key={i} style={[styles.box, i === 3 && styles.boxGap, !!ch && styles.boxFilled, current && styles.boxOn, !!error && styles.boxErr]}>
                  <Text style={styles.boxT}>{ch}</Text>
                </View>
              );
            })}
            <TextInput
              ref={input}
              value={code}
              onChangeText={(t) => {
                const v = clean(t);
                setCode(v);
                if (error) setError('');
                if (v.length === LEN) submit(v);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              keyboardType={Platform.OS === 'ios' ? 'ascii-capable' : 'visible-password'}
              maxLength={LEN + 2}
              caretHidden
              style={styles.hiddenInput}
              accessibilityLabel="Code from your parent, 6 characters"
            />
          </Pressable>

          {!!error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.spacer} />

          <TouchableOpacity
            style={[styles.primaryBtn, code.length !== LEN && styles.primaryOff]}
            onPress={() => submit()}
            disabled={busy || code.length !== LEN}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryBtnText}>Sign in</Text>}
          </TouchableOpacity>
          <Text style={styles.foot}>No code? Ask your parent to open InBetween on their phone.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Onboard.bg },
  kv: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: Spacing.side + 2, paddingTop: 8, paddingBottom: 18 },
  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, minHeight: 30 },
  backBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: Onboard.faint, alignItems: 'center', justifyContent: 'center' },
  h1: { fontFamily: Fonts.ttDemiBold, fontSize: 27, lineHeight: 30, letterSpacing: -0.8, color: Onboard.ink },
  sub: { fontFamily: Fonts.travelsRegular, fontSize: 13.5, lineHeight: 19, color: Onboard.ink2, marginTop: 10 },
  subStrong: { fontFamily: Fonts.ttDemiBold, color: Onboard.ink },

  boxes: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 34 },
  box: {
    width: 46, height: 58, borderRadius: 12, borderWidth: 1, borderColor: Onboard.line,
    backgroundColor: Onboard.card, alignItems: 'center', justifyContent: 'center',
  },
  boxGap: { marginLeft: 10 },
  boxFilled: { borderColor: 'rgba(10,10,10,0.22)' },
  boxOn: { borderColor: Onboard.gold, borderWidth: 2 },
  boxErr: { borderColor: '#A3281B' },
  boxT: { fontFamily: Fonts.ttBold, fontSize: 24, color: Onboard.ink },
  hiddenInput: { position: 'absolute', width: 1, height: 1, opacity: 0 },

  error: { fontFamily: Fonts.travelsMedium, fontSize: 13, lineHeight: 18, color: '#A3281B', textAlign: 'center', marginTop: 14 },
  spacer: { flex: 1, minHeight: 24 },
  primaryBtn: { backgroundColor: Onboard.ink, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  primaryOff: { opacity: 0.35 },
  primaryBtnText: { fontFamily: Fonts.ttDemiBold, fontSize: 15, color: '#FFFFFF' },
  foot: { fontFamily: Fonts.travelsRegular, fontSize: 13, color: Onboard.ink2, textAlign: 'center', marginTop: 14 },
});
