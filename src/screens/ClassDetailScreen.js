import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Spacing } from '../theme';
import { getClassInputs, getFocusPoints, getNotesLinkedToClass } from '../services/storage';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(ts) {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export default function ClassDetailScreen({ route, navigation }) {
  const { inputId } = route.params;
  const [item, setItem] = useState(null);
  const [focusMap, setFocusMap] = useState({});
  const [linkedNotes, setLinkedNotes] = useState([]);

  useEffect(() => {
    async function load() {
      const [inputs, points, notes] = await Promise.all([
        getClassInputs(), getFocusPoints(), getNotesLinkedToClass(inputId),
      ]);
      const found = inputs.find((i) => i.id === inputId);
      setItem(found || null);
      setLinkedNotes(notes);
      const map = {};
      for (const p of points) map[p.id] = p;
      setFocusMap(map);
    }
    load();
  }, [inputId]);

  if (!item) return null;

  const primaryFp = focusMap[item.ai_primary_focus];
  const secondaryFp = focusMap[item.ai_secondary_focus];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backLabel}>Log</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Class Log</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.date}>{formatDate(item.createdAt)}</Text>

        {/* Point 1 */}
        <View style={styles.card}>
          {primaryFp && (
            <View style={styles.focusBadge}>
              <Text style={styles.focusBadgeText}>{primaryFp.label}</Text>
            </View>
          )}
          <Text style={styles.pointLabel}>Point 1</Text>
          <Text style={styles.pointText}>{item.input1}</Text>
          {item.urgency1 != null && (
            <View style={styles.urgencyRow}>
              <Text style={styles.urgencyLabel}>Urgency</Text>
              <View style={styles.urgencyDots}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <View
                    key={n}
                    style={[
                      styles.urgencyDot,
                      n <= item.urgency1 && { backgroundColor: Colors.activeLog },
                    ]}
                  />
                ))}
              </View>
            </View>
          )}
        </View>

        {/* Point 2 */}
        {item.input2 && (
          <View style={[styles.card, { marginTop: 14 }]}>
            {secondaryFp && (
              <View style={styles.focusBadge}>
                <Text style={styles.focusBadgeText}>{secondaryFp.label}</Text>
              </View>
            )}
            <Text style={styles.pointLabel}>Point 2</Text>
            <Text style={styles.pointText}>{item.input2}</Text>
            {item.urgency2 != null && (
              <View style={styles.urgencyRow}>
                <Text style={styles.urgencyLabel}>Urgency</Text>
                <View style={styles.urgencyDots}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <View
                      key={n}
                      style={[
                        styles.urgencyDot,
                        n <= item.urgency2 && { backgroundColor: Colors.activeLog },
                      ]}
                    />
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        {/* AI Focus summary */}
        {primaryFp?.description ? (
          <View style={styles.aiCard}>
            <Text style={styles.aiTitle}>Focus insight</Text>
            <Text style={styles.aiBody}>{primaryFp.description}</Text>
          </View>
        ) : null}

        {/* Linked notes */}
        {linkedNotes.length > 0 && (
          <View style={styles.notesSection}>
            <Text style={styles.notesSectionTitle}>Linked notes</Text>
            {linkedNotes.map((note) => (
              <TouchableOpacity
                key={note.id}
                style={styles.noteItem}
                onPress={() => navigation.navigate('NoteDetail', { noteId: note.id })}
                activeOpacity={0.75}
              >
                <View style={styles.noteAccent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.noteTitle}>{note.title || 'Untitled'}</Text>
                  {note.content ? (
                    <Text style={styles.notePreview} numberOfLines={1}>{note.content}</Text>
                  ) : null}
                </View>
                {note.videoClips?.length > 0 && (
                  <Text style={styles.noteClipCount}>{note.videoClips.length} clip{note.videoClips.length > 1 ? 's' : ''}</Text>
                )}
                <Text style={styles.noteArrow}>→</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
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
    borderBottomWidth: 0,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backArrow: { fontSize: 16, color: Colors.black },
  backLabel: { fontFamily: Fonts.jakartaMedium, fontSize: 15, color: Colors.black },
  headerTitle: { fontFamily: Fonts.jakartaExtraBold, fontSize: 15, color: Colors.black },
  headerRight: { width: 60 },
  content: { paddingHorizontal: Spacing.side, paddingTop: 20, paddingBottom: 40 },
  date: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: Colors.secondary,
    marginBottom: 24,
    letterSpacing: 0.3,
  },
  card: {
    backgroundColor: Colors.statCardBg,
    borderRadius: 12,
    padding: 16,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
  },
  focusBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.activeLog,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: 10,
  },
  focusBadgeText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: Colors.white,
  },
  pointLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.secondary,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pointText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: Colors.black,
    lineHeight: 22,
  },
  urgencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 10,
  },
  urgencyLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.secondary,
  },
  urgencyDots: { flexDirection: 'row', gap: 5 },
  urgencyDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(17,12,17,0.12)',
  },
  aiCard: {
    backgroundColor: 'rgba(215,150,255,0.06)',
    borderRadius: 10,
    padding: 14,
    marginTop: 20,
  },
  aiTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: Colors.black,
    marginBottom: 6,
  },
  aiBody: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: Colors.secondary,
    lineHeight: 20,
  },
  notesSection: { marginTop: 24 },
  notesSectionTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: Colors.black,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  noteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.statCardBg,
    borderRadius: 10,
    padding: 12,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
    marginBottom: 8,
  },
  noteAccent: {
    width: 3, alignSelf: 'stretch',
    backgroundColor: Colors.activeHome,
    borderRadius: 2,
  },
  noteTitle: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: Colors.black, marginBottom: 2 },
  notePreview: { fontFamily: Fonts.jakartaRegular, fontSize: 12, color: Colors.secondary },
  noteClipCount: { fontFamily: Fonts.jakartaRegular, fontSize: 11, color: Colors.secondary },
  noteArrow: { fontFamily: Fonts.jakartaBold, fontSize: 14, color: Colors.secondary },
});
