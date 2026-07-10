import React, { useEffect, useRef, useState } from 'react';
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

  useEffect(() => {
    if (visible) {
      setMounted(true);
      ty.setValue(SCREEN_H);
      fade.setValue(0);
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(ty, {
          toValue: 0,
          duration: 320,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(fade, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(ty, {
          toValue: SCREEN_H,
          duration: 240,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

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
