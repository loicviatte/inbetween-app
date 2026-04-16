import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getMyStudents, getCoachActivityFeed, getPendingCoachRequests, getCoachNotes, getPendingFocusPoints } from '../storage/coachStorage';
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
  const [initialLoading, setInitialLoading] = useState(true);
  const loaded = useRef(false);

  const computeUnread = useCallback((notifs) => {
    return (notifs || []).filter(
      (n) =>
        !n.read ||
        n.type === 'merge_request_student' ||
        n.type === 'name_match_confirm'
    ).length;
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [s, ev, r, n, u, notifs, fps, mergesRes] = await Promise.all([
        getMyStudents().catch(() => []),
        getCoachActivityFeed().catch(() => []),
        getPendingCoachRequests().catch(() => []),
        getCoachNotes().catch(() => []),
        getUser().catch(() => null),
        getNotifications().catch(() => []),
        getPendingFocusPoints(null).catch(() => []),
        supabase
          .from('merge_requests')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending_coach')
          .then((res) => res)
          .catch(() => ({ count: 0 })),
      ]);
      setStudents(s || []);
      setEvents((ev || []).slice(0, 12));
      setRequests(r || []);
      setNotes(n || []);
      setUser(u);
      setUnreadCount(computeUnread(notifs));

      const focusCount = (fps || []).length;
      const mergeCount = mergesRes?.count || 0;
      const nameCount = (notifs || []).filter((x) => x.type === 'name_match_confirm').length;
      setActionCounts({
        focus: focusCount,
        merge: mergeCount,
        name: nameCount,
        total: focusCount + mergeCount + nameCount,
      });
    } catch {}
    if (!loaded.current) {
      loaded.current = true;
      setInitialLoading(false);
    }
  }, [computeUnread]);

  // Load once on mount
  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Refresh in background (no loading state) — called on tab focus
  const refresh = useCallback(async () => {
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
        initialLoading,
        refresh,
        updateStudents,
        updateRequests,
        updateNotes,
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
