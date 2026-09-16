// ─── Profile dashboard ───────────────────────────────────────────────────────
// The student's Profile landing. Readiness leads, because it is the only number
// here they can still change before their next private; everything else is a
// record of a past they cannot.
//
// Every figure comes from getStudentDashboard(), which derives them all from one
// practice_logs query, so no two cards can disagree.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Polyline, Stop, Text as SvgText } from 'react-native-svg';
import { Fonts } from '../theme';
import { getStudentDashboard } from '../storage/dashboardStorage';
import { categoryFromStyle } from '../utils/danceCategory';
import { getMyCouple, getCoupleReadiness } from '../storage/coupleStorage';
import { openFocusSession } from '../utils/openFocusSession';

// The mock's warm world. Not in theme/Colors — that palette predates this screen
// and carries none of these. Contrast ratios noted where they were engineered.
const C = {
  card: '#FFFFFF',
  tile: '#F4F2EC',
  ink: '#141311',
  ink2: '#3D3A34',
  mut: '#6B6656',        // 5.7:1 on white
  faint: '#767061',      // 4.9:1 on white
  line: 'rgba(20,19,17,0.10)',
  gold: '#E2AA20',       // fill only — always paired with an edge, it is 2.1:1 alone
  goldEdge: '#A87A10',
  goldLine: '#C08A12',
  goldInk: '#8F6410',    // 5.25:1 on white — the one gold safe for text
  goldPale: '#F8E9C2',
  bar: '#CBC6BA',
  barEdge: '#8F8A7E',    // 3.1:1 on white — the grey marks must be perceivable too
  dark: '#231F18',
  onDark: '#A8A296',     // 5.3:1 on the dark card
  cellOffEdge: 'rgba(20,19,17,0.45)',
};

const fmtMonthDay = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`;
};

// ─── small pieces ────────────────────────────────────────────────────────────
function Meter({ percent, style, ...a11y }) {
  const w = Math.max(0, Math.min(100, percent || 0));
  return (
    <View style={[s.meter, style]} {...a11y}>
      <View style={[s.meterFill, { width: `${w}%` }]} />
    </View>
  );
}

function Seg({ options, value, onChange, label }) {
  return (
    <View style={s.seg} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <TouchableOpacity
            key={o.key}
            style={[s.segBtn, on && s.segBtnOn]}
            onPress={() => !on && onChange(o.key)}
            activeOpacity={0.8}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={o.label}
          >
            <Text style={[s.segTxt, on && s.segTxtOn]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Monday-start week -> "10 Aug - 16 Aug"
function weekRange(iso) {
  const a = new Date(iso);
  const b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 6);
  const f = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return `${f(a)} - ${f(b)}`;
}

function TrendChart({ trend }) {
  const [w, setW] = useState(0);
  const [sel, setSel] = useState(trend.length - 1);   // this week until they pick
  const H = 104;
  const AXIS = 46;                       // room for the right-hand scale
  const PAD_T = 10;                      // the top dot must not clip
  const INSET = 9;                       // ...nor the first and last, sideways
  const plotW = Math.max(0, w - AXIS);
  const plotH = H - PAD_T;
  const innerW = Math.max(0, plotW - INSET * 2);

  // Round the ceiling up to something a person would say, so the scale reads.
  const peak = Math.max(...trend.map((t) => t.minutes), 1);
  const step = peak <= 60 ? 15 : peak <= 150 ? 30 : peak <= 300 ? 60 : 120;
  const top = Math.ceil(peak / step) * step;
  const y = (v) => PAD_T + plotH - (v / top) * plotH;
  const x = (i) => INSET + (trend.length < 2 ? innerW / 2 : (i / (trend.length - 1)) * innerW);

  const pts = trend.map((t, i) => `${x(i)},${y(t.minutes)}`).join(' ');
  const area = `M ${x(0)},${PAD_T + plotH} L ${pts.split(' ').join(' L ')} L ${x(trend.length - 1)},${PAD_T + plotH} Z`;

  // A month label only where the month actually turns over.
  const ticks = [];
  trend.forEach((t, i) => {
    const m = new Date(t.week).getMonth();
    if (i === 0 || m !== new Date(trend[i - 1].week).getMonth()) ticks.push({ i, label: MONTHS[m] });
  });

  // Nearest point to the finger, so a tap anywhere in the plot lands somewhere.
  const pick = (evt) => {
    if (plotW <= 0 || trend.length < 2) return;
    const px = evt.nativeEvent.locationX - INSET;
    const i = Math.round((px / Math.max(1, innerW)) * (trend.length - 1));
    setSel(Math.max(0, Math.min(trend.length - 1, i)));
  };

  const cur = trend[sel] || trend[trend.length - 1];
  const isThisWeek = sel === trend.length - 1;

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Text style={s.selWeek}>{isThisWeek ? 'This week' : weekRange(cur.week)}</Text>
      <Text style={s.selStat}>
        {cur.minutes} min
        {'  ·  '}{cur.sessions} {cur.sessions === 1 ? 'session' : 'sessions'}
        {'  ·  '}{cur.focusPoints} {cur.focusPoints === 1 ? 'focus point' : 'focus points'}
      </Text>
      {w > 0 && (
        <View
          // Tap selects. Deliberately NOT claiming the move responder: the chart
          // spans the card, and stealing drags would stop the page scrolling.
          onStartShouldSetResponder={() => true}
          onResponderGrant={pick}
        >
        <Svg width={w} height={H + 18}>
          <Defs>
            <LinearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={C.gold} stopOpacity="0.32" />
              <Stop offset="1" stopColor={C.gold} stopOpacity="0.02" />
            </LinearGradient>
          </Defs>

          {[top, top / 2, 0].map((v) => (
            <React.Fragment key={v}>
              <Line x1="0" y1={y(v)} x2={plotW} y2={y(v)} stroke={C.line} strokeWidth={1} />
              <SvgText x={plotW + 8} y={y(v) + 4} fill={C.mut} fontSize={11} fontFamily={Fonts.ttRegular}>
                {`${Math.round(v)} min`}
              </SvgText>
            </React.Fragment>
          ))}

          <Path d={area} fill="url(#trendFill)" />
          <Polyline points={pts} fill="none" stroke={C.goldEdge} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

          {trend.map((t, i) => (
            <Circle
              key={t.week}
              cx={x(i)} cy={y(t.minutes)}
              r={i === trend.length - 1 ? 5 : 3.5}
              fill={i === trend.length - 1 ? C.gold : C.card}
              stroke={C.goldEdge}
              strokeWidth={2}
            />
          ))}

          {ticks.map((t) => (
            <SvgText
              key={t.i} x={x(t.i)} y={H + 14}
              fill={C.mut} fontSize={11} fontFamily={Fonts.ttRegular}
              textAnchor={t.i === 0 ? 'start' : 'middle'}
            >
              {t.label}
            </SvgText>
          ))}

          {/* the picked week, drawn last so it sits over the line */}
          <Line x1={x(sel)} y1={PAD_T} x2={x(sel)} y2={PAD_T + plotH} stroke={C.ink} strokeWidth={1.5} />
          <Circle cx={x(sel)} cy={y(cur.minutes)} r={6.5} fill={C.gold} stroke={C.ink} strokeWidth={2} />
        </Svg>
        </View>
      )}
    </View>
  );
}

function Chevron({ color = C.faint }) {
  return (
    <Svg width={8} height={13} viewBox="0 0 8 13">
      <Path d="M1.5 1.5l5 5-5 5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

// A focus point's progress: filled check when complete, arc while in progress.
function FocusMark({ done, target }) {
  const complete = target > 0 && done >= target;
  const pct = target > 0 ? Math.max(0, Math.min(1, done / target)) : 0;
  const r = 13.5;
  const circ = 2 * Math.PI * r;
  if (complete) {
    return (
      <Svg width={30} height={30} viewBox="0 0 30 30">
        <Circle cx={15} cy={15} r={14} fill={C.gold} />
        <Path d="M9 15.4l4 3.8 8-8.2" stroke={C.dark} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    );
  }
  return (
    <Svg width={30} height={30} viewBox="0 0 30 30">
      <Circle cx={15} cy={15} r={r} stroke="#3A342A" strokeWidth={2.6} fill="none" />
      {pct > 0 && (
        <Circle
          cx={15} cy={15} r={r} stroke={C.gold} strokeWidth={2.6} fill="none" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)} transform="rotate(-90 15 15)"
        />
      )}
    </Svg>
  );
}

function Card({ children, onPress, label, side, style, tight }) {
  const Wrap = onPress ? TouchableOpacity : View;
  return (
    <Wrap
      style={[s.card, style]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? label : undefined}
    >
      {!!label && (
        <View style={[s.chead, tight && s.cheadTight]}>
          <Text style={s.h2}>{label}</Text>
          {!!side && <Text style={s.side}>{side}</Text>}
          {!!onPress && <Chevron />}
        </View>
      )}
      {children}
    </Wrap>
  );
}

// ─── the screen ──────────────────────────────────────────────────────────────
// The style is chosen in the tab header (StyleTitle) and arrives as `category`.
// `mode` / `onChangeMode` let the screen hold the Solo | Couple scope (the
// header names the dancer or the pair); without them the dashboard keeps it.
export default function ProfileDashboard({ user, category, navigation, mode: modeProp, onChangeMode }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [couple, setCouple] = useState(null);        // the couple row, or null if solo
  const [modeState, setModeState] = useState('solo'); // 'solo' | 'couple'
  const mode = modeProp ?? modeState;
  const setMode = onChangeMode ?? setModeState;
  const [coupleReadiness, setCoupleReadiness] = useState(null);

  useEffect(() => {
    getMyCouple().then(setCouple).catch(() => setCouple(null));
  }, []);

  // The scope defaults to whatever style the profile says, but the header can
  // override it for this screen without writing back to the profile.
  const cat = category || categoryFromStyle(user?.dance_style) || 'latin';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getStudentDashboard(cat));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [cat]);

  useEffect(() => { load(); }, [load]);

  // Couple readiness is its own RPC; the retrospective cards are solo practice
  // and have no couple equivalent yet, so couple mode shows only what is real.
  useEffect(() => {
    if (mode !== 'couple' || !couple?.id) { setCoupleReadiness(null); return; }
    getCoupleReadiness(couple.id, cat).then(setCoupleReadiness).catch(() => setCoupleReadiness(null));
  }, [mode, couple?.id, cat]);

  const showSeg = !!couple;
  const scopeBar = !showSeg ? null : (
    <View style={[s.scope, s.scopeEnd]}>
      <Seg
        label="Practice mode"
        value={mode}
        onChange={setMode}
        options={[{ key: 'solo', label: 'Solo' }, { key: 'couple', label: 'Couple' }]}
      />
    </View>
  );

  // The scope stays put while the query runs — it is the control you just used.
  if (loading || !data) {
    return (
      <View style={s.root}>
        {scopeBar}
        <View style={s.loading}><ActivityIndicator color={C.goldInk} /></View>
      </View>
    );
  }

  const {
    readiness, weekMinutes, trend, momentum, streakWeeks,
    weeksTrained, trendWeeks, dances, totalDanceSessions, lessonCount, lastLesson, hasAnyData,
  } = data;

  const isCouple = mode === 'couple';
  const scopeLabel = `${cat === 'ballroom' ? 'Ballroom' : 'Latin'}${couple ? ` · ${isCouple ? 'Couple' : 'Solo'}` : ''}`;
  const openDetail = (kind) =>
    navigation?.navigate('StatsDetail', { kind, data, scope: scopeLabel });
  // Couple readiness is real; the retrospective cards below are solo practice
  // and have no couple equivalent, so couple mode hides them rather than
  // showing solo numbers under a Couple heading.
  const activeReadiness = isCouple ? coupleReadiness : readiness;
  const pct = activeReadiness?.percent ?? null;
  const focuses = activeReadiness?.focuses || [];
  const peak = Math.max(1, ...trend.map((t) => t.minutes));
  const topDance = dances[0];

  return (
    <View style={s.root}>
      {scopeBar}

      {/* ── hero: the one number they can still move ── */}
      <View style={s.hero}>
        {pct !== null ? (
          <>
            <View style={s.lede}>
              <Text style={s.heroNum} allowFontScaling={false}>{pct}%</Text>
              <Text style={s.heroWord}>ready for next private</Text>
            </View>
            <Meter
              percent={pct}
              style={s.heroMeter}
              accessibilityRole="image"
              accessibilityLabel={`${pct} percent ready for your next private lesson.`}
            />
          </>
        ) : (
          <>
            <View style={s.lede}>
              <Text style={s.heroNum} allowFontScaling={false}>{weekMinutes}</Text>
              <Text style={s.heroWord}>min this week</Text>
            </View>
            <View style={s.hairline} />
            <Text style={s.heroNote}>
              {isCouple
                ? 'No couple focus points yet'
                : hasAnyData ? 'No focus points to train yet' : 'Log your first practice to start tracking'}
            </Text>
          </>
        )}
        {pct !== null && !isCouple && <Text style={s.heroNote}>{weekMinutes} min this week</Text>}
      </View>

      {!isCouple && (<>
      {/* ── trend ── */}
      <Card
        label="Trend"
        tight
        onPress={() => openDetail('trend')}
      >
        {/* A chart of ten zeroes reads as a broken chart, not as an empty one. */}
        {trend.some((t) => t.minutes > 0) ? (
          <TrendChart trend={trend} />
        ) : (
          <View style={s.ghostWrap}>
            <View style={s.ghost}>
              {trend.map((t) => <View key={t.week} style={s.ghostBar} />)}
            </View>
            <Text style={s.ghostTxt}>Your next ten weeks will fill in here.</Text>
          </View>
        )}
      </Card>

      {/* ── readiness: the only dark surface, spent once ── */}
      <View style={s.sect}>
        <Text style={s.sectTxt}>Get ready for next private lesson</Text>
        <View style={s.sectRule} />
      </View>
      <TouchableOpacity
        style={[s.card, s.ready]}
        activeOpacity={0.9}
        onPress={() => openDetail('readiness')}
        accessibilityRole="button"
        accessibilityLabel={
          focuses.length
            ? `Focus points from your last lesson. ${focuses.map((f) => `${f.name} ${f.done} of ${f.target}`).join(', ')}.`
            : 'No focus points yet'
        }
      >
        {focuses.length > 0 ? (
          <>
            <View style={s.fhead}>
              <Text style={s.flab}>
                From your last lesson
              </Text>
              <Chevron color={C.onDark} />
            </View>
            {focuses.map((f, i) => (
              <TouchableOpacity
                key={f.focusPointId || i}
                style={[s.frow, i > 0 && s.frowSep, i === focuses.length - 1 && s.frowLast]}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Train ${f.name}. Trained ${f.done ?? 0} of ${f.target ?? 0}.`}
                onPress={() => openFocusSession(navigation, f.focusPointId)}
              >
                <FocusMark done={f.done ?? 0} target={f.target ?? 0} />
                <View style={s.fText}>
                  <Text style={s.fName} numberOfLines={1}>{f.name}</Text>
                  <Text style={s.fMeta}>{f.tier === 'critical' ? 'Critical focus' : 'Important focus'}</Text>
                </View>
                <Text style={[s.fCount, (f.done ?? 0) < (f.target ?? 0) && s.fCountTodo]}>
                  {f.done ?? 0}/{f.target ?? 0}
                </Text>
              </TouchableOpacity>
            ))}
          </>
        ) : (
          <View style={s.readyEmpty}>
            <Text style={s.fName}>No focus points yet</Text>
            <Text style={s.rfootTxt}>
              {isCouple
                ? 'They appear after your next recorded couple lesson.'
                : 'They appear after your next recorded lesson — your coach picks what to work on.'}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {/* ── momentum · streak ── */}
      <View style={s.duo}>
        <Card
          label="Momentum"
          style={s.duoCard}
          onPress={() => openDetail('momentum')}
        >
          <View style={s.tval}>
            <Text style={s.tnum} allowFontScaling={false}>{momentum.score ?? '–'}</Text>
            {momentum.score !== null && <Text style={s.tk}>/100</Text>}
          </View>
          <Meter percent={momentum.score ?? 0} style={s.tmeter} />
          <Text style={s.tfoot}>
            {momentum.band || 'Not enough practice yet'}
            {momentum.score !== null ? `\n${momentum.acutePerWeek} days/week now` : ''}
          </Text>
        </Card>
        <Card
          label="Streak"
          style={s.duoCard}
          onPress={() => openDetail('streak')}
        >
          <View style={s.tval}>
            <Text style={s.tnum} allowFontScaling={false}>{streakWeeks}</Text>
            <Text style={s.tk}>{streakWeeks === 1 ? 'week' : 'weeks'}</Text>
          </View>
          <View style={s.sq}>
            {trend.map((t) => (
              <View key={t.week} style={[s.sqCell, t.minutes > 0 && s.sqOn]} />
            ))}
          </View>
          <Text style={s.tfoot}>{weeksTrained} of the last {trendWeeks} weeks</Text>
        </Card>
      </View>

      {/* ── where you train ── */}
      {dances.length > 0 && (
        <Card
          label="Where you train"
          side={`${totalDanceSessions} sessions`}
          onPress={() => openDetail('dances')}
        >
          {dances.map((d, i) => (
            <View key={d.name} style={s.drow}>
              <Text style={[s.dn, d.sessions === 0 && s.dMuted]} numberOfLines={1}>{d.name}</Text>
              <View style={s.dt}>
                {d.sessions > 0 && (
                  <View style={[s.dtFill, { width: `${(d.sessions / topDance.sessions) * 100}%` }, i === 0 && s.dtTop]} />
                )}
              </View>
              <Text style={[s.dv, d.sessions === 0 && s.dMuted]}>{d.sessions}</Text>
            </View>
          ))}
          {topDance && totalDanceSessions > 0 && (
            <Text style={s.read}>
              <Text style={s.readB}>
                {topDance.name} is {Math.round((topDance.sessions / totalDanceSessions) * 100)}% of your practice.
              </Text>
            </Text>
          )}
        </Card>
      )}

      {/* ── lessons ── */}
      <Card
        label="Lessons & records"
        onPress={() => openDetail('lessons')}
      >
        {lastLesson && (
          <TouchableOpacity
            style={s.lrow}
            activeOpacity={0.7}
            disabled={!lastLesson.id}
            accessibilityRole="button"
            accessibilityLabel={`Last lesson: ${lastLesson.title || 'Untitled'}, ${fmtMonthDay(lastLesson.date)}. Opens the lesson.`}
            onPress={() => lastLesson.id && navigation?.navigate('ClassDetail', { inputId: lastLesson.id })}
          >
            <Text style={s.ll}>Last lesson</Text>
            <View style={s.lr}>
              <Text style={s.lv} numberOfLines={2}>{lastLesson.title || 'Untitled'}</Text>
              <Text style={s.ls}>{fmtMonthDay(lastLesson.date)}</Text>
            </View>
          </TouchableOpacity>
        )}
        <View style={[s.lrow, !!lastLesson && s.lrowSep]}>
          <Text style={s.ll}>Lessons on record</Text>
          <View style={s.lr}><Text style={s.lv}>{lessonCount}</Text></View>
        </View>
      </Card>
      </>)}

      {isCouple && (
        <Card label="Couple training">
          <Text style={s.read}>
            Trend, momentum, streak and your dance mix all count{' '}
            <Text style={s.readB}>solo practice</Text>, so they are not shown here yet.
            Couple sessions only count when you train together.
          </Text>
        </Card>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { paddingHorizontal: 0 },
  loading: { paddingVertical: 48, alignItems: 'center' },

  scope: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', rowGap: 10, paddingBottom: 18 },
  scopeEnd: { justifyContent: 'flex-end' },
  seg: { flexDirection: 'row', backgroundColor: C.tile, borderRadius: 99, borderWidth: 1, borderColor: C.line, padding: 2 },
  segBtn: { minHeight: 40, paddingHorizontal: 14, borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  segBtnOn: { backgroundColor: C.card },
  segTxt: { fontFamily: Fonts.ttMedium, fontSize: 13, color: C.mut },
  segTxtOn: { fontFamily: Fonts.ttDemiBold, color: C.ink },

  // hero — boxless, sits on the page itself
  hero: { paddingBottom: 22 },
  lede: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 9 },
  heroNum: { fontFamily: Fonts.ttExtraBold, fontSize: 40, lineHeight: 42, letterSpacing: -1.6, color: C.goldInk },
  heroWord: { fontFamily: Fonts.ttRegular, fontSize: 15, color: C.mut },
  heroMeter: { marginTop: 20 },
  heroNote: { fontFamily: Fonts.ttRegular, fontSize: 13, color: C.mut, textAlign: 'right', marginTop: 9 },
  hairline: { height: 1, backgroundColor: C.line, marginTop: 22 },

  // a bar is ALWAYS a meter filled to this screen's own percentage
  meter: { height: 8, borderRadius: 99, backgroundColor: C.line, overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: 99, backgroundColor: C.goldLine },

  card: { backgroundColor: C.card, borderRadius: 22, padding: 18, marginBottom: 12 },
  chead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16 },
  cheadTight: { marginBottom: 6 },
  h2: { fontFamily: Fonts.ttExtraBold, fontSize: 11.5, letterSpacing: 1.5, textTransform: 'uppercase', color: C.mut, flex: 1 },
  side: { fontFamily: Fonts.ttRegular, fontSize: 13, color: C.mut },

  selWeek: { fontFamily: Fonts.ttDemiBold, fontSize: 17, letterSpacing: -0.34, color: C.ink },
  selStat: { fontFamily: Fonts.ttRegular, fontSize: 13, color: C.mut, marginTop: 3, marginBottom: 14 },
  ghostWrap: { paddingTop: 2 },
  ghost: { flexDirection: 'row', alignItems: 'flex-end', height: 70, gap: 6 },
  ghostBar: { flex: 1, height: '100%', borderWidth: 1, borderStyle: 'dashed', borderColor: C.line, borderRadius: 3 },
  ghostTxt: { fontFamily: Fonts.ttRegular, fontSize: 13, color: C.mut, marginTop: 12 },

  sect: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 10, paddingBottom: 12 },
  sectTxt: { fontFamily: Fonts.ttDemiBold, fontSize: 18, letterSpacing: -0.36, color: C.ink },
  sectRule: { flex: 1, height: 1, backgroundColor: C.line },

  ready: { backgroundColor: C.dark, padding: 0, overflow: 'hidden' },
  readyEmpty: { padding: 20, gap: 8 },
  fhead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 4 },
  flab: { flex: 1, fontFamily: Fonts.ttExtraBold, fontSize: 11.5, letterSpacing: 1.6, textTransform: 'uppercase', color: C.gold },
  frow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 16 },
  frowSep: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.09)' },
  frowLast: { paddingBottom: 20 },     // matches the head's 20 now the footer is gone
  fText: { flex: 1, minWidth: 0 },
  fName: { fontFamily: Fonts.ttDemiBold, fontSize: 16.5, letterSpacing: -0.33, color: '#FFFFFF' },
  fMeta: { fontFamily: Fonts.ttRegular, fontSize: 12.5, color: C.onDark, marginTop: 3 },
  fCount: { fontFamily: Fonts.ttExtraBold, fontSize: 17, color: C.gold },
  fCountTodo: { color: C.onDark },
  rfootTxt: { flex: 1, fontFamily: Fonts.ttRegular, fontSize: 13.5, lineHeight: 19, color: C.onDark },

  duo: { flexDirection: 'row', gap: 12 },
  duoCard: { flex: 1, padding: 16 },
  tval: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 },
  tnum: { fontFamily: Fonts.ttExtraBold, fontSize: 34, letterSpacing: -1, color: C.ink },
  tk: { fontFamily: Fonts.ttRegular, fontSize: 13.5, color: C.mut },
  tmeter: { marginTop: 14, height: 6 },
  tfoot: { fontFamily: Fonts.ttRegular, fontSize: 12, lineHeight: 17, color: C.mut, marginTop: 12 },
  sq: { flexDirection: 'row', gap: 3, marginTop: 14 },
  sqCell: { flex: 1, height: 22, borderRadius: 3, borderWidth: 1, borderColor: C.cellOffEdge },
  sqOn: { backgroundColor: C.gold, borderColor: C.goldEdge },

  drow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  dn: { width: 74, fontFamily: Fonts.ttMedium, fontSize: 13, color: C.ink },
  dt: { flex: 1, height: 9, borderRadius: 3, backgroundColor: C.tile, overflow: 'hidden' },
  dtFill: { height: '100%', borderRadius: 3, backgroundColor: C.bar, borderWidth: 1, borderColor: C.barEdge },
  dtTop: { backgroundColor: C.gold, borderColor: C.goldEdge },
  dv: { width: 26, textAlign: 'right', fontFamily: Fonts.ttDemiBold, fontSize: 12.5, color: C.ink },
  dMuted: { color: C.mut },
  read: { fontFamily: Fonts.ttRegular, fontSize: 14, lineHeight: 21, color: C.ink2, marginTop: 16 },
  readB: { fontFamily: Fonts.ttDemiBold, color: C.ink },

  lrow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, paddingVertical: 15 },
  lrowSep: { borderTopWidth: 1, borderTopColor: C.line },
  ll: { fontFamily: Fonts.ttRegular, fontSize: 14.5, color: C.mut },
  lr: { flex: 1, alignItems: 'flex-end' },
  lv: { fontFamily: Fonts.ttDemiBold, fontSize: 15.5, color: C.ink, textAlign: 'right' },
  ls: { fontFamily: Fonts.ttRegular, fontSize: 12.5, color: C.mut, marginTop: 2 },
});
