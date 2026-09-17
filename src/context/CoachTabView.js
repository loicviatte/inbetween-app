import React, { createContext, useContext, useMemo, useState } from 'react';

// Some tab controls sit in the shared coach header while the tab draws what
// they pick: the Class tab's Classes ▾, calendar and notes buttons, and the
// Students tab's link button. This carries the picks between the two.
const CoachTabViewContext = createContext(null);

export function CoachTabViewProvider({ children }) {
  const [classesView, setClassesView] = useState('list'); // 'list' | 'cal' | 'notes'
  const [classesStyle, setClassesStyle] = useState('all'); // 'all' | 'latin' | 'ballroom'
  const [linksOpen, setLinksOpen] = useState(false);       // Students ▸ Links
  const value = useMemo(
    () => ({ classesView, setClassesView, classesStyle, setClassesStyle, linksOpen, setLinksOpen }),
    [classesView, classesStyle, linksOpen],
  );
  return <CoachTabViewContext.Provider value={value}>{children}</CoachTabViewContext.Provider>;
}

export function useCoachTabView() {
  const ctx = useContext(CoachTabViewContext);
  if (!ctx) throw new Error('useCoachTabView must be used within CoachTabViewProvider');
  return ctx;
}
