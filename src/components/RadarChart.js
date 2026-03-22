import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polygon, Line, Circle, Text as SvgText } from 'react-native-svg';
import { Fonts } from '../theme';

const SIZE = 200;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R_OUTER = 72;
const LABELS = ['Stability', 'Technicality', 'Strength', 'Creativity', 'Musicality'];
// Angles starting from top, going clockwise
const ANGLES = [-90, -18, 54, 126, 198].map((a) => (a * Math.PI) / 180);

function vertex(r, i) {
  return {
    x: CX + r * Math.cos(ANGLES[i]),
    y: CY + r * Math.sin(ANGLES[i]),
  };
}

function polygonPoints(scores) {
  return scores
    .map((s, i) => {
      const { x, y } = vertex(R_OUTER * s, i);
      return `${x},${y}`;
    })
    .join(' ');
}

const outerPoints = ANGLES.map((_, i) => {
  const { x, y } = vertex(R_OUTER, i);
  return `${x},${y}`;
}).join(' ');

export default function RadarChart({ scores = [0.7, 0.55, 0.8, 0.5, 0.65] }) {
  const dataPoints = polygonPoints(scores);

  return (
    <View style={styles.container}>
      <Svg width={SIZE} height={SIZE}>
        {/* Grid rings */}
        {[0.33, 0.66, 1].map((frac, ri) => (
          <Polygon
            key={ri}
            points={polygonPoints([frac, frac, frac, frac, frac])}
            fill="none"
            stroke="rgba(17,12,17,0.08)"
            strokeWidth={0.75}
          />
        ))}

        {/* Axis lines */}
        {ANGLES.map((_, i) => {
          const { x, y } = vertex(R_OUTER, i);
          return (
            <Line
              key={i}
              x1={CX}
              y1={CY}
              x2={x}
              y2={y}
              stroke="rgba(17,12,17,0.08)"
              strokeWidth={0.75}
            />
          );
        })}

        {/* Data polygon */}
        <Polygon
          points={dataPoints}
          fill="rgba(255,193,7,0.45)"
          stroke="#F5C842"
          strokeWidth={1.5}
        />

        {/* Axis labels */}
        {ANGLES.map((angle, i) => {
          const LABEL_R = R_OUTER + 18;
          const lx = CX + LABEL_R * Math.cos(ANGLES[i]);
          const ly = CY + LABEL_R * Math.sin(ANGLES[i]);
          return (
            <SvgText
              key={i}
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={8}
              fill="rgba(17,12,17,0.6)"
            >
              {LABELS[i]}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
});
