import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../theme';
import { listStudios, createStudio } from '../storage/studioStorage';
import { filterStudios, hasExactMatch } from '../utils/studioMatch';

// A type-to-search studio picker. Tapping the field opens a sheet with a
// TextInput that filters the list as the user types; matching studios show up
// directly below. Coaches can also create a brand-new studio with whatever
// they typed, as long as no existing studio matches exactly.
//
// Props:
//   value          — currently selected studio { id, name } | null
//   onChange(s)    — fires when a studio is picked / created
//   allowCreate    — show a "+ Create '<typed>'" affordance when no exact match
//   placeholder    — text shown in the closed field

export default function StudioPicker({
  value,
  onChange,
  allowCreate = false,
  placeholder = 'Select your studio',
}) {
  const [open, setOpen] = useState(false);
  const [studios, setStudios] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const list = await listStudios();
      setStudios(list);
    } catch (e) {
      setError(e.message || 'Could not load studios.');
    }
    setLoading(false);
  }

  useEffect(() => {
    if (open) load();
    else { setQuery(''); setError(''); }
  }, [open]);

  function handlePick(s) {
    onChange(s);
    setOpen(false);
  }

  async function handleCreate() {
    if (creating) return;
    const name = query.trim();
    if (!name) return;
    setCreating(true);
    setError('');
    try {
      const s = await createStudio(name);
      handlePick(s);
    } catch (e) {
      setError(e.message || 'Could not create studio.');
    }
    setCreating(false);
  }

  const matches = filterStudios(studios, query);
  const trimmed = query.trim();
  const showCreate = allowCreate && trimmed.length >= 2 && !hasExactMatch(studios, trimmed);

  return (
    <View>
      <TouchableOpacity
        style={s.field}
        onPress={() => setOpen(true)}
        activeOpacity={0.75}
      >
        <Text style={[s.fieldText, !value && s.fieldPlaceholder]} numberOfLines={1}>
          {value?.name || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={16} color={Colors.secondary} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={s.overlay} onPress={() => setOpen(false)}>
            <Pressable style={s.sheet} onPress={() => {}}>
              <View style={s.handle} />
              <Text style={s.sheetTitle}>Choose your studio</Text>

              <View style={s.searchWrap}>
                <Ionicons name="search" size={16} color={Colors.secondary} style={s.searchIcon} />
                <TextInput
                  style={s.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search by name…"
                  placeholderTextColor="rgba(17,12,17,0.3)"
                  autoCorrect={false}
                  autoCapitalize="words"
                  autoFocus
                />
                {!!query && (
                  <TouchableOpacity onPress={() => setQuery('')} hitSlop={8} style={s.searchClear}>
                    <Ionicons name="close-circle" size={16} color={Colors.secondary} />
                  </TouchableOpacity>
                )}
              </View>

              {loading ? (
                <View style={s.loadingWrap}>
                  <ActivityIndicator color={Colors.black} />
                </View>
              ) : (
                <ScrollView
                  style={s.scroll}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  {matches.map((studio) => {
                    const selected = value?.id === studio.id;
                    return (
                      <TouchableOpacity
                        key={studio.id}
                        style={[s.row, selected && s.rowSelected]}
                        onPress={() => handlePick(studio)}
                        activeOpacity={0.7}
                      >
                        <Text style={[s.rowText, selected && s.rowTextSelected]} numberOfLines={1}>
                          {studio.name}
                        </Text>
                        {selected && <Ionicons name="checkmark" size={18} color={Colors.black} />}
                      </TouchableOpacity>
                    );
                  })}

                  {matches.length === 0 && trimmed.length > 0 && !showCreate && (
                    <Text style={s.empty}>No studios match "{trimmed}".</Text>
                  )}

                  {showCreate && (
                    <TouchableOpacity
                      style={s.createRow}
                      onPress={handleCreate}
                      disabled={creating}
                      activeOpacity={0.7}
                    >
                      {creating
                        ? <ActivityIndicator color={Colors.black} size="small" />
                        : <>
                            <Ionicons name="add" size={18} color={Colors.black} />
                            <Text style={s.createRowText} numberOfLines={1}>
                              Create "{trimmed}"
                            </Text>
                          </>
                      }
                    </TouchableOpacity>
                  )}

                  {!!error && <Text style={s.error}>{error}</Text>}
                </ScrollView>
              )}

              <TouchableOpacity style={s.close} onPress={() => setOpen(false)} activeOpacity={0.7}>
                <Text style={s.closeText}>Close</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  fieldText: {
    flex: 1,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: Colors.black,
    marginRight: 8,
  },
  fieldPlaceholder: { color: 'rgba(17,12,17,0.3)' },

  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
    maxHeight: '85%',
  },
  handle: {
    width: 36, height: 4,
    backgroundColor: 'rgba(17,12,17,0.12)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  sheetTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: Colors.black,
    marginBottom: 16,
    textAlign: 'center',
  },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.white,
    marginBottom: 12,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: Colors.black,
    paddingVertical: 8,
  },
  searchClear: { marginLeft: 8 },

  loadingWrap: { paddingVertical: 32, alignItems: 'center' },
  scroll: { maxHeight: 360 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    marginBottom: 8,
  },
  rowSelected: {
    backgroundColor: 'rgba(232,181,48,0.15)',
    borderColor: Colors.black,
  },
  rowText: {
    flex: 1,
    fontFamily: Fonts.jakartaMedium,
    fontSize: 15,
    color: Colors.black,
    marginRight: 8,
  },
  rowTextSelected: { fontFamily: Fonts.jakartaExtraBold },

  empty: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    textAlign: 'center',
    paddingVertical: 16,
  },

  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.black,
    borderStyle: 'dashed',
    marginTop: 4,
  },
  createRowText: {
    flex: 1,
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: Colors.black,
  },

  error: {
    color: '#E84040',
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
  },

  close: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  closeText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: Colors.secondary,
  },
});
