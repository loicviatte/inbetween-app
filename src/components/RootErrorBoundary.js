// ─── Root error boundary ─────────────────────────────────────────────────────
// The app had NO error containment: no ErrorBoundary, no ErrorUtils global
// handler. Under New Architecture + React 19 + distribution (TestFlight / App
// Store) signing, an uncaught error thrown during a render/commit — e.g. a
// transient throw while the signed-in navigator tree tears down on logout —
// unmounts the whole React root and surfaces through the native exception
// manager as a HARD CRASH (the same class of distribution-only abort documented
// for the iOS 26 SplashScreen NSException).
//
// This boundary catches such a throw, logs it, and auto-recovers by remounting
// its children on the next tick. The crash-prone moment is the auth-state
// transition (App.js has already flipped `session` → null and swapped to
// AuthNavigator by the time the old tree throws during unmount), so a single
// remount lands on the correct, already-committed navigator and logout
// completes cleanly instead of taking the process down.
//
// Loop-safe: auto-recovery is capped, so a genuinely persistent render error
// can't spin in a 50ms remount loop — after a few failed attempts it leaves the
// fallback up with a manual "Tap to continue". A recovery that stays stable for
// STABLE_MS resets the counter, so unrelated transient blips later in the
// session each get a fresh set of retries.

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';

const MAX_AUTO_RECOVERIES = 3;
const RECOVER_DELAY_MS = 50;
const STABLE_MS = 1500;

export default class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, recoveries: 0 };
    this._recoverTimer = null;
    this._stableTimer = null;
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // No crash reporter is wired in this app, so at least surface it to the
    // JS console / device logs for post-mortem.
    console.warn('[RootErrorBoundary] caught', error?.message || error, info?.componentStack);
    // A new error before the stability window elapsed → we're looping, not
    // recovering. Stop the pending "stable" reset so the counter keeps climbing.
    this._clearStableTimer();
    if (this.state.recoveries < MAX_AUTO_RECOVERIES) {
      this._recoverTimer = setTimeout(() => this._recover(), RECOVER_DELAY_MS);
    }
    // else: leave the fallback up; the user can tap to retry.
  }

  componentWillUnmount() {
    this._clearRecoverTimer();
    this._clearStableTimer();
  }

  _recover = () => {
    this.setState((s) => ({ error: null, recoveries: s.recoveries + 1 }));
    // If the children stay healthy for a moment, treat it as a real recovery
    // and reset the loop counter so future unrelated blips get fresh retries.
    this._stableTimer = setTimeout(() => this.setState({ recoveries: 0 }), STABLE_MS);
  };

  _manualRetry = () => {
    this._clearRecoverTimer();
    this._clearStableTimer();
    this.setState({ error: null, recoveries: 0 });
  };

  _clearRecoverTimer() {
    if (this._recoverTimer) { clearTimeout(this._recoverTimer); this._recoverTimer = null; }
  }

  _clearStableTimer() {
    if (this._stableTimer) { clearTimeout(this._stableTimer); this._stableTimer = null; }
  }

  render() {
    if (this.state.error) {
      // Minimal fallback. In the common (transient) case it flashes for ~50ms
      // or not at all; it only lingers once auto-recovery is exhausted.
      return (
        <View style={styles.fill}>
          <Text style={styles.title}>One moment…</Text>
          <Pressable style={styles.btn} onPress={this._manualRetry}>
            <Text style={styles.btnText}>Tap to continue</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
    padding: 24,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 16,
    marginBottom: 16,
    opacity: 0.9,
  },
  btn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
});
