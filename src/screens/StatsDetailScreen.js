// ─── Stats detail ────────────────────────────────────────────────────────────
// One screen, six subjects. Each drill-down opens on the SAME number the card
// carried — the card is the promise, this is the payoff — then a meter filled to
// this screen's own percentage, a note, and the sentence that interprets it.
//
// The bundle arrives in route params, already fetched by the dashboard, so the
// detail can never disagree with the card that opened it.
import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { Fonts } from '../theme';
import { openFocusSession } from '../utils/openFocusSession';

const C = {
  card: '#FFFFFF', tile: '#F4F2EC', ink: '#141311', ink2: '#3D3A34',
  mut: '#6B6656', faint: '#767061', line: 'rgba(20,19,17,0.10)',
  gold: '#E2AA20', goldEdge: '#A87A10', goldLine: '#C08A12', goldInk: '#8F6410',
  bar: '#CBC6BA', barEdge: '#8F8A7E', cellOffEdge: 'rgba(20,19,17,0.45)',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
const weekLabel = (iso) => {
  const a = new Date(iso);
  const b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 6);
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()} – ${b.getDate()} ${MONTHS[b.getMonth()]}`
    : `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
};

function Meter({ percent, plain }) {
  if (plain) return <View style={s.hairline} />;
  return (
    <View style={s.meter}>
      <View style={[s.meterFill, { width: `${Math.max(0, Math.min(100, percent || 0))}%` }]} />
    </View>
  );
}

function Card({ title, side, children }) {
  return (
    <View style={s.card}>
      {!!title && (
        <View style={s.chead}>
          <Text style={s.h2}>{title}</Text>
          {!!side && <Text style={s.side}>{side}</Text>}
        </View>
      )}
      {children}
    </View>
  );
}

function Row({ label, value, sub, first }) {
  return (
    <View style={[s.lrow, !first && s.lrowSep]}>
      <Text style={s.ll}>{label}</Text>
      <View style={s.lr}>
        <Text style={s.lv}>{value}</Text>
        {!!sub && <Text style={s.ls}>{sub}</Text>}
      </View>
    </View>
  );
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ─── One week, from the inside ───────────────────────────────────────────────
// The trend card can only say how many minutes a week holds. This says what they
// were made of — which days carried them, which focus points got the work, and
// whether a lesson landed in the middle of it.
function WeekCard({ week, goal, navigation }) {
  if (!week) return null;
  const { dayMinutes = [], dayIndex = 6, minutes = 0, sessions = 0, isCurrent } = week;
  const focusDone = week.focusDone || [];
  const lessons = week.lessons || [];
  const busiest = Math.max(1, ...dayMinutes);
  const short = Math.max(0, goal - minutes);

  return (
    <Card
      title={isCurrent ? 'This week' : weekLabel(week.week)}
      side={isCurrent ? weekLabel(week.week) : week.metGoal ? 'goal met' : minutes === 0 ? 'no practice' : 'below goal'}
    >
      <View style={s.days}>
        {DAYS.map((name, i) => {
          const m = dayMinutes[i] || 0;
          const ahead = i > dayIndex;              // the week has not reached this day
          return (
            <View key={name} style={s.day}>
              <Text style={[s.dayMin, !m && s.dayMinNone]}>{m > 0 ? m : ahead ? ' ' : '·'}</Text>
              <View style={s.dayTrack}>
                {m > 0 && <View style={[s.dayFill, { height: `${Math.max(7, (m / busiest) * 100)}%` }]} />}
              </View>
              <Text style={[s.dayName, i === dayIndex && isCurrent && s.dayNameNow]}>{name}</Text>
            </View>
          );
        })}
      </View>

      <Text style={[s.dayNote, minutes > 0 && short === 0 && s.dayNoteMet]}>
        {minutes === 0
          ? isCurrent ? 'Nothing logged yet this week.' : 'Nothing logged this week.'
          : short === 0
            ? `${minutes} min across ${sessions} ${sessions === 1 ? 'session' : 'sessions'} — goal met.`
            : `${minutes} min across ${sessions} ${sessions === 1 ? 'session' : 'sessions'} · ${short} min short of your goal.`}
      </Text>

      {focusDone.length > 0 && (
        <>
          <Text style={s.secLab}>What you trained</Text>
          {focusDone.map((f, i) => (
            <TouchableOpacity
              key={f.id}
              style={[s.fw, !i && s.fwFirst]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Train ${f.name} again. ${f.sessions} sessions, ${f.minutes} minutes.`}
              onPress={() => openFocusSession(navigation, f.id)}
            >
              <View style={s.fwText}>
                <Text style={s.fwName} numberOfLines={2}>{f.name}</Text>
                <Text style={s.fwMeta}>
                  {f.sessions} {f.sessions === 1 ? 'session' : 'sessions'} · {f.minutes} min
                </Text>
              </View>
              <Chevron />
            </TouchableOpacity>
          ))}
        </>
      )}

      {lessons.length > 0 && (
        <>
          <Text style={s.secLab}>{lessons.length === 1 ? 'Your lesson' : 'Your lessons'}</Text>
          {lessons.map((l, i) => (
            <TouchableOpacity
              key={l.id || i}
              style={[s.lzrow, !i && s.lzrowFirst]}
              activeOpacity={0.7}
              disabled={!l.id}
              accessibilityRole="button"
              accessibilityLabel={`${l.title || 'Untitled lesson'}, ${fmt(l.date)}. Opens the lesson.`}
              onPress={() => l.id && navigation.navigate('ClassDetail', { inputId: l.id })}
            >
              <Text style={s.lzd}>{fmt(l.date)}</Text>
              <View style={s.lzt}>
                <Text style={s.lzTitle}>{l.title || 'Untitled lesson'}</Text>
                {!!l.dance && <Text style={s.lzSub}>{l.dance}</Text>}
              </View>
              <Chevron />
            </TouchableOpacity>
          ))}
        </>
      )}

      {focusDone.length === 0 && lessons.length === 0 && minutes > 0 && (
        <Text style={s.secNote}>Practice logged without a focus point attached.</Text>
      )}
    </Card>
  );
}

// The history below feeds the card above: tapping a week opens it up there, and
// scrolls back to it, since by row eight the card is off the top of the screen.
function TrendBody({ trend, goal, peak, navigation, scrollRef }) {
  const [sel, setSel] = useState(trend.length - 1);
  const topY = useRef(0);
  const rows = [...trend].reverse();

  const choose = (i) => {
    setSel(i);
    scrollRef?.current?.scrollTo({ y: Math.max(0, topY.current - 8), animated: true });
  };

  return (
    <View onLayout={(e) => { topY.current = e.nativeEvent.layout.y; }}>
      <WeekCard week={trend[sel]} goal={goal} navigation={navigation} />

      <Card title="Week by week" side={`goal ${goal} min`}>
        {rows.map((t, i) => {
          const idx = trend.length - 1 - i;
          const on = idx === sel;
          return (
            <TouchableOpacity
              key={t.week}
              style={[s.wrow, !i && s.wrowFirst, on && s.wrowOn]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${weekLabel(t.week)}. ${t.minutes} minutes. ${t.metGoal ? 'Goal met' : 'Below goal'}. Shows the week above.`}
              onPress={() => choose(idx)}
            >
              <View style={s.wtop}>
                <Text style={[s.wd, (on || !i) && s.wdNow]}>{weekLabel(t.week)}</Text>
                <Text style={s.wv}>{t.minutes} min</Text>
              </View>
              <View style={[s.wtrack, on && s.wtrackOn]}>
                {t.minutes > 0 && (
                  <View style={[s.wfill, { width: `${(t.minutes / peak) * 100}%` }, t.metGoal && s.wfillOn]} />
                )}
                {/* where the goal sits on this same scale, so every bar is read against it */}
                <View style={[s.goalMark, { left: `${(goal / peak) * 100}%` }]} />
              </View>
              {/* the verdict in words: colour alone would not carry it */}
              <Text style={[s.wsub, t.metGoal && s.wsubMet]}>
                {t.metGoal
                  ? 'Goal met'
                  : t.minutes === 0
                    ? 'Nothing logged'
                    : `${goal - t.minutes} min short`}
              </Text>
            </TouchableOpacity>
          );
        })}
      </Card>
    </View>
  );
}

// ─── what each subject shows ─────────────────────────────────────────────────
function Chevron() {
  return (
    <Svg width={8} height={13} viewBox="0 0 8 13">
      <Path d="M1.5 1.5l5 5-5 5" stroke={C.faint} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

function build(kind, d, navigation, scrollRef) {
  const { readiness, trend, momentum, streakWeeks, weeksTrained, trendWeeks,
    dances, totalDanceSessions, sessionCount, totalMinutes,
    lessonCount, lessons, weeklyGoal = 60, weeksAtGoal = 0, thisWeek } = d;
  const focuses = readiness?.focuses || [];
  const left = focuses.reduce((a, f) => a + Math.max(0, (f.target ?? 0) - (f.done ?? 0)), 0);
  const peak = Math.max(1, weeklyGoal, ...trend.map((t) => t.minutes));

  switch (kind) {
    case 'readiness':
      return {
        title: 'Get ready',
        n: `${readiness?.percent ?? 0}%`, word: 'ready for next private',
        percent: readiness?.percent ?? 0,
        note: readiness?.lastClassDate ? `From your ${fmt(readiness.lastClassDate)} lesson` : '',
        intro: 'Every focus point your coach gives you needs a set number of training sessions before your next private — three for a critical one, two for the rest. Readiness is how many of those you have done.',
        say: left === 0
          ? 'Everything your coach asked for is trained.'
          : `${left} session${left > 1 ? 's' : ''} to go — about ${readiness?.minutesRemaining ?? 0} minutes.`,
        body: (
          <>
            <Card title="Your focus points" side={`${focuses.length} from last private`}>
              {focuses.map((f, i) => (
                <TouchableOpacity
                  key={f.focusPointId || i}
                  style={[s.fdet, !i && s.fdetFirst]}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Train ${f.name}. Trained ${f.done ?? 0} of ${f.target ?? 0}.`}
                  onPress={() => openFocusSession(navigation, f.focusPointId)}
                >
                  <View style={s.fdh}>
                    <Text style={s.fdn}>{f.name}</Text>
                    <View style={[s.tier, f.tier === 'critical' && s.tierCrit]}>
                      <Text style={[s.tierTxt, f.tier === 'critical' && s.tierTxtCrit]}>
                        {f.tier === 'critical' ? 'Critical' : 'Important'}
                      </Text>
                    </View>
                  </View>
                  <View style={s.pips}>
                    {Array.from({ length: f.target ?? 0 }).map((_, k) => (
                      <View key={k} style={[s.pip, k < (f.done ?? 0) && s.pipOn]} />
                    ))}
                    <Text style={s.pipTxt}>{f.done ?? 0} of {f.target ?? 0}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </Card>
            <Card title="The count">
              <Row first label="Sessions needed" value={String(focuses.reduce((a, f) => a + (f.target ?? 0), 0))} />
              <Row label="Sessions done" value={String(focuses.reduce((a, f) => a + Math.min(f.done ?? 0, f.target ?? 0), 0))}
                sub={`${readiness?.percent ?? 0}%`} />
            </Card>
          </>
        ),
      };

    case 'trend':
      return {
        title: 'Trend',
        n: String(weeksAtGoal), word: `of ${trendWeeks} weeks at your goal`,
        percent: Math.round((weeksAtGoal / Math.max(1, trendWeeks)) * 100),
        note: `Goal ${weeklyGoal} min a week · ${totalMinutes} min trained`,
        intro: 'Your weekly goal lives in Settings. A week counts when the minutes you trained reach it.',
        say: weeksTrained === 0
          ? 'No practice logged in this window yet.'
          : `You trained in ${weeksTrained} of the last ${trendWeeks} weeks.`,
        body: <TrendBody trend={trend} goal={weeklyGoal} peak={peak} navigation={navigation} scrollRef={scrollRef} />,
      };

    case 'momentum':
      return {
        title: 'Momentum',
        n: momentum.score === null ? '–' : String(momentum.score),
        word: momentum.band ? `out of 100 — ${momentum.band}` : 'not enough practice yet',
        percent: momentum.score ?? 0,
        note: 'Last 10 days against your 6-week baseline',
        say: momentum.score === null
          ? 'We need about three weeks of practice before this means anything.'
          : `You are training about ${momentum.acutePerWeek} days a week against a ${momentum.chronicPerWeek}-day baseline.`,
        body: (
          <>
            <Card title="What moves it">
              <Row first label="Last 10 days" value={`${momentum.acutePerWeek} days/week`} />
              <Row label="Six-week baseline" value={`${momentum.chronicPerWeek} days/week`} />
              <Row label="Ratio" value={`${momentum.ratio ?? '–'}×`} sub={momentum.score === null ? '' : `score ${momentum.score}`} />
              <Text style={s.read}>
                <Text style={s.readB}>Momentum counts days you trained, not minutes.</Text>{' '}
                Five sessions in one day move it exactly as much as one.
              </Text>
            </Card>
            <Card title="The bands">
              {[['Peaking', '80 – 100'], ['Building', '65 – 79'], ['Steady', '45 – 64'],
                ['Cooling', '25 – 44'], ['Dormant', '0 – 24']].map(([name, range], i) => (
                <View key={name} style={[s.brow, !i && s.browFirst]}>
                  <Text style={[s.bn, momentum.band === name && s.bnOn]}>{name}</Text>
                  {momentum.band === name && (
                    <View style={s.youChip}><Text style={s.youTxt}>YOU</Text></View>
                  )}
                  <Text style={s.br}>{range}</Text>
                </View>
              ))}
            </Card>
          </>
        ),
      };

    case 'streak':
      return {
        title: 'Streak',
        n: String(streakWeeks), word: streakWeeks === 1 ? 'week unbroken' : 'weeks unbroken',
        percent: trendWeeks ? (weeksTrained / trendWeeks) * 100 : 0,
        note: `${weeksTrained} of the last ${trendWeeks} weeks trained`,
        say: streakWeeks === 0
          ? 'Train once this week to start a run — one session is enough.'
          : 'A week counts as soon as you train once in it.',
        body: (
          <Card title="Week by week" side={`${trendWeeks} weeks`}>
            <View style={s.grid}>
              {trend.map((t) => (
                <View key={t.week} style={[s.cell, t.minutes > 0 && s.cellOn]} />
              ))}
            </View>
            <View style={s.legend}>
              <View style={s.legItem}><View style={[s.legSw, s.cellOn]} /><Text style={s.legTxt}>Trained</Text></View>
              <View style={s.legItem}><View style={s.legSw} /><Text style={s.legTxt}>Missed</Text></View>
            </View>
          </Card>
        ),
      };

    case 'dances':
      return {
        title: 'Where you train',
        n: String(totalDanceSessions), word: 'practice sessions',
        percent: dances.length ? (dances[0].sessions / totalDanceSessions) * 100 : 0,
        note: `Across ${dances.length} dance${dances.length > 1 ? 's' : ''}`,
        say: dances.length
          ? `${dances[0].name} is ${Math.round((dances[0].sessions / totalDanceSessions) * 100)}% of your practice.`
          : 'No tagged practice yet.',
        body: (
          <Card title="By dance" side={`${totalDanceSessions} sessions`}>
            {dances.map((d2, i) => (
              <View key={d2.name} style={[s.wrow, !i && s.wrowFirst]}>
                <View style={s.wtop}>
                  <Text style={[s.wd, s.wdNow]}>{d2.name}</Text>
                  <Text style={s.wv}>{d2.sessions} session{d2.sessions > 1 ? 's' : ''}</Text>
                </View>
                <View style={s.wtrack}>
                  <View style={[s.wfill, { width: `${(d2.sessions / dances[0].sessions) * 100}%` }, !i && s.wfillOn]} />
                </View>
                <Text style={s.wsub}>{Math.round((d2.sessions / totalDanceSessions) * 100)}% of your practice</Text>
              </View>
            ))}
          </Card>
        ),
      };

    default: // lessons
      return {
        title: 'Lessons',
        n: String(lessonCount), word: lessonCount === 1 ? 'lesson on record' : 'lessons on record',
        plain: true,
        note: lessons?.length ? `Most recent ${fmt(lessons[0].date)}` : '',
        say: 'Every private your coach recorded, newest first.',
        body: (
          <Card title="Lessons" side="newest first">
            {(lessons || []).map((l, i) => (
              <TouchableOpacity
                key={l.id || `${l.date}-${i}`}
                style={[s.lzrow, !i && s.lzrowFirst]}
                activeOpacity={0.7}
                disabled={!l.id}
                accessibilityRole="button"
                accessibilityLabel={`${l.title || 'Untitled lesson'}, ${fmt(l.date)}. Opens the lesson.`}
                onPress={() => l.id && navigation.navigate('ClassDetail', { inputId: l.id })}
              >
                <Text style={s.lzd}>{fmt(l.date)}</Text>
                <View style={s.lzt}>
                  <Text style={s.lzTitle}>{l.title || 'Untitled lesson'}</Text>
                  {!!l.dance && <Text style={s.lzSub}>{l.dance}</Text>}
                </View>
                <Chevron />
              </TouchableOpacity>
            ))}
          </Card>
        ),
      };
  }
}

export default function StatsDetailScreen({ route, navigation }) {
  const { kind, data, scope } = route.params || {};
  const scrollRef = useRef(null);            // declared before any early return
  if (!data) return null;
  const v = build(kind, data, navigation, scrollRef);

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={['#F7F4EC', '#FAF0D8', '#F7E4A8']}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.95, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <View style={s.nav}>
          <TouchableOpacity
            style={s.bk}
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Back to your profile"
          >
            <Svg width={9} height={15} viewBox="0 0 9 15">
              <Path d="M7 1.5l-5 6 5 6" stroke={C.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </Svg>
          </TouchableOpacity>
          <Text style={s.nt}>{v.title}</Text>
          {!!scope && <Text style={s.nsc}>· {scope}</Text>}
        </View>

        <ScrollView ref={scrollRef} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <View style={s.hero}>
            {!!v.intro && <Text style={s.intro}>{v.intro}</Text>}
            <View style={s.lede}>
              <Text style={s.heroNum} allowFontScaling={false}>{v.n}</Text>
              <Text style={s.heroWord}>{v.word}</Text>
            </View>
            <Meter percent={v.percent} plain={v.plain} />
            {!!v.note && <Text style={s.heroNote}>{v.note}</Text>}
            {!!v.say && <Text style={s.say}>{v.say}</Text>}
          </View>
          {v.body}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 },
  bk: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.card, shadowColor: '#282214', shadowOpacity: 0.10,
    shadowOffset: { width: 0, height: 4 }, shadowRadius: 10, elevation: 2,
  },
  nt: { fontFamily: Fonts.ttDemiBold, fontSize: 17, letterSpacing: -0.34, color: C.ink },
  nsc: { fontFamily: Fonts.ttRegular, fontSize: 13, color: C.mut },

  scroll: { paddingHorizontal: 20, paddingBottom: 48 },
  hero: { paddingBottom: 22 },
  intro: { fontFamily: Fonts.ttRegular, fontSize: 14.5, lineHeight: 21, color: C.mut, marginBottom: 16 },
  lede: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 9 },
  heroNum: { fontFamily: Fonts.ttExtraBold, fontSize: 40, lineHeight: 42, letterSpacing: -1.6, color: C.ink },
  heroWord: { fontFamily: Fonts.ttRegular, fontSize: 15, color: C.mut },
  heroNote: { fontFamily: Fonts.ttRegular, fontSize: 13, color: C.mut, textAlign: 'right', marginTop: 9 },
  say: { fontFamily: Fonts.ttRegular, fontSize: 16, lineHeight: 23, color: C.ink2, marginTop: 16 },

  meter: { height: 8, borderRadius: 99, backgroundColor: C.line, overflow: 'hidden', marginTop: 20 },
  meterFill: { height: '100%', borderRadius: 99, backgroundColor: C.goldLine },
  hairline: { height: 1, backgroundColor: C.line, marginTop: 22 },

  card: { backgroundColor: C.card, borderRadius: 22, padding: 18, marginBottom: 12 },
  chead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16 },
  h2: { fontFamily: Fonts.ttExtraBold, fontSize: 11.5, letterSpacing: 1.5, textTransform: 'uppercase', color: C.mut, flex: 1 },
  side: { fontFamily: Fonts.ttRegular, fontSize: 13, color: C.mut },
  read: { fontFamily: Fonts.ttRegular, fontSize: 14, lineHeight: 21, color: C.ink2, marginTop: 16 },
  readB: { fontFamily: Fonts.ttDemiBold, color: C.ink },

  lrow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, paddingVertical: 15 },
  lrowSep: { borderTopWidth: 1, borderTopColor: C.line },
  ll: { fontFamily: Fonts.ttRegular, fontSize: 14.5, color: C.mut },
  lr: { flex: 1, alignItems: 'flex-end' },
  lv: { fontFamily: Fonts.ttDemiBold, fontSize: 15.5, color: C.ink, textAlign: 'right' },
  ls: { fontFamily: Fonts.ttRegular, fontSize: 12.5, color: C.mut, marginTop: 2 },

  fdet: { paddingVertical: 16, borderTopWidth: 1, borderTopColor: C.line },
  fdetFirst: { borderTopWidth: 0, paddingTop: 0 },
  fdh: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  fdn: { fontFamily: Fonts.ttDemiBold, fontSize: 16, letterSpacing: -0.32, color: C.ink },
  tier: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6, backgroundColor: C.tile, borderWidth: 1, borderColor: C.line },
  tierCrit: { backgroundColor: '#F8E9C2', borderColor: 'rgba(192,138,18,0.34)' },
  tierTxt: { fontFamily: Fonts.ttMedium, fontSize: 11, letterSpacing: 1.1, color: C.mut },
  tierTxtCrit: { color: '#7F5A0B' },
  pips: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pip: { width: 30, height: 7, borderRadius: 99, backgroundColor: C.tile, borderWidth: 1, borderColor: C.line },
  pipOn: { backgroundColor: C.gold, borderColor: C.goldEdge },
  pipTxt: { fontFamily: Fonts.ttRegular, fontSize: 12.5, color: C.mut, marginLeft: 7 },

  wrow: { paddingVertical: 13, borderTopWidth: 1, borderTopColor: C.line },
  wrowFirst: { borderTopWidth: 0, paddingTop: 2 },
  wtop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 9 },
  wd: { fontFamily: Fonts.ttRegular, fontSize: 13.5, color: C.mut },
  wdNow: { fontFamily: Fonts.ttDemiBold, color: C.ink, fontSize: 14.5 },
  wv: { fontFamily: Fonts.ttDemiBold, fontSize: 14.5, color: C.ink },
  wtrack: { height: 10, borderRadius: 3, backgroundColor: C.tile },
  wfill: { height: '100%', borderRadius: 3, backgroundColor: C.bar, borderWidth: 1, borderColor: C.barEdge },
  wfillOn: { backgroundColor: C.gold, borderColor: C.goldEdge },
  goalMark: { position: 'absolute', top: -3, bottom: -3, width: 2, marginLeft: -2, borderRadius: 1, backgroundColor: C.ink },
  wsub: { fontFamily: Fonts.ttRegular, fontSize: 12, color: C.mut, marginTop: 8 },
  wsubMet: { fontFamily: Fonts.ttDemiBold, color: C.goldInk },
  wrowOn: { backgroundColor: C.tile, marginHorizontal: -18, paddingHorizontal: 18, paddingTop: 13 },
  wtrackOn: { backgroundColor: C.card },

  // ── one week, day by day ──
  days: { flexDirection: 'row', gap: 6 },
  day: { flex: 1, alignItems: 'center' },
  dayMin: { fontFamily: Fonts.ttDemiBold, fontSize: 11.5, color: C.ink, marginBottom: 6 },
  dayMinNone: { fontFamily: Fonts.ttRegular, color: C.faint },
  dayTrack: { width: '100%', height: 62, borderRadius: 5, backgroundColor: C.tile, justifyContent: 'flex-end', overflow: 'hidden' },
  dayFill: { width: '100%', borderRadius: 5, backgroundColor: C.bar, borderWidth: 1, borderColor: C.barEdge },
  dayName: { fontFamily: Fonts.ttRegular, fontSize: 11.5, color: C.mut, marginTop: 7 },
  dayNameNow: { fontFamily: Fonts.ttDemiBold, color: C.ink },
  dayNote: { fontFamily: Fonts.ttRegular, fontSize: 13.5, lineHeight: 19, color: C.mut, marginTop: 15 },
  dayNoteMet: { fontFamily: Fonts.ttDemiBold, color: C.goldInk },
  secLab: {
    fontFamily: Fonts.ttExtraBold, fontSize: 11.5, letterSpacing: 1.5, textTransform: 'uppercase',
    color: C.mut, marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.line, marginBottom: 12,
  },
  secNote: { fontFamily: Fonts.ttRegular, fontSize: 13, lineHeight: 19, color: C.mut, marginTop: 14 },
  fw: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingVertical: 13, borderTopWidth: 1, borderTopColor: C.line },
  fwFirst: { borderTopWidth: 0, paddingTop: 0 },
  fwText: { flex: 1, minWidth: 0 },
  fwName: { fontFamily: Fonts.ttDemiBold, fontSize: 14.5, color: C.ink },
  fwMeta: { fontFamily: Fonts.ttRegular, fontSize: 12.5, color: C.mut, marginTop: 3 },

  brow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.line },
  browFirst: { borderTopWidth: 0, paddingTop: 0 },
  bn: { flex: 1, fontFamily: Fonts.ttRegular, fontSize: 14.5, color: C.mut },
  bnOn: { fontFamily: Fonts.ttDemiBold, color: C.ink },
  br: { fontFamily: Fonts.ttRegular, fontSize: 13, color: C.mut },
  youChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, backgroundColor: '#F8E9C2', borderWidth: 1, borderColor: 'rgba(192,138,18,0.34)' },
  youTxt: { fontFamily: Fonts.ttDemiBold, fontSize: 11, letterSpacing: 1.1, color: '#7F5A0B' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cell: { width: '8.5%', aspectRatio: 1, borderRadius: 5, borderWidth: 1, borderColor: C.cellOffEdge },
  cellOn: { backgroundColor: C.gold, borderColor: C.goldEdge },
  legend: { flexDirection: 'row', gap: 16, marginTop: 16 },
  legItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  legSw: { width: 12, height: 12, borderRadius: 4, borderWidth: 1, borderColor: C.cellOffEdge },
  legTxt: { fontFamily: Fonts.ttRegular, fontSize: 12, color: C.mut },

  lzrow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.line },
  lzrowFirst: { borderTopWidth: 0, paddingTop: 0 },
  lzd: { width: 54, fontFamily: Fonts.ttRegular, fontSize: 12.5, color: C.mut, paddingTop: 2 },
  lzt: { flex: 1, minWidth: 0 },
  lzTitle: { fontFamily: Fonts.ttDemiBold, fontSize: 14.5, color: C.ink },
  lzSub: { fontFamily: Fonts.ttRegular, fontSize: 12.5, color: C.mut, marginTop: 3 },
});
