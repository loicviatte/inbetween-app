import React, { useState } from 'react';
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

export default function RegisterScreen({ navigation }) {
  const [step, setStep] = useState('role'); // 'role' | 'form'
  const [role, setRole] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function handleRoleSelect(selected) {
    setRole(selected);
    setStep('form');
  }

  async function handleRegister() {
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { name: name.trim(), role } },
    });

    if (err) {
      setLoading(false);
      setError(err.message);
      return;
    }

    // If user row was auto-created by a DB trigger, update the role field.
    // If not, this will upsert the role once the trigger runs or on next login.
    if (data?.user?.id) {
      await supabase
        .from('users')
        .update({ role })
        .eq('id', data.user.id);
    }

    setLoading(false);
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

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kv}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => setStep('role')} style={styles.backBtn} activeOpacity={0.7}>
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
              onPress={handleRegister}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={styles.primaryBtnText}>CREATE ACCOUNT</Text>
              )}
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
});
