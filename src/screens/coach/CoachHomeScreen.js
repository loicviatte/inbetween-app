import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Pressable,
  Alert,
} from 'react-native';
import { supabase } from '../../services/supabase/client';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle } from 'react-native-svg';
import { Fonts, Spacing } from '../../theme';
import { respondToCoachRequest } from '../../storage/coachStorage';
import { setStudentAge } from '../../services/ageCheck';
import { guardStudent } from '../../utils/studentLock';
import { getMyCouples, getPendingCoupleCoachRequests, respondToCoupleCoachRequest, getCoupleReadiness } from '../../storage/coupleStorage';
import { CoachHomeScreenSkeleton } from '../../components/Skeleton';
import { useCoachData } from '../../context/CoachDataContext';
import { getStudentsReadiness } from '../../storage/storage';

// ─── Coach ▸ Students (docs/design/coach-students.html) ─────────────────────
// Students | Couples, a roster summary (ready vs behind, questions asked, focus
// points to validate), Readiness | Last private lesson, then the roster in two
// groups — Needs attention, On track. Each row: readiness ring, what's going
// on, open focus points, and six weeks of practice.

const INK = '#0A0A0A';
const INK_62 = 'rgba(10,10,10,0.62)';
const LINE = 'rgba(10,10,10,0.12)';
const PAGE = '#F2F0EB';
const GOLD = '#E8B530';
const GOLD_INK = '#8A6414';
const RED = '#A8412F';
const GREEN = '#7FB77E';

function initialsOf(name) {
  const w = (name || '').trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '?') + (w[1]?.[0] || '')).toUpperCase();
}

function relative(iso) {
  if (!iso) return null;
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return 'less than an hour ago';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function lessonDate(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Avatar({ person, readiness, alert, gold, size = 44 }) {
  const stroke = 2.5;
  const r = size / 2 - stroke;
  const circ = 2 * Math.PI * r;
  const pct = readiness == null ? 0 : Math.max(0, Math.min(100, readiness));
  const photo = person.photoUrl || person.photo_url || person.avatar_url;
  const inner = size - 10;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(10,10,10,0.1)" strokeWidth={stroke} />
        {pct > 0 && (
          <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={alert ? RED : GOLD} strokeWidth={stroke}
            strokeDasharray={`${circ}`} strokeDashoffset={circ * (1 - pct / 100)} strokeLinecap="round" />
        )}
      </Svg>
      <View style={[st.avInner, { width: inner, height: inner, borderRadius: inner / 2 }]}>
        {photo ? (
          <Image source={{ uri: photo }} style={{ width: inner, height: inner }} />
        ) : gold ? (
          <LinearGradient colors={['#F6D27A', GOLD]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.avFill}>
            <Text style={[st.avText, { color: INK }]}>{initialsOf(person.name)}</Text>
          </LinearGradient>
        ) : (
          <Text style={st.avText}>{initialsOf(person.name)}</Text>
        )}
      </View>
    </View>
  );
}

// Six weeks of finished sessions; this week in colour when there is one.
function Sparkline({ weeks, alert }) {
  const max = Math.max(1, ...weeks);
  const empty = !weeks.some(Boolean);
  return (
    <View style={[st.spark, empty && { alignItems: 'center' }]}>
      {weeks.map((v, i) => (
        <View key={i} style={[
          st.sparkBar,
          { height: empty ? 2 : Math.max(2, Math.round((v / max) * 16)) },
          !empty && i === weeks.length - 1 && v > 0 && { backgroundColor: alert ? RED : GOLD },
          empty && { backgroundColor: 'rgba(10,10,10,0.1)' },
        ]} />
      ))}
    </View>
  );
}

function trendOf(weeks) {
  if (!weeks?.some(Boolean)) return { glyph: '—', tone: 'flat' };
  const d = weeks[5] - weeks[4];
  if (d > 0) return { glyph: '↑', tone: 'up' };
  if (d < 0) return { glyph: '↓', tone: 'down' };
  return { glyph: '—', tone: 'flat' };
}

// What's going on with a student, in one line.
function statusOf(s) {
  if (s.age_review_pending) return { text: 'Asked you to review their age', tone: 'warn', icon: 'person-circle-outline' };
  if (s.age_check === 'minor_pending') return { text: 'Awaiting verification', tone: 'muted', icon: 'lock-closed-outline' };
  if (s.consent_status === 'pending') return { text: 'Awaiting parent approval', tone: 'muted', icon: 'time-outline' };
  if (s.pendingQuestions > 0) {
    return { text: `${s.pendingQuestions} pending question${s.pendingQuestions > 1 ? 's' : ''}`, tone: 'warn', icon: 'chatbubble-outline' };
  }
  if (s.needsReview) return { text: 'Focus points to validate', tone: 'warn', icon: 'git-pull-request-outline' };
  if (s.status !== 'on_track') {
    const days = s.lastActiveDate ? Math.floor((Date.now() - new Date(s.lastActiveDate).getTime()) / 86400000) : null;
    return { text: days == null ? 'No practice yet' : `No practice in ${days}d`, tone: 'bad', icon: 'warning-outline' };
  }
  return { text: `Practised ${relative(s.lastActiveDate)}`, tone: 'ok' };
}

function Row({ person, readiness, weeks, status, metrics, quiet, alert, gold, reviewing, waiting, questions, onPress }) {
  const trend = trendOf(weeks);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        st.row,
        quiet && st.rowQuiet,
        reviewing && st.rowReview,
        waiting && { opacity: 0.5 },
        pressed && { transform: [{ scale: 0.985 }] },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${person.name}. ${status.text}`}
    >
      <Avatar person={person} readiness={readiness} alert={alert} gold={gold} size={quiet ? 38 : 44} />
      <View style={st.body}>
        <View style={st.nameRow}>
          <Text style={st.name} numberOfLines={1}>{person.name}</Text>
          {reviewing ? (
            <View style={st.reviewChip}><Text style={st.reviewChipT}>Tap to review</Text></View>
          ) : questions > 0 ? (
            <View style={st.qChip}>
              <Ionicons name="chatbubble-outline" size={9} color={GOLD_INK} />
              <Text style={st.qChipT}>{questions}</Text>
            </View>
          ) : null}
        </View>
        <View style={st.statusRow}>
          {status.icon ? (
            <Ionicons name={status.icon} size={12}
              color={status.tone === 'bad' ? RED : status.tone === 'warn' ? GOLD_INK : INK_62} />
          ) : null}
          <Text numberOfLines={1} style={[
            st.status,
            status.tone === 'bad' && st.statusBad,
            status.tone === 'warn' && st.statusWarn,
          ]}>{status.text}</Text>
        </View>
        {metrics ? <Text style={st.metrics} numberOfLines={1}>{metrics}</Text> : null}
      </View>
      {(
        <View style={st.right}>
          {readiness == null ? (
            <Text style={[st.pct, { color: 'rgba(10,10,10,0.34)' }]}>—</Text>
          ) : (
            <Text style={[st.pct, alert && { color: RED }]}>
              {readiness}%
              <Text style={[st.trend, trend.tone === 'down' && { color: RED }, trend.tone === 'flat' && { color: 'rgba(10,10,10,0.64)' }]}>
                {' '}{trend.glyph}
              </Text>
            </Text>
          )}
          <Sparkline weeks={weeks} alert={alert} />
        </View>
      )}
      <Ionicons name="chevron-forward" size={13} color="rgba(10,10,10,0.26)" />
    </Pressable>
  );
}

function GroupHead({ label, count, tone }) {
  return (
    <View style={st.groupHead}>
      <View style={[st.groupDot, { backgroundColor: tone === 'ok' ? GOLD : RED }]} />
      <Text style={st.groupLabel}>{label}</Text>
      <View style={st.groupRule} />
      <Text style={st.groupCount}>{count}</Text>
    </View>
  );
}

function RequestRow({ name, sub, onAccept, onReject, icon }) {
  return (
    <View style={st.requestRow}>
      {icon ? (
        <View style={st.reqIcon}><Ionicons name={icon} size={16} color="#FFFFFF" /></View>
      ) : (
        <View style={st.reqAv}><Text style={st.avText}>{initialsOf(name)}</Text></View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.name} numberOfLines={1}>{name}</Text>
        <Text style={st.status} numberOfLines={1}>{sub}</Text>
      </View>
      <TouchableOpacity style={st.rejectBtn} onPress={onReject} activeOpacity={0.8} accessibilityLabel="Decline">
        <Ionicons name="close" size={16} color={INK_62} />
      </TouchableOpacity>
      <TouchableOpacity style={st.acceptBtn} onPress={onAccept} activeOpacity={0.85} accessibilityLabel="Accept">
        <Ionicons name="checkmark" size={16} color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function CoachHomeScreen({ navigation, route }) {
  const { students, requests, initialLoading: loading, refresh, updateRequests } = useCoachData();

  // Lesson readiness % per student — the ring and the number on each row.
  // null: no private lesson yet, so nothing to be ready for.
  const [readinessByStudent, setReadinessByStudent] = useState({});
  const lastReadinessSigRef = useRef(null);
  useEffect(() => {
    if (!students || students.length === 0) {
      setReadinessByStudent({});
      return;
    }
    const signature = students.map((s) => s.id).sort().join('|');
    if (signature === lastReadinessSigRef.current) return;
    lastReadinessSigRef.current = signature;

    let alive = true;
    (async () => {
      try {
        const map = await getStudentsReadiness(students.map((s) => s.id));
        if (!alive) return;
        const byStudent = {};
        for (const s of students) {
          const r = map[s.id];
          byStudent[s.id] = r ? (r.percent ?? 0) : null;
        }
        setReadinessByStudent(byStudent);
      } catch {
        if (alive) setReadinessByStudent({});
      }
    })();
    return () => { alive = false; };
  }, [students]);

  const [tab, setTab] = useState('readiness'); // 'readiness' | 'last'
  const [view, setView] = useState('students'); // 'students' | 'couples'
  const [couples, setCouples] = useState([]);
  const [coupleReqs, setCoupleReqs] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Accepting asks the one thing the coach knows better than the sign-up form:
  // is this student 18 or over? A student who came with a parent is already
  // known to be under 18, so they're accepted straight away.
  async function handleAccept(requestId, fallback = {}) {
    const req = requests.find((r) => r.id === requestId) || fallback;
    const known = ['pending', 'granted'].includes(req.consentStatus);
    const accept = async (minor) => {
      await respondToCoachRequest(requestId, true);
      if (minor !== null && req.studentId) {
        try { await setStudentAge(req.studentId, minor); }
        catch (e) { Alert.alert('Accepted', `We couldn't save their age: ${e.message}`); }
      }
      updateRequests((prev) => prev.filter((r) => r.id !== requestId));
      refresh();
    };
    if (known) return accept(null);
    const first = (req.name || 'this student').split(/\s+/)[0];
    Alert.alert(
      `Is ${first} 18 or over?`,
      'It helps us keep younger dancers safe: under-18s need a parent’s permission before their lessons are captured.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Under 18', onPress: () => { accept(true).catch(() => {}); } },
        { text: '18 or over', onPress: () => { accept(false).catch(() => {}); } },
      ],
    );
  }
  async function handleReject(requestId) {
    await respondToCoachRequest(requestId, false);
    updateRequests((prev) => prev.filter((r) => r.id !== requestId));
  }

  // Pop an Accept/Decline modal for a new student request. Shared by the
  // notification-tap deep link AND the live realtime subscription below, so the
  // coach can say yes/no immediately either way. shownReqRef dedupes when both
  // fire for the same request.
  const shownReqRef = useRef(null);
  async function showCoachRequestModal(reqId, studentId) {
    if (!reqId || shownReqRef.current === reqId) return;
    shownReqRef.current = reqId;
    const listed = requests.find((r) => r.id === reqId);
    let name = listed?.name;
    let consentStatus = listed?.consentStatus;
    if (!listed && studentId) {
      const { data } = await supabase.from('users').select('name, consent_status').eq('id', studentId).maybeSingle();
      name = data?.name;
      consentStatus = data?.consent_status;
    }
    const fallback = { studentId, name, consentStatus };
    Alert.alert(
      'New student request',
      `${name || 'A student'} wants to add you as their coach.`,
      [
        { text: 'Later', style: 'cancel' },
        { text: 'Decline', style: 'destructive', onPress: () => handleReject(reqId).catch(() => {}) },
        { text: 'Accept', onPress: () => handleAccept(reqId, fallback).catch(() => {}) },
      ],
    );
  }
  const showModalRef = useRef(showCoachRequestModal);
  showModalRef.current = showCoachRequestModal;

  // Notification tap → deep link with the request id → modal.
  useEffect(() => {
    const reqId = route?.params?.coachRequestId;
    if (!reqId) return;
    const studentId = route?.params?.coachRequestStudentId;
    navigation.setParams({ coachRequestId: undefined, coachRequestStudentId: undefined });
    refresh(); // surface it in the list under the modal
    showCoachRequestModal(reqId, studentId);
  }, [route?.params?.coachRequestId]);

  // Realtime: a student linking while the coach sits on this screen → the row
  // appears live + the modal pops, with no push needed.
  useEffect(() => {
    let ch;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const myId = session?.user?.id;
      if (!myId) return;
      ch = supabase
        .channel(`coach-requests-${myId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'coach_requests', filter: `coach_id=eq.${myId}` },
          (payload) => {
            refresh();
            showModalRef.current(payload.new?.id, payload.new?.student_id);
          })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'coach_requests', filter: `coach_id=eq.${myId}` },
          () => { refresh(); })
        .subscribe();
    })();
    return () => { if (ch) supabase.removeChannel(ch); };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [cs, crs] = await Promise.all([
        getMyCouples().catch(() => []),
        getPendingCoupleCoachRequests().catch(() => []),
      ]);
      if (!alive) return;
      setCoupleReqs(crs);
      setCouples(cs); // show fast, then enrich with readiness + last private below
      const enriched = await Promise.all((cs || []).map(async (c) => {
        const r = await getCoupleReadiness(c.coupleId, null).catch(() => null);
        const days = r?.lastClassDate
          ? Math.floor((Date.now() - new Date(r.lastClassDate).getTime()) / 86400000)
          : null;
        return { ...c, lastPrivateDays: days, lastClassDate: r?.lastClassDate ?? null, readiness: r?.percent ?? null };
      }));
      if (alive) setCouples(enriched);
    })();
    return () => { alive = false; };
  }, []);

  async function handleAcceptCoupleCoach(reqId) {
    await respondToCoupleCoachRequest(reqId, true);
    setCoupleReqs((prev) => prev.filter((r) => r.id !== reqId));
    setCouples(await getMyCouples().catch(() => []));
  }
  async function handleRejectCoupleCoach(reqId) {
    await respondToCoupleCoachRequest(reqId, false);
    setCoupleReqs((prev) => prev.filter((r) => r.id !== reqId));
  }

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => (s.name || '').toLowerCase().includes(q));
  }, [students, searchQuery]);

  const attention = filteredStudents.filter((s) => s.status !== 'on_track');
  const onTrack = filteredStudents.filter((s) => s.status === 'on_track');
  const byLastPrivate = useMemo(() => [...filteredStudents].sort((a, b) => {
    const da = a.lastPrivateDays == null ? 99999 : a.lastPrivateDays;
    const db = b.lastPrivateDays == null ? 99999 : b.lastPrivateDays;
    return db - da; // oldest first
  }), [filteredStudents]);
  const couplesByLastPrivate = useMemo(() => [...couples].sort((a, b) => {
    const da = a.lastPrivateDays == null ? 99999 : a.lastPrivateDays;
    const db = b.lastPrivateDays == null ? 99999 : b.lastPrivateDays;
    return db - da;
  }), [couples]);

  const asked = students.reduce((n, s) => n + (s.pendingQuestions || 0), 0);
  const toValidate = students.reduce((n, s) => n + (s.pendingFocusCount || (s.needsReview ? 1 : 0)), 0);

  const openStudent = (s) =>
    guardStudent(s, () => navigation.navigate('StudentDetail', { studentId: s.id, studentName: s.name }), () => refresh());

  if (loading) return <CoachHomeScreenSkeleton />;

  function studentRow(s, quiet, showLast) {
    const readiness = readinessByStudent[s.id] ?? null;
    const status = statusOf(s);
    const open = s.activeFocuses || 0;
    const trained = s.fpSincePrivate || 0;
    const metrics = showLast
      ? `Last private · ${lessonDate(s.lastPrivateClassDate)}`
      : `${open} focus open · ${trained} trained since lesson`;
    return (
      <Row
        key={s.id}
        person={s}
        readiness={readiness}
        weeks={s.weeklySessions || [0, 0, 0, 0, 0, 0]}
        status={status}
        metrics={metrics}
        quiet={quiet}
        alert={status.tone === 'bad'}
        gold={s.status === 'on_track'}
        reviewing={!!s.age_review_pending}
        waiting={s.age_check === 'minor_pending' && !s.age_review_pending}
        questions={s.pendingQuestions || 0}
        onPress={() => openStudent(s)}
      />
    );
  }

  const isStudents = view === 'students';
  const total = isStudents ? students.length : couples.length;
  const ready = isStudents ? onTrack.length : couples.filter((c) => (c.readiness ?? 0) >= 50).length;
  const behind = total - ready;

  return (
    <View style={st.page}>
      {/* Fixed: titles, summary and the Readiness | Last private lesson toggle.
          Only the roster below it scrolls. */}
      <View style={st.fixed}>
        {/* Students / Couples, and search */}
        <View style={st.titleRow}>
          <TouchableOpacity onPress={() => setView('students')} activeOpacity={0.7}>
            <Text style={[st.title, !isStudents && st.titleOff]}>Students</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setView('couples')} activeOpacity={0.7}>
            <Text style={[st.title, isStudents && st.titleOff]}>Couples</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          {isStudents && (
            <TouchableOpacity
              style={[st.iconBtn, searchOpen && st.iconBtnOn]}
              onPress={() => { setSearchOpen((v) => !v); if (searchOpen) setSearchQuery(''); }}
              activeOpacity={0.7}
              accessibilityLabel="Search students"
            >
              <Ionicons name="search" size={17} color={searchOpen ? '#FFFFFF' : INK} />
            </TouchableOpacity>
          )}
        </View>

        {searchOpen && isStudents && (
          <View style={st.search}>
            <Ionicons name="search" size={15} color={INK_62} />
            <TextInput style={st.searchInput} value={searchQuery} onChangeText={setSearchQuery}
              placeholder="Search students…" placeholderTextColor="rgba(10,10,10,0.4)" autoFocus clearButtonMode="while-editing" />
          </View>
        )}

        {/* Roster summary */}
        <View style={st.sum}>
          <View style={st.sumTop}>
            <Text style={st.sumCount}>{total}</Text>
            <Text style={st.sumLabel}>{isStudents ? 'Students' : 'Couples'}</Text>
          </View>
          {total > 0 && (
            <>
              <View style={st.bar}>
                {ready > 0 && <View style={[st.barSeg, { flex: ready, backgroundColor: GREEN }]} />}
                {behind > 0 && <View style={[st.barSeg, { flex: behind, backgroundColor: GOLD }]} />}
              </View>
              <View style={st.legend}>
                <View style={st.legendItem}><View style={[st.legendDot, { backgroundColor: GREEN }]} /><Text style={st.legendT}><Text style={st.legendB}>{ready}</Text> ready</Text></View>
                <View style={[st.legendItem, { marginLeft: 'auto' }]}><View style={[st.legendDot, { backgroundColor: GOLD }]} /><Text style={st.legendT}><Text style={st.legendB}>{behind}</Text> behind</Text></View>
              </View>
            </>
          )}
          {isStudents && (
            <View style={st.chips}>
              <TouchableOpacity style={[st.chip, asked === 0 && st.chipZero]} onPress={() => navigation.navigate('ActionNeeded')} activeOpacity={0.8}>
                <Text style={[st.chipN, asked === 0 && st.chipNZero]}>{asked}</Text>
                <Text style={st.chipL}>Asked</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.chip, toValidate > 0 && st.chipAlert]} onPress={() => navigation.navigate('ActionNeeded')} activeOpacity={0.8}>
                <Text style={[st.chipN, toValidate > 0 ? { color: RED } : st.chipNZero]}>{toValidate}</Text>
                <Text style={[st.chipL, toValidate > 0 && { color: '#8E3627' }]}>To validate</Text>
                {toValidate > 0 && <View style={st.chipDot} />}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Readiness | Last private lesson */}
        <View style={st.tabs}>
          {[['readiness', 'Readiness'], ['last', 'Last private lesson']].map(([key, label]) => (
            <TouchableOpacity key={key} style={[st.tab, tab === key && st.tabOn]} onPress={() => setTab(key)} activeOpacity={0.7}>
              <Text style={[st.tabT, tab === key && st.tabTOn]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Requests waiting on the coach */}
        {isStudents && requests.length > 0 && (
          <>
            <GroupHead label="Requests" count={requests.length} tone="ok" />
            <View style={st.rows}>
              {requests.map((r) => (
                <RequestRow key={r.id} name={r.name}
                  sub={r.consentStatus === 'pending' ? 'Awaiting parent approval'
                    : r.category === 'latin' ? 'Wants a Latin coach' : r.category === 'ballroom' ? 'Wants a Ballroom coach' : 'Wants to be coached'}
                  onAccept={() => handleAccept(r.id)} onReject={() => handleReject(r.id)} />
              ))}
            </View>
          </>
        )}
        {!isStudents && coupleReqs.length > 0 && (
          <>
            <GroupHead label="Requests" count={coupleReqs.length} tone="ok" />
            <View style={st.rows}>
              {coupleReqs.map((r) => (
                <RequestRow key={r.id} icon="people" name={r.coupleName} sub={`Wants you as their ${r.category} couple coach`}
                  onAccept={() => handleAcceptCoupleCoach(r.id)} onReject={() => handleRejectCoupleCoach(r.id)} />
              ))}
            </View>
          </>
        )}

        {isStudents ? (
          filteredStudents.length === 0 ? (
            <Text style={st.empty}>
              {searchQuery.trim() ? `Nobody matches “${searchQuery.trim()}”.` : 'No students yet. Share your invite code from your profile to add them.'}
            </Text>
          ) : tab === 'readiness' ? (
            <>
              {attention.length > 0 && (
                <>
                  <GroupHead label="Needs attention" count={attention.length} tone="bad" />
                  <View style={st.rows}>{attention.map((s) => studentRow(s, false, false))}</View>
                </>
              )}
              {onTrack.length > 0 && (
                <>
                  <GroupHead label="On track" count={onTrack.length} tone="ok" />
                  <View style={st.rows}>{onTrack.map((s) => studentRow(s, true, false))}</View>
                </>
              )}
            </>
          ) : (
            <>
              <GroupHead label="Longest since a private lesson" count={byLastPrivate.length} tone="bad" />
              <View style={st.rows}>{byLastPrivate.map((s) => studentRow(s, false, true))}</View>
            </>
          )
        ) : couples.length === 0 ? (
          <Text style={st.empty}>No couples yet. When a couple picks you as their couple coach, they’ll appear here.</Text>
        ) : (
          <>
            <GroupHead label={tab === 'last' ? 'Longest since a private lesson' : 'Couples'} count={couples.length} tone="ok" />
            <View style={st.rows}>
              {(tab === 'last' ? couplesByLastPrivate : couples).map((c) => (
                <Row
                  key={c.coupleId}
                  person={{ id: c.coupleId, name: c.name }}
                  readiness={c.readiness ?? null}
                  weeks={[0, 0, 0, 0, 0, 0]}
                  status={{ text: c.lastClassDate ? `Last private · ${lessonDate(c.lastClassDate)}` : 'No private lesson yet', tone: 'ok' }}
                  alert={false}
                  gold
                  onPress={() => navigation.navigate('CoupleDetail', { coupleId: c.coupleId, coupleName: c.name })}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  page: { flex: 1, backgroundColor: PAGE },
  fixed: { paddingHorizontal: Spacing.side },
  scroll: { paddingHorizontal: Spacing.side, paddingBottom: 120 },

  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 12 },
  title: { fontFamily: Fonts.ttBold, fontSize: 28, letterSpacing: -1.1, lineHeight: 32, color: INK },
  titleOff: { color: 'rgba(10,10,10,0.32)' },
  iconBtn: {
    width: 36, height: 36, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    shadowColor: INK, shadowOpacity: 0.07, shadowOffset: { width: 0, height: 1 }, shadowRadius: 2, elevation: 1,
  },
  iconBtnOn: { backgroundColor: INK },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, fontFamily: Fonts.ttRegular, fontSize: 14.5, color: INK, padding: 0 },

  sum: { marginTop: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: LINE, gap: 11 },
  sumTop: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  sumCount: { fontFamily: Fonts.ttBold, fontSize: 32, letterSpacing: -1.6, lineHeight: 32, color: INK },
  sumLabel: { fontFamily: Fonts.ttDemiBold, fontSize: 9.5, letterSpacing: 1.3, textTransform: 'uppercase', color: INK_62, paddingBottom: 4 },
  bar: { flexDirection: 'row', gap: 3, height: 9 },
  barSeg: { borderRadius: 3 },
  legend: { flexDirection: 'row', alignItems: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendT: { fontFamily: Fonts.ttRegular, fontSize: 10.5, color: INK_62 },
  legendB: { fontFamily: Fonts.ttBold, color: INK },
  chips: { flexDirection: 'row', gap: 8, paddingTop: 3 },
  chip: {
    flex: 1, backgroundColor: '#FFFFFF', borderRadius: 14, paddingVertical: 9, paddingHorizontal: 11, gap: 4,
    borderWidth: 1, borderColor: 'rgba(10,10,10,0.07)',
  },
  chipZero: {},
  chipAlert: { backgroundColor: '#FCF1EE', borderColor: 'rgba(168,65,47,0.28)' },
  chipN: { fontFamily: Fonts.ttBold, fontSize: 19, letterSpacing: -0.85, lineHeight: 20, color: INK },
  chipNZero: { color: 'rgba(10,10,10,0.34)' },
  chipL: { fontFamily: Fonts.ttDemiBold, fontSize: 9, letterSpacing: 0.9, textTransform: 'uppercase', color: INK_62 },
  chipDot: { position: 'absolute', top: -4, right: -4, width: 12, height: 12, borderRadius: 6, backgroundColor: '#D06A5A', borderWidth: 2.5, borderColor: PAGE },

  tabs: { flexDirection: 'row', marginTop: 16, borderBottomWidth: 1, borderBottomColor: LINE },
  tab: { flex: 1, alignItems: 'center', paddingBottom: 10, marginBottom: -1, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: INK },
  tabT: { fontFamily: Fonts.ttDemiBold, fontSize: 13.5, letterSpacing: -0.1, color: 'rgba(10,10,10,0.55)' },
  tabTOn: { color: INK },

  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 20, paddingBottom: 10, paddingHorizontal: 2 },
  groupDot: { width: 6, height: 6, borderRadius: 3 },
  groupLabel: { fontFamily: Fonts.ttDemiBold, fontSize: 9.5, letterSpacing: 1.5, textTransform: 'uppercase', color: INK_62 },
  groupRule: { flex: 1, height: 1, backgroundColor: LINE },
  groupCount: { fontFamily: Fonts.ttBold, fontSize: 12, color: INK },
  rows: { gap: 8 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 13,
    backgroundColor: '#FFFFFF', borderRadius: 17, borderWidth: 1, borderColor: 'rgba(10,10,10,0.06)',
  },
  rowQuiet: { backgroundColor: '#FBFAF7' },
  rowReview: { backgroundColor: '#FDF3D6', borderColor: GOLD, borderWidth: 1.5 },
  avInner: { position: 'absolute', top: 5, left: 5, backgroundColor: '#F4F2EC', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avFill: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  avText: { fontFamily: Fonts.ttBold, fontSize: 13, color: 'rgba(10,10,10,0.6)' },
  body: { flex: 1, minWidth: 0, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  name: { flexShrink: 1, fontFamily: Fonts.ttDemiBold, fontSize: 14.5, letterSpacing: -0.3, color: INK },
  qChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: '#FCEFC9' },
  qChipT: { fontFamily: Fonts.ttBold, fontSize: 10, color: GOLD_INK },
  reviewChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: GOLD },
  reviewChipT: { fontFamily: Fonts.ttBold, fontSize: 10, color: INK },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { flexShrink: 1, fontFamily: Fonts.ttRegular, fontSize: 11.5, color: INK_62 },
  statusBad: { fontFamily: Fonts.ttDemiBold, color: RED },
  statusWarn: { fontFamily: Fonts.ttDemiBold, color: GOLD_INK },
  metrics: { fontFamily: Fonts.ttRegular, fontSize: 10.5, color: INK_62, paddingTop: 2 },
  right: { width: 58, alignItems: 'flex-end', gap: 6 },
  pct: { fontFamily: Fonts.ttBold, fontSize: 16, letterSpacing: -0.6, color: INK },
  trend: { fontFamily: Fonts.ttBold, fontSize: 10, color: GOLD_INK },
  spark: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 16, width: '100%' },
  sparkBar: { flex: 1, borderRadius: 1.5, backgroundColor: 'rgba(10,10,10,0.16)' },

  requestRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 13,
    backgroundColor: '#FFFFFF', borderRadius: 17, borderWidth: 1, borderColor: 'rgba(232,181,48,0.45)',
  },
  reqAv: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F4F2EC', alignItems: 'center', justifyContent: 'center' },
  reqIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#2E4670', alignItems: 'center', justifyContent: 'center' },
  rejectBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F4F2EC', alignItems: 'center', justifyContent: 'center' },
  acceptBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: INK, alignItems: 'center', justifyContent: 'center' },

  empty: { paddingTop: 30, textAlign: 'center', fontFamily: Fonts.ttRegular, fontSize: 13, lineHeight: 19, color: 'rgba(10,10,10,0.6)' },
});
