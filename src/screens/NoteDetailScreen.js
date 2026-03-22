import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../theme';
import { getNoteById, saveNote, deleteNote } from '../services/storage';

export default function NoteDetailScreen({ route, navigation }) {
  const { noteId } = route.params || {};
  const isNew = !noteId;

  const [id] = useState(noteId || `note_${Date.now()}`);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [createdAt] = useState(Date.now());
  const autoSaveTimer = useRef(null);
  const hasChanges = useRef(false);

  useEffect(() => {
    if (!isNew) {
      getNoteById(noteId).then((note) => {
        if (note) {
          setTitle(note.title || '');
          setContent(note.content || '');
        }
      });
    }
  }, [noteId, isNew]);

  async function persist(newTitle, newContent) {
    await saveNote({
      id,
      userId: 'user_1',
      title: newTitle,
      content: newContent,
      createdAt,
      updatedAt: Date.now(),
    });
  }

  function scheduleAutoSave(newTitle, newContent) {
    hasChanges.current = true;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      persist(newTitle, newContent);
    }, 800);
  }

  function handleTitleChange(text) {
    setTitle(text);
    scheduleAutoSave(text, content);
  }

  function handleContentChange(text) {
    setContent(text);
    scheduleAutoSave(title, text);
  }

  // Save on blur / navigate away
  useFocusEffect(
    useCallback(() => {
      return () => {
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        if (hasChanges.current) {
          persist(title, content);
        }
      };
    }, [title, content])
  );

  function handleDelete() {
    Alert.alert('Delete note', 'Are you sure you want to delete this note?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
          if (!isNew) await deleteNote(id);
          navigation.goBack();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backLabel}>Notes</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleDelete} activeOpacity={0.7}>
          <Text style={styles.deleteBtn}>Delete</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={handleTitleChange}
          placeholder="Title"
          placeholderTextColor={Colors.secondary}
          returnKeyType="done"
          blurOnSubmit
          maxLength={100}
        />
        <TextInput
          style={styles.contentInput}
          value={content}
          onChangeText={handleContentChange}
          placeholder="Start writing..."
          placeholderTextColor={Colors.secondary}
          multiline
          textAlignVertical="top"
          scrollEnabled
          autoFocus={isNew}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.side,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(17,12,17,0.08)',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backArrow: { fontSize: 18, color: Colors.activeLog },
  backLabel: { fontFamily: Fonts.jakartaMedium, fontSize: 15, color: Colors.activeLog },
  deleteBtn: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: '#FF4444',
  },
  titleInput: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: Colors.black,
    paddingHorizontal: Spacing.side,
    paddingTop: 20,
    paddingBottom: 10,
  },
  contentInput: {
    flex: 1,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: Colors.black,
    lineHeight: 24,
    paddingHorizontal: Spacing.side,
    paddingTop: 8,
    paddingBottom: 24,
  },
});
