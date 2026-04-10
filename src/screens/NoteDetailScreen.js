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
  Keyboard,
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../theme';
import { getNoteById, saveNote, deleteNote, getClassInputs } from '../storage/storage';

let ImagePicker = null;
try { ImagePicker = require('expo-image-picker'); } catch (_) {}

let ExpoAV = null;
try { ExpoAV = require('expo-av'); } catch (_) {}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(ts) {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatNoteTimestamp(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const time = `${hh}:${mm}`;
  if (d.toDateString() === now.toDateString()) return `Today at ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`;
  if (d.getFullYear() === now.getFullYear()) return `${MONTHS[d.getMonth()]} ${d.getDate()} at ${time}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// ─── Video player modal ───────────────────────────────────────────────────────

function VideoPlayerModal({ uri, onClose }) {
  if (!uri) return null;

  if (!ExpoAV) {
    return (
      <Modal visible animationType="fade" transparent onRequestClose={onClose}>
        <View style={vm.overlay}>
          <View style={vm.errorBox}>
            <Text style={vm.errorText}>Video playback is not available in this environment.</Text>
            <TouchableOpacity style={vm.errorBtn} onPress={onClose}>
              <Text style={vm.errorBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  const { Video, ResizeMode } = ExpoAV;

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={vm.overlay}>
        <TouchableOpacity style={vm.closeBtn} onPress={onClose} activeOpacity={0.8}>
          <Ionicons name="close" size={20} color="#fff" />
        </TouchableOpacity>
        <Video
          source={{ uri }}
          style={vm.video}
          useNativeControls
          resizeMode={ResizeMode?.CONTAIN ?? 'contain'}
          shouldPlay
        />
      </View>
    </Modal>
  );
}

// ─── Class picker modal ───────────────────────────────────────────────────────

function ClassPickerModal({ visible, onClose, onSelect, currentId }) {
  const [inputs, setInputs] = useState([]);

  useEffect(() => {
    if (!visible) return;
    getClassInputs().then((ci) => { setInputs(ci); });
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={picker.overlay}>
        <View style={picker.sheet}>
          <View style={picker.header}>
            <Text style={picker.title}>Link to class</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={20} color={Colors.secondary} />
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
                    <Text style={picker.itemFocus} numberOfLines={1}>{item.title || 'Class Log'}</Text>
                    {item.practice_point_1 && <Text style={picker.itemText} numberOfLines={1}>{item.practice_point_1}</Text>}
                  </View>
                  {isSelected && <Ionicons name="checkmark" size={18} color={Colors.activeLog} />}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

const BOTTOM_BAR_H = 50;

export default function NoteDetailScreen({ route, navigation }) {
  const { noteId, linked_class_input_id: initialLinkedId, backLabel } = route.params || {};
  const isNew = !noteId;

  const idRef = useRef(noteId || null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [video_clips, setVideoClips] = useState([]);
  const [linked_class_input_id, setLinkedClassInputId] = useState(initialLinkedId || null);
  const [linkedClass, setLinkedClass] = useState(null);
  const [noteDate, setNoteDate] = useState(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [playingVideoUri, setPlayingVideoUri] = useState(null);
  // FAB appears only while keyboard is open
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const autoSaveTimer = useRef(null);
  const hasChanges = useRef(false);
  const stateRef = useRef({ title, content, video_clips, linked_class_input_id });

  // Animated FAB — always above bottom bar + keyboard
  const fabBottom = useRef(new Animated.Value(BOTTOM_BAR_H + 16)).current;

  useEffect(() => {
    const onShow = (e) => {
      // endCoordinates.height is measured from the screen bottom (same origin as
      // absolute `bottom` values inside the SafeAreaView frame), so use it directly.
      const target = e.endCoordinates.height + BOTTOM_BAR_H + 16;
      fabBottom.setValue(target);
      setKeyboardVisible(true);
    };
    const onHide = () => {
      // Hide immediately — no downward animation that would cross the bottom bar.
      setKeyboardVisible(false);
    };
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s1 = Keyboard.addListener(showEvt, onShow);
    const s2 = Keyboard.addListener(hideEvt, onHide);
    return () => { s1.remove(); s2.remove(); };
  }, []);

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
          setNoteDate(note.updated_at || note.created_at || null);
        }
      });
    }
  }, [noteId, isNew]);

  useEffect(() => {
    if (!linked_class_input_id) { setLinkedClass(null); return; }
    getClassInputs().then((ci) => {
      const entry = ci.find((i) => i.id === linked_class_input_id);
      setLinkedClass(entry || null);
    });
  }, [linked_class_input_id]);

  async function persist(data) {
    const savedId = await saveNote({
      ...(idRef.current ? { id: idRef.current } : {}),
      title: data.title,
      content: data.content,
      video_clips: data.video_clips,
      linked_class_input_id: data.linked_class_input_id,
    });
    if (!idRef.current && savedId) idRef.current = savedId;
  }

  function scheduleAutoSave() {
    hasChanges.current = true;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => { persist(stateRef.current); }, 800);
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
          hasChanges.current = false;
          if (idRef.current) await deleteNote(idRef.current);
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

  // Check tapped → close keyboard + immediate save
  function handleSaveAndClose() {
    Keyboard.dismiss();
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    if (hasChanges.current) {
      persist(stateRef.current);
      hasChanges.current = false;
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={Colors.activeFocus} />
          <Text style={styles.backLabel} numberOfLines={1}>{backLabel || 'Notes'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleDelete} activeOpacity={0.7}>
          <Text style={styles.deleteText}>Delete</Text>
        </TouchableOpacity>
      </View>

      {/* ── Main content + bottom bar ── */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Date stamp */}
          {noteDate ? (
            <Text style={styles.dateStamp}>{formatNoteTimestamp(noteDate)}</Text>
          ) : null}

          {/* Linked class badge — above title */}
          {linkedClass && (
            <View style={styles.classLinkedRow}>
              <View style={styles.classLinkedDot} />
              <TouchableOpacity
                style={{ flex: 1 }}
                onPress={() => navigation.navigate('ClassDetail', { inputId: linkedClass.id })}
                activeOpacity={0.7}
              >
                <Text style={styles.classLinkedText} numberOfLines={1}>
                  Class linked:{' '}
                  <Text style={styles.classLinkedName}>
                    {linkedClass.title || formatDate(linkedClass.created_at)}
                  </Text>
                </Text>
              </TouchableOpacity>
              {keyboardVisible && (
                <TouchableOpacity
                  onPress={() => handleLinkSelect(null)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle" size={16} color={Colors.secondary} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Title */}
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={handleTitleChange}
            placeholder="Title"
            placeholderTextColor="rgba(13,13,18,0.2)"
            returnKeyType="next"
            blurOnSubmit={false}
            maxLength={100}
            />

          {/* Video chips — only when clips exist */}
          {video_clips.length > 0 && (
            <>
              <View style={styles.attachDivider} />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.attachRow}
              >
                {video_clips.map((clip, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.videoChip}
                    onPress={() => setPlayingVideoUri(clip.uri)}
                    onLongPress={() => removeClip(i)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.videoChipThumb}>
                      <Ionicons name="play" size={11} color={Colors.white} />
                    </View>
                    <View style={{ flexShrink: 1 }}>
                      <Text style={styles.videoChipLabel} numberOfLines={1}>
                        {clip.filename.split('/').pop()}
                      </Text>
                      {clip.duration != null && (
                        <Text style={styles.videoChipDuration}>{clip.duration}s</Text>
                      )}
                    </View>
                    {keyboardVisible && (
                      <TouchableOpacity
                        onPress={() => removeClip(i)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="close-circle" size={16} color={Colors.secondary} />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          {/* Body divider */}
          <View style={styles.bodyDivider} />

          {/* Content */}
          <TextInput
            style={styles.contentInput}
            value={content}
            onChangeText={handleContentChange}
            placeholder="Start writing…"
            placeholderTextColor="rgba(13,13,18,0.2)"
            multiline
            textAlignVertical="top"
            autoFocus={isNew}
          />
        </ScrollView>

        {/* Bottom toolbar */}
        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.bottomAction} onPress={pickVideo} activeOpacity={0.7}>
            <Ionicons name="videocam-outline" size={18} color={Colors.secondary} />
            <Text style={styles.bottomActionText}>Add Video</Text>
          </TouchableOpacity>
          <View style={styles.bottomDivider} />
          <TouchableOpacity style={styles.bottomAction} onPress={() => setPickerVisible(true)} activeOpacity={0.7}>
            <Ionicons
              name={linked_class_input_id ? 'link' : 'link-outline'}
              size={18}
              color={linked_class_input_id ? Colors.activeLog : Colors.secondary}
            />
            <Text style={[styles.bottomActionText, linked_class_input_id && styles.bottomActionLinked]}>
              {linked_class_input_id ? 'Class Linked' : 'Link Class'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* ── Floating save button — appears when keyboard is open ── */}
      {keyboardVisible && (
        <Animated.View style={[styles.fab, { bottom: fabBottom }]}>
          <TouchableOpacity
            style={styles.fabTouchable}
            onPress={handleSaveAndClose}
            activeOpacity={0.85}
          >
            <Ionicons name="checkmark-sharp" size={22} color={Colors.white} />
          </TouchableOpacity>
        </Animated.View>
      )}

      <ClassPickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={handleLinkSelect}
        currentId={linked_class_input_id}
      />

      <VideoPlayerModal
        uri={playingVideoUri}
        onClose={() => setPlayingVideoUri(null)}
      />

    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.side,
    paddingTop: 6,
    paddingBottom: 2,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 17,
    color: Colors.activeFocus,
  },
  deleteText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 15,
    color: '#FF3B30',
  },

  scrollContent: { paddingBottom: 40 },

  dateStamp: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: Colors.secondary,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 4,
  },

  classLinkedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: Spacing.side,
    marginTop: 8,
    marginBottom: 2,
  },
  classLinkedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.activeLog,
    flexShrink: 0,
  },
  classLinkedText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    flex: 1,
  },
  classLinkedName: {
    fontFamily: Fonts.jakartaBold,
    color: Colors.activeLog,
  },

  titleInput: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 28,
    color: Colors.black,
    paddingHorizontal: Spacing.side,
    paddingTop: 12,
    paddingBottom: 10,
    letterSpacing: -0.5,
    lineHeight: 36,
  },

  attachDivider: {
    height: 1,
    backgroundColor: 'rgba(13,13,18,0.06)',
    marginHorizontal: Spacing.side,
  },
  attachRow: {
    paddingHorizontal: Spacing.side,
    paddingVertical: 10,
    gap: 8,
  },
  videoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(13,13,18,0.07)',
    borderRadius: 22,
    paddingVertical: 7,
    paddingLeft: 7,
    paddingRight: 12,
    maxWidth: 200,
  },
  videoChipThumb: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.focusCard,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  videoChipLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: Colors.black,
    flexShrink: 1,
  },
  videoChipDuration: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11,
    color: Colors.secondary,
  },

  bodyDivider: {
    height: 1,
    backgroundColor: 'rgba(13,13,18,0.06)',
    marginHorizontal: Spacing.side,
    marginTop: 4,
  },

  contentInput: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 16,
    color: Colors.black,
    lineHeight: 27,
    paddingHorizontal: Spacing.side,
    paddingTop: 18,
    paddingBottom: 100,
    minHeight: 220,
  },

  // Floating save button — absolutely positioned in SafeAreaView, outside KAV
  fab: {
    position: 'absolute',
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.activeLog,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  fabTouchable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 26,
  },

  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(13,13,18,0.07)',
    backgroundColor: Colors.background,
    paddingVertical: 12,
  },
  bottomAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 4,
  },
  bottomDivider: {
    width: 1,
    height: 22,
    backgroundColor: 'rgba(13,13,18,0.08)',
  },
  bottomActionText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: Colors.secondary,
  },
  bottomActionLinked: {
    color: Colors.activeLog,
  },
});

// ─── Video player modal styles ────────────────────────────────────────────────

const vm = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 56,
    right: 20,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  video: {
    width: '100%',
    height: 300,
  },
  errorBox: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    margin: 32,
    alignItems: 'center',
    gap: 16,
  },
  errorText: {
    fontFamily: 'System',
    fontSize: 15,
    color: '#ccc',
    textAlign: 'center',
  },
  errorBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: '#333',
    borderRadius: 10,
  },
  errorBtnText: {
    fontFamily: 'System',
    fontSize: 15,
    color: '#fff',
  },
});

// ─── Class picker styles ──────────────────────────────────────────────────────

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
    borderBottomColor: 'rgba(13,13,18,0.08)',
  },
  title: { fontFamily: Fonts.jakartaExtraBold, fontSize: 16, color: Colors.black },
  close: { fontSize: 18, color: Colors.secondary },
  unlinkBtn: {
    marginHorizontal: 20,
    marginTop: 12,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(255,59,48,0.08)',
    borderRadius: 10,
  },
  unlinkText: { fontFamily: Fonts.jakartaBold, fontSize: 13, color: '#FF3B30' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(13,13,18,0.06)',
    gap: 10,
  },
  itemSelected: { opacity: 1 },
  itemLeft: { flex: 1 },
  itemDate: { fontFamily: Fonts.jakartaMedium, fontSize: 11, color: Colors.secondary, marginBottom: 2 },
  itemFocus: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: Colors.activeLog, marginBottom: 2 },
  itemText: { fontFamily: Fonts.jakartaRegular, fontSize: 13, color: Colors.secondary },
});
