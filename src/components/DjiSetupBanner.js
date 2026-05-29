// ─── DjiSetupBanner ─────────────────────────────────────────────────────
// Compact red pill that sits in the header row (next to the notifications
// button and the avatar) when the coach has a class waiting for audio
// AND no folder bookmark exists yet. Tap → guided setup modal that walks
// through the iOS folder-picker flow.
//
// All state is self-contained here so we don't have to wire pendingCount
// / hasFolder up through CoachTabHeader's parent components. We query
// Supabase ourselves with a polite cadence (mount + foreground + after
// pickFolder) — duplicated relative to DashboardScreen's query, but the
// volume is negligible vs the simplicity gain.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  Alert,
  AppState,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fonts } from '../theme';
import { supabase } from '../services/supabase/client';
import { isLocalRecordingMode } from '../services/featureFlags';
import {
  fetchPendingUploads,
  planAutoSync,
} from '../services/localRecordingAutoSync';
import { parseDjiFileName } from '../services/localRecordingMatcher';
import * as DjiFiles from 'local-recording-files';

// Visual aids for the instructions step — exact captures of the iOS
// Files app UI so the coach recognises what to tap. Drop the cropped
// PNGs into /assets/dji-setup/ (any reasonable resolution, 2x for
// retina). If the assets aren't there yet, the screenshots simply
// don't render and the text instructions stand on their own.
const BROWSE_TAB_IMAGE = require('../../assets/dji-setup/browse.png');
const NO_NAME_IMAGE = require('../../assets/dji-setup/no-name.png');

const INK_950 = '#0A0A0A';
const RED = '#D44545';

// Delay between dismissing the RN Modal and presenting the iOS
// UIDocumentPicker — without it, the picker tries to present on top of
// a half-dismissed Modal's view controller, which silently no-ops.
const MODAL_DISMISS_DELAY_MS = 380;

// Step-by-step wizard states. Each step renders its own card; users
// move forward via Next/Done and backward via Back. The `action` step
// is the one that actually fires DjiFiles.pickFolder() — when iOS
// returns control, we transition to `success` (if DJI files found) or
// `error` (if not).
const STEPS = ['intro', 'test', 'plug', 'instructions', 'verifying', 'success', 'error'];

export default function DjiSetupBanner() {
  const [authUser, setAuthUser] = useState(null);
  const [hasFolderAccess, setHasFolderAccess] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState('intro');
  // Count of DJI files we saw on the mic during the verification right
  // after pickFolder — surfaced on the success step so the coach can
  // see we actually confirmed the connection works ("Found 5
  // recordings on your mic").
  const [foundCount, setFoundCount] = useState(0);
  const dismissedRef = useRef(false);

  const isLocalMode = isLocalRecordingMode(authUser);

  // Fetch the current auth user once.
  useEffect(() => {
    supabase.auth.getUser()
      .then(({ data: { user } }) => setAuthUser(user))
      .catch(() => setAuthUser(null));
  }, []);

  // Re-check folder-access flag on mount + every time the app comes
  // back to foreground.
  useEffect(() => {
    const check = () => {
      try { setHasFolderAccess(DjiFiles.hasFolder?.() ?? false); }
      catch { setHasFolderAccess(false); }
    };
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => sub.remove();
  }, []);

  // Pending count — initial fetch + on foreground.
  const refreshPending = useCallback(async () => {
    if (!authUser?.id || !isLocalRecordingMode(authUser)) {
      setPendingCount(0);
      return;
    }
    try {
      const rows = await fetchPendingUploads(authUser.id);
      setPendingCount(rows.length);
    } catch {
      /* keep previous */
    }
  }, [authUser]);
  useEffect(() => {
    refreshPending();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshPending();
    });
    return () => sub.remove();
  }, [refreshPending]);

  // Open the setup wizard at the intro step (the "why" explanation).
  function handleBannerTap() {
    dismissedRef.current = false;
    setStep('intro');
    setModalOpen(true);
  }

  // "Later" / tap-out: just close and remember we dismissed for this
  // session (the banner itself stays visible — they can re-open it
  // any time).
  function dismissModal() {
    dismissedRef.current = true;
    setModalOpen(false);
    // Reset to intro in case they re-open later — fresh start each time.
    setTimeout(() => setStep('intro'), 250);
  }

  // Action step: fire the iOS folder picker. The RN Modal stays open
  // (the iOS picker presents on top of it via the standard nested
  // presentation chain), so the user comes back to whatever step we
  // transition to. Wait a beat after queueing so the JS bridge doesn't
  // race the picker presentation against the Modal becoming active.
  function handleOpenPicker() {
    setTimeout(async () => {
      try {
        const folderName = await DjiFiles.pickFolder();
        if (!folderName) {
          // User cancelled the picker — stay on action so they can retry.
          return;
        }
        // Transition into the verifying state immediately so the coach
        // sees something happen after the iOS picker closes (rather
        // than the modal seeming to disappear).
        setStep('verifying');
        setHasFolderAccess(true);

        // Sanity check: did the coach actually pick a folder that
        // contains DJI files? If not, surface the error step with a
        // retry path — better than silently storing a useless bookmark.
        let djiCount = 0;
        try {
          const entries = await DjiFiles.listFiles();
          for (const entry of entries) {
            if (parseDjiFileName(entry.name)) djiCount += 1;
          }
        } catch { /* listFiles may fail right after pick — treat as 0 */ }

        if (djiCount === 0) {
          try { DjiFiles.clearFolder?.(); } catch {}
          setHasFolderAccess(false);
          setStep('error');
        } else {
          // Folder picked & DJI files found — refresh pending so the
          // dashboard's CTA can flip into the Phase-2 UPLOAD state.
          refreshPending();
          setFoundCount(djiCount);
          setStep('success');
        }
      } catch (err) {
        console.warn('[DjiSetupBanner] pickFolder failed:', err);
        setStep('error');
      }
    }, MODAL_DISMISS_DELAY_MS);
  }

  // Visibility: same conditions as the inline banner had before.
  const visible = isLocalMode && !hasFolderAccess && pendingCount > 0;
  if (!visible) return null;

  return (
    <>
      <TouchableOpacity
        style={s.banner}
        activeOpacity={0.85}
        onPress={handleBannerTap}
        accessibilityRole="button"
        accessibilityLabel="Set up DJI auto-sync"
      >
        <Ionicons name="alert-circle" size={14} color="#fff" />
        <Text style={s.bannerText} numberOfLines={1}>
          Set up auto-sync
        </Text>
        <Ionicons name="chevron-forward" size={14} color="#fff" />
      </TouchableOpacity>

      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={dismissModal}
      >
        <Pressable style={s.overlay} onPress={dismissModal}>
          <Pressable style={s.card} onPress={(e) => e.stopPropagation()}>
            {step === 'intro' && (
              <StepIntro
                onCancel={dismissModal}
                onStart={() => setStep('test')}
              />
            )}
            {step === 'test' && (
              <StepTest
                onBack={() => setStep('intro')}
                onNext={() => setStep('plug')}
              />
            )}
            {step === 'plug' && (
              <StepPlug
                onBack={() => setStep('test')}
                onNext={() => setStep('instructions')}
              />
            )}
            {step === 'instructions' && (
              <StepInstructions
                onBack={() => setStep('plug')}
                onOpenFiles={handleOpenPicker}
              />
            )}
            {step === 'verifying' && <StepVerifying />}
            {step === 'success' && (
              <StepSuccess
                foundCount={foundCount}
                onClose={dismissModal}
              />
            )}
            {step === 'error' && (
              <StepError
                onCancel={dismissModal}
                onRetry={() => setStep('action')}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// ─── Step components ─────────────────────────────────────────────────────

function StepHeader({ stepLabel, iconName, iconBg, iconColor, title, subtitle }) {
  return (
    <View style={s.header}>
      <View style={[s.iconWrap, iconBg ? { backgroundColor: iconBg } : null]}>
        <Ionicons name={iconName} size={22} color={iconColor ?? INK_950} />
      </View>
      <View style={{ flex: 1 }}>
        {stepLabel ? <Text style={s.stepLabel}>{stepLabel}</Text> : null}
        <Text style={s.title}>{title}</Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

function StepIntro({ onCancel, onStart }) {
  return (
    <>
      <StepHeader
        iconName="flash"
        iconBg="rgba(232, 181, 48, 0.18)"
        title="One-time setup"
        subtitle="Then it's fully automatic"
      />
      <Text style={s.body}>
        Point us to your mic's folder once. Every plug-in after that
        syncs your classes automatically.
      </Text>
      <Text style={s.body}>
        Takes about a minute.
      </Text>
      <View style={s.actions}>
        <TouchableOpacity style={s.btnGhost} activeOpacity={0.85} onPress={onCancel}>
          <Text style={s.btnGhostText}>Later</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.btnPrimary} activeOpacity={0.88} onPress={onStart}>
          <Text style={s.btnPrimaryText}>Start</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

function StepTest({ onBack, onNext }) {
  return (
    <>
      <StepHeader
        stepLabel="Step 1 of 3"
        iconName="radio-button-on"
        iconBg="rgba(212, 69, 69, 0.12)"
        iconColor={RED}
        title="Record a quick test"
      />
      <Text style={s.body}>
        With your mic <Text style={s.strong}>unplugged</Text>: press
        <Text style={s.strong}> REC</Text>, count to 3, press
        <Text style={s.strong}> REC again</Text> to stop.
      </Text>
      <Text style={s.bodyMuted}>
        The DJI mic can't record while plugged in.
      </Text>
      <View style={s.actions}>
        <TouchableOpacity style={s.btnGhost} activeOpacity={0.85} onPress={onBack}>
          <Text style={s.btnGhostText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.btnPrimary} activeOpacity={0.88} onPress={onNext}>
          <Text style={s.btnPrimaryText}>Done →</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

function StepPlug({ onBack, onNext }) {
  return (
    <>
      <StepHeader
        stepLabel="Step 2 of 3"
        iconName="hardware-chip-outline"
        title="Plug in your DJI mic"
      />
      <Text style={s.body}>
        Connect your mic to your iPhone via USB-C.
      </Text>
      <View style={s.actions}>
        <TouchableOpacity style={s.btnGhost} activeOpacity={0.85} onPress={onBack}>
          <Text style={s.btnGhostText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.btnPrimary} activeOpacity={0.88} onPress={onNext}>
          <Text style={s.btnPrimaryText}>Done →</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

function StepInstructions({ onBack, onOpenFiles }) {
  return (
    <>
      <StepHeader
        stepLabel="Step 3 of 3"
        iconName="warning"
        iconBg="rgba(212, 69, 69, 0.12)"
        iconColor={RED}
        title="Three taps in the next screen"
      />
      <View style={s.bulletList}>
        <View style={s.bulletRow}>
          <Text style={s.bullet}>
            <Text style={s.bulletDot}>1.  </Text>
            Tap <Text style={s.strongRed}>Browse</Text> at the bottom.
          </Text>
          <Image source={BROWSE_TAB_IMAGE} style={s.stepImageBrowse} resizeMode="contain" />
        </View>
        <View style={s.bulletRow}>
          <Text style={s.bullet}>
            <Text style={s.bulletDot}>2.  </Text>
            Tap <Text style={s.strongRed}>NO NAME</Text> under Locations.
          </Text>
          <Image source={NO_NAME_IMAGE} style={s.stepImageNoName} resizeMode="contain" />
        </View>
        <Text style={s.bullet}>
          <Text style={s.bulletDot}>3.  </Text>
          Tap <Text style={s.strongRed}>Open</Text> at the top-right.
        </Text>
      </View>
      <View style={s.actions}>
        <TouchableOpacity style={s.btnGhost} activeOpacity={0.85} onPress={onBack}>
          <Text style={s.btnGhostText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.btnPrimary} activeOpacity={0.88} onPress={onOpenFiles}>
          <Ionicons name="folder-open" size={15} color="#fff" />
          <Text style={s.btnPrimaryText}>Open Files</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

function StepVerifying() {
  return (
    <>
      <StepHeader
        iconName="sync"
        iconBg="rgba(13, 13, 18, 0.07)"
        title="Verifying connection…"
      />
      <View style={s.verifyingRow}>
        <ActivityIndicator size="small" color={INK_950} />
        <Text style={s.verifyingText}>Checking your mic's folder…</Text>
      </View>
      <Text style={s.bodyMuted}>
        Reading the recordings to make sure everything's wired up.
      </Text>
    </>
  );
}

function StepSuccess({ foundCount, onClose }) {
  const fileLabel = foundCount === 1 ? 'recording' : 'recordings';
  return (
    <>
      <StepHeader
        iconName="checkmark-circle"
        iconBg="rgba(45, 138, 74, 0.13)"
        iconColor="#2D8A4A"
        title="All set"
        subtitle="Auto-sync is on"
      />
      <View style={s.connectedCard}>
        <Ionicons name="pulse" size={16} color="#2D8A4A" />
        <Text style={s.connectedText}>
          Found <Text style={s.strong}>{foundCount} {fileLabel}</Text> on your mic.
        </Text>
      </View>
      <Text style={s.body}>
        Plug your mic in after a class — recordings sync automatically.
      </Text>
      <TouchableOpacity style={s.btnPrimaryFull} activeOpacity={0.88} onPress={onClose}>
        <Text style={s.btnPrimaryText}>Thanks</Text>
      </TouchableOpacity>
    </>
  );
}

function StepError({ onCancel, onRetry }) {
  return (
    <>
      <StepHeader
        iconName="alert-circle"
        iconBg="rgba(179, 58, 58, 0.12)"
        iconColor="#B33A3A"
        title="Couldn't find DJI files"
      />
      <Text style={s.body}>
        The folder you picked doesn't have any DJI recordings on it.
        Make sure your mic is plugged in, then pick <Text style={s.strong}>NO NAME</Text> at the root of your mic — no sub-folder.
      </Text>
      <View style={s.actions}>
        <TouchableOpacity style={s.btnGhost} activeOpacity={0.85} onPress={onCancel}>
          <Text style={s.btnGhostText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.btnPrimary} activeOpacity={0.88} onPress={onRetry}>
          <Text style={s.btnPrimaryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  // Compact pill that fits between the notif button and the avatar.
  // Flex 1 lets it absorb the remaining horizontal space — that's why
  // CoachTabHeader's row uses justifyContent: 'space-between' rather
  // than fixed widths.
  banner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    marginHorizontal: 10,
    paddingHorizontal: 10,
    backgroundColor: RED,
    borderRadius: 12,
  },
  bannerText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 12,
    color: '#FFFFFF',
    letterSpacing: 0.3,
    flexShrink: 1,
  },

  // ─── Modal ──────────────────────────────────────────────────────────
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
    padding: 22,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(232, 181, 48, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 17,
    color: INK_950,
    letterSpacing: -0.2,
  },
  subtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: '#6B6B6B',
    marginTop: 2,
  },
  stepLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10.5,
    color: '#9B9B9B',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  body: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13.5,
    color: '#3A3A3A',
    lineHeight: 19,
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  bodyMuted: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12.5,
    color: '#8A8A8A',
    lineHeight: 17,
    marginBottom: 16,
    paddingHorizontal: 2,
  },
  verifyingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  verifyingText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: INK_950,
  },
  bulletList: {
    gap: 8,
    marginBottom: 18,
    paddingHorizontal: 2,
  },
  bullet: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13.5,
    color: '#3A3A3A',
    lineHeight: 19,
  },
  bulletDot: {
    fontFamily: Fonts.jakartaExtraBold,
    color: RED,
  },
  bulletRow: {
    gap: 6,
  },
  stepImageBrowse: {
    width: '100%',
    height: 56,
    alignSelf: 'center',
    marginTop: 2,
    marginBottom: 2,
  },
  stepImageNoName: {
    width: 160,
    height: 36,
    alignSelf: 'flex-start',
    marginLeft: 16,
    marginTop: 2,
    marginBottom: 2,
  },
  connectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(45, 138, 74, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(45, 138, 74, 0.25)',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 11,
    marginBottom: 12,
  },
  connectedText: {
    flex: 1,
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12.5,
    color: '#1F6B36',
    lineHeight: 17,
  },
  strong: {
    fontFamily: Fonts.jakartaExtraBold,
    color: INK_950,
  },
  strongRed: {
    fontFamily: Fonts.jakartaExtraBold,
    color: RED,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: INK_950,
    borderRadius: 12,
    paddingVertical: 13,
  },
  btnPrimaryFull: {
    width: '100%',
    backgroundColor: INK_950,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
  footnote: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11.5,
    color: '#7A7A7A',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 16,
  },
});
