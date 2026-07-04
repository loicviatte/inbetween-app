// ─── DjiSetupBanner ─────────────────────────────────────────────────────
// Compact "SET UP" pill in the coach header (styled identically to
// DjiSyncPill) shown when a class is waiting for audio AND no folder
// bookmark exists yet. Tapping it opens the full-screen, dark one-time
// setup flow that walks the coach from powering on the mic to granting
// folder access — same visual language as MicSyncFlowModal.
//
// Steps: intro · poweron · test · plug · files → (pickFolder) → verifying
//        → success | error
//
// State is self-contained (we query Supabase for pendingCount + read the
// native hasFolder flag on a polite cadence) so we don't have to thread it
// through CoachTabHeader's parents.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Animated,
  Easing,
  ActivityIndicator,
  AppState,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fonts } from '../theme';
import { supabase } from '../services/supabase/client';
import { isLocalRecordingMode } from '../services/featureFlags';
import { fetchPendingUploads, countMicSessions } from '../services/localRecordingAutoSync';
import * as DjiFiles from 'local-recording-files';
import { BrowseTabChip, NoNameChip } from './DjiFilesChips';
import { useDjiSync } from '../context/DjiSyncContext';

const MIC_FRONT = require('../../assets/dji-setup/dji-mic2.webp');
const MIC_SIDE_POWER = require('../../assets/dji-setup/dji_mic_2_side_power.png');
const MIC_SIDE_REC = require('../../assets/dji-setup/dji_mic_2-side.png');
const LOGO = require('../../assets/dji-setup/white_Logo_square_v1.png');

const GOLD_500 = '#E8B530';
const GOLD_400 = '#F0C24A';
const GOLD_300 = '#F6D27A';
const RED_HI = '#E85555';
const STAGE = '#060606';
const INK = '#0A0A0A';
const CABLE_TRAVEL = 220; // how far the USB-C cable slides in from the left

// Progress-bar % + "NN / 04" counter per step.
const STEP_META = {
  intro: { pct: 4, count: '00 / 04' },
  poweron: { pct: 25, count: '01 / 04' },
  test: { pct: 50, count: '02 / 04' },
  plug: { pct: 75, count: '03 / 04' },
  files: { pct: 100, count: '04 / 04' },
  verifying: { pct: 100, count: '···' },
  success: { pct: 100, count: 'DONE' },
  error: { pct: 100, count: '—' },
};

// A pulsing highlight ring anchored on a device button (left/top are % of
// the image container). One steady ring + one expanding "ping".
function PulseRing({ color, left, top, size = 50 }) {
  const ping = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(ping, {
        toValue: 1,
        duration: 2200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [ping]);
  const scale = ping.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.9] });
  const opacity = ping.interpolate({ inputRange: [0, 1], outputRange: [0.85, 0] });
  return (
    <View
      pointerEvents="none"
      style={[s.markWrap, { left, top, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }]}
    >
      <View style={[s.markRing, { borderColor: color, borderRadius: size / 2 }]} />
      <Animated.View
        style={[s.markRing, { borderColor: color, borderRadius: size / 2, transform: [{ scale }], opacity }]}
      />
    </View>
  );
}

// Intro hero: DJI mic tile ↔ InBetween tile with a dashed link + a small
// "file" gliding across (simplified vs the CSS particle stream).
function IntroLink() {
  const fly = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!w) return; // wait for onLayout — else the glide range is [0,0] (frozen)
    fly.setValue(0);
    const loop = Animated.loop(
      Animated.timing(fly, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [fly, w]);
  const tx = fly.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, w - 18)] });
  const op = fly.interpolate({ inputRange: [0, 0.12, 0.85, 1], outputRange: [0, 1, 1, 0] });
  return (
    <View style={s.introLink}>
      <View style={s.introSide}>
        <View style={s.introTileMic}>
          <Image source={MIC_FRONT} style={s.introMicImg} contentFit="contain" />
        </View>
        <Text style={s.introLabel}>DJI MIC</Text>
      </View>

      <View style={s.introFlow} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        <View style={s.introDash} />
        <Animated.View style={[s.introFile, { opacity: op, transform: [{ translateX: tx }] }]}>
          <Ionicons name="document-text" size={9} color={INK} />
        </Animated.View>
      </View>

      <View style={s.introSide}>
        <View style={s.introTileApp}>
          <Image source={LOGO} style={s.introLogoImg} contentFit="contain" />
        </View>
        <Text style={s.introLabel}>INBETWEEN</Text>
      </View>
    </View>
  );
}

// Success hero: gold badge that pops in with a checkmark.
function SuccessHero() {
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 70, useNativeDriver: true }).start();
  }, [pop]);
  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  return (
    <View style={s.doneHero}>
      <Animated.View style={{ transform: [{ scale }], opacity: pop }}>
        <LinearGradient colors={['#F9DF9B', GOLD_500, '#C8881C']} style={s.doneBadge}>
          <Ionicons name="checkmark" size={64} color={INK} />
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

// USB-C cable that glides in from the left of the screen and docks at the mic,
// on a gentle loop (slide in → hold → invisibly reset → repeat).
function CableAnim() {
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(slide, { toValue: 1, duration: 1300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.delay(1100),
      ]),
      { resetBeforeIteration: true },
    );
    loop.start();
    return () => loop.stop();
  }, [slide]);
  const tx = slide.interpolate({ inputRange: [0, 1], outputRange: [-CABLE_TRAVEL, 0] });
  const op = slide.interpolate({ inputRange: [0, 0.08, 1], outputRange: [0, 1, 1] });
  return (
    <Animated.View style={[s.cableTrack, { opacity: op, transform: [{ translateX: tx }] }]} pointerEvents="none">
      <View style={s.cableWire} />
      <View style={s.cablePlug}>
        <View style={s.cablePlugTip} />
      </View>
    </Animated.View>
  );
}

// Small light iOS nav-bar preview (‹ Back · NO NAME · OPEN) for the "tap Open" step.
function OpenNavPreview() {
  return (
    <View style={s.navBar}>
      <Text style={s.navBack}>‹ Back</Text>
      <Text style={s.navTitle} numberOfLines={1}>NO NAME</Text>
      <View style={s.navOpen}>
        <Text style={s.navOpenTxt}>OPEN</Text>
      </View>
    </View>
  );
}

export default function DjiSetupBanner() {
  const [authUser, setAuthUser] = useState(null);
  const [hasFolderAccess, setHasFolderAccess] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState('intro');
  // displayStep lags `step` during the out→in transition so the content that
  // animates out is the OLD screen, then we swap and animate the new one in.
  const [displayStep, setDisplayStep] = useState('intro');
  const [foundCount, setFoundCount] = useState(0);
  const dismissedRef = useRef(false);
  const pickingRef = useRef(false); // a folder pick is in flight
  const sync = useDjiSync(); // sibling provider — to refresh its pill after grant
  const trans = useRef(new Animated.Value(1)).current; // 1 = shown, 0 = hidden
  const progress = useRef(new Animated.Value(STEP_META.intro.pct)).current;

  const isLocalMode = isLocalRecordingMode(authUser);

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => setAuthUser(user))
      .catch(() => setAuthUser(null));
  }, []);

  useEffect(() => {
    const check = () => {
      try {
        setHasFolderAccess(DjiFiles.hasFolder?.() ?? false);
      } catch {
        setHasFolderAccess(false);
      }
    };
    check();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') check();
    });
    return () => sub.remove();
  }, []);

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
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') refreshPending();
    });
    return () => sub.remove();
  }, [refreshPending]);

  // Progress bar eases toward the new step's target the instant you tap.
  useEffect(() => {
    Animated.timing(progress, {
      toValue: (STEP_META[step] ?? STEP_META.intro).pct,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [step, progress]);

  // Content cross-transition: fade+lift the current screen OUT, swap to the new
  // step, then animate it IN. Keeps in AND out smooth between every step.
  useEffect(() => {
    if (step === displayStep) return;
    Animated.timing(trans, {
      toValue: 0,
      duration: 150,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setDisplayStep(step);
      Animated.timing(trans, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  }, [step, displayStep, trans]);

  function handleBannerTap() {
    dismissedRef.current = false;
    setStep('intro');
    setDisplayStep('intro');
    trans.setValue(1);
    progress.setValue(STEP_META.intro.pct);
    setModalOpen(true);
  }

  function dismissModal() {
    dismissedRef.current = true;
    pickingRef.current = false;
    setModalOpen(false);
    setTimeout(() => setStep('intro'), 250);
  }

  // Files step → fire the iOS folder picker, then verify the pick holds DJI
  // recordings (else the error step + retry). Guards: pickingRef blocks a
  // double-tap starting a second picker; dismissedRef is checked after EVERY
  // await so a stale continuation can't clear a just-granted bookmark or flip
  // the flow after the coach closed it. hasFolderAccess is only trusted once the
  // folder is verified to actually contain DJI files (no false→true→false churn).
  async function handleOpenPicker() {
    if (pickingRef.current) return;
    pickingRef.current = true;
    try {
      const folderName = await DjiFiles.pickFolder();
      if (dismissedRef.current) return; // closed while the picker was up
      if (!folderName) return; // cancelled — stay on files

      setStep('verifying');
      let djiCount = 0;
      try {
        const entries = await DjiFiles.listFiles();
        // Count logical recordings (sessions), not raw file-parts — a split
        // recording is several files sharing an index but is ONE recording.
        djiCount = countMicSessions(entries);
      } catch {
        /* listFiles can fail right after pick — treat as 0 */
      }
      if (dismissedRef.current) return; // closed during verifying

      if (djiCount === 0) {
        try {
          DjiFiles.clearFolder?.();
        } catch {}
        setStep('error');
      } else {
        setHasFolderAccess(true);
        sync?.refreshFolderAccess?.(); // let the sibling provider show its sync pill
        refreshPending();
        setFoundCount(djiCount);
        setStep('success');
      }
    } catch (err) {
      if (dismissedRef.current) return;
      console.warn('[DjiSetupBanner] pickFolder failed:', err);
      setStep('error');
    } finally {
      pickingRef.current = false;
    }
  }

  const visible = isLocalMode && !hasFolderAccess && pendingCount > 0;
  // Stay mounted while the flow modal is open even after hasFolderAccess flips
  // true (successful pick) — otherwise the whole component (and the modal) would
  // unmount mid-flow and the coach would never see verifying / success. The pill
  // itself still only renders when there's setup to do (`visible`).
  if (!visible && !modalOpen) return null;

  const meta = STEP_META[step] ?? STEP_META.intro;

  return (
    <>
      {visible && (
        <TouchableOpacity
          style={s.pillWrap}
          activeOpacity={0.85}
          onPress={handleBannerTap}
          accessibilityRole="button"
          accessibilityLabel="Set up DJI auto-sync"
        >
          <LinearGradient colors={['#C93838', '#B22A2A']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={s.pill}>
            <View style={s.pillIc}>
              <Ionicons name="flash" size={12} color="#fff" />
            </View>
            <Text style={s.pillLbl} numberOfLines={1}>
              SET UP
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      )}

      <Modal visible={modalOpen} animationType="slide" transparent={false} onRequestClose={dismissModal} statusBarTranslucent>
        {/* A RN Modal renders into its own native window that does NOT inherit
            the host app's SafeAreaProvider — so the ambient insets read 0 at the
            bottom and the CTA gets clipped by the home indicator. A nested
            provider re-measures against the modal's own window. */}
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <View style={[s.stage, displayStep === 'error' && s.stageErr]}>
            <ModalSafe>
            {/* Top bar: close · progress · counter */}
            <View style={s.top}>
              <TouchableOpacity style={s.close} onPress={dismissModal} activeOpacity={0.7}>
                <Ionicons name="close" size={15} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>
              <View style={s.progressTrack}>
                <Animated.View
                  style={[s.progressFill, { width: progress.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]}
                />
              </View>
              <Text style={[s.stepCount, step === 'success' && s.stepCountDone]}>{meta.count}</Text>
            </View>

            {/* Hero + copy (cross-fades between steps) */}
            <Animated.View
              style={[
                s.hero,
                displayStep === 'files' && s.heroFiles,
                { opacity: trans, transform: [{ translateY: trans.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] },
              ]}
            >
              {renderStep(displayStep, foundCount)}
            </Animated.View>

            {/* Bottom actions */}
            <Animated.View style={[s.bottom, { opacity: trans }]}>
              {renderBottom(displayStep, { dismissModal, setStep, handleOpenPicker })}
            </Animated.View>
            </ModalSafe>
          </View>
        </SafeAreaProvider>
      </Modal>
    </>
  );
}

// Both the ambient app-provider insets AND the modal's own nested-provider
// insets come back bottom:0 in this Modal on-device, so the CTA gets clipped by
// the home indicator. The reliable source is `initialWindowMetrics.insets` —
// the real window insets captured natively at app init; the setup Modal is
// always full-screen, so those ARE the correct device insets. Take the max of
// all three so we never under-pad, with a small floor for non-safe devices.
function ModalSafe({ children }) {
  const insets = useSafeAreaInsets();
  const win = initialWindowMetrics?.insets;
  const padTop = Math.max(insets.top, win?.top ?? 0, 10);
  const padBottom = Math.max(insets.bottom, win?.bottom ?? 0, 8);
  // paddingBottom on this flex parent wasn't reliably reserving space on-device,
  // so lift the CTA with an explicit spacer View in the column flow instead.
  return (
    <View style={[s.safe, { paddingTop: padTop }]}>
      {children}
      <View style={{ height: padBottom }} />
    </View>
  );
}

// ─── Step hero + copy ────────────────────────────────────────────────────
function Eyebrow({ children, style }) {
  return <Text style={[s.eyebrow, style]}>{children}</Text>;
}

function renderStep(step, foundCount) {
  switch (step) {
    case 'intro':
      return (
        <>
          <IntroLink />
          <View style={s.copy}>
            <Eyebrow>BEFORE WE START</Eyebrow>
            <Text style={s.h2}>One-time setup.</Text>
            <Text style={s.p}>
              Link your <Text style={s.strong}>DJI mic</Text> to <Text style={s.strong}>InBetween</Text>. Then every
              plug-in syncs your recordings <Text style={s.strong}>automatically</Text>.
            </Text>
            <View style={s.tinyNote}>
              <Ionicons name="time-outline" size={12} color={GOLD_300} />
              <Text style={s.tinyNoteTxt}>Takes about a minute.</Text>
            </View>
          </View>
        </>
      );

    case 'poweron':
      return (
        <>
          <View style={s.micStage}>
            <View style={s.powerImgWrap}>
              <Image source={MIC_SIDE_POWER} style={s.micImg} contentFit="contain" />
              <PulseRing color={GOLD_400} left="38%" top="52%" size={54} />
            </View>
          </View>
          <View style={s.copy}>
            <Eyebrow>POWER ON</Eyebrow>
            <Text style={s.h2}>Turn on your mic.</Text>
            <Text style={s.p}>
              Long-press the <Text style={s.strong}>power button</Text> until the green LED lights up.
            </Text>
          </View>
        </>
      );

    case 'test':
      return (
        <>
          <View style={s.micStage}>
            <Image source={MIC_SIDE_REC} style={s.micImg} contentFit="contain" />
            <PulseRing color={RED_HI} left="50%" top="61%" size={46} />
          </View>
          <View style={s.copy}>
            <Eyebrow>TEST RECORDING</Eyebrow>
            <Text style={s.h2}>Record a quick test.</Text>
            <Text style={s.p}>
              Short-press <Text style={s.strong}>REC</Text> — the <Text style={s.strong}>red light</Text> turns on. Count
              to three, then short-press <Text style={s.strong}>REC</Text> again to stop.
            </Text>
          </View>
        </>
      );

    case 'plug':
      return (
        <>
          <View style={s.micStage}>
            <Image source={MIC_FRONT} style={s.micFrontImg} contentFit="contain" />
            <CableAnim />
          </View>
          <View style={s.copy}>
            <Eyebrow>{'CONNECT USB‑C'}</Eyebrow>
            <Text style={s.h2}>Plug in your mic.</Text>
            <Text style={s.p}>
              Connect the receiver to your iPhone via <Text style={s.strong}>{'USB‑C'}</Text>.
            </Text>
          </View>
        </>
      );

    case 'files':
      return (
        <>
          <View style={[s.copy, { marginTop: 0, marginBottom: 6 }]}>
            <Eyebrow>LAST STEP</Eyebrow>
            <Text style={s.h2}>Three taps in Files.</Text>
          </View>
          <View style={s.tapGuide}>
            <View style={s.tapStep}>
              <Text style={s.tapCap}>
                <Text style={s.tapN}>1  </Text>Tap <Text style={s.tapEm}>Browse</Text> at the bottom.
              </Text>
              <BrowseTabChip />
            </View>
            <View style={s.tapStep}>
              <Text style={s.tapCap}>
                <Text style={s.tapN}>2  </Text>Tap <Text style={s.tapEm}>NO NAME</Text> under Locations.
              </Text>
              <NoNameChip />
            </View>
            <View style={s.tapStep}>
              <Text style={s.tapCap}>
                <Text style={s.tapN}>3  </Text>Tap <Text style={s.tapEm}>Open</Text> at the top-right.
              </Text>
              <OpenNavPreview />
            </View>
          </View>
          <Text style={s.filesHint}>If NO NAME isn’t there, make sure the mic is turned on.</Text>
        </>
      );

    case 'verifying':
      return (
        <View style={s.copy}>
          <ActivityIndicator size="large" color={GOLD_400} />
          <Text style={[s.h2, { marginTop: 22 }]}>Checking your mic…</Text>
          <Text style={s.p}>Reading the recordings to make sure everything’s wired up.</Text>
        </View>
      );

    case 'success':
      return (
        <>
          <SuccessHero />
          <View style={s.copy}>
            <Eyebrow>ALL SET</Eyebrow>
            <Text style={s.h2}>You’re all set.</Text>
            <Text style={s.p}>
              {foundCount > 0 ? (
                <>
                  Found <Text style={s.strong}>{foundCount} recording{foundCount === 1 ? '' : 's'}</Text> on your mic.
                  Plug in after each class to sync — automatically.
                </>
              ) : (
                <>Plug your mic in after each class to sync your recordings — automatically.</>
              )}
            </Text>
          </View>
        </>
      );

    case 'error':
      return (
        <>
          <View style={s.micStage}>
            <View style={s.errBadge}>
              <Ionicons name="alert" size={30} color={RED_HI} />
            </View>
          </View>
          <View style={s.copy}>
            <Eyebrow style={s.eyebrowErr}>NO RECORDINGS</Eyebrow>
            <Text style={s.h2}>Couldn’t find DJI files.</Text>
            <Text style={s.p}>
              That folder has no DJI recordings. Make sure the mic is on, then pick{' '}
              <Text style={s.strong}>NO NAME</Text> at the root of your mic — not a sub-folder.
            </Text>
          </View>
        </>
      );

    default:
      return null;
  }
}

// ─── Step bottom actions ─────────────────────────────────────────────────
function PrimaryBtn({ label, onPress, gold, icon }) {
  return (
    <TouchableOpacity style={s.primaryWrap} onPress={onPress} activeOpacity={0.88}>
      {gold ? (
        <LinearGradient colors={['#F6D27A', GOLD_500]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={s.primary}>
          <Text style={[s.primaryTxt, { color: INK }]}>{label}</Text>
          {icon}
        </LinearGradient>
      ) : (
        <View style={[s.primary, s.primaryLight]}>
          <Text style={[s.primaryTxt, { color: INK }]}>{label}</Text>
          {icon}
        </View>
      )}
    </TouchableOpacity>
  );
}

function BackBtn({ onPress, label = 'BACK' }) {
  return (
    <TouchableOpacity style={s.backBtn} onPress={onPress} activeOpacity={0.7}>
      <Text style={s.backTxt}>{label}</Text>
    </TouchableOpacity>
  );
}

const arrow = <Ionicons name="arrow-forward" size={13} color={INK} style={{ marginLeft: 2 }} />;

function renderBottom(step, { dismissModal, setStep, handleOpenPicker }) {
  switch (step) {
    case 'intro':
      return (
        <View style={s.actions}>
          <BackBtn onPress={dismissModal} label="LATER" />
          <PrimaryBtn gold label="START" icon={arrow} onPress={() => setStep('poweron')} />
        </View>
      );
    case 'poweron':
      return (
        <View style={s.actions}>
          <BackBtn onPress={() => setStep('intro')} />
          <PrimaryBtn label="IT'S ON" icon={arrow} onPress={() => setStep('test')} />
        </View>
      );
    case 'test':
      return (
        <View style={s.actions}>
          <BackBtn onPress={() => setStep('poweron')} />
          <PrimaryBtn label="RECORDED" icon={arrow} onPress={() => setStep('plug')} />
        </View>
      );
    case 'plug':
      return (
        <View style={s.actions}>
          <BackBtn onPress={() => setStep('test')} />
          <PrimaryBtn label="CONTINUE" icon={arrow} onPress={() => setStep('files')} />
        </View>
      );
    case 'files':
      return (
        <View style={s.actions}>
          <BackBtn onPress={() => setStep('plug')} />
          <PrimaryBtn gold label="START" icon={<Ionicons name="folder-open" size={13} color={INK} style={{ marginLeft: 2 }} />} onPress={handleOpenPicker} />
        </View>
      );
    case 'success':
      return (
        <View style={s.actions}>
          <PrimaryBtn gold label="OPEN DASHBOARD" icon={arrow} onPress={dismissModal} />
        </View>
      );
    case 'error':
      return (
        <View style={s.actions}>
          <BackBtn onPress={dismissModal} label="CANCEL" />
          <PrimaryBtn gold label="TRY AGAIN" onPress={() => setStep('files')} />
        </View>
      );
    case 'verifying':
    default:
      return null;
  }
}

const s = StyleSheet.create({
  // ─── Header pill (matches DjiSyncPill exactly) ──────────────────────
  pillWrap: { flex: 1, alignItems: 'center', marginHorizontal: 10 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingLeft: 6,
    paddingRight: 12,
    borderRadius: 999,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  pillIc: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLbl: { fontFamily: Fonts.jakartaExtraBold, fontSize: 10, letterSpacing: 1.4, color: '#fff' },

  // ─── Full-screen flow ───────────────────────────────────────────────
  stage: { flex: 1, backgroundColor: STAGE },
  stageErr: { backgroundColor: '#0A0606' },
  safe: { flex: 1 },

  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 22,
    paddingTop: 4,
    paddingBottom: 6,
  },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: { flex: 1, height: 2, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: GOLD_400 },
  stepCount: { fontFamily: Fonts.jakartaExtraBold, fontSize: 9, letterSpacing: 2, color: 'rgba(255,255,255,0.4)' },
  stepCountDone: { color: GOLD_300 },

  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  heroFiles: { justifyContent: 'flex-start', paddingTop: 26 },

  // Copy
  copy: { alignItems: 'center', maxWidth: 300, marginTop: 30 },
  eyebrow: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9.5,
    letterSpacing: 3,
    color: 'rgba(232,181,48,0.85)',
    marginBottom: 14,
    textAlign: 'center',
  },
  eyebrowErr: { color: RED_HI },
  h2: { fontFamily: Fonts.ttDemiBold, fontSize: 30, color: '#fff', letterSpacing: -0.8, textAlign: 'center', marginBottom: 12 },
  p: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    lineHeight: 21,
  },
  strong: { fontFamily: Fonts.jakartaMedium, color: 'rgba(255,255,255,0.9)' },
  tinyNote: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 16 },
  tinyNoteTxt: { fontFamily: Fonts.jakartaExtraBold, fontSize: 10, letterSpacing: 1, color: 'rgba(255,255,255,0.55)' },

  // Mic hero
  micStage: { width: 300, height: 300, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  micImg: { width: '100%', height: '100%' },
  // Power-on: a larger image that overflows the 300 stage (so the copy below
  // keeps its position) with the pulse ring anchored to the enlarged frame.
  powerImgWrap: {
    position: 'absolute',
    width: 410,
    height: 410,
    left: '50%',
    top: '50%',
    marginLeft: -205,
    marginTop: -205,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micFrontImg: { width: 210, height: 210 },
  markWrap: { position: 'absolute' },
  markRing: { ...StyleSheet.absoluteFillObject, borderWidth: 1.5 },
  // USB-C cable: a track that overflows the stage to the left; the wire trails
  // off toward the screen edge and the metal plug docks at the mic's left side.
  cableTrack: {
    position: 'absolute',
    top: '50%',
    marginTop: -14,
    left: -150,
    right: 248,
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cableWire: {
    flex: 1,
    height: 9,
    backgroundColor: '#2b2b2e',
    borderRadius: 5,
  },
  cablePlug: {
    width: 46,
    height: 26,
    borderRadius: 5,
    backgroundColor: '#cfcfd3',
    shadowColor: GOLD_500,
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  cablePlugTip: {
    position: 'absolute',
    right: -9,
    top: 6,
    width: 10,
    height: 14,
    borderRadius: 2,
    backgroundColor: '#b8b8bc',
  },
  errBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(212,69,69,0.12)',
    borderWidth: 0.5,
    borderColor: 'rgba(212,69,69,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Intro link hero
  introLink: { flexDirection: 'row', alignItems: 'center', gap: 6, width: 300, marginTop: 8 },
  introSide: { alignItems: 'center', gap: 10 },
  introTileMic: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  introMicImg: { width: '100%', height: '100%' },
  introTileApp: {
    width: 96,
    height: 96,
    borderRadius: 24,
    backgroundColor: '#0C0C0C',
    borderWidth: 0.5,
    borderColor: 'rgba(232,181,48,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  introLogoImg: { width: '70%', height: '70%' },
  introLabel: { fontFamily: Fonts.jakartaExtraBold, fontSize: 9, letterSpacing: 1.8, color: 'rgba(255,255,255,0.55)' },
  introFlow: { flex: 1, height: 40, justifyContent: 'center', marginTop: -18, position: 'relative' },
  introDash: { height: 1.5, backgroundColor: 'rgba(232,181,48,0.3)', borderRadius: 1 },
  introFile: {
    position: 'absolute',
    top: '50%',
    marginTop: -10,
    left: 0,
    width: 18,
    height: 20,
    borderRadius: 4,
    backgroundColor: GOLD_300,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Files step
  tapGuide: { width: '100%', maxWidth: 300, gap: 15, marginTop: 20 },
  tapStep: { gap: 8 },
  tapCap: { fontFamily: Fonts.jakartaMedium, fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 19 },
  tapN: { fontFamily: Fonts.jakartaExtraBold, color: GOLD_300 },
  tapEm: { fontFamily: Fonts.jakartaExtraBold, color: '#fff' },
  filesHint: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9.5,
    letterSpacing: 0.8,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    marginTop: 16,
    maxWidth: 290,
  },
  // Light iOS nav-bar preview (tap Open)
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F6F6F8',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E6E6EA',
    paddingVertical: 7,
    paddingHorizontal: 12,
    gap: 8,
  },
  navBack: { fontFamily: Fonts.jakartaMedium, fontSize: 12, color: '#007AFF' },
  navTitle: { flex: 1, textAlign: 'center', fontFamily: Fonts.jakartaExtraBold, fontSize: 12, color: '#000' },
  navOpen: { backgroundColor: '#007AFF', borderRadius: 13, paddingVertical: 4, paddingHorizontal: 13 },
  navOpenTxt: { fontFamily: Fonts.jakartaExtraBold, fontSize: 11, letterSpacing: 0.4, color: '#fff' },

  // Success
  doneHero: { width: 240, height: 240, alignItems: 'center', justifyContent: 'center' },
  doneBadge: {
    width: 150,
    height: 150,
    borderRadius: 75,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: GOLD_500,
    shadowOpacity: 0.5,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
  },

  // Bottom actions
  bottom: { paddingHorizontal: 22, paddingTop: 4 },
  actions: { flexDirection: 'row', gap: 8 },
  backBtn: {
    paddingVertical: 16,
    paddingHorizontal: 22,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backTxt: { fontFamily: Fonts.jakartaExtraBold, fontSize: 11, letterSpacing: 1.4, color: 'rgba(255,255,255,0.55)' },
  primaryWrap: { flex: 1 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 16,
    borderRadius: 14,
  },
  primaryLight: { backgroundColor: '#fff' },
  primaryTxt: { fontFamily: Fonts.jakartaExtraBold, fontSize: 13, letterSpacing: 1 },
});
