import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import HeroCardGradient from '../HeroCardGradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fonts } from '../../theme';

const GOLD = '#F6D27A';

function formatRecipients(names) {
  if (!names || names.length === 0) return 'your student';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]}, and ${names[2]}`;
  return `all ${names.length} students`;
}

export default function ApproveConfirmSheet({ fp, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);
  const names = fp?._studentNames || [];
  const recipientLabel = fp?._isGroup ? 'Your students' : formatRecipients(names);

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      // Parent unmounts the modal on success; only reset if still mounted.
      setBusy(false);
    }
  };

  return (
    <Pressable style={s.backdrop} onPress={busy ? undefined : onCancel}>
      <Pressable style={s.card} onPress={() => { /* swallow */ }}>
        <HeroCardGradient />

        <View style={s.iconWrap}>
          <Ionicons name="paper-plane-outline" size={22} color={GOLD} />
        </View>

        <Text style={s.title}>Ready to publish?</Text>
        <Text style={s.body}>
          <Text style={s.bodyName}>{recipientLabel}</Text>
          <Text> will see this focus point and start working on it. Are you done editing?</Text>
        </Text>

        <TouchableOpacity
          style={[s.primaryBtn, busy && { opacity: 0.7 }]}
          onPress={handleConfirm}
          activeOpacity={0.85}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#0A0A0A" />
          ) : (
            <>
              <Ionicons name="paper-plane" size={15} color="#0A0A0A" />
              <Text style={s.primaryBtnText}>Yes, send it</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={s.secondaryBtn}
          onPress={onCancel}
          activeOpacity={0.7}
          disabled={busy}
        >
          <Text style={s.secondaryBtnText}>Keep editing</Text>
        </TouchableOpacity>
      </Pressable>
    </Pressable>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    borderRadius: 22,
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(240,194,74,0.28)',
    overflow: 'hidden',
  },
  iconWrap: {
    alignSelf: 'center',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(240,194,74,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(240,194,74,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
    color: '#FFFFFF',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.78)',
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 22,
  },
  bodyName: {
    fontFamily: Fonts.jakartaBold,
    color: GOLD,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 13,
    marginBottom: 4,
  },
  primaryBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: '#0A0A0A',
    letterSpacing: 0.2,
  },
  secondaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  secondaryBtnText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.65)',
    letterSpacing: 0.1,
  },
});
