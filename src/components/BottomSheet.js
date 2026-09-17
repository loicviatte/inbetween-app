import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Animated,
  Pressable,
  StyleSheet,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Easing,
} from 'react-native';

const SCREEN_H = Dimensions.get('window').height;

/**
 * Bottom sheet modal done the right way: the dark backdrop FADES in while the
 * sheet SLIDES up from the bottom. RN's built-in `animationType="slide"` slides
 * the whole modal — backdrop included — so you'd see the dim band rise with the
 * sheet. Here the two are decoupled.
 *
 * Drop-in replacement for the old `<Modal animationType="slide"><overlay><sheet>`
 * pattern:
 *   <BottomSheet visible={x} onClose={close} sheetStyle={s.sheet} avoidKeyboard>
 *     {…handle + content…}
 *   </BottomSheet>
 */
export default function BottomSheet({
  visible,
  onClose,
  children,
  sheetStyle,
  avoidKeyboard = false,
  overlayColor = 'rgba(0,0,0,0.4)',
  dismissable = true,
}) {
  // Keep the modal mounted through the exit animation, then unmount.
  const [mounted, setMounted] = useState(visible);
  const ty = useRef(new Animated.Value(SCREEN_H)).current;
  const fade = useRef(new Animated.Value(0)).current;

  // Two races had to go, both showing up as "the screen dims and no sheet
  // arrives", about every other tap:
  //   · the enter animation was started in the same commit that mounted the
  //     sheet, so on the native driver it could be handed a view that wasn't
  //     attached yet and simply not play — dim at full, sheet still off-screen;
  //   · reopening mid-close left two runs attached to the same values, and
  //     setValue between them is not reliable on the native driver.
  // So: never setValue, animate from wherever the value is, start the entrance
  // only once the sheet is in the tree, and let only the current intent unmount.
  const closingRef = useRef(false);

  const enter = useCallback(() => {
    closingRef.current = false;
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(ty, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [fade, ty]);

  useEffect(() => {
    if (visible) {
      closingRef.current = false;
      if (mounted) enter();   // already in the tree — animate straight away
      else setMounted(true);  // the effect below runs it once it is
    } else if (mounted) {
      closingRef.current = true;
      Animated.parallel([
        Animated.timing(fade, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(ty, { toValue: SCREEN_H, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished && closingRef.current) setMounted(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // The sheet has just been put in the tree: now the native side has a view to
  // animate.
  useEffect(() => {
    if (mounted && visible && !closingRef.current) enter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  if (!mounted) return null;

  const close = dismissable ? onClose : () => {};

  const body = (
    <Pressable style={styles.fill} onPress={close}>
      {/* Backdrop — fades only, never slides */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: overlayColor, opacity: fade }]}
      />
      {/* Sheet — slides up; tap inside is swallowed so it doesn't close */}
      <Animated.View style={{ transform: [{ translateY: ty }] }}>
        <Pressable style={sheetStyle} onPress={() => {}}>
          {children}
        </Pressable>
      </Animated.View>
    </Pressable>
  );

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {avoidKeyboard ? (
        <KeyboardAvoidingView
          // 'padding' on BOTH platforms: this sheet lives inside a
          // statusBarTranslucent Modal, and Android Modals don't auto-resize
          // for the keyboard — leaving Android with no behavior meant the
          // keyboard covered the sheet's inputs. 'padding' lifts the
          // flex-end sheet by the keyboard height on Android too.
          behavior="padding"
          style={styles.fill}
        >
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
});
