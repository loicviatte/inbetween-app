// ───────────────────────────────────────────────────────────────────────
// useDjiAutoSync — foreground-polling hook that drives the Dashboard's
// "0-tap import" experience.
//
// While the coach has the app open in local-recording mode, we poll the
// bookmarked DJI folder every few seconds. When we see a new file index
// (higher than what we last knew about), we kick off runAutoSync() in the
// background and surface its progress as a state object the dashboard can
// project into the START CLASS button area.
//
// iOS reality check:
//   - There's no public USB-hotplug API for non-MFi accessories like the
//     DJI mic, so we can't be event-driven. Polling is the workaround.
//   - We pause polling when the app is backgrounded (AppState !== 'active')
//     to avoid burning battery while not visible. On foreground we kick
//     a poll immediately so the dashboard reflects new files within ~1s
//     of the coach reopening the app.
//
// Triggering policy:
//   - First poll on mount establishes a baseline (lastSeenMaxIdx). We
//     intentionally DON'T trigger a sync on that first poll — runAutoSync
//     itself filters to indices above what's in the DB, so any "new"
//     files from a prior session would no-op anyway, but skipping the
//     first-poll trigger keeps the visible state quiet on app launch.
//   - Subsequent polls: if `max(filename.index)` has grown vs. last poll,
//     fire runAutoSync once and update state.
//   - The sync itself is mutex'd via a ref so a slow upload doesn't get
//     re-triggered by the next tick.
// ───────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as DjiFiles from 'local-recording-files';
import { parseDjiFileName } from './localRecordingMatcher';
import { runAutoSync, AutoSyncResult, SyncPair } from './localRecordingAutoSync';

const POLL_INTERVAL_MS = 5_000;
// Hold the "done" pill on screen so the coach actually sees it before
// it collapses back to the START CLASS button.
const DONE_VISIBLE_MS = 5_000;

export type AutoSyncPhase =
  | 'idle'         // nothing happening — show the regular START CLASS CTA
  | 'detecting'    // we noticed new files, planning the sync
  | 'syncing'      // upload in flight
  | 'done'         // wraps with a brief success state, then back to idle
  | 'error';       // something failed; brief visible state then idle

export interface AutoSyncUiState {
  phase: AutoSyncPhase;
  /** 1-based — "Importing 2 of 3". */
  currentIdx: number;
  /** Total pairs in the active sync run. */
  total: number;
  /** Number of recordings successfully imported in the most recent run. */
  imported: number;
  /** Number that needed admin review (uploaded but not auto-approved). */
  pending: number;
  /** Human-readable error label for the 'error' phase. */
  errorMessage?: string;
}

const IDLE_STATE: AutoSyncUiState = {
  phase: 'idle',
  currentIdx: 0,
  total: 0,
  imported: 0,
  pending: 0,
};

export function useDjiAutoSync(args: {
  userId: string | null;
  enabled: boolean;
}): AutoSyncUiState {
  const { userId, enabled } = args;
  const [state, setState] = useState<AutoSyncUiState>(IDLE_STATE);

  // Refs survive renders so we can read/write the polling state without
  // tearing down the effect.
  const lastSeenMaxIdxRef = useRef<number>(-1);
  const baselineEstablishedRef = useRef<boolean>(false);
  const syncRunningRef = useRef<boolean>(false);
  const doneCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !userId) {
      setState(IDLE_STATE);
      lastSeenMaxIdxRef.current = -1;
      baselineEstablishedRef.current = false;
      return;
    }

    let mounted = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const cancelDoneCollapse = () => {
      if (doneCollapseTimerRef.current) {
        clearTimeout(doneCollapseTimerRef.current);
        doneCollapseTimerRef.current = null;
      }
    };

    const scheduleCollapseToIdle = () => {
      cancelDoneCollapse();
      doneCollapseTimerRef.current = setTimeout(() => {
        if (mounted) setState(IDLE_STATE);
      }, DONE_VISIBLE_MS);
    };

    /**
     * Lightweight check: list files, derive max DJI index, compare to
     * the last seen value. Returns the maxIdx for caller's bookkeeping.
     */
    async function peekMaxIndex(): Promise<number | null> {
      if (!DjiFiles.hasFolder()) return null;
      try {
        const entries = await DjiFiles.listFiles();
        let maxIdx = -1;
        for (const entry of entries) {
          const meta = parseDjiFileName(entry.name);
          if (!meta) continue;
          if (meta.index > maxIdx) maxIdx = meta.index;
        }
        return maxIdx;
      } catch {
        // Bookmark stale / volume not mounted yet / etc. — silent.
        return null;
      }
    }

    async function runSync() {
      if (!userId || syncRunningRef.current) return;
      syncRunningRef.current = true;
      cancelDoneCollapse();
      if (mounted) setState({ ...IDLE_STATE, phase: 'detecting' });

      let result: AutoSyncResult | null = null;
      let runError: Error | null = null;

      try {
        result = await runAutoSync(userId, {
          onPlanned: (pairs: SyncPair[]) => {
            if (!mounted) return;
            setState({
              ...IDLE_STATE,
              phase: pairs.length > 0 ? 'syncing' : 'idle',
              total: pairs.length,
              currentIdx: 0,
            });
          },
          onPairStart: (_pair, idx, total) => {
            if (!mounted) return;
            setState((prev) => ({
              ...prev,
              phase: 'syncing',
              total,
              currentIdx: idx + 1,
            }));
          },
          onPairDone: (_pair, _idx, _total, err) => {
            // Per-pair errors aggregate inside runAutoSync.result.errors;
            // no need to surface them per-tick here.
            void err;
          },
        });
      } catch (e: any) {
        runError = e instanceof Error ? e : new Error(String(e));
      } finally {
        syncRunningRef.current = false;
      }

      if (!mounted) return;

      if (runError) {
        setState({
          ...IDLE_STATE,
          phase: 'error',
          errorMessage: runError.message,
        });
        scheduleCollapseToIdle();
        return;
      }

      if (!result || result.pairs.length === 0) {
        // Nothing to do — slide back to idle quietly without flashing
        // a "done" pill at the user.
        setState(IDLE_STATE);
        return;
      }

      const pending = result.pairs.filter((p) => p.adminReviewStatus === 'pending').length;
      setState({
        phase: result.errors.length > 0 && result.importedCount === 0 ? 'error' : 'done',
        currentIdx: result.importedCount,
        total: result.pairs.length,
        imported: result.importedCount,
        pending,
        errorMessage: result.errors[0]?.error,
      });
      scheduleCollapseToIdle();
    }

    /**
     * One poll tick: peek the folder, compare to baseline, run sync if
     * we see a higher max index than last time.
     */
    async function tick() {
      if (!mounted) return;
      if (AppState.currentState !== 'active') return;
      if (syncRunningRef.current) return;

      const maxIdx = await peekMaxIndex();
      if (maxIdx === null) return;

      if (!baselineEstablishedRef.current) {
        // First successful read — record baseline and skip triggering.
        // If the coach plugged the mic *before* opening the app, the
        // initial runAutoSync runs anyway below.
        lastSeenMaxIdxRef.current = maxIdx;
        baselineEstablishedRef.current = true;
        // Kick a one-shot sync attempt on baseline establish so app-open-
        // with-mic-already-plugged works without waiting for an index to
        // change. runAutoSync filters against maxImportedIdx from the DB
        // so this is a no-op when there's nothing new.
        runSync();
        return;
      }

      if (maxIdx > lastSeenMaxIdxRef.current) {
        lastSeenMaxIdxRef.current = maxIdx;
        runSync();
      }
    }

    // App lifecycle: pause polling in background, kick a poll on foreground.
    const onAppStateChange = (state: AppStateStatus) => {
      if (!mounted) return;
      if (state === 'active') {
        tick();
      }
    };
    const sub = AppState.addEventListener('change', onAppStateChange);

    // First tick on mount.
    tick();
    intervalId = setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      sub.remove();
      if (intervalId) clearInterval(intervalId);
      cancelDoneCollapse();
    };
  }, [userId, enabled]);

  return state;
}
