import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { isAgeLocked } from '../services/ageCheck';

// Is the signed-in student's account locked by a coach's "under 18"? Checked
// on start, whenever the app comes back to the front, every minute while in
// use (a coach can lock it mid-session) and every 8 seconds while locked (so
// it opens by itself once the email is confirmed or a parent approves).
export function useAgeLock() {
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    let timer = null;
    const check = async () => {
      try {
        const v = await isAgeLocked();
        if (!alive) return;
        lockedRef.current = v;
        setLocked(v);
      } catch { /* offline: keep what we had */ }
      if (alive) {
        clearTimeout(timer);
        timer = setTimeout(check, lockedRef.current ? 8000 : 60000);
      }
    };
    check();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') check(); });
    return () => { alive = false; clearTimeout(timer); sub.remove(); };
  }, []);

  return locked;
}
