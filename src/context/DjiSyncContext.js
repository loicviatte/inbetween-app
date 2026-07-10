// ───────────────────────────────────────────────────────────────────────
// DjiSyncContext — the single source of truth for the coach's DJI mic sync.
//
// Before v2, the sync state lived inside DashboardScreen (useDjiAutoSync +
// an in-CTA pill) so it died when the dashboard unmounted and couldn't be
// shared with the header. This provider lifts the whole engine up to the
// coach navigator so BOTH the header pill (DjiSyncPill) and the full-screen
// flow (MicSyncFlowModal) read/drive the same state.
//
// Two entry points feed one machine:
//   • Silent auto-sync — while the app is open, we poll the bookmarked mic
//     folder; new files import automatically (matched pairs only), pill goes
//     orange. No tap required.
//   • Manual "Sync files" — the coach taps the red pill → the flow opens on
//     the Connect screen and waits for the mic; on connect it imports and,
//     because it's a foreground run, also vacuums unmatched recordings.
//
// Phases: idle · waiting · granting · syncing · done · error
//   idle     — nothing happening (pill hidden, or red "Sync files" when there
//              are pending classes + a folder bookmark)
//   waiting  — flow open, Connect screen, polling for the mic
//   granting — flow open, guided "grant folder access" instructions screen
//   syncing  — import in flight (pill orange, %); modal shows Importing
//   done     — finished; pill STAYS green until tapped or the app restarts
//   error    — failed; pill shows "! Error"; modal shows the typed error
// ───────────────────────────────────────────────────────────────────────

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as DjiFiles from 'local-recording-files';
import { supabase } from '../services/supabase/client';
import { isLocalRecordingMode } from '../services/featureFlags';
import { parseDjiFileName } from '../services/localRecordingMatcher';
import {
  fetchPendingUploads,
  planAutoSync,
  executeAutoSync,
  scanUnmatchedSessions,
  classifySyncError,
  uploadPreparedItems,
  purgeExpiredPreparedFiles,
  purgeExpiredM4aBackups,
} from '../services/localRecordingAutoSync';

const POLL_INTERVAL_MS = 2000;
// Keeps the screen (and thus the app process) awake while a sync is actively
// running, so a coach can plug the mic in, set the phone down, and have the
// copy → transcode → upload finish. iOS suspends a backgrounded app within
// seconds and can't read the USB mic while suspended, so an auto-locking
// screen would otherwise silently stall the sync. Foreground-only mitigation —
// NOT true background execution.
const KEEP_AWAKE_TAG = 'dji-sync';
// Cadence of the simulated progress creep during the no-byte-progress phases
// (mic read + transcode). ~700ms so the bar visibly ticks up ~each second.
const CREEP_INTERVAL_MS = 700;
// How often we re-attempt uploading the prepared-but-unsent recordings while
// waiting for the network to come back. Retrying the real upload IS the
// connectivity test — it fails instantly (cheap) when offline.
const OFFLINE_RETRY_MS = 8000;

const DjiSyncContext = createContext(null);

/** Consumers must null-guard: returns null when used outside the provider. */
export function useDjiSync() {
  return useContext(DjiSyncContext);
}

export function DjiSyncProvider({ children }) {
  const [authUser, setAuthUser] = useState(null);
  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => setAuthUser(user))
      .catch(() => setAuthUser(null));
    // React to sign-in / token refresh so a role change (e.g. a coach onboarded
    // or promoted AFTER their last sign-in) enables the DJI flow immediately,
    // without a manual re-login. App.js forces a refresh at launch → the
    // TOKEN_REFRESHED here carries the fresh user_metadata.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) setAuthUser(session.user);
    });
    return () => subscription.unsubscribe();
  }, []);

  const enabled = isLocalRecordingMode(authUser);
  const userId = authUser?.id ?? null;

  // ─── Sync-engine state ────────────────────────────────────────────────
  const [phase, setPhase] = useState('idle'); // idle|waiting|syncing|done|error
  const [progressPct, setProgressPct] = useState(0);
  const [fileIdx, setFileIdx] = useState(0);
  const [fileTotal, setFileTotal] = useState(0);
  const [fileSizeBytes, setFileSizeBytes] = useState(0);
  const [etaSec, setEtaSec] = useState(null);
  const [imported, setImported] = useState(0);
  const [pendingReview, setPendingReview] = useState(0);
  const [unmatched, setUnmatched] = useState(0);
  const [summary, setSummary] = useState(null); // { files, runtimeSec, sizeBytes }
  const [errorInfo, setErrorInfo] = useState(null); // { kind, message }
  const [stageLabel, setStageLabel] = useState(null); // 'Copying…' | 'Compressing…' | 'Uploading N%'

  // ─── Flow (full-screen modal) visibility ──────────────────────────────
  const [flowOpen, setFlowOpen] = useState(false);
  const flowOpenRef = useRef(false);
  useEffect(() => {
    flowOpenRef.current = flowOpen;
  }, [flowOpen]);

  // ─── Pill-gating state (folder access + how many classes await audio) ──
  const [hasFolderAccess, setHasFolderAccess] = useState(false);
  const [pendingUploadCount, setPendingUploadCount] = useState(0);

  // ─── Refs shared across the poll loop ─────────────────────────────────
  const syncRunningRef = useRef(false);
  const lastSeenMaxIdxRef = useRef(-1);
  const baselineEstablishedRef = useRef(false);
  const etaStartRef = useRef(0);
  const phaseRef = useRef('idle');
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  // Mirrors errorInfo so the poll loop can tell a truly-stuck error (offline /
  // no-access) from a recoverable one (generic / disconnect) without a stale
  // closure.
  const errorInfoRef = useRef(null);
  useEffect(() => {
    errorInfoRef.current = errorInfo;
  }, [errorInfo]);

  // ─── Simulated progress-creep refs (see runExecute) ───────────────────
  const creepTimerRef = useRef(null);
  const bandRef = useRef({ base: 0, width: 0 }); // current file's [base, base+width] band
  const stageKindRef = useRef('copying'); // 'copying' | 'compressing' | 'uploading'
  const uploadFracRef = useRef(0);
  const displayedRef = useRef(0);

  // ─── Offline hold / retry refs ────────────────────────────────────────
  const offlinePendingRef = useRef([]); // PreparedUpload[] prepared but not uploaded
  // Hard (non-network) real-class errors from a run that ALSO went offline, so
  // the offline drain surfaces them at the end instead of a clean "done" that
  // hides a class that actually failed.
  const heldHardErrorsRef = useRef([]);
  const offlineRetryTimerRef = useRef(null);
  const runUploadRef = useRef(null); // latest runUpload, so the timer stays stable
  const summaryAccumRef = useRef({ files: 0, runtimeSec: 0, sizeBytes: 0 });
  // True when the current 'done' came from a run the coach engaged with (a
  // foreground sync, an explicit "up to date", or a drained offline hold) — that
  // 'done' stays sticky until acknowledged, even with the flow closed. A purely
  // SILENT background 'done' leaves this false so the poll can still supersede it
  // with a newly-arrived file (the silent auto-sync promise). See the tick guard.
  const stickyDoneRef = useRef(false);

  const refreshFolderAccess = useCallback(() => {
    try {
      setHasFolderAccess(DjiFiles.hasFolder?.() ?? false);
    } catch {
      setHasFolderAccess(false);
    }
  }, []);

  const refreshPending = useCallback(async () => {
    if (!enabled || !userId) {
      setPendingUploadCount(0);
      return;
    }
    try {
      const rows = await fetchPendingUploads(userId);
      setPendingUploadCount(rows.length);
    } catch {
      /* keep previous */
    }
  }, [enabled, userId]);

  // Folder access + pending count: mount + on foreground.
  useEffect(() => {
    if (!enabled) {
      setHasFolderAccess(false);
      setPendingUploadCount(0);
      return;
    }
    refreshFolderAccess();
    refreshPending();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        refreshFolderAccess();
        refreshPending();
      }
    });
    return () => sub.remove();
  }, [enabled, refreshFolderAccess, refreshPending]);

  // Hold the screen awake for the duration of an active sync so the process
  // isn't suspended mid copy/transcode/upload if the coach sets the phone down.
  useEffect(() => {
    if (phase !== 'syncing') return undefined;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      try {
        Promise.resolve(deactivateKeepAwake(KEEP_AWAKE_TAG)).catch(() => {});
      } catch {}
    };
  }, [phase]);

  // Sweep leftover prepared m4a ONCE on provider mount. At mount the in-memory
  // offline hold (offlinePendingRef) is always empty, so every file in
  // PREPARE_DIR is definitionally a leftover from a prior session (app killed /
  // hold lost) — never a file the live process is still holding. Running this
  // only at mount is why it can't delete an actively-held upload (a mid-session
  // hold's freshly-prepared files are also too recent for the stale window).
  useEffect(() => {
    purgeExpiredPreparedFiles().catch(() => {});
    // The default auto-sync flow never opens LocalUploadScreen (the only other
    // caller), so sweep the uploaded-m4a backups here too or they accumulate
    // forever for coaches who only use automatic sync. Both are safe at mount:
    // backups are post-upload (never held) and prepared files aren't held yet.
    purgeExpiredM4aBackups().catch(() => {});
  }, []);

  // ─── Offline upload: hold prepared items, retry until the network is back ──
  const stopOfflineRetry = useCallback(() => {
    if (offlineRetryTimerRef.current) {
      clearInterval(offlineRetryTimerRef.current);
      offlineRetryTimerRef.current = null;
    }
  }, []);

  const startOfflineRetry = useCallback(() => {
    stopOfflineRetry();
    offlineRetryTimerRef.current = setInterval(() => {
      if (!offlinePendingRef.current.length) {
        stopOfflineRetry();
        return;
      }
      if (syncRunningRef.current) return;
      // Retrying the real upload IS the connectivity probe.
      runUploadRef.current?.(offlinePendingRef.current);
    }, OFFLINE_RETRY_MS);
  }, [stopOfflineRetry]);

  // Immediate "Reconnecting…" feedback for a MANUAL retry / mic-connected tap so
  // the button never looks dead — whether it kicks off a fresh upload or a
  // retry is already draining. The upload (this one or the in-flight one)
  // resolves it into the right terminal phase: 'done', or back to the offline
  // error screen if still down. Clears the per-file counters too so we don't
  // flash the previous run's stale "N of M" / ETA under the Reconnecting label.
  const showReconnecting = useCallback(() => {
    setErrorInfo(null);
    setStageLabel('Reconnecting…');
    setProgressPct(0);
    setEtaSec(null);
    setFileIdx(0);
    setFileTotal(0);
    setFileSizeBytes(0);
    setPhase('syncing');
  }, []);

  // Upload a list of already-prepared recordings (no mic, no transcode) — used
  // by the offline auto-retry AND the "Try again" button. On continued network
  // failure it re-holds the remainder and keeps waiting.
  const runUpload = useCallback(
    async (items, { manual = false } = {}) => {
      if (syncRunningRef.current || !userId || !items.length) return;
      syncRunningRef.current = true;
      stopOfflineRetry();
      // A MANUAL "Try again" / "Mic is connected" tap gets IMMEDIATE feedback (a
      // "Reconnecting…" state) so it never looks dead; if the network is still
      // down the offline branch below drops it right back to the offline screen.
      // The AUTO (timer) retry stays silent — it only flips to the visible
      // "Uploading…" once real bytes actually flow (proof the network is back),
      // so an offline auto-retry never flashes anything.
      if (manual) showReconnecting();
      let sawBytes = false;
      try {
        const result = await uploadPreparedItems(userId, items, {
          onFile: ({ idx, total, sizeBytes }) => {
            setFileIdx(idx);
            setFileTotal(total);
            setFileSizeBytes(sizeBytes);
          },
          onProgress: (_status, fraction) => {
            if (typeof fraction !== 'number') return;
            if (!sawBytes && fraction > 0) {
              sawBytes = true;
              setErrorInfo(null);
              setStageLabel('Uploading…');
              setProgressPct(0);
              setPhase('syncing');
            }
            if (sawBytes) {
              setProgressPct(Math.max(0, Math.min(100, Math.round(fraction * 100))));
            }
          },
        });
        // Count ONLY items that truly uploaded — NOT those held offline
        // (stillPending) and NOT those that hard-failed (in errors). Counting a
        // hard-failed item as "uploaded" would inflate the total and silently
        // drop a class that never actually imported.
        const failedIds = new Set((result.errors ?? []).map((e) => e.classId));
        const idOf = (it) => (it.kind === 'pair' ? it.classId : `unmatched:${it.session?.index}`);
        const uploaded = items.filter(
          (it) => !result.stillPending.includes(it) && !failedIds.has(idOf(it)),
        );
        summaryAccumRef.current = {
          files: summaryAccumRef.current.files + uploaded.length,
          runtimeSec:
            summaryAccumRef.current.runtimeSec + uploaded.reduce((n, it) => n + (it.durationSec || 0), 0),
          sizeBytes:
            summaryAccumRef.current.sizeBytes + uploaded.reduce((n, it) => n + (it.sizeBytes || 0), 0),
        };
        // A hard failure surfaces if a REAL class failed either during this
        // drain OR back in the original run (carried in heldHardErrorsRef when
        // that run also went offline). Orphan-only failures don't escalate.
        const drainRealErrors = (result.errors ?? []).filter(
          (e) => !String(e.classId ?? '').startsWith('unmatched:'),
        );
        const heldRealErrors = heldHardErrorsRef.current;
        if (result.offline && result.stillPending.length > 0) {
          // Still draining — keep any held hard errors to surface once it lands.
          offlinePendingRef.current = result.stillPending;
          setErrorInfo({ kind: 'offline', message: 'Waiting for a connection to finish uploading.' });
          setPhase('error');
          startOfflineRetry();
        } else if (drainRealErrors.length > 0 || heldRealErrors.length > 0) {
          // A hard (non-network) failure — surface it instead of a misleading
          // "done". Even when some items DID upload (already counted in
          // summaryAccumRef), the failed ones would otherwise be silently
          // dropped behind a green screen; they stay pending server-side and get
          // re-offered on the next sync. The offline loop only retries
          // network-held items, so there's nothing to auto-retry here.
          offlinePendingRef.current = [];
          heldHardErrorsRef.current = [];
          const message =
            drainRealErrors[0]?.error ?? heldRealErrors[0]?.error ?? 'Upload failed';
          setErrorInfo({ kind: 'generic', message });
          setPhase('error');
        } else {
          offlinePendingRef.current = [];
          heldHardErrorsRef.current = [];
          const s = summaryAccumRef.current;
          setProgressPct(100);
          setStageLabel(null);
          setImported(s.files);
          setSummary({ files: s.files, runtimeSec: s.runtimeSec, sizeBytes: s.sizeBytes });
          // A drained offline hold followed a visible error the coach saw — keep
          // this 'done' sticky until they acknowledge it.
          stickyDoneRef.current = true;
          setPhase('done');
          refreshPending();
        }
      } catch (err) {
        // uploadPreparedItems is designed to catch its own per-item errors, so
        // this is a defensive backstop. Keep the items held AND keep the retry
        // loop alive (re-uploads are idempotent) rather than dying silently.
        const message = err?.message ?? String(err);
        offlinePendingRef.current = items;
        setErrorInfo({ kind: classifySyncError(message), message });
        setPhase('error');
        startOfflineRetry();
      } finally {
        syncRunningRef.current = false;
      }
    },
    [userId, refreshPending, stopOfflineRetry, startOfflineRetry, showReconnecting],
  );
  useEffect(() => {
    runUploadRef.current = runUpload;
  }, [runUpload]);
  // Stop the retry + creep timers if the provider unmounts (e.g. logout).
  useEffect(
    () => () => {
      stopOfflineRetry();
      if (creepTimerRef.current) {
        clearInterval(creepTimerRef.current);
        creepTimerRef.current = null;
      }
    },
    [stopOfflineRetry],
  );

  // ─── Run one execute pass over a known-non-empty plan ─────────────────
  const runExecute = useCallback(
    async (plan, foreground) => {
      if (syncRunningRef.current) return;
      if (!userId) return;
      syncRunningRef.current = true;
      etaStartRef.current = Date.now();
      summaryAccumRef.current = { files: 0, runtimeSec: 0, sizeBytes: 0 };
      setErrorInfo(null);
      setSummary(null);
      setProgressPct(0);
      setEtaSec(null);
      setImported(0);
      setPendingReview(0);
      setUnmatched(0);
      // Clear the per-file counters too, else the Importing/Error screens
      // briefly show the PREVIOUS run's "N of M" + size before the first
      // onFile of this run lands.
      setFileIdx(0);
      setFileTotal(0);
      setFileSizeBytes(0);
      setStageLabel(null);
      setPhase('syncing');

      // ── Simulated progress creep ──────────────────────────────────────
      // Copy-from-mic + transcode report no byte progress, so the real % sits
      // frozen ~20s/file. Split each file's band into thirds (copy·compress·
      // upload): a timer eases the bar through the first two thirds (randomised
      // so it visibly ticks) while the upload third follows the real byte %.
      const stopCreep = () => {
        if (creepTimerRef.current) {
          clearInterval(creepTimerRef.current);
          creepTimerRef.current = null;
        }
      };
      stopCreep();
      displayedRef.current = 0;
      bandRef.current = { base: 0, width: 0 };
      stageKindRef.current = 'copying';
      uploadFracRef.current = 0;
      creepTimerRef.current = setInterval(() => {
        const { base, width } = bandRef.current;
        if (width <= 0) return;
        const kind = stageKindRef.current;
        let target;
        if (kind === 'copying') target = base + width / 3;
        else if (kind === 'compressing') target = base + (2 * width) / 3;
        else target = base + (2 * width) / 3 + Math.min(1, uploadFracRef.current) * (width / 3);
        let d = displayedRef.current;
        if (kind === 'uploading') {
          d = Math.max(d, target); // snap up to follow the real upload
        } else if (target > d) {
          d = d + (target - d) * (0.12 + Math.random() * 0.22); // ease toward the cap
        }
        d = Math.min(1, Math.max(d, base));
        displayedRef.current = d;
        setProgressPct(Math.round(d * 100));
        if (d > 0.03 && d < 1) {
          const elapsedMs = Date.now() - etaStartRef.current;
          const remaining = Math.round((elapsedMs * (1 - d)) / d / 1000);
          setEtaSec(remaining > 0 ? remaining : null);
        }
      }, CREEP_INTERVAL_MS);

      try {
        const result = await executeAutoSync(userId, plan, {
          uploadUnmatched: foreground,
          onFile: ({ idx, total, sizeBytes }) => {
            setFileIdx(idx);
            setFileTotal(total);
            setFileSizeBytes(sizeBytes);
            // Advance the creep into this file's band.
            const T = Math.max(1, total);
            bandRef.current = { base: (idx - 1) / T, width: 1 / T };
            stageKindRef.current = 'copying';
            uploadFracRef.current = 0;
          },
          onProgress: (status) => {
            // Map the status → stage (drives the creep target + the pulsing
            // label). The bar % and ETA are owned by the creep timer.
            if (typeof status !== 'string' || !status) return;
            if (/compress/i.test(status)) {
              stageKindRef.current = 'compressing';
              setStageLabel('Compressing…');
            } else if (/reading|copy/i.test(status)) {
              stageKindRef.current = 'copying';
              setStageLabel('Copying…');
            } else if (/upload|saving/i.test(status)) {
              // Still parse the % to drive the creep's upload third, but the
              // label stays plain "Uploading…" (no number next to it).
              const m = status.match(/(\d+)\s*%\s*$/);
              if (m) uploadFracRef.current = Math.min(1, parseInt(m[1], 10) / 100);
              stageKindRef.current = 'uploading';
              setStageLabel('Uploading…');
            }
          },
        });
        stopCreep();

        const importedCount = result.importedCount ?? 0;
        const unmatchedCount = result.unmatchedUploaded ?? 0;
        const pendingReviewCount = (result.pairs ?? []).filter(
          (p) => p.adminReviewStatus === 'pending',
        ).length;

        // Seed the running summary with the pairs/orphans that ALREADY uploaded
        // this run (i.e. NOT offline-held and NOT hard-failed). Used by BOTH
        // held-upload branches (disconnect+offline AND offline-only) so that when
        // the offline retry later drains the held tail, the Complete screen shows
        // the TRUE total imported — not just the retried subset.
        const seedSummaryFromUploaded = () => {
          const heldIds = new Set(
            (result.offlinePending ?? []).map((x) =>
              x.kind === 'pair' ? x.classId : `unmatched:${x.session?.index}`,
            ),
          );
          const failedIds = new Set((result.errors ?? []).map((e) => e.classId));
          const uploadedPairs = (result.pairs ?? []).filter(
            (p) => !heldIds.has(p.classId) && !failedIds.has(p.classId),
          );
          const uploadedOrphans = (result.unmatchedSessions ?? []).filter(
            (sn) => !heldIds.has(`unmatched:${sn.index}`) && !failedIds.has(`unmatched:${sn.index}`),
          );
          summaryAccumRef.current = {
            files: importedCount + unmatchedCount,
            runtimeSec:
              uploadedPairs.reduce((n, p) => n + (p.actualDurationSec || 0), 0) +
              uploadedOrphans.reduce((n, sn) => n + (sn.durationSec || 0), 0),
            sizeBytes:
              uploadedPairs.reduce((n, p) => n + p.parts.reduce((a, x) => a + (x.sizeBytes || 0), 0), 0) +
              uploadedOrphans.reduce((n, sn) => n + sn.parts.reduce((a, x) => a + (x.sizeBytes || 0), 0), 0),
          };
        };

        // Only a REAL class failing should escalate to the error screen. The
        // safety-net orphan upload (foreground) is best-effort — an orphan that
        // fails to upload lands in result.errors as `unmatched:<idx>` but must
        // NOT turn a run where every real class imported into a full error.
        const realErrors = (result.errors ?? []).filter(
          (e) => !String(e.classId ?? '').startsWith('unmatched:'),
        );

        // Mic unplugged mid-import — surface the disconnect screen with the
        // "X of Y imported, Z remaining" breakdown, even if some succeeded.
        if (result.micDisconnected) {
          const combined =
            (result.pairs?.length ?? 0) + (result.unmatchedSessions?.length ?? 0);
          setStageLabel(null);
          setImported(importedCount);
          setFileIdx(importedCount);
          setFileTotal(combined);
          // The mic vanished mid-run, but earlier files may have been fully
          // prepared and then held because the NETWORK also dropped. Don't lose
          // them just because we're showing the disconnect screen: hold + auto-
          // retry those uploads (they need no mic) so they drain once we're back
          // online. Without this, a run that's BOTH offline AND disconnected
          // silently discards the prepared-but-unsent recordings.
          if (result.offline && (result.offlinePending?.length ?? 0) > 0) {
            seedSummaryFromUploaded();
            offlinePendingRef.current = result.offlinePending;
            heldHardErrorsRef.current = realErrors; // surface after the drain
            startOfflineRetry();
          }
          setErrorInfo({ kind: 'disconnect', message: 'Lost connection to your mic mid-import.' });
          setPhase('error');
          return;
        }

        // Network dropped mid-upload — everything's already copied + transcoded
        // and held on disk. Show the offline screen and auto-retry the upload
        // (no re-prepare) until the connection returns.
        if (result.offline && (result.offlinePending?.length ?? 0) > 0) {
          seedSummaryFromUploaded();
          offlinePendingRef.current = result.offlinePending;
          heldHardErrorsRef.current = realErrors; // surface after the drain
          setStageLabel(null);
          setErrorInfo({ kind: 'offline', message: 'Waiting for a connection to finish uploading.' });
          setPhase('error');
          startOfflineRetry();
          return;
        }

        // Surface a hard (non-network) per-item failure even when OTHER items
        // uploaded fine. Gating this on !didSomething hid a stuck class behind a
        // green "done" whenever at least one sibling succeeded — the coach would
        // never know class B failed and it stays pending forever. Only REAL
        // class failures escalate (a best-effort orphan failure doesn't).
        if (realErrors.length > 0) {
          const message = realErrors[0]?.error ?? 'Sync failed';
          setErrorInfo({ kind: classifySyncError(message), message });
          setPhase('error');
          return;
        }

        // Success summary — files, total runtime, total bytes. executeAutoSync
        // returns EVERY attempted pair/orphan (failures are caught per-item and
        // pushed to errors[]), so sum runtime/bytes over only the succeeded
        // subset — otherwise the grid shows "3 FILES" next to a runtime/size
        // computed across 5 attempted recordings.
        const failedIds = new Set((result.errors ?? []).map((e) => e.classId));
        const okPairs = (result.pairs ?? []).filter((p) => !failedIds.has(p.classId));
        const okOrphans = (result.unmatchedSessions ?? []).filter(
          (sn) => !failedIds.has(`unmatched:${sn.index}`),
        );
        const pairBytes = okPairs.reduce(
          (n, p) => n + p.parts.reduce((a, x) => a + (x.sizeBytes || 0), 0),
          0,
        );
        const orphanBytes = okOrphans.reduce(
          (n, sn) => n + sn.parts.reduce((a, x) => a + (x.sizeBytes || 0), 0),
          0,
        );
        const pairRuntime = okPairs.reduce((n, p) => n + (p.actualDurationSec || 0), 0);
        const orphanRuntime = okOrphans.reduce((n, sn) => n + (sn.durationSec || 0), 0);
        setProgressPct(100);
        setEtaSec(null);
        setStageLabel(null);
        setImported(importedCount);
        setPendingReview(pendingReviewCount);
        setUnmatched(unmatchedCount);
        setSummary({
          files: importedCount + unmatchedCount,
          runtimeSec: pairRuntime + orphanRuntime,
          sizeBytes: pairBytes + orphanBytes,
        });
        // A foreground run is one the coach opened the flow for — its 'done' stays
        // sticky until acknowledged. A silent background run leaves it non-sticky
        // so a newly-arrived file can still supersede it (silent auto-sync).
        stickyDoneRef.current = foreground;
        setPhase('done');
        refreshPending();
      } catch (err) {
        const message = err?.message ?? String(err);
        setErrorInfo({ kind: classifySyncError(message), message });
        setPhase('error');
      } finally {
        stopCreep();
        syncRunningRef.current = false;
      }
    },
    [userId, refreshPending, startOfflineRetry],
  );

  // Resolve the flow to a calm "Up to date" Complete screen (files: 0). Used
  // when the coach explicitly asked to sync, the mic reads fine, but there's
  // nothing new to import — a positive verdict, NOT an error (nothing's wrong).
  const resolveUpToDate = useCallback(() => {
    setErrorInfo(null);
    setStageLabel(null);
    setEtaSec(null);
    setProgressPct(100);
    setImported(0);
    setUnmatched(0);
    setPendingReview(0);
    setSummary({ files: 0, runtimeSec: 0, sizeBytes: 0 });
    // Always coach-initiated (mic-connected / grant / retry) → sticky until ack.
    stickyDoneRef.current = true;
    setPhase('done');
  }, []);

  // ─── Decide if there's work, then run ─────────────────────────────────
  // foreground=true also vacuums unmatched recordings (the "Sync files" flow);
  // foreground=false imports matched pairs only (the silent background path).
  // explicit=true means the coach just took an action expecting a verdict
  // (tapped "Mic is connected", granted access, or hit retry) — so "no work"
  // resolves to "Up to date" instead of quietly dead-ending on the spinner.
  const attemptSync = useCallback(
    async (foreground, { explicit = false } = {}) => {
      if (syncRunningRef.current || !userId) return;
      // Never start a fresh plan/execute while prepared items are held offline:
      // the 8s retry timer owns them, and a new runExecute would reset
      // summaryAccumRef and ignore the hold, racing (and mis-counting) the drain.
      // The poll already bails on this; this guards the manual entry points too.
      if (offlinePendingRef.current.length > 0) return;
      let plan;
      let orphanCount = 0;
      try {
        const pending = await fetchPendingUploads(userId);
        plan = await planAutoSync(userId, pending);
        if (foreground && (plan.pairs?.length ?? 0) === 0) {
          try {
            orphanCount = (await scanUnmatchedSessions(userId)).length;
          } catch {
            orphanCount = 0;
          }
        }
      } catch {
        // Mic not mounted / bookmark stale — treat as "no work" and keep
        // whatever phase we're in (waiting stays waiting). Note: an EXPLICIT
        // attempt never falsely reports "Up to date" here — a read failure
        // returns before the !hasWork branch below.
        return;
      }

      const hasWork = (plan.pairs?.length ?? 0) > 0 || (foreground && orphanCount > 0);
      if (!hasWork) {
        if (foreground && explicit) {
          // Coach-initiated and the mic reads fine but there's nothing to do →
          // show "Up to date" rather than spinning on Connect forever.
          resolveUpToDate();
        } else if (
          !foreground &&
          phaseRef.current !== 'idle' &&
          phaseRef.current !== 'done' &&
          phaseRef.current !== 'error'
        ) {
          // Silent background path with nothing to do falls back to idle. The
          // ambient foreground poll (foreground && !explicit) intentionally does
          // nothing here — the Connect screen keeps waiting for files to appear.
          setPhase('idle');
        }
        return;
      }
      runExecute(plan, foreground);
    },
    [userId, runExecute, resolveUpToDate],
  );

  // A bookmark whose bytes exist (native hasFolder() === true) but which no
  // longer resolves is stale/invalid — e.g. carried over from a previous
  // install, or invalidated by iOS after an OS/app update. listFiles() rejects
  // E_NO_FOLDER in that case. Drop the dead bookmark so the app stops trusting
  // it; if the coach is mid-flow, surface an actionable "re-grant access" error
  // instead of spinning forever.
  // Only invoked from the Connect screen (phase 'waiting') — see peekMaxIndex.
  // We deliberately DON'T clear the bookmark or flip hasFolderAccess in the
  // background: that would hide the tappable pill before the coach can act and
  // leave them in a dead gap (setup banner lags a foreground). Instead we keep
  // the pill visible and only surface the actionable "re-grant access" error
  // once they engage; a successful re-pick overwrites the dead bookmark.
  const handleBrokenBookmark = useCallback(() => {
    baselineEstablishedRef.current = false;
    lastSeenMaxIdxRef.current = -1;
    setErrorInfo({
      kind: 'no-access',
      message: 'Lost access to your mic folder — grant it again to keep importing.',
    });
    setPhase('error');
  }, []);

  // "Mic is connected" button (Connect screen): the coach confirms the mic is
  // plugged. Read it — if we can (DJI files present) → sync; if not → the
  // bookmark is missing/wrong → go to the grant-access screen.
  const micConnectedCheck = useCallback(async () => {
    // If prepared uploads are still held offline, "Mic is connected" means "try
    // the upload now" — resume the drain rather than starting a fresh mic scan
    // (which would race the retry timer and could hide the pending hold behind an
    // "Up to date"). This also keeps the offline/retry state honest.
    if (offlinePendingRef.current.length > 0) {
      // If a retry is already draining, just acknowledge the tap (the in-flight
      // upload resolves the phase); otherwise kick off a fresh manual attempt.
      if (syncRunningRef.current) showReconnecting();
      else runUpload(offlinePendingRef.current, { manual: true });
      return;
    }
    if (!DjiFiles.hasFolder?.()) {
      handleBrokenBookmark();
      return;
    }
    let entries;
    try {
      entries = await DjiFiles.listFiles();
    } catch {
      // Bookmark present but the folder won't enumerate — genuinely lost access
      // (stale/invalidated bookmark). Send the coach to re-grant.
      handleBrokenBookmark();
      return;
    }
    const anyDji = entries.some((e) => parseDjiFileName(e.name));
    if (!anyDji) {
      // The granted folder reads fine but holds NO DJI recordings — almost always
      // the WRONG folder was picked (a real mic's NO NAME root always carries
      // DJI_* files). Route to the grant-access recovery so the coach can re-pick
      // the right folder, instead of dead-ending on "Up to date". This is the
      // whole point of the "Mic is connected" button: verify + recover access.
      // (We give an accurate message rather than the alarming generic "Lost
      // access" — the folder isn't broken, it's just the wrong one.)
      baselineEstablishedRef.current = false;
      lastSeenMaxIdxRef.current = -1;
      setErrorInfo({
        kind: 'no-access',
        message:
          'No DJI recordings in the connected folder. Grant access to NO NAME at the root of your mic — not a sub-folder.',
      });
      setPhase('error');
      return;
    }
    // Mic readable + DJI files present — run a foreground sync. If it turns out
    // there's nothing new to import, `explicit` resolves it to "Up to date"
    // instead of dead-ending back on the Connect spinner.
    attemptSync(true, { explicit: true });
  }, [attemptSync, handleBrokenBookmark, runUpload, showReconnecting]);

  // "Grant access" button (no-access screen) → show the guided instructions
  // (Browse → NO NAME → Open) before firing the picker.
  const openGrantInstructions = useCallback(() => {
    setErrorInfo(null);
    setPhase('granting');
  }, []);

  // "Open Files" (instructions screen): fire the iOS picker, then VERIFY the
  // chosen folder actually holds DJI recordings — so picking the wrong folder
  // doesn't store a dead bookmark that silently reads nothing.
  const pickFolderFromInstructions = useCallback(async () => {
    try {
      const name = await DjiFiles.pickFolder?.();
      if (!name) return; // cancelled — stay on the instructions

      // Accept the freshly-granted folder: remember it, reset the poll baseline,
      // and start a foreground attempt (explicit → resolves to "Up to date" if
      // there's nothing to import rather than dead-ending on Connect).
      const acceptGrant = ({ explicit }) => {
        setHasFolderAccess(true);
        baselineEstablishedRef.current = false;
        lastSeenMaxIdxRef.current = -1;
        setErrorInfo(null);
        setPhase('waiting');
        attemptSync(true, { explicit });
      };

      // Verify the pick actually holds DJI recordings. A CLEAN enumeration with
      // no DJI files means the coach picked the WRONG folder (a real mic always
      // carries DJI_* files), so we clear it and guide them. But listFiles() can
      // THROW a transient error right after granting (the USB volume is still
      // mounting), so retry a few times before deciding — a single blip must
      // neither nuke a valid grant (bug #7) NOR wave a wrong folder through.
      let entries = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          entries = await DjiFiles.listFiles();
          break;
        } catch {
          entries = null;
          if (attempt < 2) await new Promise((r) => setTimeout(r, 400));
        }
      }

      if (entries === null) {
        // Still unreadable after retries — probably a slow-mounting volume, not
        // a wrong pick. Keep the freshly-granted bookmark (don't nuke it) and
        // drop to Connect; the poll re-verifies once it's readable. Crucially
        // NOT explicit: an UNVERIFIED folder must never short-circuit to a
        // positive "Up to date" verdict, which would hide a wrong-folder pick.
        acceptGrant({ explicit: false });
        return;
      }

      const anyDji = entries.some((e) => parseDjiFileName(e.name));
      if (!anyDji) {
        try { DjiFiles.clearFolder?.(); } catch {}
        setHasFolderAccess(false);
        setErrorInfo({
          kind: 'no-access',
          message: "That folder has no DJI recordings. Pick NO NAME at the root of your mic — not a sub-folder.",
        });
        setPhase('error');
        return;
      }
      // Verified: the folder holds DJI recordings → accept + sync (explicit so a
      // fully-already-imported mic resolves to "Up to date", not a dead spinner).
      acceptGrant({ explicit: true });
    } catch (e) {
      setErrorInfo({ kind: 'no-access', message: e?.message ?? 'Could not access that folder.' });
      setPhase('error');
    }
  }, [attemptSync]);

  // ─── Poll loop (silent detection + waiting-screen detection) ───────────
  useEffect(() => {
    if (!enabled || !userId) {
      setPhase('idle');
      lastSeenMaxIdxRef.current = -1;
      baselineEstablishedRef.current = false;
      return;
    }
    let mounted = true;
    let intervalId = null;

    async function peekMaxIndex() {
      if (!DjiFiles.hasFolder?.()) return null;
      try {
        const entries = await DjiFiles.listFiles();
        let maxIdx = -1;
        for (const entry of entries) {
          const meta = parseDjiFileName(entry.name);
          if (meta && meta.index > maxIdx) maxIdx = meta.index;
        }
        return maxIdx;
      } catch {
        // Folder not readable (no/stale bookmark, or mic simply not mounted yet).
        // We do NOT auto-escalate to "grant access" — the coach might just be
        // slow to plug the mic in. The "Mic is connected" button on the Connect
        // screen is the manual trigger that decides sync vs. re-granting access.
        return null;
      }
    }

    async function tick() {
      if (!mounted) return;
      if (AppState.currentState !== 'active') return;
      if (syncRunningRef.current) return;
      // Don't start a fresh mic sync while we're holding prepared-but-unsent
      // files offline — the retry timer owns those, and a new run would clobber
      // offlinePendingRef.
      if (offlinePendingRef.current.length > 0) return;
      const p = phaseRef.current;
      // The 2s poll must never clobber a screen the coach is looking at or
      // acting on: an in-flight import ('syncing') or the guided grant-access
      // instructions ('granting').
      if (p === 'syncing' || p === 'granting') return;
      // A sticky 'error' is frozen too — but ONLY offline/no-access errors are
      // genuinely stuck: offline is owned by the retry timer, and no-access
      // needs the user to re-grant folder access (a new file can't fix either).
      // A generic/disconnect error must NOT permanently halt the silent auto-
      // import: if new files arrive later we clear it and import them (handled
      // below, after we peek maxIdx). Without this, one transient failure stops
      // background auto-sync forever.
      if (p === 'error' && (errorInfoRef.current?.kind === 'offline' || errorInfoRef.current?.kind === 'no-access')) return;
      // 'done' is frozen while its Complete screen is on-screen (flowOpen), AND
      // whenever it's a coach-facing 'done' (a foreground sync they opened the
      // flow for, an explicit "up to date", or a drained offline hold) — that one
      // stays sticky until acknowledged, even after RUN IN BACKGROUND. A PURELY
      // SILENT background 'done' (stickyDoneRef false) is NOT frozen, so a newly-
      // arrived file can still auto-import (the silent auto-sync promise).
      if (p === 'done' && (flowOpenRef.current || stickyDoneRef.current)) return;

      const maxIdx = await peekMaxIndex();
      if (maxIdx === null) return; // no folder / mic not mounted

      // Recoverable sticky error (generic/disconnect): only a newly-arrived file
      // can supersede it, and only silently in the background (if the coach has
      // the error screen open, respect it and let them tap TRY AGAIN). Otherwise
      // the error stays put.
      if (p === 'error') {
        if (maxIdx > lastSeenMaxIdxRef.current && !flowOpenRef.current) {
          lastSeenMaxIdxRef.current = maxIdx;
          setErrorInfo(null);
          setPhase('idle');
          attemptSync(false);
        }
        return;
      }

      if (!baselineEstablishedRef.current) {
        lastSeenMaxIdxRef.current = maxIdx;
        baselineEstablishedRef.current = true;
        // App opened with the mic already plugged: import silently (or as a
        // foreground run if the flow happens to be open).
        attemptSync(flowOpenRef.current);
        return;
      }

      if (p === 'waiting') {
        // Manual flow open, Connect screen showing — try a foreground run on
        // every tick; attemptSync no-ops until there are real candidates.
        lastSeenMaxIdxRef.current = maxIdx;
        attemptSync(true);
        return;
      }

      if (maxIdx > lastSeenMaxIdxRef.current) {
        lastSeenMaxIdxRef.current = maxIdx;
        attemptSync(flowOpenRef.current);
      }
    }

    const onAppState = (s) => {
      if (s === 'active') tick();
    };
    const sub = AppState.addEventListener('change', onAppState);
    tick();
    intervalId = setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      sub.remove();
      if (intervalId) clearInterval(intervalId);
    };
  }, [enabled, userId, attemptSync]);

  // ─── Actions exposed to the pill + modal ──────────────────────────────
  const openFlow = useCallback(() => {
    refreshFolderAccess();
    setFlowOpen(true);
    setPhase((prev) => (prev === 'idle' ? 'waiting' : prev));
  }, [refreshFolderAccess]);

  // "Run in background": hide the modal, keep the sync going.
  const runInBackground = useCallback(() => {
    setFlowOpen(false);
  }, []);

  // Cancel from the Connect screen drops back to idle (→ pill returns to "Sync
  // files"). From the Error screen we DON'T reset: the "! ERROR" pill stays
  // sticky (like the green "done" pill) and re-tapping it reopens the error —
  // it clears only on a successful retry, a fresh sync, or an app restart.
  const cancelFlow = useCallback(() => {
    setFlowOpen(false);
    setPhase((prev) => (prev === 'waiting' || prev === 'granting' ? 'idle' : prev));
  }, []);

  const retry = useCallback(() => {
    // Offline with files already prepared → just re-attempt the upload (no
    // re-copy / re-transcode). Otherwise run a fresh sync from the mic.
    if (offlinePendingRef.current.length > 0) {
      // If a retry is already draining, just acknowledge the tap (the in-flight
      // upload resolves the phase); otherwise kick off a fresh manual attempt.
      if (syncRunningRef.current) showReconnecting();
      else runUpload(offlinePendingRef.current, { manual: true });
      return;
    }
    setErrorInfo(null);
    setProgressPct(0);
    setPhase('waiting');
    // Kick an immediate foreground attempt; the poll loop also keeps trying.
    // explicit → if there's nothing left to import, resolve to "Up to date"
    // instead of dropping the coach back onto an endless Connect spinner.
    attemptSync(true, { explicit: true });
  }, [attemptSync, runUpload, showReconnecting]);

  // Acknowledge the sticky green "done" pill (tap → view → close).
  const acknowledgeDone = useCallback(() => {
    // Never strand prepared-but-unsent uploads on acknowledge. If a hold is
    // somehow still live under this 'done' (shouldn't happen — done normally
    // means the drain finished — but defend against it), keep the hold + its
    // retry alive and reflect the true still-uploading state instead of going
    // idle and silently dropping the m4a.
    if (offlinePendingRef.current.length > 0) {
      setFlowOpen(false);
      setErrorInfo({ kind: 'offline', message: 'Waiting for a connection to finish uploading.' });
      setPhase('error');
      startOfflineRetry();
      return;
    }
    stopOfflineRetry();
    offlinePendingRef.current = [];
    heldHardErrorsRef.current = [];
    summaryAccumRef.current = { files: 0, runtimeSec: 0, sizeBytes: 0 };
    stickyDoneRef.current = false;
    setFlowOpen(false);
    setPhase('idle');
    setSummary(null);
    setProgressPct(0);
    refreshPending();
  }, [refreshPending, stopOfflineRetry, startOfflineRetry]);

  // DEV ONLY: drop the folder bookmark so the "Set up auto-sync" onboarding
  // banner reappears — lets us review the setup wizard without reinstalling.
  // Exposed only when __DEV__; the modal renders its trigger under the same gate.
  const devResetFolder = useCallback(() => {
    try { DjiFiles.clearFolder?.(); } catch {}
    stopOfflineRetry();
    offlinePendingRef.current = [];
    baselineEstablishedRef.current = false;
    lastSeenMaxIdxRef.current = -1;
    setFlowOpen(false);
    setErrorInfo(null);
    setSummary(null);
    setPhase('idle');
    refreshFolderAccess();
    refreshPending();
  }, [refreshFolderAccess, refreshPending, stopOfflineRetry]);

  // ─── Derived pill state ───────────────────────────────────────────────
  const pillState = useMemo(() => {
    if (!enabled) return 'hidden';
    if (phase === 'syncing' || phase === 'waiting') return 'syncing';
    if (phase === 'done') return 'done';
    if (phase === 'error') return 'error';
    if (hasFolderAccess && pendingUploadCount > 0) return 'sync-files';
    return 'hidden';
  }, [enabled, phase, hasFolderAccess, pendingUploadCount]);

  const value = useMemo(
    () => ({
      enabled,
      phase,
      pillState,
      progressPct,
      fileIdx,
      fileTotal,
      fileSizeBytes,
      etaSec,
      stageLabel,
      imported,
      pendingReview,
      unmatched,
      summary,
      errorInfo,
      flowOpen,
      pendingUploadCount,
      hasFolderAccess,
      openFlow,
      runInBackground,
      cancelFlow,
      retry,
      acknowledgeDone,
      micConnectedCheck,
      openGrantInstructions,
      pickFolderFromInstructions,
      devResetFolder,
      refreshFolderAccess,
      refreshPending,
    }),
    [
      enabled,
      phase,
      pillState,
      progressPct,
      fileIdx,
      fileTotal,
      fileSizeBytes,
      etaSec,
      stageLabel,
      imported,
      pendingReview,
      unmatched,
      summary,
      errorInfo,
      flowOpen,
      pendingUploadCount,
      hasFolderAccess,
      openFlow,
      runInBackground,
      cancelFlow,
      retry,
      acknowledgeDone,
      micConnectedCheck,
      openGrantInstructions,
      pickFolderFromInstructions,
      devResetFolder,
      refreshFolderAccess,
      refreshPending,
    ],
  );

  return <DjiSyncContext.Provider value={value}>{children}</DjiSyncContext.Provider>;
}
