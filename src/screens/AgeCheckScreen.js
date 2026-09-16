// The student's app, locked: a coach indicated this student may be under 18
// and they came without a parent. Three ways out — the coach looks again,
// InBetween checks a proof of age, or a parent approves. AgeCheckGate shows
// this instead of the app and lifts it on its own once the account unlocks.
// It never says which coach, or anything the coach wrote.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Fonts, Spacing, Onboard } from '../theme';
import { supabase } from '../services/supabase/client';
import { clearPushToken } from '../services/notifications';
import { clearUserCaches } from '../storage/userCaches';
import PhoneField, { TextField } from '../components/PhoneField';
import { DEFAULT_COUNTRY, toE164 } from '../utils/phone';
import {
  getAgeCheckStatus, requestCoachReview, submitProofOfAge, inviteParentForMe, resendParentInvite,
} from '../services/ageCheck';
import { markFirstScreenReady } from '../utils/firstPaint';

const RED = '#A3281B';
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const haptic = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

export default function AgeCheckScreen() {
  const [stage, setStage] = useState('loading');   // loading | choose | proof | proofPreview | parentForm | parentSent
  const [photo, setPhoto] = useState(null);         // { uri, base64, mimeType, fromCamera } before it's sent
  const [info, setInfo] = useState(null);
  const [parent, setParent] = useState({ first: '', email: '', phone: '', country: DEFAULT_COUNTRY });
  const [busy, setBusy] = useState(null);           // which action is running
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await getAgeCheckStatus();
      setInfo(r);
      return r;
    } catch { return null; }
  }, []);

  useEffect(() => {
    markFirstScreenReady();   // this is the first screen: let the launch logo go
    load().then(() => setStage('choose'));
    const t = setInterval(load, 15000);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') load(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [load]);

  function go(next) { haptic(); setError(''); setNote(''); setStage(next); }

  async function askCoach() {
    if (busy) return;
    haptic();
    setBusy('coach'); setError(''); setNote('');
    try {
      await requestCoachReview();
      await load();
      setNote('Your coach has been asked to take another look.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  // Take or pick the photo, then look at it before it goes anywhere.
  async function pickProof(fromCamera) {
    if (busy) return;
    haptic();
    setError(''); setNote('');
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      setError(fromCamera ? 'Allow camera access in Settings to take the photo.' : 'Allow photo access in Settings to choose the photo.');
      return;
    }
    const opts = { mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7, base64: true, exif: false };
    const result = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled || !result.assets?.[0]?.base64) return;
    const a = result.assets[0];
    setPhoto({ uri: a.uri, base64: a.base64, mimeType: a.mimeType || 'image/jpeg', fromCamera });
    setStage('proofPreview');
  }

  async function sendProof() {
    if (busy || !photo) return;
    haptic();
    setBusy('proof'); setError(''); setNote('');
    try {
      await submitProofOfAge({ base64: photo.base64, mimeType: photo.mimeType });
      setPhoto(null);
      await load();
      setStage('choose');
      setNote('Sent. We’ll check it shortly, then delete it.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function inviteParent() {
    if (busy) return;
    const phone = toE164(parent.country, parent.phone);
    if (!parent.first.trim()) return setError('Add your parent’s first name.');
    if (!EMAIL_OK.test(parent.email.trim())) return setError('That email doesn’t look right.');
    if (!/^\+[0-9]{8,15}$/.test(phone)) return setError('Check the mobile number.');
    setBusy('parent'); setError(''); setNote('');
    try {
      await inviteParentForMe({ parentFirstName: parent.first.trim(), parentEmail: parent.email.trim(), parentPhone: phone });
      await load();
      setStage('parentSent');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function resend() {
    if (busy) return;
    setBusy('resend'); setError(''); setNote('');
    try {
      await resendParentInvite();
      await load();
      setNote('Sent again.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
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
  const coachDesc = info?.coachReview === 'pending' ? 'Asked · waiting for your coach' : 'They’ll take another look.';
  const proofDesc = info?.proofReview === 'pending' ? 'Sent · we’re checking it'
    : info?.proofReview === 'rejected' ? 'We couldn’t confirm it · send another'
    : 'Only your date of birth is needed.';
  const parentDesc = invite ? `Invitation sent to ${invite.parentFirstName || 'your parent'}` : 'A parent approves your account.';

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.lock}>
            <Ionicons name="lock-closed" size={16} color={Onboard.goldInk} />
          </View>

          {stage === 'choose' && (
            <>
              <Text style={styles.h1}>We need to confirm your age</Text>
              <Text style={styles.sub}>Our safety checks flagged that you may be under 18.</Text>
              {/* Once the coach has looked again and kept their answer, only the
                  other two ways are left. */}
              {info?.coachReview !== 'rejected' && (
                <Option
                  title="Ask your coach to review"
                  desc={coachDesc}
                  waiting={info?.coachReview === 'pending'}
                  busy={busy === 'coach'}
                  onPress={info?.coachReview === 'pending' ? undefined : askCoach}
                />
              )}
              <Option
                title={info?.coachReview === 'rejected' ? 'Send us proof of age' : 'Or send us proof of age'}
                desc={proofDesc}
                waiting={info?.proofReview === 'pending'}
                onPress={() => go('proof')}
              />
              <Option
                title="I’m under 18"
                desc={parentDesc}
                waiting={!!invite}
                onPress={() => go(invite ? 'parentSent' : 'parentForm')}
              />
            </>
          )}

          {stage === 'proof' && (
            <>
              <Text style={styles.h1}>Send us proof of age</Text>
              <Text style={styles.sub}>A photo of an ID — a passport, a driving licence or an ID card.</Text>
              <View style={styles.promise}>
                {[
                  ['calendar-outline', 'Only your date of birth is needed.'],
                  ['eye-off-outline', 'You can hide everything else.'],
                  ['trash-outline', 'We check it and delete it immediately.'],
                ].map(([icon, line]) => (
                  <View key={line} style={styles.promiseRow}>
                    <Ionicons name={icon} size={17} color={Onboard.goldInk} />
                    <Text style={styles.promiseT}>{line}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {stage === 'proofPreview' && photo && (
            <>
              <Text style={styles.h1}>Can you read your date of birth?</Text>
              <Text style={styles.sub}>Check it’s sharp and nothing else you’d rather keep private is showing.</Text>
              <Image source={{ uri: photo.uri }} style={styles.preview} contentFit="contain" accessibilityLabel="Your photo" />
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
                <SmallButton label={busy === 'resend' ? 'Sending…' : 'Send it again'} onPress={resend} />
                <SmallButton label="Correct their details" onPress={() => go('parentForm')} />
              </View>
            </>
          )}

          {!!note && <Text style={styles.note}>{note}</Text>}
          {!!error && <Text style={styles.err}>{error}</Text>}

          <View style={styles.spacer} />

          {stage === 'proof' && (
            <>
              <TouchableOpacity style={styles.primary} onPress={() => pickProof(true)} disabled={!!busy} activeOpacity={0.85} accessibilityRole="button">
                <Text style={styles.primaryT}>Take a photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={() => pickProof(false)} disabled={!!busy} activeOpacity={0.85} accessibilityRole="button">
                <Text style={styles.secondaryT}>Choose a photo</Text>
              </TouchableOpacity>
            </>
          )}
          {stage === 'proofPreview' && (
            <>
              <TouchableOpacity style={styles.primary} onPress={sendProof} disabled={!!busy} activeOpacity={0.85} accessibilityRole="button">
                {busy === 'proof' ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryT}>Send</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={() => pickProof(!!photo?.fromCamera)} disabled={!!busy} activeOpacity={0.85} accessibilityRole="button">
                <Text style={styles.secondaryT}>{photo?.fromCamera ? 'Retake' : 'Choose another'}</Text>
              </TouchableOpacity>
            </>
          )}
          {stage === 'parentForm' && (
            <TouchableOpacity style={styles.primary} onPress={inviteParent} disabled={!!busy} activeOpacity={0.85} accessibilityRole="button">
              {busy === 'parent' ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryT}>Send invitation</Text>}
            </TouchableOpacity>
          )}
          {stage === 'choose' ? (
            <TouchableOpacity style={styles.link} onPress={logOut} accessibilityRole="button">
              <Text style={styles.linkT}>Log out</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.link} onPress={() => { setPhoto(null); go(stage === 'proofPreview' ? 'proof' : 'choose'); }} accessibilityRole="button">
              <Text style={styles.linkT}>Back</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Option({ title, desc, onPress, busy, waiting }) {
  return (
    <TouchableOpacity style={[styles.option, waiting && styles.optionWaiting]} onPress={onPress} disabled={!onPress || busy}
      activeOpacity={0.8} accessibilityRole="button">
      <Ionicons name="arrow-forward" size={17} color={Onboard.goldInk} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.optionT}>{title}</Text>
        <Text style={[styles.optionD, waiting && styles.optionDWaiting]}>{desc}</Text>
      </View>
      {busy ? <ActivityIndicator color={Onboard.goldInk} /> : null}
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
    borderRadius: 14, borderWidth: 1, borderColor: Onboard.line, paddingVertical: 15, paddingHorizontal: 16, marginBottom: 10,
  },
  optionWaiting: { backgroundColor: 'rgba(232,181,48,0.08)', borderColor: 'rgba(232,181,48,0.35)' },
  optionT: { fontFamily: Fonts.ttDemiBold, fontSize: 16, color: Onboard.ink },
  optionD: { fontFamily: Fonts.travelsRegular, fontSize: 13, lineHeight: 18, color: Onboard.ink2, marginTop: 3 },
  optionDWaiting: { fontFamily: Fonts.travelsMedium, color: Onboard.goldInk },
  promise: { backgroundColor: Onboard.card, borderRadius: 14, borderWidth: 1, borderColor: Onboard.line, padding: 16, gap: 14 },
  promiseRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  promiseT: { flex: 1, fontFamily: Fonts.ttDemiBold, fontSize: 15, lineHeight: 20, color: Onboard.ink },
  preview: { width: '100%', height: 300, borderRadius: 14, backgroundColor: '#0A0A0A' },
  fields: { gap: 13 },
  acts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  small: { borderWidth: 1, borderColor: 'rgba(10,10,10,0.22)', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 15 },
  smallT: { fontFamily: Fonts.ttDemiBold, fontSize: 12.5, color: Onboard.ink },
  note: { fontFamily: Fonts.travelsMedium, fontSize: 13, lineHeight: 18, color: Onboard.ink2, marginTop: 14 },
  err: { fontFamily: Fonts.travelsMedium, fontSize: 13, lineHeight: 18, color: RED, marginTop: 14 },
  spacer: { flex: 1, minHeight: 24 },
  primary: { backgroundColor: Onboard.ink, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  primaryT: { fontFamily: Fonts.ttDemiBold, fontSize: 15, color: '#FFFFFF' },
  secondary: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(10,10,10,0.18)', marginTop: 10 },
  secondaryT: { fontFamily: Fonts.ttDemiBold, fontSize: 15, color: Onboard.ink },
  link: { alignItems: 'center', marginTop: 14, paddingVertical: 6 },
  linkT: { fontFamily: Fonts.ttDemiBold, fontSize: 13.5, color: Onboard.ink2 },
});
