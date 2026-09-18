// ─── Coach ▸ Couple ─────────────────────────────────────────────────────────
// The student card's page, for two: how ready the couple is for their next
// lesson (the number, a notched gauge, sessions since and minutes left), the
// focus points they carry, and every session since that lesson.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Fonts, Spacing } from '../../theme';
import { supabase } from '../../services/supabase/client';
import { getCoupleDetail, getCoupleFocusPoints, getCoupleActivity } from '../../storage/coupleStorage';
import { Pulse, Bone, FadeIn } from '../../components/GroupSwitchSkeleton';
import {
  L, TopBar, PairAvatars, SectionHead, Card, TierChip, TimelineRow, Empty, dayLabel,
} from '../../components/coach/LessonUI';

const INK = L.INK;
const INK_62 = L.INK_62;
const LINE = L.LINE;
const PAGE = L.PAGE;
const GOLD = L.GOLD;

function Gauge({ percent }) {
  const p = Math.max(0, Math.min(100, percent || 0));
  return (
    <View style={st.gauge}>
      <View style={[st.gaugeFill, { width: `${p}%` }]} />
      {Array.from({ length: 9 }).map((_, i) => (
        <View key={i} style={[st.gaugeNotch, { left: `${(i + 1) * 10}%` }]} />
      ))}
    </View>
  );
}

// A focus the couple carries: its tier, and how far they've got with it.
function FocusRow({ f, first }) {
  const done = f.done || 0;
  const target = f.target || 0;
  const complete = target > 0 && done >= target;
  return (
    <View style={[st.fp, !first && st.fpLine]}>
      <View style={[st.fpDot, complete && { backgroundColor: '#7FB77E' }]} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={st.fpName} numberOfLines={2}>{f.name}</Text>
        <View style={st.fpMetaRow}>
          {!!f.tier && <TierChip tier={f.tier} />}
          {!!f.meta && <Text style={st.fpMeta} numberOfLines={1}>{f.meta}</Text>}
        </View>
      </View>
      {!!f.progress && <Text style={st.fpProgress}>{f.progress}</Text>}
    </View>
  );
}

function CoupleSkeleton({ name, onBack }) {
  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <TopBar onBack={onBack} title={name || 'Couple'} />
      <View style={st.scroll}>
        <Pulse style={{ paddingTop: 16 }}><Bone w={190} h={28} r={6} /></Pulse>
        <Pulse style={[st.rd, { gap: 17 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 15 }}>
            <Bone w={96} h={46} r={10} />
            <Bone w={110} h={24} r={4} />
          </View>
          <Bone w="100%" h={11} r={4} />
          <View style={{ flexDirection: 'row', gap: 40 }}>
            <Bone w={70} h={30} r={5} />
            <Bone w={70} h={30} r={5} />
          </View>
        </Pulse>
        <Pulse style={{ gap: 9, paddingTop: 20 }}>
          <Bone w={90} h={9} r={4} />
          <Bone w="100%" h={150} r={17} />
        </Pulse>
      </View>
    </SafeAreaView>
  );
}

export default function CoupleDetailScreen({ route, navigation }) {
  const { coupleId, coupleName } = route?.params || {};
  const [detail, setDetail] = useState(null);
  const [fps, setFps] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [d, f, a] = await Promise.all([
      getCoupleDetail(coupleId).catch(() => null),
      getCoupleFocusPoints(coupleId).catch(() => []),
      getCoupleActivity(coupleId).catch(() => []),
    ]);
    setDetail(d); setFps(f); setActivity(a); setLoading(false);
  }, [coupleId]);

  useEffect(() => { reload(); }, [reload]);

  // The partner's phone writes to these tables too — the page follows along.
  useEffect(() => {
    if (!coupleId) return undefined;
    const ch = supabase
      .channel(`couple-detail-${coupleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'couple_focus_points', filter: `couple_id=eq.${coupleId}` }, () => reload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'couple_practice_logs', filter: `couple_id=eq.${coupleId}` }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [coupleId, reload]);

  if (loading) return <CoupleSkeleton name={coupleName} onBack={() => navigation.goBack()} />;

  const readiness = detail?.readiness || null;
  const hasReadiness = !!readiness;
  const pct = readiness?.percent ?? 0;
  const lastClassDate = readiness?.lastClassDate || null;
  const leader = detail?.dancerA?.isLeader ? detail?.dancerA : detail?.dancerB;
  const leadName = (leader?.name || '').split(' ')[0];
  const styleLabel = [detail?.doesLatin && 'Latin', detail?.doesBallroom && 'Ballroom'].filter(Boolean).join(' · ');

  // Sessions since the lesson that set the current focus points (as readiness counts them).
  const sessions = (activity || []).filter(
    (x) => !lastClassDate || new Date(x.completedAt) >= new Date(lastClassDate),
  );
  const minutes = sessions.reduce((sum, x) => sum + (x.durationMinutes || 0), 0);

  // The carryover first (it has tiers and targets); otherwise what they're on.
  const doneById = {};
  (readiness?.focuses || []).forEach((f) => { doneById[f.focusPointId] = f.done ?? 0; });
  const focusRows = hasReadiness && (readiness.focuses || []).length > 0
    ? readiness.focuses.map((f) => ({
        id: f.focusPointId, name: f.name, tier: f.tier, done: f.done, target: f.target,
        progress: `${f.done ?? 0}/${f.target ?? 0}`, meta: 'from the last lesson',
      }))
    : (fps || []).slice(0, 6).map((f) => ({
        id: f.id, name: f.name, tier: f.tier, done: doneById[f.id] ?? f.practice_count ?? 0, target: 0,
        progress: `${doneById[f.id] ?? f.practice_count ?? 0}×`, meta: f.subtitle || null,
      }));

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <TopBar
        onBack={() => navigation.goBack()}
        title={detail?.name || coupleName || 'Couple'}
        sub={[styleLabel || null, leadName ? `${leadName} leads` : null].filter(Boolean).join(' · ') || null}
        right={<PairAvatars a={detail?.dancerA} b={detail?.dancerB} size={36} ring={PAGE} />}
      />

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        <FadeIn>
          <Text style={st.name} numberOfLines={2}>{detail?.name || coupleName || 'Couple'}</Text>

          {/* ── Readiness ── */}
          <View style={st.rd}>
            <View style={st.l1}>
              <View style={st.big}>
                <Text style={st.bigN}>{hasReadiness ? pct : '—'}</Text>
                {hasReadiness && <Text style={st.bigPct}>%</Text>}
              </View>
              <Text style={st.lb}>
                {hasReadiness ? 'Ready for\n' : 'No couple lesson\n'}
                <Text style={st.lbB}>{hasReadiness ? 'next lesson' : 'logged yet'}</Text>
              </Text>
            </View>
            <Gauge percent={pct} />
            <View style={st.fig}>
              <View style={st.figCell}>
                <Text style={st.figN}>{sessions.length}×</Text>
                <Text style={st.figL}>{lastClassDate ? 'Since last lesson' : 'Logged together'}</Text>
              </View>
              <View style={[st.figCell, st.figCellLine]}>
                <Text style={st.figN}>{hasReadiness ? readiness.minutesRemaining : '—'}</Text>
                <Text style={st.figL}>Minutes left</Text>
              </View>
            </View>
          </View>

          <SectionHead
            title="Focus points"
            right={hasReadiness && (readiness.focuses || []).length > 0 ? 'from the last lesson' : (fps.length ? 'active' : null)}
          />
          {focusRows.length === 0 ? (
            <Card><Empty>No couple focus points yet. They appear once a couple lesson is processed.</Empty></Card>
          ) : (
            <Card>
              {focusRows.map((f, i) => <FocusRow key={f.id} f={f} first={i === 0} />)}
            </Card>
          )}

          <SectionHead
            title="Activity"
            right={sessions.length > 0 ? `${sessions.length} session${sessions.length === 1 ? '' : 's'}${minutes ? ` · ${minutes} min` : ''}` : null}
          />
          {sessions.length === 0 && !lastClassDate ? (
            <Empty>No couple sessions logged yet.</Empty>
          ) : (
            <View>
              {sessions.slice(0, 8).map((x, i) => (
                <TimelineRow
                  key={x.id}
                  first={i === 0}
                  last={!lastClassDate && i === Math.min(sessions.length, 8) - 1}
                  label={dayLabel(x.completedAt)}
                  title={x.focusName || 'Couple session'}
                  detail={[x.durationMinutes ? `${x.durationMinutes} min` : null, x.feeling || x.rating || null]
                    .filter(Boolean).join(' · ') || null}
                />
              ))}
              {!!lastClassDate && (
                <TimelineRow
                  lesson
                  first={sessions.length === 0}
                  label={`${dayLabel(lastClassDate)} · last lesson together`}
                  title="Couple lesson"
                  detail={(readiness.focuses || []).length
                    ? `${readiness.focuses.length} focus point${readiness.focuses.length === 1 ? '' : 's'} set`
                    : null}
                />
              )}
            </View>
          )}
        </FadeIn>
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAGE },
  scroll: { paddingHorizontal: Spacing.side, paddingBottom: 40 },
  name: { fontFamily: Fonts.bold, fontSize: 28, letterSpacing: -1.1, lineHeight: 32, color: INK, paddingTop: 16 },

  rd: { gap: 17, paddingTop: 22, paddingBottom: 19, borderBottomWidth: 1, borderBottomColor: LINE },
  l1: { flexDirection: 'row', alignItems: 'flex-end', gap: 15 },
  big: { flexDirection: 'row', alignItems: 'flex-start' },
  bigN: { fontFamily: Fonts.extraBold, fontSize: 58, letterSpacing: -3.5, lineHeight: 50, color: INK, fontVariant: ['tabular-nums'] },
  bigPct: { fontFamily: Fonts.bold, fontSize: 20, lineHeight: 22, color: 'rgba(10,10,10,0.55)', paddingLeft: 3, marginTop: 1 },
  lb: {
    flex: 1, paddingBottom: 2, fontFamily: Fonts.semiBold, fontSize: 10.5, letterSpacing: 1.5, lineHeight: 16,
    textTransform: 'uppercase', color: INK_62,
  },
  lbB: { color: INK },
  gauge: { height: 11, borderRadius: 4, overflow: 'hidden', backgroundColor: 'rgba(10,10,10,0.09)' },
  gaugeFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: GOLD, borderRadius: 4 },
  gaugeNotch: { position: 'absolute', top: 0, bottom: 0, width: 4, marginLeft: -2, backgroundColor: PAGE },
  fig: { flexDirection: 'row', alignItems: 'stretch' },
  figCell: { flex: 1 },
  figCellLine: { paddingLeft: 18, borderLeftWidth: 1, borderLeftColor: LINE },
  figN: { fontFamily: Fonts.bold, fontSize: 22, letterSpacing: -0.9, lineHeight: 24, color: INK, fontVariant: ['tabular-nums'] },
  figL: { fontFamily: Fonts.semiBold, fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase', color: INK_62, marginTop: 6 },

  fp: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 15 },
  fpLine: { borderTopWidth: 1, borderTopColor: 'rgba(10,10,10,0.07)' },
  fpDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: GOLD },
  fpName: { fontFamily: Fonts.semiBold, fontSize: 14, letterSpacing: -0.25, lineHeight: 18, color: INK },
  fpMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fpMeta: { flexShrink: 1, fontFamily: Fonts.regular, fontSize: 10.5, color: INK_62 },
  fpProgress: { fontFamily: Fonts.bold, fontSize: 13.5, color: L.GOLD_INK, fontVariant: ['tabular-nums'] },
});
