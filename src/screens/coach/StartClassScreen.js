import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { Colors, Fonts, Spacing } from '../../theme';
import { useCoachData } from '../../context/CoachDataContext';
import { getStudentFocusPoints, getStudentQuestions } from '../../storage/coachStorage';

// ── Palette ────────────────────────────────────────────────────────────────
const C = {
  bg: '#FAFAFA',
  surface: '#F0F0F0',
  card: '#FFFFFF',
  dark: '#141414',
  orange: '#E8A838',
  green: '#4AAF52',
  red: '#D44545',
  gray: '#999',
  lightGray: '#E5E5E5',
  text: '#0E0E0E',
};

// ── Helpers ────────────────────────────────────────────────────────────────
function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();
}

function gaugeColor(v) {
  return v > 70 ? C.green : v >= 40 ? C.orange : C.red;
}

// ── Mini gauge ─────────────────────────────────────────────────────────────
function MiniGauge({ value, label }) {
  const size = 50;
  const r = 20;
  const sw = 3.5;
  const circumference = 2 * Math.PI * r;
  const arc = circumference * 0.75;
  const offset = arc * (1 - (value || 0) / 100);
  const color = gaugeColor(value);

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.1)"
            strokeWidth={sw} strokeDasharray={`${arc} ${circumference}`} strokeLinecap="round"
            transform={`rotate(135 ${size / 2} ${size / 2})`} />
          <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color}
            strokeWidth={sw} strokeDasharray={`${arc} ${circumference}`} strokeDashoffset={offset}
            strokeLinecap="round" transform={`rotate(135 ${size / 2} ${size / 2})`} />
        </Svg>
        <View style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={g.gaugeVal}>{value || 0}%</Text>
        </View>
      </View>
      <Text style={g.gaugeLabel}>{label}</Text>
    </View>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ── Main Component ─────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════
export default function StartClassScreen({ navigation }) {
  const { students } = useCoachData();

  const [view, setView] = useState('select');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Detail data loaded when student is picked
  const [focusPoints, setFocusPoints] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Group data
  const [groupFPs, setGroupFPs] = useState([]);
  const [groupLoading, setGroupLoading] = useState(false);

  // Load student detail when picked
  const loadStudentDetail = useCallback(async (student) => {
    setSelectedStudent(student);
    setDetailLoading(true);
    setView('private-briefing');
    try {
      const [fps, qs] = await Promise.all([
        getStudentFocusPoints(student.id).catch(() => []),
        getStudentQuestions(student.id).catch(() => []),
      ]);
      setFocusPoints(fps || []);
      setQuestions(qs || []);
    } catch {}
    setDetailLoading(false);
  }, []);

  // Load group focus data
  const loadGroupData = useCallback(async () => {
    setGroupLoading(true);
    setView('group-briefing');
    try {
      const allFPs = await Promise.all(
        students.map(async (s) => {
          const fps = await getStudentFocusPoints(s.id).catch(() => []);
          return fps.map(fp => ({ ...fp, studentId: s.id, studentName: s.name }));
        })
      );

      // Aggregate by focus name
      const map = {};
      for (const fps of allFPs) {
        for (const fp of fps) {
          if (!map[fp.name]) map[fp.name] = { name: fp.name, students: 0, stuck: 0 };
          map[fp.name].students += 1;
          if (fp.weekCount === 0) map[fp.name].stuck += 1;
        }
      }
      const sorted = Object.values(map).sort((a, b) => b.stuck - a.stuck || b.students - a.students);
      setGroupFPs(sorted);
    } catch {}
    setGroupLoading(false);
  }, [students]);

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return students;
    return students.filter(s => (s.name || '').toLowerCase().includes(q));
  }, [students, searchQuery]);

  // ── VIEW 1: Select class type ──────────────────────────────────────────
  if (view === 'select') {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={22} color={C.text} />
          </TouchableOpacity>
        </View>

        <View style={s.content}>
          <Text style={s.pageTitle}>Start a class</Text>
          <Text style={s.pageSub}>Choose your class format to get started.</Text>

          {/* Private lesson card */}
          <TouchableOpacity
            style={s.typeCardDark}
            activeOpacity={0.85}
            onPress={() => setView('student-pick')}
          >
            <View style={s.typeIconDark}>
              <Ionicons name="person" size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.typeCardDarkTitle}>Private lesson</Text>
              <Text style={s.typeCardDarkSub}>One-on-one with personalized briefing</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.3)" />
          </TouchableOpacity>

          {/* Group class card */}
          <TouchableOpacity
            style={s.typeCardLight}
            activeOpacity={0.85}
            onPress={loadGroupData}
          >
            <View style={s.typeIconLight}>
              <Ionicons name="people" size={22} color={C.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.typeCardLightTitle}>Group class</Text>
              <Text style={s.typeCardLightSub}>Shared focus points across your squad</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.gray} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── VIEW 2: Student picker ─────────────────────────────────────────────
  if (view === 'student-pick') {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => setView('select')} style={s.backBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={22} color={C.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerLabel}>PRIVATE LESSON</Text>
            <Text style={s.headerTitle}>Select student</Text>
          </View>
        </View>

        {/* Search */}
        <View style={s.searchWrap}>
          <Ionicons name="search" size={18} color={C.gray} />
          <TextInput
            style={s.searchInput}
            placeholder="Search students..."
            placeholderTextColor={C.gray}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: Spacing.side, paddingBottom: 40 }}>
          {filteredStudents.map((st) => {
            const stuckCount = st.activeFocuses - st.fpSincePrivate;
            return (
              <TouchableOpacity
                key={st.id}
                style={s.studentRow}
                activeOpacity={0.7}
                onPress={() => loadStudentDetail(st)}
              >
                <View style={s.studentAvatar}>
                  <Text style={s.studentAvatarText}>{initials(st.name)}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.studentName}>{st.name}</Text>
                  <Text style={s.studentMeta}>{st.danceStyle || 'Dance'}{st.daysSincePractice != null ? ` · ${st.daysSincePractice}d ago` : ''}</Text>
                </View>
                {st.status === 'silent' && (
                  <View style={s.stuckBadge}>
                    <Text style={s.stuckBadgeText}>Silent</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={16} color={C.gray} />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── VIEW 3: Private briefing ───────────────────────────────────────────
  if (view === 'private-briefing' && selectedStudent) {
    const st = selectedStudent;
    const stuckPoints = focusPoints.filter(fp => fp.weekCount === 0);

    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => { setView('student-pick'); setSearchQuery(''); }} style={s.backBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={22} color={C.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerLabel}>PRIVATE LESSON</Text>
          </View>
          <Text style={[s.headerLabel, { color: C.gray }]}>BRIEFING</Text>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 120 }}>
          {/* Hero card */}
          <View style={s.heroCard}>
            <View style={s.heroTop}>
              <View style={s.heroAvatarWrap}>
                <Svg width={52} height={52} style={{ position: 'absolute' }}>
                  <Circle cx={26} cy={26} r={23} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={3} />
                  <Circle cx={26} cy={26} r={23} fill="none" stroke={gaugeColor(st.global)}
                    strokeWidth={3} strokeDasharray={`${2 * Math.PI * 23 * ((st.global || 0) / 100)} ${2 * Math.PI * 23}`}
                    strokeLinecap="round" transform="rotate(-90 26 26)" />
                </Svg>
                <View style={s.heroAvatarInner}>
                  <Text style={s.heroAvatarText}>{initials(st.name)[0]}</Text>
                </View>
              </View>
              <View>
                <Text style={s.heroName}>{st.name}</Text>
                <Text style={s.heroStyle}>{st.danceStyle || 'Dance'}</Text>
              </View>
            </View>

            <View style={s.gaugeRow}>
              <MiniGauge value={st.progression} label="Progression" />
              <MiniGauge value={st.retention} label="Retention" />
              <MiniGauge value={st.global} label="Global" />
            </View>

            <View style={s.activityPill}>
              <Ionicons name="trending-up" size={14} color="rgba(255,255,255,0.5)" />
              <Text style={s.activityPillText}>
                {st.fpSincePrivate} focus pts practiced since last class
              </Text>
            </View>
          </View>

          {/* Questions */}
          {questions.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>Student questions</Text>
              <View style={s.questionsCard}>
                {questions.map((q, i) => (
                  <View key={q.id} style={[s.questionRow, i > 0 && s.questionBorder]}>
                    <View style={s.questionIcon}>
                      <Text style={s.questionMark}>?</Text>
                    </View>
                    <Text style={s.questionText}>{q.message}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Focus points */}
          {focusPoints.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>Focus points · {focusPoints.length} active</Text>
              {focusPoints.map((fp, i) => (
                <View key={fp.id || i} style={s.fpCard}>
                  <View style={[s.fpDot, { backgroundColor: fp.weekCount === 0 ? C.red : C.green }]} />
                  <Text style={s.fpName} numberOfLines={1}>{fp.name}</Text>
                  <View style={[s.fpBadge, { backgroundColor: fp.weekCount === 0 ? 'rgba(212,69,69,0.08)' : 'rgba(74,175,82,0.08)' }]}>
                    <Text style={[s.fpBadgeText, { color: fp.weekCount === 0 ? C.red : C.green }]}>{fp.weekCount}x</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* AI Recommendation */}
          {stuckPoints.length > 0 && (
            <View style={s.section}>
              <View style={s.aiCard}>
                <View style={s.aiHeader}>
                  <Ionicons name="flash" size={14} color={C.orange} />
                  <Text style={s.aiHeaderText}>AI RECOMMENDATION</Text>
                </View>
                <Text style={s.aiBody}>
                  Focus on <Text style={{ fontFamily: Fonts.jakartaExtraBold, color: C.red }}>"{stuckPoints[0].name}"</Text> — it hasn't been practiced this week. Try a completely different angle or drill to break the pattern.
                </Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Bottom CTA */}
        <View style={s.bottomBar}>
          <TouchableOpacity
            style={s.startBtn}
            activeOpacity={0.88}
            onPress={() => navigation.replace('FocusValidation', { studentId: st.id, fromStartClass: true })}
          >
            <Text style={s.startBtnText}>START SESSION</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── VIEW 4: Group briefing ─────────────────────────────────────────────
  if (view === 'group-briefing') {
    const topFocus = groupFPs[0] || { name: '—', students: 0, stuck: 0 };
    const totalStuck = groupFPs.reduce((a, f) => a + f.stuck, 0);

    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => setView('select')} style={s.backBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={22} color={C.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerLabel}>GROUP CLASS</Text>
          </View>
          <Text style={[s.headerLabel, { color: C.gray }]}>BRIEFING</Text>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 120 }}>
          {/* Hero */}
          <View style={s.heroCard}>
            <Text style={s.groupHeroLabel}>MAIN FOCUS TODAY</Text>
            <Text style={s.groupHeroTitle}>{topFocus.name}</Text>
            <Text style={s.groupHeroSub}>
              Affects {topFocus.students} students · {topFocus.stuck} stuck
            </Text>

            <View style={s.groupStatsRow}>
              <View style={[s.groupStatBox, { backgroundColor: 'rgba(212,69,69,0.15)' }]}>
                <Text style={[s.groupStatNum, { color: C.red }]}>{totalStuck}</Text>
                <Text style={s.groupStatLabel}>STUCK</Text>
              </View>
              <View style={[s.groupStatBox, { backgroundColor: 'rgba(255,255,255,0.06)' }]}>
                <Text style={[s.groupStatNum, { color: '#fff' }]}>{students.length}</Text>
                <Text style={s.groupStatLabel}>STUDENTS</Text>
              </View>
              <View style={[s.groupStatBox, { backgroundColor: 'rgba(74,175,82,0.12)' }]}>
                <Text style={[s.groupStatNum, { color: C.green }]}>{groupFPs.length}</Text>
                <Text style={s.groupStatLabel}>FOCUS PTS</Text>
              </View>
            </View>
          </View>

          {/* Ranked focus points */}
          {groupFPs.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>Squad focus points · Ranked by impact</Text>
              {groupFPs.map((fp, i) => (
                <View key={fp.name} style={[s.fpCard, i === 0 && { borderWidth: 1, borderColor: 'rgba(232,168,56,0.25)' }]}>
                  <View style={[s.rankBadge, { backgroundColor: i === 0 ? C.orange : C.surface }]}>
                    <Text style={[s.rankNum, { color: i === 0 ? '#fff' : C.text }]}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.fpName}>{fp.name}</Text>
                    <Text style={s.fpMeta}>{fp.students} students · {fp.stuck} stuck</Text>
                  </View>
                  <View style={[s.fpBadge, { backgroundColor: fp.stuck > 1 ? 'rgba(212,69,69,0.08)' : 'rgba(232,168,56,0.08)' }]}>
                    <Text style={[s.fpBadgeText, { color: fp.stuck > 1 ? C.red : C.orange }]}>
                      {fp.stuck > 0 ? `${fp.stuck} stuck` : 'on track'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* AI Recommendation */}
          {groupFPs.length > 0 && topFocus.stuck > 0 && (
            <View style={s.section}>
              <View style={s.aiCard}>
                <View style={s.aiHeader}>
                  <Ionicons name="flash" size={14} color={C.orange} />
                  <Text style={s.aiHeaderText}>AI RECOMMENDATION</Text>
                </View>
                <Text style={s.aiBody}>
                  Start the class with a group drill on <Text style={{ fontFamily: Fonts.jakartaExtraBold, color: C.red }}>"{topFocus.name}"</Text>. {topFocus.stuck} out of {topFocus.students} students are stuck — try a partner rotation exercise so they can learn from each other.
                </Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Bottom CTA */}
        <View style={s.bottomBar}>
          <TouchableOpacity
            style={s.startBtn}
            activeOpacity={0.88}
            onPress={() => navigation.replace('FocusValidation', { fromStartClass: true })}
          >
            <Text style={s.startBtnText}>START SESSION</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return null;
}

// ── Gauge styles ───────────────────────────────────────────────────────────
const g = StyleSheet.create({
  gaugeVal: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#fff',
  },
  gaugeLabel: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 9,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 4,
  },
});

// ── Main styles ────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: Spacing.side,
    paddingTop: 12,
    paddingBottom: 16,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: C.orange,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: C.text,
    letterSpacing: -0.3,
  },

  // Content
  content: { paddingHorizontal: Spacing.side },
  pageTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 28,
    color: C.text,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  pageSub: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: C.gray,
    marginBottom: 32,
  },

  // Type cards
  typeCardDark: {
    backgroundColor: C.dark,
    borderRadius: 22,
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    marginBottom: 14,
  },
  typeIconDark: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeCardDarkTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: '#fff',
    letterSpacing: -0.3,
  },
  typeCardDarkSub: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 3,
    lineHeight: 18,
  },
  typeCardLight: {
    backgroundColor: C.card,
    borderRadius: 22,
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    borderWidth: 1,
    borderColor: C.lightGray,
  },
  typeIconLight: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeCardLightTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: C.text,
    letterSpacing: -0.3,
  },
  typeCardLightSub: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: C.gray,
    marginTop: 3,
    lineHeight: 18,
  },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: Spacing.side,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: C.text,
    padding: 0,
  },

  // Student list
  studentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.lightGray,
  },
  studentAvatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  studentAvatarText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: C.text,
  },
  studentName: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: C.text,
  },
  studentMeta: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: C.gray,
    marginTop: 2,
  },
  stuckBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(212,69,69,0.08)',
  },
  stuckBadgeText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: C.red,
  },

  // Hero card (dark)
  heroCard: {
    backgroundColor: C.dark,
    borderRadius: 22,
    padding: 22,
    marginHorizontal: Spacing.side,
    marginBottom: 20,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 18,
  },
  heroAvatarWrap: {
    width: 52,
    height: 52,
  },
  heroAvatarInner: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: C.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAvatarText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: '#fff',
  },
  heroName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
    color: '#fff',
    letterSpacing: -0.3,
  },
  heroStyle: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
  },
  gaugeRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  activityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 16,
  },
  activityPillText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },

  // Sections
  section: {
    paddingHorizontal: Spacing.side,
    marginBottom: 20,
  },
  sectionLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: C.gray,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },

  // Questions
  questionsCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(232,168,56,0.2)',
  },
  questionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  questionBorder: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.lightGray,
    marginTop: 12,
  },
  questionIcon: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: 'rgba(232,168,56,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  questionMark: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
    color: C.orange,
  },
  questionText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: C.text,
    lineHeight: 19,
    flex: 1,
  },

  // Focus points
  fpCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  fpDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  fpName: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 14,
    color: C.text,
    flex: 1,
  },
  fpMeta: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: C.gray,
    marginTop: 2,
  },
  fpBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
  },
  fpBadgeText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 12,
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankNum: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
  },

  // AI Recommendation
  aiCard: {
    backgroundColor: 'rgba(232,168,56,0.06)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(232,168,56,0.25)',
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  aiHeaderText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: C.orange,
    letterSpacing: 0.5,
  },
  aiBody: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: C.text,
    lineHeight: 20,
  },

  // Group briefing hero
  groupHeroLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  groupHeroTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 26,
    color: '#fff',
    letterSpacing: -0.5,
    lineHeight: 32,
  },
  groupHeroSub: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 8,
  },
  groupStatsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  groupStatBox: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  groupStatNum: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
  },
  groupStatLabel: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: Spacing.side,
    paddingTop: 12,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: C.lightGray,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  startBtn: {
    backgroundColor: C.orange,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  startBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: C.text,
    letterSpacing: 1,
  },
});
