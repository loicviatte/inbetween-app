import React, { createContext, useContext, useMemo, useState } from 'react';

// The Class tab's controls sit in the shared coach header — Classes ▾, the
// calendar and the notes buttons — while the tab draws what they pick. This
// carries the picks between them.
const ClassesViewContext = createContext(null);

export function ClassesViewProvider({ children }) {
  const [view, setView] = useState('list');   // 'list' | 'cal' | 'notes'
  const [style, setStyle] = useState('all');  // 'all' | 'latin' | 'ballroom'
  const value = useMemo(() => ({ view, setView, style, setStyle }), [view, style]);
  return <ClassesViewContext.Provider value={value}>{children}</ClassesViewContext.Provider>;
}

export function useClassesView() {
  const ctx = useContext(ClassesViewContext);
  if (!ctx) throw new Error('useClassesView must be used within ClassesViewProvider');
  return ctx;
}
