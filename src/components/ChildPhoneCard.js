import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Fonts } from '../theme';
import {
  createPairingCode, getChildPhoneStatus, signOutChildPhone, formatPairingCode, forgetChildPhones,
} from '../services/childPairing';

// Stats ▸ Links, on a parent's account: getting one child onto their own phone.
//   idle    what it is, and "Get a code"
//   code    the code, how long it lasts, the three steps on the child's phone
//   linked  signed in, when it was last used, and a way to sign it out
// While a code is showing, the card watches for the phone to sign in and turns
// to "linked" on its own.

const INK = '#141311';
const INK_2 = '#6B6656';
const GOLD_INK = '#7F5A0B';
const RED = '#A3281B';

function ago(iso) {
  if (!iso) return null;
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 2) return 'active just now';
  if (min < 60) return `active ${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `active ${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'active yesterday' : `active ${d} days ago`;
}

export default function ChildPhoneCard({ child }) {
  const first = (child.name || 'your child').split(/\s+/)[0];
  const [state, setState] = useState('loading');   // loading | idle | code | linked
  const [code, setCode] = useState(null);           // { code, expiresAt }
  const [lastSeen, setLastSeen] = useState(null);
  // Phones already signed in when the code was made: "Add another phone" waits for one more.
  const baseline = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await getChildPhoneStatus(child.id);
      if (!alive.current) return s;
      setLastSeen(s.lastSeen);
      return s;
    } catch { return null; }
  }, [child.id]);

  useEffect(() => {
    refresh().then((s) => { if (alive.current) setState(s?.linked ? 'linked' : 'idle'); });
  }, [refresh]);

  // A code on screen: tick the countdown, and notice the phone signing in.
  useEffect(() => {
    if (state !== 'code') return undefined;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      const s = await refresh();
      if (s && (s.sessions ?? 0) > baseline.current && alive.current) {
        forgetChildPhones();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setCode(null);
        setState('linked');
      }
    }, 4000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [state, refresh]);

  async function getCode() {
    if (busy) return;
    setBusy(true); setError('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const [r, s] = await Promise.all([createPairingCode(child.id), getChildPhoneStatus(child.id).catch(() => null)]);
      baseline.current = s?.sessions ?? 0;
      setCode({ code: r.code, expiresAt: r.expiresAt });
      setNow(Date.now());
      setState('code');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function confirmSignOut() {
    Alert.alert(
      `Sign out ${first}’s phone?`,
      `${first} will need a new code from you to sign in again. Their training stays.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out', style: 'destructive', onPress: async () => {
            setBusy(true); setError('');
            try {
              await signOutChildPhone(child.id);
              setState('idle');
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  if (state === 'loading') {
    return <View style={[st.card, st.loading]}><ActivityIndicator color={GOLD_INK} /></View>;
  }

  if (state === 'linked') {
    return (
      <View style={st.card}>
        <View style={st.row}>
          <View style={[st.icon, st.iconOn]}>
            <Ionicons name="phone-portrait-outline" size={17} color="#1F6B3A" />
          </View>
          <View style={st.rowText}>
            <Text style={st.title}>{first}’s phone</Text>
            <Text style={st.sub}>Signed in{lastSeen ? ` · ${ago(lastSeen)}` : ''}</Text>
          </View>
          <View style={st.dot} />
        </View>
        {!!error && <Text style={st.err}>{error}</Text>}
        <View style={st.acts}>
          <TouchableOpacity onPress={getCode} disabled={busy} style={st.textBtn} accessibilityRole="button">
            <Text style={st.textBtnT}>Add another phone</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={confirmSignOut} disabled={busy} style={st.textBtn} accessibilityRole="button">
            <Text style={[st.textBtnT, { color: RED }]}>Sign out {first}’s phone</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (state === 'code' && code) {
    const left = Math.max(0, Math.round((new Date(code.expiresAt).getTime() - now) / 1000));
    const expired = left === 0;
    const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    return (
      <View style={st.card}>
        <Text style={st.kicker}>Code for {first}’s phone</Text>
        {/* Syne is wide: one line, shrunk to fit whatever the screen width. */}
        <Text style={[st.code, expired && st.codeOff]} selectable numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}
          accessibilityLabel={`Code: ${code.code.split('').join(' ')}`}>
          {formatPairingCode(code.code)}
        </Text>
        <Text style={[st.expiry, expired && { color: RED }]}>
          {expired ? 'This code has expired.' : `Works once · expires in ${mmss}`}
        </Text>

        {!expired && (
          <View style={st.steps}>
            {[
              `On ${first}’s phone, open InBetween.`,
              'Tap “I already have an account”, then “I have a code from my parent”.',
              'Type this code. Their phone signs in to their own training.',
            ].map((line, i) => (
              <View key={line} style={st.step}>
                <View style={st.stepNum}><Text style={st.stepNumT}>{i + 1}</Text></View>
                <Text style={st.stepT}>{line}</Text>
              </View>
            ))}
            <View style={st.waiting}>
              <ActivityIndicator size="small" color={GOLD_INK} />
              <Text style={st.waitingT}>Waiting for {first}’s phone…</Text>
            </View>
          </View>
        )}
        {!!error && <Text style={st.err}>{error}</Text>}
        <View style={st.acts}>
          <TouchableOpacity onPress={getCode} disabled={busy} style={expired ? [st.btn, { marginTop: 0 }] : st.textBtn} accessibilityRole="button">
            <Text style={expired ? st.btnT : st.textBtnT}>{busy ? 'Getting a code…' : expired ? 'Get a new code' : 'New code'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setCode(null); refresh().then((s) => setState(s?.linked ? 'linked' : 'idle')); }}
            style={st.textBtn} accessibilityRole="button">
            <Text style={[st.textBtnT, { color: INK_2 }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={st.card}>
      <View style={st.row}>
        <View style={st.icon}>
          <Ionicons name="phone-portrait-outline" size={17} color={GOLD_INK} />
        </View>
        <View style={st.rowText}>
          <Text style={st.title}>{first}’s phone</Text>
          <Text style={st.sub}>Not signed in yet</Text>
        </View>
      </View>
      <Text style={st.body}>
        {first} can train on their own phone, signed in to their own profile — without your password or your settings. You get a one-time code to type on their phone.
      </Text>
      {!!error && <Text style={st.err}>{error}</Text>}
      <TouchableOpacity onPress={getCode} disabled={busy} style={st.btn} activeOpacity={0.85} accessibilityRole="button">
        {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={st.btnT}>Get a code</Text>}
      </TouchableOpacity>
    </View>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 18, marginBottom: 12 },
  loading: { minHeight: 76, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(232,181,48,0.16)', alignItems: 'center', justifyContent: 'center' },
  iconOn: { backgroundColor: 'rgba(31,107,58,0.10)' },
  rowText: { flex: 1, minWidth: 0 },
  title: { fontFamily: Fonts.ttBold, fontSize: 15.5, color: INK, letterSpacing: -0.16 },
  sub: { fontFamily: Fonts.ttRegular, fontSize: 13, color: INK_2, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2E9D5B' },
  body: { fontFamily: Fonts.ttRegular, fontSize: 14, lineHeight: 20, color: INK_2, marginTop: 14 },

  kicker: { fontFamily: Fonts.ttBold, fontSize: 11.5, letterSpacing: 1.1, textTransform: 'uppercase', color: GOLD_INK, textAlign: 'center' },
  code: { fontFamily: Fonts.ttBold, fontSize: 30, letterSpacing: 3, color: INK, textAlign: 'center', marginTop: 12 },
  codeOff: { color: 'rgba(20,19,17,0.25)', textDecorationLine: 'line-through' },
  expiry: { fontFamily: Fonts.ttMedium, fontSize: 13, color: INK_2, textAlign: 'center', marginTop: 6 },
  steps: { marginTop: 18, borderTopWidth: 1, borderTopColor: 'rgba(20,19,17,0.08)', paddingTop: 16, gap: 12 },
  step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: INK, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepNumT: { fontFamily: Fonts.ttBold, fontSize: 11.5, color: '#FFFFFF' },
  stepT: { flex: 1, fontFamily: Fonts.ttRegular, fontSize: 14, lineHeight: 20, color: INK },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  waitingT: { fontFamily: Fonts.ttMedium, fontSize: 13, color: GOLD_INK },

  err: { fontFamily: Fonts.ttMedium, fontSize: 13, lineHeight: 18, color: RED, marginTop: 12 },
  acts: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, gap: 8 },
  btn: { flexGrow: 1, minHeight: 48, borderRadius: 999, backgroundColor: INK, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, marginTop: 14 },
  btnT: { fontFamily: Fonts.ttBold, fontSize: 15, color: '#FFFFFF' },
  textBtn: { paddingVertical: 8 },
  textBtnT: { fontFamily: Fonts.ttBold, fontSize: 14, color: INK },
});
