import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { Colors, Fonts } from '../theme';

// Reusable edit sheet for a focus point. Caller supplies onSave(fpId, updates)
// and controls what persistence to run (e.g. updateFocusPoint vs
// editAndApproveFocusPoint) and what button label to show.
export default function FocusPointEditSheet({ fp, onSave, onClose, saveLabel = 'Save' }) {
  const [name, setName] = useState(fp.name ?? '');
  const [subtitle, setSubtitle] = useState(fp.subtitle ?? '');
  const [context, setContext] = useState(fp.context ?? '');
  const [drill, setDrill] = useState(fp.drill ?? '');
  const [tier, setTier] = useState(fp.tier ?? 'important');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave(fp.id, { name, subtitle, context, drill, tier });
    setSaving(false);
  }

  const fields = [
    ['Title', name, setName],
    ['Subtitle', subtitle, setSubtitle],
    ['Context', context, setContext],
    ['Drill', drill, setDrill],
  ];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={es.overlay}
    >
      <View style={es.sheet}>
        <View style={es.handle} />
        <Text style={es.title}>Edit Focus Point</Text>
        <ScrollView showsVerticalScrollIndicator={false}>
          {fields.map(([label, val, set]) => (
            <View key={label} style={es.field}>
              <Text style={es.label}>{label}</Text>
              <TextInput
                style={[es.input, label === 'Context' && { minHeight: 80 }]}
                value={val}
                onChangeText={set}
                multiline={label === 'Context'}
                placeholderTextColor="rgba(13,13,18,0.3)"
              />
            </View>
          ))}
          <View style={es.field}>
            <Text style={es.label}>Tier</Text>
            <View style={es.pillRow}>
              {['critical', 'important', 'supporting'].map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[es.pill, tier === t && es.pillActive]}
                  onPress={() => setTier(t)}
                  activeOpacity={0.8}
                >
                  <Text style={[es.pillText, tier === t && es.pillTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>
        <TouchableOpacity
          style={es.saveBtn}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          <Text style={es.saveBtnText}>{saving ? 'Saving…' : saveLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={es.cancelBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={es.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const es = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 44,
    maxHeight: '90%',
  },
  handle: {
    width: 32,
    height: 3,
    backgroundColor: 'rgba(13,13,18,0.1)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 17,
    color: Colors.black,
    textAlign: 'center',
    marginBottom: 20,
    letterSpacing: -0.2,
  },
  field: { marginBottom: 16 },
  label: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  input: {
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.black,
  },
  pillRow: { flexDirection: 'row', gap: 8 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    backgroundColor: Colors.statCardBg,
  },
  pillActive: { backgroundColor: Colors.black, borderColor: Colors.black },
  pillText: { fontFamily: Fonts.jakartaMedium, fontSize: 13, color: Colors.secondary },
  pillTextActive: { color: Colors.white },
  saveBtn: {
    backgroundColor: Colors.black,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnText: { fontFamily: Fonts.jakartaBold, fontSize: 15, color: Colors.white },
  cancelBtn: { paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontFamily: Fonts.jakartaRegular, fontSize: 14, color: Colors.secondary },
});
