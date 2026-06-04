import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle } from 'react-native-svg';
import TabHeader from '../components/TabHeader';
import ProfileSkeleton from '../components/ProfileSkeleton';
import StudioPicker from '../components/StudioPicker';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Fonts, Spacing } from '../theme';
import {
  getUser,
  getClassInputs,
  getFocusPoints,
  saveUserProfile,
  getMyCoach,
  linkToCoachByCode,
  unlinkCoach,
  linkToCoachByCodeForCategory,
  unlinkCoachForCategory,
  getMyCoachForCategory,
  getLessonReadiness,
  getMyCoachQuestions,
  getProfileActivityStats,
} from '../storage/storage';
import { supabase } from '../services/supabase/client';
import HeroCardGradient from '../components/HeroCardGradient';
import QuestionDetailSheet from '../components/QuestionDetailSheet';
import RadarChart, { RADAR_LABELS } from '../components/RadarChart';
import { useProfile } from '../context/ProfileContext';
import { clearUserCaches } from '../storage/userCaches';
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
  getCoupleReadiness,
  proposeCoupleChange,
  respondCoupleChange,
  cancelCoupleChange,
} from '../storage/coupleStorage';

const AVATAR_KEY = '@profile_photo';
const PROFILE_CACHE_KEY = '@cache_profile';
const HOME_CACHE_KEY = '@cache_home';

const RADAR_CATEGORIES = ['Stability', 'Technicality', 'Strength', 'Creativity', 'Musicality'];

// ─── Readiness meter (semi-circle SVG ring) ──────────────────────────────────
function ReadinessMeter({ percent = 0, size = 84, stroke = 6 }) {
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, percent)) / 100) * circumference;
  const remainder = circumference - filled;
  return (
    <View style={[meterStyles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        {/* Track */}
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke="rgba(255,255,255,0.10)"
          strokeWidth={stroke}
          fill="none"
        />
        {/* Fill */}
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke="#E8B530"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${filled} ${remainder}`}
          strokeLinecap="round"
        />
      </Svg>
      <View style={meterStyles.inner} />
      <View style={meterStyles.labelWrap}>
        <Text style={meterStyles.pct}>
          {Math.round(percent)}<Text style={meterStyles.pctSm}>%</Text>
        </Text>
      </View>
    </View>
  );
}

// ─── Focus row inside readiness card ─────────────────────────────────────────
const TIER_LABEL = {
  critical: 'Critical focus',
  important: 'Important focus',
  supporting: 'Supporting focus',
};
// Mini progress dial used on each readiness focus row. Three states:
//   complete (done >= target) → solid gold check
//   in-progress (0 < done < target) → gold arc filling the gray track
//   untouched (done = 0) → empty gray ring
// Checkmark is reserved for "done" so a partial 1/2 doesn't read as
// completed at a glance.
function FocusCheckRing({ done, target }) {
  const size = 24;
  const stroke = 1.8;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const ratio = target > 0 ? Math.min(1, Math.max(0, done / target)) : 0;
  const complete = target > 0 && done >= target;
  if (complete) {
    return (
      <View style={[ready.check, ready.checkComplete]}>
        <Ionicons name="checkmark" size={12} color="#0D0D12" />
      </View>
    );
  }
  const filled = ratio * circ;
  const remainder = circ - filled;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={c} cy={c} r={r} stroke="rgba(255,255,255,0.20)" strokeWidth={stroke} fill="none" />
        {filled > 0 && (
          <Circle
            cx={c}
            cy={c}
            r={r}
            stroke="#E8B530"
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${filled} ${remainder}`}
            strokeLinecap="round"
          />
        )}
      </Svg>
    </View>
  );
}

function FocusReadyRow({ row, isLast }) {
  if (!row) return null;
  const labelText = `${TIER_LABEL[row.tier] || 'Focus'} · from last private`;
  return (
    <View style={[ready.focusRow, !isLast && ready.focusRowBorder]}>
      <FocusCheckRing done={row.done || 0} target={row.target || 0} />
      <View style={ready.focusBody}>
        <Text style={ready.focusName} numberOfLines={1}>{row.name}</Text>
        <Text style={ready.focusMeta} numberOfLines={1}>{labelText}</Text>
      </View>
      <Text style={ready.focusProgress}>
        {row.done}<Text style={ready.focusProgressOf}>/{row.target}</Text>
      </Text>
    </View>
  );
}

// Question row — shown after the focus list inside the readiness card.
// Status drives the badge + the secondary line:
//   pending    → muted chat icon, "Awaiting coach reply"
//   dismissed  → gold "IN NEXT CLASS" badge, "Coach will cover it"
//   replied    → gold reply badge, "Replied" + the actual reply preview
function QuestionReadyRow({ question, isLast, onPress }) {
  if (!question) return null;
  const status = question.status;
  const isReplied = status === 'replied';
  const isInClass = status === 'dismissed';
  const handled = isReplied || isInClass;

  const metaText = isReplied
    ? (question.reply ? `Replied: ${question.reply}` : 'Coach replied')
    : isInClass
      ? 'Coach will cover it in your next class'
      : 'Awaiting coach reply';

  return (
    <TouchableOpacity
      style={[ready.focusRow, !isLast && ready.focusRowBorder]}
      activeOpacity={0.65}
      onPress={onPress}
    >
      <View style={[ready.check, handled && ready.checkPartial]}>
        <Ionicons
          name={isReplied ? 'chatbubble-ellipses' : isInClass ? 'time-outline' : 'chatbubble-outline'}
          size={11}
          color={handled ? '#F6D27A' : 'rgba(255,255,255,0.40)'}
        />
      </View>
      <View style={ready.focusBody}>
        <Text style={ready.focusName} numberOfLines={1}>{question.message}</Text>
        <Text style={ready.focusMeta} numberOfLines={2}>{metaText}</Text>
      </View>
      {isInClass && (
        <View style={ready.inClassBadge}>
          <Text style={ready.inClassBadgeText}>IN CLASS</Text>
        </View>
      )}
      {isReplied && (
        <View style={ready.repliedBadge}>
          <Text style={ready.repliedBadgeText}>REPLIED</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Sub-tab segmented control (Coaches · Statistics · Settings) ──────────────
const PROFILE_TABS = [
  { key: 'links', label: 'Links' },
  { key: 'stats', label: 'Statistics' },
  { key: 'settings', label: 'Settings' },
];
function SubTabs({ active, onChange }) {
  return (
    <View style={tab.bar}>
      {PROFILE_TABS.map((t) => {
        const on = active === t.key;
        return (
          <TouchableOpacity
            key={t.key}
            style={[tab.btn, on && tab.btnOn]}
            onPress={() => onChange(t.key)}
            activeOpacity={0.8}
          >
            <Text style={[tab.btnTxt, on && tab.btnTxtOn]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
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
function PartnerListRow({ couple, hasRequest, onPress }) {
  const partnerName = couple?.partner?.name;
  const muted = !couple;
  const initials = partnerName?.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '+';
  const name = couple ? (partnerName || 'Partner') : (hasRequest ? 'Pending…' : 'Add partner');
  return (
    <TouchableOpacity style={row.card} onPress={onPress} activeOpacity={0.75}>
      <View style={[row.init, muted && row.initAdd]}>
        <Text style={[row.initTxt, muted && row.initTxtAdd]}>{initials}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={row.role}>Partner</Text>
        <Text style={[row.name, muted && row.nameMuted]} numberOfLines={1}>{name}</Text>
      </View>
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

// ─── Settings tab row ─────────────────────────────────────────────────────────
function SettingRow({ icon, label, value, onPress, isLast }) {
  return (
    <TouchableOpacity
      style={[set.row, !isLast && set.rowBorder]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={set.icon}>
        <Ionicons name={icon} size={17} color="rgba(10,10,10,0.6)" />
      </View>
      <Text style={set.label}>{label}</Text>
      {!!value && <Text style={set.value} numberOfLines={1}>{value}</Text>}
      <Ionicons name="chevron-forward" size={15} color="rgba(10,10,10,0.3)" />
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
    const pFirst = (outgoing.targetName || 'Partner').split(' ')[0];
    const leads = outgoing.proposedLeaderId === myUserId ? (myName || 'You') : pFirst;
    const styles = [outgoing.proposedDoesLatin && 'Latin', outgoing.proposedDoesBallroom && 'Ballroom'].filter(Boolean).join(' · ') || '—';
    body = (
      <View>
        <Text style={pm.lead}><Text style={pm.bold}>{outgoing.targetName}</Text> accepted and set things up:</Text>
        <Text style={pm.pMeta}>{styles}  ·  {leads} leads</Text>
        {!!error && <Text style={pm.err}>{error}</Text>}
        <TouchableOpacity style={[pm.primaryBtn, linking && { opacity: 0.6 }]} disabled={linking} onPress={onValidate} activeOpacity={0.85}>
          {linking ? <ActivityIndicator color="#fff" size="small" /> : <Text style={pm.primaryTxt}>Confirm &amp; pair</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={pm.linkBtn} onPress={onCancel} activeOpacity={0.7}><Text style={pm.linkTxt}>Cancel</Text></TouchableOpacity>
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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={em.overlay} onPress={onClose}>
          <Pressable style={em.sheet} onPress={() => {}}>
            <View style={em.handle} />
            <Text style={em.title}>Dance partner</Text>
            {body}
            <TouchableOpacity style={[em.cancelBtn, { marginTop: 16 }]} onPress={onClose} activeOpacity={0.7}>
              <Text style={em.cancelBtnText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function ProfileScreen({ navigation }) {
  const { setAvatarUri, setInitials } = useProfile();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [isLoading, setIsLoading] = useState(true);
  const hasLoadedRef = useRef(false);
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('links'); // 'links' | 'stats' | 'settings'
  const [stats, setStats] = useState({ totalClasses: 0, totalSessions: 0, activeFocusAreas: 0 });
  const [activityStats, setActivityStats] = useState({ bestStreakDays: 0, monthMinutes: 0 });
  const [radarScores, setRadarScores] = useState([0, 0, 0, 0, 0]);
  const [readiness, setReadiness] = useState(null);
  const [coupleReadinessP, setCoupleReadinessP] = useState(null);
  const [readinessMode, setReadinessMode] = useState('solo'); // 'solo' | 'couple'
  const [coachQuestions, setCoachQuestions] = useState([]);
  const [viewingQuestion, setViewingQuestion] = useState(null);
  const [questionsExpanded, setQuestionsExpanded] = useState(false);
  const [profileModal, setProfileModal] = useState(null); // 'account' | 'style' | 'studio' | null
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editStudio, setEditStudio] = useState(null);
  const [editStyle, setEditStyle] = useState('');
  const [saving, setSaving] = useState(false);
  const [photoUri, _setPhotoUri] = useState(null);
  function setPhotoUri(uri) { _setPhotoUri(uri); setAvatarUri(uri); }
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
  const [partnerCode, setPartnerCode] = useState('');
  const [partnerLinking, setPartnerLinking] = useState(false);
  const [partnerError, setPartnerError] = useState('');
  const [myPartnerCode, setMyPartnerCode] = useState('');

  async function load() {
    const [
      userData,
      classInputs,
      activeFocusPoints,
      { data: { session } },
      savedPhoto,
      coachData,
      latinCoachData,
      ballroomCoachData,
      readinessValue,
      coachQs,
      coupleData,
      incomingReq,
      outgoingReq,
      myCode,
      activity,
    ] = await Promise.all([
      // Every fetch is individually caught so one failure (e.g. a transient
      // "Not authenticated" from getUserId during a token refresh) can't reject
      // the whole Promise.all and abort load() before we apply the partnership.
      // couple / partner requests use `undefined` as a "fetch failed — keep what
      // we have" sentinel, distinct from `null` ("definitively no partner").
      getUser().catch(() => null),
      getClassInputs().catch(() => []),
      getFocusPoints().catch(() => []),
      supabase.auth.getSession(),
      AsyncStorage.getItem(AVATAR_KEY).catch(() => null),
      getMyCoach().catch(() => null),
      getMyCoachForCategory('latin').catch(() => null),
      getMyCoachForCategory('ballroom').catch(() => null),
      getLessonReadiness().catch(() => null),
      getMyCoachQuestions().catch(() => []),
      getMyCouple().catch(() => undefined),
      getIncomingPartnerRequest().catch(() => undefined),
      getOutgoingPartnerRequest().catch(() => undefined),
      getMyPartnerCode().catch(() => ''),
      getProfileActivityStats().catch(() => ({ bestStreakDays: 0, monthMinutes: 0 })),
    ]);

    let totalSessions = 0;
    if (session?.user?.id) {
      const { count } = await supabase
        .from('practice_logs')
        .select('id', { count: 'exact' })
        .eq('student_id', session.user.id)
        .not('completed_at', 'is', null);
      totalSessions = count ?? 0;
    }

    // Trainer-only: count pending reviews
    const trainerEmail = session?.user?.email;
    if (trainerEmail === 'loic@danceuniteduk.com') {
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

    // Radar — fewer active focuses per category = stronger area
    const catCounts = { Stability: 0, Technicality: 0, Strength: 0, Creativity: 0, Musicality: 0 };
    for (const fp of activeFocusPoints ?? []) {
      if (fp.category && catCounts[fp.category] !== undefined) catCounts[fp.category]++;
    }
    const maxCat = Math.max(...Object.values(catCounts), 1);
    const scores = RADAR_CATEGORIES.map((cat) => 1 - catCounts[cat] / maxCat);

    const s = {
      totalClasses: classInputs?.length ?? 0,
      totalSessions,
      activeFocusAreas: activeFocusPoints?.length ?? 0,
    };
    if (userData) setUser(userData); // don't blank a cached user on a failed fetch
    setStats(s);
    setActivityStats(activity || { bestStreakDays: 0, monthMinutes: 0 });
    setRadarScores(scores);
    setReadiness(readinessValue);
    setCoachQuestions(coachQs || []);
    if (userData?.name) {
      const ini = userData.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      setInitials(ini);
      AsyncStorage.setItem('@profile_name', userData.name).catch(() => {});
    }
    const remoteAvatar = userData?.avatar_url
      ? `${userData.avatar_url}?t=${Math.floor(Date.now() / 60000)}`
      : null;
    const avatarToShow = remoteAvatar || savedPhoto || null;
    if (avatarToShow) {
      setPhotoUri(avatarToShow);
      if (remoteAvatar) await AsyncStorage.setItem(AVATAR_KEY, remoteAvatar).catch(() => {});
    }
    setMyCoach(coachData);
    setLatinCoach(latinCoachData);
    setBallroomCoach(ballroomCoachData);
    // `undefined` = the fetch failed → keep whatever partnership we already
    // show (cache / prior load). Only `null` means "definitively unpaired".
    if (coupleData !== undefined) setCouple(coupleData);
    if (incomingReq !== undefined) setPartnerIncoming(incomingReq);
    if (outgoingReq !== undefined) setPartnerOutgoing(outgoingReq);
    setMyPartnerCode(myCode || '');
    if (coupleData?.coupleId) {
      getCoupleReadiness(coupleData.coupleId, null).then(setCoupleReadinessP).catch(() => setCoupleReadinessP(null));
    } else if (coupleData === null) {
      setCoupleReadinessP(null);
      setReadinessMode('solo');
    }
    // Persist a stale-while-revalidate snapshot. Partnership is preserved across
    // a failed couple fetch so it shows instantly and never regresses to
    // "Add partner" on a transient blip.
    let prevCache = {};
    try { prevCache = JSON.parse((await AsyncStorage.getItem(PROFILE_CACHE_KEY)) || '{}') || {}; } catch {}
    AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({
      user: userData ?? prevCache.user ?? null,
      stats: s,
      activityStats: activity,
      radarScores: scores,
      myCoach: coachData ?? prevCache.myCoach ?? null,
      readiness: readinessValue,
      couple: coupleData !== undefined ? coupleData : (prevCache.couple ?? null),
    })).catch(() => {});
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
            setStats(c.stats || { totalClasses: 0, totalSessions: 0, activeFocusAreas: 0 });
            setActivityStats(c.activityStats || { bestStreakDays: 0, monthMinutes: 0 });
            setRadarScores(c.radarScores || [0, 0, 0, 0, 0]);
            setMyCoach(c.myCoach ?? null);
            setReadiness(c.readiness || null);
            if (c.couple !== undefined) setCouple(c.couple); // show partnership instantly from cache
            setIsLoading(false);
            reveal(); // fade cached content in NOW — don't wait on the network
            revealed = true;
          }
        } catch {}
      }
      try { await load(); } catch {}
      hasLoadedRef.current = true;
      setIsLoading(false);
      // No cache → the skeleton was showing; fade the real content in now.
      if (isFirst && !revealed) reveal();
    }
    init();
  }, []));

  async function handlePickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: true,
    });
    if (result.canceled || !result.assets[0]?.uri) return;

    const asset = result.assets[0];
    const localUri = asset.uri;
    setPhotoUri(localUri);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error('Not authenticated');

      if (!asset.base64) throw new Error('No base64 data from picker');
      const bin = global.atob(asset.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

      const ext = (localUri.split('.').pop() || 'jpg').toLowerCase();
      const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
      const path = `${userId}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, bytes, { upsert: true, contentType });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(path);

      const urlWithCache = `${publicUrl}?t=${Date.now()}`;

      await supabase.from('users').update({ avatar_url: publicUrl }).eq('id', userId);
      await AsyncStorage.setItem(AVATAR_KEY, urlWithCache);
      setPhotoUri(urlWithCache);
    } catch (e) {
      console.error('Avatar upload failed:', e);
      await AsyncStorage.setItem(AVATAR_KEY, localUri);
    }
  }

  // Account — name + profile photo + email (TabHeader "Edit" + Settings ▸ Account)
  function openEdit() {
    setEditName(user?.name || '');
    setEditEmail(user?.email || '');
    setProfileModal('account');
  }
  function openStyleModal() {
    setEditStyle(user?.dance_style || '');
    setProfileModal('style');
  }
  function openStudioModal() {
    setEditStudio(user?.studio || null);
    setProfileModal('studio');
  }

  async function handleSaveAccount() {
    if (saving) return;
    setSaving(true);
    const name = editName.trim();
    const newEmail = editEmail.trim();
    try {
      if (name && name !== user?.name) {
        await saveUserProfile({ name });
        setUser(prev => ({ ...prev, name }));
        const ini = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
        setInitials(ini);
        AsyncStorage.setItem('@profile_name', name).catch(() => {});
      }
      let emailNotice = false;
      if (newEmail && newEmail.toLowerCase() !== (user?.email || '').toLowerCase()) {
        const { error } = await supabase.auth.updateUser({ email: newEmail });
        if (error) throw error;
        emailNotice = true;
      }
      setProfileModal(null);
      if (emailNotice) {
        Alert.alert('Confirm your new email', `We sent a confirmation link to ${newEmail}. Your email updates once you tap it.`);
      }
    } catch (e) {
      Alert.alert('Could not save', e.message || 'Please try again.');
    }
    setSaving(false);
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
        `You'll lose access to ${user.studio.name}'s past and upcoming group classes. Your new studio's classes will show instead.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Change studio', style: 'destructive', onPress: commit },
        ],
      );
    } else {
      commit();
    }
  }

  async function handleLogout() {
    // Clear the in-memory avatar first so the next user doesn't see this
    // user's photo flash before the network fetch resolves.
    setAvatarUri(null);
    setInitials(null);
    await clearUserCaches();
    await supabase.auth.signOut();
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

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : 'AL';

  // Strongest radar area — for the strengths-card footer + the larger vertex
  const strongestIdx = radarScores.reduce(
    (best, s, i, arr) => (s > arr[best] ? i : best),
    0
  );
  const strongestLabel = RADAR_LABELS[strongestIdx];

  const isDual = user?.dance_style === 'Latin & Ballroom';

  const paired = !!couple;
  const activeReadiness = (paired && readinessMode === 'couple') ? coupleReadinessP : readiness;

  const readinessTitle = (() => {
    if (!activeReadiness) return 'Log your last private to start.';
    if (activeReadiness.percent >= 100) return 'Ready for your next private.';
    if (activeReadiness.percent >= 50) return 'Almost ready for your next private.';
    return 'Train your focus points to get ready.';
  })();

  const readinessSubtitle = (() => {
    if (!activeReadiness) return 'After a class log, your focus targets show up here.';
    if (activeReadiness.minutesRemaining === 0) {
      return `All focus points trained — keep the streak going.`;
    }
    return `Train your focus points from the last lesson — ~${activeReadiness.minutesRemaining} min to go.`;
  })();

  // Questions visible in the readiness card = open questions the student
  // raised AFTER the last class. Replied ones (text answer OR "covered in
  // class") are closed — they belong in the class log, not in the upcoming
  // checklist. Anything older than the anchor class is considered handled
  // by that class and drops off too.
  const visibleQuestions = useMemo(() => {
    if (readinessMode === 'couple') return []; // questions belong to solo coaching only
    const lastDate = readiness?.lastClassDate ? new Date(readiness.lastClassDate) : null;
    return (coachQuestions || []).filter(q => {
      if (q.status === 'replied') return false;
      if (!lastDate) return true;
      return new Date(q.created_at) > lastDate;
    });
  }, [coachQuestions, readiness, readinessMode]);

  // Statistics mini-card — best all-time streak + minutes trained this month.
  const streakLabel = `${activityStats.bestStreakDays} ${activityStats.bestStreakDays === 1 ? 'day' : 'days'}`;
  const monthLabel = (() => {
    const m = activityStats.monthMinutes || 0;
    if (m < 60) return `${m} min`;
    const h = m / 60;
    return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
  })();

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
          <TabHeader navigation={navigation} onProfilePress={openEdit} editMode />

          {/* ── Fixed hero + sub-tabs — never scroll ── */}
          <View style={styles.fixedTop}>
            <View style={styles.hero}>
              <TouchableOpacity
                style={styles.heroAvatarWrap}
                onPress={handlePickPhoto}
                activeOpacity={0.85}
              >
                <View style={styles.heroAvatarRing}>
                  {photoUri ? (
                    <Image source={{ uri: photoUri }} style={styles.heroAvatarPhoto} />
                  ) : (
                    <View style={styles.heroAvatarFallback}>
                      <Text style={styles.heroAvatarInitials}>{initials}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>

              <View style={styles.heroText}>
                <Text style={styles.heroName} numberOfLines={1}>{user?.name || 'Your Name'}</Text>
                {!!user?.studio?.name && (
                  <Text style={styles.heroStudio} numberOfLines={1} ellipsizeMode="tail">
                    {user.studio.name}
                  </Text>
                )}
                {!!user?.dance_style && (
                  <View style={styles.styleChip}>
                    <Text style={styles.styleChipText}>{user.dance_style}</Text>
                  </View>
                )}
              </View>
            </View>

            <SubTabs active={activeTab} onChange={setActiveTab} />
          </View>

          {/* ── Per-tab scrollable content ── */}
          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentInner}
            showsVerticalScrollIndicator={false}
            bounces={false}
            overScrollMode="never"
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
                  hasRequest={!!partnerIncoming || !!partnerOutgoing}
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
                <View style={stat.triad}>
                  <View style={stat.cell}>
                    <Text style={stat.num}>{stats.totalClasses}</Text>
                    <Text style={stat.lbl}>Classes</Text>
                  </View>
                  <View style={stat.cellDivider} />
                  <View style={stat.cell}>
                    <Text style={stat.num}>{stats.totalSessions}</Text>
                    <Text style={stat.lbl}>Sessions</Text>
                  </View>
                  <View style={stat.cellDivider} />
                  <View style={stat.cell}>
                    <Text style={stat.num}>{stats.activeFocusAreas}</Text>
                    <Text style={stat.lbl}>Focus</Text>
                  </View>
                </View>

                <SecLabel text="Get ready for next private lesson" plain />

                {paired && (
                  <View style={pm.readyToggle}>
                    <TouchableOpacity onPress={() => setReadinessMode('solo')} style={[pm.readyTab, readinessMode === 'solo' && pm.readyTabOn]} activeOpacity={0.7}>
                      <Text style={[pm.readyTabTxt, readinessMode === 'solo' && pm.readyTabTxtOn]}>Solo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setReadinessMode('couple')} style={[pm.readyTab, readinessMode === 'couple' && pm.readyTabOn]} activeOpacity={0.7}>
                      <Text style={[pm.readyTabTxt, readinessMode === 'couple' && pm.readyTabTxtOn]}>Couple</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <View style={ready.card}>
                  <View style={ready.meterRow}>
                    <ReadinessMeter percent={activeReadiness?.percent || 0} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={ready.title}>{readinessTitle}</Text>
                      <Text style={ready.subtitle}>{readinessSubtitle}</Text>
                    </View>
                  </View>

                  <View style={ready.divider} />

                  {(activeReadiness?.focuses || []).length > 0 && (
                    <Text style={ready.sectionLabel}>Focus points</Text>
                  )}
                  {(activeReadiness?.focuses || []).map((focus, idx, arr) => (
                    <FocusReadyRow
                      key={focus.focusPointId}
                      row={focus}
                      isLast={idx === arr.length - 1}
                    />
                  ))}

                  {visibleQuestions.length > 0 && (
                    <>
                      <View style={ready.divider} />
                      <TouchableOpacity
                        style={ready.sectionToggle}
                        onPress={() => setQuestionsExpanded(v => !v)}
                        activeOpacity={0.7}
                      >
                        <Text style={ready.sectionLabelInline}>
                          Questions · {visibleQuestions.length}
                        </Text>
                        <Ionicons
                          name={questionsExpanded ? 'chevron-up' : 'chevron-down'}
                          size={14}
                          color="#F6D27A"
                        />
                      </TouchableOpacity>
                      {questionsExpanded && visibleQuestions.map((q, idx, arr) => (
                        <QuestionReadyRow
                          key={q.id}
                          question={q}
                          isLast={idx === arr.length - 1}
                          onPress={() => setViewingQuestion(q)}
                        />
                      ))}
                    </>
                  )}
                </View>

                <SecLabel text="Strengths" right="Last 30 days" />
                <View style={strengths.card}>
                  <RadarChart scores={radarScores} strongestIndex={strongestIdx} />
                </View>

                <View style={stat.miniCard}>
                  <View style={stat.miniHalf}>
                    <Text style={stat.miniLabel}>Best streak</Text>
                    <Text style={stat.miniVal}>{streakLabel}</Text>
                  </View>
                  <View style={stat.miniHalfRight}>
                    <Text style={stat.miniLabel}>This month</Text>
                    <Text style={stat.miniVal}>{monthLabel}</Text>
                  </View>
                </View>
              </View>
            )}

            {activeTab === 'settings' && (
              <View style={styles.tabBody}>
                <View style={set.card}>
                  <SettingRow icon="person-outline" label="Account" onPress={openEdit} />
                  <SettingRow icon="musical-notes-outline" label="Dance style" value={user?.dance_style} onPress={openStyleModal} />
                  <SettingRow icon="business-outline" label="Dance studio" value={user?.studio?.name} onPress={openStudioModal} isLast />
                </View>

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

          {/* Account / Dance style / Dance studio — one sheet, focused per mode */}
          <Modal visible={!!profileModal} transparent animationType="slide" onRequestClose={() => setProfileModal(null)}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
              <Pressable style={em.overlay} onPress={() => setProfileModal(null)}>
                <Pressable style={em.sheet} onPress={() => {}}>
                  <View style={em.handle} />

                  {profileModal === 'account' && (
                    <>
                      <Text style={em.title}>Account</Text>

                      <TouchableOpacity style={em.avatarWrap} onPress={handlePickPhoto} activeOpacity={0.85}>
                        {photoUri
                          ? <Image source={{ uri: photoUri }} style={em.avatarPhoto} />
                          : <View style={em.avatar}><Text style={em.avatarInitials}>{initials}</Text></View>
                        }
                        <View style={em.editBadge}><Text style={em.editIcon}>✎</Text></View>
                      </TouchableOpacity>

                      <View style={em.field}>
                        <Text style={em.fieldLabel}>Name</Text>
                        <TextInput
                          style={em.input}
                          value={editName}
                          onChangeText={setEditName}
                          placeholder="Your name"
                          placeholderTextColor="rgba(17,12,17,0.3)"
                          autoCorrect={false}
                        />
                      </View>

                      <View style={em.field}>
                        <Text style={em.fieldLabel}>Email</Text>
                        <TextInput
                          style={em.input}
                          value={editEmail}
                          onChangeText={setEditEmail}
                          placeholder="you@email.com"
                          placeholderTextColor="rgba(17,12,17,0.3)"
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="email-address"
                        />
                      </View>

                      <TouchableOpacity style={em.saveBtn} onPress={handleSaveAccount} activeOpacity={0.88} disabled={saving}>
                        <Text style={em.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
                      </TouchableOpacity>
                    </>
                  )}

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
                </Pressable>
              </Pressable>
            </KeyboardAvoidingView>
          </Modal>

          {/* Coach Linking Modal — opens when tapping a teacher slot */}
          <Modal visible={!!coachModal} transparent animationType="slide" onRequestClose={() => setCoachModal(null)}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
              <Pressable style={em.overlay} onPress={() => setCoachModal(null)}>
                <Pressable style={em.sheet} onPress={() => {}}>
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
                </Pressable>
              </Pressable>
            </KeyboardAvoidingView>
          </Modal>

          {/* Couple-coach Modal — opens when tapping a couple-coach row */}
          <Modal visible={!!coupleCoachModal} transparent animationType="slide" onRequestClose={() => setCoupleCoachModal(null)}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
              <Pressable style={em.overlay} onPress={() => setCoupleCoachModal(null)}>
                <Pressable style={em.sheet} onPress={() => {}}>
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
                </Pressable>
              </Pressable>
            </KeyboardAvoidingView>
          </Modal>

          {/* Couple change Modal — propose new dance types / leader (partner-approved) */}
          <Modal visible={!!coupleEditModal} transparent animationType="slide" onRequestClose={() => setCoupleEditModal(null)}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
              <Pressable style={em.overlay} onPress={() => setCoupleEditModal(null)}>
                <Pressable style={em.sheet} onPress={() => {}}>
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
                </Pressable>
              </Pressable>
            </KeyboardAvoidingView>
          </Modal>

          {/* Couple change review Modal — partner approves / declines a staged change */}
          <Modal visible={coupleReviewVisible} transparent animationType="slide" onRequestClose={() => setCoupleReviewVisible(false)}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
              <Pressable style={em.overlay} onPress={() => setCoupleReviewVisible(false)}>
                <Pressable style={em.sheet} onPress={() => {}}>
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
                </Pressable>
              </Pressable>
            </KeyboardAvoidingView>
          </Modal>

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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },

  fixedTop: {
    paddingHorizontal: Spacing.side,
    paddingTop: 0,
    marginTop: -8,
  },

  content: { flex: 1 },
  contentInner: {
    paddingHorizontal: Spacing.side,
    paddingTop: 4,
    // Tuned so the visible gap between Log out and the floating tab bar is
    // ~2× the marginTop above Log out (≈ 36 px).
    paddingBottom: 30,
    gap: 0,
  },

  // ── Hero (horizontal: avatar + name/studio/style chip) ──
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 4,
    paddingTop: 2,
    paddingBottom: 14,
  },
  heroAvatarWrap: { flex: 0 },
  heroAvatarRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    padding: 2.5,
    backgroundColor: 'rgba(232,181,48,0.45)',
    shadowColor: '#E8B530',
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 4,
  },
  heroAvatarPhoto: {
    width: 59,
    height: 59,
    borderRadius: 29.5,
    backgroundColor: '#F7F6F3',
    borderWidth: 2,
    borderColor: '#F7F6F3',
  },
  heroAvatarFallback: {
    width: 59,
    height: 59,
    borderRadius: 29.5,
    backgroundColor: '#4E6A5C',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#F7F6F3',
  },
  heroAvatarInitials: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: '#F7F6F3',
  },
  heroText: { flex: 1, minWidth: 0 },
  heroName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: '#0A0A0A',
    letterSpacing: -0.5,
  },
  heroStudio: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12.5,
    color: 'rgba(10,10,10,0.72)',
    marginTop: 2,
  },
  styleChip: {
    alignSelf: 'flex-start',
    marginTop: 7,
    paddingHorizontal: 11,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(232,181,48,0.16)',
  },
  styleChipText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9,
    color: '#A8801A',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },

  // ── Tab body — content column inside the per-tab scroll ──
  tabBody: { paddingTop: 4 },

  // ── Logout — red pill, sits at the end of the scroll, just above the
  // floating tab bar.
  logoutBtn: {
    alignSelf: 'center',
    marginTop: 18,
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: 'rgba(212,69,69,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(212,69,69,0.30)',
    borderRadius: 999,
  },
  logoutText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12,
    color: '#D44545',
    letterSpacing: 0.4,
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
    fontFamily: Fonts.jakartaSemiBold,
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
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: '#141414',
  },
});

// ─── Sub-tab segmented control ────────────────────────────────────────────────
const tab = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(10,10,10,0.09)',
    borderRadius: 999,
    padding: 4,
  },
  btn: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnOn: {
    backgroundColor: '#0A0A0A',
    shadowColor: '#0A0A0A',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  btnTxt: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 11.5,
    color: 'rgba(10,10,10,0.45)',
    letterSpacing: 0.1,
  },
  btnTxtOn: { color: '#fff' },
});

// ─── Coach / Partner rows + section labels (Coaches tab) ──────────────────────
const row = StyleSheet.create({
  secLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 4,
    marginTop: 18,
    marginBottom: 10,
  },
  secLabelText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: '#A8801A',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  secLabelTextPlain: {
    color: '#0A0A0A',
    textTransform: 'none',
    letterSpacing: 0,
    fontSize: 12.5,
  },
  secLabelRule: { flex: 1, height: 1, backgroundColor: 'rgba(10,10,10,0.06)' },
  secLabelRight: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 10,
    color: 'rgba(10,10,10,0.45)',
    letterSpacing: 0.4,
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(10,10,10,0.09)',
    borderRadius: 15,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 8,
  },
  init: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F0C24A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initAdd: { backgroundColor: 'rgba(46,70,112,0.12)' },
  initTxt: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
    color: '#0A0A0A',
  },
  initTxtAdd: { color: '#2E4670', fontSize: 15 },
  role: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 8.5,
    color: '#A8801A',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  name: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15.5,
    color: '#0A0A0A',
    letterSpacing: -0.1,
    marginTop: 1,
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
  linkedTxt: { flex: 1, fontFamily: Fonts.jakartaSemiBold, fontSize: 14, color: '#1c7a48' },
  note: {
    fontFamily: Fonts.jakartaRegular,
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
  waitTxt: { flex: 1, fontFamily: Fonts.jakartaSemiBold, fontSize: 12.5, color: '#8a6a1f' },
  waitCancel: { fontFamily: Fonts.jakartaExtraBold, fontSize: 12.5, color: '#A8801A' },
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
  reviewTxt: { flex: 1, fontFamily: Fonts.jakartaExtraBold, fontSize: 13, color: '#23375c' },
  reviewBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#2E4670',
  },
  reviewBtnTxt: { fontFamily: Fonts.jakartaExtraBold, fontSize: 11.5, color: '#fff' },
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
  noticeTxt: { flex: 1, fontFamily: Fonts.jakartaRegular, fontSize: 12.5, color: '#8a6a1f', lineHeight: 17 },
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
  reviewKey: { fontFamily: Fonts.jakartaSemiBold, fontSize: 13, color: 'rgba(13,13,18,0.5)' },
  reviewVal: { fontFamily: Fonts.jakartaExtraBold, fontSize: 14.5, color: Colors.black },
});

// ─── Statistics tab — counts triad + month/streak mini-card ───────────────────
const stat = StyleSheet.create({
  triad: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(10,10,10,0.09)',
    borderRadius: 15,
  },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 12, gap: 1 },
  cellDivider: { width: 1, marginVertical: 12, backgroundColor: 'rgba(10,10,10,0.05)' },
  num: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: '#0A0A0A',
    letterSpacing: -0.6,
  },
  lbl: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 10,
    color: 'rgba(10,10,10,0.45)',
  },
  miniCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(10,10,10,0.09)',
    borderRadius: 15,
    paddingHorizontal: 16,
    paddingVertical: 13,
    marginTop: 12,
  },
  miniHalf: { alignItems: 'flex-start' },
  miniHalfRight: { alignItems: 'flex-end' },
  miniLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 8.5,
    color: '#A8801A',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  miniVal: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15.5,
    color: '#0A0A0A',
    letterSpacing: -0.1,
    marginTop: 2,
  },
});

// ─── Settings tab ─────────────────────────────────────────────────────────────
const set = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(10,10,10,0.09)',
    borderRadius: 15,
    paddingHorizontal: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(10,10,10,0.05)',
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: 'rgba(10,10,10,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14.5,
    color: '#0A0A0A',
  },
  value: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: 'rgba(10,10,10,0.45)',
    marginRight: 6,
    maxWidth: 130,
  },
});

const meterStyles = StyleSheet.create({
  wrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    bottom: 6,
    borderRadius: 999,
    backgroundColor: '#0F0C0A',
  },
  labelWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pct: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: '#fff',
    letterSpacing: -0.6,
  },
  pctSm: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
  },
});

const ready = StyleSheet.create({
  card: {
    backgroundColor: '#1F1810',
    borderWidth: 1,
    borderColor: 'rgba(240,194,74,0.28)',
    borderRadius: 20,
    padding: 18,
    paddingBottom: 6,
    overflow: 'hidden',
    shadowColor: '#0A0A0A',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 22,
    elevation: 8,
  },
  meterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 14,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14.5,
    color: '#fff',
    letterSpacing: -0.2,
    lineHeight: 19,
  },
  subtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 5,
    lineHeight: 16,
  },
  divider: {
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.10)',
    marginHorizontal: -18,
  },
  focusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  focusRowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkPartial: {
    borderColor: '#E8B530',
    backgroundColor: 'rgba(232,181,48,0.18)',
  },
  checkComplete: {
    borderColor: '#E8B530',
    backgroundColor: '#E8B530',
  },
  focusBody: { flex: 1, minWidth: 0 },
  focusName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13.5,
    color: '#fff',
    letterSpacing: -0.05,
    lineHeight: 16,
  },
  focusMeta: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 3,
  },
  focusProgress: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#F6D27A',
    letterSpacing: -0.2,
  },
  focusProgressOf: {
    fontFamily: Fonts.jakartaSemiBold,
    color: 'rgba(246,210,122,0.5)',
  },
  inClassBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(240,194,74,0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(240,194,74,0.40)',
  },
  inClassBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 8.5,
    color: '#F6D27A',
    letterSpacing: 0.8,
  },
  repliedBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(76,175,80,0.18)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(76,175,80,0.40)',
  },
  repliedBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 8.5,
    color: '#8BD98F',
    letterSpacing: 0.8,
  },
  sectionLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: '#F6D27A',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 10,
  },
  sectionToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    marginTop: 14,
    marginBottom: 4,
  },
  sectionLabelInline: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: '#F6D27A',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});


const strengths = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(10,10,10,0.09)',
    borderRadius: 20,
    paddingTop: 12,
    paddingHorizontal: 10,
    paddingBottom: 12,
  },
  foot: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(10,10,10,0.09)',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  star: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E8B530',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footText: {
    flex: 1,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: 'rgba(10,10,10,0.72)',
    lineHeight: 16,
  },
  footStrong: {
    fontFamily: Fonts.jakartaExtraBold,
    color: '#0A0A0A',
  },
});

const em = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
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
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: Colors.black,
    marginBottom: 24,
    textAlign: 'center',
    letterSpacing: -0.2,
  },

  avatarWrap: { alignSelf: 'center', position: 'relative', marginBottom: 24 },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,157,0,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarPhoto: { width: 72, height: 72, borderRadius: 36 },
  avatarInitials: { fontFamily: Fonts.jakartaExtraBold, fontSize: 24, color: Colors.orange },
  editBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.black,
    alignItems: 'center', justifyContent: 'center',
  },
  editIcon: { color: Colors.white, fontSize: 11 },

  field: { marginBottom: 18 },
  fieldLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  input: {
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: Colors.black,
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
  pillText: { fontFamily: Fonts.jakartaMedium, fontSize: 13, color: Colors.secondary },
  pillTextActive: { color: Colors.white },

  saveBtn: {
    backgroundColor: Colors.black,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnText: { fontFamily: Fonts.jakartaBold, fontSize: 15, color: Colors.white },
  cancelBtn: { paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { fontFamily: Fonts.jakartaRegular, fontSize: 14, color: Colors.secondary },
  studioNote: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: 'rgba(13,13,18,0.5)',
    lineHeight: 16,
    marginTop: -6,
    marginBottom: 14,
  },
});

const coachStyles = StyleSheet.create({
  slotLabel: {
    fontFamily: Fonts.jakartaExtraBold,
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
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: Colors.orange,
  },
  coachInfo: { flex: 1 },
  coachName: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 14,
    color: Colors.black,
  },
  coachStudio: {
    fontFamily: Fonts.jakartaRegular,
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
    fontFamily: Fonts.jakartaMedium,
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
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: '#E84040',
    marginTop: 6,
  },
});

// ─── Partner pairing modal styles ─────────────────────────────────────────────
const pm = StyleSheet.create({
  lead: { fontFamily: Fonts.jakartaRegular, fontSize: 14, color: 'rgba(13,13,18,0.8)', lineHeight: 20, marginBottom: 14 },
  bold: { fontFamily: Fonts.jakartaBold, color: Colors.black },
  fieldLabel: { fontFamily: Fonts.jakartaBold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: 'rgba(13,13,18,0.45)', marginBottom: 8, marginTop: 4 },
  chipRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  chip: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: 'rgba(13,13,18,0.12)', alignItems: 'center', backgroundColor: 'transparent' },
  chipOn: { borderColor: Colors.black, backgroundColor: Colors.black },
  chipTxt: { fontFamily: Fonts.jakartaSemiBold, fontSize: 14, color: 'rgba(13,13,18,0.6)' },
  chipTxtOn: { color: '#fff' },
  inputRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1.5, borderColor: 'rgba(13,13,18,0.12)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: Fonts.jakartaSemiBold, fontSize: 15, color: Colors.black, letterSpacing: 1 },
  addBtn: { width: 46, height: 46, borderRadius: 12, backgroundColor: Colors.black, alignItems: 'center', justifyContent: 'center' },
  err: { fontFamily: Fonts.jakartaRegular, fontSize: 12, color: '#E84040', marginTop: 10 },
  primaryBtn: { backgroundColor: Colors.black, borderRadius: 13, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryTxt: { fontFamily: Fonts.jakartaBold, fontSize: 15, color: '#fff' },
  linkBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 2 },
  linkTxt: { fontFamily: Fonts.jakartaSemiBold, fontSize: 13, color: 'rgba(13,13,18,0.5)' },
  partnerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  pAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#2E4670', alignItems: 'center', justifyContent: 'center' },
  pAvatarTxt: { fontFamily: Fonts.jakartaExtraBold, fontSize: 16, color: '#fff' },
  pName: { fontFamily: Fonts.jakartaBold, fontSize: 17, color: Colors.black },
  pMeta: { fontFamily: Fonts.jakartaRegular, fontSize: 13, color: 'rgba(13,13,18,0.55)', marginTop: 3 },
  dangerBtn: { borderWidth: 1.5, borderColor: '#E84040', borderRadius: 13, paddingVertical: 14, alignItems: 'center' },
  dangerTxt: { fontFamily: Fonts.jakartaBold, fontSize: 15, color: '#E84040' },
  note: { fontFamily: Fonts.jakartaRegular, fontSize: 12, color: 'rgba(13,13,18,0.4)', textAlign: 'center', marginTop: 10 },
  myCodeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(13,13,18,0.04)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14 },
  myCodeLabel: { fontFamily: Fonts.jakartaBold, fontSize: 11, letterSpacing: 0.6, color: 'rgba(13,13,18,0.4)' },
  myCodeVal: { fontFamily: Fonts.jakartaExtraBold, fontSize: 18, letterSpacing: 2, color: Colors.black },
  readyToggle: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  readyTab: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(13,13,18,0.05)' },
  readyTabOn: { backgroundColor: Colors.black },
  readyTabTxt: { fontFamily: Fonts.jakartaSemiBold, fontSize: 13, color: 'rgba(13,13,18,0.6)' },
  readyTabTxtOn: { color: '#fff' },
});
