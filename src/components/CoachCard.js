// ─── Coach card ─────────────────────────────────────────────────────────────
// What a prospective student reads before booking a first lesson. Rendered in
// exactly two places — the onboarding, where the coach builds it, and his own
// profile, where he checks what it says — so it lives here rather than being
// written twice and drifting apart on the first edit.
//
// `card` is the normalised shape: name, credential, essence, styleWords,
// teaches, worksWith, howITeach, myMethod, alloc, bestFor. `locked` blurs
// everything an account has not paid for yet, keeping the labels and the
// essence line legible.
//
// Two kinds of section. What he declared is there from day one. What he does
// is earned: "How I teach" opens after 4 captured lessons and "My vision" after
// 21, built from `observed` — counts from his real lessons (coach_card_observed)
// — so a prospect reads evidence, not a promise. Until then the section stays
// on the card, padlocked, with how far he has to go.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import Svg, { Path } from 'react-native-svg';
import { Fonts } from '../theme';

const T = { gold: '#E8B530', ink: '#0A0A0A' };
const D = {
  bg: '#0A0A0A', on: '#FFFFFF', on2: 'rgba(255,255,255,0.70)',
  // the comp greys locked rows to .45 white, which is exactly 4.50:1 — the
  // minimum with no margin. These are information, not disabled controls.
  on3: 'rgba(255,255,255,0.56)',
  line: 'rgba(255,255,255,0.12)',
  chip: 'rgba(255,255,255,0.10)', chipEdge: 'rgba(255,255,255,0.20)',
};
const AXES = ['Technique', 'Musicality', 'Mental', 'Performance'];
export const UNLOCK_HOW_I_TEACH = 4;
export const UNLOCK_MY_VISION = 21;
// the same category, named for a reader rather than a database
const CATEGORY_LABEL = { Technicality: 'Technique' };
const pct = (n, total) => (total ? Math.round((100 * n) / total) : 0);

function Tick({ color = T.gold, size = 14 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 13l4 4 10-10" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}
function LockIcon({ color = D.on3, size = 14 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 10h16v11H4z M8 10V7a4 4 0 0 1 8 0v3" stroke={color} strokeWidth={2}
        strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

// React Native has no CSS filter, so each block's content is veiled while its
// label stays sharp — a blurred block with no name is noise.
function Veil({ on, children, style }) {
  if (!on) return <View style={style}>{children}</View>;
  return (
    <View style={style}>
      {children}
      <BlurView intensity={26} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
    </View>
  );
}

// `preview` is for the onboarding only: a coach who has just built his card has
// captured nothing, so an earned section would be an empty padlock. With preview
// it shows the shape of what will be there, blurred past reading under the lock.
// Never pass it for a card a student reads — sample figures must not pass for his.
const SAMPLE_OBSERVED = [
  { k: 'Technique', v: 45 }, { k: 'Stability', v: 32 }, { k: 'Creativity', v: 23 },
  { k: 'Strength', v: 14 }, { k: 'Musicality', v: 9 },
];

export default function CoachCard({ card, locked, observed, preview }) {
  const c = card || {};
  const alloc = c.alloc && Object.keys(c.alloc).length ? c.alloc
    : { Technique: 40, Musicality: 25, Mental: 20, Performance: 15 };
  const initials = (c.name || '').trim().split(/\s+/).filter(Boolean)
    .map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  const lessons = observed?.lessons ?? 0;
  const students = observed?.students ?? 0;
  const cats = observed?.categories || [];
  const catTotal = cats.reduce((t, x) => t + x.count, 0);
  const topDances = (observed?.dances || []).slice(0, 3).map((d) => d.name);

  const Block = ({ n, title, children }) => (
    <View style={s.cblock}>
      <Text style={s.cnum}>{n} · {title}</Text>
      <Veil on={locked}>{children}</Veil>
    </View>
  );

  // A section earned by captured lessons: padlocked with its progress until
  // the threshold, then its content.
  const Earned = ({ n, title, after, sample, children }) => {
    if (lessons >= after) return <Block n={n} title={title}>{children}</Block>;
    return (
      <View style={s.cblock}>
        <View style={s.tierHead}>
          <Text style={s.cnum}>{n} · {title}</Text>
          <LockIcon size={13} />
        </View>
        {preview && !!sample && <Veil on style={s.tierSample}>{sample}</Veil>}
        <Text style={s.tierT}>Unlocks after {after} lessons</Text>
        <View style={s.tierRow}>
          <View style={s.cbarTrack}>
            <View style={[s.cbarFill, s.tierFill, { width: `${Math.min(100, pct(lessons, after))}%` }]} />
          </View>
          <Text style={s.tierCount}>{lessons} of {after}</Text>
        </View>
      </View>
    );
  };

  const Bars = ({ rows }) => (
    <View style={s.cbars}>
      {rows.map((r) => (
        <View key={r.k} style={s.cbar}>
          <Text style={s.cbarK} numberOfLines={1}>{r.k}</Text>
          <View style={s.cbarTrack}><View style={[s.cbarFill, { width: `${r.v}%` }]} /></View>
          <Text style={s.cbarV}>{r.v}%</Text>
        </View>
      ))}
    </View>
  );
  const observedRows = (limit) => cats.slice(0, limit)
    .map((x) => ({ k: CATEGORY_LABEL[x.name] || x.name, v: pct(x.count, catTotal) }));

  return (
    <View style={s.ccard}>
      <View style={s.chead}>
        <View style={s.cav}><Text style={s.cavT}>{initials || 'YN'}</Text></View>
        <View style={s.cwho}>
          <Text style={s.cname} numberOfLines={1}>{c.name || 'Your name'}</Text>
          <Text style={s.ccred} numberOfLines={1}>{c.credential || 'Dance coach'}</Text>
        </View>
      </View>

      {/* the one line kept sharp — built from his own words, so it is what
          proves the card is really his */}
      <Text style={s.cess}>{c.essence || ''}</Text>

      <Veil on={locked} style={s.cwords}>
        {(c.styleWords || []).map((w) => <View key={w} style={s.cword}><Text style={s.cwordT}>{w}</Text></View>)}
      </Veil>

      {/* ── declared: his from day one ── */}
      <Block n="01" title="What I teach">
        <View style={s.cchips}>
          {(c.teaches || []).map((d) => <View key={d} style={s.cchip}><Text style={s.cchipT}>{d}</Text></View>)}
        </View>
      </Block>
      <Block n="02" title="Who I work with">
        <View style={s.cchips}>
          {(c.worksWith && c.worksWith.length ? c.worksWith : ['Not set yet']).map((w) => (
            <View key={w} style={s.cchip}><Text style={s.cchipT}>{w}</Text></View>
          ))}
        </View>
      </Block>
      <Block n="03" title="My method"><Text style={s.cbody}>{c.myMethod || 'Not answered yet'}</Text></Block>
      <Block n="04" title="Best if you want to">
        <Text style={s.cbody}>{c.bestFor && c.bestFor.length ? c.bestFor.join(' · ') : '—'}</Text>
      </Block>

      {/* ── observed: earned by captured lessons ── */}
      <Earned n="05" title="How I teach" after={UNLOCK_HOW_I_TEACH} sample={(
        <>
          {!!c.howITeach && <Text style={s.cbody}>{c.howITeach}</Text>}
          <Text style={s.subLab}>What I correct most</Text>
          <Bars rows={SAMPLE_OBSERVED.slice(0, 3)} />
          <Text style={s.obsNote}>Mostly in {(c.teaches || []).slice(0, 2).join(' · ') || 'your main dances'}</Text>
        </>
      )}>
        {!!c.howITeach && <Text style={s.cbody}>{c.howITeach}</Text>}
        {catTotal > 0 ? (
          <>
            <Text style={s.subLab}>What I correct most · from {lessons} lessons</Text>
            <Bars rows={observedRows(3)} />
            {topDances.length > 0 && <Text style={s.obsNote}>Mostly in {topDances.join(' · ')}</Text>}
          </>
        ) : (
          <Text style={s.obsNote}>Not enough corrections captured yet.</Text>
        )}
      </Earned>

      <Earned n="06" title="My vision" after={UNLOCK_MY_VISION} sample={(
        <>
          <Text style={s.subLab}>Where I plan the hour to go</Text>
          <Bars rows={AXES.map((k) => ({ k, v: alloc[k] || 0 }))} />
          <Text style={[s.subLab, s.subLabGap]}>Where it actually goes</Text>
          <Bars rows={SAMPLE_OBSERVED} />
        </>
      )}>
        <Text style={s.subLab}>Where I plan the hour to go</Text>
        <Bars rows={AXES.map((k) => ({ k, v: alloc[k] || 0 }))} />
        <Text style={[s.subLab, s.subLabGap]}>
          Where it actually goes · {lessons} lessons{students ? `, ${students} students` : ''}
        </Text>
        {catTotal > 0 ? <Bars rows={observedRows(5)} /> : <Text style={s.obsNote}>Not enough corrections captured yet.</Text>}
      </Earned>

      <Block n="07" title="Track record">
        <View style={s.ctrack}>
          <View style={s.ctrow}>
            <Tick />
            <Text style={[s.ctrackT, s.ctrackOn]}>Verified InBetween Coach</Text>
          </View>
          {lessons > 0 && (
            <View style={s.ctrow}>
              <Tick />
              <Text style={[s.ctrackT, s.ctrackOn]}>
                {lessons} lesson{lessons === 1 ? '' : 's'} documented{students ? ` · ${students} student${students === 1 ? '' : 's'}` : ''}
              </Text>
            </View>
          )}
        </View>
      </Block>
      <Block n="08" title="How I work">
        <Text style={s.cbody}>
          Every lesson is captured. After each one, my students get their own focus points — exactly what I
          told them — so they always know what to train before they come back.
        </Text>
      </Block>

      <View style={s.cfoot}>
        <Veil on={locked} style={s.cbtn}><Text style={s.cbtnT}>Get in touch</Text></Veil>
        <Text style={s.cby}>COACH CARD BY INBETWEEN</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  ccard: { backgroundColor: D.bg, borderRadius: 18, padding: 20, gap: 14 },
  chead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cav: { width: 42, height: 42, borderRadius: 21, backgroundColor: T.gold, alignItems: 'center', justifyContent: 'center' },
  cavT: { fontFamily: Fonts.ttExtraBold, fontSize: 14, color: T.ink },
  cwho: { flex: 1, minWidth: 0, gap: 2 },
  cname: { fontFamily: Fonts.ttDemiBold, fontSize: 18, letterSpacing: -0.36, color: D.on },
  ccred: { fontFamily: Fonts.travelsRegular, fontSize: 12, color: D.on2 },
  cess: { fontFamily: Fonts.travelsMedium, fontSize: 15.5, lineHeight: 22, letterSpacing: -0.16, color: T.gold },
  cwords: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cword: { borderRadius: 999, paddingVertical: 6, paddingHorizontal: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)' },
  cwordT: { fontFamily: Fonts.travelsRegular, fontSize: 11.5, color: D.on },
  cblock: { gap: 5, paddingTop: 12, borderTopWidth: 1, borderTopColor: D.line },
  cnum: { fontFamily: Fonts.travelsMedium, fontSize: 9.5, letterSpacing: 1.33, textTransform: 'uppercase', color: 'rgba(255,255,255,0.62)' },
  cbody: { fontFamily: Fonts.travelsRegular, fontSize: 13.5, lineHeight: 20, color: D.on },
  cchips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 2 },
  cchip: { borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10, backgroundColor: D.chip, borderWidth: 1, borderColor: D.chipEdge },
  cchipT: { fontFamily: Fonts.travelsRegular, fontSize: 11.5, color: D.on },
  cbars: { gap: 7, paddingTop: 3 },
  cbar: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  cbarK: { width: 82, fontFamily: Fonts.travelsRegular, fontSize: 11.5, color: 'rgba(255,255,255,0.78)' },
  cbarTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.16)' },
  cbarFill: { height: '100%', borderRadius: 2, backgroundColor: T.gold },
  cbarV: { width: 30, textAlign: 'right', fontFamily: Fonts.travelsMedium, fontSize: 11.5, color: D.on },
  ctrack: { gap: 9, paddingTop: 3 },
  ctrow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  ctrackT: { fontFamily: Fonts.travelsRegular, fontSize: 12.5, color: D.on3 },
  ctrackOn: { color: D.on, fontFamily: Fonts.travelsMedium },
  tierHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tierT: { fontFamily: Fonts.travelsMedium, fontSize: 13, color: D.on2 },
  tierSample: { paddingBottom: 6 },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 2 },
  tierFill: { backgroundColor: 'rgba(232,181,48,0.55)' },
  tierCount: { fontFamily: Fonts.travelsMedium, fontSize: 11.5, color: D.on3, minWidth: 44, textAlign: 'right' },
  subLab: { fontFamily: Fonts.travelsMedium, fontSize: 11.5, color: D.on2, paddingTop: 4 },
  subLabGap: { paddingTop: 10 },
  obsNote: { fontFamily: Fonts.travelsRegular, fontSize: 12, lineHeight: 17, color: D.on2, paddingTop: 2 },
  cfoot: { gap: 9, paddingTop: 14, borderTopWidth: 1, borderTopColor: D.line, alignItems: 'center' },
  cbtn: { width: '100%', borderRadius: 999, backgroundColor: T.gold, paddingVertical: 12, alignItems: 'center' },
  cbtnT: { fontFamily: Fonts.ttDemiBold, fontSize: 13.5, color: T.ink },
  cby: { fontFamily: Fonts.travelsRegular, fontSize: 10, letterSpacing: 1.4, color: D.on3 },
});
