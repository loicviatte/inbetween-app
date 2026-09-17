import React, { createContext, useContext, useMemo, useState } from 'react';

// The Class tab's controls sit in the shared coach header — Classes ▾, the
// calendar and the notes buttons — while the tab draws what they pick. This
// carries the picks (and the count the header's subtitle shows) between them.
const ClassesViewContext = createContext(null);

export function ClassesViewProvider({ children }) {
  const [view, setView] = useState('list');   // 'list' | 'cal' | 'notes'
  const [style, setStyle] = useState('all');  // 'all' | 'latin' | 'ballroom'
  const [logged, setLogged] = useState(null); // classes logged, once loaded
  const value = useMemo(() => ({ view, setView, style, setStyle, logged, setLogged }), [view, style, logged]);
  return <ClassesViewContext.Provider value={value}>{children}</ClassesViewContext.Provider>;
}

export function useClassesView() {
  const ctx = useContext(ClassesViewContext);
  if (!ctx) throw new Error('useClassesView must be used within ClassesViewProvider');
  return ctx;
}
