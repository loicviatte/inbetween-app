// ──────────────────────────────────────────────────────────────────────────
// LocalUploadScreen — DJI mic file import for local-recording-mode classes.
//
// Workflow:
//   1. Lists the coach's pending uploads (local_recording_mode = true,
//      ended_at IS NOT NULL, mic_file_name IS NULL). These are classes
//      where the coach has started/stopped the class in-app but hasn't yet
//      attached a WAV file from their DJI mic.
//   2. Coach taps "Pick file" → iOS Files picker opens, coach picks a .WAV
//      from "NO NAME" → "DJI_Audio_001/".
//   3. App parses the filename (DJI_NN_YYYYMMDD_HHMMSS.WAV) and reads
//      duration/size metadata.
//   4. The matcher scores file vs pending classes (chronological + duration).
//   5. Coach confirms the suggested match → app uploads the WAV to Supabase
//      Storage at {user_id}/{recording_id}/0.wav, inserts a
//      class_recording_chunks row, updates class_recordings with mic_file_*
//      + status='ready' + expected_chunks=1, and calls finalize-class.
//   6. Existing AssemblyAI pipeline takes over from there.
//
// This screen is the MVP scaffold — UI is intentionally minimal so we can
// validate the data flow end-to-end before polishing. Once we have an
// admin review screen on top (focus points held back until approved),
// this becomes the regular post-class workflow for the test coach.
// ──────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import { Colors as C, Fonts, Spacing } from '../../theme';
import { supabase } from '../../services/supabase/client';
import {
  parseDjiFileName,
  matchFilesToClasses,
} from '../../services/localRecordingMatcher';
import {
  fetchPendingUploads,
  planAutoSync,
  executeAutoSync,
  attachFileToClass,
} from '../../services/localRecordingAutoSync';
import * as DjiFiles from 'local-recording-files';

// ─── Helpers ─────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
    ' ' + date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(seconds) {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

// ─── File picker + parsing ───────────────────────────────────────────────

async function pickAudioFile() {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'audio/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset) return null;
  return {
    uri: asset.uri,
    name: asset.name,
    size: asset.size ?? 0,
    mimeType: asset.mimeType ?? 'audio/wav',
  };
}

// Approximate WAV duration from file size (works only for known sample
// rates + bit depths). For DJI Mic 1/2: 48 kHz, 24-bit, mono = 144000
// bytes/sec. We use this as a fallback — for the MVP, asking the audio
// engine for the actual duration via expo-audio would be more accurate.
function approximateWavDurationSec(sizeBytes) {
  const BYTES_PER_SEC = 144000;
  return Math.max(0, Math.round((sizeBytes - 44) / BYTES_PER_SEC));
}

// ─── Screen ──────────────────────────────────────────────────────────────

export default function LocalUploadScreen({ navigation }) {
  const [userId, setUserId] = useState(null);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setPending([]);
        return;
      }
      setUserId(user.id);
      const rows = await fetchPendingUploads(user.id);
      setPending(rows);
    } catch (err) {
      console.warn('[LocalUpload] reload failed:', err);
      Alert.alert('Error', err?.message ?? 'Failed to load pending uploads.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // ─── Auto-sync via the native folder picker ───────────────────────────
  // Preferred path: if the native module is built into this binary AND
  // the coach has already granted folder access (first-plug onboarding),
  // we enumerate files programmatically — no Files-app navigation, no
  // per-class picking. The button on the screen becomes a one-tap sync.
  //
  // First-time flow: hasFolder() is false → we call pickFolder() which
  // presents the iOS folder picker. Coach navigates to NO NAME →
  // DJI_Audio_001 → taps Open → iOS grants InBetween a security-scoped
  // bookmark. From then on, listFiles() works without re-prompting.

  async function handleAutoSync() {
    if (busy) return;
    setBusy(true);
    try {
      // Ensure folder access — first run prompts the picker, subsequent
      // calls reuse the security-scoped bookmark.
      if (!DjiFiles.hasFolder()) {
        const folderName = await DjiFiles.pickFolder();
        if (!folderName) {
          // Coach cancelled.
          setBusy(false);
          return;
        }
      }

      // Plan the sync (no uploads yet) — same logic the auto-detect path
      // on the dashboard uses; this screen just adds a confirmation step
      // so the coach can review before binary lands in Storage.
      const plan = await planAutoSync(userId, pending);

      if (plan.status === 'no_folder') {
        DjiFiles.clearFolder();
        Alert.alert(
          'Pick your DJI folder',
          "Tap sync again — we'll ask you to point InBetween at the DJI_Audio folder on your mic. You only have to do this once.",
        );
        setBusy(false);
        return;
      }
      if (plan.status === 'no_pending_classes') {
        Alert.alert(
          'No pending classes',
          'Start a class in the app first, then come back to sync.',
        );
        setBusy(false);
        return;
      }
      if (plan.pairs.length === 0) {
        Alert.alert(
          'No new recordings',
          `Found ${plan.totalFilesInFolder} audio file(s) in the DJI folder but none match today's pending classes by date / index. Start a class first, or use "Pick a single file" to attach manually.`,
        );
        setBusy(false);
        return;
      }

      // Build summary — surface admin-review status alongside duration
      // so the coach knows which pairs will be auto-trusted vs queued.
      const summary = plan.pairs
        .map((p) => {
          const reviewTag = p.adminReviewStatus === 'pending' ? ' · review' : '';
          return `• ${p.studentName ?? 'class'} (${p.confidence}, ~${fmtDuration(p.actualDurationSec)}${reviewTag})`;
        })
        .join('\n');

      Alert.alert(
        `Import ${plan.pairs.length} recording(s)?`,
        summary,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => setBusy(false),
          },
          {
            text: 'Import',
            onPress: async () => {
              try {
                const result = await executeAutoSync(userId, plan);
                const pendingReview = result.pairs.filter(
                  (p) => p.adminReviewStatus === 'pending',
                ).length;
                const reviewTail = pendingReview > 0
                  ? ` (${pendingReview} flagged for admin review)`
                  : '';
                const importedLabel = result.importedCount === 1
                  ? '1 recording imported'
                  : `${result.importedCount} recordings imported`;
                Alert.alert(
                  'Done',
                  `${importedLabel}${reviewTail}. Transcription continues in the background.`,
                );
                await reload();
              } catch (err) {
                console.warn('[LocalUpload] auto-sync attach failed:', err);
                Alert.alert('Sync failed', err?.message ?? 'Unknown error.');
              } finally {
                setBusy(false);
              }
            },
          },
        ],
      );
    } catch (err) {
      console.warn('[LocalUpload] handleAutoSync failed:', err);
      const msg = err?.message ?? String(err);
      if (msg.includes('E_NO_FOLDER') || msg.includes('No folder access')) {
        DjiFiles.clearFolder();
        Alert.alert(
          'Pick your DJI folder',
          "Tap sync again — we'll ask you to point InBetween at the DJI_Audio folder on your mic. You only have to do this once.",
        );
      } else {
        Alert.alert('Sync error', msg);
      }
      setBusy(false);
    }
  }

  // ─── Fallback: manual file picker ──────────────────────────────────────
  // Used when the native module isn't built into the binary yet (e.g.
  // first build after merging the local-recording feature). Coach has
  // to navigate to the file each time.
  async function handleManualPick() {
    if (busy) return;
    setBusy(true);
    try {
      const file = await pickAudioFile();
      if (!file) {
        setBusy(false);
        return;
      }

      const djiMeta = parseDjiFileName(file.name);
      const durationSec = approximateWavDurationSec(file.size);
      const micFile = {
        fileName: file.name,
        index: djiMeta?.index ?? 0,
        timestamp: djiMeta?.timestamp ?? new Date(),
        durationSec,
        sizeBytes: file.size,
        uri: file.uri,
      };

      const classes = pending.map((p) => ({
        id: p.id,
        startedAt: p.startedAt,
        endedAt: p.endedAt,
        studentName: p.studentName,
      }));

      const session = matchFilesToClasses(classes, [micFile]);

      let matched = null;
      let chosenClass = null;

      if (session.status === 'matched' && session.matches.length === 1) {
        matched = session.matches[0];
        chosenClass = pending.find((p) => p.id === matched.class.id);
      } else if (session.status === 'count_mismatch') {
        const ranked = pending.map((p) => ({
          p,
          deltaMs: Math.abs(+p.startedAt - +micFile.timestamp),
        })).sort((a, b) => a.deltaMs - b.deltaMs);
        if (ranked.length > 0) {
          chosenClass = ranked[0].p;
          const single = matchFilesToClasses(
            [{
              id: chosenClass.id,
              startedAt: chosenClass.startedAt,
              endedAt: chosenClass.endedAt,
              studentName: chosenClass.studentName,
            }],
            [micFile],
          );
          if (single.matches[0]) matched = single.matches[0];
        }
      }

      if (!chosenClass || !matched) {
        Alert.alert(
          'No match',
          'Could not match this file to any pending class.',
        );
        setBusy(false);
        return;
      }

      Alert.alert(
        `Match found (${matched.confidence})`,
        `Class: ${chosenClass.studentName ?? chosenClass.lessonType}\n` +
        `Duration: ${fmtDuration(chosenClass.durationSec)}\n` +
        `File duration: ~${fmtDuration(matched.actualDurationSec)}\n\nUpload?`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setBusy(false) },
          {
            text: 'Upload',
            onPress: async () => {
              try {
                // Manual picks always go through admin review — even
                // when the matcher scores 'high', the coach was already
                // forced into the manual path which implies the auto
                // flow didn't disambiguate cleanly. Be conservative.
                await attachFileToClass({
                  classId: chosenClass.id,
                  userId,
                  file: {
                    uri: file.uri,
                    name: file.name,
                    size: file.size,
                  },
                  matched: {
                    confidence: matched.confidence,
                    actualDurationSec: matched.actualDurationSec,
                  },
                  adminReviewStatus: 'pending',
                });
                Alert.alert('Uploaded', 'Transcription will start shortly.');
                await reload();
              } catch (err) {
                console.warn('[LocalUpload] manual attach failed:', err);
                Alert.alert('Upload failed', err?.message ?? 'Unknown error.');
              } finally {
                setBusy(false);
              }
            },
          },
        ],
      );
    } catch (err) {
      console.warn('[LocalUpload] handleManualPick failed:', err);
      Alert.alert('Error', err?.message ?? 'Failed to start upload.');
      setBusy(false);
    }
  }

  // Use the auto-sync flow when the native module is wired into the
  // binary. The flag is true after a rebuild that includes the
  // local-recording-files pod; in older builds it's false and we fall
  // back to the manual picker so testing isn't blocked on a rebuild.
  const hasAutoSync = typeof DjiFiles.hasFolder === 'function';

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={28} color={C.text} />
        </TouchableOpacity>
        <Text style={s.title}>Upload recordings</Text>
        <TouchableOpacity onPress={reload} style={s.reloadBtn}>
          <Ionicons name="refresh" size={22} color={C.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.content}>
        {loading ? (
          <ActivityIndicator size="large" color={C.orange} style={{ marginTop: 60 }} />
        ) : pending.length === 0 ? (
          <View style={s.emptyWrap}>
            <Ionicons name="mic-off-outline" size={56} color={C.textMuted} />
            <Text style={s.emptyTitle}>No pending uploads</Text>
            <Text style={s.emptyBody}>
              Classes you've ended without audio will appear here. Start a class first, then come back to attach your DJI recording.
            </Text>
          </View>
        ) : (
          <>
            <Text style={s.intro}>
              {pending.length} class{pending.length === 1 ? '' : 'es'} awaiting audio. Plug your DJI mic via USB-C, then tap below to pick the WAV file.
            </Text>

            {pending.map((p) => (
              <View key={p.id} style={s.row}>
                <View style={s.rowMain}>
                  <Text style={s.rowName}>
                    {p.studentName ?? (p.lessonType === 'group' ? 'Group class' : 'Private class')}
                  </Text>
                  <Text style={s.rowMeta}>
                    {fmtDate(p.startedAt)} · {fmtDuration(p.durationSec)}
                  </Text>
                </View>
              </View>
            ))}

            {hasAutoSync ? (
              <TouchableOpacity
                style={[s.uploadBtn, busy && s.uploadBtnDisabled]}
                onPress={handleAutoSync}
                disabled={busy}
                activeOpacity={0.8}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="sync" size={22} color="#fff" />
                    <Text style={s.uploadBtnText}>Sync DJI mic</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[s.uploadBtn, busy && s.uploadBtnDisabled]}
                onPress={handleManualPick}
                disabled={busy}
                activeOpacity={0.8}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="cloud-upload" size={22} color="#fff" />
                    <Text style={s.uploadBtnText}>Pick file & upload</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {/* Manual fallback always available — useful for debugging or
                when the auto-sync flow can't disambiguate. */}
            {hasAutoSync && (
              <TouchableOpacity
                style={s.secondaryBtn}
                onPress={handleManualPick}
                disabled={busy}
                activeOpacity={0.7}
              >
                <Text style={s.secondaryBtnText}>Pick a single file manually</Text>
              </TouchableOpacity>
            )}

            {/* Reset folder access — used when the bookmark goes stale
                (mic reformatted) or when the coach initially picked the
                wrong folder (the device root instead of DJI_Audio_001).
                A re-pick with the more specific folder fixes the
                "couldn't be opened" errors that come from iOS not
                propagating security scope through USB volume parents. */}
            {hasAutoSync && (
              <TouchableOpacity
                style={s.secondaryBtn}
                onPress={() => {
                  DjiFiles.clearFolder();
                  Alert.alert(
                    'Folder access cleared',
                    'Next time you tap Sync, the app will ask you to pick the DJI_Audio folder again. Pick the folder directly (not the device root) for best results.',
                  );
                }}
                disabled={busy}
                activeOpacity={0.7}
              >
                <Text style={s.secondaryBtnText}>Reset folder access</Text>
              </TouchableOpacity>
            )}

            <Text style={s.hint}>
              {hasAutoSync
                ? 'Plug your DJI mic via USB-C, then tap Sync. The first time, iOS will ask you to grant access to the DJI_Audio folder — only needed once.'
                : 'The app will auto-match the file to the closest pending class based on duration and timestamp.'}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.side,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5e5',
  },
  backBtn: { padding: 6 },
  reloadBtn: { padding: 6 },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.ttDemiBold,
    fontSize: 18,
    color: C.black,
  },
  content: { padding: Spacing.side, paddingBottom: 40 },
  emptyWrap: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: Spacing.side,
  },
  emptyTitle: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 18,
    color: C.black,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyBody: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: C.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  intro: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: C.secondary,
    marginBottom: 16,
    lineHeight: 20,
  },
  row: {
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
  },
  rowMain: { flex: 1 },
  rowName: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 16,
    color: C.black,
    marginBottom: 2,
  },
  rowMeta: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: C.secondary,
  },
  uploadBtn: {
    marginTop: 20,
    backgroundColor: C.orange,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  uploadBtnDisabled: { opacity: 0.5 },
  uploadBtnText: {
    color: '#fff',
    fontFamily: Fonts.ttDemiBold,
    fontSize: 16,
    marginLeft: 10,
  },
  secondaryBtn: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: C.secondary,
    textDecorationLine: 'underline',
  },
  hint: {
    marginTop: 16,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: C.secondary,
    textAlign: 'center',
    lineHeight: 18,
  },
});
