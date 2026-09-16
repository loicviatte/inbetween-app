// The student's app, locked: a coach said this student is under 18 and they
// came without a parent. Two ways back in — confirm by email they're 18 or
// over, or have a parent approve. AgeCheckGate shows this instead of the app
// and lifts it on its own once the account unlocks.

import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Fonts, Spacing, Onboard } from '../theme';
import { supabase } from '../services/supabase/client';
import { clearPushToken } from '../services/notifications';
import { clearUserCaches } from '../storage/userCaches';
import PhoneField, { TextField } from '../components/PhoneField';
import { DEFAULT_COUNTRY, toE164 } from '../utils/phone';
import {
  getAgeCheckStatus, sendAdultLink, inviteParentForMe, resendParentInvite,
} from '../services/ageCheck';
import { markFirstScreenReady } from '../utils/firstPaint';

const RED = '#A3281B';
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const haptic = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

export default function AgeCheckScreen() {
  const [stage, setStage] = useState('loading');   // loading | choose | adult | parentForm | parentSent
  const [info, setInfo] = useState(null);           // status from age-check
  const [maskedEmail, setMaskedEmail] = useState('');
  const [parent, setParent] = useState({ first: '', email: '', phone: '', country: DEFAULT_COUNTRY });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  async function load() {
    try {
      const r = await getAgeCheckStatus();
      setInfo(r);
      return r;
    } catch { return null; }
  }

  useEffect(() => {
    markFirstScreenReady();   // this is the first screen: let the launch logo go
    load().then((r) => setStage(r?.invite ? 'parentSent' : 'choose'));
  }, []);

  function go(next) { haptic(); setError(''); setNote(''); setStage(next); }

  async function emailMe() {
    if (busy) return;
    setBusy(true); setError(''); setNote('');
    try {
      const r = await sendAdultLink();
      setMaskedEmail(r.maskedEmail);
      if (stage === 'adult') setNote('Sent again.');
      setStage('adult');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function inviteParent() {
    if (busy) return;
    const phone = toE164(parent.country, parent.phone);
    if (!parent.first.trim()) return setError('Add your parent’s first name.');
    if (!EMAIL_OK.test(parent.email.trim())) return setError('That email doesn’t look right.');
    if (!/^\+[0-9]{8,15}$/.test(phone)) return setError('Check the mobile number.');
    setBusy(true); setError(''); setNote('');
    try {
      await inviteParentForMe({ parentFirstName: parent.first.trim(), parentEmail: parent.email.trim(), parentPhone: phone });
      await load();
      setStage('parentSent');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (busy) return;
    setBusy(true); setError(''); setNote('');
    try {
      await resendParentInvite();
      await load();
      setNote('Sent again.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function logOut() {
    haptic();
    const { data: { session } } = await supabase.auth.getSession();
    clearPushToken(session?.user?.id);
    await clearUserCaches();
    await supabase.auth.signOut({ scope: 'local' });
  }

  if (stage === 'loading') {
    return <View style={[styles.safe, styles.center]}><ActivityIndicator color={Onboard.goldInk} /></View>;
  }

  const invite = info?.invite;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.lock}>
            <Ionicons name="lock-closed" size={16} color={Onboard.goldInk} />
          </View>

          {stage === 'choose' && (
            <>
              <Text style={styles.h1}>We think you might be under 18</Text>
              <Text style={styles.sub}>
                Your account is locked until we’ve checked, and your lessons can’t be captured. Which is true?
              </Text>
              <Option
                title="I’m 18 or over"
                desc="We’ll email you a link to confirm it."
                onPress={emailMe}
                busy={busy}
              />
              <Option
                title="I’m under 18"
                desc="A parent approves your account. You keep this account and this phone."
                onPress={() => go('parentForm')}
              />
            </>
          )}

          {stage === 'adult' && (
            <>
              <Text style={styles.h1}>Check your email</Text>
              <Text style={styles.sub}>
                We sent a link to <Text style={styles.strong}>{maskedEmail}</Text>. Tap it to confirm you’re 18 or over and your account unlocks by itself. It works for 24 hours — check your spam too.
              </Text>
              <View style={styles.acts}>
                <SmallButton label={busy ? 'Sending…' : 'Send it again'} onPress={emailMe} />
                <SmallButton label="I’m under 18" onPress={() => go('parentForm')} />
              </View>
            </>
          )}

          {stage === 'parentForm' && (
            <>
              <Text style={styles.h1}>Who’s your parent or guardian?</Text>
              <Text style={styles.sub}>We’ll email them a link and text them a code. Once they approve, your account unlocks.</Text>
              <View style={styles.fields}>
                <TextField label="Parent’s first name" value={parent.first} onChange={(t) => setParent({ ...parent, first: t })}
                  placeholder="Sarah" autoCapitalize="words" />
                <TextField label="Parent’s email" value={parent.email} onChange={(t) => setParent({ ...parent, email: t })}
                  placeholder="sarah@email.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
                <PhoneField label="Parent’s mobile number" country={parent.country}
                  onCountry={(iso) => setParent({ ...parent, country: iso })}
                  value={parent.phone} onChange={(t) => setParent({ ...parent, phone: t })} />
              </View>
            </>
          )}

          {stage === 'parentSent' && (
            <>
              <Text style={styles.h1}>Invitation sent to {invite?.parentFirstName || 'your parent'}</Text>
              <Text style={styles.sub}>
                We emailed <Text style={styles.strong}>{invite?.maskedEmail}</Text>{invite?.maskedPhone ? ' and texted them' : ''}. Once they approve, your account unlocks by itself.
              </Text>
              {invite?.status === 'expired' && <Text style={styles.err}>This invitation has expired. Send it again.</Text>}
              <View style={styles.acts}>
                <SmallButton label={busy ? 'Sending…' : 'Send it again'} onPress={resend} />
                <SmallButton label="Correct their details" onPress={() => go('parentForm')} />
                <SmallButton label="I’m 18 or over" onPress={emailMe} />
              </View>
            </>
          )}

          {!!note && <Text style={styles.note}>{note}</Text>}
          {!!error && <Text style={styles.err}>{error}</Text>}

          <View style={styles.spacer} />

          {stage === 'parentForm' && (
            <>
              <TouchableOpacity style={styles.primary} onPress={inviteParent} disabled={busy} activeOpacity={0.85} accessibilityRole="button">
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryT}>Send invitation</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.link} onPress={() => go(invite ? 'parentSent' : 'choose')} accessibilityRole="button">
                <Text style={styles.linkT}>Back</Text>
              </TouchableOpacity>
            </>
          )}
          {stage !== 'parentForm' && (
            <TouchableOpacity style={styles.link} onPress={logOut} accessibilityRole="button">
              <Text style={styles.linkT}>Log out</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Option({ title, desc, onPress, busy }) {
  return (
    <TouchableOpacity style={styles.option} onPress={onPress} disabled={busy} activeOpacity={0.8} accessibilityRole="button">
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.optionT}>{title}</Text>
        <Text style={styles.optionD}>{desc}</Text>
      </View>
      {busy ? <ActivityIndicator color={Onboard.goldInk} /> : <Ionicons name="chevron-forward" size={18} color={Onboard.ink3} />}
    </TouchableOpacity>
  );
}

function SmallButton({ label, onPress }) {
  return (
    <TouchableOpacity style={styles.small} onPress={onPress} activeOpacity={0.75} accessibilityRole="button">
      <Text style={styles.smallT}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Onboard.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { flexGrow: 1, paddingHorizontal: Spacing.side + 2, paddingTop: 24, paddingBottom: 18 },
  lock: { width: 36, height: 36, borderRadius: 11, backgroundColor: Onboard.goldTint, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  h1: { fontFamily: Fonts.ttDemiBold, fontSize: 27, lineHeight: 31, letterSpacing: -0.8, color: Onboard.ink },
  sub: { fontFamily: Fonts.travelsRegular, fontSize: 14, lineHeight: 20, color: Onboard.ink2, marginTop: 10, marginBottom: 22 },
  strong: { fontFamily: Fonts.ttDemiBold, color: Onboard.ink },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Onboard.card,
    borderRadius: 14, borderWidth: 1, borderColor: Onboard.line, padding: 16, marginBottom: 10,
  },
  optionT: { fontFamily: Fonts.ttDemiBold, fontSize: 16, color: Onboard.ink },
  optionD: { fontFamily: Fonts.travelsRegular, fontSize: 13, lineHeight: 18, color: Onboard.ink2, marginTop: 3 },
  fields: { gap: 13 },
  acts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  small: { borderWidth: 1, borderColor: 'rgba(10,10,10,0.22)', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 15 },
  smallT: { fontFamily: Fonts.ttDemiBold, fontSize: 12.5, color: Onboard.ink },
  note: { fontFamily: Fonts.travelsMedium, fontSize: 13, color: Onboard.ink2, marginTop: 14 },
  err: { fontFamily: Fonts.travelsMedium, fontSize: 13, lineHeight: 18, color: RED, marginTop: 14 },
  spacer: { flex: 1, minHeight: 24 },
  primary: { backgroundColor: Onboard.ink, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  primaryT: { fontFamily: Fonts.ttDemiBold, fontSize: 15, color: '#FFFFFF' },
  link: { alignItems: 'center', marginTop: 14, paddingVertical: 6 },
  linkT: { fontFamily: Fonts.ttDemiBold, fontSize: 13.5, color: Onboard.ink2 },
});
