import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { BlurMask, Canvas, Circle, DashPathEffect, Group, Path, SweepGradient, vec } from "@shopify/react-native-skia";
import Animated, { Extrapolation, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import { RadarGlow } from "../components/RadarGlow";
import { CATEGORY_COLORS, SPACE_CADET } from "../theme/spaceCadet";
import { triggerSelectionHaptic } from "../utils/haptics";

// Around the radar the competences follow the colour wheel (blue → cyan → lime → orange → crimson → violet → back
// to blue), so the angular gradient that paints the shape flows like a rainbow and closes on itself.
const AXES = ["spatial", "logic", "memory", "multitasking", "attention", "mentalMath"];
const AXIS_COLORS = AXES.map((key) => CATEGORY_COLORS[key]);
const SWEEP_COLORS = [...AXIS_COLORS, AXIS_COLORS[0]];
const MAX_SCORE = 1000;
// One word per competence, like everywhere on this screen.
const SHORT_LABELS = { spatial: "Spatial", logic: "Logic", memory: "Memory", multitasking: "Multitasking", attention: "Attention", mentalMath: "Math" };
// true: the shape is a live shader (breathing rim, travelling light). false: the static Skia version.
const LIVE_RADAR = true;
const RINGS = [0.25, 0.5, 0.75, 1];

// Placeholder data until the statistics system exists. Competence scores run from 0 to 1000 and come from the
// daily training only. `previous` is the period before (none for "all time").
const PERIODS = [
  { key: "week", label: "Week", now: "This week", before: "Last week", current: [412, 760, 835, 548, 655, 590], previous: [455, 690, 800, 470, 700, 540] },
  { key: "month", label: "Month", now: "This month", before: "Last month", current: [440, 720, 790, 520, 640, 610], previous: [380, 650, 760, 560, 585, 500] },
  { key: "all", label: "All time", now: "All time", before: null, current: [470, 680, 745, 505, 610, 560], previous: null },
];
const TOTALS = [{ label: "MISSIONS", value: "27" }, { label: "PLAYED", value: "18 h 40" }, { label: "STREAK", value: "4 days" }, { label: "CADET SCORE", value: "178,214" }];
const RANKINGS = { spatial: 68, logic: 20, memory: 12, multitasking: 50, attention: 35, mentalMath: 41 };
const ACTIVITY_CELL = 13;
const ACTIVITY_GAP = 4;
const MAX_ACTIVITY_WEEKS = 30;
// Seven rows (Monday to Sunday), one column per week (as many as fit the screen), 0 (nothing) to 4 (a lot); fixed so the placeholder never flickers.
const ACTIVITY = Array.from({ length: MAX_ACTIVITY_WEEKS * 7 }, (_, index) => { const value = Math.abs(Math.sin(index * 12.9898 + 4.1) * 43758.5453) % 1; return value < 0.28 ? 0 : value < 0.5 ? 1 : value < 0.72 ? 2 : value < 0.9 ? 3 : 4; });
const ACTIVITY_ALPHA = [0.06, 0.2, 0.4, 0.68, 1];

const axisAngle = (index) => -Math.PI / 2 + (index * Math.PI * 2) / AXES.length;
function polygonPath(values, centerX, centerY, radius) {
  return `${values.map((value, index) => `${index ? "L" : "M"}${(centerX + Math.cos(axisAngle(index)) * radius * value).toFixed(2)} ${(centerY + Math.sin(axisAngle(index)) * radius * value).toFixed(2)}`).join(" ")} Z`;
}

// Eases the displayed numbers toward their target, so the shape morphs when the period changes.
function useEased(target) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    const startedAt = Date.now();
    let frame = null;
    const step = () => {
      const progress = Math.min(1, (Date.now() - startedAt) / 520);
      const eased = 1 - (1 - progress) ** 3;
      const next = target.map((value, index) => start[index] + (value - start[index]) * eased);
      from.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  return shown;
}

function Radar({ size, period, active }) {
  // The canvas is as wide as the screen but only as tall as the hexagon and its labels need.
  const center = size / 2;
  const radius = size * 0.285;
  const height = (radius + 58) * 2;
  const middle = height / 2;
  const current = useEased(period.current.map((score) => score / MAX_SCORE));
  // "All time" has no earlier period: the dashed outline folds onto the current shape and fades out.
  const previous = useEased((period.previous ?? period.current).map((score) => score / MAX_SCORE));
  const shape = polygonPath(current, center, middle, radius);
  const sweep = <SweepGradient c={vec(center, middle)} colors={SWEEP_COLORS} origin={vec(center, middle)} transform={[{ rotate: -Math.PI / 2 }]} />;

  return <View style={{ width: size, height }}>
    {LIVE_RADAR ? <RadarGlow values={current} colors={AXIS_COLORS} radiusShare={radius / size} active={active} /> : null}
    <Canvas style={StyleSheet.absoluteFill}>
      {RINGS.map((ring) => <Path key={ring} path={polygonPath(AXES.map(() => ring), center, middle, radius)} style="stroke" strokeWidth={1} color={ring === 1 ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.06)"} />)}
      {AXES.map((key, index) => <Path key={key} path={`M${center} ${middle} L${center + Math.cos(axisAngle(index)) * radius} ${middle + Math.sin(axisAngle(index)) * radius}`} style="stroke" strokeWidth={1} color="rgba(255,255,255,0.06)" />)}

      {/* The body of the shape is the live shader underneath (RadarGlow). With LIVE_RADAR off, it is painted here
          instead: a wide soft halo, a tinted body and a bright outline, all from the same rainbow. */}
      {LIVE_RADAR ? null : <>
        <Group opacity={0.5}><Path path={shape}>{sweep}<BlurMask blur={26} style="normal" /></Path></Group>
        <Group opacity={0.26}><Path path={shape}>{sweep}</Path></Group>
        <Group opacity={0.9}><Path path={shape} style="stroke" strokeWidth={5} strokeJoin="round">{sweep}<BlurMask blur={7} style="normal" /></Path></Group>
        <Path path={shape} style="stroke" strokeWidth={2} strokeJoin="round">{sweep}</Path>
      </>}
      {period.previous ? <Group opacity={0.8}><Path path={polygonPath(previous, center, middle, radius)} style="stroke" strokeWidth={1.4} strokeJoin="round">{sweep}<DashPathEffect intervals={[3, 5]} /></Path></Group> : null}

      {LIVE_RADAR ? null : AXES.map((key, index) => {
        const x = center + Math.cos(axisAngle(index)) * radius * current[index];
        const y = middle + Math.sin(axisAngle(index)) * radius * current[index];
        return <Group key={key}>
          <Circle cx={x} cy={y} r={9} color={AXIS_COLORS[index]} opacity={0.75}><BlurMask blur={8} style="normal" /></Circle>
          <Circle cx={x} cy={y} r={4.2} color={AXIS_COLORS[index]} />
        </Group>;
      })}
    </Canvas>
    {AXES.map((key, index) => {
      const x = center + Math.cos(axisAngle(index)) * (radius + 46);
      const y = middle + Math.sin(axisAngle(index)) * (radius + 34);
      return <View key={key} pointerEvents="none" style={[styles.axisLabel, { left: x - 60, top: y - 20 }]}>
        <Text style={styles.axisScore}>{Math.round(current[index] * MAX_SCORE)}</Text>
        <Text style={[styles.axisName, { color: AXIS_COLORS[index] }]} numberOfLines={1}>{SHORT_LABELS[key]}</Text>
      </View>;
    })}
  </View>;
}

function PageDot({ index, scrollX, width }) {
  const style = useAnimatedStyle(() => {
    const distance = Math.abs(scrollX.value / width - index);
    return { width: interpolate(distance, [0, 1], [22, 7], Extrapolation.CLAMP), opacity: interpolate(distance, [0, 1], [1, 0.32], Extrapolation.CLAMP) };
  });
  return <Animated.View style={[styles.pageDot, style]} />;
}

// `active`: whether this page is the one on screen (the live radar only animates then).
export function StatisticsScreen({ active = true }) {
  const { width } = useWindowDimensions();
  const [periodKey, setPeriodKey] = useState("week");
  const period = PERIODS.find((entry) => entry.key === periodKey);
  const scrollX = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => { scrollX.value = event.contentOffset.x; });
  const weeks = Math.min(MAX_ACTIVITY_WEEKS, Math.floor((width - 48 + ACTIVITY_GAP) / (ACTIVITY_CELL + ACTIVITY_GAP)));

  return <View style={styles.container}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.kicker}>CADET PROFILE</Text>
      <Text style={styles.title}>Statistics</Text>

      <View style={styles.radarWrap}><Radar size={Math.min(width, 400)} period={period} active={active} /></View>

      <View style={styles.legend}>
        <View style={styles.legendItem}><View style={styles.legendLine} /><Text style={styles.legendText}>{period.now}</Text></View>
        {period.before ? <View style={styles.legendItem}><View style={styles.legendDashes}>{[0, 1, 2].map((dash) => <View key={dash} style={styles.legendDash} />)}</View><Text style={styles.legendText}>{period.before}</Text></View> : null}
      </View>

      <View style={styles.segments}>
        {PERIODS.map((entry) => <Pressable key={entry.key} onPress={() => { void triggerSelectionHaptic(); setPeriodKey(entry.key); }} style={[styles.segment, entry.key === periodKey && styles.segmentActive]}>
          <Text style={[styles.segmentText, entry.key === periodKey && styles.segmentTextActive]}>{entry.label}</Text>
        </Pressable>)}
      </View>

      <Animated.ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} scrollEventThrottle={16} onScroll={onScroll} style={styles.pager}>
        <View style={[styles.page, { width }]}>
          <View style={styles.tiles}>{TOTALS.map((entry) => <View key={entry.label} style={styles.tile}>
            <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>{entry.value}</Text>
            <Text style={styles.tileLabel}>{entry.label}</Text>
          </View>)}</View>
        </View>
        <View style={[styles.page, { width }]}>
          <View style={styles.tiles}>{AXES.map((key) => <View key={key} style={[styles.tile, styles.tileThird]}>
            <Text style={[styles.tileValue, styles.tileValueSmall]} numberOfLines={1} adjustsFontSizeToFit>Top {RANKINGS[key]}%</Text>
            <View style={styles.rankLabel}><View style={[styles.rankDot, { backgroundColor: CATEGORY_COLORS[key] }]} /><Text style={[styles.tileLabel, styles.rankText, { color: CATEGORY_COLORS[key] }]} numberOfLines={1}>{SHORT_LABELS[key].toUpperCase()}</Text></View>
          </View>)}</View>
        </View>
        <View style={[styles.page, { width }]}>
          <View style={styles.activityTop}><Text style={styles.activityTitle}>Activity</Text><Text style={styles.activityRange}>Last {weeks} weeks</Text></View>
          <View style={styles.activityGrid}>
            {Array.from({ length: 7 }, (_, row) => <View key={row} style={styles.activityRow}>
              {Array.from({ length: weeks }, (__, week) => <View key={week} style={{ width: ACTIVITY_CELL, height: ACTIVITY_CELL, borderRadius: 4, backgroundColor: `rgba(255,255,255,${ACTIVITY_ALPHA[ACTIVITY[week * 7 + row]]})` }} />)}
            </View>)}
          </View>
        </View>
      </Animated.ScrollView>
      <View style={styles.pageDots}>{[0, 1, 2].map((index) => <PageDot key={index} index={index} scrollX={scrollX} width={width} />)}</View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SPACE_CADET.black },
  content: { paddingTop: 50, paddingBottom: 150 },
  kicker: { paddingHorizontal: 24, color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 10, letterSpacing: 2.1 },
  title: { paddingHorizontal: 24, color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, marginTop: 4 },
  radarWrap: { alignItems: "center", marginTop: 0 },
  axisLabel: { position: "absolute", width: 120, height: 40, alignItems: "center", justifyContent: "center" },
  axisScore: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 17 },
  axisName: { fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.2, marginTop: 2, textTransform: "uppercase" },
  legend: { flexDirection: "row", justifyContent: "center", gap: 22, marginTop: 2 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendLine: { width: 16, height: 2, borderRadius: 1, backgroundColor: SPACE_CADET.white },
  legendDashes: { flexDirection: "row", gap: 3 }, legendDash: { width: 3.5, height: 1.5, borderRadius: 1, backgroundColor: SPACE_CADET.textSecondary },
  legendText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 11 },
  segments: { flexDirection: "row", marginHorizontal: 24, marginTop: 18, padding: 4, borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderSubtle, backgroundColor: SPACE_CADET.surface1 },
  segment: { flex: 1, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center" }, segmentActive: { backgroundColor: SPACE_CADET.surface4 },
  segmentText: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 13 }, segmentTextActive: { color: SPACE_CADET.white, fontFamily: "Gontserrat-SemiBold" },
  pager: { marginTop: 20 },
  page: { paddingHorizontal: 24, height: 156, justifyContent: "center" },
  tiles: { flexDirection: "row", flexWrap: "wrap", rowGap: 20 },
  tile: { width: "50%" }, tileThird: { width: "33.33%" },
  tileValue: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 26, paddingRight: 12 },
  tileValueSmall: { fontSize: 21 },
  tileLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 10, letterSpacing: 1.8, marginTop: 7 },
  rankLabel: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 7 }, rankDot: { width: 6, height: 6, borderRadius: 3 }, rankText: { marginTop: 0, letterSpacing: 1.2, fontFamily: "Gontserrat-SemiBold", fontSize: 9 },
  activityTop: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 },
  activityTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 17 }, activityRange: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 11 },
  activityGrid: { gap: ACTIVITY_GAP }, activityRow: { flexDirection: "row", gap: ACTIVITY_GAP, justifyContent: "space-between" },
  pageDots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 7, marginTop: 10 },
  pageDot: { height: 7, borderRadius: 4, backgroundColor: SPACE_CADET.white },
});
