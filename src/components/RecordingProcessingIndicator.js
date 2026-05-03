// ─── RecordingProcessingIndicator ──────────────────────────────────────
// A tiny pill that shows next to the dashboard's notification icon when
// a recording is being uploaded / transcribed in the background. Tap to
// open a popup with details and per-recording status.
//
// Data sources:
//   - Local upload queue (recordingQueue): live counts of pending /
//     uploading chunks per recording.
//   - Supabase: class_recordings rows with non-terminal status (polled
//     every 10 seconds while the screen is visible). This catches the
//     "chunks uploaded, server is transcribing" phase that has no local
//     state.

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../theme';
import { supabase } from '../services/supabase/client';
import {
  subscribeToRecordingQueue,
  getRecordingQueue,
} from '../storage/recordingQueue';

const POLL_INTERVAL_MS = 10_000;

export default function RecordingProcessingIndicator() {
  const [serverRows, setServerRows] = useState([]);   // rows from Supabase
  const [queue, setQueue] = useState(getRecordingQueue());
  const [modalOpen, setModalOpen] = useState(false);

  // Live local queue
  useEffect(() => {
    const unsub = subscribeToRecordingQueue((next) => setQueue([...(next || [])]));
    return unsub;
  }, []);

  // Poll server side every 10 s while mounted
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data, error } = await supabase
          .from('class_recordings')
          .select('id, status, started_at, lesson_type, expected_chunks')
          .eq('user_id', user.id)
          .in('status', ['recording', 'ready', 'transcribing'])
          .order('started_at', { ascending: false });
        if (!cancelled && !error) setServerRows(data || []);
      } catch {
        // swallow — next poll will retry
      }
    }
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Aggregate the visible state. We hide the indicator entirely when
  // there's nothing in flight on either side.
  const queueCounts = queue.reduce((acc, e) => {
    acc[e.recordingId] = acc[e.recordingId] || { pending: 0, uploading: 0, failed: 0 };
    if (e.status === 'uploading') acc[e.recordingId].uploading += 1;
    else if (e.status === 'failed') acc[e.recordingId].failed += 1;
    else acc[e.recordingId].pending += 1;
    return acc;
  }, {});

  // Combine: any server row in non-terminal status, or any local queue entry,
  // means we should be visible.
  const inFlight = serverRows.filter((r) => r.status !== 'recording'); // 'recording' is shown via the existing class indicator

  if (inFlight.length === 0 && Object.keys(queueCounts).length === 0) return null;

  return (
    <>
      <Pressable
        onPress={() => setModalOpen(true)}
        style={({ pressed }) => [styles.pill, pressed && { opacity: 0.7 }]}
        hitSlop={8}
      >
        <ActivityIndicator size="small" color={Colors.text} />
      </Pressable>

      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setModalOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setModalOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={styles.title}>Cours en traitement</Text>
              <Pressable onPress={() => setModalOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={Colors.text} />
              </Pressable>
            </View>
            <Text style={styles.subtitle}>
              Tu peux fermer l'app — le serveur termine en arrière-plan et tu recevras une notif quand c'est prêt.
            </Text>

            {inFlight.length === 0 && Object.keys(queueCounts).length === 0 && (
              <Text style={styles.empty}>Tout est synchronisé.</Text>
            )}

            {inFlight.map((r) => {
              const q = queueCounts[r.id];
              return (
                <View key={r.id} style={styles.row}>
                  <ActivityIndicator size="small" color={Colors.text} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.rowTitle}>
                      {r.lesson_type === 'private' ? 'Cours privé' : 'Cours de groupe'}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {labelForStatus(r.status, q, r.expected_chunks)}
                    </Text>
                  </View>
                </View>
              );
            })}

            {/* Local-only entries (queue not yet matched to a server row) */}
            {Object.keys(queueCounts)
              .filter((rid) => !inFlight.some((r) => r.id === rid))
              .map((rid) => {
                const q = queueCounts[rid];
                return (
                  <View key={`q-${rid}`} style={styles.row}>
                    <ActivityIndicator size="small" color={Colors.text} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.rowTitle}>Upload en cours</Text>
                      <Text style={styles.rowMeta}>
                        {q.uploading > 0 && `${q.uploading} en envoi · `}
                        {q.pending > 0 && `${q.pending} en attente · `}
                        {q.failed > 0 && `${q.failed} erreur(s) (retry auto)`}
                      </Text>
                    </View>
                  </View>
                );
              })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function labelForStatus(status, q, expected) {
  const localPending = q ? q.pending + q.uploading : 0;
  if (status === 'ready') {
    if (localPending > 0) return `Envoi des derniers segments (${localPending}/${expected ?? '?'})`;
    return 'Préparation pour transcription';
  }
  if (status === 'transcribing') return 'Transcription en cours (5-15 min)';
  return status;
}

const styles = StyleSheet.create({
  pill: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  title: {
    fontFamily: Fonts.semibold,
    fontSize: 18,
    color: Colors.text,
  },
  subtitle: {
    fontFamily: Fonts.regular,
    fontSize: 13,
    color: '#6b6b6b',
    marginBottom: 14,
  },
  empty: {
    fontFamily: Fonts.regular,
    fontSize: 14,
    color: '#9b9b9b',
    paddingVertical: 12,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  rowTitle: {
    fontFamily: Fonts.medium,
    fontSize: 14,
    color: Colors.text,
  },
  rowMeta: {
    fontFamily: Fonts.regular,
    fontSize: 12,
    color: '#7a7a7a',
    marginTop: 2,
  },
});
