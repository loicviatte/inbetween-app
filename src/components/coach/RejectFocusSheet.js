import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { Fonts } from '../../theme';

const C = {
  dark: '#141414',
  text: '#0E0E0E',
  gray: '#999',
  red: '#D44545',
  lightGray: '#E5E5E5',
};

export default function RejectFocusSheet({ fp, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await onConfirm(reason);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={s.overlay}
    >
      <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={s.sheet}>
        <View style={s.handle} />
        <Text style={s.title}>Decline focus point</Text>
        <Text style={s.subtitle} numberOfLines={2}>
          "{fp?.name}" will be removed and your student will be notified.
        </Text>

        <Text style={s.label}>Reason (sent to the student)</Text>
        <TextInput
          style={s.input}
          value={reason}
          onChangeText={setReason}
          placeholder="e.g. Not a priority right now — let's focus on your frame first."
          placeholderTextColor="#BDBDBD"
          multiline
          textAlignVertical="top"
          autoFocus
          maxLength={400}
        />
        <Text style={s.hint}>{reason.length}/400 — optional but helpful</Text>

        <View style={s.actions}>
          <TouchableOpacity style={s.cancelBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.confirmBtn, submitting && { opacity: 0.5 }]}
            onPress={handleConfirm}
            disabled={submitting}
            activeOpacity={0.85}
          >
            <Text style={s.confirmText}>{submitting ? 'Declining…' : 'Decline'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 22,
    paddingBottom: 28,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E5E5',
    marginBottom: 14,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 19,
    color: C.text,
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13.5,
    color: '#5C6370',
    lineHeight: 20,
    marginBottom: 20,
  },
  label: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: C.gray,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  input: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: C.text,
    lineHeight: 20,
    backgroundColor: '#F7F7F7',
    borderRadius: 12,
    padding: 14,
    minHeight: 100,
    marginBottom: 6,
  },
  hint: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: '#B5B5B5',
    marginBottom: 22,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.lightGray,
  },
  cancelText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: C.text,
    letterSpacing: 0.2,
  },
  confirmBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 999,
    backgroundColor: C.red,
  },
  confirmText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#fff',
    letterSpacing: 0.2,
  },
});
