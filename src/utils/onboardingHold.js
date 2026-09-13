// Sign-up creates a session, and App.js swaps navigators the moment it sees
// one — which would unmount the last onboarding screen before it is read.
//
// The coach's finished card is the payoff for the eleven answers he just gave,
// so the onboarding holds that swap until he has seen it and tapped Done. The
// hold is released on unmount too: a flow abandoned mid-way must never leave
// the app stuck on the auth navigator with a live session.
import { useEffect, useState } from 'react';

let held = false;
const subs = new Set();

export function setOnboardingHold(v) {
  if (held === v) return;
  held = v;
  subs.forEach((f) => f(held));
}

export function useOnboardingHold() {
  const [v, setV] = useState(held);
  useEffect(() => {
    subs.add(setV);
    setV(held);
    return () => { subs.delete(setV); };
  }, []);
  return v;
}
