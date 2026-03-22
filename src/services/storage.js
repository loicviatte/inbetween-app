import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MOCK_USER,
  MOCK_FOCUS_POINTS,
  MOCK_CLASS_INPUTS,
  MOCK_FOCUS_PROGRESS,
  MOCK_NOTES,
} from '../data/mockData';

const KEYS = {
  USER: 'inbetween_user',
  CLASS_INPUTS: 'inbetween_class_inputs',
  FOCUS_POINTS: 'inbetween_focus_points',
  FOCUS_PROGRESS: 'inbetween_focus_progress',
  NOTES: 'inbetween_notes',
  SEEDED: 'inbetween_seeded',
};

export async function seedIfNeeded() {
  const seeded = await AsyncStorage.getItem(KEYS.SEEDED);
  if (seeded) return;
  await AsyncStorage.setItem(KEYS.USER, JSON.stringify(MOCK_USER));
  await AsyncStorage.setItem(KEYS.CLASS_INPUTS, JSON.stringify(MOCK_CLASS_INPUTS));
  await AsyncStorage.setItem(KEYS.FOCUS_POINTS, JSON.stringify(MOCK_FOCUS_POINTS));
  await AsyncStorage.setItem(KEYS.FOCUS_PROGRESS, JSON.stringify(MOCK_FOCUS_PROGRESS));
  await AsyncStorage.setItem(KEYS.NOTES, JSON.stringify(MOCK_NOTES));
  await AsyncStorage.setItem(KEYS.SEEDED, 'true');
}

export async function getUser() {
  const raw = await AsyncStorage.getItem(KEYS.USER);
  return raw ? JSON.parse(raw) : MOCK_USER;
}

export async function getClassInputs() {
  const raw = await AsyncStorage.getItem(KEYS.CLASS_INPUTS);
  return raw ? JSON.parse(raw) : [];
}

export async function saveClassInput(input) {
  const inputs = await getClassInputs();
  inputs.push(input);
  await AsyncStorage.setItem(KEYS.CLASS_INPUTS, JSON.stringify(inputs));
}

export async function getFocusPoints() {
  const raw = await AsyncStorage.getItem(KEYS.FOCUS_POINTS);
  return raw ? JSON.parse(raw) : [];
}

export async function saveFocusPoint(fp) {
  const points = await getFocusPoints();
  const idx = points.findIndex((p) => p.id === fp.id);
  if (idx >= 0) {
    points[idx] = fp;
  } else {
    points.push(fp);
  }
  await AsyncStorage.setItem(KEYS.FOCUS_POINTS, JSON.stringify(points));
}

export async function getFocusProgress() {
  const raw = await AsyncStorage.getItem(KEYS.FOCUS_PROGRESS);
  return raw ? JSON.parse(raw) : [];
}

export async function saveFocusProgress(entry) {
  const progress = await getFocusProgress();
  progress.push(entry);
  await AsyncStorage.setItem(KEYS.FOCUS_PROGRESS, JSON.stringify(progress));
}

export async function getTopFocusPoints(n = 2) {
  const points = await getFocusPoints();
  if (!points.length) return [];
  const progress = await getFocusProgress();

  const scores = {};
  for (const p of progress) {
    scores[p.focusPointId] = (scores[p.focusPointId] || 0) + p.priorityScore;
  }

  return [...points].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0)).slice(0, n);
}

export async function getTopFocusPoint() {
  const top = await getTopFocusPoints(1);
  return top[0] || null;
}

export async function saveSessionCompletion(focusPointId) {
  const now = Date.now();
  await saveFocusProgress({
    id: `fpr_session_${now}`,
    userId: 'user_1',
    focusPointId,
    classInputId: null,
    priorityScore: -5,
    completed: true,
    createdAt: now,
  });
}

export async function getRecentClassInputs(limit = 3) {
  const inputs = await getClassInputs();
  return inputs.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

// Returns sessions logged in the last 7 days
export async function getSessionsThisWeek() {
  const inputs = await getClassInputs();
  const weekAgo = Date.now() - 7 * 86400000;
  return inputs.filter((i) => i.createdAt >= weekAgo).length;
}

// Returns count of distinct focus points trained
export async function getFocusTrainedCount() {
  const points = await getFocusPoints();
  return points.length;
}

export async function getNotes() {
  const raw = await AsyncStorage.getItem(KEYS.NOTES);
  return raw ? JSON.parse(raw) : [];
}

export async function getNoteById(id) {
  const notes = await getNotes();
  return notes.find((n) => n.id === id) || null;
}

export async function saveNote(note) {
  const notes = await getNotes();
  const idx = notes.findIndex((n) => n.id === note.id);
  if (idx >= 0) {
    notes[idx] = note;
  } else {
    notes.push(note);
  }
  await AsyncStorage.setItem(KEYS.NOTES, JSON.stringify(notes));
}

export async function deleteNote(id) {
  const notes = await getNotes();
  const filtered = notes.filter((n) => n.id !== id);
  await AsyncStorage.setItem(KEYS.NOTES, JSON.stringify(filtered));
}

export async function getNotesLinkedToClass(classInputId) {
  const notes = await getNotes();
  return notes.filter((n) => n.linkedClassInputId === classInputId);
}
