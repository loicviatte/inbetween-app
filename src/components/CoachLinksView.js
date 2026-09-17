import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Share, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { Colors, Fonts, Spacing } from '../theme';
import { useCoachData } from '../context/CoachDataContext';
import { getOrCreateInviteCode, getStudentLink, setStudentLink } from '../storage/coachStorage';
import { getMyCouples, setCoupleLink } from '../storage/coupleStorage';
import { isAwaitingVerification } from '../utils/studentLock';
import { getMyCoachCard, getCoachObserved } from '../storage/coachCardStorage';
import { SecLabel } from './settings/SettingsUI';
import BottomSheet from './BottomSheet';
import CoachCardModal from './CoachCardModal';

// Coach ▸ Students ▸ Links (the header's link button): how students find the
// coach — the invite code they type, and the coach card — then every student
// and couple linked to them, each with Edit: what they dance, the styles this
// coach coaches them in (changeable), and removing them. Built like the
// student's Stats ▸ Links: a section label over row cards, each opening a sheet.

const EDGE_FADE = 14;

const STYLE_NAMES = { latin: 'Latin', ballroom: 'Ballroom' };
const STYLE_KEYS = ['latin', 'ballroom'];
const stylesLabel = (keys) => STYLE_KEYS.filter((k) => keys.includes(k)).map((k) => STYLE_NAMES[k]).join(' & ');
const firstOf = (name) => (name || '').trim().split(/\s+/)[0] || '';
// users.dance_style → the styles danced ('Latin & Ballroom', or unset, is both).
const dancesOf = (danceStyle) => (danceStyle === 'Latin' ? ['latin'] : danceStyle === 'Ballroom' ? ['ballroom'] : STYLE_KEYS);

function initialsOf(name) {
  return (name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'C';
}

// One linked student or couple: initials, what they're coached in, the name, Edit.
function LinkRow({ initials, role, name, muted, onPress }) {
  return (
    <TouchableOpacity style={row.card} onPress={onPress} activeOpacity={0.75} accessibilityRole="button"
      accessibilityLabel={`${name}, ${role}. Edit`}>
      <View style={[row.init, muted && row.initMuted]}>
        <Text style={row.initTxt}>{initials}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={row.role} numberOfLines={1}>{role}</Text>
        <Text style={[row.name, muted && row.nameMuted]} numberOfLines={1}>{name}</Text>
      </View>
      <View style={row.edit}><Text style={row.editT}>Edit</Text></View>
    </TouchableOpacity>
  );
}

// The link, editable: what they dance (their own setting), the styles this coach
// coaches them in, and removing them. A style someone else coaches can't be taken.
function LinkEditSheet({ target, onClose, onDone }) {
  const last = useRef(target);
  if (target) last.current = target;
  const t = target || last.current; // keeps the sheet filled while it closes
  const key = t ? `${t.kind}:${t.id}` : null;
  // The styles ticked, for this link; a newly opened link starts from what's saved.
  const [choice, setChoice] = useState({ key: null, list: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setError(''); setBusy(false); }, [key]);
  // Closed: forget the ticks, so reopening shows what's saved now.
  const open = !!target;
  useEffect(() => { if (!open) setChoice({ key: null, list: [] }); }, [open]);

  if (!t) return null;
  const picked = choice.key === key ? choice.list : t.linked;
  const setPicked = (fn) => setChoice({ key, list: fn(picked) });
  const couple = t.kind === 'couple';
  // A student can be coached in a style they don't dance yet (it's added to
  // their dances); a couple only in what they dance — both partners agree on that.
  const shown = couple ? STYLE_KEYS.filter((k) => t.dances.includes(k) || t.linked.includes(k)) : STYLE_KEYS;
  const newDances = couple ? [] : picked.filter((k) => !t.dances.includes(k));
  const changed = stylesLabel(picked) !== stylesLabel(t.linked);
  const taken = shown.filter((k) => !picked.includes(k) && t.taken?.[k]);
  const save = (latin, ballroom) => (couple ? setCoupleLink : setStudentLink)(t.id, { latin, ballroom });

  async function onSave() {
    if (busy || !changed || picked.length === 0) return;
    setBusy(true); setError('');
    try {
      await save(picked.includes('latin'), picked.includes('ballroom'));
      onDone();
    } catch (e) {
      setError(e.message || 'Could not save. Try again.');
      setBusy(false);
    }
  }

  function onRemove() {
    Alert.alert(
      `Remove ${t.first}?`,
      couple
        ? `You won’t be ${t.first}’s couple coach anymore. They can pick you again from their app.`
        : `${t.first} won’t be linked to you anymore. They can link again with your invite code.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive', onPress: async () => {
            setBusy(true); setError('');
            try {
              await save(false, false);
              onDone();
            } catch (e) {
              setError(e.message || 'Could not remove. Try again.');
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  return (
    <BottomSheet visible={!!target} onClose={onClose} sheetStyle={em.sheet}>
      <View style={em.handle} />
      <Text style={em.title} numberOfLines={1}>{t.name}</Text>

      <View style={ed.field}>
        <Text style={ed.label}>{couple ? 'They dance' : 'Dances'}</Text>
        <Text style={ed.value}>{stylesLabel(t.dances) || 'Not set'}</Text>
      </View>

      <View style={ed.field}>
        <Text style={ed.label}>{couple ? 'You’re their couple coach in' : 'You coach them in'}</Text>
        <View style={ed.pillRow}>
          {shown.map((k) => {
            const on = picked.includes(k);
            const locked = !on && !!t.taken?.[k];
            return (
              <TouchableOpacity
                key={k}
                style={[ed.pill, on && ed.pillOn, locked && { opacity: 0.4 }]}
                disabled={locked || busy}
                onPress={() => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))}
                activeOpacity={0.75}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: locked }}
              >
                {on && <Ionicons name="checkmark" size={14} color={Colors.white} />}
                <Text style={[ed.pillT, on && { color: Colors.white }]}>{STYLE_NAMES[k]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {taken.map((k) => (
          <Text key={k} style={ed.hint}>{t.first} {couple ? 'have' : 'has'} another {STYLE_NAMES[k]} {couple ? 'couple ' : ''}coach.</Text>
        ))}
        {newDances.length > 0 && (
          <Text style={ed.hint}>{stylesLabel(newDances)} will be added to {t.first}’s dances.</Text>
        )}
        {picked.length === 0 && <Text style={ed.hint}>Keep at least one style, or remove {t.first} below.</Text>}
      </View>

      {!!error && <Text style={ed.err}>{error}</Text>}

      <TouchableOpacity
        style={[em.saveBtn, (!changed || picked.length === 0 || busy) && { opacity: 0.4 }]}
        onPress={onSave}
        disabled={!changed || picked.length === 0 || busy}
        activeOpacity={0.88}
      >
        <Text style={em.saveBtnText}>{busy ? 'Saving…' : 'Save'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={ed.remove} onPress={onRemove} disabled={busy} activeOpacity={0.7}>
        <Text style={ed.removeT}>Remove {t.first}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={em.cancelBtn} onPress={onClose} activeOpacity={0.7}>
        <Text style={em.cancelBtnText}>Cancel</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

export default function CoachLinksView({ bottomSpace = 0 }) {
  const { user, students, refresh } = useCoachData();
  const [couples, setCouples] = useState(null); // null while loading
  const [edit, setEdit] = useState(null);       // the link being edited
  const [code, setCode] = useState(null);       // null while loading, '' if it couldn't be read
  const [card, setCard] = useState(null);
  const [observed, setObserved] = useState(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(null);

  useEffect(() => {
    let alive = true;
    getOrCreateInviteCode().then((c) => { if (alive) setCode(c || ''); }).catch(() => { if (alive) setCode(''); });
    getMyCoachCard().then((c) => { if (alive) setCard(c); }).catch(() => {});
    getCoachObserved().then((o) => { if (alive) setObserved(o); }).catch(() => {});
    getMyCouples().then((c) => { if (alive) setCouples(c || []); }).catch(() => { if (alive) setCouples([]); });
    return () => { alive = false; clearTimeout(copiedTimer.current); };
  }, []);

  function editStudent(s) {
    const dances = dancesOf(s.danceStyle);
    // A legacy link with no style counts as everything they dance.
    setEdit({ kind: 'student', id: s.id, name: s.name || 'Student', first: firstOf(s.name) || 'this student',
      dances, linked: s.coachStyles?.length ? s.coachStyles : dances, taken: null });
    // Who holds each style's slot — a style another coach has can't be added.
    getStudentLink(s.id).then((u) => {
      if (!u) return;
      setEdit((e) => (e?.kind === 'student' && e.id === s.id ? {
        ...e,
        dances: dancesOf(u.dance_style),
        taken: {
          latin: !!u.latin_coach_id && u.latin_coach_id !== user?.id,
          ballroom: !!u.ballroom_coach_id && u.ballroom_coach_id !== user?.id,
        },
      } : e));
    }).catch(() => {});
  }

  function editCouple(c) {
    const a = firstOf(c.dancerA?.name) || 'Dancer';
    const b = firstOf(c.dancerB?.name) || 'Dancer';
    setEdit({
      kind: 'couple', id: c.coupleId, name: `${c.dancerA?.name || a} & ${c.dancerB?.name || b}`, first: `${a} & ${b}`,
      dances: [c.doesLatin && 'latin', c.doesBallroom && 'ballroom'].filter(Boolean),
      linked: coupleStyles(c),
      taken: {
        latin: !!c.latinCoupleCoachId && c.latinCoupleCoachId !== user?.id,
        ballroom: !!c.ballroomCoupleCoachId && c.ballroomCoupleCoachId !== user?.id,
      },
    });
  }

  async function onEdited() {
    setEdit(null);
    await Promise.all([
      refresh(),
      getMyCouples().then((c) => setCouples(c || [])).catch(() => {}),
    ]);
  }

  async function copy() {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  async function share() {
    if (!code) return;
    const first = user?.name ? user.name.split(' ')[0] : 'your coach';
    try {
      await Share.share({
        message: `Join me on InBetween — I'll send your focus points after every class.\n\nUse my invite code: ${code}`,
        title: `Connect with ${first} on InBetween`,
      });
    } catch (err) {
      Alert.alert('Could not share', String(err?.message || err));
    }
  }

  const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
  const linkedStudents = [...students].sort(byName);
  const linkedCouples = [...(couples || [])].sort(byName);
  const coupleStyles = (c) => [
    c.latinCoupleCoachId === user?.id && 'latin',
    c.ballroomCoupleCoachId === user?.id && 'ballroom',
  ].filter(Boolean);

  return (
    <View style={{ flex: 1 }}>
      <MaskedView
        style={{ flex: 1 }}
        maskElement={
          <View style={{ flex: 1 }}>
            <LinearGradient colors={['transparent', '#000']} style={{ height: EDGE_FADE }} />
            <View style={{ flex: 1, backgroundColor: '#000' }} />
            <LinearGradient colors={['#000', 'rgba(0,0,0,0.5)', 'transparent']} locations={[0, 0.55, 1]} style={{ height: bottomSpace + 34 }} />
          </View>
        }
      >
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: Spacing.side, paddingBottom: bottomSpace + 30 }}
          showsVerticalScrollIndicator={false}
        >
          <SecLabel text="Invite students" />
          <TouchableOpacity style={row.card} onPress={() => setCodeOpen(true)} activeOpacity={0.75}
            accessibilityRole="button" accessibilityLabel={code ? `Invite code ${code.split('').join(' ')}` : 'Invite code'}>
            <View style={[row.init, row.initAdd]}>
              <Text style={[row.initTxt, row.initTxtAdd]}>+</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={row.role}>Invite code</Text>
              <Text style={[row.name, row.code, !code && row.nameMuted]} numberOfLines={1}>
                {code == null ? 'Loading…' : code || 'Unavailable'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="rgba(10,10,10,0.3)" />
          </TouchableOpacity>

          {!!card && (
            <>
              <SecLabel text="Coach card" />
              <TouchableOpacity style={row.card} onPress={() => setCardOpen(true)} activeOpacity={0.75} accessibilityRole="button">
                <View style={row.init}>
                  <Text style={row.initTxt}>{initialsOf(user?.name)}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={row.role}>Your coach card</Text>
                  <Text style={row.name} numberOfLines={1}>useinbetween.com/{card.slug}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="rgba(10,10,10,0.3)" />
              </TouchableOpacity>
            </>
          )}

          <SecLabel text={`Students · ${linkedStudents.length}`} />
          {linkedStudents.length === 0 ? (
            <Text style={row.note}>No students yet — share your code to get your first connection.</Text>
          ) : linkedStudents.map((s) => {
            const waiting = isAwaitingVerification(s);
            return (
              <LinkRow
                key={s.id}
                initials={initialsOf(s.name)}
                role={waiting ? 'Awaiting verification' : `${stylesLabel(s.coachStyles || []) || 'Coached'} · Student`}
                name={s.name || 'Student'}
                muted={waiting}
                onPress={() => editStudent(s)}
              />
            );
          })}

          <SecLabel text={couples == null ? 'Couples' : `Couples · ${linkedCouples.length}`} />
          {couples == null ? null : linkedCouples.length === 0 ? (
            <Text style={row.note}>No couples yet. When a couple picks you as their couple coach, they’ll appear here.</Text>
          ) : linkedCouples.map((c) => (
            <LinkRow
              key={c.coupleId}
              initials={`${c.dancerA?.name?.[0] || '?'}${c.dancerB?.name?.[0] || '?'}`.toUpperCase()}
              role={`${stylesLabel(coupleStyles(c)) || 'Coached'} · Couple`}
              name={`${c.dancerA?.name || 'Dancer'} & ${c.dancerB?.name || 'Dancer'}`}
              onPress={() => editCouple(c)}
            />
          ))}
        </ScrollView>
      </MaskedView>

      {/* The code, big, with Share and Copy. */}
      <BottomSheet visible={codeOpen} onClose={() => setCodeOpen(false)} sheetStyle={em.sheet}>
        <View style={em.handle} />
        <Text style={em.title}>Your invite code</Text>
        <Text style={em.code} selectable numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>{code || '——'}</Text>
        <Text style={em.note}>
          Students enter this code in their app to connect with you and get their focus points after every class.
        </Text>
        <TouchableOpacity style={[em.saveBtn, !code && { opacity: 0.4 }]} onPress={share} disabled={!code} activeOpacity={0.88}>
          <Ionicons name="share-outline" size={16} color={Colors.white} />
          <Text style={em.saveBtnText}>Share with a student</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[em.copyBtn, !code && { opacity: 0.4 }]} onPress={copy} disabled={!code} activeOpacity={0.8}>
          <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={15} color={copied ? '#1F6B3A' : Colors.black} />
          <Text style={[em.copyBtnText, copied && { color: '#1F6B3A' }]}>{copied ? 'Copied' : 'Copy code'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={em.cancelBtn} onPress={() => setCodeOpen(false)} activeOpacity={0.7}>
          <Text style={em.cancelBtnText}>Close</Text>
        </TouchableOpacity>
      </BottomSheet>

      <LinkEditSheet target={edit} onClose={() => setEdit(null)} onDone={onEdited} />

      <CoachCardModal visible={cardOpen} onClose={() => setCardOpen(false)} name={user?.name} card={card} observed={observed} />
    </View>
  );
}

// Stats ▸ Links row cards (ProfileScreen `row`), unchanged.
const row = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 62, backgroundColor: '#FFFFFF',
    borderRadius: 22, paddingHorizontal: 18, paddingVertical: 16, marginBottom: 12,
  },
  init: {
    width: 50, height: 50, borderRadius: 25, backgroundColor: '#E2AA20', borderWidth: 1, borderColor: '#A87A10',
    alignItems: 'center', justifyContent: 'center',
  },
  initAdd: { backgroundColor: '#F4F2EC', borderStyle: 'dashed', borderColor: 'rgba(20,19,17,0.45)' },
  initMuted: { backgroundColor: '#F4F2EC', borderColor: 'rgba(20,19,17,0.2)' },
  initTxt: { fontFamily: Fonts.semiBold, fontSize: 16, color: '#141311', letterSpacing: -0.3 },
  initTxtAdd: { color: '#6B6656', fontSize: 24 },
  role: { fontFamily: Fonts.semiBold, fontSize: 11, color: '#7F5A0B', letterSpacing: 1.4, textTransform: 'uppercase' },
  name: { fontFamily: Fonts.semiBold, fontSize: 17, color: '#141311', letterSpacing: -0.34, marginTop: 4 },
  code: { letterSpacing: 2 },
  nameMuted: { color: 'rgba(10,10,10,0.45)', letterSpacing: -0.34 },
  note: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18, color: '#6B6656', paddingHorizontal: 4 },
  edit: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(20,19,17,0.16)' },
  editT: { fontFamily: Fonts.semiBold, fontSize: 13, color: '#141311' },
});

// The link sheet's fields (the settings sheets' label and pills).
const ed = StyleSheet.create({
  field: { marginBottom: 18 },
  label: { fontFamily: Fonts.semiBold, fontSize: 10, color: Colors.secondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  value: { fontFamily: Fonts.semiBold, fontSize: 15.5, color: '#141311' },
  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    borderWidth: 0.5, borderColor: Colors.statCardBorder, backgroundColor: Colors.statCardBg,
  },
  pillOn: { backgroundColor: Colors.black, borderColor: Colors.black },
  pillT: { fontFamily: Fonts.medium, fontSize: 14, color: Colors.secondary },
  hint: { fontFamily: Fonts.regular, fontSize: 12.5, lineHeight: 17, color: '#6B6656', marginTop: 8 },
  err: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18, color: '#A3281B', textAlign: 'center', marginBottom: 12 },
  remove: { paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  removeT: { fontFamily: Fonts.semiBold, fontSize: 14.5, color: '#A3281B' },
});

// Stats ▸ Settings sheets (`em`), with the code and a Copy button.
const em = StyleSheet.create({
  sheet: { backgroundColor: Colors.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 44 },
  handle: { width: 32, height: 3, backgroundColor: 'rgba(13,13,18,0.1)', borderRadius: 2, alignSelf: 'center', marginBottom: 24 },
  title: { fontFamily: Fonts.semiBold, fontSize: 17, color: Colors.black, marginBottom: 18, textAlign: 'center', letterSpacing: -0.2 },
  code: { fontFamily: Fonts.bold, fontSize: 38, letterSpacing: 5, color: '#141311', textAlign: 'center' },
  note: { fontFamily: Fonts.regular, fontSize: 13.5, lineHeight: 19, color: '#6B6656', textAlign: 'center', marginTop: 10, marginBottom: 22 },
  saveBtn: { flexDirection: 'row', gap: 8, backgroundColor: Colors.black, borderRadius: 14, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontFamily: Fonts.semiBold, fontSize: 15, color: Colors.white },
  copyBtn: {
    flexDirection: 'row', gap: 8, borderRadius: 14, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', marginTop: 10,
    borderWidth: 1, borderColor: 'rgba(13,13,18,0.14)',
  },
  copyBtnText: { fontFamily: Fonts.semiBold, fontSize: 15, color: Colors.black },
  cancelBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  cancelBtnText: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.secondary },
});
