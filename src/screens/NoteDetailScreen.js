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
  ScrollView,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../theme';
import { getNoteById, saveNote, deleteNote, getClassInputs } from '../services/storage';

let ImagePicker = null;
try { ImagePicker = require('expo-image-picker'); } catch (_) {}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(ts) {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function ClassPickerModal({ visible, onClose, onSelect, currentId }) {
  const [inputs, setInputs] = useState([]);

  useEffect(() => {
    if (!visible) return;
    getClassInputs().then((ci) => {
      setInputs(ci); // already sorted by created_at desc from Supabase
    });
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={picker.overlay}>
        <View style={picker.sheet}>
          <View style={picker.header}>
            <Text style={picker.title}>Link to class entry</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={picker.close}>✕</Text>
            </TouchableOpacity>
          </View>
          {currentId && (
            <TouchableOpacity style={picker.unlinkBtn} onPress={() => onSelect(null)} activeOpacity={0.7}>
              <Text style={picker.unlinkText}>Remove link</Text>
            </TouchableOpacity>
          )}
          <FlatList
            data={inputs}
            keyExtractor={(i) => i.id}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
            renderItem={({ item }) => {
              const isSelected = item.id === currentId;
              return (
                <TouchableOpacity
                  style={[picker.item, isSelected && picker.itemSelected]}
                  onPress={() => onSelect(item.id)}
                  activeOpacity={0.7}
                >
                  <View style={picker.itemLeft}>
                    <Text style={picker.itemDate}>{formatDate(item.created_at)}</Text>
                    {item.ai_primary_focus && <Text style={picker.itemFocus}>{item.ai_primary_focus}</Text>}
                    <Text style={picker.itemText} numberOfLines={1}>{item.practice_point_1}</Text>
                  </View>
                  {isSelected && <Text style={picker.checkmark}>✓</Text>}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

export default function NoteDetailScreen({ route, navigation }) {
  const { noteId, linked_class_input_id: initialLinkedId } = route.params || {};
  const isNew = !noteId;

  const [id] = useState(noteId || null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [video_clips, setVideoClips] = useState([]);
  const [linked_class_input_id, setLinkedClassInputId] = useState(initialLinkedId || null);
  const [linkedClass, setLinkedClass] = useState(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const autoSaveTimer = useRef(null);
  const hasChanges = useRef(false);
  const stateRef = useRef({ title, content, video_clips, linked_class_input_id });

  // Keep ref in sync
  useEffect(() => {
    stateRef.current = { title, content, video_clips, linked_class_input_id };
  }, [title, content, video_clips, linked_class_input_id]);

  useEffect(() => {
    if (!isNew) {
      getNoteById(noteId).then((note) => {
        if (note) {
          setTitle(note.title || '');
          setContent(note.content || '');
          setVideoClips(note.video_clips || []);
          setLinkedClassInputId(note.linked_class_input_id || null);
        }
      });
    }
  }, [noteId, isNew]);

  // Load linked class info for display
  useEffect(() => {
    if (!linked_class_input_id) { setLinkedClass(null); return; }
    getClassInputs().then((ci) => {
      const entry = ci.find((i) => i.id === linked_class_input_id);
      setLinkedClass(entry || null);
    });
  }, [linked_class_input_id]);

  async function persist(data) {
    await saveNote({
      ...(id ? { id } : {}),
      title: data.title,
      content: data.content,
      video_clips: data.video_clips,
      linked_class_input_id: data.linked_class_input_id,
    });
  }

  function scheduleAutoSave() {
    hasChanges.current = true;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      persist(stateRef.current);
    }, 800);
  }

  function handleTitleChange(text) { setTitle(text); scheduleAutoSave(); }
  function handleContentChange(text) { setContent(text); scheduleAutoSave(); }


  useFocusEffect(
    useCallback(() => {
      return () => {
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        if (hasChanges.current) persist(stateRef.current);
      };
    }, [])
  );

  async function pickVideo() {
    if (!ImagePicker) {
      Alert.alert('Not available', 'Video picking is not available in this environment.');
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      quality: 1,
    });
    if (!result.canceled && result.assets?.length > 0) {
      const asset = result.assets[0];
      const clip = {
        uri: asset.uri,
        filename: asset.fileName || asset.uri.split('/').pop(),
        duration: asset.duration ? Math.round(asset.duration) : null,
      };
      const updated = [...stateRef.current.video_clips, clip];
      setVideoClips(updated);
      scheduleAutoSave();
    }
  }

  function removeClip(index) {
    Alert.alert('Remove clip', 'Remove this video from the note?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: () => {
          const updated = stateRef.current.video_clips.filter((_, i) => i !== index);
          setVideoClips(updated);
          scheduleAutoSave();
        },
      },
    ]);
  }

  function handleDelete() {
    Alert.alert('Delete note', 'Are you sure you want to delete this note?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
          if (!isNew) await deleteNote(id);
          navigation.goBack();
        },
      },
    ]);
  }

  function handleLinkSelect(classId) {
    setLinkedClassInputId(classId);
    hasChanges.current = true;
    setPickerVisible(false);
    scheduleAutoSave();
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

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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
            placeholder="Start writing…"
            placeholderTextColor={Colors.secondary}
            multiline
            textAlignVertical="top"
            autoFocus={isNew}
          />

          {/* Video clips */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Video clips</Text>
              <TouchableOpacity style={styles.sectionAction} onPress={pickVideo} activeOpacity={0.7}>
                <Text style={styles.sectionActionText}>+ Add</Text>
              </TouchableOpacity>
            </View>
            {video_clips.length === 0 ? (
              <TouchableOpacity style={styles.videoEmptyBox} onPress={pickVideo} activeOpacity={0.7}>
                <Text style={styles.videoEmptyIcon}>▶</Text>
                <Text style={styles.videoEmptyText}>Add a video clip from your library</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.clipsList}>
                {video_clips.map((clip, i) => (
                  <TouchableOpacity key={i} style={styles.clipItem} onLongPress={() => removeClip(i)} activeOpacity={0.8}>
                    <View style={styles.clipThumb}>
                      <Text style={styles.clipThumbIcon}>▶</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.clipName} numberOfLines={1}>{clip.filename}</Text>
                      {clip.duration != null && (
                        <Text style={styles.clipDuration}>{clip.duration}s</Text>
                      )}
                    </View>
                    <TouchableOpacity onPress={() => removeClip(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.clipRemove}>✕</Text>
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Link to class */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Linked class</Text>
              <TouchableOpacity style={styles.sectionAction} onPress={() => setPickerVisible(true)} activeOpacity={0.7}>
                <Text style={styles.sectionActionText}>{linked_class_input_id ? 'Change' : '+ Link'}</Text>
              </TouchableOpacity>
            </View>
            {linkedClass ? (
              <View style={styles.linkedCard}>
                <View style={styles.linkedCardLeft} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.linkedDate}>{formatDate(linkedClass.created_at)}</Text>
                  {linkedClass.ai_primary_focus && <Text style={styles.linkedFocus}>{linkedClass.ai_primary_focus}</Text>}
                  <Text style={styles.linkedText} numberOfLines={2}>{linkedClass.practice_point_1}</Text>
                </View>
                <TouchableOpacity onPress={() => handleLinkSelect(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.clipRemove}>✕</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.linkEmptyBox} onPress={() => setPickerVisible(true)} activeOpacity={0.7}>
                <Text style={styles.linkEmptyText}>Link this note to a class entry</Text>
                <Text style={styles.linkEmptyArrow}>→</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <ClassPickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={handleLinkSelect}
        currentId={linked_class_input_id}
      />
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
  backArrow: { fontSize: 18, color: Colors.black },
  backLabel: { fontFamily: Fonts.jakartaMedium, fontSize: 15, color: Colors.black },
  deleteBtn: { fontFamily: Fonts.jakartaMedium, fontSize: 14, color: '#FF4444' },

  scrollContent: { paddingBottom: 60 },
  titleInput: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 24,
    color: Colors.black,
    paddingHorizontal: Spacing.side,
    paddingTop: 20,
    paddingBottom: 8,
    letterSpacing: -0.5,
  },
  contentInput: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: Colors.black,
    lineHeight: 24,
    paddingHorizontal: Spacing.side,
    paddingTop: 4,
    paddingBottom: 24,
    minHeight: 120,
  },

  // Section
  section: {
    marginTop: 4,
    paddingTop: 16,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(17,12,17,0.07)',
    paddingHorizontal: Spacing.side,
    marginBottom: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: Colors.black,
    letterSpacing: 0,
  },
  sectionAction: {
    backgroundColor: Colors.statCardBg,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
  },
  sectionActionText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 12,
    color: Colors.black,
  },

  // Video
  videoEmptyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.statCardBg,
    borderRadius: 10,
    padding: 14,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderStyle: 'dashed',
  },
  videoEmptyIcon: { fontSize: 18, color: Colors.secondary },
  videoEmptyText: { fontFamily: Fonts.jakartaRegular, fontSize: 13, color: Colors.secondary },
  clipsList: { gap: 8 },
  clipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.statCardBg,
    borderRadius: 10,
    padding: 10,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
  },
  clipThumb: {
    width: 40, height: 40, borderRadius: 8,
    backgroundColor: Colors.focusCard,
    alignItems: 'center', justifyContent: 'center',
  },
  clipThumbIcon: { fontSize: 14, color: Colors.white },
  clipName: { fontFamily: Fonts.jakartaMedium, fontSize: 13, color: Colors.black },
  clipDuration: { fontFamily: Fonts.jakartaRegular, fontSize: 11, color: Colors.secondary },
  clipRemove: { fontSize: 14, color: Colors.secondary, paddingLeft: 4 },

  // Linked class
  linkEmptyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.statCardBg,
    borderRadius: 10,
    padding: 14,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderStyle: 'dashed',
  },
  linkEmptyText: { fontFamily: Fonts.jakartaRegular, fontSize: 13, color: Colors.secondary },
  linkEmptyArrow: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: Colors.secondary },
  linkedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.statCardBg,
    borderRadius: 10,
    padding: 12,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    overflow: 'hidden',
  },
  linkedCardLeft: {
    width: 3, alignSelf: 'stretch',
    backgroundColor: Colors.activeLog,
    borderRadius: 2,
  },
  linkedDate: { fontFamily: Fonts.jakartaMedium, fontSize: 11, color: Colors.secondary, marginBottom: 2 },
  linkedFocus: { fontFamily: Fonts.jakartaBold, fontSize: 13, color: Colors.activeLog, marginBottom: 2 },
  linkedText: { fontFamily: Fonts.jakartaRegular, fontSize: 12, color: Colors.secondary, lineHeight: 17 },
});

const picker = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '75%',
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(17,12,17,0.08)',
  },
  title: { fontFamily: Fonts.jakartaExtraBold, fontSize: 16, color: Colors.black },
  close: { fontSize: 18, color: Colors.secondary },
  unlinkBtn: {
    marginHorizontal: 20,
    marginTop: 12,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(255,68,68,0.08)',
    borderRadius: 10,
  },
  unlinkText: { fontFamily: Fonts.jakartaBold, fontSize: 13, color: '#FF4444' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(17,12,17,0.06)',
    gap: 10,
  },
  itemSelected: { opacity: 1 },
  itemLeft: { flex: 1 },
  itemDate: { fontFamily: Fonts.jakartaMedium, fontSize: 11, color: Colors.secondary, marginBottom: 2 },
  itemFocus: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: Colors.activeLog, marginBottom: 2 },
  itemText: { fontFamily: Fonts.jakartaRegular, fontSize: 13, color: Colors.secondary },
  checkmark: { fontSize: 16, color: Colors.activeLog, fontWeight: 'bold' },
});
