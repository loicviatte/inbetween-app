// ───────────────────────────────────────────────────────────────────────
// MicSyncFlowModal — the v2 full-screen DJI mic sync experience.
//
// Purely presentational: every bit of state comes from DjiSyncContext. The
// phase drives which screen shows:
//   waiting → Connect   syncing → Importing   done → Complete   error → Error
//
// It's mounted once at the coach-navigator level (inside DjiSyncProvider) so
// it overlays every coach screen. Visibility = context.flowOpen.
// ───────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle } from 'react-native-svg';
import { Fonts } from '../theme';
import { useDjiSync } from '../context/DjiSyncContext';
import { BrowseTabChip, NoNameChip } from './DjiFilesChips';

const MIC_IMG = require('../../assets/dji-setup/dji-mic2.webp');

const GOLD_500 = '#E8B530';
const GOLD_300 = '#F6D27A';
const RED = '#D44545';
const RED_SOFT = '#FF8C8C';
const GREEN = '#2FBF71'; // success accent for the "Synced" screen
const RING_C = 2 * Math.PI * 48; // circumference for the r=48 orbital ring

// ─── Formatters ─────────────────────────────────────────────────────────
function fmtSize(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}
function fmtRuntime(sec) {
  if (!sec || sec <= 0) return '0m';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}`;
  return `${m} min`;
}
function fmtEta(sec) {
  if (sec == null) return null;
  if (sec < 60) return `~${Math.max(1, sec)}s left`;
  return `~${Math.round(sec / 60)} min left`;
}

// Gently pulsing text — used for the live stage label so the coach reads it as
// "working" even while the % is frozen during the mic-read + transcode phases.
function PulseText({ children, style }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(v, {
          toValue: 0.35,
          duration: 720,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(v, {
          toValue: 1,
          duration: 720,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [v]);
  return <Animated.Text style={[style, { opacity: v }]}>{children}</Animated.Text>;
}

export default function MicSyncFlowModal() {
  const sync = useDjiSync();
  // Read insets from the app-level SafeAreaProvider (always measured/correct)
  // rather than a SafeAreaView INSIDE the <Modal>: the modal presents in a
  // separate native container whose inset measurement races to 0 on ~half of
  // opens, cropping the close button + bottom actions against the screen edge.
  const insets = useSafeAreaInsets();
  if (!sync) return null;

  const {
    flowOpen,
    phase,
    progressPct,
    fileIdx,
    fileTotal,
    fileSizeBytes,
    etaSec,
    stageLabel,
    imported,
    unmatched,
    summary,
    errorInfo,
    runInBackground,
    cancelFlow,
    retry,
    acknowledgeDone,
    micConnectedCheck,
    openGrantInstructions,
    pickFolderFromInstructions,
  } = sync;

  // After a bit on the Connect screen with no auto-detection, surface a subtle
  // "Nothing happening?" link. Tapping it reveals "Is your mic connected?" +
  // the confirm button — so a coach who's slow to plug in isn't rushed into
  // re-granting folder access (and mis-picking a folder).
  const [helperVisible, setHelperVisible] = useState(false);
  const [micQuestionOpen, setMicQuestionOpen] = useState(false);
  useEffect(() => {
    if (phase !== 'waiting') {
      setHelperVisible(false);
      setMicQuestionOpen(false);
      return;
    }
    const t = setTimeout(() => setHelperVisible(true), 15000);
    return () => clearTimeout(t);
  }, [phase]);

  return (
    <Modal
      visible={flowOpen}
      animationType="slide"
      transparent={false}
      onRequestClose={cancelFlow}
      statusBarTranslucent
    >
      <View style={[s.stage, phase === 'error' && s.stageErr]}>
        <View style={[s.safe, { paddingTop: Math.max(insets.top, 8), paddingBottom: Math.max(insets.bottom, 8) }]}>
          {/* Top row: close + context label */}
          <View style={s.topRow}>
            <TouchableOpacity
              style={[s.closeBtn, phase === 'syncing' && { opacity: 0.35 }]}
              onPress={phase === 'syncing' ? runInBackground : cancelFlow}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={16} color="rgba(255,255,255,0.75)" />
            </TouchableOpacity>
            <Text style={[s.ctx, phase === 'error' && s.ctxErr]}>
              {phase === 'waiting'
                ? '01 · CONNECT'
                : phase === 'granting'
                ? '01 · GRANT ACCESS'
                : phase === 'syncing'
                ? '02 · UPLOADING'
                : phase === 'done'
                ? '03 · COMPLETE'
                : '— · ERROR'}
            </Text>
            <View style={{ width: 32 }} />
          </View>

          {/* Hero */}
          <View style={s.hero}>
            {phase === 'waiting' && <ConnectScreen />}
            {phase === 'granting' && <GrantInstructionsScreen />}
            {phase === 'syncing' && (
              <ImportingScreen
                progressPct={progressPct}
                fileIdx={fileIdx}
                fileTotal={fileTotal}
                fileSizeBytes={fileSizeBytes}
                etaSec={etaSec}
                stageLabel={stageLabel}
              />
            )}
            {phase === 'done' && <CompleteScreen summary={summary} imported={imported} unmatched={unmatched} />}
            {phase === 'error' && (
              <ErrorScreen errorInfo={errorInfo} fileIdx={fileIdx} fileTotal={fileTotal} />
            )}
          </View>

          {/* Bottom actions */}
          <View style={s.bottom}>
            {phase === 'waiting' && (
              <>
                {micQuestionOpen ? (
                  <>
                    <Text style={s.micQuestion}>Is your mic connected?</Text>
                    <TouchableOpacity style={s.retryBtn} onPress={micConnectedCheck} activeOpacity={0.88}>
                      <Ionicons name="hardware-chip" size={15} color="#0A0A0A" />
                      <Text style={s.retryBtnText}>MIC IS CONNECTED</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  helperVisible && (
                    <TouchableOpacity onPress={() => setMicQuestionOpen(true)} activeOpacity={0.7}>
                      <Text style={s.helperLink}>Nothing happening?</Text>
                    </TouchableOpacity>
                  )
                )}
                <TouchableOpacity onPress={cancelFlow} activeOpacity={0.7}>
                  <Text style={s.ghostLink}>CANCEL</Text>
                </TouchableOpacity>
              </>
            )}
            {phase === 'granting' && (
              <>
                <TouchableOpacity style={s.retryBtn} onPress={pickFolderFromInstructions} activeOpacity={0.88}>
                  <Ionicons name="folder-open" size={15} color="#0A0A0A" />
                  <Text style={s.retryBtnText}>START</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={cancelFlow} activeOpacity={0.7}>
                  <Text style={s.ghostLink}>CANCEL</Text>
                </TouchableOpacity>
              </>
            )}
            {phase === 'syncing' && (
              <TouchableOpacity onPress={runInBackground} activeOpacity={0.7}>
                <Text style={s.ghostLink}>RUN IN BACKGROUND</Text>
              </TouchableOpacity>
            )}
            {phase === 'done' && (
              <TouchableOpacity style={s.doneBtn} onPress={acknowledgeDone} activeOpacity={0.85}>
                <Text style={s.doneBtnText}>DONE</Text>
              </TouchableOpacity>
            )}
            {phase === 'error' && (
              <>
                {errorInfo?.kind === 'no-access' ? (
                  <TouchableOpacity style={s.retryBtn} onPress={openGrantInstructions} activeOpacity={0.88}>
                    <Ionicons name="folder-open" size={15} color="#0A0A0A" />
                    <Text style={s.retryBtnText}>GRANT ACCESS</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={s.retryBtn} onPress={retry} activeOpacity={0.88}>
                    <Ionicons name="refresh" size={15} color="#0A0A0A" />
                    <Text style={s.retryBtnText}>
                      {errorInfo?.kind === 'disconnect' ? 'RETRY SYNC' : 'TRY AGAIN'}
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={cancelFlow} activeOpacity={0.7}>
                  <Text style={s.ghostLink}>CANCEL</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Mic image with an optional badge overlay ────────────────────────────
// `children` render BEHIND the mic (e.g. the orbital ring); `centerOverlay`
// renders IN FRONT of it, centered (e.g. the offline / no-access badge).
function MicArt({ children, dim, badge, badgeErr, badgeOk, centerOverlay }) {
  return (
    <View style={s.micHero}>
      {children}
      <Image
        source={MIC_IMG}
        style={[s.micImg, dim && { opacity: 0.55 }]}
        contentFit="contain"
      />
      {centerOverlay && (
        <View style={s.centerOverlay} pointerEvents="none">
          {centerOverlay}
        </View>
      )}
      {badge && (
        <View style={[s.badge, badgeErr && s.badgeErr, badgeOk && s.badgeOk]}>{badge}</View>
      )}
    </View>
  );
}

// ─── Connect (waiting) ───────────────────────────────────────────────────
function ConnectScreen() {
  const p1 = useRef(new Animated.Value(0)).current;
  const p2 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const mk = (v, delay) =>
      Animated.loop(
        Animated.timing(v, {
          toValue: 1,
          duration: 2200,
          delay,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      );
    const a = mk(p1, 0);
    const b = mk(p2, 750);
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [p1, p2]);

  const ring = (v) => ({
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.62, 1.15] }) }],
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
  });

  return (
    <>
      <MicArt>
        <Animated.View style={[s.pulse, ring(p1)]} pointerEvents="none" />
        <Animated.View style={[s.pulse, ring(p2)]} pointerEvents="none" />
      </MicArt>
      <View style={s.copy}>
        <View style={s.eyebrowRow}>
          <View style={s.eyebrowDot} />
          <Text style={s.eyebrow}>WAITING FOR MIC</Text>
        </View>
        <Text style={s.h2}>Plug in your receiver.</Text>
        <Text style={s.p}>
          Connect the USB-C dongle to your phone — we'll pick it up
          automatically.
        </Text>
      </View>
    </>
  );
}

// ─── Grant access (guided folder-pick instructions) ─────────────────────
function GrantInstructionsScreen() {
  return (
    <View style={s.grantWrap}>
      <View style={s.eyebrowRow}>
        <View style={[s.eyebrowDot, { opacity: 1 }]} />
        <Text style={s.eyebrow}>ONE-TIME SETUP</Text>
      </View>
      <Text style={s.grantTitle}>Point us to your mic.</Text>
      <Text style={s.grantIntro}>Tap Start, then:</Text>
      <View style={s.grantSteps}>
        <View style={s.grantStep}>
          <Text style={s.grantStepText}>
            <Text style={s.grantStepNum}>1  </Text>Tap <Text style={s.grantStrong}>Browse</Text> at the bottom.
          </Text>
          <BrowseTabChip />
        </View>
        <View style={s.grantStep}>
          <Text style={s.grantStepText}>
            <Text style={s.grantStepNum}>2  </Text>Tap <Text style={s.grantStrong}>NO NAME</Text> under Locations.
          </Text>
          <NoNameChip />
          <Text style={s.grantHint}>If NO NAME isn’t there, make sure the mic is turned on.</Text>
        </View>
        <View style={s.grantStep}>
          <Text style={s.grantStepText}>
            <Text style={s.grantStepNum}>3  </Text>Tap <Text style={s.grantStrong}>Open</Text> at the top-right.
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─── Importing (syncing) ─────────────────────────────────────────────────
function ImportingScreen({ progressPct, fileIdx, fileTotal, fileSizeBytes, etaSec, stageLabel }) {
  const dash = `${(Math.max(0, Math.min(100, progressPct)) / 100) * RING_C} ${RING_C}`;
  const eta = fmtEta(etaSec);
  return (
    <>
      <MicArt>
        <View style={s.orbit} pointerEvents="none">
          <Svg viewBox="0 0 100 100" width="100%" height="100%" style={{ transform: [{ rotate: '-90deg' }] }}>
            <Circle cx="50" cy="50" r="48" stroke="rgba(255,255,255,0.06)" strokeWidth="1" fill="none" />
            <Circle
              cx="50"
              cy="50"
              r="48"
              stroke={GOLD_500}
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={dash}
            />
          </Svg>
        </View>
      </MicArt>
      <View style={s.progressStack}>
        <PulseText style={s.progressEyebrow}>{(stageLabel || 'Preparing…').toUpperCase()}</PulseText>
        <Text style={s.bigNum}>
          {Math.round(progressPct)}
          <Text style={s.bigNumPct}>%</Text>
        </Text>
        <View style={s.thinLine} />
        <View style={s.thinBar}>
          <View style={[s.thinBarFill, { width: `${Math.max(3, progressPct)}%` }]} />
        </View>
        <View style={s.detailsRow}>
          <Text style={s.detailsText}>
            {fileTotal > 0 ? (
              <>
                <Text style={s.detailsB}>{String(fileIdx).padStart(2, '0')}</Text> of {fileTotal}
              </>
            ) : (
              'Preparing…'
            )}
          </Text>
          {eta ? <Text style={s.detailsText}>{eta}</Text> : null}
        </View>
        {fileTotal > 0 && (
          <View style={s.fileChip}>
            <Ionicons name="arrow-down" size={11} color={GOLD_500} />
            <Text style={s.fileChipName}>Recording {fileIdx} of {fileTotal}</Text>
            <Text style={s.fileChipSize}>{fmtSize(fileSizeBytes)}</Text>
          </View>
        )}
      </View>
    </>
  );
}

// ─── Complete (done) ─────────────────────────────────────────────────────
function CompleteScreen({ summary, imported, unmatched }) {
  const files = summary?.files ?? imported + unmatched;
  const noneNew = files === 0;
  return (
    <>
      <MicArt
        badgeOk
        badge={
          <Ionicons name="checkmark" size={18} color="#fff" />
        }
      >
        <View style={s.orbit} pointerEvents="none">
          <Svg viewBox="0 0 100 100" width="100%" height="100%" style={{ transform: [{ rotate: '-90deg' }] }}>
            <Circle cx="50" cy="50" r="48" stroke="rgba(255,255,255,0.06)" strokeWidth="1" fill="none" />
            <Circle cx="50" cy="50" r="48" stroke={GREEN} strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </Svg>
        </View>
      </MicArt>
      <View style={s.copy}>
        <View style={s.eyebrowRow}>
          <View style={[s.eyebrowDot, s.eyebrowDotOk, { opacity: 1 }]} />
          <Text style={[s.eyebrow, s.eyebrowOk]}>ALL DONE</Text>
        </View>
        <Text style={s.h2}>{noneNew ? 'Up to date.' : 'Synced.'}</Text>
        <Text style={s.p}>
          {noneNew
            ? "Nothing new on the mic — everything's already imported."
            : `${files} ${files === 1 ? 'recording' : 'recordings'} landed safely.${
                unmatched > 0
                  ? ` ${unmatched} couldn't be matched to a class — saved for review.`
                  : ' Ready when you are to tag them.'
              }`}
        </Text>
      </View>
      {!noneNew && summary && (
        <View style={s.summaryGrid}>
          <View style={s.summaryCell}>
            <Text style={s.summaryN}>{summary.files}</Text>
            <Text style={s.summaryL}>FILES</Text>
          </View>
          <View style={[s.summaryCell, s.summaryDivider]}>
            <Text style={s.summaryN}>{fmtRuntime(summary.runtimeSec)}</Text>
            <Text style={s.summaryL}>RUNTIME</Text>
          </View>
          <View style={s.summaryCell}>
            <Text style={s.summaryN}>{fmtSize(summary.sizeBytes)}</Text>
            <Text style={s.summaryL}>SIZE</Text>
          </View>
        </View>
      )}
    </>
  );
}

// ─── Error ───────────────────────────────────────────────────────────────
function ErrorScreen({ errorInfo, fileIdx, fileTotal }) {
  const kind = errorInfo?.kind ?? 'generic';
  const remaining = fileTotal > 0 ? Math.max(0, fileTotal - fileIdx) : 0;

  const heading =
    kind === 'disconnect'
      ? 'Mic disconnected.'
      : kind === 'offline'
      ? 'No internet connection.'
      : kind === 'no-access'
      ? 'Mic access needed.'
      : "We couldn't finish.";
  const eyebrow =
    kind === 'disconnect'
      ? 'SYNC INTERRUPTED'
      : kind === 'offline'
      ? 'OFFLINE'
      : kind === 'no-access'
      ? 'ACCESS LOST'
      : 'SOMETHING WENT WRONG';
  const body =
    kind === 'disconnect'
      ? 'We saved what we imported so far. Reconnect the receiver and pick up where we left off.'
      : kind === 'offline'
      ? "Your recordings are copied and ready — they'll upload automatically as soon as you're back online."
      : kind === 'no-access'
      ? 'Make sure your mic is plugged in, then tap Grant access and pick NO NAME in the Files screen.'
      : "An unexpected error stopped the import. Your existing files weren't touched.";
  const detail =
    kind === 'disconnect'
      ? fileTotal > 0
        ? `${String(fileIdx).padStart(2, '0')} of ${fileTotal} imported before disconnect. ${remaining} remaining.`
        : 'The mic was unplugged mid-import.'
      : kind === 'offline'
      ? "Nothing's lost. Keep the app open and we'll finish the moment the connection returns."
      : kind === 'no-access'
      ? errorInfo?.message || 'Your saved folder link expired or was from an earlier install.'
      : errorInfo?.message || 'Import failed unexpectedly.';
  const code =
    kind === 'disconnect'
      ? 'ERR · USB-C LINK LOST'
      : kind === 'offline'
      ? 'ERR · NETWORK UNREACHABLE'
      : kind === 'no-access'
      ? 'ERR · FOLDER ACCESS LOST'
      : 'ERR · IMPORT FAILED';

  // offline + no-access show a centered badge over a dimmed mic instead of the
  // red orbital arc.
  const centerBadge = kind === 'offline' ? 'cloud-offline' : kind === 'no-access' ? 'folder-open' : null;
  const dimMic = kind === 'offline' || kind === 'no-access';

  return (
    <>
      <MicArt
        dim={dimMic}
        badgeErr
        badge={
          centerBadge ? null : (
            <Ionicons name={kind === 'disconnect' ? 'close' : 'alert'} size={16} color="#fff" />
          )
        }
        centerOverlay={
          centerBadge ? (
            <View style={s.centerBadgeCircle}>
              <Ionicons name={centerBadge} size={26} color={RED_SOFT} />
            </View>
          ) : null
        }
      >
        {!centerBadge && (
          <View style={s.orbit} pointerEvents="none">
            <Svg viewBox="0 0 100 100" width="100%" height="100%" style={{ transform: [{ rotate: '-90deg' }] }}>
              <Circle cx="50" cy="50" r="48" stroke="rgba(255,255,255,0.06)" strokeWidth="1" fill="none" />
              <Circle
                cx="50"
                cy="50"
                r="48"
                stroke={RED}
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${0.44 * RING_C} ${RING_C}`}
              />
            </Svg>
          </View>
        )}
      </MicArt>
      <View style={s.copy}>
        <View style={s.eyebrowRow}>
          <View style={[s.eyebrowDot, s.eyebrowDotErr]} />
          <Text style={[s.eyebrow, s.eyebrowErr]}>{eyebrow}</Text>
        </View>
        <Text style={s.h2}>{heading}</Text>
        <Text style={s.p}>{body}</Text>
      </View>
      <View style={s.errDetail}>
        <Ionicons name="information-circle-outline" size={13} color={RED_SOFT} style={{ marginTop: 1 }} />
        <View style={{ flex: 1 }}>
          <Text style={s.errDetailText}>{detail}</Text>
          <Text style={s.errCode}>{code}</Text>
        </View>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  stage: { flex: 1, backgroundColor: '#060606' },
  stageErr: { backgroundColor: '#0A0606' },
  safe: { flex: 1 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 8,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctx: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9.5,
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.35)',
  },
  ctxErr: { color: RED_SOFT },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  bottom: { paddingHorizontal: 20, paddingBottom: 8, alignItems: 'center' },

  micHero: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micImg: { width: 150, height: 150 },
  orbit: { position: 'absolute', width: 200, height: 200 },
  pulse: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 32,
    borderWidth: 0.5,
    borderColor: 'rgba(232,181,48,0.35)',
  },
  badge: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: GOLD_300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeErr: { backgroundColor: RED },
  badgeOk: { backgroundColor: GREEN },
  // Fills the mic frame and centers whatever it holds, ON TOP of the (dimmed)
  // mic — used for the offline / no-access badge.
  centerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerBadgeCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(212,69,69,0.20)',
    borderWidth: 0.5,
    borderColor: 'rgba(212,69,69,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  copy: { marginTop: 30, alignItems: 'center', maxWidth: 300 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  eyebrowDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: GOLD_500 },
  eyebrowDotErr: { backgroundColor: RED_SOFT },
  eyebrowDotOk: { backgroundColor: GREEN },
  eyebrow: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9.5,
    letterSpacing: 3,
    color: GOLD_500,
  },
  eyebrowErr: { color: RED_SOFT },
  eyebrowOk: { color: GREEN },
  h2: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 30,
    color: '#fff',
    letterSpacing: -0.6,
    textAlign: 'center',
    marginBottom: 12,
  },
  p: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13.5,
    lineHeight: 21,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
  },

  // ─── Grant-access instructions ──────────────────────────────────────
  grantWrap: { alignItems: 'center', maxWidth: 320, paddingHorizontal: 4 },
  grantTitle: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 26,
    color: '#fff',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 40,
  },
  grantIntro: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    marginBottom: 18,
  },
  grantSteps: { alignSelf: 'stretch', gap: 14 },
  grantStep: { alignItems: 'center', gap: 8 },
  grantStepText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 20,
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  grantStepNum: { fontFamily: Fonts.jakartaExtraBold, color: GOLD_500 },
  grantStrong: { fontFamily: Fonts.jakartaExtraBold, color: GOLD_500 },
  grantHint: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.42)',
    lineHeight: 16,
    textAlign: 'center',
  },

  progressStack: { marginTop: 26, alignItems: 'center', width: '100%', maxWidth: 300 },
  progressEyebrow: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9.5,
    letterSpacing: 3,
    color: GOLD_500,
    marginBottom: 6,
  },
  bigNum: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 62,
    color: '#fff',
    letterSpacing: -2,
    includeFontPadding: false,
  },
  bigNumPct: { fontSize: 22, color: 'rgba(255,255,255,0.35)' },
  thinLine: {
    height: 1,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 14,
  },
  thinBar: {
    height: 3,
    alignSelf: 'stretch',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
    marginBottom: 12,
  },
  thinBarFill: { height: '100%', borderRadius: 999, backgroundColor: GOLD_500 },
  detailsRow: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch' },
  detailsText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 10,
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
  },
  detailsB: { color: 'rgba(255,255,255,0.85)' },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'stretch',
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  fileChipName: {
    flex: 1,
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
  },
  fileChipSize: { fontFamily: Fonts.jakartaMedium, fontSize: 11, color: 'rgba(255,255,255,0.35)' },

  summaryGrid: {
    flexDirection: 'row',
    marginTop: 24,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 300,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 14,
  },
  summaryCell: { flex: 1, alignItems: 'center', gap: 4 },
  summaryDivider: {
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  summaryN: { fontFamily: Fonts.ttDemiBold, fontSize: 19, color: '#fff', letterSpacing: -0.4 },
  summaryL: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 8.5,
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.4)',
  },

  errDetail: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 22,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 300,
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(212,69,69,0.06)',
    borderWidth: 0.5,
    borderColor: 'rgba(212,69,69,0.28)',
  },
  errDetailText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11.5,
    lineHeight: 17,
    color: RED_SOFT,
  },
  errCode: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9,
    letterSpacing: 1.2,
    color: 'rgba(255,140,140,0.6)',
    marginTop: 5,
  },

  ghostLink: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 11,
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.4)',
    paddingVertical: 14,
    textAlign: 'center',
  },
  helperLink: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 12.5,
    color: GOLD_500,
    textDecorationLine: 'underline',
    textAlign: 'center',
    paddingVertical: 12,
  },
  micQuestion: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.72)',
    textAlign: 'center',
    marginBottom: 12,
  },
  doneBtn: {
    alignSelf: 'stretch',
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
  },
  doneBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    letterSpacing: 2,
    color: '#fff',
  },
  retryBtn: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: GOLD_500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtnText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    letterSpacing: 1.5,
    color: '#0A0A0A',
  },
});
