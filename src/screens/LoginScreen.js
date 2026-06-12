// Login — cream + gold design language shared with Welcome / Register.

import React, { useRef, useState } from 'react';
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
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '../services/supabase/client';
import { registerPushToken } from '../services/notifications';
import { Fonts, Spacing, Onboard } from '../theme';
import { isValidEmail } from '../utils/authValidation';
import PasswordField from '../components/PasswordField';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  async function handleLogin() {
    if (resetting) return;
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.');
      return;
    }
    if (!isValidEmail(email)) {
      setError('That email does not look right.');
      return;
    }
    setLoading(true);
    setError('');
    setInfo('');
    const { data: authData, error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (!err && authData?.user?.id) {
      registerPushToken(authData.user.id); // fire and forget
    }
    setLoading(false);
    if (err) setError(err.message);
  }

  async function handleForgotPassword() {
    if (loading) return; // sign-in already in flight
    if (!isValidEmail(email)) {
      setError('Enter your email first, then tap Forgot password.');
      emailRef.current?.focus();
      return;
    }
    setResetting(true);
    setError('');
    setInfo('');
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim());
    setResetting(false);
    if (err) setError(err.message);
    else setInfo(`Reset link sent to ${email.trim()}. Check your inbox.`);
  }

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
          <View style={styles.topBar}>
            {navigation.canGoBack() && (
              <TouchableOpacity
                style={styles.backBtn}
                onPress={() => navigation.goBack()}
                activeOpacity={0.7}
                hitSlop={8}
              >
                <Ionicons name="chevron-back" size={16} color={Onboard.ink} />
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.h1}>Welcome{'\n'}back</Text>
          <Text style={styles.sub}>Sign in to continue your training.</Text>

          <View style={styles.fields}>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                ref={emailRef}
                style={styles.field}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={Onboard.ink3}
                autoFocus
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
                placeholder="••••••••"
                autoComplete="password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity
                style={styles.forgot}
                onPress={handleForgotPassword}
                disabled={resetting || loading}
                activeOpacity={0.7}
                hitSlop={{ top: 16, bottom: 16, left: 8, right: 8 }}
              >
                <Text style={styles.forgotText}>
                  {resetting ? 'Sending…' : 'Forgot password?'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.spacer} />

          {!!error && <Text style={styles.error}>{error}</Text>}
          {!!info && <Text style={styles.info}>{info}</Text>}

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleLogin}
            disabled={loading || resetting}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={styles.primaryBtnText}>Sign in</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.link}
            onPress={() => navigation.navigate('Register')}
            activeOpacity={0.7}
          >
            <Text style={styles.linkText}>
              Don't have an account? <Text style={styles.linkBold}>Create one</Text>
            </Text>
          </TouchableOpacity>
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
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
  forgot: {
    alignSelf: 'flex-end',
    marginTop: 4,
    marginRight: 2,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  forgotText: {
    fontFamily: Fonts.travelsMedium,
    fontSize: 12.5,
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
