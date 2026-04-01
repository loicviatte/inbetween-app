import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Spacing } from '../../theme';
import { getTrainingSessionDetail, getClassDetail } from '../../services/coachStorage';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const FEELINGS = {
  'Hard':      '😤',
  'Struggled': '😰',
  'Okay':      '😐',
  'Good':      '🙂',
  'Great':     '🔥',
};

function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const timeStr = `${hh}:${mm}`;
  if (d.toDateString() === now.toDateString()) return `Today at ${timeStr}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday at ${timeStr}`;
  if (d.getFullYear() === now.getFullYear())
    return `${MONTHS[d.getMonth()]} ${d.getDate()} at ${timeStr}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function Row({ label, value, accent }) {
  if (!value) return null;
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, accent && { color: accent }]}>{value}</Text>
    </View>
  );
}

function Section({ title, children }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function TrainingDetail({ session }) {
  return (
    <>
      <Section title="SESSION">
        <Row label="Date" value={formatDate(session.started_at)} />
        {session.durationMin != null && (
          <Row label="Duration" value={`${session.durationMin} min`} />
        )}
        {session.feeling && (
          <Row
            label="Feeling"
            value={`${FEELINGS[session.feeling] || ''} ${session.feeling}`}
          />
        )}
      </Section>

      {(session.focus1Name || session.focus2Name) && (
        <Section title="FOCUSES WORKED">
          {session.focus1Name && (
            <View style={s.focusChip}>
              <View style={[s.focusDot, { backgroundColor: Colors.activeFocus }]} />
              <Text style={s.focusName}>{session.focus1Name}</Text>
            </View>
          )}
          {session.focus2Name && (
            <View style={s.focusChip}>
              <View style={[s.focusDot, { backgroundColor: Colors.activeHome }]} />
              <Text style={s.focusName}>{session.focus2Name}</Text>
            </View>
          )}
        </Section>
      )}

      {session.session_note ? (
        <Section title="NOTE">
          <Text style={s.noteText}>{session.session_note}</Text>
        </Section>
      ) : null}
    </>
  );
}

function ClassDetail({ cls }) {
  return (
    <>
      <Section title="CLASS">
        <Row label="Date" value={formatDate(cls.created_at)} />
        {cls.title ? <Row label="Title" value={cls.title} /> : null}
      </Section>

      {cls.takeaway ? (
        <Section title="KEY TAKEAWAY">
          <Text style={s.noteText}>{cls.takeaway}</Text>
        </Section>
      ) : null}

      {(cls.practice_point_1 || cls.practice_point_2) && (
        <Section title="PRACTICE POINTS">
          {cls.practice_point_1 && (
            <View style={s.practiceRow}>
              <View style={[s.focusDot, { backgroundColor: Colors.activeLog }]} />
              <Text style={s.practiceText}>{cls.practice_point_1}</Text>
            </View>
          )}
          {cls.practice_point_2 && (
            <View style={s.practiceRow}>
              <View style={[s.focusDot, { backgroundColor: Colors.activeLog }]} />
              <Text style={s.practiceText}>{cls.practice_point_2}</Text>
            </View>
          )}
        </Section>
      )}

      {(cls.ai_primary_focus || cls.ai_secondary_focus) && (
        <Section title="FOCUS AREAS">
          {cls.ai_primary_focus && (
            <View style={s.focusChip}>
              <View style={[s.focusDot, { backgroundColor: Colors.activeFocus }]} />
              <Text style={s.focusName}>{cls.ai_primary_focus}</Text>
            </View>
          )}
          {cls.ai_secondary_focus && (
            <View style={s.focusChip}>
              <View style={[s.focusDot, { backgroundColor: Colors.activeHome }]} />
              <Text style={s.focusName}>{cls.ai_secondary_focus}</Text>
            </View>
          )}
        </Section>
      )}
    </>
  );
}

export default function CoachSessionDetailScreen({ route, navigation }) {
  const { type, sessionId, studentName } = route.params;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        if (type === 'training') {
          setData(await getTrainingSessionDetail(sessionId));
        } else {
          setData(await getClassDetail(sessionId));
        }
      } catch {}
      setLoading(false);
    }
    load();
  }, [sessionId, type]);

  const isTraining = type === 'training';
  const typeLabel = isTraining ? 'Training' : 'Class';

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backArrow}>‹</Text>
          <Text style={s.backLabel}>Sessions</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator color={Colors.secondary} />
        </View>
      ) : !data ? (
        <View style={s.loadingWrap}>
          <Text style={s.emptyText}>Session not found.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          <Text style={s.typeTag}>{typeLabel.toUpperCase()}</Text>
          <Text style={s.studentName}>{studentName}</Text>

          {isTraining ? (
            <TrainingDetail session={data} />
          ) : (
            <ClassDetail cls={data} />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingTop: 6,
    paddingBottom: 10,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backArrow: { fontSize: 26, color: Colors.activeFocus, lineHeight: 30 },
  backLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 17,
    color: Colors.activeFocus,
  },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: Colors.secondary,
  },
  scroll: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 60,
  },
  typeTag: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: Colors.secondary,
    letterSpacing: 0.8,
    marginBottom: 4,
    marginTop: 4,
  },
  studentName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 26,
    color: Colors.black,
    marginBottom: 28,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: Colors.secondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(13,13,18,0.07)',
  },
  rowLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: Colors.secondary,
  },
  rowValue: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 14,
    color: Colors.black,
  },
  focusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(13,13,18,0.07)',
  },
  focusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  focusName: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 14,
    color: Colors.black,
    flex: 1,
  },
  noteText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 15,
    color: Colors.black,
    lineHeight: 24,
  },
  practiceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(13,13,18,0.07)',
  },
  practiceText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: Colors.black,
    flex: 1,
    lineHeight: 22,
  },
});
