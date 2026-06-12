// Shared password input for the auth / onboarding screens: the cream + gold
// field look plus a show/hide eye toggle. Forwards a ref to the underlying
// TextInput so callers can wire keyboard "next/done" focus flow.

import React, { useState, forwardRef } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fonts, Onboard } from '../theme';

const PasswordField = forwardRef(function PasswordField(
  {
    value,
    onChangeText,
    placeholder = 'Password',
    returnKeyType = 'done',
    onSubmitEditing,
    autoComplete = 'password',
    textContentType = 'password',
  },
  ref
) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.wrap}>
      <TextInput
        ref={ref}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Onboard.ink3}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={autoComplete}
        textContentType={textContentType}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
      />
      <TouchableOpacity
        onPress={() => setVisible((v) => !v)}
        hitSlop={10}
        style={styles.eye}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
      >
        <Ionicons
          name={visible ? 'eye-off-outline' : 'eye-outline'}
          size={18}
          color={Onboard.ink3}
        />
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Onboard.card,
    borderWidth: 1,
    borderColor: Onboard.line,
    borderRadius: 13,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    paddingVertical: 13,
    fontFamily: Fonts.travelsRegular,
    fontSize: 15,
    color: Onboard.ink,
  },
  eye: { paddingLeft: 10 },
});

export default PasswordField;
