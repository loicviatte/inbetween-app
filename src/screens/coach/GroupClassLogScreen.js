import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Colors, Fonts, Spacing } from '../../theme';
import { supabase } from '../../services/supabase/client';

const DANCES = [
  'Cha Cha', 'Samba', 'Rumba', 'Paso Doble', 'Jive',
  'Waltz', 'Tango', 'V. Waltz', 'Foxtrot', 'Quickstep',
];

export default function GroupClassLogScreen({ navigation }) {
  const [dance, setDance] = useState('');
  const [transcript, setTranscript] = useState('');
  const [teacherName, setTeacherName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!transcript.trim()) {
      Alert.alert('Missing transcript', 'Please enter the class transcript before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const row = {
        user_id:     user.id,
        lesson_type: 'public',
        transcript:  transcript.trim(),
        status:      'pending',
        practice_point_1: '…',
      };
      if (dance)        row.dance        = dance;
      if (teacherName)  row.teacher_name = teacherName.trim();

      const { data, error } = await supabase
        .from('class_inputs')
        .insert(row)
        .select('id')
        .single();

      if (error) throw error;

      Alert.alert(
        'Class submitted ✓',
        'Focus points are being generated. Your students will receive an attendance notification, and you\'ll be able to review the focus points once extraction is complete.',
        [{ text: 'Done', onPress: () => navigation.goBack() }]
      );
    } catch (e) {
      Alert.alert('Error', e.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={22} color={Colors.black} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Log Group Class</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Info banner */}
          <View style={styles.infoBanner}>
            <Ionicons name="people-outline" size={16} color={Colors.orange} />
            <Text style={styles.infoText}>
              All connected students will receive an attendance notification after submission.
            </Text>
          </View>

          {/* Dance selector */}
          <Text style={styles.label}>Dance style</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.danceRow}
          >
            {DANCES.map(d => (
              <TouchableOpacity
                key={d}
                style={[styles.dancePill, dance === d && styles.dancePillActive]}
                onPress={() => setDance(prev => prev === d ? '' : d)}
                activeOpacity={0.75}
              >
                <Text style={[styles.dancePillText, dance === d && styles.dancePillTextActive]}>
                  {d}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Teacher name */}
          <Text style={styles.label}>Your name (optional)</Text>
          <TextInput
            style={styles.input}
            value={teacherName}
            onChangeText={setTeacherName}
            placeholder="e.g. Marius"
            placeholderTextColor={Colors.secondary}
          />

          {/* Transcript */}
          <Text style={styles.label}>Class transcript</Text>
          <Text style={styles.sublabel}>
            Paste the transcript or notes from the group class. Focus points will be generated for all attending students.
          </Text>
          <TextInput
            style={styles.transcriptInput}
            value={transcript}
            onChangeText={setTranscript}
            placeholder={
              '[00:00 - 00:30] Today we\'re working on hip action in Cha Cha...\n[00:30 - 01:15] The group needs to focus on settling into each weight transfer...'
            }
            placeholderTextColor={Colors.secondary}
            multiline
            textAlignVertical="top"
          />

          {/* Submit button */}
          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            activeOpacity={0.85}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="send-outline" size={18} color="#fff" />
                <Text style={styles.submitText}>Submit & generate focus points</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.side,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.statCardBorder,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: Colors.black,
  },
  content: {
    padding: Spacing.side,
    paddingBottom: 48,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(255,157,0,0.08)',
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: 'rgba(255,157,0,0.25)',
    padding: 14,
    marginBottom: 24,
  },
  infoText: {
    flex: 1,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: '#8A6A2E',
    lineHeight: 19,
  },
  label: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginTop: 20,
  },
  sublabel: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    lineHeight: 18,
    marginTop: -6,
    marginBottom: 10,
  },
  danceRow: {
    gap: 8,
    paddingRight: Spacing.side,
  },
  dancePill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    backgroundColor: Colors.statCardBg,
  },
  dancePillActive: {
    backgroundColor: Colors.black,
    borderColor: Colors.black,
  },
  dancePillText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: Colors.secondary,
  },
  dancePillTextActive: {
    color: '#fff',
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
  transcriptInput: {
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.black,
    minHeight: 240,
    lineHeight: 21,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.black,
    borderRadius: 14,
    paddingVertical: 17,
    marginTop: 28,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
    color: '#fff',
  },
});
