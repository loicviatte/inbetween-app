// ─── Onboarding v3 ──────────────────────────────────────────────────────────
// A port of assets/onboarding-v3.html, not an adaptation of it: the sizes,
// spacing, colours, copy and motion below are read straight off that file's
// stylesheet. Where the comp uses a CSS feature React Native has no equivalent
// for, the note says what replaced it and why.
//
// Two things the comp could not tell us, resolved here:
//   · its --font-display / --font-sans never resolve (colors_and_type.css is
//     not in the repo), so a browser renders the headings in Times. The app's
//     own spec sets the whole onboarding in TT Travels, so that is what the
//     display and body faces map to.
//   · its welcome screen loads a white wordmark PNG we do not ship. The
//     wordmark is drawn as text in the same face the app uses elsewhere.
//
// Structure follows the comp exactly: one surface holding every screen, answers
// collected BEFORE the account form, and the reward — focus points for a
// student, his card for a coach — shown blurred behind the signup wall first.
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform, Animated, Easing, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Slider from '@react-native-community/slider';
import Svg, { Path, Circle, Ellipse, Defs, RadialGradient, Stop } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { Fonts } from '../theme';
import { supabase } from '../services/supabase/client';
import { filterStudios, hasExactMatch } from '../utils/studioMatch';
import { setOnboardingHold } from '../utils/onboardingHold';
import { recallToFocusPoints, saveOnboardingFocusPoints } from '../services/ai/onboardingRecall';
import { createChildAccount } from '../services/childAccount';
import { saveCoachCard, slugify, essenceFrom } from '../storage/coachCardStorage';
import CoachCard from '../components/CoachCard';
import {
  inviteParent, getInviteStatus, resendInvite, updateInvite, verifyInvitation, approveInvitation,
  savePendingInvite, loadPendingInvite, clearPendingInvite, tokenFromUrl,
} from '../services/minorConsent';

// ── tokens, straight from the comp's stylesheet ──────────────────────────────
const T = {
  screen: '#F2F0EB',            // .phone
  dark: '#000000',              // .phone.dark
  card: '#FFFFFF',
  ink: '#0A0A0A',
  ink2: 'rgba(10,10,10,0.65)',
  ink3: 'rgba(10,10,10,0.42)',
  line: 'rgba(10,10,10,0.07)',
  line2: 'rgba(10,10,10,0.10)',
  line3: 'rgba(10,10,10,0.14)',
  gold: '#E8B530',
  gold300: '#F6D27A',
  goldInk: '#8A6414',
  tile: '#EFEFEC',
  lockbar: '#FCEFC9',
  onDark: 'rgba(255,255,255,0.72)',
  onDark2: 'rgba(255,255,255,0.68)',
};
// .phone.dark ink, used by the coach card too
const D = {
  bg: '#0A0A0A', on: '#FFFFFF', on2: 'rgba(255,255,255,0.70)',
  // the comp greys locked rows to .45 white, which lands on exactly 4.50:1 —
  // the minimum with no margin. These rows are information, not disabled
  // controls, so they are lifted to .56 (6.46:1).
  on3: 'rgba(255,255,255,0.56)',
  line: 'rgba(255,255,255,0.12)',
  chip: 'rgba(255,255,255,0.10)', chipEdge: 'rgba(255,255,255,0.20)',
};

// --out and --spring from :root
const OUT = Easing.bezier(0.2, 0.7, 0.2, 1);
const SPRING = Easing.bezier(0.34, 1.56, 0.64, 1);
const haptic = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

// ── motion ──────────────────────────────────────────────────────────────────
// @keyframes rise{from{opacity:0;transform:translateY(12px)}} .5s var(--out)
// The comp stages a screen's content with nth-child delays; `delay` carries the
// same numbers so the order of arrival is identical.
function Rise({ delay = 0, duration = 500, style, children }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration, delay: delay * 1000, easing: OUT, useNativeDriver: true }).start();
  }, [v, delay, duration]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

// @keyframes inR / inL — .4s, ±20px, opacity
function ScreenIn({ step, dir, children }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: 400, easing: OUT, useNativeDriver: true }).start();
  }, [v, step]);
  return (
    <Animated.View style={{ flex: 1, opacity: v, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [20 * dir, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}

// .cta.gold::after — a 42%-wide band crossing the button, 3.6s, 1.1s in, forever
function Sheen({ width }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(1100),
      Animated.timing(v, { toValue: 1, duration: 1512, easing: OUT, useNativeDriver: true }),   // 42% of 3.6s
      Animated.delay(2088),
      Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  if (!width) return null;
  const band = width * 0.42;
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', top: 0, bottom: 0, width: band,
      opacity: v.interpolate({ inputRange: [0, 0.03, 0.97, 1], outputRange: [0, 1, 1, 0] }),
      transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-band, width] }) }],
    }}>
      <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

// ── icons ───────────────────────────────────────────────────────────────────
const AnimatedPath = Animated.createAnimatedComponent(Path);

function ChevronLeft({ color = T.ink, size = 16 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M15 6l-6 6 6 6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}
function SearchIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24">
      <Circle cx={11} cy={11} r={7} stroke={T.ink3} strokeWidth={2} fill="none" />
      <Path d="M20 20l-4-4" stroke={T.ink3} strokeWidth={2} strokeLinecap="round" />
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

// .opt .tick svg — stroke-dasharray 24, drawn on selection (.34s, .08s in)
function Check({ on, color = T.ink, size = 12, width = 2.6 }) {
  const d = useRef(new Animated.Value(on ? 0 : 24)).current;
  useEffect(() => {
    Animated.timing(d, {
      toValue: on ? 0 : 24, duration: on ? 340 : 0, delay: on ? 80 : 0,
      easing: OUT, useNativeDriver: false,
    }).start();
  }, [d, on]);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={{ opacity: on ? 1 : 0 }}>
      <AnimatedPath d="M5 13l4 4 10-10" stroke={color} strokeWidth={width} strokeLinecap="round"
        strokeLinejoin="round" fill="none" strokeDasharray="24" strokeDashoffset={d} />
    </Svg>
  );
}

// @keyframes pop — scale .4 → 1 on the spring curve
function Pop({ on, style, children }) {
  const v = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: on ? 1 : 0, duration: on ? 420 : 120, easing: on ? SPRING : OUT, useNativeDriver: true }).start();
  }, [v, on]);
  return (
    <Animated.View style={[style, { transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }]}>
      {children}
    </Animated.View>
  );
}

// ── primitives ──────────────────────────────────────────────────────────────
function TopBar({ onBack, progress }) {
  const w = useRef(new Animated.Value(progress)).current;
  // .shelf span — width transitions over .7s on --out
  useEffect(() => {
    Animated.timing(w, { toValue: progress, duration: 700, easing: OUT, useNativeDriver: false }).start();
  }, [w, progress]);
  return (
    <View style={s.top}>
      <TouchableOpacity onPress={onBack} style={s.back} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10}>
        <ChevronLeft />
      </TouchableOpacity>
      <View style={s.shelf}>
        <Animated.View style={[s.shelfFill, { width: w.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}>
          <LinearGradient colors={[T.gold300, T.gold]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>
    </View>
  );
}

function Opt({ t, d, on, onPress, delay }) {
  return (
    <Rise delay={delay}>
      <TouchableOpacity style={[s.opt, on && s.optOn]} onPress={onPress} activeOpacity={0.9}
        accessibilityRole="radio" accessibilityState={{ selected: on }}>
        <View style={s.optTxt}>
          <Text style={s.optB}>{t}</Text>
          {!!d && <Text style={s.optS}>{d}</Text>}
        </View>
        <Pop on={on} style={[s.tick, on && s.tickOn]}><Check on={on} /></Pop>
        {!on && <View style={s.tickRing} pointerEvents="none" />}
      </TouchableOpacity>
    </Rise>
  );
}

// .rung — the level ladder: the pips are the level, so they carry the weight
function Rung({ t, d, filled, total, on, onPress, delay }) {
  return (
    <Rise delay={delay}>
      <TouchableOpacity style={[s.rung, on && s.rungOn]} onPress={onPress} activeOpacity={0.9}
        accessibilityRole="radio" accessibilityState={{ selected: on }}>
        <View style={s.pips}>
          {Array.from({ length: total }).map((_, i) => (
            <View key={i} style={[s.pip, i < filled && s.pipOn]} />
          ))}
        </View>
        <View style={s.rungTxt}>
          <Text style={s.rungB}>{t}</Text>
          <Text style={s.rungS}>{d}</Text>
        </View>
      </TouchableOpacity>
    </Rise>
  );
}

function Pick({ label, on, onPress }) {
  return (
    <TouchableOpacity style={[s.pick, on && s.pickOn]} onPress={onPress} activeOpacity={0.85}
      accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[s.pickT, on && s.pickTOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Field({ label, value, onChange, placeholder, ...rest }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={s.field}>
      <Text style={s.lbl}>{label}</Text>
      <View style={[s.fieldIn, focus && s.fieldOn]}>
        <TextInput style={s.input} value={value} onChangeText={onChange} placeholder={placeholder}
          placeholderTextColor={T.ink3} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} {...rest} />
      </View>
    </View>
  );
}

function Cta({ label, onPress, disabled, gold = true, busy }) {
  const [w, setW] = useState(0);
  return (
    <TouchableOpacity onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={[s.cta, gold ? s.ctaGold : s.ctaInk, disabled && s.ctaOff]}
      onPress={onPress} disabled={disabled || busy} activeOpacity={0.9} accessibilityRole="button">
      {gold && !disabled && <Sheen width={w} />}
      {busy ? <ActivityIndicator color={gold ? T.ink : '#fff'} />
        : <Text style={[s.ctaT, !gold && s.ctaTInk]}>{label}</Text>}
    </TouchableOpacity>
  );
}

// Blur is what an account still buys. RN has no CSS filter, so each block's
// content is veiled by a BlurView while its label stays sharp — a blurred block
// with no name is noise, and the comp keeps the labels legible for that reason.
function Veil({ on, children, style }) {
  if (!on) return <View style={style}>{children}</View>;
  return (
    <View style={style}>
      {children}
      <BlurView intensity={26} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
    </View>
  );
}

// ── the questions, verbatim from the comp ───────────────────────────────────
const ROLES = [
  { v: 'student', t: 'Student', d: 'Train your focus points between lessons' },
  { v: 'parent', t: 'Parent', d: 'Follow your child’s training between lessons' },
  { v: 'coach', t: 'Coach', d: 'Run classes and assign focus points' },
];
// A parent holds the account and follows a child's training, so every question
// in the student flow is asked about someone else. Only the wording changes —
// the flow, the plan and the focus points are the same.
const PARENT_COPY = {
  style: ['Your child’s dance style', 'This decides which dances appear in their focus list.'],
  level: ['Where is your child now?', 'Their level sets the depth of the corrections they get.'],
  age: ['Your child’s age category', 'Competition grading works by age — it keeps their focus list realistic.'],
  solo: ['How often do they train solo?', 'Between lessons, on their own. Their weekly target is built from this.'],
  lessons: ['Private lessons a month?', 'On average — reminders get timed around them.'],
  studio: ['Find their studio', 'Connect it and their coach’s corrections land straight in the app.'],
  coach: ['Is their coach here?', 'Pick who teaches them. Their corrections land straight in the app.'],
  recall: ['Recall their last lesson', 'Type what the coach worked on. We’ll turn it into focus points they can train tonight.'],
};
// Under-18 categories: consent has to come from an adult, so the age screen
// offers the parent account rather than blocking the person outright.
const MINOR_AGES = ['Juvenile', 'Junior', 'Youth'];
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_OK = (v) => /^\+[0-9]{8,15}$/.test((v || '').replace(/[\s().-]/g, ''));
const STYLES = [
  { v: 'Latin', t: 'Latin', d: 'Cha Cha · Rumba · Samba · Paso · Jive' },
  { v: 'Ballroom', t: 'Ballroom', d: 'Waltz · Tango · Foxtrot · Quickstep · Viennese' },
  { v: 'Latin & Ballroom', t: 'Both styles', d: 'Ten Dance — all 10 dances tracked separately' },
];
const LEVELS = [
  { v: 'Beginners', t: 'Beginners / Starters / Newcomer', d: 'First-time or novice competitors · basic figures', pips: 1 },
  { v: 'Intermediate', t: 'Intermediate / Novice', d: 'Mid-tier · more technical dances', pips: 3 },
  { v: 'Advanced', t: 'Advanced / Open', d: 'Top-tier amateur or professional · full routines', pips: 5 },
];
const AGES = [
  { v: 'Juvenile', t: 'Juvenile', d: 'Under 12' },
  { v: 'Junior', t: 'Junior', d: '12 to 15' },
  { v: 'Youth', t: 'Youth', d: '16 to 18' },
  { v: 'Adult', t: 'Adult', d: '18 to 35' },
  { v: 'Senior', t: 'Senior', d: '36 and over' },
];
const SOLO = [
  { v: 0.75, t: 'A few times a month', d: '≈ 3 sessions a month' },
  { v: 1.5, t: '1 to 2 times a week', d: '≈ 6 sessions a month' },
  { v: 3.5, t: '3 to 4 times a week', d: '≈ 14 a month — where most progress happens' },
  { v: 6, t: 'Almost daily', d: '≈ 26 sessions a month' },
];
const WORDS = ['Energetic', 'Calm', 'Hands-on', 'Verbal', 'Demanding', 'Encouraging',
  'Rhythm first', 'Technique first', 'Visual', 'Analytical', 'Intuitive', 'Structured'];
const LEAVE = ['Cleaner technique', 'More confidence', 'Better musicality',
  'Presence on the floor', 'Solid foundations', 'A competitor’s mindset'];
const WHO = ['Beginners', 'Regular amateurs', 'Pro-Am', 'Competitors', 'Children', 'Social couples'];
const AXES = ['Technique', 'Musicality', 'Mental', 'Performance'];
const DANCES = {
  Latin: ['Cha Cha', 'Rumba', 'Samba', 'Paso Doble', 'Jive'],
  Ballroom: ['Waltz', 'Tango', 'Foxtrot', 'Quickstep', 'Viennese Waltz'],
  'Latin & Ballroom': ['Cha Cha', 'Rumba', 'Samba', 'Paso Doble', 'Jive',
    'Waltz', 'Tango', 'Foxtrot', 'Quickstep', 'Viennese Waltz'],
};
// this screen's answers → the shape the shared card renders
const toCard = (a) => ({
  name: a.name,
  credential: a.cred || `${a.style || 'Latin'} coach`,
  essence: essenceFrom(a.words, a.alloc),
  styleWords: a.words,
  teaches: DANCES[a.style] || DANCES.Latin,
  worksWith: a.who,
  howITeach: a.correct,
  myMethod: a.signature,
  alloc: a.alloc,
  bestFor: a.leave,
});

const COACH_FLOW = ['role', 'style', 'studio', 'recap', 'correct', 'words', 'signature', 'alloc', 'leave', 'who', 'cred'];
const STUDENT_FLOW = ['role', 'style', 'level', 'age', 'solo', 'lessons', 'studio', 'coach', 'recap'];
// Under 18: the explanation comes straight after the age, the coach is still
// chosen (their parent is told who it is), and the recall is gone — a minor's
// account of a lesson is not sent to an AI before a parent has approved.
const MINOR_FLOW = ['role', 'style', 'level', 'age', 'minorExplain', 'solo', 'lessons', 'studio', 'coach', 'minorParent'];

// The weekly target agreed here IS the goal the Trend view scores against, so
// it is written to users.weekly_goal_minutes rather than staying in onboarding.
function weeklyTarget(a) {
  return Math.max(30, Math.round((a.solo * 30 + (a.lessons / 4.33) * 45) / 10) * 10);
}

// ── screen 00 · welcome ─────────────────────────────────────────────────────
// The comp's one fully authored moment: the gap between two lessons drawn as a
// rail that fills, then the headline rising line by line out of its own mask.
function Welcome({ onStart, onSignIn, onInvitation }) {
  const fill = useRef(new Animated.Value(0)).current;      // .rail .fill + .spark
  const lit = useRef(new Animated.Value(0)).current;       // .rail .d.b
  const drift = useRef(new Animated.Value(0)).current;     // .glow
  const [railW, setRailW] = useState(0);

  useEffect(() => {
    Animated.sequence([
      Animated.delay(420),
      Animated.timing(fill, { toValue: 1, duration: 900, easing: OUT, useNativeDriver: false }),
    ]).start();
    Animated.sequence([
      Animated.delay(1300),
      Animated.timing(lit, { toValue: 1, duration: 400, easing: OUT, useNativeDriver: false }),
    ]).start();
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 12000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(drift, { toValue: 0, duration: 12000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [fill, lit, drift]);

  return (
    <View style={s.w0}>
      <Animated.View pointerEvents="none" style={[s.glow, {
        opacity: drift.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }),
        transform: [
          { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, 16] }) },
          { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, -12] }) },
          { scale: drift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) },
        ],
      }]}>
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="glow" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0" stopColor={T.gold} stopOpacity="0.26" />
              <Stop offset="0.44" stopColor={T.gold} stopOpacity="0.06" />
              <Stop offset="1" stopColor={T.gold} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Ellipse cx="50%" cy="50%" rx="50%" ry="50%" fill="url(#glow)" />
        </Svg>
      </Animated.View>

      <Rise delay={0.05} duration={700}><Text style={s.wordmark}>InBetween</Text></Rise>

      <View style={s.mass}>
        <Rise delay={0.18} duration={600} style={s.span}>
          <View style={s.ends}>
            <Text style={s.endT}>Tue · lesson</Text>
            <Text style={s.endT}>Sat · lesson</Text>
          </View>
          <View style={s.rail} onLayout={(e) => setRailW(e.nativeEvent.layout.width)}>
            <View style={s.railBase} />
            <Animated.View style={[s.railFill, { width: fill.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, railW - 6)] }) }]}>
              <LinearGradient colors={['rgba(232,181,48,0.35)', T.gold]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            </Animated.View>
            <Animated.View style={[s.spark, {
              opacity: fill.interpolate({ inputRange: [0, 0.12, 0.92, 1], outputRange: [0, 1, 1, 0] }),
              transform: [{ translateX: fill.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, railW - 8)] }) }],
            }]} />
            <View style={[s.dot, s.dotA]} />
            <Animated.View style={[s.dot, s.dotB, {
              backgroundColor: lit.interpolate({ inputRange: [0, 1], outputRange: ['rgba(255,255,255,0.28)', T.gold] }),
            }]} />
          </View>
          <Rise delay={0.9}><Text style={s.mid}>96 hours on your own</Text></Rise>
        </Rise>

        {/* @keyframes lineup — each line climbs out of its own overflow mask */}
        <View>
          <LineUp delay={1.05}>The lesson ends.</LineUp>
          <LineUp delay={1.17}>The work doesn’t.</LineUp>
        </View>

        <Rise delay={1.45} duration={600}>
          <Text style={s.w0p}>
            Every correction your coach gives you, kept — and turned into what you practise tonight.
          </Text>
        </Rise>
      </View>

      <Rise delay={1.6} duration={600} style={s.acts0}>
        <Cta label="Start" onPress={onStart} />
        <TouchableOpacity onPress={onSignIn} style={s.ghost} accessibilityRole="button">
          <Text style={[s.ghostT, s.ghostOnDark]}>I already have an account</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onInvitation} style={s.ghost} accessibilityRole="button">
          <Text style={[s.ghostT, s.ghostOnDark]}>I have a parent invitation</Text>
        </TouchableOpacity>
      </Rise>
    </View>
  );
}

function LineUp({ delay, children }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 700, delay: delay * 1000, easing: OUT, useNativeDriver: true }).start();
  }, [v, delay]);
  return (
    <View style={s.lineMask}>
      <Animated.Text style={[s.w0h2, { transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [46, 0] }) }] }]}>
        {children}
      </Animated.Text>
    </View>
  );
}

// ── the flow ────────────────────────────────────────────────────────────────
export default function OnboardingScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [a, setA] = useState({
    role: '', style: '', level: '', age: '', solo: 0, soloLabel: '', lessons: 3,
    studioId: null, studioName: '', noStudio: false, createStudio: false,
    correct: '', signature: '', words: [], leave: [], who: [], cred: '',
    coachId: null, coachName: '', noCoach: false,
    recall: '', focus: [],
    parentFirstName: '', parentEmail: '', parentPhone: '',
    inviteId: '', deviceSecret: '', maskedEmail: '', inviteStatus: '', inviteNote: '', editingInvite: false, inviteClosed: false,
    invToken: '', invCode: '', consent: null, checks: [false, false, false], parentPassword: '',
    alloc: { Technique: 40, Musicality: 25, Mental: 20, Performance: 15 },
    name: '', childName: '', email: '', password: '', slug: '',
  });
  const [step, setStep] = useState('welcome');
  const [dir, setDir] = useState(1);
  const [studios, setStudios] = useState([]);
  const [studiosLoading, setStudiosLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [coaches, setCoaches] = useState([]);
  const [coachesLoading, setCoachesLoading] = useState(false);
  const [noticeFor, setNoticeFor] = useState('');     // 'studio' | 'coach'
  const [invited, setInvited] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scroller = useRef(null);
  const bump = useRef(new Animated.Value(1)).current;

  const set = (patch) => setA((p) => ({ ...p, ...patch }));
  const isCoach = a.role === 'coach';
  const isParent = a.role === 'parent';
  // `them` when a parent is filling this in, `you` otherwise.
  const copy = (key, h1, sub2) => (isParent && PARENT_COPY[key]) || [h1, sub2];
  const isMinor = !isCoach && !isParent && MINOR_AGES.includes(a.age);
  const flow = isCoach ? COACH_FLOW : isMinor ? MINOR_FLOW : STUDENT_FLOW;
  const inFlow = flow.indexOf(step);
  const progress = inFlow < 0 ? 1 : (inFlow + 1) / flow.length;

  useEffect(() => { scroller.current?.scrollTo({ y: 0, animated: false }); }, [step]);
  useEffect(() => () => setOnboardingHold(false), []);

  // A student who closed the app while waiting comes back to the wait, not to
  // a fresh onboarding that would create a second pending profile.
  useEffect(() => {
    let alive = true;
    loadPendingInvite().then((p) => {
      if (!alive || !p?.inviteId) return;
      set({
        inviteId: p.inviteId, deviceSecret: p.deviceSecret, name: p.childName || '',
        parentFirstName: p.parentFirstName || '', parentEmail: p.parentEmail || '', parentPhone: p.parentPhone || '',
      });
      setStep('minorWaiting');
    });
    return () => { alive = false; };
  }, []);

  // The invitation email opens the app on a link carrying the email code.
  useEffect(() => {
    const open = (url) => {
      const token = tokenFromUrl(url);
      if (token) { set({ invToken: token }); setStep('parentCode'); }
    };
    Linking.getInitialURL().then(open).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => open(url));
    return () => sub.remove();
  }, []);

  // The waiting screen notices the approval on its own.
  useEffect(() => {
    if (step !== 'minorWaiting' || !a.inviteId || a.inviteClosed
      || ['approved', 'withdrawn'].includes(a.inviteStatus)) return undefined;
    let alive = true;
    const tick = () => getInviteStatus(a.inviteId, a.deviceSecret)
      .then((r) => { if (alive) set({ inviteStatus: r.status }); })
      .catch(() => {});
    tick();
    const t = setInterval(tick, 8000);
    return () => { alive = false; clearInterval(t); };
  }, [step, a.inviteId, a.inviteStatus, a.inviteClosed]);
  const noticeShowing = (step === 'studio' && noticeFor === 'studio') || (step === 'coach' && noticeFor === 'coach');
  useEffect(() => {
    if (!noticeShowing) return undefined;
    const t = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 90);
    return () => clearTimeout(t);
  }, [noticeShowing]);

  useEffect(() => {
    if (step !== 'coach') return;
    let cancelled = false;
    setCoachesLoading(true);
    let q = supabase.from('users').select('id, name, dance_style, studio_id').eq('role', 'coach');
    if (a.studioId) q = q.eq('studio_id', a.studioId);
    q.order('name', { ascending: true }).limit(24).then(({ data }) => {
      if (!cancelled) { setCoaches(data || []); setCoachesLoading(false); }
    });
    return () => { cancelled = true; };
  }, [step, a.studioId]);

  useEffect(() => {
    if (step !== 'studio') return;
    let cancelled = false;
    setStudiosLoading(true);
    supabase.from('studios').select('id, name').order('name', { ascending: true })
      .then(({ data }) => { if (!cancelled) { setStudios(data || []); setStudiosLoading(false); } });
    return () => { cancelled = true; };
  }, [step]);

  function go(to, d = 1) { haptic(); setDir(d); setStep(to); }

  function next() {
    const i = flow.indexOf(step);
    if (i > -1 && i < flow.length - 1) return go(flow[i + 1]);
    if (step === 'minorParent') return sendInvite();
    if (step === 'parentCode') return runVerify();
    if (step === 'parentContext') return go('parentWhat');
    if (step === 'parentWhat') return go('parentConsent');
    if (step === 'parentConsent') return go('parentAccount');
    if (step === 'parentAccount') return runApprove();
    if (step === 'cred') return go('cardLocked');
    if (step === 'recap' && !isCoach) return go('recall');
    if (step === 'recall') return runRecall();
    if (step === 'cardLocked' || step === 'planReady' || step === 'focusLocked') return go('account');
  }

  function back() {
    const i = flow.indexOf(step);
    if (step === 'minorParent' && a.editingInvite) { set({ editingInvite: false }); return go('minorWaiting', -1); }
    if (step === 'parentCode') return go('welcome', -1);
    if (step === 'parentContext') return go('parentCode', -1);
    if (step === 'parentWhat') return go('parentContext', -1);
    if (step === 'parentConsent') return go('parentWhat', -1);
    if (step === 'parentAccount') return go('parentConsent', -1);
    if (step === 'account') return go(isCoach ? 'cardLocked' : (a.focus.length ? 'focusLocked' : 'planReady'), -1);
    if (step === 'cardLocked') return go('cred', -1);
    if (step === 'planReady' || step === 'recall') return go('recap', -1);
    if (step === 'focusLocked' || step === 'analysing') return go('recall', -1);
    if (i > 0) return go(flow[i - 1], -1);
    if (i === 0) return go('welcome', -1);
    navigation.goBack();
  }

  function toggle(key, value, max) {
    const list = a[key];
    if (list.includes(value)) return set({ [key]: list.filter((x) => x !== value) });
    if (list.length >= max) return;
    haptic();
    set({ [key]: [...list, value] });
  }

  // @keyframes bump — the count reacts to its own change
  function stepLessons(delta) {
    const v = Math.max(0, Math.min(10, a.lessons + delta));
    if (v === a.lessons) return;
    haptic();
    set({ lessons: v });
    bump.setValue(1);
    Animated.sequence([
      Animated.timing(bump, { toValue: 1.22, duration: 136, easing: SPRING, useNativeDriver: true }),
      Animated.timing(bump, { toValue: 1, duration: 204, easing: SPRING, useNativeDriver: true }),
    ]).start();
  }

  // ── under 18: the student invites a parent ──────────────────────────────
  async function sendInvite() {
    setError(''); setBusy(true);
    const contact = {
      parentFirstName: a.parentFirstName.trim(), parentEmail: a.parentEmail.trim(), parentPhone: a.parentPhone.trim(),
    };
    try {
      let inviteId = a.inviteId, deviceSecret = a.deviceSecret, maskedEmail;
      if (a.editingInvite && inviteId) {
        ({ maskedEmail } = await updateInvite(inviteId, deviceSecret, contact));
      } else {
        const res = await inviteParent({
          childName: a.name.trim(), danceStyle: a.style, level: a.level, ageCategory: a.age,
          studioId: a.studioId || null, coachId: a.coachId || null,
          lessonsPerMonth: a.lessons, soloFrequency: a.soloLabel, ...contact,
        });
        ({ inviteId, deviceSecret, maskedEmail } = res);
      }
      set({ inviteId, deviceSecret, maskedEmail, inviteStatus: 'pending', inviteNote: '', editingInvite: false });
      await savePendingInvite({ inviteId, deviceSecret, childName: a.name.trim(), ...contact });
      go('minorWaiting');
    } catch (e) {
      if ([404, 409, 410].includes(e.status)) set({ inviteClosed: true, editingInvite: false });
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshInvite() {
    setError('');
    try { const r = await getInviteStatus(a.inviteId, a.deviceSecret); set({ inviteStatus: r.status }); }
    catch (e) { if ([404, 409, 410].includes(e.status)) set({ inviteClosed: true }); else setError(e.message); }
  }

  async function doResend() {
    setError(''); set({ inviteNote: '' });
    try { await resendInvite(a.inviteId, a.deviceSecret); set({ inviteNote: 'Sent again.', inviteStatus: 'pending' }); }
    catch (e) { if ([404, 409, 410].includes(e.status)) set({ inviteClosed: true }); else setError(e.message); }
  }

  // ── the parent approves ─────────────────────────────────────────────────
  async function runVerify() {
    setError(''); setBusy(true);
    try {
      const r = await verifyInvitation(a.invToken, a.invCode);
      // Every box starts empty, every time the codes are entered.
      set({ consent: r, checks: [false, false, false], parentPassword: '' });
      go('parentContext');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function runApprove() {
    setError(''); setBusy(true);
    try {
      await approveInvitation(a.consent.ticket, a.checks, a.consent.accountExists ? undefined : a.parentPassword);
      go('parentDone');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function runRecall() {
    setError('');
    go('analysing');
    try {
      const points = await recallToFocusPoints(a.recall.trim(), a.style);
      set({ focus: points });
      // The analysing screen is not a fake wait — it is however the only place
      // the call can breathe, so it is held to its own animation's length.
      setTimeout(() => go('focusLocked'), 400);
    } catch (e) {
      setError(e.message || 'Could not read that lesson.');
      go('recall', -1);
    }
  }

  // Same mechanics RegisterScreen proved: answers ride in the auth metadata so
  // handle_new_user can persist them even when email confirmation returns no
  // session.
  async function submit() {
    setBusy(true); setError('');
    if (isCoach || a.focus.length) setOnboardingHold(true);
    const dbRole = isCoach ? 'coach' : 'student';
    const metadata = { name: a.name.trim(), role: dbRole, dance_style: a.style };
    if (isParent) metadata.account_for = 'child';
    else if (!isCoach) metadata.account_for = 'self';
    if (a.studioId && !a.createStudio) metadata.studio_id = a.studioId;
    if (!isCoach) {
      metadata.lessons_per_month = a.lessons;
      metadata.solo_practice_frequency = a.soloLabel;
    }
    const { data, error: signUpErr } = await supabase.auth.signUp({
      email: a.email.trim(), password: a.password, options: { data: metadata },
    });
    if (signUpErr) { setBusy(false); setOnboardingHold(false); setError(signUpErr.message); return; }
    const userId = data?.user?.id;
    if (!data?.session) { setBusy(false); setOnboardingHold(false); go('confirm'); return; }

    let studioId = a.studioId;
    if (isCoach && a.createStudio && query.trim()) {
      const { data: made, error: createErr } = await supabase
        .from('studios').insert({ name: query.trim(), created_by: userId }).select('id').single();
      if (createErr) {
        setBusy(false); setOnboardingHold(false);
        setError(createErr.code === '23505' ? 'A studio with that name already exists.'
          : (createErr.message || 'Could not create studio.'));
        return;
      }
      studioId = made.id;
    }
    if (userId) {
      await supabase.from('users').update({ role: dbRole, dance_style: a.style, studio_id: studioId || null }).eq('id', userId);
      if (isCoach) {
        // Eleven answers that until now only existed in this screen's state.
        const { slug, error: cardErr } = await saveCoachCard(userId, a);
        if (cardErr) {
          setBusy(false); setOnboardingHold(false);
          setError(cardErr);
          return;
        }
        set({ slug });
      }

      if (isParent) {
        // Everything the parent answered describes their child, so it is the
        // child's profile that gets it — created server-side, since a student
        // row needs an auth account and only the service role can make one.
        const { error: childErr } = await createChildAccount({
          childName: a.childName.trim(),
          danceStyle: a.style,
          level: a.level,
          ageCategory: a.age,
          studioId: a.studioId || null,
          coachId: a.coachId || null,
          lessonsPerMonth: a.lessons,
          soloFrequency: a.soloLabel,
          weeklyGoalMinutes: weeklyTarget(a),
          focusPoints: a.focus,
        });
        if (childErr) {
          setBusy(false); setOnboardingHold(false);
          setError(childErr);
          return;
        }
      } else if (!isCoach) {
        const { error: stuErr } = await supabase.from('users').update({
          lessons_per_month: a.lessons, solo_practice_frequency: a.soloLabel,
          weekly_goal_minutes: weeklyTarget(a),
        }).eq('id', userId);
        if (stuErr) console.warn('[onboarding] student fields not saved:', stuErr.message);
        // Generated before the account existed; written now that there is one
        // to attach them to. Abandon the flow and they were never anywhere.
        await saveOnboardingFocusPoints(userId, a.focus);
      }
    }
    setBusy(false);
    if (isCoach) return go('cardLive');
    if (a.focus.length) return go('focusLive');
    setOnboardingHold(false);
    // App.js's onAuthStateChange swaps to the home navigator for students.
  }

  const gate = {
    role: !!a.role, style: !!a.style, level: !!a.level,
    age: !!a.age, solo: !!a.soloLabel,
    lessons: true, studio: !!a.studioId || a.noStudio || a.createStudio,
    coach: !!a.coachId || a.noCoach, recap: true,
    recall: a.recall.trim().length > 11, analysing: false, focusLocked: true, focusLive: true,
    minorExplain: true,
    minorParent: !!((a.editingInvite || a.name.trim()) && a.parentFirstName.trim()
      && EMAIL_OK.test(a.parentEmail.trim()) && PHONE_OK(a.parentPhone)),
    minorWaiting: true,
    parentCode: a.invToken.replace(/[^A-Za-z0-9]/g, '').length === 12 && /^[0-9]{6}$/.test(a.invCode),
    parentContext: true, parentWhat: true,
    parentConsent: a.checks.every(Boolean),
    parentAccount: !!a.consent && (a.consent.accountExists || a.parentPassword.length >= 8),
    parentDone: true,
    correct: a.correct.trim().length > 2, words: a.words.length > 0,
    signature: a.signature.trim().length > 2, alloc: true, leave: a.leave.length > 0,
    who: a.who.length > 0, cred: true, cardLocked: true, planReady: true, cardLive: true, confirm: true,
    account: !!(a.name.trim() && a.email.trim() && a.password.length >= 6
      && (!isParent || a.childName.trim())),
  }[step];

  const allocLeft = 100 - AXES.reduce((t, k) => t + a.alloc[k], 0);
  const planLine = [a.role && (isCoach ? 'Coach' : 'Student'), a.style, a.level].filter(Boolean).join(' · ');

  function body() {
    switch (step) {
      case 'role': return (
        <Q h1="How will you use InBetween?" sub="This sets up your home screen from the start." plan={planLine}>
          {ROLES.map((r, i) => (
            <Opt key={r.v} t={r.t} d={r.d} on={a.role === r.v} delay={0.1 + i * 0.06}
              onPress={() => { haptic(); set({ role: r.v }); }} />
          ))}
        </Q>
      );
      case 'style': return (
        <Q plan={planLine} {...qc(copy('style',
          isCoach ? 'Which style do you teach?' : 'Your dance style',
          isCoach ? 'This decides which dances appear across your students.' : 'This decides which dances appear in your focus list.'))}>
          {STYLES.map((r, i) => (
            <Opt key={r.v} t={r.t} d={r.d} on={a.style === r.v} delay={0.1 + i * 0.06}
              onPress={() => { haptic(); set({ style: r.v }); }} />
          ))}
        </Q>
      );
      case 'level': return (
        <Q plan={planLine} {...qc(copy('level', 'Where are you now?', 'Your level sets the depth of the corrections you’ll get.'))}>
          {LEVELS.map((r, i) => (
            <Rung key={r.v} t={r.t} d={r.d} filled={r.pips} total={5} on={a.level === r.v} delay={0.1 + i * 0.06}
              onPress={() => { haptic(); set({ level: r.v }); }} />
          ))}
        </Q>
      );
      case 'age': return (
        <Q plan={planLine} {...qc(copy('age', 'Your age category', 'Competition grading works by age — it keeps your focus list realistic.'))}>
          {AGES.map((r, i) => (
            <Opt key={r.v} t={r.t} d={r.d} on={a.age === r.v} delay={0.1 + i * 0.06}
              onPress={() => { haptic(); set({ age: r.v }); }} />
          ))}
        </Q>
      );
      case 'solo': return (
        <Q plan={planLine} {...qc(copy('solo', 'How often do you train solo?', 'Between lessons, on your own. Your weekly target is built from this.'))}>
          {SOLO.map((r, i) => (
            <Opt key={r.t} t={r.t} d={r.d} on={a.soloLabel === r.t} delay={0.1 + i * 0.06}
              onPress={() => { haptic(); set({ solo: r.v, soloLabel: r.t }); }} />
          ))}
        </Q>
      );
      case 'lessons': return (
        <Q plan={planLine} {...qc(copy('lessons', 'Private lessons a month?', 'On average — reminders get timed around them.'))}>
          <View style={s.count}>
            <View style={s.ctl}>
              <TouchableOpacity style={[s.rnd, a.lessons === 0 && s.rndOff]} onPress={() => stepLessons(-1)}
                disabled={a.lessons === 0} accessibilityRole="button" accessibilityLabel="One fewer lesson">
                <Text style={s.rndT}>−</Text>
              </TouchableOpacity>
              <Animated.Text style={[s.countN, { transform: [{ scale: bump }] }]} allowFontScaling={false}>
                {a.lessons}
              </Animated.Text>
              <TouchableOpacity style={[s.rnd, a.lessons === 10 && s.rndOff]} onPress={() => stepLessons(1)}
                disabled={a.lessons === 10} accessibilityRole="button" accessibilityLabel="One more lesson">
                <Text style={s.rndT}>+</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.cons}>
              <Text style={s.consB}>{a.lessons * 12}</Text> a year · 45 min each
            </Text>
            <Text style={s.cons}>Set it to zero if you only take group classes.</Text>
          </View>
        </Q>
      );
      case 'studio': return (
        <Q plan={planLine} {...qc(copy('studio', 'Find your studio',
          isCoach ? 'Connect it to sync your classes and your student list.' : 'Connect it and your coach’s corrections land straight in your app.'))}>
          <View style={s.search}>
            <SearchIcon />
            <TextInput style={s.searchIn} value={query} placeholder="Search studios…" placeholderTextColor={T.ink3}
              onChangeText={(t) => { setQuery(t); set({ studioId: null, createStudio: false }); }} autoCorrect={false} />
          </View>
          {studiosLoading ? <ActivityIndicator color={T.gold} style={{ marginTop: 24 }} /> : (
            <View style={{ marginTop: 16 }}>
              {filterStudios(studios, query).slice(0, 5).map((st, i) => (
                <Opt key={st.id} t={st.name} on={a.studioId === st.id} delay={0.1 + i * 0.06}
                  onPress={() => { haptic(); set({ studioId: st.id, studioName: st.name, noStudio: false, createStudio: false }); }} />
              ))}
              {isCoach && query.trim().length >= 2 && !hasExactMatch(studios, query.trim()) && (
                <Opt t={`Create “${query.trim()}”`} d="We’ll set it up with you after sign-up" on={a.createStudio} delay={0.1}
                  onPress={() => { haptic(); set({ createStudio: true, studioId: null, studioName: query.trim(), noStudio: false }); }} />
              )}
              <AddRow title="Can’t find your studio?" sub="Invite them to InBetween"
                onPress={() => { haptic(); setNoticeFor('studio'); set({ studioId: null, createStudio: false, studioName: '' }); }} />
              {noticeFor === 'studio' && (
                <Notice
                  lead="Can’t find your studio?"
                  body={isCoach
                    ? 'Submit it and we’ll add it manually — this won’t hold up your setup.'
                    : 'Without one, nothing syncs automatically — you’ll add lessons and coaches by hand.'}
                  inviteLabel={isCoach ? 'Submit my studio' : 'Invite them'}
                  invited={invited === 'studio'}
                  onInvite={() => { haptic(); setInvited('studio'); set({ noStudio: true }); }}
                  onSkip={() => { haptic(); set({ noStudio: true, studioId: null, createStudio: false, studioName: '' }); next(); }}
                />
              )}
            </View>
          )}
        </Q>
      );
      case 'coach': return (
        <Q plan={planLine} {...qc(copy('coach', 'Is your coach here?',
          a.studioName ? `${a.studioName} — pick who teaches you. Their corrections land straight in your app.`
            : 'Pick who teaches you. Their corrections land straight in your app.'))}>
          {coachesLoading ? <ActivityIndicator color={T.gold} style={{ marginTop: 24 }} /> : (
            <View>
              {coaches.map((c, i) => (
                <Opt key={c.id} t={c.name || 'Coach'} d={[c.dance_style, a.studioName].filter(Boolean).join(' · ')}
                  on={a.coachId === c.id} delay={0.1 + i * 0.06}
                  onPress={() => { haptic(); set({ coachId: c.id, coachName: c.name || 'Coach', noCoach: false }); }} />
              ))}
              <AddRow title="Can’t find your coach?" sub="Invite them to InBetween"
                onPress={() => { haptic(); setNoticeFor('coach'); set({ coachId: null, coachName: '' }); }} />
              {noticeFor === 'coach' && (
                <Notice
                  lead="Can’t find your coach?"
                  body="Without one you get focus points from your own recall — new ones come from corrections a coach captures in your lessons."
                  inviteLabel="Invite them"
                  invited={invited === 'coach'}
                  onInvite={() => { haptic(); setInvited('coach'); set({ noCoach: true }); }}
                  onSkip={() => { haptic(); set({ noCoach: true, coachId: null, coachName: '' }); next(); }}
                />
              )}
            </View>
          )}
        </Q>
      );

      case 'recall': return (
        <Q grow {...qc(copy('recall', 'Recall your last lesson',
          'Type what your coach worked on. We’ll turn it into focus points you can train tonight.'))}>
          <Rise delay={0.1} style={s.grow}>
            <TextInput style={s.taTall} value={a.recall} onChangeText={(t) => set({ recall: t })} multiline
              textAlignVertical="top" scrollEnabled
              placeholder="She kept saying my hip wasn’t opening on the rumba walk, and my samba bounce dies halfway through the bar…"
              placeholderTextColor={T.ink3} />
          </Rise>
          {!!error && <Text style={s.err}>{error}</Text>}
          <TouchableOpacity onPress={() => { haptic(); set({ recall: '', focus: [] }); go('planReady'); }}
            style={s.later} accessibilityRole="button">
            <Text style={s.laterT}>I’ll add a lesson later</Text>
          </TouchableOpacity>
        </Q>
      );

      case 'analysing': return <Analysing style={a.style} />;

      case 'focusLocked': return (
        <Q h1={`${fpWord(a.focus.length)}, ready`}
          sub={`Pulled from your own words. ${a.focus.reduce((t, f) => t + f.minutes, 0)} minutes of work tonight.`}>
          {a.focus.map((f, i) => (
            <Rise key={f.name + i} delay={0.1 + i * 0.06}>
              {/* the comp keeps the first title legible: one real piece of the
                  answer, enough to prove it came from their own words */}
              <View style={s.fpc}>
                <Text style={s.fpEb}>{[f.dance, f.tier === 'critical' ? 'critical' : 'this week'].filter(Boolean).join(' · ')}</Text>
                <Veil on={i > 0}><Text style={s.fpB}>{f.name}</Text></Veil>
                <Veil on><Text style={s.fpS}>{f.drills} drills · {f.minutes} min{f.subtitle ? ` · ${f.subtitle}` : ''}</Text></Veil>
              </View>
            </Rise>
          ))}
          <Rise delay={0.34}>
            <View style={s.lockbar}>
              <LockIcon color={T.goldInk} size={16} />
              <Text style={s.lockT}>Create your account to unlock them and keep them forever.</Text>
            </View>
          </Rise>
        </Q>
      );

      case 'focusLive': return (
        <Q h1={`You’re in, ${a.name.trim().split(/\s+/)[0] || 'welcome'}`} big
          sub={`${fpWord(a.focus.length)} from your last lesson — ready tonight.`}>
          {a.focus.map((f, i) => (
            <Rise key={f.name + i} delay={0.1 + i * 0.18}>
              <View style={s.fpc}>
                <Text style={s.fpEb}>{[f.dance, f.tier === 'critical' ? 'critical' : 'this week'].filter(Boolean).join(' · ')}</Text>
                <Text style={s.fpB}>{f.name}</Text>
                <Text style={s.fpS}>{f.drills} drills · {f.minutes} min{f.subtitle ? ` · ${f.subtitle}` : ''}</Text>
              </View>
            </Rise>
          ))}
        </Q>
      );

      case 'minorExplain': return (
        <Q h1="This part needs a grown-up"
          sub="Because you’re under 18, a parent or guardian holds the account and gives permission for your lessons to be captured.">
          <Rise delay={0.1}>
            <Text style={s.para}>They’ll get everything you would — your focus points, your progress. You’ll see it all on their account.</Text>
          </Rise>
        </Q>
      );

      case 'minorParent': return (
        <Q h1={a.editingInvite ? 'Correct their details' : 'Who’s your parent or guardian?'}>
          <View style={s.fields}>
            {!a.editingInvite && (
              <Rise delay={0}><Field label="Your first name" value={a.name} onChange={(t) => set({ name: t })}
                placeholder="Emma" autoCapitalize="words" /></Rise>
            )}
            <Rise delay={0.04}><Field label="Their first name" value={a.parentFirstName}
              onChange={(t) => set({ parentFirstName: t })} placeholder="Sarah" autoCapitalize="words" /></Rise>
            <Rise delay={0.08}><Field label="Their email" value={a.parentEmail} onChange={(t) => set({ parentEmail: t })}
              placeholder="sarah@email.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" /></Rise>
            <Rise delay={0.12}><Field label="Their mobile number" value={a.parentPhone} onChange={(t) => set({ parentPhone: t })}
              placeholder="+44 7700 900123" keyboardType="phone-pad" /></Rise>
          </View>
          <Text style={s.fieldNote}>We’ll send them a link. Nothing is recorded until they approve.</Text>
          {!!error && <Text style={s.err}>{error}</Text>}
        </Q>
      );

      case 'minorWaiting': {
        if (a.inviteStatus === 'withdrawn' || a.inviteClosed) return (
          <Q h1="This invitation is closed"
            sub="It was withdrawn, or it can’t be used any more. You can start again whenever you’re ready." />
        );
        if (a.inviteStatus === 'approved') return (
          <Q h1={`${a.parentFirstName || 'Your parent'} said yes`}
            sub="Sign in with their account to see your focus points. Your coach can start capturing your lessons." />
        );
        return (
          <Q h1={`Invitation sent to ${a.parentEmail || a.maskedEmail}`} sub="We’ve also texted them.">
            <Rise delay={0.1}>
              <Text style={s.para}>Once they approve, your coach can start capturing your lessons.</Text>
            </Rise>
            {a.inviteStatus === 'expired' && <Text style={s.err}>This invitation has expired. Send it again.</Text>}
            {!!a.inviteNote && <Text style={s.fieldNote}>{a.inviteNote}</Text>}
            {!!error && <Text style={s.err}>{error}</Text>}
            <View style={s.waitActs}>
              <TouchableOpacity style={s.later} onPress={doResend} accessibilityRole="button">
                <Text style={s.laterT}>Resend</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.later} accessibilityRole="button"
                onPress={() => { setError(''); set({ editingInvite: true }); go('minorParent', -1); }}>
                <Text style={s.laterT}>Correct their details</Text>
              </TouchableOpacity>
            </View>
          </Q>
        );
      }

      case 'parentCode': return (
        <Q h1="Your invitation" sub="Enter the code from the email, then the 6-digit code we texted you. You need both.">
          <View style={s.fields}>
            <Rise delay={0}><Field label="Email code" value={a.invToken} onChange={(t) => set({ invToken: t })}
              placeholder="ABCD-EFGH-JKMN" autoCapitalize="characters" autoCorrect={false} /></Rise>
            <Rise delay={0.05}><Field label="Text message code" value={a.invCode}
              onChange={(t) => set({ invCode: t.replace(/\D/g, '').slice(0, 6) })}
              placeholder="123456" keyboardType="number-pad" textContentType="oneTimeCode" /></Rise>
          </View>
          {!!error && <Text style={s.err}>{error}</Text>}
        </Q>
      );

      case 'parentContext': return (
        <Q big h1={a.consent?.copy?.context?.title || ''} sub={a.consent?.copy?.context?.subtitle || undefined} />
      );

      case 'parentWhat': return (
        <Q h1="What happens">
          {(a.consent?.copy?.what || []).map((line, i) => (
            <Rise key={line} delay={0.08 + i * 0.05}>
              <View style={s.bullet}><View style={s.bulletDot} /><Text style={s.bulletT}>{line}</Text></View>
            </Rise>
          ))}
        </Q>
      );

      case 'parentConsent': return (
        <Q h1="Your permission">
          {(a.consent?.copy?.checks || []).map((line, i) => (
            <Rise key={line} delay={0.08 + i * 0.06}>
              <CheckRow label={line} on={a.checks[i]}
                onPress={() => { haptic(); set({ checks: a.checks.map((c, k) => (k === i ? !c : c)) }); }} />
            </Rise>
          ))}
        </Q>
      );

      case 'parentAccount': return a.consent?.accountExists ? (
        <Q h1="You already have an account" sub={`${a.consent.parentEmail} — you’ll sign in with your existing password.`}>
          {!!error && <Text style={s.err}>{error}</Text>}
        </Q>
      ) : (
        <Q h1="Create your account"
          sub={`This account holds ${a.consent?.childName || 'your child'}’s training. You’ll sign in with ${a.consent?.parentEmail || 'your email'}.`}>
          <Rise delay={0.05}><Field label="Password" value={a.parentPassword} onChange={(t) => set({ parentPassword: t })}
            placeholder="At least 8 characters" secureTextEntry textContentType="newPassword" /></Rise>
          {!!error && <Text style={s.err}>{error}</Text>}
        </Q>
      );

      case 'parentDone': return (
        <Q big h1={`${a.consent?.childName || 'Your child'} is set up`}
          sub="You’ll receive their focus points after every lesson. Manage everything from your account." />
      );

      case 'recap': return (
        <Q plan={planLine} h1="Does this look right?" sub="Tap anything to change it.">
          <Rise delay={0.1}>
            <View style={s.recap}>
              <Row k="Role" v={isCoach ? 'Coach' : isParent ? 'Parent' : 'Student'} onPress={() => go('role', -1)} first />
              <Row k="Style" v={a.style} onPress={() => go('style', -1)} />
              {!isCoach && <Row k="Level" v={a.level} onPress={() => go('level', -1)} />}
              {!isCoach && <Row k="Age" v={a.age} onPress={() => go('age', -1)} />}
              {!isCoach && <Row k="Solo" v={a.soloLabel} onPress={() => go('solo', -1)} />}
              {!isCoach && <Row k="Lessons" v={`${a.lessons} a month`} onPress={() => go('lessons', -1)} />}
              <Row k="Studio" v={a.studioName || 'Not connected'} onPress={() => go('studio', -1)} />
              {!isCoach && <Row k="Coach" v={a.coachName || (a.noCoach ? 'Not connected' : '—')} onPress={() => go('coach', -1)} />}
            </View>
          </Rise>
        </Q>
      );

      case 'correct': return (
        <Q h1="Describe how you correct a student."
          sub="Not your philosophy — the actual thing you do. For example: I dance next to them until the body understands.">
          <Rise delay={0.1}>
            <TextInput style={s.ta} value={a.correct} onChangeText={(t) => set({ correct: t })} multiline
              textAlignVertical="top" placeholder="I dance beside them until their body finds it…" placeholderTextColor={T.ink3} />
          </Rise>
        </Q>
      );
      case 'words': return (
        <Q h1="Your teaching style" sub="Pick up to three. These become the words on your card.">
          <Rise delay={0.1}><View style={s.picks}>
            {WORDS.map((w) => <Pick key={w} label={w} on={a.words.includes(w)} onPress={() => toggle('words', w, 3)} />)}
          </View></Rise>
        </Q>
      );
      case 'signature': return (
        <Q h1="There’s one thing you say to almost every student." sub="What is it?">
          <Rise delay={0.1}>
            <TextInput style={s.ta} value={a.signature} onChangeText={(t) => set({ signature: t })} multiline
              textAlignVertical="top" placeholder="Stop rushing the foot — settle, then move…" placeholderTextColor={T.ink3} />
          </Rise>
        </Q>
      );
      case 'alloc': return (
        <Q h1="In an hour with an adult, where does your time go?" sub="Spend 100 points.">
          <Rise delay={0.1}><View style={s.alloc}>
            {AXES.map((k) => (
              <View key={k} style={s.allocRow}>
                <View style={s.al}>
                  <Text style={s.alB}>{k}</Text>
                  <Text style={s.alI} allowFontScaling={false}>{a.alloc[k]}</Text>
                </View>
                <Slider minimumValue={0} maximumValue={100} step={5} value={a.alloc[k]}
                  onValueChange={(v) => set({ alloc: { ...a.alloc, [k]: Math.round(v) } })}
                  minimumTrackTintColor={T.gold} maximumTrackTintColor="rgba(10,10,10,0.12)" thumbTintColor={T.gold} />
              </View>
            ))}
          </View></Rise>
        </Q>
      );
      case 'leave': return (
        <Q h1="A student leaves your lesson with what?" sub="Pick up to two.">
          <Rise delay={0.1}><View style={s.picks}>
            {LEAVE.map((w) => <Pick key={w} label={w} on={a.leave.includes(w)} onPress={() => toggle('leave', w, 2)} />)}
          </View></Rise>
        </Q>
      );
      case 'who': return (
        <Q h1="Who do you work with?"
          sub="Pick up to three. It’s the first thing a student checks — and it saves you the lessons you don’t want.">
          <Rise delay={0.1}><View style={s.picks}>
            {WHO.map((w) => <Pick key={w} label={w} on={a.who.includes(w)} onPress={() => toggle('who', w, 3)} />)}
          </View></Rise>
        </Q>
      );
      case 'cred': return (
        <Q h1="Anything you want shown under your name?" sub="A title, a result, or the year you started teaching. Optional.">
          <Rise delay={0.1}>
            <Field label="Credential" value={a.cred} onChange={(t) => set({ cred: t })}
              placeholder="World Champion · Teaching since 2004" />
          </Rise>
        </Q>
      );

      case 'planReady': return (
        <Q h1="Your plan is ready." sub="Add your first lesson whenever you’re ready — focus points come from it.">
          <Rise delay={0.1}>
            <View style={s.pcard}>
              <View style={s.peb}>
                <Text style={s.pebT}>WEEKLY TARGET</Text>
                <Text style={s.pebT}>{[a.level, a.style].filter(Boolean).join(' · ') || 'Your plan'}</Text>
              </View>
              <View style={s.pd1}>
                <Text style={s.pd1B} allowFontScaling={false}>{weeklyTarget(a)}</Text>
                <Text style={s.pd1S}>min a week</Text>
              </View>
              <View style={s.meter}><View style={s.meterFill} /></View>
              <Text style={s.pp}>
                Built from <Text style={s.ppB}>{a.soloLabel.toLowerCase() || 'solo practice'}</Text> and{' '}
                <Text style={s.ppB}>{a.lessons} private lesson{a.lessons === 1 ? '' : 's'}</Text> a month.
              </Text>
            </View>
          </Rise>
        </Q>
      );

      case 'cardLocked': return (
        <Q h1="Your card is built."
          sub="Assembled from your own answers. This is what a student reads before booking you.">
          {/* cut by the fold, not dissolved: the scrim is the card's own black */}
          <Rise delay={0.15} duration={700}>
            <View style={s.peek}>
              <CoachCard card={toCard(a)} locked />
              <LinearGradient colors={['rgba(10,10,10,0)', 'rgba(10,10,10,0.74)', D.bg]} locations={[0, 0.58, 1]}
                style={s.peekFade} pointerEvents="none" />
            </View>
          </Rise>
          <Rise delay={0.34}>
            <View style={s.lockbar}>
              <LockIcon color={T.goldInk} size={16} />
              <Text style={s.lockT}>Create your account to publish it and get your link.</Text>
            </View>
          </Rise>
        </Q>
      );

      case 'cardLive': return (
        <Q h1="It’s live. Here’s your link." big>
          <Rise delay={0.5}>
            <View style={s.link}>
              <Text style={s.linkPre}>useinbetween.com/</Text>
              <Text style={s.linkSlug}>{a.slug || slugify(a.name)}</Text>
            </View>
          </Rise>
          <Rise delay={0.15} duration={700}><CoachCard card={toCard(a)} /></Rise>
          <Text style={s.lead}>Send it to anyone who asks about lessons. You can adjust it whenever you want.</Text>
        </Q>
      );

      case 'confirm': return (
        <Q h1="Check your inbox." sub={`We sent a confirmation link to ${a.email.trim()}. Open it and you’re in.`} />
      );

      default: return ( // account
        <Q h1={isCoach ? 'Publish your coach card' : 'Save your plan'}
          sub={isCoach ? 'Under a minute. Your card is built and waiting.'
            : isParent ? 'Under a minute. The account is yours; the training is theirs.'
            : 'Under a minute. Everything you just set up is already in.'}>
          <View style={s.fields}>
            <Rise delay={0}><Field label="Your name" value={a.name} onChange={(t) => set({ name: t })}
              placeholder="Alexandra Lambert" autoCapitalize="words" textContentType="name" /></Rise>
            {isParent && (
              <Rise delay={0.03}><Field label="Your child’s name" value={a.childName}
                onChange={(t) => set({ childName: t })} placeholder="Léa Lambert" autoCapitalize="words" /></Rise>
            )}
            <Rise delay={0.06}><Field label="Email" value={a.email} onChange={(t) => set({ email: t })}
              placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" textContentType="emailAddress" /></Rise>
            <Rise delay={0.12}><Field label="Password" value={a.password} onChange={(t) => set({ password: t })}
              placeholder="Min. 6 characters" secureTextEntry textContentType="newPassword" /></Rise>
          </View>
          {!!error && <Text style={s.err}>{error}</Text>}
        </Q>
      );
    }
  }

  if (step === 'welcome') {
    return (
      <View style={[s.phone, s.phoneDark, { paddingTop: insets.top, paddingBottom: insets.bottom + 8 }]}>
        <Welcome onStart={() => go('role')} onSignIn={() => navigation.navigate('Login')}
          onInvitation={() => { setError(''); go('parentCode'); }} />
      </View>
    );
  }

  const ctaLabel = step === 'age' && isMinor ? 'Continue with a parent'
    : step === 'minorParent' ? (a.editingInvite ? 'Update and resend' : 'Send invitation')
    : step === 'minorWaiting' ? (a.inviteStatus === 'withdrawn' || a.inviteClosed ? 'Start again'
      : a.inviteStatus === 'approved' ? 'Go to sign in' : 'Check again')
    : step === 'parentConsent' ? 'Give permission'
    : step === 'parentAccount' ? 'Finish'
    : step === 'parentDone' ? 'Sign in'
    : step === 'focusLive' ? `Start tonight’s session · ${a.focus.reduce((t, f) => t + f.minutes, 0)} min`
    : step === 'focusLocked' ? 'See it'
    : step === 'recall' ? 'Build my focus points'
    : step === 'cardLocked' ? 'See it'
    : step === 'planReady' ? 'Save my plan'
    : step === 'account' ? (isCoach ? 'Publish my card' : 'Create account')
    : step === 'cardLive' ? 'Done'
    : step === 'confirm' ? 'Go to sign in'
    : step === 'cred' ? 'Build my card'
    : step === 'recap' ? 'Looks right' : 'Continue';

  const whyLine = {
    role: 'Switch roles any time — nothing is locked in.',
    studio: isCoach ? 'Submitting a studio never holds up your setup.'
      : 'Connecting a studio pulls in your coaches and classes.',
    coach: 'They’ll see you in their student list once you join.',
    words: `${a.words.length} of 3 chosen`,
    leave: `${a.leave.length} of 2 chosen`,
    who: `${a.who.length} of 3 chosen`,
    alloc: allocLeft === 0 ? 'All 100 spent' : `${allocLeft} points left`,
  }[step];

  function onCta() {
    if (step === 'minorWaiting') {
      if (a.inviteStatus === 'withdrawn' || a.inviteClosed) {
        clearPendingInvite();
        set({ inviteId: '', deviceSecret: '', inviteStatus: '', inviteClosed: false, inviteNote: '',
          parentFirstName: '', parentEmail: '', parentPhone: '' });
        setError('');
        return go('welcome', -1);
      }
      if (a.inviteStatus !== 'approved') return refreshInvite();
      clearPendingInvite();
      return navigation.navigate('Login');
    }
    if (step === 'parentDone') return navigation.navigate('Login');
    if (step === 'account') return submit();
    if (step === 'cardLive' || step === 'focusLive') return setOnboardingHold(false);
    if (step === 'confirm') return navigation.navigate('Login');
    next();
  }

  return (
    <View style={[s.phone, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top}>
        {!['cardLive', 'focusLive', 'confirm', 'analysing', 'minorWaiting', 'parentDone'].includes(step) && <TopBar onBack={back} progress={progress} />}
        <ScreenIn step={step} dir={dir}>
          <ScrollView ref={scroller} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
            {body()}
          </ScrollView>
        </ScreenIn>
        {step !== 'analysing' && (
          <View style={[s.foot, { paddingBottom: insets.bottom + 20 }]}>
            <LinearGradient colors={['rgba(242,240,235,0)', T.screen]} style={s.footFade} pointerEvents="none" />
            {!!whyLine && <Text style={s.why}>{whyLine}</Text>}
            <Cta label={ctaLabel} onPress={onCta} disabled={!gate} busy={busy} />
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

// role-aware copy → the two props Q takes
const qc = ([h1, sub]) => ({ h1, sub });

function Q({ h1, sub, plan, big, grow, children }) {
  return (
    <View style={grow && s.grow}>
      {!!plan && <Text style={s.plan}>{plan}</Text>}
      <Rise><Text style={[s.h1, big && s.h1Big]}>{h1}</Text></Rise>
      {!!sub && <Rise delay={0.05}><Text style={s.sub}>{sub}</Text></Rise>}
      <View style={[s.qbody, grow && s.grow]}>{children}</View>
    </View>
  );
}

const COUNTS = ['No', 'One', 'Two', 'Three', 'Four', 'Five'];
// The model returns fewer than three when the recall is thin, so the copy
// counts what actually came back rather than promising three.
const countWord = (n) => COUNTS[n] || String(n);
const fpWord = (n) => `${COUNTS[n] || n} focus point${n === 1 ? '' : 's'}`;

// .opt with a + avatar — the row that admits the list may not hold you
function AddRow({ title, sub, onPress }) {
  return (
    <TouchableOpacity style={s.opt} onPress={onPress} activeOpacity={0.9} accessibilityRole="button">
      <View style={s.avAdd}><Text style={s.avAddT}>+</Text></View>
      <View style={s.optTxt}>
        <Text style={s.optB}>{title}</Text>
        <Text style={s.optS}>{sub}</Text>
      </View>
    </TouchableOpacity>
  );
}

// A consent box. Never ticked on arrival, and the whole row is the target, so
// a parent is never hunting for a 22-point square.
function CheckRow({ label, on, onPress }) {
  return (
    <TouchableOpacity style={[s.check, on && s.checkOn]} onPress={onPress} activeOpacity={0.85}
      accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      <View style={[s.box, on && s.boxOn]}>{on ? <Check on size={13} width={3} /> : null}</View>
      <Text style={s.checkT}>{label}</Text>
    </TouchableOpacity>
  );
}

// .notice — says what continuing without it actually costs, then offers both
function Notice({ lead, body, inviteLabel, invited, onInvite, onSkip }) {
  return (
    <Rise>
      <View style={s.notice}>
        <Text style={s.noticeP}><Text style={s.noticeB}>{lead}</Text> {body}</Text>
        <View style={s.noticeActs}>
          <TouchableOpacity style={[s.invite, invited && s.inviteDone]} onPress={onInvite} disabled={invited}
            activeOpacity={0.85} accessibilityRole="button">
            <Text style={s.inviteT}>{invited ? `${inviteLabel} ✓` : inviteLabel}</Text>
          </TouchableOpacity>
          {!!onSkip && (
            <TouchableOpacity style={s.later} onPress={onSkip} activeOpacity={0.85} accessibilityRole="button">
              <Text style={s.laterT}>Continue anyway</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Rise>
  );
}

// screen 10 — the orb turns while the three lines tick over in sequence
function Analysing({ style }) {
  const spin = useRef(new Animated.Value(0)).current;
  const [done, setDone] = useState(0);
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    const t1 = setTimeout(() => setDone(1), 700);
    const t2 = setTimeout(() => setDone(2), 1500);
    const t3 = setTimeout(() => setDone(3), 2400);
    return () => { loop.stop(); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [spin]);
  const lines = ['Reading your lesson', `Matching the ${style || 'Latin'} syllabus`, 'Building your focus points'];
  return (
    <View style={s.load}>
      <Animated.View style={[s.orb, { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}>
        <LinearGradient colors={[T.gold300, T.gold, 'rgba(232,181,48,0.15)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill} />
        <View style={s.orbHole} />
      </Animated.View>
      <View style={s.loadSteps}>
        {lines.map((l, i) => (
          <View key={l} style={s.loadRow}>
            <View style={[s.bx, i < done && s.bxOn]}><Check on={i < done} size={11} width={3} /></View>
            <Text style={[s.loadT, i < done && s.loadTOn]}>{l}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Row({ k, v, onPress, first }) {
  return (
    <TouchableOpacity style={[s.rrow, !first && s.rrowSep]} onPress={onPress} activeOpacity={0.7}
      accessibilityRole="button" accessibilityLabel={`${k}: ${v}. Change it.`}>
      <Text style={s.rk}>{k}</Text>
      <Text style={s.rv} numberOfLines={1}>{v || '—'}</Text>
      <Text style={s.re}>Edit</Text>
    </TouchableOpacity>
  );
}

// Sizes, spacing and colour below are the comp's, converted from its units:
// em letter-spacing × font-size, unitless line-height × font-size.
const s = StyleSheet.create({
  phone: { flex: 1, backgroundColor: T.screen },
  phoneDark: { backgroundColor: T.dark },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 34 },

  // .top / .back / .shelf
  top: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 24, paddingTop: 8 },
  back: { width: 38, height: 38, borderRadius: 12, backgroundColor: T.card, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#0A0A0A', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  shelf: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(10,10,10,0.10)', overflow: 'hidden' },
  shelfFill: { height: '100%', borderRadius: 3, overflow: 'hidden' },

  // .plan / h1 / .sub
  plan: { marginTop: 14, fontFamily: Fonts.travelsRegular, fontSize: 12, lineHeight: 17, color: T.ink2 },
  h1: { marginTop: 22, fontFamily: Fonts.ttBold, fontSize: 33, lineHeight: 35, letterSpacing: -1.16, color: T.ink },
  h1Big: { fontSize: 29, lineHeight: 32, letterSpacing: -1, textAlign: 'center' },
  sub: { marginTop: 10, fontFamily: Fonts.travelsRegular, fontSize: 14.5, lineHeight: 21, color: T.ink2 },
  qbody: { marginTop: 22 },
  grow: { flex: 1, minHeight: 0 },
  para: { fontFamily: Fonts.travelsRegular, fontSize: 15, lineHeight: 23, color: T.ink2 },
  fieldNote: { marginTop: 14, fontFamily: Fonts.travelsRegular, fontSize: 13, lineHeight: 19, color: T.ink2 },
  waitActs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 22 },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: T.line },
  bulletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.gold, marginTop: 8 },
  bulletT: { flex: 1, fontFamily: Fonts.travelsRegular, fontSize: 15, lineHeight: 22, color: T.ink },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, backgroundColor: T.card, borderRadius: 14,
    borderWidth: 1, borderColor: T.line2, paddingVertical: 16, paddingHorizontal: 16, marginBottom: 10 },
  checkOn: { borderWidth: 2, borderColor: T.gold, paddingVertical: 15, paddingHorizontal: 15 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: 'rgba(10,10,10,0.30)',
    alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: T.gold, borderColor: T.gold },
  checkT: { flex: 1, fontFamily: Fonts.travelsRegular, fontSize: 14.5, lineHeight: 21, color: T.ink },
  lead: { marginTop: 14, fontFamily: Fonts.travelsRegular, fontSize: 13.5, lineHeight: 20, color: T.ink2, textAlign: 'center' },
  err: { marginTop: 14, fontFamily: Fonts.travelsMedium, fontSize: 13, lineHeight: 19, color: '#A3281B' },

  // .opt — selection is an inset 2px ring in the comp, so the padding gives the
  // pixel back and the row never resizes under the finger
  opt: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: T.card, borderRadius: 14,
    borderWidth: 1, borderColor: T.line2, paddingVertical: 16, paddingHorizontal: 18, marginBottom: 10 },
  optOn: { borderWidth: 2, borderColor: T.gold, paddingVertical: 15, paddingHorizontal: 17 },
  optTxt: { flex: 1, minWidth: 0, gap: 4 },
  optB: { fontFamily: Fonts.ttDemiBold, fontSize: 17, letterSpacing: -0.26, color: T.ink },
  optS: { fontFamily: Fonts.travelsRegular, fontSize: 12.5, lineHeight: 17, color: T.ink2 },
  tick: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: T.gold },
  tickRing: { position: 'absolute', right: 18, width: 22, height: 22, borderRadius: 11,
    borderWidth: 1.5, borderColor: 'rgba(10,10,10,0.18)' },

  // .rung — the pips carry the level, so they lead the row
  rung: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: T.card, borderRadius: 14,
    borderWidth: 1, borderColor: T.line2, paddingVertical: 14, paddingHorizontal: 18, marginBottom: 8 },
  rungOn: { borderWidth: 2, borderColor: T.gold, paddingVertical: 13, paddingHorizontal: 17 },
  pips: { flexDirection: 'row', gap: 3 },
  pip: { width: 7, height: 20, borderRadius: 2, backgroundColor: 'rgba(10,10,10,0.12)' },
  pipOn: { backgroundColor: T.gold },
  rungTxt: { flex: 1, minWidth: 0, gap: 3 },
  rungB: { fontFamily: Fonts.ttDemiBold, fontSize: 15.5, lineHeight: 19, letterSpacing: -0.23, color: T.ink },
  rungS: { fontFamily: Fonts.travelsRegular, fontSize: 12.5, lineHeight: 17, color: T.ink2 },

  // .count
  count: { alignItems: 'center', gap: 20, paddingTop: 10 },
  ctl: { flexDirection: 'row', alignItems: 'center', gap: 26 },
  rnd: { width: 60, height: 60, borderRadius: 30, backgroundColor: T.card, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#0A0A0A', shadowOpacity: 0.07, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  rndOff: { opacity: 0.4 },
  rndT: { fontFamily: Fonts.travelsRegular, fontSize: 26, lineHeight: 32, color: T.ink },
  countN: { fontFamily: Fonts.ttExtraBold, fontSize: 88, letterSpacing: -4.4, color: T.ink,
    width: 116, textAlign: 'center', includeFontPadding: false },
  cons: { fontFamily: Fonts.travelsRegular, fontSize: 14, lineHeight: 20, color: T.ink2, textAlign: 'center' },
  consB: { fontFamily: Fonts.ttDemiBold, color: T.ink },

  // .search / .later
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: T.line3,
    borderRadius: 10, backgroundColor: T.card, paddingHorizontal: 14, height: 50 },
  searchIn: { flex: 1, fontFamily: Fonts.travelsRegular, fontSize: 15, color: T.ink, padding: 0 },
  later: { alignSelf: 'center', borderWidth: 1, borderColor: 'rgba(10,10,10,0.22)', borderRadius: 999,
    paddingVertical: 10, paddingHorizontal: 15, marginTop: 6 },
  laterT: { fontFamily: Fonts.ttDemiBold, fontSize: 12.5, color: T.ink },

  // .recap
  recap: { backgroundColor: T.card, borderWidth: 1, borderColor: T.line2, borderRadius: 14, overflow: 'hidden' },
  rrow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 18, minHeight: 52 },
  rrowSep: { borderTopWidth: 1, borderTopColor: T.line },
  rk: { width: 92, fontFamily: Fonts.travelsMedium, fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase', color: T.ink2 },
  rv: { flex: 1, fontFamily: Fonts.ttDemiBold, fontSize: 15, letterSpacing: -0.15, color: T.ink },
  re: { fontFamily: Fonts.ttDemiBold, fontSize: 12.5, color: T.goldInk },

  // .ta / .pick / .alloc
  ta: { height: 120, borderWidth: 1, borderColor: T.line3, borderRadius: 12, backgroundColor: T.card,
    padding: 15, fontFamily: Fonts.travelsRegular, fontSize: 15, lineHeight: 22, color: T.ink },
  picks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pick: { borderWidth: 1, borderColor: T.line3, backgroundColor: T.card, borderRadius: 999,
    paddingVertical: 11, paddingHorizontal: 15 },
  pickOn: { borderWidth: 2, borderColor: T.gold, paddingVertical: 10, paddingHorizontal: 14 },
  pickT: { fontFamily: Fonts.travelsRegular, fontSize: 13.5, color: T.ink },
  pickTOn: { fontFamily: Fonts.ttDemiBold },
  alloc: { gap: 17 },
  allocRow: { gap: 8 },
  al: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  alB: { fontFamily: Fonts.ttDemiBold, fontSize: 14.5, letterSpacing: -0.15, color: T.ink },
  alI: { fontFamily: Fonts.ttBold, fontSize: 17, color: T.goldInk },

  // .fields / .lbl / .field
  fields: { gap: 13 },
  field: {},
  lbl: { marginBottom: 9, fontFamily: Fonts.travelsMedium, fontSize: 10, letterSpacing: 1.4,
    textTransform: 'uppercase', color: T.ink2 },
  fieldIn: { borderWidth: 1, borderColor: T.line3, borderRadius: 10, backgroundColor: T.card,
    height: 50, paddingHorizontal: 14, justifyContent: 'center' },
  fieldOn: { borderColor: T.gold },
  input: { fontFamily: Fonts.travelsRegular, fontSize: 15, color: T.ink, padding: 0 },

  // .card — the student's plan
  pcard: { backgroundColor: T.card, borderWidth: 1, borderColor: T.line2, borderRadius: 14, padding: 17, gap: 11 },
  peb: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  pebT: { fontFamily: Fonts.travelsMedium, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: T.ink2 },
  pd1: { flexDirection: 'row', alignItems: 'baseline', gap: 9 },
  pd1B: { fontFamily: Fonts.ttExtraBold, fontSize: 29, lineHeight: 30, letterSpacing: -0.87, color: T.ink },
  pd1S: { fontFamily: Fonts.travelsRegular, fontSize: 13, color: T.ink2 },
  meter: { height: 3, borderRadius: 2, backgroundColor: 'rgba(10,10,10,0.12)' },
  meterFill: { height: '100%', width: '100%', borderRadius: 2, backgroundColor: T.gold },
  pp: { fontFamily: Fonts.travelsRegular, fontSize: 12.5, lineHeight: 18, color: T.ink2 },
  ppB: { fontFamily: Fonts.ttDemiBold, color: T.ink },

  // the glimpse
  peek: { height: 392, borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: 'hidden' },
  peekFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 112 },
  lockbar: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, backgroundColor: T.lockbar,
    paddingVertical: 12, paddingHorizontal: 14, marginTop: 16 },
  lockT: { flex: 1, fontFamily: Fonts.travelsRegular, fontSize: 13, lineHeight: 18, color: T.ink },
  link: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: T.card,
    borderWidth: 1, borderColor: T.line2, borderRadius: 12, paddingVertical: 13, marginBottom: 13 },
  linkPre: { fontFamily: Fonts.travelsRegular, fontSize: 13.5, color: T.ink2 },
  linkSlug: { fontFamily: Fonts.ttDemiBold, fontSize: 13.5, color: T.ink },

  // .foot / .cta / .ghost
  foot: { paddingHorizontal: 24, paddingTop: 14, gap: 10 },
  footFade: { position: 'absolute', left: 0, right: 0, top: -26, height: 26 },
  cta: { width: '100%', height: 56, borderRadius: 999, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ctaGold: { backgroundColor: T.gold },
  ctaInk: { backgroundColor: T.ink },
  ctaOff: { opacity: 0.38 },
  ctaT: { fontFamily: Fonts.ttDemiBold, fontSize: 15.5, letterSpacing: -0.16, color: T.ink },
  ctaTInk: { color: '#fff' },
  why: { fontFamily: Fonts.travelsRegular, fontSize: 12, lineHeight: 17, color: T.ink2, textAlign: 'center', maxWidth: 280, alignSelf: 'center' },
  ghost: { paddingVertical: 6, paddingHorizontal: 4, alignSelf: 'center' },
  ghostT: { fontFamily: Fonts.travelsRegular, fontSize: 13.5, color: T.ink2 },

  // .opt .av.add / .notice / .invite
  avAdd: { width: 42, height: 42, borderRadius: 21, backgroundColor: T.tile, alignItems: 'center', justifyContent: 'center' },
  avAddT: { fontFamily: Fonts.travelsRegular, fontSize: 22, lineHeight: 26, color: 'rgba(10,10,10,0.55)' },
  notice: { marginTop: 4, marginBottom: 10, gap: 12 },
  noticeP: { fontFamily: Fonts.travelsRegular, fontSize: 13, lineHeight: 19, color: T.ink2 },
  noticeB: { fontFamily: Fonts.ttDemiBold, color: T.ink },
  noticeActs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  invite: { backgroundColor: T.ink, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 },
  inviteDone: { backgroundColor: 'rgba(10,10,10,0.55)' },
  inviteT: { fontFamily: Fonts.ttDemiBold, fontSize: 12.5, color: '#fff' },

  // screen 09/10/11
  taTall: { flex: 1, minHeight: 150, borderWidth: 1, borderColor: T.line3, borderRadius: 12, backgroundColor: T.card,
    padding: 15, fontFamily: Fonts.travelsRegular, fontSize: 15, lineHeight: 22, color: T.ink },
  load: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 30, paddingTop: 90 },
  orb: { width: 72, height: 72, borderRadius: 36, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  orbHole: { width: 52, height: 52, borderRadius: 26, backgroundColor: T.screen },
  loadSteps: { gap: 14 },
  loadRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  bx: { width: 20, height: 20, borderRadius: 6, backgroundColor: 'rgba(10,10,10,0.08)', alignItems: 'center', justifyContent: 'center' },
  bxOn: { backgroundColor: T.gold },
  loadT: { fontFamily: Fonts.travelsRegular, fontSize: 14, color: T.ink3 },
  loadTOn: { fontFamily: Fonts.travelsMedium, color: T.ink },
  fpc: { backgroundColor: T.card, borderWidth: 1, borderColor: T.line2, borderRadius: 14,
    paddingVertical: 16, paddingHorizontal: 18, gap: 6, marginBottom: 10 },
  fpEb: { fontFamily: Fonts.travelsMedium, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: T.goldInk },
  fpB: { fontFamily: Fonts.ttDemiBold, fontSize: 16.5, lineHeight: 21, letterSpacing: -0.25, color: T.ink },
  fpS: { fontFamily: Fonts.travelsRegular, fontSize: 12.5, lineHeight: 18, color: T.ink2 },
  ghostOnDark: { color: T.onDark },

  // ── screen 00 ──
  w0: { flex: 1, paddingHorizontal: 24, paddingBottom: 8 },
  glow: { position: 'absolute', left: '-42%', top: '26%', width: '160%', height: '60%' },
  wordmark: { fontFamily: Fonts.monument, fontSize: 30, letterSpacing: -0.9, color: '#fff', paddingTop: 34 },
  mass: { flex: 1, justifyContent: 'center', gap: 22, paddingBottom: 26 },
  span: { gap: 9 },
  ends: { flexDirection: 'row', justifyContent: 'space-between' },
  endT: { fontFamily: Fonts.travelsMedium, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: T.onDark2 },
  rail: { height: 7, justifyContent: 'center' },
  railBase: { position: 'absolute', left: 3, right: 3, height: 1, backgroundColor: 'rgba(255,255,255,0.18)' },
  railFill: { position: 'absolute', left: 3, height: 1, overflow: 'hidden' },
  spark: { position: 'absolute', left: 3, width: 5, height: 5, borderRadius: 2.5, backgroundColor: T.gold300,
    shadowColor: T.gold, shadowOpacity: 0.85, shadowRadius: 7, shadowOffset: { width: 0, height: 0 } },
  dot: { position: 'absolute', width: 7, height: 7, borderRadius: 3.5 },
  dotA: { left: 0, backgroundColor: T.gold },
  dotB: { right: 0 },
  mid: { fontFamily: Fonts.travelsRegular, fontSize: 12, letterSpacing: 0.12, color: T.gold },
  lineMask: { overflow: 'hidden' },
  w0h2: { fontFamily: Fonts.ttBold, fontSize: 42, lineHeight: 44, letterSpacing: -1.76, color: '#fff' },
  w0p: { fontFamily: Fonts.travelsRegular, fontSize: 15, lineHeight: 23, color: T.onDark, maxWidth: 300 },
  acts0: { gap: 12 },
});
