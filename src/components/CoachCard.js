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

export default function CoachCard({ card, locked }) {
  const c = card || {};
  const alloc = c.alloc && Object.keys(c.alloc).length ? c.alloc
    : { Technique: 40, Musicality: 25, Mental: 20, Performance: 15 };
  const initials = (c.name || '').trim().split(/\s+/).filter(Boolean)
    .map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  const Block = ({ n, title, children }) => (
    <View style={s.cblock}>
      <Text style={s.cnum}>{n} \u00b7 {title}</Text>
      <Veil on={locked}>{children}</Veil>
    </View>
  );

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

      <Block n="01" title="What he teaches">
        <View style={s.cchips}>
          {(c.teaches || []).map((d) => <View key={d} style={s.cchip}><Text style={s.cchipT}>{d}</Text></View>)}
        </View>
      </Block>
      <Block n="02" title="Who he works with">
        <View style={s.cchips}>
          {(c.worksWith && c.worksWith.length ? c.worksWith : ['Not set yet']).map((w) => (
            <View key={w} style={s.cchip}><Text style={s.cchipT}>{w}</Text></View>
          ))}
        </View>
      </Block>
      <Block n="03" title="How he teaches"><Text style={s.cbody}>{c.howITeach || 'Not answered yet'}</Text></Block>
      <Block n="04" title="His method"><Text style={s.cbody}>{c.myMethod || 'Not answered yet'}</Text></Block>
      <Block n="05" title="Where the hour goes">
        <View style={s.cbars}>
          {AXES.map((k) => (
            <View key={k} style={s.cbar}>
              <Text style={s.cbarK}>{k}</Text>
              <View style={s.cbarTrack}><View style={[s.cbarFill, { width: `${alloc[k] || 0}%` }]} /></View>
              <Text style={s.cbarV}>{alloc[k] || 0}</Text>
            </View>
          ))}
        </View>
      </Block>
      <Block n="06" title="Best if you want to">
        <Text style={s.cbody}>{c.bestFor && c.bestFor.length ? c.bestFor.join(' \u00b7 ') : '\u2014'}</Text>
      </Block>

      {/* the second lock, a different job: the blur above converts to an
          account, this one converts to capturing lessons, and it stays for good */}
      <Block n="07" title="Track record">
        <View style={s.ctrack}>
          <View style={s.ctrow}>
            <Tick />
            <Text style={[s.ctrackT, s.ctrackOn]}>Verified InBetween Coach</Text>
          </View>
          <View style={s.ctrow}>
            <LockIcon /><Text style={s.ctrackT}>Teaching since \u2014\u2014</Text><Text style={s.ctrackTag}>10 lessons</Text>
          </View>
          <View style={s.ctrow}>
            <LockIcon /><Text style={s.ctrackT}>\u2014\u2014 lessons documented</Text><Text style={s.ctrackTag}>50 lessons</Text>
          </View>
        </View>
      </Block>
      <Block n="08" title="How he works">
        <Text style={s.cbody}>
          Every lesson is captured. After each one his students get their own focus points \u2014 exactly what he
          told them \u2014 so they always know what to train before they come back.
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
  ctrackTag: { marginLeft: 'auto', fontFamily: Fonts.travelsRegular, fontSize: 10.5, letterSpacing: 1.1,
    textTransform: 'uppercase', color: D.on3 },
  cfoot: { gap: 9, paddingTop: 14, borderTopWidth: 1, borderTopColor: D.line, alignItems: 'center' },
  cbtn: { width: '100%', borderRadius: 999, backgroundColor: T.gold, paddingVertical: 12, alignItems: 'center' },
  cbtnT: { fontFamily: Fonts.ttDemiBold, fontSize: 13.5, color: T.ink },
  cby: { fontFamily: Fonts.travelsRegular, fontSize: 10, letterSpacing: 1.4, color: D.on3 },
});
