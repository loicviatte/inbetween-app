import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, {
  Polygon,
  Line,
  Circle,
  Text as SvgText,
  Defs,
  RadialGradient,
  Stop,
} from 'react-native-svg';
import { Fonts } from '../theme';

const VIEWBOX_W = 280;
const VIEWBOX_H = 240;
const CX = 140;
const CY = 120;
const R_OUTER = 84;
const LABEL_R = R_OUTER + 26;

export const RADAR_LABELS = ['Stability', 'Technical', 'Strength', 'Creativity', 'Musicality'];
// Top → clockwise (pentagon)
const ANGLES = [-90, -18, 54, 126, 198].map((a) => (a * Math.PI) / 180);

function vertex(r, i) {
  return {
    x: CX + r * Math.cos(ANGLES[i]),
    y: CY + r * Math.sin(ANGLES[i]),
  };
}

function ringPoints(frac) {
  return ANGLES.map((_, i) => {
    const { x, y } = vertex(R_OUTER * frac, i);
    return `${x},${y}`;
  }).join(' ');
}

function dataPoints(scores) {
  return scores
    .map((s, i) => {
      const { x, y } = vertex(R_OUTER * Math.max(0, Math.min(1, s)), i);
      return `${x},${y}`;
    })
    .join(' ');
}

export default function RadarChart({ scores = [0.6, 0.75, 0.55, 0.65, 0.8], strongestIndex = null }) {
  const points = dataPoints(scores);

  return (
    <View style={styles.container}>
      <Svg width="100%" height={VIEWBOX_H} viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}>
        <Defs>
          <RadialGradient id="goldFill" cx="50%" cy="55%" r="60%">
            <Stop offset="0%" stopColor="#F6D27A" stopOpacity={0.75} />
            <Stop offset="100%" stopColor="#E8B530" stopOpacity={0.42} />
          </RadialGradient>
        </Defs>

        {/* 3 rings */}
        {[1, 0.66, 0.33].map((frac, i) => (
          <Polygon
            key={i}
            points={ringPoints(frac)}
            fill="none"
            stroke="rgba(10,10,10,0.06)"
            strokeWidth={1}
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
              stroke="rgba(10,10,10,0.05)"
              strokeWidth={1}
            />
          );
        })}

        {/* Data polygon */}
        <Polygon
          points={points}
          fill="url(#goldFill)"
          stroke="#E8B530"
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* Vertex dots — strongest gets a slightly larger dot */}
        {scores.map((s, i) => {
          const { x, y } = vertex(R_OUTER * Math.max(0, Math.min(1, s)), i);
          const isStrongest = i === strongestIndex;
          return (
            <Circle
              key={i}
              cx={x}
              cy={y}
              r={isStrongest ? 4.5 : 3.5}
              fill="#E8B530"
              stroke="#fff"
              strokeWidth={1.5}
            />
          );
        })}

        {/* Axis labels — eyebrow style */}
        {ANGLES.map((_, i) => {
          const lx = CX + LABEL_R * Math.cos(ANGLES[i]);
          const ly = CY + LABEL_R * Math.sin(ANGLES[i]);
          return (
            <SvgText
              key={i}
              x={lx}
              y={ly + 3}
              textAnchor="middle"
              fontSize={9.5}
              fontWeight="600"
              fontFamily={Fonts.jakartaSemiBold}
              fill="rgba(10,10,10,0.55)"
              letterSpacing={1.4}
            >
              {RADAR_LABELS[i].toUpperCase()}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%' },
});
