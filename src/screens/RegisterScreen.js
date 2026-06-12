// Register — multi-step onboarding flow (cream + gold design).
//
// Flow (student): form → role (1/5) → dance (2/5) → studio (3/5, skip)
//   → lessons (4/5, skip) → solo (5/5, skip)
//   → ready → confirm (only when email confirmation is on).
// Coaches get the short path: role → dance → studio → ready.
//
// The account is created at the END of the flow ("Enter InBetween" on the
// ready screen): with email confirmation enabled signUp returns no session,
// so onboarding answers travel in the auth metadata and the handle_new_user
// trigger copies them into public.users. When a session IS returned we also
// write the row directly and App.js's onAuthStateChange swaps navigators.

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Animated,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '../services/supabase/client';
import { Fonts, Spacing, Onboard } from '../theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { filterStudios, hasExactMatch } from '../utils/studioMatch';
import { isValidEmail, passwordStrength } from '../utils/authValidation';
import PasswordField from '../components/PasswordField';

const TERMS_URL = 'https://www.useinbetween.com/terms';
const PRIVACY_URL = 'https://www.useinbetween.com/privacy';

const ROLE_OPTIONS = [
  { value: 'student', title: 'Student', desc: 'Train your focus points', icon: 'person-outline' },
  { value: 'coach', title: 'Coach', desc: 'Run classes & assign focus', icon: 'megaphone-outline' },
];

const DANCE_OPTIONS = [
  { value: 'Latin', title: 'Latin', desc: 'Cha Cha, Rumba, Samba…', icon: 'musical-notes-outline' },
  { value: 'Ballroom', title: 'Ballroom', desc: 'Waltz, Tango, Foxtrot…', icon: 'star-outline' },
  { value: 'Latin & Ballroom', title: 'Both styles', desc: 'Latin & Ballroom', icon: 'infinite-outline' },
];

const SOLO_OPTIONS = [
  { value: 'few_per_month', title: 'A few times a month', chip: 'Solo: a few / mo', icon: 'calendar-outline' },
  { value: '1_2_per_week', title: '1 to 2 times a week', chip: 'Solo: 1 to 2 / wk', icon: 'time-outline' },
  { value: '3_4_per_week', title: '3 to 4 times a week', chip: 'Solo: 3 to 4 / wk', icon: 'flame-outline' },
  { value: 'almost_daily', title: 'Almost daily', chip: 'Solo: daily', icon: 'flash-outline' },
];

const LESSONS_DEFAULT = 3;
const LESSONS_MIN = 0;
const LESSONS_MAX = 30;

// Light tactile feedback on selection. No-op on devices without a haptics
// engine; never let it throw into the UI.
function haptic() {
  Haptics.selectionAsync().catch(() => {});
}

function strengthColor(level) {
  // Red is reserved for level 0 (below the 6-char minimum, actually blocked).
  // A valid-but-weak password reads amber, not the same red as error states.
  if (level === 0) return Onboard.error;
  if (level === 1) return Onboard.gold400;
  if (level === 2) return Onboard.gold;
  return Onboard.success;
}

// Progress steps per role — the account form sits before the bar starts.
function progressStepsFor(role) {
  return role === 'coach'
    ? ['role', 'dance', 'studio']
    : ['role', 'dance', 'studio', 'lessons', 'solo'];
}

function ProgressBar({ steps, current }) {
  const idx = steps.indexOf(current);
  return (
    <View style={styles.prog}>
      {steps.map((s, i) => (
        <View key={s} style={[styles.progSeg, i <= idx && styles.progSegOn]} />
      ))}
    </View>
  );
}

function TopBar({ onBack, steps, current, onSkip }) {
  return (
    <View style={styles.topBar}>
      <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.7} hitSlop={8}>
        <Ionicons name="chevron-back" size={16} color={Onboard.ink} />
      </TouchableOpacity>
      {steps ? <ProgressBar steps={steps} current={current} /> : <View style={styles.prog} />}
      {onSkip ? (
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={() => { haptic(); onSkip(); }}
          activeOpacity={0.7}
          hitSlop={8}
        >
          <Text style={styles.skipText} numberOfLines={1}>Skip</Text>
        </TouchableOpacity>
      ) : (
        // Mirror the 30px back button so the progress bar stays centered.
        <View style={styles.topBarSpacer} />
      )}
    </View>
  );
}

function OptionRow({ icon, title, desc, selected, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.opt, selected && styles.optSel]}
      onPress={() => { haptic(); onPress(); }}
      activeOpacity={0.8}
    >
      {icon ? (
        <View style={[styles.optIcon, selected && styles.optIconSel]}>
          <Ionicons name={icon} size={19} color={selected ? Onboard.ink : Onboard.ink2} />
        </View>
      ) : null}
      <View style={styles.optBody}>
        <Text style={styles.optTitle}>{title}</Text>
        {desc ? <Text style={styles.optDesc}>{desc}</Text> : null}
      </View>
      <View style={[styles.optCheck, selected && styles.optCheckSel]}>
        {selected && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
      </View>
    </TouchableOpacity>
  );
}

export default function RegisterScreen({ navigation }) {
  const [step, setStep] = useState('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('');
  const [danceStyle, setDanceStyle] = useState('');

  // Studio step. The user types in studioQuery; we filter the list as they
  // type. Picking a row sets selectedStudioId. A coach can also tap
  // "Create '<typed>'" to defer studio creation until after signUp completes.
  const [studios, setStudios] = useState([]);
  const [studiosLoading, setStudiosLoading] = useState(false);
  const [studioQuery, setStudioQuery] = useState('');
  const [selectedStudioId, setSelectedStudioId] = useState(null);
  const [createMode, setCreateMode] = useState(false);

  const [lessonsPerMonth, setLessonsPerMonth] = useState(LESSONS_DEFAULT);
  const [soloFrequency, setSoloFrequency] = useState(null);

  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const nameRef = useRef(null);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  // Step-change transition: the body fades + slides in. Driven from the
  // navigation handlers (not a [step] effect) so the first paint is never the
  // wrong opacity. anim starts at 1 — the form is visible immediately with no
  // flash and no entrance animation — and each goTo resets it to 0 *before*
  // the next step renders, then animates back to 1. dirRef flips the slide
  // direction: forward enters from the right, Back from the left.
  const anim = useRef(new Animated.Value(1)).current;
  const dirRef = useRef(1);

  function animateStepIn(dir) {
    dirRef.current = dir;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 240, useNativeDriver: true }).start();
  }

  const progressSteps = progressStepsFor(role);

  function goTo(next, dir = 1) {
    setError('');
    setInfo('');
    animateStepIn(dir);
    setStep(next);
  }

  function goNext() {
    if (step === 'form') return goTo('role');
    const idx = progressSteps.indexOf(step);
    if (idx === progressSteps.length - 1) return goTo('ready');
    goTo(progressSteps[idx + 1]);
  }

  function goBack() {
    if (step === 'form') return navigation.goBack();
    if (step === 'ready') return goTo(progressSteps[progressSteps.length - 1], -1);
    const idx = progressSteps.indexOf(step);
    if (idx <= 0) return goTo('form', -1);
    goTo(progressSteps[idx - 1], -1);
  }

  function handleFormContinue() {
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    if (!isValidEmail(email)) {
      setError('That email does not look right.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    goNext();
  }

  // Load studios when entering the studio step. RLS allows anon SELECT, so
  // this works without an authenticated session.
  useEffect(() => {
    if (step !== 'studio') return;
    let cancelled = false;
    setStudiosLoading(true);
    supabase
      .from('studios')
      .select('id, name')
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        setStudios(data || []);
        setStudiosLoading(false);
      });
    return () => { cancelled = true; };
  }, [step]);

  async function handleSubmit() {
    setLoading(true);
    setError('');

    // Onboarding answers ride along in the auth metadata so the
    // handle_new_user trigger can persist them even when email confirmation
    // means we get no session back.
    const metadata = { name: name.trim(), role, dance_style: danceStyle };
    if (!createMode && selectedStudioId) metadata.studio_id = selectedStudioId;
    if (role === 'student') {
      if (lessonsPerMonth != null) metadata.lessons_per_month = lessonsPerMonth;
      if (soloFrequency) metadata.solo_practice_frequency = soloFrequency;
    }

    const { data, error: signUpErr } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: metadata },
    });

    if (signUpErr) {
      setLoading(false);
      setError(signUpErr.message);
      return;
    }

    const userId = data?.user?.id;

    // Email confirmation enabled → no session yet, can't write the users row
    // directly; the trigger has already copied the metadata.
    if (!data?.session) {
      setLoading(false);
      goTo('confirm');
      return;
    }

    // Coach is registering a brand-new studio. Gated on role so a stale
    // createMode can never let a student insert a studio.
    let studioId = selectedStudioId;
    if (role === 'coach' && createMode && studioQuery.trim()) {
      const { data: created, error: createErr } = await supabase
        .from('studios')
        .insert({ name: studioQuery.trim(), created_by: userId })
        .select('id')
        .single();
      if (createErr) {
        setLoading(false);
        setError(createErr.code === '23505'
          ? 'A studio with that name already exists.'
          : (createErr.message || 'Could not create studio.'));
        return;
      }
      studioId = created.id;
    }

    if (userId) {
      await supabase
        .from('users')
        .update({ role, dance_style: danceStyle, studio_id: studioId || null })
        .eq('id', userId);
      if (role === 'student') {
        // Separate write so an un-migrated column can never block sign-up.
        // We surface (don't swallow) the error: if 20260611 hasn't been
        // applied these columns don't exist and the write fails — sign-up
        // still succeeds, but the miss should be visible in logs.
        const { error: stuErr } = await supabase
          .from('users')
          .update({
            lessons_per_month: lessonsPerMonth,
            solo_practice_frequency: soloFrequency,
          })
          .eq('id', userId);
        if (stuErr) {
          console.warn('[register] student fields not saved (is migration 20260611 applied?):', stuErr.message);
        }
      }
    }

    setLoading(false);
    // App.js's onAuthStateChange swaps to the home navigator now that the
    // session is in place.
  }

  async function handleResend() {
    setResending(true);
    setError('');
    setInfo('');
    const { error: err } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
    setResending(false);
    if (err) setError(err.message);
    else setInfo('Confirmation email sent again.');
  }

  // ── Final screens (centered, no scroll) ──────────────────────────────────

  if (step === 'confirm') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.finalWrap}>
          <View style={styles.spacer} />
          <View style={styles.finalCenter}>
            <View style={styles.successRing}>
              <Ionicons name="mail-outline" size={36} color={Onboard.ink} />
            </View>
            <Text style={styles.finalTitle}>Check your{'\n'}email</Text>
            <Text style={styles.finalSub}>
              We sent a confirmation link to {email.trim()}. Confirm it, then sign in.
            </Text>
            <View style={styles.confirmHint}>
              <Ionicons name="information-circle-outline" size={14} color={Onboard.ink3} />
              <Text style={styles.confirmHintText}>No email? Check your spam folder.</Text>
            </View>
            {!!error && <Text style={[styles.error, styles.centerMsg]}>{error}</Text>}
            {!!info && <Text style={[styles.info, styles.centerMsg]}>{info}</Text>}
          </View>
          <View style={styles.spacer} />
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.navigate('Login')}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>Go to sign in</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.resendBtn}
            onPress={handleResend}
            disabled={resending}
            activeOpacity={0.7}
          >
            <Text style={styles.resendText}>
              {resending ? 'Sending…' : 'Resend confirmation email'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'ready') {
    const firstName = name.trim().split(/\s+/)[0];
    const danceLabel = danceStyle === 'Latin & Ballroom' ? 'Ten Dance' : danceStyle;
    const studioName = createMode
      ? studioQuery.trim()
      : (studios.find((s) => s.id === selectedStudioId)?.name || '');
    const soloChip = role === 'student' && soloFrequency
      ? (SOLO_OPTIONS.find((o) => o.value === soloFrequency)?.chip || '')
      : '';
    const chips = [
      role === 'coach' ? 'Coach' : 'Student',
      danceLabel,
      studioName,
      role === 'student' && lessonsPerMonth != null ? `${lessonsPerMonth} lessons / mo` : '',
      soloChip,
    ].filter(Boolean);

    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.finalWrap}>
          <View style={styles.topBar}>
            <TouchableOpacity style={styles.backBtn} onPress={goBack} activeOpacity={0.7} hitSlop={8}>
              <Ionicons name="chevron-back" size={16} color={Onboard.ink} />
            </TouchableOpacity>
          </View>
          <View style={styles.spacer} />
          <View style={styles.finalCenter}>
            <View style={styles.successRing}>
              <Ionicons name="checkmark" size={40} color={Onboard.ink} />
            </View>
            <Text style={styles.finalTitle}>You're all set,{'\n'}{firstName}.</Text>
            <Text style={styles.finalSub}>
              {role === 'coach'
                ? 'Your coach dashboard is ready for your first class.'
                : 'Your home screen is ready for your first focus points.'}
            </Text>
            <View style={styles.recap}>
              {chips.map((c) => (
                <View key={c} style={styles.recapChip}>
                  <Text style={styles.recapChipText}>{c}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={styles.spacer} />
          {!!error && <Text style={[styles.error, styles.centerMsg]}>{error}</Text>}
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={styles.primaryBtnText}>Enter InBetween</Text>}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Step bodies (shared scroll scaffold) ─────────────────────────────────

  let body = null;
  let onSkip = null;
  const continueLabel = 'Continue';
  let onContinue = goNext;

  if (step === 'form') {
    const pw = passwordStrength(password);
    onContinue = handleFormContinue;
    body = (
      <>
        <Text style={styles.h1}>Create your{'\n'}account</Text>
        <Text style={styles.sub}>Takes about a minute.</Text>
        <View style={styles.fields}>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Full name</Text>
            <TextInput
              ref={nameRef}
              style={styles.field}
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={Onboard.ink3}
              autoFocus
              autoComplete="name"
              textContentType="name"
              returnKeyType="next"
              onSubmitEditing={() => emailRef.current?.focus()}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              ref={emailRef}
              style={styles.field}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={Onboard.ink3}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              textContentType="username"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Password</Text>
            <PasswordField
              ref={passwordRef}
              value={password}
              onChangeText={setPassword}
              placeholder="Min. 6 characters"
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={handleFormContinue}
            />
            {/* Always mounted so showing/clearing the meter never shifts the
                button below it; children only appear once typing starts. */}
            <View style={styles.pwMeter}>
              {password.length > 0 && (
                <>
                  <View style={styles.pwBars}>
                    {[0, 1, 2].map((i) => (
                      <View
                        key={i}
                        style={[
                          styles.pwBar,
                          i < pw.level && { backgroundColor: strengthColor(pw.level) },
                        ]}
                      />
                    ))}
                  </View>
                  {!!pw.label && (
                    <Text style={[styles.pwLabel, { color: strengthColor(pw.level) }]}>
                      {pw.label}
                    </Text>
                  )}
                </>
              )}
            </View>
          </View>
        </View>
      </>
    );
  } else if (step === 'role') {
    onContinue = () => {
      if (!role) { setError('Pick how you\'ll use InBetween.'); return; }
      goNext();
    };
    body = (
      <>
        <Text style={styles.h1}>How will you{'\n'}use InBetween?</Text>
        <Text style={styles.sub}>So we set up the right home screen for you.</Text>
        <View style={styles.options}>
          {ROLE_OPTIONS.map((o) => (
            <OptionRow
              key={o.value}
              icon={o.icon}
              title={o.title}
              desc={o.desc}
              selected={role === o.value}
              onPress={() => {
                // Switching role clears studio creation state — only coaches
                // can create a studio, and a stale createMode from a previous
                // coach selection must not let a student insert one.
                if (o.value !== role) {
                  setCreateMode(false);
                  if (o.value !== 'coach') setSelectedStudioId(null);
                }
                setRole(o.value);
                setError('');
              }}
            />
          ))}
        </View>
      </>
    );
  } else if (step === 'dance') {
    onContinue = () => {
      if (!danceStyle) { setError('Pick your dance style.'); return; }
      goNext();
    };
    body = (
      <>
        <Text style={styles.h1}>Your dance{'\n'}style</Text>
        <Text style={styles.sub}>Pick one, or both for Ten Dance.</Text>
        <View style={styles.options}>
          {DANCE_OPTIONS.map((o) => (
            <OptionRow
              key={o.value}
              icon={o.icon}
              title={o.title}
              desc={o.desc}
              selected={danceStyle === o.value}
              onPress={() => { setDanceStyle(o.value); setError(''); }}
            />
          ))}
        </View>
      </>
    );
  } else if (step === 'studio') {
    const allowCreate = role === 'coach';
    const trimmed = studioQuery.trim();
    const matches = filterStudios(studios, studioQuery);
    const showCreate = allowCreate && trimmed.length >= 2 && !hasExactMatch(studios, trimmed);

    // Studio is required — no Skip. A student must be tied to a studio to sync
    // with their coaches and classes.
    onContinue = () => {
      if (!selectedStudioId && !createMode) {
        setError('Pick your studio to continue.');
        return;
      }
      goNext();
    };
    body = (
      <>
        <Text style={styles.h1}>Find your{'\n'}studio</Text>
        <Text style={styles.sub}>Connect to sync your coaches & classes.</Text>

        <View style={styles.search}>
          <Ionicons name="search" size={16} color={Onboard.ink3} />
          <TextInput
            style={styles.searchInput}
            value={studioQuery}
            onChangeText={(t) => {
              setStudioQuery(t);
              // Typing past the picked match unselects it so the user can
              // freely refine the search.
              if (selectedStudioId) {
                const stillMatches = studios.find((s) => s.id === selectedStudioId);
                if (!stillMatches || stillMatches.name.toLowerCase() !== t.trim().toLowerCase()) {
                  setSelectedStudioId(null);
                }
              }
              setCreateMode(false);
              setError('');
            }}
            placeholder="Search studios…"
            placeholderTextColor={Onboard.ink3}
            autoCorrect={false}
            autoCapitalize="words"
          />
          {!!studioQuery && (
            <TouchableOpacity
              onPress={() => { setStudioQuery(''); setSelectedStudioId(null); setCreateMode(false); }}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={16} color={Onboard.ink3} />
            </TouchableOpacity>
          )}
        </View>

        {studiosLoading ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}>
            <ActivityIndicator color={Onboard.ink} />
          </View>
        ) : (
          <View>
            {matches.map((s) => (
              <OptionRow
                key={s.id}
                icon="business-outline"
                title={s.name}
                selected={!createMode && selectedStudioId === s.id}
                onPress={() => {
                  setSelectedStudioId(s.id);
                  setStudioQuery(s.name);
                  setCreateMode(false);
                  setError('');
                }}
              />
            ))}

            {matches.length === 0 && trimmed.length > 0 && !showCreate && (
              <Text style={styles.emptyText}>No studios match "{trimmed}".</Text>
            )}

            {showCreate && (
              <TouchableOpacity
                style={[styles.createRow, createMode && styles.createRowActive]}
                onPress={() => { haptic(); setCreateMode(true); setSelectedStudioId(null); setError(''); }}
                activeOpacity={0.75}
              >
                <Ionicons name="add" size={18} color={Onboard.ink} />
                <Text style={styles.createRowText} numberOfLines={1}>Create "{trimmed}"</Text>
                {createMode && <Ionicons name="checkmark" size={18} color={Onboard.ink} />}
              </TouchableOpacity>
            )}
          </View>
        )}
      </>
    );
  } else if (step === 'lessons') {
    const shown = lessonsPerMonth ?? LESSONS_DEFAULT;
    onSkip = () => { setLessonsPerMonth(null); goNext(); };
    onContinue = () => { setLessonsPerMonth(shown); goNext(); };
    body = (
      <>
        <Text style={styles.h1}>How many private{'\n'}lessons a month?</Text>
        <Text style={styles.sub}>On average, so the app fits your real rhythm.</Text>
        <View style={styles.stepperWrap}>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={styles.stepperBtn}
              onPress={() => { haptic(); setLessonsPerMonth(Math.max(LESSONS_MIN, shown - 1)); }}
              activeOpacity={0.7}
            >
              <Ionicons name="remove" size={22} color={Onboard.ink} />
            </TouchableOpacity>
            <Text style={styles.stepperNum}>{shown}</Text>
            <TouchableOpacity
              style={styles.stepperBtn}
              onPress={() => { haptic(); setLessonsPerMonth(Math.min(LESSONS_MAX, shown + 1)); }}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={22} color={Onboard.ink} />
            </TouchableOpacity>
          </View>
          <Text style={styles.stepperUnit}>private lessons / month</Text>
          <View style={styles.hintBar}>
            <Ionicons name="information-circle-outline" size={15} color={Onboard.ink2} />
            <Text style={styles.hintText}>Helps us time reminders before each lesson.</Text>
          </View>
        </View>
      </>
    );
  } else if (step === 'solo') {
    onSkip = () => { setSoloFrequency(null); goNext(); };
    onContinue = () => {
      if (!soloFrequency) { setError('Pick one, or tap Skip.'); return; }
      goNext();
    };
    body = (
      <>
        <Text style={styles.h1}>How often do{'\n'}you train solo?</Text>
        <Text style={styles.sub}>Between lessons, on your own.</Text>
        <View style={styles.options}>
          {SOLO_OPTIONS.map((o) => (
            <OptionRow
              key={o.value}
              icon={o.icon}
              title={o.title}
              selected={soloFrequency === o.value}
              onPress={() => { setSoloFrequency(o.value); setError(''); }}
            />
          ))}
        </View>
      </>
    );
  }

  const showProgress = step !== 'form';

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kv}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TopBar
            onBack={goBack}
            steps={showProgress ? progressSteps : null}
            current={step}
            onSkip={onSkip}
          />
          <Animated.View
            style={[
              styles.bodyWrap,
              {
                opacity: anim,
                transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [18 * dirRef.current, 0] }) }],
              },
            ]}
          >
            {body}
          </Animated.View>
          <View style={styles.spacer} />
          {!!error && <Text style={styles.error}>{error}</Text>}
          {!!info && <Text style={styles.info}>{info}</Text>}
          <TouchableOpacity style={styles.primaryBtn} onPress={onContinue} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>{continueLabel}</Text>
          </TouchableOpacity>
          {step === 'form' && (
            <>
              <View style={styles.legalWrap}>
                <Text style={styles.legal}>By continuing you agree to our</Text>
                <View style={styles.legalRow}>
                  <TouchableOpacity
                    onPress={() => Linking.openURL(TERMS_URL)}
                    style={styles.legalLinkBtn}
                    hitSlop={6}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.legalLink}>Terms</Text>
                  </TouchableOpacity>
                  <Text style={styles.legal}>and</Text>
                  <TouchableOpacity
                    onPress={() => Linking.openURL(PRIVACY_URL)}
                    style={styles.legalLinkBtn}
                    hitSlop={6}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.legalLink}>Privacy Policy</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <TouchableOpacity
                style={styles.link}
                onPress={() => navigation.navigate('Login')}
                activeOpacity={0.7}
              >
                <Text style={styles.linkText}>
                  Already have an account? <Text style={styles.linkBold}>Sign in</Text>
                </Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Onboard.bg },
  kv: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.side + 2,
    paddingTop: 8,
    paddingBottom: 18,
  },
  spacer: { flex: 1, minHeight: 24 },
  bodyWrap: {},

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
    minHeight: 30,
  },
  backBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Onboard.faint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prog: { flex: 1, flexDirection: 'row', gap: 5 },
  progSeg: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: Onboard.line,
  },
  progSegOn: { backgroundColor: Onboard.gold },
  skipBtn: { width: 30, alignItems: 'flex-end' },
  topBarSpacer: { width: 30 },
  skipText: {
    fontFamily: Fonts.travelsMedium,
    fontSize: 12.5,
    color: Onboard.ink3,
  },

  h1: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 27,
    lineHeight: 30,
    letterSpacing: -0.8,
    color: Onboard.ink,
  },
  sub: {
    fontFamily: Fonts.travelsRegular,
    fontSize: 13.5,
    lineHeight: 19,
    color: Onboard.ink2,
    marginTop: 10,
  },

  fields: { marginTop: 18 },
  fieldGroup: { marginBottom: 12 },
  fieldLabel: {
    fontFamily: Fonts.travelsMedium,
    fontSize: 10.5,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Onboard.ink3,
    marginBottom: 6,
    marginLeft: 2,
  },
  field: {
    backgroundColor: Onboard.card,
    borderWidth: 1,
    borderColor: Onboard.line,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: Fonts.travelsRegular,
    fontSize: 15,
    color: Onboard.ink,
  },
  pwMeter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 14,
    marginTop: 8,
    marginLeft: 2,
  },
  pwBars: { flexDirection: 'row', gap: 4, flex: 1 },
  pwBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: Onboard.line,
  },
  pwLabel: {
    fontFamily: Fonts.travelsMedium,
    fontSize: 11,
  },

  options: { marginTop: 18 },
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    padding: 14,
    borderRadius: 14,
    backgroundColor: Onboard.card,
    borderWidth: 1,
    borderColor: Onboard.line,
    marginBottom: 9,
  },
  optSel: {
    borderColor: Onboard.gold,
    shadowColor: Onboard.gold,
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  optIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Onboard.faint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optIconSel: { backgroundColor: Onboard.gold },
  optBody: { flex: 1 },
  optTitle: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 15.5,
    letterSpacing: -0.2,
    color: Onboard.ink,
  },
  optDesc: {
    fontFamily: Fonts.travelsRegular,
    fontSize: 11.5,
    color: Onboard.ink3,
    marginTop: 1,
  },
  optCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Onboard.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optCheckSel: {
    backgroundColor: Onboard.gold,
    borderColor: Onboard.gold,
  },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Onboard.card,
    borderWidth: 1,
    borderColor: Onboard.line,
    borderRadius: 13,
    paddingHorizontal: 13,
    marginTop: 16,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.travelsRegular,
    fontSize: 14,
    color: Onboard.ink,
    paddingVertical: 12,
  },
  emptyText: {
    fontFamily: Fonts.travelsRegular,
    fontSize: 13,
    color: Onboard.ink3,
    paddingVertical: 12,
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Onboard.ink,
    borderStyle: 'dashed',
    marginTop: 4,
  },
  createRowActive: { backgroundColor: Onboard.goldTint },
  createRowText: {
    flex: 1,
    fontFamily: Fonts.ttDemiBold,
    fontSize: 14,
    color: Onboard.ink,
  },

  stepperWrap: { alignItems: 'center', marginTop: 16 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  stepperBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Onboard.card,
    borderWidth: 1,
    borderColor: Onboard.line,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Onboard.ink,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  stepperNum: {
    fontFamily: Fonts.ttBold,
    fontSize: 64,
    letterSpacing: -2,
    color: Onboard.ink,
    minWidth: 88,
    textAlign: 'center',
  },
  stepperUnit: {
    fontFamily: Fonts.travelsMedium,
    fontSize: 13,
    letterSpacing: 0.4,
    color: Onboard.ink3,
    marginTop: 11,
  },
  hintBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: 'rgba(10,10,10,0.04)',
    borderWidth: 1,
    borderColor: Onboard.line,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 10,
    marginTop: 16,
  },
  hintText: {
    flex: 1,
    fontFamily: Fonts.travelsMedium,
    fontSize: 12,
    color: Onboard.ink2,
  },

  finalWrap: {
    flex: 1,
    paddingHorizontal: Spacing.side + 2,
    paddingTop: 8,
    paddingBottom: 18,
  },
  finalCenter: { alignItems: 'center' },
  successRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Onboard.gold,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Onboard.gold,
    shadowOpacity: 0.6,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  finalTitle: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 27,
    lineHeight: 30,
    letterSpacing: -0.8,
    color: Onboard.ink,
    textAlign: 'center',
    marginTop: 20,
  },
  finalSub: {
    fontFamily: Fonts.travelsRegular,
    fontSize: 13.5,
    lineHeight: 19,
    color: Onboard.ink2,
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 12,
  },
  recap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
  },
  recapChip: {
    backgroundColor: Onboard.card,
    borderWidth: 1,
    borderColor: Onboard.line,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  recapChipText: {
    fontFamily: Fonts.travelsMedium,
    fontSize: 11,
    color: Onboard.ink2,
  },
  confirmHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
  },
  confirmHintText: {
    fontFamily: Fonts.travelsRegular,
    fontSize: 12,
    color: Onboard.ink3,
  },
  resendBtn: {
    alignItems: 'center',
    marginTop: 14,
  },
  resendText: {
    fontFamily: Fonts.travelsMedium,
    fontSize: 13,
    color: Onboard.goldInk,
  },

  error: {
    fontFamily: Fonts.travelsRegular,
    fontSize: 13,
    color: Onboard.error,
    marginBottom: 12,
  },
  info: {
    fontFamily: Fonts.travelsMedium,
    fontSize: 13,
    color: Onboard.success,
    marginBottom: 12,
  },
  centerMsg: { textAlign: 'center', marginTop: 12, marginBottom: 0 },
  primaryBtn: {
    backgroundColor: Onboard.ink,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 15,
    color: '#FFFFFF',
  },
  legalWrap: {
    alignItems: 'center',
    marginTop: 12,
  },
  legal: {
    fontFamily: Fonts.travelsRegular,
    fontSize: 11.5,
    lineHeight: 16,
    color: Onboard.ink3,
    textAlign: 'center',
  },
  legalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  legalLinkBtn: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  legalLink: {
    fontFamily: Fonts.travelsMedium,
    fontSize: 11.5,
    color: Onboard.ink2,
    textDecorationLine: 'underline',
  },
  link: {
    alignItems: 'center',
    marginTop: 14,
  },
  linkText: {
    fontFamily: Fonts.travelsRegular,
    fontSize: 13,
    color: Onboard.ink2,
  },
  linkBold: {
    fontFamily: Fonts.ttDemiBold,
    color: Onboard.goldInk,
  },
});
