import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getMyStudents, getCoachActivityFeed, getPendingCoachRequests, getCoachNotes, getPendingFocusPoints } from '../storage/coachStorage';
import { getPendingCoupleFocusPoints } from '../storage/coupleStorage';
import { getUser } from '../storage/storage';
import { getNotifications } from '../storage/notificationsStorage';
import { supabase } from '../services/supabase/client';

const CoachDataContext = createContext(null);

export function CoachDataProvider({ children }) {
  const [students, setStudents] = useState([]);
  const [events, setEvents] = useState([]);
  const [requests, setRequests] = useState([]);
  const [notes, setNotes] = useState([]);
  const [user, setUser] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [actionCounts, setActionCounts] = useState({ focus: 0, merge: 0, name: 0, total: 0 });
  const [studentActionCounts, setStudentActionCounts] = useState({});
  const [initialLoading, setInitialLoading] = useState(true);
  const loaded = useRef(false);

  // Short-lived per-key cache so navigating away and back to a screen
  // (e.g. coach taps a student, scrolls, hits back, taps again) returns
  // instantly instead of re-fetching the same Supabase rows. TTL is short
  // enough that fresh server data still surfaces on the next focus.
  // Keyed by an arbitrary string ("student:<id>:fps", "readiness:<id>", …).
  const cacheRef = useRef(new Map());

  const getOrFetch = useCallback(async (key, fetcher, ttlMs = 60000) => {
    const cached = cacheRef.current.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const data = await fetcher();
    cacheRef.current.set(key, { data, expiresAt: Date.now() + ttlMs });
    return data;
  }, []);

  const invalidateCache = useCallback((prefix) => {
    if (!prefix) {
      cacheRef.current.clear();
      return;
    }
    for (const k of Array.from(cacheRef.current.keys())) {
      if (k.startsWith(prefix)) cacheRef.current.delete(k);
    }
  }, []);

  const computeUnread = useCallback((notifs) => {
    return (notifs || []).filter(
      (n) =>
        !n.read ||
        n.type === 'merge_request_student' ||
        n.type === 'name_match_confirm'
    ).length;
  }, []);

  const loadAll = useCallback(async () => {
    // ─── Critical wave: blocks first render. Just the data the coach
    // home screen NEEDS to render its student list + identity. The rest
    // (feed, notes, action badges) populates in the background.
    try {
      const [s, u] = await Promise.all([
        getMyStudents().catch(() => []),
        getUser().catch(() => null),
      ]);
      setStudents(s || []);
      setUser(u);
    } catch {}
    if (!loaded.current) {
      loaded.current = true;
      setInitialLoading(false);
    }

    // ─── Deferred wave: fires in parallel, doesn't block render.
    // Notes / feed / counts arrive a beat later but the coach can
    // already see + tap their students.
    Promise.all([
      getCoachActivityFeed().catch(() => []),
      getPendingCoachRequests().catch(() => []),
      getCoachNotes().catch(() => []),
      getNotifications().catch(() => []),
      getPendingFocusPoints(null).catch(() => []),
      supabase
        .from('merge_requests')
        .select('id, student_id', { count: 'exact' })
        .eq('status', 'pending_coach')
        .then((res) => res)
        .catch(() => ({ count: 0, data: [] })),
      getPendingCoupleFocusPoints().catch(() => []),
    ]).then(([ev, r, n, notifs, fps, mergesRes, coupleFps]) => {
      setEvents((ev || []).slice(0, 12));
      setRequests(r || []);
      setNotes(n || []);
      setUnreadCount(computeUnread(notifs));

      const focusCount = (fps || []).length + (coupleFps || []).length;
      const mergeCount = mergesRes?.count || 0;
      const nameNotifs = (notifs || []).filter((x) => x.type === 'name_match_confirm');
      const nameCount = nameNotifs.length;
      setActionCounts({
        focus: focusCount,
        merge: mergeCount,
        name: nameCount,
        total: focusCount + mergeCount + nameCount,
      });

      // Per-student action count (focus validation + merge + name match)
      const perStudent = {};
      for (const fp of fps || []) {
        if (fp.user_id) perStudent[fp.user_id] = (perStudent[fp.user_id] || 0) + 1;
      }
      for (const mr of mergesRes?.data || []) {
        if (mr.student_id) perStudent[mr.student_id] = (perStudent[mr.student_id] || 0) + 1;
      }
      for (const notif of nameNotifs) {
        const sid = notif.data?.student_id;
        if (sid) perStudent[sid] = (perStudent[sid] || 0) + 1;
      }
      setStudentActionCounts(perStudent);
    }).catch(() => {});
  }, [computeUnread]);

  // Load once on mount
  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Refresh when the app returns to the foreground — without this the coach
  // can sit on the home screen while a student sends a request and never see
  // the new pending row until they manually re-launch the app. Also clears
  // the per-key cache so any screen-level data the coach was looking at
  // before backgrounding gets pulled fresh on the next mount.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        cacheRef.current.clear();
        loadAll();
      }
    });
    return () => sub.remove();
  }, [loadAll]);

  // The AppState refresh above only fires on background→foreground. When a
  // student sends a coach request (or any push) while the coach is ALREADY
  // foregrounded, pull fresh so the pending row / action badge appears live —
  // so tapping the notification lands on a Students tab that actually shows it.
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      if (notification?.request?.content?.data?.type) {
        cacheRef.current.clear();
        loadAll();
      }
    });
    return () => sub.remove();
  }, [loadAll]);

  // Refresh in background (no loading state) — called on tab focus.
  // Wipes the per-key cache so the next screen visit re-fetches fresh data.
  const refresh = useCallback(async () => {
    cacheRef.current.clear();
    await loadAll();
  }, [loadAll]);

  // Targeted setters for screens that mutate data locally
  const updateStudents = useCallback((fn) => {
    setStudents((prev) => (typeof fn === 'function' ? fn(prev) : fn));
  }, []);
  const updateRequests = useCallback((fn) => {
    setRequests((prev) => (typeof fn === 'function' ? fn(prev) : fn));
  }, []);
  const updateNotes = useCallback((fn) => {
    setNotes((prev) => (typeof fn === 'function' ? fn(prev) : fn));
  }, []);

  return (
    <CoachDataContext.Provider
      value={{
        students,
        events,
        requests,
        notes,
        user,
        unreadCount,
        actionCounts,
        studentActionCounts,
        initialLoading,
        refresh,
        updateStudents,
        updateRequests,
        updateNotes,
        getOrFetch,
        invalidateCache,
      }}
    >
      {children}
    </CoachDataContext.Provider>
  );
}

export function useCoachData() {
  const ctx = useContext(CoachDataContext);
  if (!ctx) throw new Error('useCoachData must be used within CoachDataProvider');
  return ctx;
}
