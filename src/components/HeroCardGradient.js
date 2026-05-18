import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * The signature brown→black gradient used by every dark "hero" card in the
 * coach UI (focus point reviews, merges, name matches, questions, approve
 * confirm, class context sheet, …).
 *
 * Centralised here so:
 *   - the gradient stops/positions stay perfectly identical across cards,
 *   - React can skip re-rendering the gradient on parent updates (memoised),
 *   - swapping it for a pre-rendered image later only touches one file.
 *
 * Drop it directly inside any rounded card View — it lays itself out via
 * absoluteFill, so the parent just needs `overflow: 'hidden'`.
 */
const HeroCardGradient = memo(function HeroCardGradient() {
  return (
    <LinearGradient
      colors={['#4A3A18', '#1F1810', '#0A0A0A']}
      locations={[0, 0.4, 0.85]}
      start={{ x: 0.85, y: 1.18 }}
      end={{ x: 0.05, y: -0.2 }}
      style={StyleSheet.absoluteFillObject}
    />
  );
});

export default HeroCardGradient;
