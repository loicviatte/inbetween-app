import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle } from 'react-native-svg';
import { Fonts } from '../../theme';
import { supabase } from '../../services/supabase/client';
import { getCoupleDetail, getCoupleFocusPoints, getCoupleActivity } from '../../storage/coupleStorage';

// Palette mirrors StudentDetailScreen so the couple page looks identical, plus
// the couple blue used for the hero.
const C = {
  bg: '#FFFFFF', surface: '#F5F5F5', surfaceAlt: '#FAFAFA', dark: '#0E0E0E',
  orange: '#E8A838', green: '#4AAF52', red: '#D44545', text: '#0E0E0E',
  sub: '#8A8A8A', muted: '#B0B0B0', white: '#FFFFFF', cardBorder: 'rgba(0,0,0,0.05)',
  blue: '#2E4670', blueDark: '#16243C',
};

const TABS = [
  { key: 'information', label: 'Information' },
  { key: 'activity', label: 'Activity' },
  { key: 'actions', label: 'Actions' },
];

const TIER_LABEL = {
  critical: 'Critical focus',
  important: 'Important focus',
  supporting: 'Supporting focus',
};

function relativeDateShort(date) {
  if (!date) return '';
  const d = new Date(date);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + d.getDate();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function Card({ style, children }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

// Pair avatar — light circle with the dancer's initials (shows on the blue hero).
function Avatar({ name, size = 50 }) {
  const ini = (name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <View style={[styles.avatarWrap, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={styles.avatarTxt}>{ini}</Text>
    </View>
  );
}

// Gold readiness ring (identical to the student-detail one).
function ReadinessRing({ percent = 0, size = 72, stroke = 5 }) {
  const r = (size - stroke) / 2, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, percent)) / 100) * circ;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }], position: 'absolute' }}>
        <Circle cx={cx} cy={cy} r={r} stroke="rgba(255,255,255,0.10)" strokeWidth={stroke} fill="none" />
        <Circle cx={cx} cy={cy} r={r} stroke="#E8B530" strokeWidth={stroke} fill="none"
          strokeDasharray={`${filled} ${circ - filled}`} strokeLinecap="round" />
      </Svg>
      <Text style={styles.readyPct}>{Math.round(percent)}<Text style={styles.readyPctSm}>%</Text></Text>
    </View>
  );
}

// Mini progress ring — fills to done/target in gold (e.g. 1/3 → a third filled).
function MiniProgress({ done = 0, target = 0, size = 24, stroke = 2.5 }) {
  const r = (size - stroke) / 2, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const pct = target > 0 ? Math.max(0, Math.min(1, done / target)) : 0;
  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cy} r={r} stroke="rgba(255,255,255,0.18)" strokeWidth={stroke} fill="none" />
      {pct > 0 && (
        <Circle cx={cx} cy={cy} r={r} stroke="#E8B530" strokeWidth={stroke} fill="none"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`} />
      )}
    </Svg>
  );
}

function FocusReadyRow({ row, isLast }) {
  if (!row) return null;
  const labelText = `${TIER_LABEL[row.tier] || 'Focus'} · from last lesson`;
  return (
    <View style={[styles.readyFocusRow, !isLast && styles.readyFocusRowBorder]}>
      <MiniProgress done={row.done ?? 0} target={row.target ?? 0} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.readyFocusName} numberOfLines={1}>{row.name}</Text>
        <Text style={styles.readyFocusMeta} numberOfLines={1}>{labelText}</Text>
      </View>
      <Text style={styles.readyFocusProgress}>
        {row.done ?? 0}<Text style={styles.readyFocusProgressOf}>/{row.target ?? 0}</Text>
      </Text>
    </View>
  );
}

function timelineCfg(type) {
  switch (type) {
    case 'training': return { bg: 'rgba(232,168,56,0.08)', border: 'rgba(232,168,56,0.3)', icon: 'flame', color: C.orange };
    case 'class': return { bg: 'rgba(14,14,14,0.04)', border: 'rgba(14,14,14,0.12)', icon: 'book-outline', color: C.dark };
    default: return { bg: C.surfaceAlt, border: C.cardBorder, icon: 'ellipse', color: C.sub };
  }
}

function TimelineRow({ item }) {
  const cfg = timelineCfg(item.type);
  return (
    <View style={styles.tlRow}>
      <View style={[styles.tlCircle, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
        <Ionicons name={cfg.icon} size={13} color={cfg.color} />
      </View>
      <Card style={styles.tlCard}>
        <View style={styles.tlHeader}>
          <Text style={styles.tlDate}>{relativeDateShort(item.date)}</Text>
          {item.completed && (
            <View style={styles.tlDoneRow}>
              <Ionicons name="checkmark" size={11} color={C.green} />
              <Text style={styles.tlDoneText}>Done</Text>
            </View>
          )}
        </View>
        <Text style={styles.tlTitle}>{item.title}</Text>
        {!!item.detail && <Text style={styles.tlDetail}>{item.detail}</Text>}
        {!!item.notes && <View style={styles.tlNotes}><Text style={styles.tlNotesText}>{item.notes}</Text></View>}
      </Card>
    </View>
  );
}

export default function CoupleDetailScreen({ route, navigation }) {
  const { coupleId, coupleName } = route?.params || {};
  const [detail, setDetail] = useState(null);
  const [fps, setFps] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('information');

  const reload = useCallback(async () => {
    const [d, f, a] = await Promise.all([
      getCoupleDetail(coupleId).catch(() => null),
      getCoupleFocusPoints(coupleId).catch(() => []),
      getCoupleActivity(coupleId).catch(() => []),
    ]);
    setDetail(d); setFps(f); setActivity(a); setLoading(false);
  }, [coupleId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!coupleId) return;
    const ch = supabase
      .channel(`couple-detail-${coupleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'couple_focus_points', filter: `couple_id=eq.${coupleId}` }, () => reload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'couple_practice_logs', filter: `couple_id=eq.${coupleId}` }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [coupleId, reload]);

  const readiness = detail?.readiness || null;
  const readyPct = readiness?.percent ?? 0;
  const lastClassDate = readiness?.lastClassDate || null;
  const leadName = detail?.dancerA?.isLeader
    ? (detail?.dancerA?.name || '').split(' ')[0]
    : (detail?.dancerB?.name || '').split(' ')[0];
  const stylesStr = [detail?.doesLatin && 'Latin', detail?.doesBallroom && 'Ballroom'].filter(Boolean).join(' · ') || '—';

  // ── Active focus counts: prefer readiness "done" (since last lesson) ──
  const doneById = {};
  (readiness?.focuses || []).forEach((f) => { doneById[f.focusPointId] = f.done ?? 0; });

  // ── Activity: couple sessions → timeline items (newest first already) ──
  const timelineEvents = (activity || []).map((x) => ({
    id: x.id,
    type: 'training',
    date: x.completedAt,
    title: x.focusName || 'Couple session',
    detail: `${x.durationMinutes || 0} min${x.feeling || x.rating ? ` · ${x.feeling || x.rating}` : ''}`,
    completed: true,
  }));
  const sinceList = lastClassDate
    ? (activity || []).filter((x) => new Date(x.completedAt) >= new Date(lastClassDate))
    : (activity || []);
  const sessionsSince = sinceList.length;
  const totalMinSince = sinceList.reduce((sum, x) => sum + (x.durationMinutes || 0), 0);

  // ── Last couple class recap (built from readiness) ──
  const lastCoupleClass = (readiness && lastClassDate) ? {
    date: lastClassDate,
    title: 'Couple lesson',
    focusPoints: (readiness.focuses || []).map((f) => ({ id: f.focusPointId, name: f.name, trainedCount: f.done ?? 0 })),
  } : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.navHeader}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{coupleName || detail?.name || 'Couple'}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.blue} /></View>
      ) : (
        <>
          {/* ── Blue hero: pair avatars + name + couple readiness % ── */}
          <View style={styles.heroCard}>
            <View style={styles.heroRow}>
              <View style={styles.pairWrap}>
                <Avatar name={detail?.dancerA?.name} />
                <View style={{ marginLeft: -14 }}><Avatar name={detail?.dancerB?.name} /></View>
              </View>
              <View style={{ flex: 1, minWidth: 0, marginLeft: 14 }}>
                <Text style={styles.heroName} numberOfLines={1}>{detail?.name}</Text>
                <Text style={styles.heroSub} numberOfLines={1}>{stylesStr}  ·  {leadName} leads</Text>
              </View>
            </View>
            <View style={styles.heroReadyRow}>
              <Text style={styles.heroPct}>{readyPct}%</Text>
              <Text style={styles.heroReadyLbl}>couple readiness for next lesson</Text>
            </View>
          </View>

          {/* ── Sub-tabs ── */}
          <View style={styles.tabBar}>
            {TABS.map((t) => {
              const on = activeTab === t.key;
              return (
                <TouchableOpacity key={t.key} style={styles.tabBtn} activeOpacity={0.7} onPress={() => setActiveTab(t.key)}>
                  <Text style={[styles.tabLabel, on && styles.tabLabelOn]}>{t.label}</Text>
                  <View style={[styles.tabUnderline, on && styles.tabUnderlineOn]} />
                </TouchableOpacity>
              );
            })}
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            <View style={styles.tabContent}>

              {activeTab === 'information' && (
                <>
                  {/* Readiness card — dark brown, identical to the student's */}
                  <Card style={styles.readyCardOverride}>
                    <Text style={styles.readyEyebrow}>Couple's readiness for next lesson</Text>
                    <View style={styles.readyHeaderRow}>
                      <ReadinessRing percent={readyPct} />
                      <View style={{ flex: 1, minWidth: 0, marginLeft: 14 }}>
                        <Text style={styles.readyTitle}>
                          {!readiness ? 'No couple lesson logged yet.'
                            : readyPct >= 100 ? 'Ready for next lesson.'
                            : readyPct >= 50 ? 'Almost ready.' : 'Building up.'}
                        </Text>
                        <Text style={styles.readySubtitle}>
                          {!readiness ? 'Focus points will appear here once a couple lesson is processed.'
                            : readiness.minutesRemaining === 0 ? `All ${readiness.focuses.length} focus points trained.`
                            : `${readiness.focuses.length} focus point${readiness.focuses.length > 1 ? 's' : ''} · ~${readiness.minutesRemaining} min to go`}
                        </Text>
                      </View>
                    </View>
                    {(readiness?.focuses?.length || 0) > 0 && (
                      <>
                        <View style={styles.readyDivider} />
                        {readiness.focuses.map((f, i, arr) => (
                          <FocusReadyRow key={f.focusPointId} row={f} isLast={i === arr.length - 1} />
                        ))}
                      </>
                    )}
                  </Card>

                  {/* Active focus */}
                  {fps.length > 0 && (
                    <View style={{ marginTop: 16 }}>
                      <Text style={styles.sectionLabel}>ACTIVE FOCUS</Text>
                      {fps.slice(0, 6).map((f) => {
                        const wc = doneById[f.id] ?? f.practice_count ?? 0;
                        return (
                          <View key={f.id} style={styles.focusRow}>
                            <View style={styles.focusDot} />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.focusName}>{f.name}</Text>
                              {!!f.subtitle && <Text style={styles.focusSub} numberOfLines={1}>{f.subtitle}</Text>}
                            </View>
                            <View style={[styles.focusCount, wc === 0 && styles.focusCountStuck]}>
                              <Text style={[styles.focusCountText, wc === 0 && styles.focusCountTextStuck]}>{wc}×</Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </>
              )}

              {activeTab === 'activity' && (
                <>
                  <View style={styles.activityHeader}>
                    <Text style={styles.weekTitle}>
                      {sessionsSince} session{sessionsSince !== 1 ? 's' : ''}
                      {totalMinSince > 0 ? ` · ${totalMinSince} min` : ''}
                    </Text>
                    <Text style={styles.weekSub}>
                      Since last couple lesson{lastClassDate ? ` · ${relativeDateShort(lastClassDate)}` : ''}
                    </Text>
                  </View>

                  <View style={styles.tlContainer}>
                    <View style={styles.tlSpine} />
                    {timelineEvents.length === 0 ? (
                      <Text style={styles.emptyTl}>No couple sessions yet.</Text>
                    ) : (
                      timelineEvents.map((item) => <TimelineRow key={item.id} item={item} />)
                    )}
                  </View>

                  {/* Last class recap */}
                  {lastCoupleClass && (
                    <View style={styles.classRecap}>
                      <View style={styles.classRecapHeader}>
                        <View style={styles.classRecapBadge}>
                          <Text style={styles.classRecapBadgeText}>LAST COUPLE LESSON</Text>
                        </View>
                        <Text style={styles.classRecapDate}>{relativeDateShort(lastCoupleClass.date)}</Text>
                      </View>
                      <Text style={styles.classRecapTitle}>{lastCoupleClass.title}</Text>
                      {lastCoupleClass.focusPoints.length > 0 && (
                        <View style={styles.classRecapFPs}>
                          <Text style={styles.classRecapFPLabel}>Focus points</Text>
                          {lastCoupleClass.focusPoints.map((fp, i) => (
                            <View key={fp.id || i} style={styles.classRecapFPRow}>
                              <View style={[styles.classRecapFPDot, { backgroundColor: fp.trainedCount > 0 ? C.green : C.red }]} />
                              <Text style={styles.classRecapFPName} numberOfLines={1}>{fp.name}</Text>
                              <View style={[styles.classRecapFPCount, { backgroundColor: fp.trainedCount > 0 ? 'rgba(74,175,82,0.08)' : 'rgba(212,69,69,0.08)' }]}>
                                <Text style={[styles.classRecapFPCountText, { color: fp.trainedCount > 0 ? C.green : C.red }]}>{fp.trainedCount}x</Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </>
              )}

              {activeTab === 'actions' && (
                <View style={styles.actionsEmpty}>
                  <View style={styles.checkCircle}><Ionicons name="checkmark" size={26} color={C.green} /></View>
                  <Text style={styles.actionsTitle}>All clear</Text>
                  <Text style={styles.actionsMsg}>No couple actions need your attention right now.</Text>
                </View>
              )}

            </View>
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: Fonts.jakartaBold, fontSize: 17, color: C.text },

  // Blue hero
  heroCard: { backgroundColor: C.blue, borderRadius: 20, marginHorizontal: 24, marginTop: 8, padding: 18, shadowColor: C.blueDark, shadowOpacity: 0.3, shadowOffset: { width: 0, height: 10 }, shadowRadius: 20, elevation: 6 },
  heroRow: { flexDirection: 'row', alignItems: 'center' },
  pairWrap: { flexDirection: 'row', alignItems: 'center' },
  heroName: { fontFamily: Fonts.jakartaExtraBold, fontSize: 21, color: '#fff', letterSpacing: -0.5 },
  heroSub: { fontFamily: Fonts.jakartaRegular, fontSize: 12.5, color: 'rgba(255,255,255,0.6)', marginTop: 4 },
  heroReadyRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 16, gap: 8 },
  heroPct: { fontFamily: Fonts.jakartaExtraBold, fontSize: 30, color: '#fff', letterSpacing: -1 },
  heroReadyLbl: { fontFamily: Fonts.jakartaRegular, fontSize: 12, color: 'rgba(255,255,255,0.55)', flex: 1 },

  avatarWrap: { backgroundColor: '#DCE4F0', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.blue },
  avatarTxt: { fontFamily: Fonts.jakartaExtraBold, fontSize: 16, color: C.blue },

  // Tabs
  tabBar: { flexDirection: 'row', marginTop: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.cardBorder },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 11 },
  tabLabel: { fontFamily: Fonts.jakartaMedium, fontSize: 14, color: C.muted },
  tabLabelOn: { fontFamily: Fonts.jakartaBold, color: C.text },
  tabUnderline: { height: 2, width: 28, borderRadius: 1, marginTop: 8, backgroundColor: 'transparent' },
  tabUnderlineOn: { backgroundColor: C.blue },

  tabContent: { paddingHorizontal: 24, paddingTop: 20 },

  card: { backgroundColor: C.white, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: C.cardBorder, shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, elevation: 1 },

  // Readiness card (dark brown — identical to student)
  readyCardOverride: { backgroundColor: '#1F1810', borderWidth: 1, borderColor: 'rgba(240,194,74,0.28)', borderRadius: 20, paddingBottom: 6, overflow: 'hidden', shadowColor: '#0A0A0A', shadowOpacity: 0.5, shadowOffset: { width: 0, height: 14 }, shadowRadius: 22, elevation: 8 },
  readyEyebrow: { fontFamily: Fonts.jakartaBold, fontSize: 13, color: '#fff', letterSpacing: -0.1, marginBottom: 14 },
  readyHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  readyPct: { fontFamily: Fonts.jakartaExtraBold, fontSize: 22, color: '#fff', letterSpacing: -0.6 },
  readyPctSm: { fontFamily: Fonts.jakartaSemiBold, fontSize: 13, color: 'rgba(255,255,255,0.55)' },
  readyTitle: { fontFamily: Fonts.jakartaExtraBold, fontSize: 14.5, color: '#fff', letterSpacing: -0.2, lineHeight: 19 },
  readySubtitle: { fontFamily: Fonts.jakartaRegular, fontSize: 11.5, color: 'rgba(255,255,255,0.55)', marginTop: 5, lineHeight: 16 },
  readyDivider: { height: 0.5, backgroundColor: 'rgba(255,255,255,0.10)', marginHorizontal: -18 },
  readyFocusRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  readyFocusRowBorder: { borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.08)' },
  readyCheck: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.20)', alignItems: 'center', justifyContent: 'center' },
  readyCheckPartial: { borderColor: '#E8B530', backgroundColor: 'rgba(232,181,48,0.18)' },
  readyFocusName: { fontFamily: Fonts.jakartaExtraBold, fontSize: 13.5, color: '#fff', letterSpacing: -0.05, lineHeight: 16 },
  readyFocusMeta: { fontFamily: Fonts.jakartaRegular, fontSize: 10.5, color: 'rgba(255,255,255,0.55)', marginTop: 3 },
  readyFocusProgress: { fontFamily: Fonts.jakartaExtraBold, fontSize: 13, color: '#F6D27A', letterSpacing: -0.2 },
  readyFocusProgressOf: { fontFamily: Fonts.jakartaSemiBold, fontSize: 11, color: 'rgba(246,210,122,0.5)' },

  sectionLabel: { fontFamily: Fonts.jakartaExtraBold, fontSize: 10, color: C.muted, letterSpacing: 1, marginBottom: 10, marginTop: 4 },
  focusRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.white, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: C.cardBorder, marginBottom: 8, gap: 12 },
  focusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.orange },
  focusName: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: C.text },
  focusSub: { fontFamily: Fonts.jakartaRegular, fontSize: 12, color: C.sub, marginTop: 2 },
  focusCount: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(74,175,82,0.1)' },
  focusCountStuck: { backgroundColor: 'rgba(212,69,69,0.1)' },
  focusCountText: { fontFamily: Fonts.jakartaExtraBold, fontSize: 12, color: C.green },
  focusCountTextStuck: { color: C.red },

  // Activity
  activityHeader: { marginBottom: 18 },
  weekTitle: { fontFamily: Fonts.jakartaExtraBold, fontSize: 24, color: C.text, letterSpacing: -0.8 },
  weekSub: { fontFamily: Fonts.jakartaRegular, fontSize: 13, color: C.sub, marginTop: 2 },
  tlContainer: { position: 'relative' },
  tlSpine: { position: 'absolute', left: 13, top: 6, bottom: 6, width: 1.5, backgroundColor: C.surface, borderRadius: 1 },
  tlRow: { flexDirection: 'row', gap: 12, marginBottom: 10 },
  tlCircle: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  tlCard: { flex: 1, padding: 12 },
  tlHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tlDate: { fontFamily: Fonts.jakartaBold, fontSize: 10, color: C.muted, letterSpacing: 0.8, textTransform: 'uppercase' },
  tlDoneRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tlDoneText: { fontFamily: Fonts.jakartaBold, fontSize: 10, color: C.green },
  tlTitle: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: C.text, marginTop: 4, letterSpacing: -0.2 },
  tlDetail: { fontFamily: Fonts.jakartaRegular, fontSize: 12, color: C.sub, marginTop: 3, lineHeight: 17 },
  tlNotes: { marginTop: 10, padding: 10, backgroundColor: C.surfaceAlt, borderRadius: 10, borderLeftWidth: 2, borderLeftColor: C.orange },
  tlNotesText: { fontFamily: Fonts.jakartaRegular, fontSize: 12, color: C.sub, fontStyle: 'italic', lineHeight: 17 },
  emptyTl: { marginLeft: 50, fontFamily: Fonts.jakartaRegular, fontSize: 13, color: C.sub, paddingVertical: 20 },

  // Last class recap
  classRecap: { backgroundColor: C.surface, borderRadius: 16, padding: 16, marginTop: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: C.cardBorder },
  classRecapHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  classRecapBadge: { backgroundColor: 'rgba(232,168,56,0.12)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  classRecapBadgeText: { fontFamily: Fonts.jakartaExtraBold, fontSize: 9, letterSpacing: 0.8, color: C.orange },
  classRecapDate: { fontFamily: Fonts.jakartaMedium, fontSize: 10, color: C.sub },
  classRecapTitle: { fontFamily: Fonts.jakartaExtraBold, fontSize: 15, color: C.dark, letterSpacing: -0.2, marginBottom: 6 },
  classRecapFPs: { gap: 6 },
  classRecapFPLabel: { fontFamily: Fonts.jakartaExtraBold, fontSize: 10, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 },
  classRecapFPRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.white, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  classRecapFPDot: { width: 7, height: 7, borderRadius: 4 },
  classRecapFPName: { fontFamily: Fonts.jakartaSemiBold, fontSize: 13, color: C.dark, flex: 1 },
  classRecapFPCount: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  classRecapFPCountText: { fontFamily: Fonts.jakartaExtraBold, fontSize: 11 },

  // Actions (empty)
  actionsEmpty: { alignItems: 'center', paddingTop: 40, paddingHorizontal: 30 },
  checkCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(74,175,82,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  actionsTitle: { fontFamily: Fonts.jakartaExtraBold, fontSize: 18, color: C.text },
  actionsMsg: { fontFamily: Fonts.jakartaRegular, fontSize: 13.5, color: C.sub, textAlign: 'center', marginTop: 6, lineHeight: 19 },
});
