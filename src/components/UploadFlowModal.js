// ──────────────────────────────────────────────────────────────────────
// UploadFlowModal — guided plug-in + auto-sync experience.
//
// Opens when the coach taps the big UPLOAD button on the dashboard (Phase
// 2 — folder bookmark already granted). Walks through three states:
//
//   waiting   — "Plug your DJI mic via USB-C", polls listFiles() every
//               1.5s for fresh DJI files
//   syncing   — "Connected — Importing N of M…", running the same
//               runAutoSync the polling hook uses in the background
//   done      — "N recordings synced (X for review)" with checkmark,
//               auto-closes after a short delay
//   error     — "Sync failed: <reason>" with a Retry button
//
// The modal also handles the case where the mic is already plugged in
// when the coach taps UPLOAD — it skips `waiting` entirely and jumps
// straight to syncing.
// ──────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, Spacing } from '../theme';
import { parseDjiFileName } from '../services/localRecordingMatcher';
import {
  fetchPendingUploads,
  planAutoSync,
  executeAutoSync,
} from '../services/localRecordingAutoSync';
import * as DjiFiles from 'local-recording-files';

const INK_950 = '#0A0A0A';
const POLL_INTERVAL_MS = 1500;
const DONE_AUTO_CLOSE_MS = 3500;

export default function UploadFlowModal({
  visible,
  userId,
  onClose,
  onDone,
}) {
  // 'waiting' | 'syncing' | 'done' | 'error'
  const [phase, setPhase] = useState('waiting');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [total, setTotal] = useState(0);
  const [imported, setImported] = useState(0);
  const [pendingReview, setPendingReview] = useState(0);
  const [errorMessage, setErrorMessage] = useState(null);

  const syncRunningRef = useRef(false);
  const cancelledRef = useRef(false);
  const closeTimerRef = useRef(null);

  // Reset everything when the modal opens (re-uses same component if
  // re-shown after close).
  useEffect(() => {
    if (!visible) return;
    cancelledRef.current = false;
    syncRunningRef.current = false;
    setPhase('waiting');
    setCurrentIdx(0);
    setTotal(0);
    setImported(0);
    setPendingReview(0);
    setErrorMessage(null);

    return () => {
      cancelledRef.current = true;
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [visible]);

  // Active polling for mic detection while in `waiting` phase. Triggers
  // sync as soon as new DJI files are visible in the bookmarked folder.
  useEffect(() => {
    if (!visible) return;
    if (phase !== 'waiting') return;
    if (!userId) return;

    let intervalId = null;

    async function checkForMic() {
      if (cancelledRef.current) return;
      if (syncRunningRef.current) return;
      if (!DjiFiles.hasFolder?.()) return;
      try {
        const entries = await DjiFiles.listFiles();
        if (cancelledRef.current) return;
        // Quick heuristic: any DJI-pattern file present? If yes, kick
        // off the sync — planAutoSync internally filters to files
        // newer than maxImportedIdx so already-imported files don't
        // re-trigger.
        const anyDji = entries.some((e) => parseDjiFileName(e.name));
        if (!anyDji) return;
        // Make sure there are new candidates before transitioning so
        // we don't flash "Connected" for a mic with no new files.
        const pending = await fetchPendingUploads(userId);
        if (cancelledRef.current) return;
        const plan = await planAutoSync(userId, pending);
        if (cancelledRef.current) return;
        if (plan.pairs.length === 0) {
          // TEMP DEBUG: surface why nothing matched so we can diagnose
          // what's actually on the mic vs. what's expected.
          try {
            const lines = entries.map((e) => {
              const meta = parseDjiFileName(e.name);
              const sz = e.sizeBytes || 0;
              const dur = Math.max(0, Math.round((sz - 44) / 144000));
              return meta
                ? `${e.name} | idx=${meta.index} | dur~${dur}s | date=${meta.timestamp.toISOString().slice(0,10)}`
                : `${e.name} (not DJI)`;
            }).join('\n');
            const pendingLines = pending.map((p) =>
              `${p.studentName ?? p.lessonType ?? 'class'} | ${p.durationSec}s | ${p.startedAt.toISOString().slice(0,10)}`
            ).join('\n') || '(no pending)';
            Alert.alert(
              'DEBUG: Why no pairs?',
              `Files on mic (${entries.length}):\n${lines}\n\nPending classes (${pending.length}):\n${pendingLines}`,
            );
          } catch {}
          setImported(0);
          setTotal(0);
          setPendingReview(0);
          setPhase('done');
          return;
        }
        runSyncFromPlan(plan);
      } catch {
        /* mic not mounted yet, keep polling silently */
      }
    }

    // Fire once immediately + then on interval.
    checkForMic();
    intervalId = setInterval(checkForMic, POLL_INTERVAL_MS);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [visible, phase, userId]);

  // Auto-close after the `done` state has been visible long enough.
  useEffect(() => {
    if (phase !== 'done') return;
    closeTimerRef.current = setTimeout(() => {
      if (onDone) onDone();
      else onClose?.();
    }, DONE_AUTO_CLOSE_MS);
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [phase, onClose, onDone]);

  async function runSyncFromPlan(plan) {
    if (syncRunningRef.current) return;
    syncRunningRef.current = true;
    setPhase('syncing');
    setTotal(plan.pairs.length);
    setCurrentIdx(0);

    try {
      const result = await executeAutoSync(userId, plan, {
        onPairStart: (_pair, idx, t) => {
          if (cancelledRef.current) return;
          setCurrentIdx(idx + 1);
          setTotal(t);
        },
      });
      if (cancelledRef.current) return;

      const pendingReviewCount = result.pairs.filter(
        (p) => p.adminReviewStatus === 'pending',
      ).length;

      if (result.errors.length > 0 && result.importedCount === 0) {
        setErrorMessage(result.errors[0]?.error ?? 'Sync failed');
        setPhase('error');
      } else {
        setImported(result.importedCount);
        setPendingReview(pendingReviewCount);
        setTotal(result.pairs.length);
        setPhase('done');
      }
    } catch (err) {
      if (cancelledRef.current) return;
      setErrorMessage(err?.message ?? String(err));
      setPhase('error');
    } finally {
      syncRunningRef.current = false;
    }
  }

  async function handleRetry() {
    if (!userId) return;
    setErrorMessage(null);
    setPhase('waiting');
    setCurrentIdx(0);
    setImported(0);
    syncRunningRef.current = false;
  }

  function handleDismiss() {
    // Only allow dismiss outside of syncing (avoid leaving a sync run
    // orphaned mid-upload — though the upload itself would continue
    // since attachFileToClass awaits its own Storage call).
    if (phase === 'syncing') return;
    if (onClose) onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleDismiss}
    >
      <Pressable style={s.overlay} onPress={handleDismiss}>
        <Pressable style={s.card} onPress={(e) => e.stopPropagation()}>
          {phase === 'waiting' && <PhaseWaiting onCancel={onClose} />}
          {phase === 'syncing' && (
            <PhaseSyncing currentIdx={currentIdx} total={total} />
          )}
          {phase === 'done' && (
            <PhaseDone
              imported={imported}
              pendingReview={pendingReview}
              total={total}
              onClose={onDone ?? onClose}
            />
          )}
          {phase === 'error' && (
            <PhaseError
              message={errorMessage}
              onRetry={handleRetry}
              onClose={onClose}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Phase sub-views ────────────────────────────────────────────────────

function PhaseWaiting({ onCancel }) {
  return (
    <>
      <View style={[s.iconRing, s.iconRingNeutral]}>
        <Ionicons name="hardware-chip-outline" size={28} color={INK_950} />
      </View>
      <Text style={s.title}>Plug in your DJI mic</Text>
      <Text style={s.body}>
        Connect the mic to your iPhone via USB-C. We'll detect it
        automatically and start importing your recordings.
      </Text>
      <View style={s.spinnerRow}>
        <ActivityIndicator size="small" color={INK_950} />
        <Text style={s.spinnerText}>Waiting for mic…</Text>
      </View>
      <TouchableOpacity style={s.btnGhost} activeOpacity={0.85} onPress={onCancel}>
        <Text style={s.btnGhostText}>Cancel</Text>
      </TouchableOpacity>
    </>
  );
}

function PhaseSyncing({ currentIdx, total }) {
  const label = total > 0 ? `Importing ${currentIdx} of ${total}…` : 'Importing…';
  return (
    <>
      <View style={[s.iconRing, s.iconRingSuccess]}>
        <Ionicons name="checkmark" size={32} color="#2D8A4A" />
      </View>
      <Text style={s.title}>Connected</Text>
      <Text style={s.body}>{label}</Text>
      <View style={s.spinnerRow}>
        <ActivityIndicator size="small" color={INK_950} />
        <Text style={s.spinnerText}>Syncing…</Text>
      </View>
      <Text style={s.footnote}>
        Keep the mic plugged in until this finishes.
      </Text>
    </>
  );
}

function PhaseDone({ imported, pendingReview, total, onClose }) {
  const importedLabel = imported === 0
    ? 'Nothing new to sync'
    : imported === 1
      ? '1 recording synced'
      : `${imported} recordings synced`;
  const reviewLabel = pendingReview > 0
    ? `${pendingReview} flagged for admin review`
    : 'All auto-approved';
  const showReview = imported > 0;
  return (
    <>
      <View style={[s.iconRing, s.iconRingSuccess]}>
        <Ionicons name="checkmark-circle" size={36} color="#2D8A4A" />
      </View>
      <Text style={s.title}>{importedLabel}</Text>
      {showReview && <Text style={s.body}>{reviewLabel}</Text>}
      {!showReview && imported === 0 && (
        <Text style={s.body}>
          Looks like everything's already imported, or your mic doesn't
          have new files yet.
        </Text>
      )}
      <TouchableOpacity style={s.btnPrimary} activeOpacity={0.88} onPress={onClose}>
        <Text style={s.btnPrimaryText}>Done</Text>
      </TouchableOpacity>
    </>
  );
}

function PhaseError({ message, onRetry, onClose }) {
  return (
    <>
      <View style={[s.iconRing, s.iconRingError]}>
        <Ionicons name="alert-circle" size={32} color="#B33A3A" />
      </View>
      <Text style={s.title}>Sync failed</Text>
      <Text style={s.body}>{message ?? 'Unknown error.'}</Text>
      <View style={s.actionRow}>
        <TouchableOpacity style={s.btnGhost} activeOpacity={0.85} onPress={onClose}>
          <Text style={s.btnGhostText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.btnPrimary} activeOpacity={0.88} onPress={onRetry}>
          <Text style={s.btnPrimaryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(13, 13, 18, 0.62)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingVertical: 26,
    paddingHorizontal: 22,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 14,
  },
  iconRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconRingNeutral: { backgroundColor: 'rgba(13, 13, 18, 0.07)' },
  iconRingSuccess: { backgroundColor: 'rgba(45, 138, 74, 0.13)' },
  iconRingError: { backgroundColor: 'rgba(179, 58, 58, 0.12)' },
  title: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 19,
    color: INK_950,
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  body: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13.5,
    color: '#6B6B6B',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 16,
    paddingHorizontal: 6,
  },
  spinnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 18,
  },
  spinnerText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12.5,
    color: '#6B6B6B',
  },
  footnote: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11.5,
    color: '#888',
    textAlign: 'center',
    lineHeight: 16,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  btnGhost: {
    flex: 1,
    backgroundColor: '#F2F2F4',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhostText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#818898',
    letterSpacing: 0.2,
  },
  btnPrimary: {
    flex: 1.4,
    backgroundColor: INK_950,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
});
