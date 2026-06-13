import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  SectionList,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Dimensions,
  Modal,
  Switch,
} from 'react-native';

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
// Approximate vertical offset of the CLASS page from the screen top —
// status bar (insets.top) + TabHeader (~74) + tabRow (~46). Used to align
// the overlay's internal gradient with the page gradient at the same y.
const OVERLAY_GRADIENT_TOP_OFFSET = 170;
// Page gradient — same as HomeScreen.
const PAGE_GRADIENT_COLORS = ['#F2F2EF', '#F8F2E2', '#F4EAD0', '#FFFFFF', '#FFFFFF'];
const PAGE_GRADIENT_LOCATIONS = [0, 0.4, 0.7, 0.85, 1];
const LOG_CACHE_KEY = '@cache_log';
const SKIP_ADD_REMINDER_KEY = '@skip_add_class_reminder';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../theme';
import { getClassInputs, getNotes, getTrainingSessionsThisMonth } from '../storage/storage';
import {
  getPendingClasses,
  addPendingClass,
  updatePendingClass,
  removePendingClass,
} from '../storage/pendingClasses';
import { processClassDraft } from '../services/classSubmission';
import LogModal from '../components/LogModal';
import Ionicons from '@expo/vector-icons/Ionicons';
import TabHeader from '../components/TabHeader';
import LogSkeleton from '../components/LogSkeleton';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ── Color constants for the editorial design ───────────────────────────
// "Class" accent (group classes + ADD button + section eyebrow) is green.
// "Training" accent (training-only days) reuses the warm yellow of the
// HomeScreen "Start Now" button (Colors.orange = #F2B940) so the two pages
// share a visual cue. Private classes stay deep blue.
const GREEN_500 = '#34D058';
const GREEN_L1  = 'rgba(52,208,88,0.30)';
const GREEN_L2  = 'rgba(52,208,88,0.55)';
const YELLOW_500 = '#F2B940';
const YELLOW_L1  = 'rgba(242,185,64,0.30)';
const YELLOW_L2  = 'rgba(242,185,64,0.55)';
const PRIVATE_BLUE = '#2E4670';
// Notes tab accent — used for the "ADD" button and the section eyebrow
// when the NOTES tab is active.
const NOTES_BLUE = '#5788E6';
const INK_950 = '#0A0A0A';
const FG_2 = 'rgba(10,10,10,0.72)';
const FG_3 = 'rgba(10,10,10,0.45)';
const LINE = 'rgba(10,10,10,0.09)';
const LINE_2 = 'rgba(10,10,10,0.05)';
const TILE_BG = 'rgba(255,255,255,0.65)';
const SOFT_INK_BG = 'rgba(10,10,10,0.05)';
const SOFT_INK_BG_2 = 'rgba(10,10,10,0.025)';

// ── Date helpers ──────────────────────────────────────────────────────

function getDateGroup(isoDate) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(isoDate);
  const itemDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today - itemDay) / 86400000);
  // Build week range Mon-Sun ending today
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  if (itemDay >= weekStart && itemDay <= today) return 'This week';
  if (diffDays < 30) return 'Last 30 days';
  if (d.getFullYear() === now.getFullYear()) return MONTH_FULL[d.getMonth()];
  return String(d.getFullYear());
}

function groupByDate(items, dateField = 'created_at') {
  const map = new Map();
  for (const item of items) {
    const key = getDateGroup(item[dateField] || item.created_at);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
}

function relativeDate(isoOrTs) {
  const ts = typeof isoOrTs === 'string' ? new Date(isoOrTs).getTime() : isoOrTs;
  const now = Date.now();
  const diff = now - ts;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) {
    const d = new Date(ts);
    return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  }
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function formatCountdown(isoDeadline) {
  const ms = new Date(isoDeadline) - Date.now();
  if (ms <= 0) return null;
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
}

function isPrivateLesson(lessonType) {
  // 'group' or 'public' = group; everything else (private or null/legacy) = private
  return lessonType !== 'group' && lessonType !== 'public';
}

// ── Monthly calendar helpers ──────────────────────────────────────────

// 14 columns (2 weeks per row). The grid lays out the days of the current
// month sequentially (1..N) — week-of-day alignment is dropped in favor of
// a much more compact heat-map.
const GRID_COLS = 14;
const GRID_GAP = 3;

function getMonthSequentialDays(year, month) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(new Date(year, month, d));
  }
  return dates;
}

function classesByDay(classes) {
  // Map keyed by YYYY-MM-DD → array of class items
  const map = new Map();
  for (const c of classes) {
    const d = new Date(c.created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(c);
  }
  return map;
}

function trainingsByDay(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const d = new Date(s.started_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  return map;
}

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayCellInfo(classItems, trainingItems) {
  const classCount = classItems?.length || 0;
  const trainingCount = trainingItems?.length || 0;
  if (classCount === 0 && trainingCount === 0) {
    return { level: null, classCount: 0, trainingCount: 0, hasPrivate: false };
  }
  // Class hierarchy wins for color: a private class blues the cell, a group
  // class golds it. Training-only days are orange.
  if (classCount > 0) {
    const hasPrivate = classItems.some((it) => isPrivateLesson(it.lesson_type));
    if (hasPrivate) return { level: 'private', classCount, trainingCount, hasPrivate: true };
    if (classCount >= 3) return { level: 'l3', classCount, trainingCount, hasPrivate: false };
    if (classCount === 2) return { level: 'l2', classCount, trainingCount, hasPrivate: false };
    return { level: 'l1', classCount, trainingCount, hasPrivate: false };
  }
  // training-only
  if (trainingCount >= 3) return { level: 't3', classCount: 0, trainingCount, hasPrivate: false };
  if (trainingCount === 2) return { level: 't2', classCount: 0, trainingCount, hasPrivate: false };
  return { level: 't1', classCount: 0, trainingCount, hasPrivate: false };
}

// ── Monthly Overview component ────────────────────────────────────────
// Snap-collapse animation mirrors the coach StudentDetailScreen pattern
// (absolute overlay + spacer + paddingTop). Inner expandable block (head +
// calendar + legend) animates height/opacity; stats stay always visible.

// Scroll threshold to trigger snap-close (matches coach screen).
const COLLAPSE_THRESHOLD = 24;

// Compute the natural inner height (head + grid + legend) for the *current*
// month, based on how many rows fit in the 14-column grid.
function computeInnerExpandedHeight(rowCount) {
  // Card content width = SCREEN_W - listPadding(18*2) - cardPadding(4*2) - (GRID_COLS-1) gaps
  const cellSize = (SCREEN_W - 18 * 2 - 4 * 2 - (GRID_COLS - 1) * GRID_GAP) / GRID_COLS;
  const gridHeight = rowCount * cellSize + Math.max(0, rowCount - 1) * GRID_GAP;
  // Constant deltas: head block (28) + legend block (38). No week-day header.
  return 28 + gridHeight + 38;
}

// Animated stats top spacing (margin + padding + border) — collapses to 0
// with the calendar so the stats card stays tight when closed.
const STATS_TOP_SPACE = 14 + 12 + 1; // = 27

// Card height when collapsed (stats only, no calendar / no top spacing on
// stats). 16 (cardPaddingTop) + ~33 (stats content) + 14 (cardPaddingBottom)
// = 63. Overlay paddings (top + bottom = 8) bring the total to ~71.
const CARD_COLLAPSED_HEIGHT = 63;
const OVERLAY_COLLAPSED_HEIGHT = CARD_COLLAPSED_HEIGHT + 8;

function MonthlyOverview({ classes, trainings = [], onDayPress, collapsedAnim }) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const todayKey = dayKey(now);

  const grid = useMemo(() => getMonthSequentialDays(year, month), [year, month]);
  const rowCount = Math.ceil(grid.length / GRID_COLS);
  const innerExpandedH = useMemo(() => computeInnerExpandedHeight(rowCount), [rowCount]);

  const dayMap = useMemo(() => classesByDay(classes), [classes]);
  const trainingMap = useMemo(() => trainingsByDay(trainings), [trainings]);

  const monthItems = useMemo(
    () => classes.filter((c) => {
      const d = new Date(c.created_at);
      return d.getFullYear() === year && d.getMonth() === month;
    }),
    [classes, year, month]
  );

  const groupCount = monthItems.filter((c) => !isPrivateLesson(c.lesson_type)).length;
  const privateCount = monthItems.filter((c) => isPrivateLesson(c.lesson_type)).length;
  const activeDays = new Set([
    ...monthItems.map((c) => dayKey(new Date(c.created_at))),
    ...trainings.map((t) => dayKey(new Date(t.started_at))),
  ]).size;

  const expandableOpacity = collapsedAnim
    ? collapsedAnim.interpolate({
        inputRange: [0, 0.6],
        outputRange: [1, 0],
        extrapolate: 'clamp',
      })
    : 1;
  const expandableHeight = collapsedAnim
    ? collapsedAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [innerExpandedH, 0],
      })
    : innerExpandedH;

  // Stats row: when collapsed, drop the divider line + reduce the
  // top margin/padding so the stats sit cleanly on a tight card.
  const statsMarginTop = collapsedAnim
    ? collapsedAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] })
    : 14;
  const statsPaddingTop = collapsedAnim
    ? collapsedAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] })
    : 12;
  const statsBorderTopWidth = collapsedAnim
    ? collapsedAnim.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [1, 0, 0],
        extrapolate: 'clamp',
      })
    : 1;

  return (
    <View style={ov.card}>
      <Animated.View
        style={{
          height: expandableHeight,
          opacity: expandableOpacity,
          overflow: 'hidden',
        }}
      >
        <View style={ov.head}>
          <Text style={ov.lbl}>This month</Text>
          <Text style={ov.month}>{MONTH_FULL[month]} {year}</Text>
        </View>

        <View style={ov.grid}>
          {Array.from({ length: rowCount }).map((_, rowIdx) => {
            const rowCells = grid.slice(rowIdx * GRID_COLS, rowIdx * GRID_COLS + GRID_COLS);
            // Pad the last row with placeholder cells so all rows are the
            // same length and individual cells stay the same size.
            const placeholders = GRID_COLS - rowCells.length;
            return (
              <View key={rowIdx} style={ov.gridRow}>
                {rowCells.map((date) => {
                  const dKey = dayKey(date);
                  const classItems = dayMap.get(dKey) || [];
                  const trainingItems = trainingMap.get(dKey) || [];
                  const info = dayCellInfo(classItems, trainingItems);
                  const isToday = dKey === todayKey;

                  let cellBg = SOFT_INK_BG;
                  let textColor = 'rgba(10,10,10,0.32)';
                  let fontWeight = '500';

                  if (info.level === 'l1') {
                    cellBg = GREEN_L1; textColor = 'rgba(10,10,10,0.55)';
                  } else if (info.level === 'l2') {
                    cellBg = GREEN_L2; textColor = 'rgba(10,10,10,0.65)';
                  } else if (info.level === 'l3') {
                    cellBg = GREEN_500; textColor = INK_950; fontWeight = '700';
                  } else if (info.level === 'private') {
                    cellBg = PRIVATE_BLUE; textColor = '#fff'; fontWeight = '700';
                  } else if (info.level === 't1') {
                    cellBg = YELLOW_L1; textColor = 'rgba(10,10,10,0.55)';
                  } else if (info.level === 't2') {
                    cellBg = YELLOW_L2; textColor = 'rgba(10,10,10,0.65)';
                  } else if (info.level === 't3') {
                    cellBg = YELLOW_500; textColor = INK_950; fontWeight = '700';
                  }

                  const tappable = classItems.length > 0 || trainingItems.length > 0;
                  const Wrap = tappable ? TouchableOpacity : View;
                  return (
                    <Wrap
                      key={dKey}
                      style={[
                        ov.cell,
                        { backgroundColor: cellBg },
                        isToday && ov.cellToday,
                      ]}
                      {...(tappable
                        ? {
                            onPress: () => onDayPress?.({ classes: classItems, trainings: trainingItems }, date),
                            activeOpacity: 0.75,
                          }
                        : {})}
                    >
                      <Text style={[ov.cellText, { color: textColor, fontWeight }]}>
                        {date.getDate()}
                      </Text>
                    </Wrap>
                  );
                })}
                {Array.from({ length: placeholders }).map((_, i) => (
                  <View
                    key={`ph-${rowIdx}-${i}`}
                    style={[ov.cell, { backgroundColor: SOFT_INK_BG_2 }]}
                  />
                ))}
              </View>
            );
          })}
        </View>

        <View style={ov.legend}>
          <View style={ov.scaleRow}>
            <View style={[ov.scaleSquare, { backgroundColor: GREEN_500 }]} />
            <Text style={ov.scaleLbl}>Class</Text>
          </View>
          <View style={ov.scaleRow}>
            <View style={[ov.scaleSquare, { backgroundColor: YELLOW_500 }]} />
            <Text style={ov.scaleLbl}>Training</Text>
          </View>
          <View style={ov.scaleRow}>
            <View style={[ov.scaleSquare, { backgroundColor: PRIVATE_BLUE }]} />
            <Text style={ov.scaleLbl}>Private</Text>
          </View>
        </View>
      </Animated.View>

      <Animated.View
        style={[
          ov.stats,
          {
            marginTop: statsMarginTop,
            paddingTop: statsPaddingTop,
            borderTopWidth: statsBorderTopWidth,
          },
        ]}
      >
        <View style={[ov.statCell, ov.statCellBorder]}>
          <Text style={ov.statN}>{groupCount}</Text>
          <Text style={ov.statL}>Group</Text>
        </View>
        <View style={[ov.statCell, ov.statCellBorder]}>
          <Text style={ov.statN}>{privateCount}</Text>
          <Text style={ov.statL}>Private</Text>
        </View>
        <View style={ov.statCell}>
          <Text style={ov.statN}>{activeDays}</Text>
          <Text style={ov.statL}>Days</Text>
        </View>
      </Animated.View>
    </View>
  );
}

// ── Editorial card components ──────────────────────────────────────────

function ClassItem({ item, onPress, onRetry }) {
  const teacherName = item.teacher_name || item._teacher_fallback || null;
  const lessonType = item.lesson_type || null;
  const isGroup = lessonType === 'group' || lessonType === 'public';
  const countdown = item._pendingDeadline ? formatCountdown(item._pendingDeadline) : null;
  const isAnalysing = !item._pendingDeadline && (item.status === 'processing' || item.status === 'extracted' || item.status === 'pending');
  const isLocalPending = !!item._localPending && !item._failed;
  const isLocalFailed = !!item._failed;
  const showPendingBadge = !!countdown || isAnalysing || !!item._hasPendingFPs || isLocalPending || isLocalFailed;

  function handlePress() {
    if (isLocalFailed) {
      onRetry?.(item._draft);
      return;
    }
    if (isLocalPending) {
      Alert.alert('Saving class', 'Your class is being processed. It will appear fully in a moment.', [{ text: 'OK' }]);
      return;
    }
    if (isAnalysing) {
      Alert.alert('Being analysed', "Your coach's notes are being processed. Focus points will appear shortly.", [{ text: 'OK' }]);
      return;
    }
    if (item._hasPendingFPs) {
      Alert.alert('Coach review in progress', 'Your coach is reviewing the focus points from this class before they\'re shared with you.', [{ text: 'OK' }]);
      return;
    }
    onPress();
  }

  const title = item.title || item.ai_primary_focus || (item.practice_point_1 || '').split(' ').slice(0, 6).join(' ') || 'Untitled';
  const bodyParts = [item.practice_point_1, item.practice_point_2 || item.ai_secondary_focus]
    .filter(Boolean);

  return (
    <TouchableOpacity
      style={[
        ed.card,
        isLocalPending && ed.cardDisabled,
        isLocalFailed && ed.cardFailed,
      ]}
      onPress={handlePress}
      activeOpacity={0.78}
    >
      <View style={ed.head}>
        <Text style={ed.meta} numberOfLines={1}>
          {relativeDate(item.created_at)}
          {teacherName ? <Text style={ed.metaDim}> · </Text> : null}
          {teacherName ? <Text style={ed.metaB}>{teacherName}</Text> : null}
        </Text>
        {!!lessonType && (
          <View style={[ed.badge, isGroup ? ed.badgeGroup : ed.badgePrivate]}>
            <Text style={[ed.badgeText, isGroup ? ed.badgeTextGroup : ed.badgeTextPrivate]}>
              {isGroup ? 'Group' : 'Private'}
            </Text>
          </View>
        )}
      </View>

      <Text style={ed.title} numberOfLines={2}>{title}</Text>

      {!showPendingBadge && bodyParts.length > 0 && (
        <Text style={ed.body} numberOfLines={2}>
          {bodyParts.join('  ·  ')}
        </Text>
      )}

      {showPendingBadge && (
        <View style={[ed.pendingBadge, isLocalFailed && ed.pendingBadgeFailed]}>
          <Text style={[ed.pendingBadgeText, isLocalFailed && ed.pendingBadgeTextFailed]}>
            {isLocalFailed
              ? 'Failed — tap to try again'
              : isLocalPending
                ? 'Saving…'
                : isAnalysing
                  ? 'Analysing class…'
                  : countdown
                    ? `Focus creation in progress · ready in ${countdown}`
                    : 'Pending coach approval'}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function NoteItem({ item, onPress }) {
  const hasVideo = item.video_clips?.length > 0;
  const isLinked = !!item.linked_class_input_id;

  return (
    <TouchableOpacity style={ed.card} onPress={onPress} activeOpacity={0.78}>
      <View style={ed.head}>
        <Text style={ed.meta} numberOfLines={1}>
          {relativeDate(item.updated_at || item.created_at)}
        </Text>
        <View style={ed.noteBadgeRow}>
          {hasVideo && (
            <View style={[ed.badge, ed.badgeNote]}>
              <Text style={[ed.badgeText, ed.badgeTextNote]}>
                {item.video_clips.length} clip{item.video_clips.length > 1 ? 's' : ''}
              </Text>
            </View>
          )}
          {isLinked && (
            <View style={[ed.badge, ed.badgeLinked]}>
              <Text style={[ed.badgeText, ed.badgeTextLinked]}>Linked</Text>
            </View>
          )}
        </View>
      </View>

      <Text style={ed.title} numberOfLines={2}>
        {item.title || 'Untitled'}
      </Text>

      {item.content ? (
        <Text style={ed.body} numberOfLines={2}>{item.content}</Text>
      ) : null}
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────

export default function LogScreen({ navigation }) {
  const [activeTab, setActiveTab] = useState('CLASS');
  const [inputs, setInputs] = useState([]);
  const [trainings, setTrainings] = useState([]);
  const [notes, setNotes] = useState([]);
  const [search, setSearch] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [reminderVisible, setReminderVisible] = useState(false);
  const [dontRemind, setDontRemind] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [pending, setPending] = useState([]);
  const [retryDraft, setRetryDraft] = useState(null);
  // Day-picker modal: open when the user taps a calendar cell that has more
  // than one class on it (single-class days navigate directly).
  const [dayPickerItems, setDayPickerItems] = useState(null);
  const [dayPickerDate, setDayPickerDate] = useState(null);
  const hasLoadedRef = useRef(false);
  const processingIdsRef = useRef(new Set());
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef(null);

  // ── Snap-collapse animation for the MonthlyOverview ────────────────
  // Mirrors the pattern in src/screens/coach/StudentDetailScreen.js:
  // 0 = open, 1 = closed. Crossing scrollY > THRESHOLD downward snaps
  // closed; returning to top + new down-gesture re-opens.
  const collapsedAnim = useRef(new Animated.Value(0)).current;
  const collapsedState = useRef(false);
  const armedToReopen = useRef(false);
  const pendingReopenCheck = useRef(false);

  function animateCollapseTo(openClosed) {
    Animated.timing(collapsedAnim, {
      toValue: openClosed,
      duration: 260,
      useNativeDriver: false,
    }).start();
  }

  function handleListScroll(e) {
    const y = e.nativeEvent.contentOffset.y;

    if (pendingReopenCheck.current) {
      if (y > 0) {
        pendingReopenCheck.current = false;
      } else if (y < 0) {
        pendingReopenCheck.current = false;
        collapsedState.current = false;
        armedToReopen.current = false;
        animateCollapseTo(0);
      }
    }

    if (!collapsedState.current && y > COLLAPSE_THRESHOLD) {
      collapsedState.current = true;
      armedToReopen.current = false;
      pendingReopenCheck.current = false;
      animateCollapseTo(1);
    } else if (collapsedState.current && y <= 0) {
      armedToReopen.current = true;
    }
  }

  function handleListScrollBeginDrag(e) {
    const y = e.nativeEvent.contentOffset.y;
    if (collapsedState.current && armedToReopen.current && y <= 0) {
      pendingReopenCheck.current = true;
    }
  }

  function handleListScrollEndDrag(e) {
    if (pendingReopenCheck.current) {
      pendingReopenCheck.current = false;
      const y = e.nativeEvent.contentOffset.y;
      if (collapsedState.current && armedToReopen.current && y <= 0) {
        collapsedState.current = false;
        armedToReopen.current = false;
        animateCollapseTo(0);
      }
    }
  }

  async function load() {
    const [allInputs, allNotes, pendingList, monthTrainings] = await Promise.all([
      getClassInputs(),
      getNotes(),
      getPendingClasses(),
      getTrainingSessionsThisMonth(),
    ]);
    setInputs(allInputs);
    setNotes(allNotes);
    setPending(pendingList);
    setTrainings(monthTrainings);
    AsyncStorage.setItem(LOG_CACHE_KEY, JSON.stringify({ inputs: allInputs, notes: allNotes })).catch(() => {});
  }

  function draftToDisplayItem(draft) {
    return {
      id: draft._pendingId,
      created_at: draft.createdAt,
      practice_point_1: draft.practicePoint1,
      practice_point_2: draft.showSecond ? draft.practicePoint2 : null,
      teacher_name: draft.teacherName || null,
      lesson_type: draft.lessonType || null,
      dance: draft.selectedDances?.length ? draft.selectedDances.join(', ') : null,
      title: (draft.practicePoint1 || '').split(' ').slice(0, 6).join(' '),
      _localPending: true,
      _failed: !!draft._failed,
      _draft: draft,
    };
  }

  function startProcessing(draft) {
    processClassDraft(draft)
      .then(async () => {
        await removePendingClass(draft._pendingId);
        await load();
      })
      .catch(async (err) => {
        console.warn('[LogScreen] class submit failed:', err);
        await updatePendingClass(draft._pendingId, { _failed: true });
        const list = await getPendingClasses();
        setPending(list);
      });
  }

  async function handleModalSubmit(draft) {
    if (retryDraft) {
      await removePendingClass(retryDraft._pendingId);
    }
    const clean = { ...draft, _failed: false };
    await addPendingClass(clean);
    const list = await getPendingClasses();
    setPending(list);
    setModalVisible(false);
    setRetryDraft(null);
    startProcessing(clean);
  }

  function handleRetry(draft) {
    setRetryDraft(draft);
    setModalVisible(true);
  }

  function handleModalClose() {
    setModalVisible(false);
    setRetryDraft(null);
  }

  function switchTab(tab) {
    setActiveTab(tab);
    scrollRef.current?.scrollTo({ x: tab === 'NOTES' ? SCREEN_W : 0, animated: true });
  }

  async function handleRefresh() {
    setRefreshing(true);
    try { await load(); } catch {}
    setRefreshing(false);
  }

  useFocusEffect(useCallback(() => {
    const isFirst = !hasLoadedRef.current;
    if (isFirst) setIsLoading(true);
    const reveal = () => {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    };
    async function init() {
      let revealed = false;
      if (isFirst) {
        try {
          const raw = await AsyncStorage.getItem(LOG_CACHE_KEY);
          if (raw) {
            const { inputs: ci, notes: cn } = JSON.parse(raw);
            setInputs(ci || []);
            setNotes(cn || []);
            setIsLoading(false);
            reveal(); // fade cached content in NOW — don't wait on the network
            revealed = true;
          }
        } catch {}
      }
      try { await load(); } catch {}
      hasLoadedRef.current = true;
      setIsLoading(false);
      if (isFirst) {
        if (!revealed) reveal(); // no cache: skeleton was showing, fade in after load
        try {
          const orphans = await getPendingClasses();
          orphans.filter((d) => !d._failed && !processingIdsRef.current.has(d._pendingId))
            .forEach((d) => {
              processingIdsRef.current.add(d._pendingId);
              startProcessing(d);
            });
        } catch {}
      }
    }
    init();
  }, []));

  async function handleAdd() {
    if (activeTab === 'NOTES') {
      navigation.navigate('NoteDetail', {});
      return;
    }
    const skip = await AsyncStorage.getItem(SKIP_ADD_REMINDER_KEY);
    if (skip === 'true') {
      setModalVisible(true);
    } else {
      setDontRemind(false);
      setReminderVisible(true);
    }
  }

  async function handleReminderContinue() {
    if (dontRemind) {
      await AsyncStorage.setItem(SKIP_ADD_REMINDER_KEY, 'true');
    }
    setReminderVisible(false);
    setModalVisible(true);
  }

  const pendingDisplay = pending.map(draftToDisplayItem);
  const mergedInputs = [...pendingDisplay, ...inputs].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );

  const filteredInputs = search.trim()
    ? mergedInputs.filter((i) => {
        const q = search.toLowerCase();
        return i.practice_point_1?.toLowerCase().includes(q)
          || i.practice_point_2?.toLowerCase().includes(q)
          || i.ai_primary_focus?.toLowerCase().includes(q)
          || i.title?.toLowerCase().includes(q);
      })
    : mergedInputs;

  const filteredNotes = search.trim()
    ? notes.filter((n) => {
        const q = search.toLowerCase();
        return n.title?.toLowerCase().includes(q) || n.content?.toLowerCase().includes(q);
      })
    : notes;

  const groupedInputs = groupByDate(filteredInputs, 'created_at');
  const groupedNotes = groupByDate(filteredNotes, 'updated_at');

  // Animated spacer for the SectionList header — shrinks the same amount the
  // MonthlyOverview's calendar collapses, so the rest of the content keeps
  // its visual position rather than jumping.
  const today = new Date();
  const monthGrid = getMonthSequentialDays(today.getFullYear(), today.getMonth());
  const monthRowCount = Math.ceil(monthGrid.length / GRID_COLS);
  const innerExpandedH = computeInnerExpandedHeight(monthRowCount);
  // The card actually shrinks by (innerExpandedH + STATS_TOP_SPACE) — the
  // calendar block plus the animated margin/padding/border above the stats.
  const spacerHeight = collapsedAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [innerExpandedH + STATS_TOP_SPACE, 0],
  });

  if (isLoading) {
    return <LogSkeleton />;
  }

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={PAGE_GRADIENT_COLORS}
        locations={PAGE_GRADIENT_LOCATIONS}
        style={StyleSheet.absoluteFillObject}
      />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          <TabHeader navigation={navigation} />

          {/* Class / Notes toggle (translucent pill style) */}
          <View style={styles.tabRow}>
            {['CLASS', 'NOTES'].map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[styles.tabPill, activeTab === tab && styles.tabPillActive]}
                onPress={() => switchTab(tab)}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabPillText, activeTab === tab && styles.tabPillTextActive]}>
                  {tab}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Horizontal swipe between Class and Notes */}
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onMomentumScrollEnd={(e) => {
              const page = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
              setActiveTab(page === 0 ? 'CLASS' : 'NOTES');
            }}
            style={{ flex: 1 }}
          >
            {/* CLASS page — absolute MonthlyOverview overlay + spacer */}
            <View style={{ width: SCREEN_W, height: '100%' }}>
              <View
                style={styles.overviewOverlay}
                pointerEvents="box-none"
              >
                {/* Render the same page gradient INSIDE the overlay, offset
                    so the overlay's y=0 aligns with the page gradient's y at
                    the overlay position. The overlay then visually matches
                    the page background while being fully opaque, so cards
                    scrolling underneath are no longer visible. */}
                <LinearGradient
                  colors={PAGE_GRADIENT_COLORS}
                  locations={PAGE_GRADIENT_LOCATIONS}
                  style={{
                    position: 'absolute',
                    top: -OVERLAY_GRADIENT_TOP_OFFSET,
                    left: 0,
                    right: 0,
                    height: SCREEN_H,
                  }}
                />
                <MonthlyOverview
                  classes={inputs}
                  trainings={trainings}
                  collapsedAnim={collapsedAnim}
                  onDayPress={(payload, date) => {
                    const { classes: cs, trainings: ts } = payload;
                    // Single class, no training → navigate directly to class.
                    if (cs.length === 1 && ts.length === 0) {
                      navigation.navigate('ClassDetail', { inputId: cs[0].id });
                      return;
                    }
                    // Anything else (multi-class day, mixed day, training-only
                    // day) → open the picker so the user can see what's there.
                    setDayPickerItems(payload);
                    setDayPickerDate(date);
                  }}
                />
              </View>
              <SectionList
                sections={groupedInputs}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <ClassItem
                    item={item}
                    onPress={() => navigation.navigate('ClassDetail', { inputId: item.id })}
                    onRetry={handleRetry}
                  />
                )}
                renderSectionHeader={({ section: { title } }) => (
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionHeaderText}>{title}</Text>
                    <View style={styles.sectionRule} />
                  </View>
                )}
                ListHeaderComponent={
                  <Animated.View style={{ height: spacerHeight }} pointerEvents="none" />
                }
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                contentContainerStyle={styles.listContentClass}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={search.trim() ? null : <ClassEmptyState />}
                refreshing={refreshing}
                onRefresh={handleRefresh}
                stickySectionHeadersEnabled={false}
                onScroll={handleListScroll}
                onScrollBeginDrag={handleListScrollBeginDrag}
                onScrollEndDrag={handleListScrollEndDrag}
                scrollEventThrottle={16}
              />
            </View>
            <View style={{ width: SCREEN_W, height: '100%' }}>
              <SectionList
                sections={groupedNotes}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <NoteItem item={item} onPress={() => navigation.navigate('NoteDetail', { noteId: item.id })} />
                )}
                renderSectionHeader={({ section: { title } }) => (
                  <View style={styles.sectionHeader}>
                    <Text style={[styles.sectionHeaderText, { color: NOTES_BLUE }]}>
                      {title}
                    </Text>
                    <View style={styles.sectionRule} />
                  </View>
                )}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={<EmptyState text="No notes yet. Tap ADD to create one." />}
                refreshing={refreshing}
                onRefresh={handleRefresh}
                stickySectionHeadersEnabled={false}
              />
            </View>
          </ScrollView>

          {/* Bottom search + Add */}
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
            <View style={styles.bottomBar}>
              <View style={styles.searchWrap}>
                <Ionicons name="search" size={16} color={FG_3} />
                <TextInput
                  style={styles.searchInput}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search…"
                  placeholderTextColor={FG_3}
                  clearButtonMode="while-editing"
                />
              </View>
              <TouchableOpacity
                style={[
                  styles.addBtn,
                  activeTab === 'NOTES' && { backgroundColor: NOTES_BLUE },
                ]}
                onPress={handleAdd}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.addBtnText,
                    activeTab === 'NOTES' && { color: '#FFFFFF' },
                  ]}
                >
                  ADD
                </Text>
                <View style={styles.addBtnCircle}>
                  <Ionicons
                    name="add"
                    size={18}
                    color={activeTab === 'NOTES' ? NOTES_BLUE : GREEN_500}
                  />
                </View>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>

          <LogModal
            visible={modalVisible}
            onClose={handleModalClose}
            onSubmitted={handleModalSubmit}
            initialDraft={retryDraft}
          />

          {/* Day picker — opens when user taps a calendar cell with mixed /
              multiple classes / training sessions. Single-class-no-training
              days navigate directly. */}
          <Modal
            visible={!!dayPickerItems}
            transparent
            animationType="slide"
            onRequestClose={() => setDayPickerItems(null)}
          >
            <TouchableOpacity
              style={styles.dpOverlay}
              activeOpacity={1}
              onPress={() => setDayPickerItems(null)}
            >
              <TouchableOpacity
                style={styles.dpSheet}
                activeOpacity={1}
                onPress={() => {}}
              >
                <View style={styles.dpHandle} />
                <Text style={styles.dpTitle}>
                  {dayPickerDate
                    ? `${MONTH_FULL[dayPickerDate.getMonth()]} ${dayPickerDate.getDate()}`
                    : ''}
                </Text>
                {(() => {
                  const cs = dayPickerItems?.classes || [];
                  const ts = dayPickerItems?.trainings || [];
                  const parts = [];
                  if (cs.length > 0) parts.push(`${cs.length} class${cs.length > 1 ? 'es' : ''}`);
                  if (ts.length > 0) parts.push(`${ts.length} training${ts.length > 1 ? 's' : ''}`);
                  return <Text style={styles.dpSubtitle}>{parts.join(' · ')}</Text>;
                })()}

                {dayPickerItems?.classes?.map((c) => {
                  const teacher = c.teacher_name || c._teacher_fallback || null;
                  const isGroup = c.lesson_type === 'group' || c.lesson_type === 'public';
                  const cTitle = c.title || c.ai_primary_focus
                    || (c.practice_point_1 || '').split(' ').slice(0, 6).join(' ')
                    || 'Untitled';
                  return (
                    <TouchableOpacity
                      key={c.id}
                      style={styles.dpRow}
                      activeOpacity={0.78}
                      onPress={() => {
                        setDayPickerItems(null);
                        navigation.navigate('ClassDetail', { inputId: c.id });
                      }}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.dpRowMeta} numberOfLines={1}>
                          {teacher || (isGroup ? 'Group class' : 'Private lesson')}
                        </Text>
                        <Text style={styles.dpRowTitle} numberOfLines={1}>
                          {cTitle}
                        </Text>
                      </View>
                      <View style={[ed.badge, isGroup ? ed.badgeGroup : ed.badgePrivate]}>
                        <Text style={[ed.badgeText, isGroup ? ed.badgeTextGroup : ed.badgeTextPrivate]}>
                          {isGroup ? 'Group' : 'Private'}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={14} color={FG_3} style={{ marginLeft: 6 }} />
                    </TouchableOpacity>
                  );
                })}

                {dayPickerItems?.trainings?.map((t) => {
                  const startMs = new Date(t.started_at).getTime();
                  const endMs = t.completed_at ? new Date(t.completed_at).getTime() : null;
                  const minutes = endMs ? Math.max(1, Math.round((endMs - startMs) / 60000)) : null;
                  return (
                    <View key={t.id} style={styles.dpRow}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.dpRowMeta} numberOfLines={1}>
                          Training session{minutes ? ` · ${minutes} min` : ''}
                        </Text>
                        <Text style={styles.dpRowTitle} numberOfLines={1}>
                          {t.feeling || 'Completed'}
                        </Text>
                      </View>
                      <View style={[ed.badge, styles.dpTrainingBadge]}>
                        <Text style={[ed.badgeText, styles.dpTrainingBadgeText]}>Training</Text>
                      </View>
                    </View>
                  );
                })}
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>

          <Modal visible={reminderVisible} transparent animationType="fade" onRequestClose={() => setReminderVisible(false)}>
            <TouchableOpacity style={styles.reminderOverlay} activeOpacity={1} onPress={() => setReminderVisible(false)}>
              <TouchableOpacity style={styles.reminderSheet} activeOpacity={1} onPress={() => {}}>
                <View style={styles.reminderIconWrap}>
                  <Ionicons name="information-circle-outline" size={28} color={INK_950} />
                </View>
                <Text style={styles.reminderTitle}>Classes are added automatically</Text>
                <Text style={styles.reminderBody}>
                  Your coach logs classes directly from their sessions. Only add a class manually if your coach is not yet on InBetween.
                </Text>
                <TouchableOpacity
                  style={styles.reminderToggleRow}
                  onPress={() => setDontRemind(v => !v)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.reminderToggleLabel}>Don't remind me again</Text>
                  <Switch
                    value={dontRemind}
                    onValueChange={setDontRemind}
                    trackColor={{ false: '#E0E0E0', true: GREEN_500 }}
                    thumbColor="#fff"
                  />
                </TouchableOpacity>
                <TouchableOpacity style={styles.reminderBtn} onPress={handleReminderContinue} activeOpacity={0.85}>
                  <Text style={styles.reminderBtnText}>Add manually anyway</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setReminderVisible(false)} activeOpacity={0.7} style={{ marginTop: 10 }}>
                  <Text style={styles.reminderCancel}>Cancel</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

function ClassEmptyState() {
  return (
    <View style={styles.emptyCard}>
      <View style={styles.emptyIconWrap}>
        <Ionicons name="journal-outline" size={28} color={FG_3} />
      </View>
      <Text style={styles.emptyTitle}>Your classes will appear here</Text>
      <Text style={styles.emptySubtitle}>Once your coach submits a class, it'll show up here, even while the focus points are still being generated.</Text>
    </View>
  );
}

function EmptyState({ text }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

// ─── Monthly Overview styles ─────────────────────────────────────────
const ov = StyleSheet.create({
  // White-ish card, no visible border (so it reads as a card without the
  // "rectangle outline" feel the user disliked). Slight translucency so
  // it warms a touch with the page gradient without looking transparent.
  card: {
    marginHorizontal: 0,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  lbl: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: GREEN_500,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  month: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 11,
    color: FG_3,
    letterSpacing: 0.4,
  },
  grid: {
    gap: GRID_GAP,
  },
  gridRow: {
    flexDirection: 'row',
    gap: GRID_GAP,
  },
  // 14 cells per row → narrower cells. aspectRatio:1 keeps them square.
  cell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 4,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    padding: 2,
  },
  cellToday: {
    borderWidth: 1,
    borderColor: INK_950,
  },
  cellText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 8,
    lineHeight: 9,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: LINE,
  },
  scaleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  scaleSquare: {
    width: 11,
    height: 11,
    borderRadius: 3,
  },
  scaleLbl: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 9.5,
    color: FG_3,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  stats: {
    flexDirection: 'row',
    // marginTop, paddingTop and borderTopWidth are animated by the parent
    // (collapsedAnim) so they reduce to 0 when the calendar collapses,
    // leaving a clean stats-only card.
    borderTopColor: LINE,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  statCellBorder: {
    borderRightWidth: 1,
    borderRightColor: LINE,
  },
  statN: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: INK_950,
    letterSpacing: -0.5,
    lineHeight: 24,
  },
  statL: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 9,
    color: FG_3,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});

// ─── Editorial card styles ────────────────────────────────────────────
const ed = StyleSheet.create({
  card: {
    backgroundColor: TILE_BG,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  cardDisabled: {
    opacity: 0.5,
  },
  cardFailed: {
    backgroundColor: 'rgba(232,64,64,0.06)',
    borderColor: 'rgba(232,64,64,0.35)',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
  },
  meta: {
    flex: 1,
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11.5,
    color: FG_3,
    letterSpacing: 0.1,
  },
  metaDim: {
    color: FG_3,
  },
  metaB: {
    fontFamily: Fonts.jakartaBold,
    color: FG_2,
  },
  badge: {
    paddingHorizontal: 9,
    paddingVertical: 3.5,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
  },
  badgeGroup: {
    backgroundColor: 'rgba(232,181,48,0.16)',
    borderColor: 'rgba(232,181,48,0.30)',
  },
  badgePrivate: {
    backgroundColor: 'rgba(46,70,112,0.12)',
    borderColor: 'rgba(46,70,112,0.30)',
  },
  badgeNote: {
    backgroundColor: 'rgba(87,136,230,0.12)',
    borderColor: 'rgba(87,136,230,0.30)',
  },
  badgeLinked: {
    backgroundColor: 'rgba(76,175,80,0.12)',
    borderColor: 'rgba(76,175,80,0.30)',
  },
  badgeText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 9.5,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  badgeTextGroup: { color: '#7A5A10' },
  badgeTextPrivate: { color: PRIVATE_BLUE },
  badgeTextNote: { color: '#3F62A8' },
  badgeTextLinked: { color: '#2F6B33' },
  noteBadgeRow: {
    flexDirection: 'row',
    gap: 5,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: INK_950,
    letterSpacing: -0.3,
    lineHeight: 20,
    marginTop: 2,
    marginBottom: 4,
  },
  body: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: FG_3,
    lineHeight: 18,
  },
  pendingBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,157,0,0.10)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 4,
    borderWidth: 0.5,
    borderColor: 'rgba(255,157,0,0.25)',
  },
  pendingBadgeText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: Colors.orange,
  },
  pendingBadgeFailed: {
    backgroundColor: 'rgba(232,64,64,0.12)',
    borderColor: 'rgba(232,64,64,0.35)',
  },
  pendingBadgeTextFailed: {
    color: '#E84040',
  },
});

// ─── Main screen styles ───────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },

  // Toggle (Class / Notes)
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.side,
    paddingBottom: 12,
    gap: 8,
  },
  tabPill: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: LINE,
  },
  tabPillActive: {
    backgroundColor: INK_950,
    borderColor: INK_950,
  },
  tabPillText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    color: FG_2,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  tabPillTextActive: {
    color: '#F7F6F3',
  },

  // SectionList content (NOTES tab — no calendar overlay)
  listContent: {
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 16,
  },

  // SectionList content for the CLASS tab — paddingTop accounts for the
  // collapsed MonthlyOverview overlay; the animated spacer (ListHeader)
  // adds the rest when expanded.
  listContentClass: {
    paddingHorizontal: 18,
    paddingTop: OVERLAY_COLLAPSED_HEIGHT + 4,
    paddingBottom: 16,
  },

  // Absolute overlay holding the MonthlyOverview at the top of the CLASS
  // page. The card itself shrinks via its internal animation; this wrapper
  // just positions and pads. `overflow: hidden` clips the inner gradient
  // and any list cards that scroll behind the overlay area.
  overviewOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 4,
    zIndex: 10,
    overflow: 'hidden',
  },

  // Editorial section eyebrow
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 18,
    paddingBottom: 8,
    paddingHorizontal: 6,
  },
  sectionHeaderText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: GREEN_500,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionRule: {
    flex: 1,
    height: 1,
    backgroundColor: LINE_2,
  },

  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontFamily: Fonts.jakartaRegular, fontSize: 14, color: FG_3, textAlign: 'center', lineHeight: 22 },
  emptyCard: {
    marginTop: 24,
    backgroundColor: TILE_BG,
    borderRadius: 18,
    padding: 28,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: LINE,
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: SOFT_INK_BG,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 17,
    color: INK_950,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  emptySubtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: FG_3,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Bottom search + add bar (sits above CustomTabBar)
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 10,
    backgroundColor: 'transparent',
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    backgroundColor: 'rgba(255,255,255,0.65)',
    borderRadius: 999,
    paddingHorizontal: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: LINE,
  },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: INK_950,
    letterSpacing: -0.2,
    padding: 0,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    paddingLeft: 20,
    paddingRight: 6,
    gap: 10,
    borderRadius: 999,
    backgroundColor: GREEN_500,
  },
  addBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
    color: INK_950,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  addBtnCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: INK_950,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Day picker modal (multi-class cells) ──────────────────
  dpOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  dpSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingBottom: 36,
    paddingTop: 10,
  },
  dpHandle: {
    width: 36,
    height: 4,
    backgroundColor: 'rgba(17,12,17,0.12)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 14,
  },
  dpTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: INK_950,
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  dpSubtitle: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12,
    color: FG_3,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  dpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: LINE_2,
  },
  dpRowMeta: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: FG_3,
    marginBottom: 2,
  },
  dpRowTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 14,
    color: INK_950,
    letterSpacing: -0.2,
  },
  dpTrainingBadge: {
    backgroundColor: 'rgba(240,140,46,0.16)',
    borderColor: 'rgba(240,140,46,0.34)',
  },
  dpTrainingBadgeText: {
    color: '#A5641F',
  },

  // ── Add class reminder modal ──────────────────────────────
  reminderOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  reminderSheet: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 24,
    elevation: 10,
  },
  reminderIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: SOFT_INK_BG,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  reminderTitle: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 17,
    color: INK_950,
    textAlign: 'center',
    marginBottom: 10,
  },
  reminderBody: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: FG_3,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
  },
  reminderToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    backgroundColor: SOFT_INK_BG,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: LINE,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  reminderToggleLabel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: INK_950,
  },
  reminderBtn: {
    width: '100%',
    backgroundColor: INK_950,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  reminderBtnText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 14,
    color: '#fff',
    letterSpacing: 0.4,
  },
  reminderCancel: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: FG_3,
    paddingVertical: 4,
  },
});
