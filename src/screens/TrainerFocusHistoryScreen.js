import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fonts, Spacing } from '../theme';
import { supabase } from '../services/supabase/client';
import { GenericListSkeleton } from '../components/Skeleton';

const BG = '#0D0D12';
const CARD_BG = '#18181F';
const BORDER = 'rgba(255,255,255,0.08)';
const WHITE = '#FFFFFF';
const MUTED = 'rgba(255,255,255,0.55)';
const FAINT = 'rgba(255,255,255,0.35)';
const GREEN = '#4CAF50';
const RED = '#E84040';
const ORANGE = '#FF9D00';

const REASON_COLOR = {
  'practice log': GREEN,
  'coach signal +': GREEN,
  'coach signal -': RED,
  'class re-mention': ORANGE,
  'reactivated': ORANGE,
  'initial': MUTED,
  'recency decay': FAINT,
  'inaction gain': ORANGE,
  'created': WHITE,
};

const msPerDay = 86400000;

const STARTING_SCORES = { critical: 10, important: 7, supporting: 5 };

function buildCreationEvent(fp) {
  if (!fp) return null;
  const tier = fp.tier || 'important';
  const starting = STARTING_SCORES[tier] ?? 5;
  const tierMod = TIER_MODIFIER[tier] ?? 2;
  const recencyBonus = 3; // just mentioned → +3
  return {
    id: `created-${fp.id}`,
    focus_point_id: fp.id,
    reason: 'created',
    old_score: null,
    new_score: null,
    delta: starting + tierMod + recencyBonus,
    details: {
      starting,
      tier_modifier: tierMod,
      recency_bonus: recencyBonus,
      tier,
      synthesized: true,
    },
    created_at: fp.created_at,
  };
}

// Resolve the priority delta of a single event, preferring the DB-captured
// value but falling back to the client-side estimate from explainEvent().
function resolveEventDelta(ev, fpTier) {
  if (ev.reason === 'created') return ev.delta ?? 0;
  if (ev.delta != null) return Number(ev.delta);
  const est = explainEvent(ev, fpTier);
  return est.total ?? 0;
}

function buildRecencyEvents(fp) {
  if (!fp?.last_mentioned_at) return [];
  const mentioned = new Date(fp.last_mentioned_at);
  const now = new Date();
  const daysSince = Math.floor((now - mentioned) / msPerDay);

  const transitions = [
    { atDay: 1, fromBonus: 3, toBonus: 2 },
    { atDay: 4, fromBonus: 2, toBonus: 1 },
    { atDay: 7, fromBonus: 1, toBonus: 0 },
  ];

  return transitions
    .filter((t) => daysSince >= t.atDay)
    .map((t) => ({
      id: `recency-${fp.id}-${t.atDay}`,
      focus_point_id: fp.id,
      reason: 'recency decay',
      old_score: null,
      new_score: null,
      delta: t.toBonus - t.fromBonus,
      details: { from_bonus: t.fromBonus, to_bonus: t.toBonus, day: t.atDay, synthesized: true },
      created_at: new Date(mentioned.getTime() + t.atDay * msPerDay).toISOString(),
    }));
}

// Synthesize inaction-penalty gain events based on last_exposed_at + tier.
// Inaction kicks in after GRACE_DAYS[tier] and adds INACTION_DELTA[tier] per
// week, capped at +3. Transitions happen weekly starting at (grace + 7) days.
function buildInactionEvents(fp) {
  if (!fp) return [];
  const tier = fp.tier || 'supporting';
  const grace = GRACE_DAYS[tier];
  const delta = INACTION_DELTA[tier];
  if (!delta || grace >= 999) return [];

  const startRef = fp.last_exposed_at ? new Date(fp.last_exposed_at) : new Date(fp.created_at);
  const now = new Date();
  const daysSince = Math.floor((now - startRef) / msPerDay);

  const events = [];
  let cumulative = 0;
  for (let week = 1; week <= 3; week++) {
    const atDay = grace + 7 * week;
    if (daysSince < atDay) break;
    cumulative += delta;
    events.push({
      id: `inaction-${fp.id}-w${week}`,
      focus_point_id: fp.id,
      reason: 'inaction gain',
      old_score: null,
      new_score: null,
      delta,
      details: { week, tier, cumulative, day: atDay, synthesized: true },
      created_at: new Date(startRef.getTime() + atDay * msPerDay).toISOString(),
    });
  }
  return events;
}

// Match the server-side scoring constants in supabase/functions/_shared/yoda-score.ts
const PRACTICE_WEIGHT = { critical: 0.8, important: 1.0, supporting: 1.2 };
const TIER_MODIFIER = { critical: 3, important: 2, supporting: 1 };
const GRACE_DAYS = { critical: 4, important: 7, supporting: 999 };
const INACTION_DELTA = { critical: 1.0, important: 0.5, supporting: 0.0 };
const RATING_DELTA = { hard: 1.5, struggled: 1.0, okay: 0.0, good: -1.0, great: -2.0 };
const COACH_SIGNAL_POSITIVE = -4;
const COACH_SIGNAL_NEGATIVE = 2;
const MERGE_BOOST = 2;
const REACTIVATION_SCORE = 5;

function computeRecency(daysSince) {
  if (daysSince === 0) return 3;
  if (daysSince <= 3) return 2;
  if (daysSince <= 6) return 1;
  return 0;
}

function computeInactionPenalty(tier, daysSincePractice) {
  const grace = GRACE_DAYS[tier] ?? 999;
  const delta = INACTION_DELTA[tier] ?? 0;
  const weeks = Math.floor(Math.max(0, daysSincePractice - grace) / 7);
  return Math.min(3, delta * weeks);
}

function computePriorityParts(fp, now = new Date()) {
  if (!fp) return null;
  const tier = fp.tier || 'important';
  const refDate = fp.last_mentioned_at ? new Date(fp.last_mentioned_at) : new Date(fp.created_at);
  const daysSinceMentioned = Math.floor((now - refDate) / 86400000);
  const lastPracticed = fp.last_exposed_at ? new Date(fp.last_exposed_at) : null;
  const daysSincePractice = lastPracticed ? Math.floor((now - lastPracticed) / 86400000) : 999;

  const base = Number(fp.base_score ?? 0);
  const practicePenalty = -Number(fp.practice_count ?? 0) * (PRACTICE_WEIGHT[tier] ?? 1.0);
  const recency = computeRecency(daysSinceMentioned);
  const tierMod = TIER_MODIFIER[tier] ?? 2;
  const coachSig = Number(fp.coach_signal ?? 0);
  const inaction = computeInactionPenalty(tier, daysSincePractice);
  const total = Math.max(0, Math.min(20, base + practicePenalty + recency + tierMod + coachSig + inaction));
  return { base, practicePenalty, recency, tierMod, coachSig, inaction, total, daysSinceMentioned, daysSincePractice, tier };
}

function computePriority(fp, now = new Date()) {
  return computePriorityParts(fp, now)?.total ?? 0;
}

// For each event type, return the computed breakdown of priority delta.
// Returns { lines: string[], total: number|null }.
function explainEvent(h, fpTier) {
  const tier = fpTier || 'supporting';
  const weight = PRACTICE_WEIGHT[tier];

  if (h.reason === 'practice log') {
    const duration = h.details?.duration_minutes;
    const rating = h.details?.rating;
    if (duration == null || !rating) return { lines: [], total: null };
    const durationDelta = duration >= 15 ? -1 : -0.5;
    const ratingDelta = RATING_DELTA[rating] ?? 0;
    const baseScoreDelta = durationDelta + ratingDelta;
    const practiceCountDelta = -weight; // practice_count +=1, so priority -= weight
    const total = baseScoreDelta + practiceCountDelta;
    return {
      total,
      lines: [
        `duration ${duration}min → base ${fmt(durationDelta)}`,
        `rating "${rating}" → base ${fmt(ratingDelta)}`,
        `practice_count +1 → ${fmt(-weight)} (× ${tier} weight)`,
      ],
    };
  }

  if (h.reason === 'coach signal +') {
    // applyCoachSignal: base_score += -4, coach_signal += -4
    // priority = base + coach_signal → delta = -4 + -4 = -8
    return {
      total: COACH_SIGNAL_POSITIVE * 2,
      lines: [
        `base ${fmt(COACH_SIGNAL_POSITIVE)}`,
        `coach_signal ${fmt(COACH_SIGNAL_POSITIVE)} (priority includes coach_signal)`,
      ],
    };
  }
  if (h.reason === 'coach signal -') {
    return {
      total: COACH_SIGNAL_NEGATIVE * 2,
      lines: [
        `base ${fmt(COACH_SIGNAL_NEGATIVE)}`,
        `coach_signal ${fmt(COACH_SIGNAL_NEGATIVE)}`,
      ],
    };
  }

  if (h.reason === 'auto-merge' || h.reason === 'merge request') {
    return {
      total: MERGE_BOOST,
      lines: [
        `merge boost → base +${MERGE_BOOST}`,
        `practice_count reset to 0`,
      ],
    };
  }

  if (h.reason === 'reactivated') {
    return {
      total: null,
      lines: [
        `base → ${REACTIVATION_SCORE} (fixed)`,
        `practice_count → 0, coach_signal → 0`,
      ],
    };
  }

  if (h.reason === 'class re-mention') {
    return { total: null, lines: ['count +1 (not part of priority formula)', 'recency bonus resets to +3'] };
  }

  if (h.reason === 'recency decay') {
    const from = h.details?.from_bonus;
    const to = h.details?.to_bonus;
    const day = h.details?.day;
    if (from == null || to == null) return { lines: [], total: null };
    return {
      total: to - from,
      lines: [
        `day ${day} since last mention`,
        `recency bonus ${fmt(from)} → ${fmt(to)}`,
      ],
    };
  }

  if (h.reason === 'created') {
    const d = h.details || {};
    return {
      total: (d.starting ?? 0) + (d.tier_modifier ?? 0) + (d.recency_bonus ?? 0),
      lines: [
        `base +${d.starting ?? 0} (${d.tier ?? tier} starting score)`,
        `tier modifier +${d.tier_modifier ?? 0}`,
        `recency +${d.recency_bonus ?? 0} (just mentioned)`,
      ],
    };
  }

  if (h.reason === 'initial') {
    const base = Number(h.new_score ?? 0);
    const tierMod = TIER_MODIFIER[tier] ?? 2;
    const reconciled = h._reconciledDelta;
    const lines = [
      `base +${base.toFixed(1)} (snapshot at install)`,
      `tier modifier +${tierMod} (${tier})`,
    ];
    if (reconciled != null) {
      const unexplained = reconciled - base - tierMod;
      if (Math.abs(unexplained) >= 0.05) {
        const sign = unexplained > 0 ? '+' : '−';
        lines.push(
          `${sign}${Math.abs(unexplained).toFixed(1)} other (recency / coach signal / inaction / practices — state at install was not tracked)`
        );
      }
    }
    return { total: null, lines };
  }

  if (h.reason === 'inaction gain') {
    const d = h.details || {};
    return {
      total: Number(h.delta ?? d.delta ?? 0),
      lines: [
        `week ${d.week} of inaction (${d.day}d since practice)`,
        `${tier} inaction delta +${Number(h.delta ?? 0).toFixed(1)}`,
      ],
    };
  }

  if (h.reason?.startsWith('created by')) {
    // Legacy "created by coach-logged class" backfill rows — estimate same as 'created'.
    const starting = STARTING_SCORES[tier] ?? 5;
    const tierMod = TIER_MODIFIER[tier] ?? 2;
    return {
      total: starting + tierMod + 3,
      lines: [
        `base +${starting} (${tier} starting score)`,
        `tier +${tierMod}`,
        `recency +3 (fresh mention)`,
      ],
    };
  }

  return { total: null, lines: [] };
}

function fmt(n) {
  if (n === 0) return '±0';
  return n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
}

function formatDate(iso) {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const hhmm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today · ${hhmm}`;
  if (isYesterday) return `Yesterday · ${hhmm}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${hhmm}`;
}

export default function TrainerFocusHistoryScreen({ route, navigation }) {
  const { focusPointId, name } = route.params ?? {};
  const [fp, setFp] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [{ data: fpRow }, { data: hist }] = await Promise.all([
        supabase
          .from('focus_points')
          .select('id, name, subtitle, context, drill, tier, base_score, count, practice_count, coach_signal, status, created_at, last_mentioned_at, last_exposed_at, reactivated, user_id')
          .eq('id', focusPointId)
          .single(),
        supabase
          .from('focus_score_history')
          .select('*')
          .eq('focus_point_id', focusPointId)
          .order('created_at', { ascending: false })
          .limit(200),
      ]);
      setFp(fpRow);

      // Build the timeline:
      //   1. Real events from focus_score_history (base_score mutations + backfill).
      //      The "initial" seed row from the migration acts as the pre-trigger
      //      baseline — its delta is reconciled below so sums add up.
      //   2. Synthesized recency-decay transitions (day 1, 4, 7 after last mention).
      //   3. Synthesized inaction gains (weekly after grace period).
      // A synthetic "created" event is added ONLY for new FPs that have no
      // "initial" seed row (created after the trigger install).
      const real = hist ?? [];
      const hasInitial = real.some((h) => h.reason === 'initial');
      const recencyEvents = buildRecencyEvents(fpRow);
      const inactionEvents = buildInactionEvents(fpRow);
      const all = [...real, ...recencyEvents, ...inactionEvents];
      if (!hasInitial) {
        const created = buildCreationEvent(fpRow);
        if (created) all.push(created);
      }
      // Sort descending (newest first) for display.
      all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      // Reconcile: sum all non-anchor deltas, then set the anchor event's
      // delta = currentPriority − sum so the running balance ends exactly
      // on the current priority. The anchor is the "initial" row if it
      // exists, otherwise the synthetic "created" event.
      const currentPriority = computePriority(fpRow);
      const anchorIdx = all.findIndex((e) => e.reason === 'initial' || e.reason === 'created');
      if (anchorIdx !== -1) {
        const anchor = all[anchorIdx];
        const othersSum = all.reduce(
          (acc, e) => (e === anchor ? acc : acc + resolveEventDelta(e, fpRow?.tier)),
          0
        );
        all[anchorIdx] = { ...anchor, _reconciledDelta: currentPriority - othersSum };
      }

      // Compute running balance: iterate oldest→newest, accumulate delta.
      const oldestFirst = [...all].reverse();
      let balance = 0;
      const balanceById = new Map();
      for (const ev of oldestFirst) {
        const evDelta = ev._reconciledDelta != null
          ? ev._reconciledDelta
          : resolveEventDelta(ev, fpRow?.tier);
        balance += evDelta;
        balanceById.set(ev.id, balance);
      }
      setHistory(all.map((ev) => ({ ...ev, _balance: balanceById.get(ev.id) ?? null })));
    } catch (err) {
      console.warn('[TrainerFocusHistory] load error:', err);
    } finally {
      setLoading(false);
    }
  }, [focusPointId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <GenericListSkeleton rows={5} variant="detail" background={BG} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={WHITE} />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{fp?.name || name || 'Focus point'}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {/* Summary */}
        <View style={s.summaryCard}>
          <View style={s.summaryRow}>
            <View style={s.summaryCol}>
              <Text style={s.summaryLabel}>Priority</Text>
              <Text style={s.summaryValue}>{computePriority(fp).toFixed(1)}</Text>
            </View>
            <View style={s.summaryDivider} />
            <View style={s.summaryCol}>
              <Text style={s.summaryLabel}>Tier</Text>
              <Text style={s.summaryValue}>{(fp?.tier || '—').toUpperCase()}</Text>
            </View>
            <View style={s.summaryDivider} />
            <View style={s.summaryCol}>
              <Text style={s.summaryLabel}>Mentions</Text>
              <Text style={s.summaryValue}>{fp?.count ?? 0}</Text>
            </View>
            <View style={s.summaryDivider} />
            <View style={s.summaryCol}>
              <Text style={s.summaryLabel}>Practices</Text>
              <Text style={s.summaryValue}>{fp?.practice_count ?? 0}</Text>
            </View>
          </View>

          {/* Formula breakdown */}
          {!!fp && (() => {
            const p = computePriorityParts(fp);
            if (!p) return null;
            const term = (label, value, positive = true) => {
              const v = Math.abs(value);
              if (v < 0.05) return null;
              return (
                <Text style={s.formulaTerm}>
                  <Text style={s.formulaNum}>{positive ? '+' : '−'}{v.toFixed(1)}</Text>
                  <Text style={s.formulaCaption}> {label}</Text>
                </Text>
              );
            };
            return (
              <View style={s.formulaBox}>
                <Text style={s.formulaLabel}>PRIORITY = {p.total.toFixed(1)}</Text>
                <View style={s.formulaRow}>
                  <Text style={s.formulaTerm}>
                    <Text style={s.formulaNum}>{p.base.toFixed(1)}</Text>
                    <Text style={s.formulaCaption}> base</Text>
                  </Text>
                  {p.practicePenalty !== 0 && (
                    <Text style={s.formulaTerm}>
                      <Text style={s.formulaNum}> {p.practicePenalty.toFixed(1)}</Text>
                      <Text style={s.formulaCaption}> practice ({fp.practice_count}×{PRACTICE_WEIGHT[p.tier]})</Text>
                    </Text>
                  )}
                  {p.recency > 0 && term(`recency (${p.daysSinceMentioned}d since mention)`, p.recency)}
                  {term(`${p.tier} tier`, p.tierMod)}
                  {p.coachSig !== 0 && term('coach signal', p.coachSig, p.coachSig >= 0)}
                  {p.inaction > 0 && term(`inaction (${p.daysSincePractice}d)`, p.inaction)}
                </View>
              </View>
            );
          })()}

          {!!fp?.subtitle && <Text style={s.subtitle}>{fp.subtitle}</Text>}
        </View>

        <Text style={s.sectionLabel}>SCORE HISTORY</Text>

        {history.length === 0 ? (
          <Text style={s.empty}>No score changes recorded yet.</Text>
        ) : (
          history.map((h, idx) => {
            const hasScore = h.old_score !== null && h.new_score !== null;
            const hasReconciled = h._reconciledDelta != null;
            const hasDelta = !hasReconciled && h.delta !== null;
            const delta = Number(h.delta ?? 0);
            const breakdown = explainEvent(h, fp?.tier);
            const effectiveDelta = hasReconciled
              ? h._reconciledDelta
              : (hasDelta ? delta : breakdown.total);
            const deltaColor = effectiveDelta == null
              ? MUTED
              : effectiveDelta > 0 ? GREEN : effectiveDelta < 0 ? RED : MUTED;
            const deltaStr = effectiveDelta == null
              ? null
              : effectiveDelta === 0 ? '±0' : effectiveDelta > 0 ? `+${effectiveDelta.toFixed(1)}` : effectiveDelta.toFixed(1);
            const dotColor = REASON_COLOR[h.reason] || MUTED;
            const isLast = idx === history.length - 1;
            const isBackfilled = h.details?.backfilled === true;
            return (
              <View key={h.id} style={s.eventRow}>
                <View style={s.timelineCol}>
                  <View style={[s.timelineDot, { backgroundColor: dotColor }]} />
                  {!isLast && <View style={s.timelineLine} />}
                </View>
                <View style={s.eventBody}>
                  <View style={s.eventTopRow}>
                    <Text style={s.eventReason}>{h.reason || '—'}</Text>
                    <View style={s.eventNumsCol}>
                      {deltaStr != null && (
                        <Text style={[s.eventDelta, { color: deltaColor }]}>
                          {deltaStr}{!hasDelta && breakdown.total != null ? ' *' : ''}
                        </Text>
                      )}
                      {h._balance != null && (
                        <Text style={s.eventBalance}>priority {h._balance.toFixed(1)}</Text>
                      )}
                    </View>
                  </View>
                  <Text style={s.eventTime}>
                    {formatDate(h.created_at)}
                    {isBackfilled ? ' · historical' : ''}
                  </Text>

                  {hasScore && (
                    <Text style={s.eventScoreText}>
                      {Number(h.old_score).toFixed(1)} → {Number(h.new_score).toFixed(1)}
                    </Text>
                  )}

                  {breakdown.lines.length > 0 && (
                    <View style={s.breakdownBox}>
                      {breakdown.lines.map((line, i) => (
                        <View key={i} style={s.breakdownRow}>
                          <Text style={s.breakdownBullet}>·</Text>
                          <Text style={s.breakdownText}>{line}</Text>
                        </View>
                      ))}
                      {breakdown.total != null && !hasDelta && (
                        <Text style={s.breakdownFootnote}>
                          * estimated priority change (historical event, not captured live)
                        </Text>
                      )}
                    </View>
                  )}

                  {!!h.details && Object.keys(h.details).length > 0 && breakdown.lines.length === 0 && (
                    <DetailsSnippet details={h.details} />
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailsSnippet({ details }) {
  const pairs = [];
  const addIfChanged = (label, bKey, aKey) => {
    const b = details[bKey];
    const a = details[aKey];
    if (b !== undefined && a !== undefined && b !== a) {
      pairs.push(`${label}: ${b ?? '—'} → ${a ?? '—'}`);
    }
  };
  addIfChanged('count', 'count_before', 'count_after');
  addIfChanged('practice', 'practice_count_before', 'practice_count_after');
  addIfChanged('coach signal', 'coach_signal_before', 'coach_signal_after');
  addIfChanged('tier', 'tier_before', 'tier_after');
  addIfChanged('status', 'status_before', 'status_after');

  // Backfilled-event fields (from practice_logs / yoda_score_decisions)
  if (details.duration_minutes != null) pairs.push(`${details.duration_minutes} min`);
  if (details.rating) pairs.push(`rating: ${details.rating}`);
  if (details.fp_name && !pairs.some((p) => p.startsWith('fp:'))) pairs.push(`fp: ${details.fp_name}`);

  if (pairs.length === 0) return null;
  return (
    <View style={s.detailsRow}>
      {pairs.map((p, i) => (
        <Text key={i} style={s.detailsChip}>{p}</Text>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingTop: 8,
    paddingBottom: 14,
    gap: 12,
  },
  headerTitle: {
    flex: 1,
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: WHITE,
    letterSpacing: -0.3,
  },
  scroll: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 40,
  },
  summaryCard: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    marginBottom: 24,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryCol: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  summaryDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: BORDER,
  },
  summaryLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9,
    color: MUTED,
    letterSpacing: 1.1,
  },
  summaryValue: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: WHITE,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: MUTED,
    marginTop: 14,
    lineHeight: 18,
    textAlign: 'center',
  },
  formulaBox: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
  },
  formulaLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9,
    color: MUTED,
    letterSpacing: 1.1,
    marginBottom: 8,
  },
  formulaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  formulaTerm: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: MUTED,
    letterSpacing: 0.2,
    lineHeight: 20,
  },
  formulaNum: {
    fontFamily: Fonts.jakartaExtraBold,
    color: WHITE,
  },
  formulaOp: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 12,
    color: FAINT,
    lineHeight: 20,
  },
  formulaCaption: {
    color: FAINT,
    fontFamily: Fonts.jakartaMedium,
  },
  sectionLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: MUTED,
    letterSpacing: 1.2,
    marginBottom: 12,
  },
  empty: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: MUTED,
    textAlign: 'center',
    marginTop: 24,
  },
  eventRow: {
    flexDirection: 'row',
    gap: 14,
  },
  timelineCol: {
    alignItems: 'center',
    width: 10,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
  },
  timelineLine: {
    flex: 1,
    width: 1.5,
    backgroundColor: BORDER,
    marginTop: 3,
  },
  eventBody: {
    flex: 1,
    paddingBottom: 18,
  },
  eventTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  eventReason: {
    flex: 1,
    fontFamily: Fonts.jakartaBold,
    fontSize: 13.5,
    color: WHITE,
    letterSpacing: -0.1,
  },
  eventNumsCol: {
    alignItems: 'flex-end',
  },
  eventDelta: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    letterSpacing: 0.1,
  },
  eventBalance: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 10.5,
    color: FAINT,
    letterSpacing: 0.2,
    marginTop: 2,
  },
  backfillTag: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9,
    color: FAINT,
    letterSpacing: 1.2,
  },
  breakdownBox: {
    marginTop: 10,
    paddingLeft: 2,
    gap: 4,
  },
  breakdownRow: {
    flexDirection: 'row',
    gap: 8,
  },
  breakdownBullet: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
    color: FAINT,
    width: 8,
  },
  breakdownText: {
    flex: 1,
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11.5,
    color: MUTED,
    lineHeight: 17,
    letterSpacing: 0.1,
  },
  breakdownFootnote: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 10,
    color: FAINT,
    fontStyle: 'italic',
    marginTop: 4,
  },
  eventTime: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: FAINT,
    marginTop: 3,
    letterSpacing: 0.2,
  },
  eventScoreRow: {
    marginTop: 8,
    gap: 6,
  },
  eventScoreText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: MUTED,
    letterSpacing: 0.2,
  },
  detailsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  detailsChip: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 10.5,
    color: MUTED,
    letterSpacing: 0.2,
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
});
