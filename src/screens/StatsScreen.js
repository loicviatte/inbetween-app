import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Modal,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Alert,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import TabHeader, { useIsParentAccount } from '../components/TabHeader';
import StyleTitle from '../components/StyleTitle';
import AccountSheet from '../components/AccountSheet';
import { useTabBarSpace } from '../components/CustomTabBar';
import MaskedView from '@react-native-masked-view/masked-view';
import PullLogo, { usePullRefresh } from '../components/PullLogo';
import { categoryFromStyle } from '../utils/danceCategory';
import { saveUserPreferences, getAccountUser, clearSubjectCache, invalidateCache } from '../storage/storage';
import { isGuardian, listChildren, setActiveChild } from '../storage/guardianStorage';
import { createChildAccount } from '../services/childAccount';
import { withdrawChild, getConsentCopy, sendPhoneCode, checkPhoneCode } from '../services/minorConsent';
import ProfileDashboard from '../components/ProfileDashboard';
import ChildPhoneCard from '../components/ChildPhoneCard';
import { logOutWithChecks } from '../services/logout';
import { HEALTH_CONSENT, healthConsentState, giveHealthConsent, withdrawHealthConsent } from '../services/healthConsent';
import { isAdminEmail } from '../services/featureFlags';
import ProfileSkeleton from '../components/ProfileSkeleton';
import StudioPicker from '../components/StudioPicker';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Fonts, Spacing } from '../theme';
import {
  getUser,
  saveUserProfile,
  getMyCoach,
  linkToCoachByCode,
  unlinkCoach,
  linkToCoachByCodeForCategory,
  unlinkCoachForCategory,
  getMyCoachForCategory,
  getStudentProfileBundle,
} from '../storage/storage';
import { supabase } from '../services/supabase/client';
import QuestionDetailSheet from '../components/QuestionDetailSheet';
import BottomSheet from '../components/BottomSheet';
import { useProfile } from '../context/ProfileContext';
import {
  getMyCouple,
  getMyPartnerCode,
  requestPartnerByCode,
  getIncomingPartnerRequest,
  getOutgoingPartnerRequest,
  acceptPartnerRequest,
  validatePartner,
  declinePartnerRequest,
  cancelPartnerRequest,
  unpair,
  requestCoupleCoachByCode,
  proposeCoupleChange,
  respondCoupleChange,
  cancelCoupleChange,
} from '../storage/coupleStorage';

// Stats content padding, and the soft fade where it meets the header.
const CONTENT_TOP = 2;
const CONTENT_BOTTOM = 30;
const EDGE_FADE = 14;
const AVATAR_KEY = '@profile_photo';
const PROFILE_CACHE_KEY = '@cache_profile';

// Hardening: never let a hung Supabase call wedge load() forever. On the
// free-tier pooler a saturated/cold backend can leave a request pending
// indefinitely — without this, Promise.all never settles, the skeleton never
// clears, and we keep holding the connection (which worsens the saturation).
// Resolves to `fallback` after `ms` so every fetch settles no matter what.
const FETCH_TIMEOUT = 10000;
function withTimeout(promise, fallback, ms = FETCH_TIMEOUT) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// ─── Section label with rule line (Coaches / Statistics tabs) ─────────────────
function SecLabel({ text, right, plain }) {
  return (
    <View style={row.secLabel}>
      <Text style={[row.secLabelText, plain && row.secLabelTextPlain]}>{text}</Text>
      <View style={row.secLabelRule} />
      {!!right && <Text style={row.secLabelRight}>{right}</Text>}
    </View>
  );
}

// ─── Coach row inside the Coaches tab (tappable → coach-link modal) ───────────
function CoachListRow({ category, coach, onPress }) {
  const isPending = !!coach?.pending;
  const muted = !coach || isPending;
  const initials = coach?.name?.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '+';
  const name = isPending ? 'Waiting to accept…' : (coach?.name || 'Add teacher');
  return (
    <TouchableOpacity style={row.card} onPress={onPress} activeOpacity={0.75}>
      <View style={[row.init, muted && row.initAdd]}>
        <Text style={[row.initTxt, muted && row.initTxtAdd]}>{initials}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={row.role}>{`${category || 'Coach'} · Coach`}</Text>
        <Text style={[row.name, muted && row.nameMuted]} numberOfLines={1}>{name}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="rgba(10,10,10,0.3)" />
    </TouchableOpacity>
  );
}

// ─── Old CoachSlot (for the edit-modal flow / single-style users) ────────────
function CoachSlot({ label, coach, code, onCodeChange, linking, linkError, onAdd, onUnlink }) {
  return (
    <View>
      {!!label && <Text style={coachStyles.slotLabel}>{label}</Text>}
      {coach ? (
        <View style={coachStyles.linkedRow}>
          <View style={coachStyles.coachAvatar}>
            <Text style={coachStyles.coachInitials}>
              {coach.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'}
            </Text>
          </View>
          <View style={coachStyles.coachInfo}>
            <Text style={coachStyles.coachName}>{coach.name}</Text>
            {coach.pending
              ? <Text style={coachStyles.coachStudio}>Waiting for {coach.name?.split(' ')[0] || 'coach'} to accept…</Text>
              : (!!coach.studio?.name && <Text style={coachStyles.coachStudio}>{coach.studio.name}</Text>)
            }
          </View>
          <TouchableOpacity onPress={onUnlink} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={18} color={Colors.secondary} />
          </TouchableOpacity>
        </View>
      ) : (
        <View>
          <View style={coachStyles.inputRow}>
            <TextInput
              style={coachStyles.codeInput}
              value={code}
              onChangeText={onCodeChange}
              placeholder="Invite code"
              placeholderTextColor="rgba(13,13,18,0.25)"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
            />
            <TouchableOpacity
              style={[coachStyles.addBtn, (!code?.trim() || linking) && coachStyles.addBtnDisabled]}
              onPress={onAdd}
              disabled={linking || !code?.trim()}
              activeOpacity={0.85}
            >
              {linking
                ? <ActivityIndicator color={Colors.white} size="small" />
                : <Ionicons name="arrow-forward" size={16} color={Colors.white} />
              }
            </TouchableOpacity>
          </View>
          {!!linkError && <Text style={coachStyles.linkError}>{linkError}</Text>}
        </View>
      )}
    </View>
  );
}

// ─── Partner row inside the Coaches tab (tappable → partner modal) ────────────
// While a request is in flight, the row reads as clearly *pending* (clock, not a
// "+"), with a label that names the exact stage — so a dancer can't mistake it
// for an "Add partner" affordance and kick off a second link. `actionNeeded`
// (someone asked you / your request was accepted and awaits your confirm) gets
// an accent dot since it's your move.
function PartnerListRow({ couple, incoming, outgoing, onPress }) {
  const paired = !!couple;
  const partnerName = couple?.partner?.name;
  const pending = !paired && (!!incoming || !!outgoing);
  // Your move = someone asked you (incoming pending) or your request was
  // accepted and awaits your confirm (outgoing awaiting_validation). Passive =
  // you already acted and are waiting on the other dancer.
  const actionNeeded = !paired && (incoming?.status === 'pending' || outgoing?.status === 'awaiting_validation');

  let name;
  if (paired) name = partnerName || 'Partner';
  else if (incoming?.status === 'awaiting_validation') name = `Waiting for ${(incoming.requesterName || 'partner').split(' ')[0]} to confirm…`;
  else if (incoming) name = `${(incoming.requesterName || 'Someone').split(' ')[0]} wants to pair`;
  else if (outgoing?.status === 'awaiting_validation') name = 'Confirm to pair';
  else if (outgoing) name = `Waiting for ${(outgoing.targetName || 'partner').split(' ')[0]}…`;
  else name = 'Add partner';

  const initials = paired
    ? (partnerName?.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'P')
    : null;

  return (
    <TouchableOpacity style={row.card} onPress={onPress} activeOpacity={0.75}>
      <View style={[row.init, !paired && row.initAdd]}>
        {paired ? (
          <Text style={row.initTxt}>{initials}</Text>
        ) : pending ? (
          <Ionicons name="time-outline" size={18} color="rgba(10,10,10,0.55)" />
        ) : (
          <Text style={[row.initTxt, row.initTxtAdd]}>+</Text>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={row.role}>{pending ? (actionNeeded ? 'Partner · your turn' : 'Partner · pending') : 'Partner'}</Text>
        <Text style={[row.name, !paired && row.nameMuted]} numberOfLines={1}>{name}</Text>
      </View>
      {actionNeeded ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#E8B530', marginRight: 8 }} /> : null}
      <Ionicons name="chevron-forward" size={16} color="rgba(10,10,10,0.3)" />
    </TouchableOpacity>
  );
}

// ─── Couple-coach row (Links ▸ Partnership) — one per style the couple dances.
// `coach` is { id, name } | null. RLS may hide the coach's name from a dancer,
// so a linked-but-nameless coach reads as "Linked"; tap opens the partner modal
// to designate / manage.
function CoupleCoachStatusRow({ category, coach, onPress }) {
  const linked = !!coach;
  const name = coach?.name || null;
  const initials = name ? name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() : null;
  const display = linked ? (name || 'Linked') : 'Add couple coach';
  return (
    <TouchableOpacity style={row.card} onPress={onPress} activeOpacity={0.75}>
      <View style={[row.init, !linked && row.initAdd]}>
        {linked
          ? (initials
              ? <Text style={row.initTxt}>{initials}</Text>
              : <Ionicons name="checkmark" size={16} color="#0A0A0A" />)
          : <Text style={[row.initTxt, row.initTxtAdd]}>+</Text>}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={row.role}>{`${category} · Couple coach`}</Text>
        <Text style={[row.name, !linked && row.nameMuted]} numberOfLines={1}>{display}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="rgba(10,10,10,0.3)" />
    </TouchableOpacity>
  );
}

// ─── Couple-coach sheet body — designate / replace the couple coach for one
// style. Its own focused modal (not the partner/pairing sheet). Holds its own
// code-input state so the parent modal stays dumb.
function CoupleCoachSheet({ category, couple, onDesignate, onClose }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const label = category === 'latin' ? 'Latin' : 'Ballroom';
  const isLinked = category === 'latin' ? !!couple?.latinCoupleCoachId : !!couple?.ballroomCoupleCoachId;
  const linkedName = category === 'latin' ? couple?.latinCoupleCoach?.name : couple?.ballroomCoupleCoach?.name;

  async function submit() {
    if (!code.trim() || busy) return;
    setBusy(true);
    setErr('');
    try {
      await onDesignate(category, code);
      setCode('');
      onClose();
    } catch (e) {
      setErr(e.message || 'Could not send request.');
    }
    setBusy(false);
  }

  return (
    <>
      <Text style={em.title}>{label} couple coach</Text>
      {isLinked && (
        <View style={ccm.linkedRow}>
          <Ionicons name="checkmark-circle" size={18} color="#22a861" />
          <Text style={ccm.linkedTxt} numberOfLines={1}>
            {linkedName ? `Linked · ${linkedName}` : 'Linked'}
          </Text>
        </View>
      )}
      <Text style={em.fieldLabel}>{isLinked ? 'Replace with another coach' : 'Coach invite code'}</Text>
      <View style={pm.inputRow}>
        <TextInput
          style={pm.input}
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          placeholder="Coach code"
          placeholderTextColor="rgba(13,13,18,0.25)"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={8}
        />
        <TouchableOpacity
          style={[pm.addBtn, (!code.trim() || busy) && { opacity: 0.5 }]}
          disabled={!code.trim() || busy}
          onPress={submit}
          activeOpacity={0.85}
        >
          {busy ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="arrow-forward" size={16} color="#fff" />}
        </TouchableOpacity>
      </View>
      {!!err && <Text style={pm.err}>{err}</Text>}
      <Text style={ccm.note}>Your partner's couple coach is shared — they'll see this change too.</Text>
    </>
  );
}

// ─── Couple change sheet — propose new dance types or leader. The change is
// staged and must be approved by the partner (announced here before sending).
function CoupleEditSheet({ mode, couple, myUserId, myName, partnerName, onPropose, onClose }) {
  const [doesLatin, setDoesLatin] = useState(!!couple?.doesLatin);
  const [doesBallroom, setDoesBallroom] = useState(!!couple?.doesBallroom);
  const [leaderId, setLeaderId] = useState(couple?.leaderUserId || myUserId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const partnerId = couple?.partner?.id;
  const valid = mode === 'types' ? (doesLatin || doesBallroom) : !!leaderId;
  // Only a real change is worth sending — keep the button + approval notice
  // hidden until something actually differs from the current setup.
  const dirty = mode === 'types'
    ? (doesLatin !== !!couple?.doesLatin || doesBallroom !== !!couple?.doesBallroom)
    : (leaderId !== (couple?.leaderUserId || myUserId));
  const canSend = valid && dirty;

  async function submit() {
    if (!canSend || busy) return;
    setBusy(true);
    setErr('');
    try {
      await onPropose({
        doesLatin: mode === 'types' ? doesLatin : !!couple?.doesLatin,
        doesBallroom: mode === 'types' ? doesBallroom : !!couple?.doesBallroom,
        leaderId: mode === 'roles' ? leaderId : (couple?.leaderUserId || myUserId),
      });
      onClose();
    } catch (e) {
      setErr(e.message || 'Could not send for approval.');
    }
    setBusy(false);
  }

  const Chip = ({ active, label, onPress: op }) => (
    <TouchableOpacity onPress={op} activeOpacity={0.8} style={[pm.chip, active && pm.chipOn]}>
      <Text style={[pm.chipTxt, active && pm.chipTxtOn]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <>
      <Text style={em.title}>{mode === 'types' ? 'Dance types' : 'Who leads?'}</Text>
      {mode === 'types' ? (
        <View style={pm.chipRow}>
          <Chip active={doesLatin} label="Latin" onPress={() => setDoesLatin((v) => !v)} />
          <Chip active={doesBallroom} label="Ballroom" onPress={() => setDoesBallroom((v) => !v)} />
        </View>
      ) : (
        <View style={pm.chipRow}>
          <Chip active={leaderId === myUserId} label={myName} onPress={() => setLeaderId(myUserId)} />
          <Chip active={leaderId === partnerId} label={partnerName} onPress={() => setLeaderId(partnerId)} />
        </View>
      )}
      {canSend && (
        <View style={cc.notice}>
          <Ionicons name="information-circle-outline" size={16} color="#A8801A" />
          <Text style={cc.noticeTxt}>{partnerName} must approve this before it takes effect.</Text>
        </View>
      )}
      {!!err && <Text style={pm.err}>{err}</Text>}
      <TouchableOpacity
        style={[pm.primaryBtn, { marginTop: canSend ? 0 : 14 }, (!canSend || busy) && { opacity: 0.5 }]}
        disabled={!canSend || busy}
        onPress={submit}
        activeOpacity={0.85}
      >
        {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={pm.primaryTxt}>Send for approval</Text>}
      </TouchableOpacity>
    </>
  );
}

// ─── Couple change review sheet — the partner approves / declines a staged change.
function CoupleReviewSheet({ couple, partnerName, onRespond, onClose }) {
  const [busy, setBusy] = useState(false);
  const ch = couple?.pendingChange || {};
  const stylesLabel = [ch.does_latin && 'Latin', ch.does_ballroom && 'Ballroom'].filter(Boolean).join(' & ') || '—';
  const leaderIsPartner = ch.leader_user_id === couple?.partner?.id;
  const leaderLabel = leaderIsPartner ? `${partnerName} leads` : 'You lead';

  async function respond(accept) {
    if (busy) return;
    setBusy(true);
    try {
      await onRespond(accept);
      onClose();
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not respond.');
    }
    setBusy(false);
  }

  return (
    <>
      <Text style={em.title}>{partnerName}'s proposed change</Text>
      <View style={cc.reviewCard}>
        <View style={cc.reviewLine}>
          <Text style={cc.reviewKey}>Dance types</Text>
          <Text style={cc.reviewVal}>{stylesLabel}</Text>
        </View>
        <View style={[cc.reviewLine, cc.reviewLineBorder]}>
          <Text style={cc.reviewKey}>Leader</Text>
          <Text style={cc.reviewVal}>{leaderLabel}</Text>
        </View>
      </View>
      <TouchableOpacity style={[pm.primaryBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={() => respond(true)} activeOpacity={0.85}>
        {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={pm.primaryTxt}>Approve</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={pm.linkBtn} disabled={busy} onPress={() => respond(false)} activeOpacity={0.7}>
        <Text style={pm.linkTxt}>Decline</Text>
      </TouchableOpacity>
    </>
  );
}

// A sibling only needs a name and a style to exist: the rest — level, studio,
// coach, focus points — arrives from their first recorded lesson, the same way
// it does for any student.
function AddChildModal({ visible, onClose, onCreated }) {
  // details → phone (number, then code) → permission. Same three steps a parent
  // goes through at sign-up: a child added here gets the same proof.
  const [step, setStep] = useState('details');
  const [name, setName] = useState('');
  const [style, setStyle] = useState('Latin');
  const [phone, setPhone] = useState('');
  const [smsId, setSmsId] = useState('');
  const [smsMasked, setSmsMasked] = useState('');
  const [code, setCode] = useState('');
  const [phoneToken, setPhoneToken] = useState('');
  const [copy, setCopy] = useState(null);
  const [checks, setChecks] = useState([false, false, false]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible) return;
    setStep('details'); setName(''); setStyle('Latin'); setPhone(''); setSmsId(''); setSmsMasked('');
    setCode(''); setPhoneToken(''); setCopy(null); setChecks([false, false, false]); setErr('');
  }, [visible]);

  const run = async (fn) => {
    setSaving(true); setErr('');
    try { await fn(); } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };
  const phoneOk = /^\+[0-9]{8,15}$/.test(phone.replace(/[\s().-]/g, ''));

  const sendCode = () => run(async () => {
    const r = await sendPhoneCode(phone.trim());
    setSmsId(r.verificationId); setSmsMasked(r.maskedPhone); setCode('');
  });
  const verifyCode = () => run(async () => {
    const r = await checkPhoneCode(smsId, code);
    setPhoneToken(r.phoneToken);
    // the wording names the child, so it is fetched once the name is known
    setCopy(await getConsentCopy(name.trim(), null));
    setChecks([false, false, false]);
    setStep('consent');
  });
  const save = () => run(async () => {
    const res = await createChildAccount({
      childName: name.trim(), danceStyle: style, phoneToken,
      consent: { checks, termsVersion: copy?.termsVersion },
    });
    if (res.error) throw new Error(res.error);
    onCreated();
  });

  function back() {
    setErr('');
    if (step === 'consent') return setStep('phone');
    if (step === 'phone' && smsId && !phoneToken) { setSmsId(''); return setCode(''); }
    if (step === 'phone') return setStep('details');
    return onClose();
  }

  const allTicked = checks.every(Boolean);
  const cta = (label, onPress, enabled) => (
    <TouchableOpacity style={[ac.save, (!enabled || saving) && ac.saveOff]} onPress={onPress}
      disabled={!enabled || saving} activeOpacity={0.88}>
      <Text style={ac.saveT}>{saving ? 'One moment…' : label}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={ac.backdrop}>
        <View style={ac.sheet}>
          {step === 'details' && (
            <>
              <Text style={ac.title}>Add a child</Text>
              <Text style={ac.sub}>They get their own training, focus points and coach.</Text>
              <Text style={ac.label}>NAME</Text>
              <View style={ac.field}>
                <TextInput style={ac.input} value={name} onChangeText={setName} placeholder="Noah"
                  placeholderTextColor="rgba(10,10,10,0.42)" autoCapitalize="words" autoFocus />
              </View>
              <Text style={ac.label}>DANCE STYLE</Text>
              <View style={ac.styles}>
                {['Latin', 'Ballroom', 'Latin & Ballroom'].map((v) => (
                  <TouchableOpacity key={v} style={[ac.chip, style === v && ac.chipOn]} onPress={() => setStyle(v)}
                    activeOpacity={0.85} accessibilityRole="radio" accessibilityState={{ selected: style === v }}>
                    <Text style={[ac.chipT, style === v && ac.chipTOn]}>{v === 'Latin & Ballroom' ? 'Both' : v}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {cta('Continue', () => setStep('phone'), !!name.trim())}
            </>
          )}

          {step === 'phone' && !smsId && (
            <>
              <Text style={ac.title}>Your mobile number</Text>
              <Text style={ac.sub}>We’ll text you a code. The permission comes from you, so the number has to be yours.</Text>
              <Text style={ac.label}>MOBILE NUMBER</Text>
              <View style={ac.field}>
                <TextInput style={ac.input} value={phone} onChangeText={setPhone} placeholder="+44 7700 900123"
                  placeholderTextColor="rgba(10,10,10,0.42)" keyboardType="phone-pad" autoFocus />
              </View>
              {!!err && <Text style={ac.err}>{err}</Text>}
              {cta('Text me a code', sendCode, phoneOk)}
            </>
          )}

          {step === 'phone' && !!smsId && (
            <>
              <Text style={ac.title}>Enter the code</Text>
              <Text style={ac.sub}>Sent to {smsMasked}.</Text>
              <Text style={ac.label}>6-DIGIT CODE</Text>
              <View style={ac.field}>
                <TextInput style={ac.input} value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456" placeholderTextColor="rgba(10,10,10,0.42)" keyboardType="number-pad"
                  textContentType="oneTimeCode" autoFocus />
              </View>
              {!!err && <Text style={ac.err}>{err}</Text>}
              {cta('Verify', verifyCode, /^[0-9]{6}$/.test(code))}
              <TouchableOpacity onPress={sendCode} style={ac.cancel} activeOpacity={0.7} disabled={saving}>
                <Text style={ac.linkT}>Send a new code</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'consent' && copy && (
            <ScrollView style={ac.scroll} showsVerticalScrollIndicator={false}>
              <Text style={ac.title}>What happens</Text>
              {copy.copy.what.map((line) => (
                <View key={line} style={ac.bullet}><View style={ac.dot} /><Text style={ac.bulletT}>{line}</Text></View>
              ))}
              <Text style={[ac.label, ac.labelGap]}>YOUR PERMISSION</Text>
              {copy.copy.checks.map((line, i) => (
                <TouchableOpacity key={line} style={[ac.check, checks[i] && ac.checkOn]}
                  onPress={() => setChecks(checks.map((c, k) => (k === i ? !c : c)))}
                  activeOpacity={0.85} accessibilityRole="checkbox" accessibilityState={{ checked: checks[i] }}>
                  <View style={[ac.box, checks[i] && ac.boxOn]}>
                    {checks[i] ? <Ionicons name="checkmark" size={14} color="#141311" /> : null}
                  </View>
                  <Text style={ac.checkT}>{line}</Text>
                </TouchableOpacity>
              ))}
              {!!err && <Text style={ac.err}>{err}</Text>}
              {cta('Give permission and add', save, allTicked)}
            </ScrollView>
          )}

          <TouchableOpacity onPress={back} style={ac.cancel} activeOpacity={0.7}>
            <Text style={ac.cancelT}>{step === 'details' ? 'Cancel' : 'Back'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function SettingRow({ icon, label, value, onPress, isLast }) {
  return (
    <TouchableOpacity
      style={[set.row, !isLast && set.rowBorder]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={set.label} numberOfLines={1}>{label}</Text>
      {!!value && <Text style={set.value}>{value}</Text>}
      <Ionicons name="chevron-forward" size={15} color="#767061" />
    </TouchableOpacity>
  );
}

// ─── Partner pairing modal — the full double-opt-in handshake ─────────────────
// States: enter code → outgoing pending → outgoing awaiting-validation (A
// confirms) ; incoming pending (B configures style+leader) ; paired (unpair).
function PartnerModal({
  visible, onClose, couple, incoming, outgoing, myUserId, myName,
  code, onCodeChange, linking, error, myCode,
  onRequest, onAccept, onValidate, onDecline, onCancel, onUnpair,
}) {
  const [doesLatin, setDoesLatin] = useState(true);
  const [doesBallroom, setDoesBallroom] = useState(false);
  const [leaderId, setLeaderId] = useState(null);

  const Chip = ({ active, label, onPress: op }) => (
    <TouchableOpacity onPress={op} activeOpacity={0.8} style={[pm.chip, active && pm.chipOn]}>
      <Text style={[pm.chipTxt, active && pm.chipTxtOn]}>{label}</Text>
    </TouchableOpacity>
  );

  let body;
  if (couple) {
    const pFirst = (couple.partner?.name || 'Partner').split(' ')[0];
    const styles = [couple.doesLatin && 'Latin', couple.doesBallroom && 'Ballroom'].filter(Boolean).join(' · ') || '—';
    body = (
      <View>
        <View style={pm.partnerRow}>
          <View style={pm.pAvatar}><Text style={pm.pAvatarTxt}>{(couple.partner?.name || 'P').slice(0, 2).toUpperCase()}</Text></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={pm.pName} numberOfLines={1}>{couple.partner?.name || 'Partner'}</Text>
            <Text style={pm.pMeta} numberOfLines={1}>{styles}  ·  {couple.iAmLeader ? 'You lead' : `${pFirst} leads`}</Text>
          </View>
        </View>
        <TouchableOpacity style={pm.dangerBtn} onPress={onUnpair} activeOpacity={0.85}>
          <Text style={pm.dangerTxt}>Unpair</Text>
        </TouchableOpacity>
        <Text style={pm.note}>Unpairing erases all couple progress for both of you.</Text>
      </View>
    );
  } else if (incoming && incoming.status === 'awaiting_validation') {
    // B already accepted + configured; now waiting on the requester (A) to
    // confirm. Without this branch B would see nothing once they've accepted.
    const pFirst = (incoming.requesterName || 'Partner').split(' ')[0];
    const styles = [incoming.proposedDoesLatin && 'Latin', incoming.proposedDoesBallroom && 'Ballroom'].filter(Boolean).join(' · ') || '—';
    const leads = incoming.proposedLeaderId === myUserId ? (myName || 'You') : pFirst;
    body = (
      <View>
        <Text style={pm.lead}>You accepted — waiting for <Text style={pm.bold}>{incoming.requesterName}</Text> to confirm.</Text>
        <Text style={pm.pMeta}>{styles}  ·  {leads} leads</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16 }}>
          <ActivityIndicator size="small" />
          <Text style={[pm.pMeta, { marginLeft: 8 }]}>Waiting for {pFirst}’s confirmation…</Text>
        </View>
        <TouchableOpacity style={pm.linkBtn} onPress={onDecline} activeOpacity={0.7}><Text style={pm.linkTxt}>Cancel</Text></TouchableOpacity>
      </View>
    );
  } else if (incoming) {
    const pFirst = (incoming.requesterName || 'Partner').split(' ')[0];
    body = (
      <View>
        <Text style={pm.lead}><Text style={pm.bold}>{incoming.requesterName}</Text> wants to be your dance partner.</Text>
        <Text style={pm.fieldLabel}>Styles you dance together</Text>
        <View style={pm.chipRow}>
          <Chip active={doesLatin} label="Latin" onPress={() => setDoesLatin(v => !v)} />
          <Chip active={doesBallroom} label="Ballroom" onPress={() => setDoesBallroom(v => !v)} />
        </View>
        <Text style={pm.fieldLabel}>Who leads?</Text>
        <View style={pm.chipRow}>
          <Chip active={leaderId === myUserId} label={myName || 'You'} onPress={() => setLeaderId(myUserId)} />
          <Chip active={leaderId === incoming.requesterId} label={pFirst} onPress={() => setLeaderId(incoming.requesterId)} />
        </View>
        {!!error && <Text style={pm.err}>{error}</Text>}
        <TouchableOpacity
          style={[pm.primaryBtn, (linking || (!doesLatin && !doesBallroom) || !leaderId) && { opacity: 0.5 }]}
          disabled={linking || (!doesLatin && !doesBallroom) || !leaderId}
          onPress={() => onAccept({ doesLatin, doesBallroom, leaderId })} activeOpacity={0.85}>
          {linking ? <ActivityIndicator color="#fff" size="small" /> : <Text style={pm.primaryTxt}>Accept</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={pm.linkBtn} onPress={onDecline} activeOpacity={0.7}><Text style={pm.linkTxt}>Decline</Text></TouchableOpacity>
      </View>
    );
  } else if (outgoing && outgoing.status === 'awaiting_validation') {
    // Final stage A sees: partner accepted + configured → A reviews and pairs.
    const pFirst = (outgoing.targetName || 'Partner').split(' ')[0];
    const iLead = outgoing.proposedLeaderId === myUserId;
    const styleList = [outgoing.proposedDoesLatin && 'Latin', outgoing.proposedDoesBallroom && 'Ballroom'].filter(Boolean);
    const pInitials = (outgoing.targetName || 'P').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    body = (
      <View>
        <View style={pm.confirmHero}>
          <View style={pm.confirmAvatar}>
            {outgoing.targetAvatar
              ? <Image source={{ uri: outgoing.targetAvatar }} style={pm.confirmAvatarImg} />
              : <Text style={pm.pAvatarTxt}>{pInitials}</Text>}
          </View>
          <Text style={pm.confirmName} numberOfLines={1}>{outgoing.targetName}</Text>
          <Text style={pm.confirmSub}>accepted — review &amp; pair up</Text>
        </View>

        <View style={pm.summaryCard}>
          <View style={pm.summaryRow}>
            <Text style={pm.summaryLabel}>Styles</Text>
            <View style={pm.pillWrap}>
              {styleList.length ? styleList.map((s) => (
                <View key={s} style={pm.roPill}><Text style={pm.roPillTxt}>{s}</Text></View>
              )) : <Text style={pm.summaryVal}>—</Text>}
            </View>
          </View>
          <View style={pm.summaryDiv} />
          <View style={pm.summaryRow}>
            <Text style={pm.summaryLabel}>Lead</Text>
            <View style={pm.leadBadge}>
              <Ionicons name="star" size={11} color="#A8801A" />
              <Text style={pm.leadTxt}>{iLead ? 'You lead' : `${pFirst} leads`}</Text>
            </View>
          </View>
        </View>

        {!!error && <Text style={pm.err}>{error}</Text>}
        <TouchableOpacity style={[pm.primaryBtn, linking && { opacity: 0.6 }]} disabled={linking} onPress={onValidate} activeOpacity={0.85}>
          {linking ? <ActivityIndicator color="#fff" size="small" /> : <Text style={pm.primaryTxt}>Confirm &amp; pair</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={pm.linkBtn} onPress={onCancel} activeOpacity={0.7}><Text style={pm.linkTxt}>Not now</Text></TouchableOpacity>
      </View>
    );
  } else if (outgoing) {
    body = (
      <View>
        <Text style={pm.lead}>Waiting for <Text style={pm.bold}>{outgoing.targetName}</Text> to accept…</Text>
        <TouchableOpacity style={pm.linkBtn} onPress={onCancel} activeOpacity={0.7}><Text style={pm.linkTxt}>Cancel request</Text></TouchableOpacity>
      </View>
    );
  } else {
    body = (
      <View>
        <View style={pm.myCodeRow}>
          <Text style={pm.myCodeLabel}>YOUR CODE</Text>
          <Text style={pm.myCodeVal}>{myCode || '—'}</Text>
        </View>
        <Text style={pm.lead}>Enter your partner's invite code to pair up.</Text>
        <View style={pm.inputRow}>
          <TextInput style={pm.input} value={code} onChangeText={onCodeChange} placeholder="Invite code"
            placeholderTextColor="rgba(13,13,18,0.25)" autoCapitalize="characters" autoCorrect={false} maxLength={8} />
          <TouchableOpacity style={[pm.addBtn, (!code?.trim() || linking) && { opacity: 0.5 }]} disabled={!code?.trim() || linking}
            onPress={onRequest} activeOpacity={0.85}>
            {linking ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="arrow-forward" size={16} color="#fff" />}
          </TouchableOpacity>
        </View>
        {!!error && <Text style={pm.err}>{error}</Text>}
      </View>
    );
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={em.sheet} avoidKeyboard>
      <View style={em.handle} />
      <Text style={em.title}>Dance partner</Text>
      {body}
      <TouchableOpacity style={[em.cancelBtn, { marginTop: 16 }]} onPress={onClose} activeOpacity={0.7}>
        <Text style={em.cancelBtnText}>Close</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

export default function StatsScreen({ navigation, route }) {
  const { setAvatarUri, setInitials } = useProfile();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [isLoading, setIsLoading] = useState(true);
  const hasLoadedRef = useRef(false);
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('stats'); // 'links' | 'stats' | 'settings' — default to Statistics on first mount
  // Which style the dashboard is showing. Seeded from the profile, then the
  // scope control drives it — it does NOT write back to the profile.
  const [dashCategory, setDashCategory] = useState(null);
  // Solo | Couple scope of the Stats dashboard — lifted here so the header can
  // name the dancer, or the pair.
  const [dashMode, setDashMode] = useState('solo');
  // Pull to refresh: bumping the key makes the Stats dashboard refetch too.
  const [refreshing, setRefreshing] = useState(false);
  const [dashRefreshKey, setDashRefreshKey] = useState(0);
  const pull = usePullRefresh({
    refreshing,
    onRefresh: () => handleRefresh(),
    scrollToTop: () => contentScrollRef.current?.scrollTo({ y: 0, animated: true }),
  });
  const isParent = useIsParentAccount();
  const tabBarSpace = useTabBarSpace();
  // Settings holds nothing a refresh would change: no pull there.
  const canPull = activeTab !== 'settings';
  const contentScrollRef = useRef(null);
  // A guardian account follows one child at a time; the rest of the app never
  // sees this, since getUserId() already resolves to whichever one is active.
  const [children, setChildren] = useState([]);
  // For a guardian, `user` is the child being followed — so "your account"
  // needs the signed-in row separately, or the parent would be shown their
  // child's name and the generated managed address.
  const [account, setAccount] = useState(null);
  const [addChild, setAddChild] = useState(false);
  const [withdrawing, setWithdrawing] = useState(null);
  // A partner-linking notification deep-links here with { tab: 'links' }; honor
  // it, then clear the param so a later manual subtab switch isn't overridden.
  useEffect(() => {
    const t = route?.params?.tab;
    if (t) {
      setActiveTab(t);
      navigation.setParams({ tab: undefined });
    }
  }, [route?.params?.tab]);
  // Train's first steps land on the sheet itself: { open: 'studio' | 'coach' }.
  // Held until the profile is in — which coach slot to open depends on it.
  useEffect(() => {
    const open = route?.params?.open;
    if (!open || isLoading) return undefined;
    const cat = route?.params?.category;
    navigation.setParams({ open: undefined, category: undefined });
    const t = setTimeout(() => {
      if (open === 'studio') openStudioModal();
      if (open === 'coach') {
        setCoachModal({ category: user?.dance_style === 'Latin & Ballroom' ? (cat === 'ballroom' ? 'ballroom' : 'latin') : null });
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.open, isLoading]);
  // Links and Settings are detours: leaving for another tab brings the tab
  // back to Stats. A screen pushed on top (a class, notifications) keeps the
  // view, so coming back from it lands where you were.
  useEffect(() => {
    const unsub = navigation.addListener('blur', () => {
      const st = navigation.getState?.();
      const current = st?.routes?.[st.index]?.name;
      if (current && current !== route?.name) setActiveTab('stats');
    });
    return unsub;
  }, [navigation, route?.name]);
  // Latest class awaiting admin validation — its focus points are RLS-hidden
  // until approved, so the readiness card must say so instead of implying the
  // student never logged a class.
  const [viewingQuestion, setViewingQuestion] = useState(null);
  const [profileModal, setProfileModal] = useState(null); // 'account' | 'style' | 'studio' | null
  const [accountOpen, setAccountOpen] = useState(false);
  const [editStudio, setEditStudio] = useState(null);
  const [editStyle, setEditStyle] = useState('');
  const [saving, setSaving] = useState(false);
  // The avatar lives in the profile context; this screen only pushes to it.
  const setPhotoUri = (uri) => setAvatarUri(uri);
  const [myCoach, setMyCoach] = useState(null);
  const [coachCode, setCoachCode] = useState('');
  const [coachLinking, setCoachLinking] = useState(false);
  const [coachLinkError, setCoachLinkError] = useState('');
  const [pendingReviews, setPendingReviews] = useState(0);
  const [isTrainer, setIsTrainer] = useState(false);
  const [latinCoach, setLatinCoach] = useState(null);
  const [ballroomCoach, setBallroomCoach] = useState(null);
  const [latinCode, setLatinCode] = useState('');
  const [ballroomCode, setBallroomCode] = useState('');
  const [latinLinking, setLatinLinking] = useState(false);
  const [ballroomLinking, setBallroomLinking] = useState(false);
  const [latinLinkError, setLatinLinkError] = useState('');
  const [ballroomLinkError, setBallroomLinkError] = useState('');
  const [coachModal, setCoachModal] = useState(null); // { category: 'latin' | 'ballroom' | null }
  const [coupleCoachModal, setCoupleCoachModal] = useState(null); // { category: 'latin' | 'ballroom' }
  const [coupleEditModal, setCoupleEditModal] = useState(null); // 'types' | 'roles' | null
  const [coupleReviewVisible, setCoupleReviewVisible] = useState(false);
  // ── Couple / partner pairing ──
  const [couple, setCouple] = useState(null);
  const [partnerIncoming, setPartnerIncoming] = useState(null);
  const [partnerOutgoing, setPartnerOutgoing] = useState(null);
  const [partnerModalVisible, setPartnerModalVisible] = useState(false);
  const [editGoal, setEditGoal] = useState(60);
  const [partnerCode, setPartnerCode] = useState('');
  const [partnerLinking, setPartnerLinking] = useState(false);
  const [partnerError, setPartnerError] = useState('');
  const [myPartnerCode, setMyPartnerCode] = useState('');

  async function handleRefresh() {
    setRefreshing(true);
    invalidateCache();
    setDashRefreshKey((k) => k + 1);
    try { await load(); } catch {}
    setRefreshing(false);
  }

  async function load() {
    // ONE bundled RPC (get_student_profile) replaces ~15 parallel queries that
    // the free-tier pooler was serializing (measured 2→10s staircase). session
    // + avatar stay local. couple / partner requests keep the `undefined` =
    // "bundle failed, keep what we have" sentinel so a transient failure never
    // blanks the partnership.
    // Mirror Train's last-selected Latin/Ballroom style so readiness matches the
    // toggle (a 2-style dancer's Profile otherwise anchored on the most-recent
    // private of any style). null = single-style / unset.
    const trainCat = await AsyncStorage.getItem('train_category_filter').catch(() => null);
    const [bundle, { data: { session } }, savedPhoto] = await Promise.all([
      withTimeout(getStudentProfileBundle(null, trainCat), null),
      supabase.auth.getSession(),                          // local — no network hang
      AsyncStorage.getItem(AVATAR_KEY).catch(() => null),  // local
    ]);
    const ok = !!bundle;
    const b = bundle || {};
    const userData = b.user ?? null;
    const coachData = b.coachDefault ?? null;
    const latinCoachData = b.coachLatin ?? null;
    const ballroomCoachData = b.coachBallroom ?? null;
    const coupleData = ok ? (b.couple ?? null) : undefined;
    const incomingReq = ok ? (b.incomingRequest ?? null) : undefined;
    const outgoingReq = ok ? (b.outgoingRequest ?? null) : undefined;
    const myCode = b.inviteCode ?? '';

    // Trainer-only: count pending reviews
    const trainerEmail = session?.user?.email;
    if (isAdminEmail(trainerEmail)) {
      setIsTrainer(true);
      try {
        const { count: pendingCount } = await supabase
          .from('ai_training_candidates')
          .select('id', { count: 'exact' })
          .eq('reviewed', false);
        setPendingReviews(pendingCount ?? 0);
      } catch {}
    } else {
      setIsTrainer(false);
      setPendingReviews(0);
    }

    // A cold/slow backend can return null on the very first load (before any
    // cache exists) → the hero would show "Your Name". Retry getUser once
    // before settling for the placeholder.
    let resolvedUser = userData;
    if (!resolvedUser && !user) {
      resolvedUser = await withTimeout(getUser(), null);
    }
    if (resolvedUser) setUser(resolvedUser); // don't blank a cached user on a failed fetch
    if (resolvedUser?.name) {
      const ini = resolvedUser.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      setInitials(ini);
      AsyncStorage.setItem('@profile_name', resolvedUser.name).catch(() => {});
    }
    const remoteAvatar = resolvedUser?.avatar_url
      ? `${resolvedUser.avatar_url}?t=${Math.floor(Date.now() / 60000)}`
      : null;
    const avatarToShow = remoteAvatar || savedPhoto || null;
    if (avatarToShow) {
      setPhotoUri(avatarToShow);
      if (remoteAvatar) await AsyncStorage.setItem(AVATAR_KEY, remoteAvatar).catch(() => {});
    }
    if (ok) {
      setMyCoach(coachData);
      setLatinCoach(latinCoachData);
      setBallroomCoach(ballroomCoachData);
    }
    // `undefined` = the fetch failed → keep whatever partnership we already
    // show (cache / prior load). Only `null` means "definitively unpaired".
    if (coupleData !== undefined) setCouple(coupleData);
    if (incomingReq !== undefined) setPartnerIncoming(incomingReq);
    if (outgoingReq !== undefined) setPartnerOutgoing(outgoingReq);
    setMyPartnerCode(myCode || '');
    // The bundle returns the raw invite_code; if it's never been generated,
    // lazily create it (the one write side-effect we kept out of the RPC).
    if (!myCode) getMyPartnerCode().then((c) => c && setMyPartnerCode(c)).catch(() => {});
    // Persist a stale-while-revalidate snapshot. Partnership is preserved across
    // a failed couple fetch so it shows instantly and never regresses to
    // "Add partner" on a transient blip.
    // Only persist a snapshot from a SUCCESSFUL bundle — writing the empty
    // stats/readiness/radar from a failed fetch would poison the next cold
    // reopen into the "log your next class" flash. On failure the prior cache
    // (already good) is left untouched.
    if (ok) {
      let prevCache = {};
      try { prevCache = JSON.parse((await AsyncStorage.getItem(PROFILE_CACHE_KEY)) || '{}') || {}; } catch {}
      AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({
        user: resolvedUser ?? prevCache.user ?? null,
        myCoach: coachData ?? prevCache.myCoach ?? null,
        couple: coupleData !== undefined ? coupleData : (prevCache.couple ?? null),
        // The avatar is cached too, so a cold reopen paints it instantly
        // instead of waiting on the (cold-start-slow) bundle.
        avatar: avatarToShow ?? prevCache.avatar ?? null,
      })).catch(() => {});
    }
  }

  useFocusEffect(useCallback(() => {
    const isFirst = !hasLoadedRef.current;
    if (isFirst) setIsLoading(true);
    const reveal = () => {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    };
    async function init() {
      let revealed = false;
      if (isFirst) {
        try {
          const raw = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
          if (raw) {
            const c = JSON.parse(raw);
            setUser(c.user);
            setMyCoach(c.myCoach ?? null);
            if (c.avatar) setPhotoUri(c.avatar);            // photo instantly — don't wait on load()
            if (c.couple !== undefined) setCouple(c.couple); // show partnership instantly from cache
            setIsLoading(false);
            reveal(); // fade cached content in NOW — don't wait on the network
            revealed = true;
          }
        } catch {}
      }
      // Backstop: even if load() somehow hangs past the per-fetch timeouts,
      // never trap the user on the skeleton — reveal whatever loaded (cache or
      // empty) after 15s and let load() finish updating state in the background.
      try { await Promise.race([load(), new Promise((r) => setTimeout(r, 15000))]); } catch {}
      hasLoadedRef.current = true;
      setIsLoading(false);
      // No cache → the skeleton was showing; fade the real content in now.
      if (isFirst && !revealed) reveal();
    }
    init();
  }, []));

  // Account — name + profile photo + email (TabHeader "Edit" + Settings ▸ Account)
  const me = account || user;          // the account, falling back to self

  function openEdit() {
    setAccountOpen(true);
  }
  function openGoalModal() {
    setEditGoal(user?.weekly_goal_minutes ?? 60);
    setProfileModal('goal');
  }

  const loadChildren = useCallback(async () => {
    if (!(await isGuardian())) return;
    try {
      const [kids, acc] = await Promise.all([listChildren(), getAccountUser()]);
      setChildren(kids);
      setAccount(acc);
    } catch { /* not a guardian, or offline */ }
  }, []);
  useEffect(() => { loadChildren(); }, [loadChildren]);

  async function switchChild(childId) {
    const current = children.find((c) => c.active);
    if (current?.id === childId) return;
    // Paint the choice immediately; the reload below is what actually swaps the
    // data underneath every other screen.
    setChildren((prev) => prev.map((c) => ({ ...c, active: c.id === childId })));
    try {
      await setActiveChild(childId);
      await load();
    } catch (e) {
      setChildren((prev) => prev.map((c) => ({ ...c, active: c.id === current?.id })));
      Alert.alert('Could not switch', e.message || 'Try again in a moment.');
    }
  }

  // Withdrawal is a right, so it is one plain question — asked once because it
  // erases a child's whole record for good, never argued with or delayed.
  // Health-data permission — the account holder's own. Withdrawing it stops
  // their lessons being recorded from that moment (Start Class checks it); it
  // deletes nothing, because deleting is a different request with different
  // consequences, and conflating the two is how people lose data they meant to
  // keep. A parent doesn't see this row: they gave the permission for their
  // child in the minor consent, and take it back with the row above.
  const healthState = healthConsentState(user);

  function toggleHealthConsent() {
    if (!user?.id) return;
    if (healthState === 'withdrawn') {
      Alert.alert('Allow this again?', HEALTH_CONSENT, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'I consent',
          onPress: async () => {
            await giveHealthConsent(user.id);
            setUser((p) => ({
              ...p,
              health_data_consent_at: new Date().toISOString(),
              health_consent_withdrawn_at: null,
            }));
          },
        },
      ]);
      return;
    }
    Alert.alert(
      'Withdraw this permission?',
      'Your lessons stop being recorded from now on. What has already been recorded stays until you ask us to delete it — that is a separate request.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Withdraw',
          style: 'destructive',
          onPress: async () => {
            await withdrawHealthConsent(user.id);
            setUser((p) => ({ ...p, health_consent_withdrawn_at: new Date().toISOString() }));
          },
        },
      ],
    );
  }

  function confirmWithdraw(child) {
    Alert.alert(
      `Delete everything about ${child.name}?`,
      `This withdraws your permission, stops recording immediately and deletes all of ${child.name}’s data. It can’t be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Withdraw and delete', style: 'destructive', onPress: () => runWithdraw(child) },
      ],
    );
  }

  async function runWithdraw(child) {
    setWithdrawing(child.id);
    try {
      await withdrawChild(child.id);
      // Everything cached belonged to the child who no longer exists.
      clearSubjectCache();
      invalidateCache();
      await loadChildren();
      await load();
      Alert.alert('Deleted', `${child.name}’s data has been deleted and their coach has been told.`);
    } catch (e) {
      Alert.alert('Not deleted', e.message || 'Try again in a moment.');
    } finally {
      setWithdrawing(null);
    }
  }

  async function handleSaveGoal() {
    if (saving) return;
    setSaving(true);
    try {
      await saveUserPreferences({ weekly_goal_minutes: editGoal });
      setUser(prev => ({ ...prev, weekly_goal_minutes: editGoal }));
      setProfileModal(null);
    } catch {
      Alert.alert('Could not save', 'Your weekly goal was not changed. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  // Optimistic: the switch moves at once and rolls back if the write fails.
  function openStyleModal() {
    setEditStyle(user?.dance_style || '');
    setProfileModal('style');
  }
  function openStudioModal() {
    setEditStudio(user?.studio || null);
    setProfileModal('studio');
  }

  async function handleSaveStyle() {
    if (saving) return;
    setSaving(true);
    const dance_style = editStyle;
    await saveUserProfile({ dance_style });
    setUser(prev => ({ ...prev, dance_style }));
    if (dance_style === 'Latin & Ballroom') {
      const [lc, bc] = await Promise.all([
        getMyCoachForCategory('latin'),
        getMyCoachForCategory('ballroom'),
      ]);
      setLatinCoach(lc);
      setBallroomCoach(bc);
    } else {
      const coach = await getMyCoach();
      setMyCoach(coach);
    }
    setSaving(false);
    setProfileModal(null);
  }

  function handleSaveStudio() {
    if (saving) return;
    const nextStudio = editStudio;
    const nextId = nextStudio?.id || null;
    const currentId = user?.studio?.id || user?.studio_id || null;
    const commit = async () => {
      setSaving(true);
      await saveUserProfile({ studio_id: nextId });
      setUser(prev => ({ ...prev, studio_id: nextId, studio: nextStudio }));
      setSaving(false);
      setProfileModal(null);
    };
    // Warn that switching studios drops access to the old studio's group classes.
    if (nextId !== currentId && user?.studio?.name) {
      Alert.alert(
        'Change studio?',
        `You'll lose access to ${user.studio.name}'s past and upcoming group lessons. Your new studio's lessons will show instead.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Change studio', style: 'destructive', onPress: commit },
        ],
      );
    } else {
      commit();
    }
  }

  // Confirms first (a code-paired child, a running focus session), then clears
  // everything tied to this account — see services/logout.js.
  function handleLogout() {
    logOutWithChecks({ resetProfile: () => { setAvatarUri(null); setInitials(null); } });
  }

  async function handleLinkCoach() {
    if (!coachCode.trim()) return;
    setCoachLinking(true);
    setCoachLinkError('');
    try {
      const { coach } = await linkToCoachByCode(coachCode);
      setMyCoach(coach);
      setCoachCode('');
      setCoachModal(null);
    } catch (e) {
      setCoachLinkError(e.message || 'Could not link coach.');
    }
    setCoachLinking(false);
  }

  function handleUnlinkCoach() {
    const coachName = myCoach?.name?.split(' ')[0] || 'your coach';
    Alert.alert(
      'Remove coach?',
      `Only the link is removed — ${coachName} loses access to your training. Your focus points and history stay, and any coach you link next will see the focus points you've worked on.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', onPress: async () => {
            try {
              await unlinkCoach();
              setMyCoach(null);
              setCoachModal(null);
            } catch (e) {
              Alert.alert('Error', e.message || 'Could not remove coach.');
            }
          },
        },
      ],
    );
  }

  async function handleLinkCoachForCategory(category) {
    const code = category === 'latin' ? latinCode : ballroomCode;
    if (!code.trim()) return;
    const setLinking = category === 'latin' ? setLatinLinking : setBallroomLinking;
    const setLinkError = category === 'latin' ? setLatinLinkError : setBallroomLinkError;
    const setCode = category === 'latin' ? setLatinCode : setBallroomCode;
    const setCoach = category === 'latin' ? setLatinCoach : setBallroomCoach;
    setLinking(true);
    setLinkError('');
    try {
      const { coach } = await linkToCoachByCodeForCategory(code, category);
      setCoach(coach);
      setCode('');
      setCoachModal(null);
    } catch (e) {
      setLinkError(e.message || 'Could not link coach.');
    }
    setLinking(false);
  }

  function handleUnlinkCoachForCategory(category) {
    const coach = category === 'latin' ? latinCoach : ballroomCoach;
    const coachName = coach?.name?.split(' ')[0] || 'your coach';
    const label = category === 'latin' ? 'Latin' : 'Ballroom';
    Alert.alert(
      'Remove coach?',
      `Only the link is removed — ${coachName} (${label}) loses access to your training. Your focus points and history stay, and any coach you link next will see the focus points you've worked on.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', onPress: async () => {
            try {
              await unlinkCoachForCategory(category);
              if (category === 'latin') setLatinCoach(null);
              else setBallroomCoach(null);
              setCoachModal(null);
            } catch (e) {
              Alert.alert('Error', e.message || 'Could not remove coach.');
            }
          },
        },
      ],
    );
  }

  // ── Partner pairing handlers ──
  async function handleRequestPartner() {
    if (!partnerCode.trim()) return;
    setPartnerLinking(true);
    setPartnerError('');
    try {
      await requestPartnerByCode(partnerCode);
      setPartnerCode('');
      setPartnerOutgoing(await getOutgoingPartnerRequest().catch(() => null));
    } catch (e) {
      setPartnerError(e.message || 'Could not send request.');
    }
    setPartnerLinking(false);
  }

  async function handleAcceptPartner(cfg) {
    if (!partnerIncoming) return;
    setPartnerLinking(true);
    setPartnerError('');
    try {
      await acceptPartnerRequest(partnerIncoming.id, cfg);
      setPartnerIncoming(await getIncomingPartnerRequest().catch(() => null));
      setPartnerModalVisible(false);
    } catch (e) {
      setPartnerError(e.message || 'Could not accept.');
    }
    setPartnerLinking(false);
  }

  async function handleValidatePartner() {
    if (!partnerOutgoing) return;
    setPartnerLinking(true);
    setPartnerError('');
    try {
      await validatePartner(partnerOutgoing.id);
      setCouple(await getMyCouple().catch(() => null));
      setPartnerOutgoing(null);
      setPartnerModalVisible(false);
    } catch (e) {
      setPartnerError(e.message || 'Could not pair.');
    }
    setPartnerLinking(false);
  }

  function handleUnpairPartner() {
    if (!couple) return;
    Alert.alert(
      'Unpair?',
      'All couple progress will be permanently lost for both of you.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpair', style: 'destructive', onPress: async () => {
            try {
              await unpair(couple.coupleId);
              setCouple(null);
              setPartnerModalVisible(false);
            } catch (e) {
              Alert.alert('Error', e.message || 'Could not unpair.');
            }
          },
        },
      ],
    );
  }

  async function handleDeclinePartner() {
    if (!partnerIncoming) return;
    try { await declinePartnerRequest(partnerIncoming.id); } catch {}
    setPartnerIncoming(null);
    setPartnerModalVisible(false);
  }

  async function handleCancelPartner() {
    if (!partnerOutgoing) return;
    try { await cancelPartnerRequest(partnerOutgoing.id); } catch {}
    setPartnerOutgoing(null);
    setPartnerModalVisible(false);
  }

  async function handleDesignateCoupleCoach(category, code) {
    if (!couple) return;
    await requestCoupleCoachByCode(couple.coupleId, code, category);
    await refetchPartner();
  }

  // Propose a styles/leader change — staged until the partner approves. Throws
  // on failure so the sheet can surface the error.
  async function handleProposeCoupleChange(cfg) {
    if (!couple) return;
    await proposeCoupleChange(couple.coupleId, cfg);
    await refetchPartner();
  }

  async function handleRespondCoupleChange(accept) {
    if (!couple) return;
    await respondCoupleChange(couple.coupleId, accept);
    await refetchPartner();
  }

  async function handleCancelCoupleChange() {
    if (!couple) return;
    try {
      await cancelCoupleChange(couple.coupleId);
      await refetchPartner();
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not cancel.');
    }
  }

  // Live-refresh the partner state (couple + incoming/outgoing requests).
  const refetchPartner = useCallback(async () => {
    const [c, inc, out] = await Promise.all([
      getMyCouple().catch(() => null),
      getIncomingPartnerRequest().catch(() => null),
      getOutgoingPartnerRequest().catch(() => null),
    ]);
    setCouple(c);
    setPartnerIncoming(inc);
    setPartnerOutgoing(out);
  }, []);

  // Realtime: both dancers see handshake changes live (no manual reload / no
  // push needed for the in-app flow). RLS scopes events to my own rows.
  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;
    const channel = supabase
      .channel(`partner-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'couple_requests' }, () => { refetchPartner(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'couples' }, () => { refetchPartner(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, refetchPartner]);

  const isDual = user?.dance_style === 'Latin & Ballroom';

  const paired = !!couple;





  // Partnership rectangle rows — dance types + leader/follower, plus pending state
  const myFirst = user?.name ? user.name.split(' ')[0] : 'You';
  const partnerFirst = couple?.partner?.name ? couple.partner.name.split(' ')[0] : 'Partner';
  const stylesLabel = couple
    ? ([couple.doesLatin && 'Latin', couple.doesBallroom && 'Ballroom'].filter(Boolean).join(' & ') || '—')
    : '—';
  const rolesLabel = couple
    ? (couple.iAmLeader ? `You lead · ${partnerFirst} follows` : `${partnerFirst} leads · You follow`)
    : '—';
  const hasPendingChange = !!couple?.pendingChange;
  const pendingChangeMine = !!couple?.pendingChangeMine;

  // Header: the style the Stats dashboard shows, and whose training it is.
  const dashCat = dashCategory || categoryFromStyle(user?.dance_style) || 'latin';
  const meFirst = (user?.name || '').trim().split(/\s+/)[0] || '';
  const dancersLabel = dashMode === 'couple' && couple
    ? [meFirst, partnerFirst].filter(Boolean).join(' & ')
    : meFirst;
  const headerSub = isParent
    ? [dancersLabel, 'parent’s account'].filter(Boolean).join(' · ')
    : (dancersLabel || null);

  if (isLoading) {
    return <ProfileSkeleton />;
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
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          <TabHeader
            navigation={navigation}
            style={styles.header}
            hideChildNudge={activeTab === 'settings'}
            lead={(
              <StyleTitle
                label={dashCat === 'ballroom' ? 'Ballroom' : 'Latin'}
                category={dashCat}
                canSwitch={user?.dance_style === 'Latin & Ballroom'}
                onSelect={setDashCategory}
                sub={headerSub}
              />
            )}
            right={(
              <View style={styles.heroActs}>
                <TouchableOpacity
                  style={[styles.heroActBtn, activeTab === 'links' && styles.heroActOn]}
                  onPress={() => setActiveTab(activeTab === 'links' ? 'stats' : 'links')}
                  accessibilityRole="button"
                  accessibilityLabel="Links: your coach and partner"
                >
                  <Ionicons name="link-outline" size={18} color={activeTab === 'links' ? '#FFFFFF' : '#141311'} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.heroActBtn, activeTab === 'settings' && styles.heroActOn]}
                  onPress={() => setActiveTab(activeTab === 'settings' ? 'stats' : 'settings')}
                  accessibilityRole="button"
                  accessibilityLabel="Settings"
                >
                  <Ionicons name="options-outline" size={18} color={activeTab === 'settings' ? '#FFFFFF' : '#141311'} />
                </TouchableOpacity>
              </View>
            )}
          />

          {/* ── Per-tab scrollable content ── The cards dissolve as they slide
              under the header and behind the floating tab bar: a real alpha
              mask, since the page behind is a gradient, not a flat colour. The
              mask starts EDGE_FADE above its slot and the content starts
              EDGE_FADE lower, so at rest nothing sits in the fade. */}
          {/* Pull to refresh draws the InBetween mark in the gap the pull opens,
              behind the content (iOS; Android keeps its native spinner). */}
          {pull.ios && canPull ? (
            <View style={styles.pullLogoAnchor} pointerEvents="none">
              <View style={styles.pullLogo}>
                <PullLogo ref={pull.logoRef} refreshing={refreshing} />
              </View>
            </View>
          ) : null}
          <MaskedView
            style={[styles.content, { marginTop: -EDGE_FADE }]}
            maskElement={
              <View style={{ flex: 1 }}>
                <LinearGradient colors={['transparent', '#000']} style={{ height: EDGE_FADE }} />
                <View style={{ flex: 1, backgroundColor: '#000' }} />
                <LinearGradient
                  colors={['#000', 'rgba(0,0,0,0.5)', 'transparent']}
                  locations={[0, 0.55, 1]}
                  style={{ height: tabBarSpace + 34 }}
                />
              </View>
            }
          >
          <ScrollView
            ref={contentScrollRef}
            style={styles.content}
            contentContainerStyle={[styles.contentInner, { paddingTop: CONTENT_TOP + EDGE_FADE, paddingBottom: CONTENT_BOTTOM + tabBarSpace }]}
            showsVerticalScrollIndicator={false}
            overScrollMode="never"
            {...(canPull ? pull.scrollProps : null)}
            refreshControl={pull.ios || !canPull ? undefined : (
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={['#E8B530']} />
            )}
          >
            {activeTab === 'links' && (
              <View style={styles.tabBody}>
                <SecLabel text="Your coach" />
                {isDual ? (
                  <>
                    <CoachListRow
                      category="Latin"
                      coach={latinCoach}
                      onPress={() => setCoachModal({ category: 'latin' })}
                    />
                    <CoachListRow
                      category="Ballroom"
                      coach={ballroomCoach}
                      onPress={() => setCoachModal({ category: 'ballroom' })}
                    />
                  </>
                ) : (
                  <CoachListRow
                    category={user?.dance_style || 'Coach'}
                    coach={myCoach}
                    onPress={() => setCoachModal({ category: null })}
                  />
                )}

                <SecLabel text="Partnership" />
                <PartnerListRow
                  couple={couple}
                  incoming={partnerIncoming}
                  outgoing={partnerOutgoing}
                  onPress={() => { setPartnerError(''); setPartnerModalVisible(true); }}
                />

                {paired && (
                  <>
                    {hasPendingChange && pendingChangeMine && (
                      <View style={cc.waitBanner}>
                        <Ionicons name="time-outline" size={16} color="#A8801A" />
                        <Text style={cc.waitTxt} numberOfLines={2}>Waiting for {partnerFirst} to approve your change.</Text>
                        <TouchableOpacity onPress={handleCancelCoupleChange} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={cc.waitCancel}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    {hasPendingChange && !pendingChangeMine && (
                      <TouchableOpacity style={cc.reviewBanner} onPress={() => setCoupleReviewVisible(true)} activeOpacity={0.85}>
                        <Ionicons name="people-circle-outline" size={18} color="#2E4670" />
                        <Text style={cc.reviewTxt} numberOfLines={2}>{partnerFirst} proposed a change</Text>
                        <View style={cc.reviewBtn}><Text style={cc.reviewBtnTxt}>Review</Text></View>
                      </TouchableOpacity>
                    )}

                    <View style={[set.card, { marginTop: 4 }]}>
                      <SettingRow
                        icon="musical-notes-outline"
                        label="Dance types"
                        value={stylesLabel}
                        onPress={() => {
                          if (hasPendingChange) { Alert.alert('Change pending', 'A change is already awaiting approval. Resolve it first.'); return; }
                          setCoupleEditModal('types');
                        }}
                      />
                      <SettingRow
                        icon="swap-horizontal-outline"
                        label="Roles"
                        value={rolesLabel}
                        isLast
                        onPress={() => {
                          if (hasPendingChange) { Alert.alert('Change pending', 'A change is already awaiting approval. Resolve it first.'); return; }
                          setCoupleEditModal('roles');
                        }}
                      />
                    </View>

                    {(couple.doesLatin || couple.doesBallroom) && (
                      <>
                        <SecLabel text="Couple coaches" />
                        {couple.doesLatin && (
                          <CoupleCoachStatusRow
                            category="Latin"
                            coach={couple.latinCoupleCoach}
                            onPress={() => setCoupleCoachModal({ category: 'latin' })}
                          />
                        )}
                        {couple.doesBallroom && (
                          <CoupleCoachStatusRow
                            category="Ballroom"
                            coach={couple.ballroomCoupleCoach}
                            onPress={() => setCoupleCoachModal({ category: 'ballroom' })}
                          />
                        )}
                      </>
                    )}
                  </>
                )}
              </View>
            )}

            {activeTab === 'stats' && (
              <View style={styles.tabBody}>
                <ProfileDashboard
                  user={user}
                  category={dashCat}
                  mode={dashMode}
                  onChangeMode={setDashMode}
                  refreshKey={dashRefreshKey}
                  navigation={navigation}
                />
              </View>
            )}

            {activeTab === 'settings' && (
              <View style={styles.tabBody}>
                {/* A parent account whose child wasn't created (sign-up cut short) can still add one. */}
                {isParent && children.length === 0 && (
                  <>
                    <SecLabel text="Your child" />
                    <Text style={styles.noChildText}>Your child’s profile isn’t set up yet. Add them to start following their training.</Text>
                    <TouchableOpacity style={styles.addChildBtn} onPress={() => setAddChild(true)} activeOpacity={0.8}>
                      <Ionicons name="add" size={16} color="#8F6410" />
                      <Text style={styles.addChildText}>Add a child</Text>
                    </TouchableOpacity>
                  </>
                )}
                {children.length > 0 && (
                  <>
                    <SecLabel text={children.length > 1 ? 'Children' : 'Your child'} />
                    <View style={set.card}>
                      {children.map((c, i) => (
                        <TouchableOpacity
                          key={c.id}
                          style={[set.row, i < children.length - 1 && set.rowBorder]}
                          onPress={() => switchChild(c.id)}
                          activeOpacity={0.7}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: c.active }}
                        >
                          <Text style={set.label}>{c.name}</Text>
                          <Text style={set.value}>{c.active ? 'Following' : c.danceStyle || ''}</Text>
                          <Ionicons name={c.active ? 'checkmark-circle' : 'ellipse-outline'}
                            size={17} color={c.active ? '#8F6410' : '#B9B3A5'} />
                        </TouchableOpacity>
                      ))}
                    </View>
                    {/* Each child's own phone, right under whom you follow. */}
                    <View style={{ marginTop: 12 }}>
                      {children.map((c) => <ChildPhoneCard key={`phone-${c.id}`} child={c} />)}
                    </View>
                    <TouchableOpacity style={styles.addChildBtn} onPress={() => setAddChild(true)} activeOpacity={0.8}>
                      <Ionicons name="add" size={16} color="#8F6410" />
                      <Text style={styles.addChildText}>Add a child</Text>
                    </TouchableOpacity>

                    {/* always here, never behind a menu: withdrawing is a right */}
                    <SecLabel text="Permission" />
                    <View style={set.card}>
                      {children.map((c, i) => (
                        <TouchableOpacity
                          key={`withdraw-${c.id}`}
                          style={[set.row, i < children.length - 1 && set.rowBorder]}
                          onPress={() => confirmWithdraw(c)}
                          disabled={withdrawing === c.id}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                        >
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.withdrawText}>
                              {withdrawing === c.id ? 'Deleting…' : 'Withdraw permission and delete all data'}
                            </Text>
                            {children.length > 1 && <Text style={styles.withdrawSub}>{c.name}</Text>}
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}

                <SecLabel text="Account" />
                <View style={set.card}>
                  <SettingRow label={me?.name || 'Account'}
                    value={account ? 'Your account — not your child’s' : 'Name, email and photo'}
                    onPress={openEdit} isLast />
                </View>

                <SecLabel text="Training" />
                <View style={set.card}>
                  <SettingRow label="Dance style" value={user?.dance_style} onPress={openStyleModal} />
                  <SettingRow label="Weekly goal" value={`${user?.weekly_goal_minutes ?? 60} min`} onPress={openGoalModal} />
                  <SettingRow label="Dance studio" value={user?.studio?.name} onPress={openStudioModal} isLast />
                </View>

                <SecLabel text="Notifications" />
                <View style={set.card}>
                  <SettingRow
                    label="Notification settings"
                    value="From your coach, lessons, delivery"
                    onPress={() => navigation.navigate('NotificationSettings', { coachName: myCoach?.name || latinCoach?.name || ballroomCoach?.name || null })}
                    isLast
                  />
                </View>

                {!isParent && (
                  <>
                    <SecLabel text="Permission" />
                    <View style={set.card}>
                      <SettingRow
                        label="Health data in lessons"
                        value={healthState === 'withdrawn' ? 'Withdrawn' : healthState === 'given' ? 'Given' : 'Not given'}
                        onPress={toggleHealthConsent}
                        isLast
                      />
                    </View>
                  </>
                )}

                {isTrainer && pendingReviews > 0 && (
                  <TouchableOpacity
                    style={styles.trainerReviewBtn}
                    onPress={() => navigation.navigate('TrainerReview')}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.trainerReviewText}>
                      {`🧠 ${pendingReviews} focus point${pendingReviews === 1 ? '' : 's'} to review`}
                    </Text>
                  </TouchableOpacity>
                )}

                {isTrainer && (
                  <TouchableOpacity
                    style={styles.trainerStudentsBtn}
                    onPress={() => navigation.navigate('TrainerStudents')}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.trainerStudentsText}>
                      {'📊  Students & scores'}
                    </Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.7}>
                  <Text style={styles.logoutText}>Log out</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
          </MaskedView>

          {/* Account (photo, name, email) — the same sheet the header avatar opens. */}
          <AccountSheet
            visible={accountOpen}
            onClose={() => setAccountOpen(false)}
            onSaved={({ name }) => {
              if (account) setAccount((prev) => ({ ...prev, name }));
              else setUser((prev) => ({ ...prev, name }));
            }}
          />

          {/* Dance style / Weekly goal / Dance studio — one sheet, focused per mode */}
          <BottomSheet visible={!!profileModal} onClose={() => setProfileModal(null)} sheetStyle={em.sheet} avoidKeyboard>
                  <View style={em.handle} />

                  {profileModal === 'style' && (
                    <>
                      <Text style={em.title}>Dance style</Text>
                      <View style={em.field}>
                        <View style={em.pillRow}>
                          {['Latin', 'Ballroom', 'Latin & Ballroom'].map((s) => (
                            <TouchableOpacity
                              key={s}
                              style={[em.pill, editStyle === s && em.pillActive]}
                              onPress={() => setEditStyle(s)}
                              activeOpacity={0.75}
                            >
                              <Text style={[em.pillText, editStyle === s && em.pillTextActive]}>{s}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                      <TouchableOpacity style={em.saveBtn} onPress={handleSaveStyle} activeOpacity={0.88} disabled={saving || !editStyle}>
                        <Text style={em.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {profileModal === 'goal' && (
                    <>
                      <Text style={em.title}>Weekly goal</Text>
                      <View style={em.field}>
                        <View style={em.pillRow}>
                          {[60, 90, 120, 150, 180, 240].map((g) => (
                            <TouchableOpacity
                              key={g}
                              style={[em.pill, editGoal === g && em.pillActive]}
                              onPress={() => setEditGoal(g)}
                              activeOpacity={0.75}
                            >
                              <Text style={[em.pillText, editGoal === g && em.pillTextActive]}>{g} min</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                      <Text style={em.studioNote}>
                        Minutes of practice a week. Your dashboard compares this week against it.
                      </Text>
                      <TouchableOpacity style={em.saveBtn} onPress={handleSaveGoal} activeOpacity={0.88} disabled={saving}>
                        <Text style={em.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {profileModal === 'studio' && (
                    <>
                      <Text style={em.title}>Dance studio</Text>
                      <View style={em.field}>
                        <Text style={em.fieldLabel}>Main studio</Text>
                        <StudioPicker value={editStudio} onChange={setEditStudio} />
                      </View>
                      <Text style={em.studioNote}>
                        Changing your studio removes access to your current studio's group classes.
                      </Text>
                      <TouchableOpacity style={em.saveBtn} onPress={handleSaveStudio} activeOpacity={0.88} disabled={saving}>
                        <Text style={em.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  <TouchableOpacity style={em.cancelBtn} onPress={() => setProfileModal(null)} activeOpacity={0.7}>
                    <Text style={em.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
          </BottomSheet>

          {/* Coach Linking Modal — opens when tapping a teacher slot */}
          <BottomSheet visible={!!coachModal} onClose={() => setCoachModal(null)} sheetStyle={em.sheet} avoidKeyboard>
                  <View style={em.handle} />
                  <Text style={em.title}>
                    {coachModal?.category === 'latin' ? 'Latin Teacher'
                      : coachModal?.category === 'ballroom' ? 'Ballroom Teacher'
                      : 'Teacher'}
                  </Text>

                  {coachModal && (coachModal.category === null ? (
                    <CoachSlot
                      coach={myCoach}
                      code={coachCode}
                      onCodeChange={(t) => setCoachCode(t.toUpperCase())}
                      linking={coachLinking}
                      linkError={coachLinkError}
                      onAdd={handleLinkCoach}
                      onUnlink={handleUnlinkCoach}
                    />
                  ) : coachModal.category === 'latin' ? (
                    <CoachSlot
                      coach={latinCoach}
                      code={latinCode}
                      onCodeChange={(t) => setLatinCode(t.toUpperCase())}
                      linking={latinLinking}
                      linkError={latinLinkError}
                      onAdd={() => handleLinkCoachForCategory('latin')}
                      onUnlink={() => handleUnlinkCoachForCategory('latin')}
                    />
                  ) : (
                    <CoachSlot
                      coach={ballroomCoach}
                      code={ballroomCode}
                      onCodeChange={(t) => setBallroomCode(t.toUpperCase())}
                      linking={ballroomLinking}
                      linkError={ballroomLinkError}
                      onAdd={() => handleLinkCoachForCategory('ballroom')}
                      onUnlink={() => handleUnlinkCoachForCategory('ballroom')}
                    />
                  ))}

                  <TouchableOpacity style={[em.cancelBtn, { marginTop: 16 }]} onPress={() => setCoachModal(null)} activeOpacity={0.7}>
                    <Text style={em.cancelBtnText}>Close</Text>
                  </TouchableOpacity>
          </BottomSheet>

          {/* Couple-coach Modal — opens when tapping a couple-coach row */}
          <BottomSheet visible={!!coupleCoachModal} onClose={() => setCoupleCoachModal(null)} sheetStyle={em.sheet} avoidKeyboard>
                  <View style={em.handle} />
                  {coupleCoachModal && (
                    <CoupleCoachSheet
                      category={coupleCoachModal.category}
                      couple={couple}
                      onDesignate={handleDesignateCoupleCoach}
                      onClose={() => setCoupleCoachModal(null)}
                    />
                  )}
                  <TouchableOpacity style={[em.cancelBtn, { marginTop: 16 }]} onPress={() => setCoupleCoachModal(null)} activeOpacity={0.7}>
                    <Text style={em.cancelBtnText}>Close</Text>
                  </TouchableOpacity>
          </BottomSheet>

          {/* Couple change Modal — propose new dance types / leader (partner-approved) */}
          <BottomSheet visible={!!coupleEditModal} onClose={() => setCoupleEditModal(null)} sheetStyle={em.sheet} avoidKeyboard>
                  <View style={em.handle} />
                  {coupleEditModal && couple && (
                    <CoupleEditSheet
                      mode={coupleEditModal}
                      couple={couple}
                      myUserId={user?.id}
                      myName={myFirst}
                      partnerName={partnerFirst}
                      onPropose={handleProposeCoupleChange}
                      onClose={() => setCoupleEditModal(null)}
                    />
                  )}
                  <TouchableOpacity style={[em.cancelBtn, { marginTop: 8 }]} onPress={() => setCoupleEditModal(null)} activeOpacity={0.7}>
                    <Text style={em.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
          </BottomSheet>

          {/* Couple change review Modal — partner approves / declines a staged change */}
          <BottomSheet visible={coupleReviewVisible} onClose={() => setCoupleReviewVisible(false)} sheetStyle={em.sheet} avoidKeyboard>
                  <View style={em.handle} />
                  {coupleReviewVisible && couple?.pendingChange && (
                    <CoupleReviewSheet
                      couple={couple}
                      partnerName={partnerFirst}
                      onRespond={handleRespondCoupleChange}
                      onClose={() => setCoupleReviewVisible(false)}
                    />
                  )}
                  <TouchableOpacity style={[em.cancelBtn, { marginTop: 8 }]} onPress={() => setCoupleReviewVisible(false)} activeOpacity={0.7}>
                    <Text style={em.cancelBtnText}>Close</Text>
                  </TouchableOpacity>
          </BottomSheet>

          {/* ── Partner pairing modal ── */}
          <PartnerModal
            visible={partnerModalVisible}
            onClose={() => setPartnerModalVisible(false)}
            couple={couple}
            incoming={partnerIncoming}
            outgoing={partnerOutgoing}
            myUserId={user?.id}
            myName={user?.name ? user.name.split(' ')[0] : 'You'}
            code={partnerCode}
            onCodeChange={(t) => setPartnerCode(t.toUpperCase())}
            linking={partnerLinking}
            error={partnerError}
            myCode={myPartnerCode}
            onRequest={handleRequestPartner}
            onAccept={handleAcceptPartner}
            onValidate={handleValidatePartner}
            onDecline={handleDeclinePartner}
            onCancel={handleCancelPartner}
            onUnpair={handleUnpairPartner}
          />

          {/* ── Add a child ── */}
          <AddChildModal
            visible={addChild}
            onClose={() => setAddChild(false)}
            onCreated={async () => { setAddChild(false); await loadChildren(); }}
          />

          {/* ── Question detail modal ── */}
          <Modal
            visible={!!viewingQuestion}
            transparent
            animationType="fade"
            onRequestClose={() => setViewingQuestion(null)}
          >
            {viewingQuestion && (
              <QuestionDetailSheet
                question={viewingQuestion}
                role="student"
                onClose={() => setViewingQuestion(null)}
              />
            )}
          </Modal>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const ac = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(10,10,10,0.45)', justifyContent: 'center', paddingHorizontal: 26 },
  sheet: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 22 },
  title: { fontFamily: Fonts.extraBold, fontSize: 21, letterSpacing: -0.5, color: '#141311' },
  sub: { fontFamily: Fonts.regular, fontSize: 13.5, lineHeight: 19, color: '#6B6656', marginTop: 6 },
  label: { fontFamily: Fonts.medium, fontSize: 10.5, letterSpacing: 1.4, color: '#6B6656', marginTop: 20, marginBottom: 8 },
  field: { borderWidth: 1, borderColor: 'rgba(20,19,17,0.14)', borderRadius: 12, height: 50, paddingHorizontal: 14, justifyContent: 'center' },
  input: { fontFamily: Fonts.regular, fontSize: 15.5, color: '#141311', padding: 0 },
  styles: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, borderWidth: 1, borderColor: 'rgba(20,19,17,0.14)', borderRadius: 999, paddingVertical: 11, alignItems: 'center' },
  chipOn: { borderWidth: 2, borderColor: '#E2AA20', paddingVertical: 10 },
  chipT: { fontFamily: Fonts.regular, fontSize: 13, color: '#141311' },
  chipTOn: { fontFamily: Fonts.semiBold },
  err: { fontFamily: Fonts.medium, fontSize: 13, lineHeight: 18, color: '#A3281B', marginTop: 14 },
  save: { marginTop: 22, height: 52, borderRadius: 999, backgroundColor: '#E2AA20', alignItems: 'center', justifyContent: 'center' },
  saveOff: { opacity: 0.4 },
  saveT: { fontFamily: Fonts.semiBold, fontSize: 15.5, color: '#141311' },
  cancel: { marginTop: 10, alignSelf: 'center', padding: 8 },
  cancelT: { fontFamily: Fonts.regular, fontSize: 13.5, color: '#6B6656' },
  scroll: { maxHeight: 540 },
  labelGap: { marginTop: 22 },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: 'rgba(20,19,17,0.07)' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#E2AA20', marginTop: 7 },
  bulletT: { flex: 1, fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20, color: '#141311' },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderRadius: 12, borderWidth: 1,
    borderColor: 'rgba(20,19,17,0.14)', paddingVertical: 13, paddingHorizontal: 13, marginBottom: 8 },
  checkOn: { borderWidth: 2, borderColor: '#E2AA20', paddingVertical: 12, paddingHorizontal: 12 },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: 'rgba(20,19,17,0.30)',
    alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: '#E2AA20', borderColor: '#E2AA20' },
  checkT: { flex: 1, fontFamily: Fonts.regular, fontSize: 13.5, lineHeight: 19, color: '#141311' },
  linkT: { fontFamily: Fonts.semiBold, fontSize: 13.5, color: '#8F6410' },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  addChildBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 10, paddingVertical: 12 },
  addChildText: { fontFamily: Fonts.semiBold, fontSize: 13.5, color: '#8F6410' },
  noChildText: { fontFamily: Fonts.regular, fontSize: 13.5, lineHeight: 19, color: '#6B6656', paddingHorizontal: 4, marginBottom: 2 },
  withdrawText: { fontFamily: Fonts.semiBold, fontSize: 14.5, color: '#A3281B' },
  withdrawSub: { fontFamily: Fonts.regular, fontSize: 12.5, color: '#6B6656', marginTop: 2 },

  // Same header rhythm as Train, so switching tabs doesn't shift it.
  // paddingBottom leaves room for the content's top fade to start below the buttons.
  header: { paddingTop: 6, paddingBottom: EDGE_FADE },
  // Zero-height anchor under the header: the mark hangs in the pulled gap.
  pullLogoAnchor: { height: 0, zIndex: 0 },
  pullLogo: { position: 'absolute', top: 16, left: 0, right: 0, alignItems: 'center' },

  content: { flex: 1 },
  contentInner: {
    paddingHorizontal: Spacing.side,
    paddingTop: CONTENT_TOP,
    // Tuned so the visible gap between Log out and the floating tab bar is
    // ~2× the marginTop above Log out (≈ 36 px).
    paddingBottom: CONTENT_BOTTOM,
    gap: 0,
  },

  heroActs: { flexDirection: 'row', gap: 8, flex: 0 },
  heroActBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    shadowColor: '#282214', shadowOpacity: 0.10, shadowOffset: { width: 0, height: 4 }, shadowRadius: 10,
    elevation: 2,
  },
  heroActOn: { backgroundColor: '#141311' },

  // ── Tab body — content column inside the per-tab scroll ──
  tabBody: { paddingTop: 4 },

  // ── Logout — red pill, sits at the end of the scroll, just above the
  // floating tab bar.
  logoutBtn: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
    minHeight: 44,
    paddingHorizontal: 18,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(163,40,27,0.42)',
    borderRadius: 12,
  },
  logoutText: {
    fontFamily: Fonts.semiBold,
    fontSize: 14.5,
    color: '#A3281B',          // 3.5:1 -> 7.2:1
    letterSpacing: 0,
  },


  // ── Trainer-only ──
  trainerReviewBtn: {
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FF9D00',
    backgroundColor: 'rgba(255,157,0,0.06)',
  },
  trainerReviewText: {
    fontFamily: Fonts.semiBold,
    fontSize: 13,
    color: '#FF9D00',
  },
  trainerStudentsBtn: {
    alignSelf: 'center',
    marginTop: 10,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    backgroundColor: 'rgba(0,0,0,0.035)',
  },
  trainerStudentsText: {
    fontFamily: Fonts.semiBold,
    fontSize: 13,
    color: '#141414',
  },
});

// ─── Coach / Partner rows + section labels (Coaches tab) ──────────────────────
const row = StyleSheet.create({
  secLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 4,
    marginTop: 24,
    marginBottom: 10,
  },
  secLabelText: {
    fontFamily: Fonts.semiBold,
    fontSize: 11.5,
    color: '#7F5A0B',          // 3.6:1 -> 5.3:1
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  secLabelTextPlain: {
    color: '#0A0A0A',
    textTransform: 'none',
    letterSpacing: 0,
    fontSize: 12.5,
  },
  secLabelRule: { flex: 1, height: 1, backgroundColor: 'rgba(20,19,17,0.10)' },
  secLabelRight: {
    fontFamily: Fonts.regular,
    fontSize: 10,
    color: 'rgba(10,10,10,0.45)',
    letterSpacing: 0.4,
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 62,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 12,
  },
  init: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#E2AA20',
    borderWidth: 1,
    borderColor: '#A87A10',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initAdd: {
    backgroundColor: '#F4F2EC',
    borderStyle: 'dashed',
    borderColor: 'rgba(20,19,17,0.45)',
  },
  initTxt: {
    fontFamily: Fonts.semiBold,
    fontSize: 16,
    color: '#141311',
    letterSpacing: -0.3,
  },
  initTxtAdd: { color: '#6B6656', fontSize: 24 },
  role: {
    fontFamily: Fonts.semiBold,
    fontSize: 11,           // was 8.5 — below any legibility floor
    color: '#7F5A0B',       // 3.6:1 -> 5.3:1
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  name: {
    fontFamily: Fonts.semiBold,
    fontSize: 17,
    color: '#141311',
    letterSpacing: -0.34,
    marginTop: 4,
  },
  nameMuted: { color: 'rgba(10,10,10,0.45)' },
});

// ─── Couple-coach sheet ───────────────────────────────────────────────────────
const ccm = StyleSheet.create({
  linkedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: 'rgba(34,168,97,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(34,168,97,0.35)',
    marginBottom: 16,
  },
  linkedTxt: { flex: 1, fontFamily: Fonts.semiBold, fontSize: 14, color: '#1c7a48' },
  note: {
    fontFamily: Fonts.regular,
    fontSize: 12,
    color: 'rgba(13,13,18,0.4)',
    marginTop: 12,
    lineHeight: 16,
  },
});

// ─── Couple config change (banners + review/notice) ───────────────────────────
const cc = StyleSheet.create({
  waitBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 13,
    backgroundColor: 'rgba(232,181,48,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(232,181,48,0.30)',
    marginBottom: 4,
  },
  waitTxt: { flex: 1, fontFamily: Fonts.semiBold, fontSize: 12.5, color: '#8a6a1f' },
  waitCancel: { fontFamily: Fonts.semiBold, fontSize: 12.5, color: '#A8801A' },
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 13,
    backgroundColor: 'rgba(46,70,112,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(46,70,112,0.22)',
    marginBottom: 4,
  },
  reviewTxt: { flex: 1, fontFamily: Fonts.semiBold, fontSize: 13, color: '#23375c' },
  reviewBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#2E4670',
  },
  reviewBtnTxt: { fontFamily: Fonts.semiBold, fontSize: 11.5, color: '#fff' },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(232,181,48,0.10)',
    marginTop: 4,
    marginBottom: 14,
  },
  noticeTxt: { flex: 1, fontFamily: Fonts.regular, fontSize: 12.5, color: '#8a6a1f', lineHeight: 17 },
  reviewCard: {
    borderWidth: 1,
    borderColor: 'rgba(13,13,18,0.10)',
    borderRadius: 14,
    paddingHorizontal: 14,
    marginBottom: 18,
  },
  reviewLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
  },
  reviewLineBorder: { borderTopWidth: 1, borderTopColor: 'rgba(13,13,18,0.06)' },
  reviewKey: { fontFamily: Fonts.semiBold, fontSize: 13, color: 'rgba(13,13,18,0.5)' },
  reviewVal: { fontFamily: Fonts.semiBold, fontSize: 14.5, color: Colors.black },
});

// ─── Settings tab ─────────────────────────────────────────────────────────────
const set = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 58,
    paddingVertical: 15,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(20,19,17,0.10)',
  },
  label: {
    flexShrink: 1,
    fontFamily: Fonts.semiBold,
    fontSize: 15.5,
    color: '#141311',
    letterSpacing: -0.16,
  },
  // maxWidth + numberOfLines is what cut "Oti & Marius Dance Studio" mid-word.
  // The value now takes the remaining width and wraps instead.
  value: {
    flex: 1,
    textAlign: 'right',
    fontFamily: Fonts.regular,
    fontSize: 13.5,
    lineHeight: 18,
    color: '#6B6656',          // 3.4:1 -> 5.7:1 on white
    marginRight: 6,
  },
});

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
    fontFamily: Fonts.semiBold,
    fontSize: 17,
    color: Colors.black,
    marginBottom: 24,
    textAlign: 'center',
    letterSpacing: -0.2,
  },


  field: { marginBottom: 18 },
  fieldLabel: {
    fontFamily: Fonts.semiBold,
    fontSize: 10,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },

  pillRow: { flexDirection: 'row', gap: 8 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    backgroundColor: Colors.statCardBg,
  },
  pillActive: { backgroundColor: Colors.black, borderColor: Colors.black },
  pillText: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.secondary },
  pillTextActive: { color: Colors.white },

  saveBtn: {
    backgroundColor: Colors.black,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnText: { fontFamily: Fonts.semiBold, fontSize: 15, color: Colors.white },
  cancelBtn: { paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.secondary },
  studioNote: {
    fontFamily: Fonts.regular,
    fontSize: 12,
    color: 'rgba(13,13,18,0.5)',
    lineHeight: 16,
    marginTop: -6,
    marginBottom: 14,
  },
});

const coachStyles = StyleSheet.create({
  slotLabel: {
    fontFamily: Fonts.semiBold,
    fontSize: 10,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },

  linkedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  coachAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,157,0,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachInitials: {
    fontFamily: Fonts.semiBold,
    fontSize: 13,
    color: Colors.orange,
  },
  coachInfo: { flex: 1 },
  coachName: {
    fontFamily: Fonts.semiBold,
    fontSize: 14,
    color: Colors.black,
  },
  coachStudio: {
    fontFamily: Fonts.regular,
    fontSize: 12,
    color: Colors.secondary,
    marginTop: 1,
  },

  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  codeInput: {
    flex: 1,
    backgroundColor: Colors.background,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontFamily: Fonts.medium,
    fontSize: 14,
    color: Colors.black,
    letterSpacing: 2,
  },
  addBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: Colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: { backgroundColor: Colors.statCardBorder },
  linkError: {
    fontFamily: Fonts.regular,
    fontSize: 12,
    color: '#E84040',
    marginTop: 6,
  },
});

// ─── Partner pairing modal styles ─────────────────────────────────────────────
const pm = StyleSheet.create({
  lead: { fontFamily: Fonts.regular, fontSize: 14, color: 'rgba(13,13,18,0.8)', lineHeight: 20, marginBottom: 14 },
  bold: { fontFamily: Fonts.semiBold, color: Colors.black },
  fieldLabel: { fontFamily: Fonts.semiBold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: 'rgba(13,13,18,0.45)', marginBottom: 8, marginTop: 4 },
  chipRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  chip: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: 'rgba(13,13,18,0.12)', alignItems: 'center', backgroundColor: 'transparent' },
  chipOn: { borderColor: Colors.black, backgroundColor: Colors.black },
  chipTxt: { fontFamily: Fonts.semiBold, fontSize: 14, color: 'rgba(13,13,18,0.6)' },
  chipTxtOn: { color: '#fff' },
  inputRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1.5, borderColor: 'rgba(13,13,18,0.12)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: Fonts.semiBold, fontSize: 15, color: Colors.black, letterSpacing: 1 },
  addBtn: { width: 46, height: 46, borderRadius: 12, backgroundColor: Colors.black, alignItems: 'center', justifyContent: 'center' },
  err: { fontFamily: Fonts.regular, fontSize: 12, color: '#E84040', marginTop: 10 },
  primaryBtn: { backgroundColor: Colors.black, borderRadius: 13, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryTxt: { fontFamily: Fonts.semiBold, fontSize: 15, color: '#fff' },
  linkBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 2 },
  linkTxt: { fontFamily: Fonts.semiBold, fontSize: 13, color: 'rgba(13,13,18,0.5)' },
  partnerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  pAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#2E4670', alignItems: 'center', justifyContent: 'center' },
  pAvatarTxt: { fontFamily: Fonts.semiBold, fontSize: 16, color: '#fff' },
  pName: { fontFamily: Fonts.semiBold, fontSize: 17, color: Colors.black },
  pMeta: { fontFamily: Fonts.regular, fontSize: 13, color: 'rgba(13,13,18,0.55)', marginTop: 3 },
  dangerBtn: { borderWidth: 1.5, borderColor: '#E84040', borderRadius: 13, paddingVertical: 14, alignItems: 'center' },
  dangerTxt: { fontFamily: Fonts.semiBold, fontSize: 15, color: '#E84040' },
  note: { fontFamily: Fonts.regular, fontSize: 12, color: 'rgba(13,13,18,0.4)', textAlign: 'center', marginTop: 10 },
  myCodeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(13,13,18,0.04)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14 },
  myCodeLabel: { fontFamily: Fonts.semiBold, fontSize: 11, letterSpacing: 0.6, color: 'rgba(13,13,18,0.4)' },
  myCodeVal: { fontFamily: Fonts.semiBold, fontSize: 18, letterSpacing: 2, color: Colors.black },
  // Final-validation ("Confirm & pair") hero + setup summary card.
  confirmHero: { alignItems: 'center', marginBottom: 18, marginTop: 2 },
  confirmAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#2E4670', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 10 },
  confirmAvatarImg: { width: 64, height: 64, borderRadius: 32 },
  confirmName: { fontFamily: Fonts.semiBold, fontSize: 19, color: Colors.black, maxWidth: '90%' },
  confirmSub: { fontFamily: Fonts.regular, fontSize: 13, color: 'rgba(13,13,18,0.55)', marginTop: 3 },
  summaryCard: { backgroundColor: 'rgba(13,13,18,0.035)', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 2, marginBottom: 16 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13 },
  summaryLabel: { fontFamily: Fonts.semiBold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: 'rgba(13,13,18,0.45)' },
  summaryVal: { fontFamily: Fonts.semiBold, fontSize: 14, color: Colors.black },
  summaryDiv: { height: 1, backgroundColor: 'rgba(13,13,18,0.07)' },
  pillWrap: { flexDirection: 'row', gap: 6 },
  roPill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(46,70,112,0.1)' },
  roPillTxt: { fontFamily: Fonts.semiBold, fontSize: 13, color: '#2E4670' },
  leadBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(232,181,48,0.14)' },
  leadTxt: { fontFamily: Fonts.semiBold, fontSize: 13, color: '#A8801A' },
});
