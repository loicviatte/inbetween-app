import React, { useEffect, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../services/supabase/client';
import { Colors, Fonts, Spacing } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { filterStudios, hasExactMatch } from '../utils/studioMatch';

export default function RegisterScreen({ navigation }) {
  const [step, setStep] = useState('role'); // 'role' | 'form' | 'studio' | 'success'
  const [role, setRole] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Studio step state. The user types in studioQuery; we filter the list as
  // they type. Picking a row sets selectedStudioId. A coach can also tap
  // "Create '<typed>'" to defer studio creation until after signUp completes.
  const [studios, setStudios] = useState([]);
  const [studiosLoading, setStudiosLoading] = useState(false);
  const [studioQuery, setStudioQuery] = useState('');
  const [selectedStudioId, setSelectedStudioId] = useState(null);
  const [createMode, setCreateMode] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function handleRoleSelect(selected) {
    setRole(selected);
    setStep('form');
  }

  async function handleContinue() {
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setError('');
    setStep('studio');
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
    if (createMode) {
      if (!studioQuery.trim()) {
        setError('Type the name of your studio.');
        return;
      }
    } else if (!selectedStudioId) {
      setError('Pick your studio.');
      return;
    }

    setLoading(true);
    setError('');

    const { data, error: signUpErr } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { name: name.trim(), role } },
    });

    if (signUpErr) {
      setLoading(false);
      setError(signUpErr.message);
      return;
    }

    const userId = data?.user?.id;

    // Email confirmation enabled → no session yet, can't write the studio.
    // Studio assignment happens once the user confirms + logs in (they'll see
    // the empty slot in their profile).
    if (!data?.session) {
      if (userId) {
        await supabase.from('users').update({ role }).eq('id', userId);
      }
      setLoading(false);
      setStep('success');
      return;
    }

    // Coach is registering a brand-new studio.
    let studioId = selectedStudioId;
    if (createMode) {
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
        .update({ role, studio_id: studioId })
        .eq('id', userId);
    }

    setLoading(false);
    // App.js's onAuthStateChange will swap to the home navigator now that
    // session + studio_id are in place.
  }

  if (step === 'success') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.successWrap}>
          <View style={styles.successIconWrap}>
            <Ionicons name="checkmark" size={32} color="#fff" />
          </View>
          <View style={styles.successTextWrap}>
            <Text style={styles.successTitle}>You're in</Text>
            <Text style={styles.successBody}>
              Check your email and confirm your account to get started.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.navigate('Login')}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>GO TO LOGIN</Text>
          </TouchableOpacity>
          <View style={styles.successHint}>
            <Ionicons name="mail-outline" size={14} color={Colors.secondary} />
            <Text style={styles.successHintText}>No email? Check your spam folder.</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'role') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.logo}>EE</Text>
          <Text style={styles.title}>Who are you?</Text>
          <Text style={styles.subtitle}>We'll set up the app for you.</Text>

          <View style={styles.roleCards}>
            <TouchableOpacity
              style={styles.roleCard}
              onPress={() => handleRoleSelect('student')}
              activeOpacity={0.85}
            >
              <Text style={styles.roleEmoji}>🎵</Text>
              <Text style={styles.roleTitle}>Student</Text>
              <Text style={styles.roleDesc}>I practice between lessons</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.roleCard}
              onPress={() => handleRoleSelect('coach')}
              activeOpacity={0.85}
            >
              <Text style={styles.roleEmoji}>🏆</Text>
              <Text style={styles.roleTitle}>Coach</Text>
              <Text style={styles.roleDesc}>I teach competitive dance</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => navigation.navigate('Login')}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryBtnText}>
              Already have an account? <Text style={styles.linkText}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (step === 'studio') {
    const allowCreate = role === 'coach';
    const trimmed = studioQuery.trim();
    const matches = filterStudios(studios, studioQuery);
    const showCreate = allowCreate && trimmed.length >= 2 && !hasExactMatch(studios, trimmed);

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
            <TouchableOpacity onPress={() => { setStep('form'); setError(''); }} style={styles.backBtn} activeOpacity={0.7}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>

            <Text style={styles.logo}>EE</Text>
            <Text style={styles.title}>Your studio</Text>
            <Text style={styles.subtitle}>
              {allowCreate
                ? 'Search the studio you teach at — or create a new one.'
                : 'Search the studio you train at.'}
            </Text>

            <View style={studioStyles.searchWrap}>
              <Ionicons name="search" size={16} color={Colors.secondary} style={studioStyles.searchIcon} />
              <TextInput
                style={studioStyles.searchInput}
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
                placeholder="Search by name…"
                placeholderTextColor="rgba(17,12,17,0.3)"
                autoCorrect={false}
                autoCapitalize="words"
              />
              {!!studioQuery && (
                <TouchableOpacity
                  onPress={() => { setStudioQuery(''); setSelectedStudioId(null); setCreateMode(false); }}
                  hitSlop={8}
                  style={studioStyles.searchClear}
                >
                  <Ionicons name="close-circle" size={16} color={Colors.secondary} />
                </TouchableOpacity>
              )}
            </View>

            {studiosLoading ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <ActivityIndicator color={Colors.black} />
              </View>
            ) : (
              <View>
                {matches.map((s) => {
                  const active = !createMode && selectedStudioId === s.id;
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={[studioStyles.row, active && studioStyles.rowActive]}
                      onPress={() => { setSelectedStudioId(s.id); setStudioQuery(s.name); setCreateMode(false); setError(''); }}
                      activeOpacity={0.75}
                    >
                      <Text style={[studioStyles.rowText, active && studioStyles.rowTextActive]} numberOfLines={1}>
                        {s.name}
                      </Text>
                      {active && <Ionicons name="checkmark" size={18} color={Colors.black} />}
                    </TouchableOpacity>
                  );
                })}

                {matches.length === 0 && trimmed.length > 0 && !showCreate && (
                  <Text style={studioStyles.empty}>No studios match "{trimmed}".</Text>
                )}

                {showCreate && (
                  <TouchableOpacity
                    style={[studioStyles.createRow, createMode && studioStyles.createRowActive]}
                    onPress={() => { setCreateMode(true); setSelectedStudioId(null); setError(''); }}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="add" size={18} color={Colors.black} />
                    <Text style={studioStyles.createRowText} numberOfLines={1}>
                      Create "{trimmed}"
                    </Text>
                    {createMode && <Ionicons name="checkmark" size={18} color={Colors.black} />}
                  </TouchableOpacity>
                )}
              </View>
            )}

            {!!error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color={Colors.white} />
                : <Text style={styles.primaryBtnText}>CREATE ACCOUNT</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // step === 'form'
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kv}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => { setStep('role'); setError(''); }} style={styles.backBtn} activeOpacity={0.7}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <Text style={styles.logo}>EE</Text>
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>
            {role === 'coach' ? 'Set up your coach profile' : 'Start tracking your dance progress'}
          </Text>

          <View style={styles.form}>
            <Text style={styles.label}>Full name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={role === 'coach' ? 'Your name' : 'Alexandra Lukey'}
              placeholderTextColor={Colors.secondary}
              autoComplete="name"
            />

            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={Colors.secondary}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Min. 6 characters"
              placeholderTextColor={Colors.secondary}
              secureTextEntry
              autoComplete="new-password"
            />

            {!!error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleContinue}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>CONTINUE</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => navigation.navigate('Login')}
              activeOpacity={0.7}
            >
              <Text style={styles.secondaryBtnText}>
                Already have an account? <Text style={styles.linkText}>Sign in</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  kv: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.side,
    paddingTop: 60,
    paddingBottom: 40,
  },
  backBtn: { marginBottom: 24 },
  backText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: Colors.secondary,
  },
  logo: {
    fontFamily: Fonts.monument,
    fontSize: 28,
    color: Colors.black,
    letterSpacing: 2,
    marginBottom: 40,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 28,
    color: Colors.black,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: Colors.secondary,
    marginBottom: 40,
  },

  roleCards: {
    gap: 16,
    marginBottom: 40,
  },
  roleCard: {
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.statCardBorder,
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  roleEmoji: {
    fontSize: 28,
    marginBottom: 10,
  },
  roleTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: Colors.black,
    marginBottom: 4,
  },
  roleDesc: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.secondary,
  },

  form: { flex: 1 },
  label: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: Colors.black,
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: Colors.black,
    backgroundColor: Colors.white,
  },
  error: {
    color: '#E84040',
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    marginTop: 12,
  },
  primaryBtn: {
    backgroundColor: Colors.black,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
  },
  primaryBtnText: {
    color: Colors.white,
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    letterSpacing: 0.5,
  },
  secondaryBtn: {
    alignItems: 'center',
    marginTop: 20,
  },
  secondaryBtnText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.secondary,
  },
  linkText: {
    fontFamily: Fonts.jakartaBold,
    color: Colors.black,
  },
  successWrap: {
    flex: 1,
    paddingHorizontal: Spacing.side,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
  },
  successIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTextWrap: {
    alignItems: 'center',
    gap: 8,
  },
  successTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 30,
    color: Colors.black,
    letterSpacing: -0.5,
  },
  successBody: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: Colors.secondary,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  successHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  successHintText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
  },
});

const studioStyles = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: Colors.white,
    marginBottom: 16,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: Colors.black,
    paddingVertical: 14,
  },
  searchClear: { marginLeft: 8 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginBottom: 8,
  },
  rowActive: {
    borderColor: Colors.black,
    backgroundColor: 'rgba(232,181,48,0.12)',
  },
  rowText: {
    flex: 1,
    fontFamily: Fonts.jakartaMedium,
    fontSize: 15,
    color: Colors.black,
    marginRight: 8,
  },
  rowTextActive: { fontFamily: Fonts.jakartaExtraBold },

  empty: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    paddingVertical: 12,
  },

  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.black,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
    marginTop: 4,
  },
  createRowActive: {
    backgroundColor: 'rgba(232,181,48,0.12)',
  },
  createRowText: {
    flex: 1,
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: Colors.black,
  },
});
