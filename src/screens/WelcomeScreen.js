// Welcome — first screen of the signed-out experience. Value-first: the
// InBetween mark, three benefit lines, then a single CTA into registration.
// Set entirely in TT Travels Next, on the cream + gold onboarding palette.

import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fonts, Spacing, Onboard } from '../theme';

const VALUE_PROPS = [
  'Focus points from every lesson',
  'Train solo or as a couple',
  'Walk into your private ready',
];

export default function WelcomeScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.safe}>
      {/* Soft gold halo behind the mark + a wider wash rising from the base. */}
      <View style={styles.haloWrap} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="halo" cx="50%" cy="34%" r="42%">
              <Stop offset="0" stopColor={Onboard.gold} stopOpacity="0.22" />
              <Stop offset="1" stopColor={Onboard.gold} stopOpacity="0" />
            </RadialGradient>
            <RadialGradient id="baseWash" cx="50%" cy="100%" r="65%">
              <Stop offset="0" stopColor={Onboard.gold} stopOpacity="0.14" />
              <Stop offset="1" stopColor={Onboard.gold} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#baseWash)" />
          <Rect width="100%" height="100%" fill="url(#halo)" />
        </Svg>
      </View>

      <View style={styles.content}>
        <View style={styles.spacer} />

        <View style={styles.hero}>
          <Image
            source={require('../../assets/splash-icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.wordmark}>InBetween</Text>
          <Text style={styles.tagline}>
            Know exactly what to work on,{'\n'}solo or together.
          </Text>

          <View style={styles.valueList}>
            {VALUE_PROPS.map((line) => (
              <View key={line} style={styles.valueRow}>
                <View style={styles.valueIcon}>
                  <Ionicons name="checkmark" size={15} color={Onboard.goldInk} />
                </View>
                <Text style={styles.valueText}>{line}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.spacer} />

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => navigation.navigate('Register')}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Create account</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.link}
          onPress={() => navigation.navigate('Login')}
          activeOpacity={0.7}
        >
          <Text style={styles.linkText}>
            Already have an account? <Text style={styles.linkBold}>Sign in</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Onboard.bg },
  haloWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.side + 2,
    paddingBottom: 18,
  },
  spacer: { flex: 1 },
  hero: { alignItems: 'center' },
  logo: {
    width: 132,
    height: 132,
  },
  wordmark: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 36,
    letterSpacing: -1.4,
    color: Onboard.ink,
    marginTop: 6,
  },
  tagline: {
    fontFamily: Fonts.travelsRegular,
    fontSize: 15,
    color: Onboard.ink2,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 10,
  },
  valueList: {
    alignSelf: 'stretch',
    marginTop: 26,
    gap: 13,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  valueIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: Onboard.goldTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueText: {
    fontFamily: Fonts.travelsMedium,
    fontSize: 14,
    color: Onboard.ink2,
  },
  primaryBtn: {
    backgroundColor: Onboard.ink,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontFamily: Fonts.ttDemiBold,
    fontSize: 15,
    color: '#FFFFFF',
  },
  link: {
    alignItems: 'center',
    marginTop: 16,
  },
  linkText: {
    fontFamily: Fonts.travelsRegular,
    fontSize: 13,
    color: Onboard.ink2,
  },
  linkBold: {
    fontFamily: Fonts.ttDemiBold,
    color: Onboard.goldInk,
  },
});
