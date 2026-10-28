import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle, Polygon } from "react-native-svg";

import { SPACE_CADET } from "../../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSuccessHaptic } from "../../../utils/haptics";
import { BlockKicker, ModuleBlock, tint, useFeedbackFlash } from "../../kit";
import { anomaliesOf, anomalyLiteSpec, anomalySpec, buildContent, emptyStats, moduleResult } from "./logic";

const SHAPE = 11;
const WINDOW_REFRESH_MS = 400;

function hexagonPoints(center, radius) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 3) * index + Math.PI / 6;
    return `${(center + radius * Math.cos(angle)).toFixed(2)},${(center + radius * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}

// Each shape positions itself from the shared clock on the UI thread: x = right edge − elapsed since entry × speed.
function Shape({ item, speed, width, time, spotted, color }) {
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: width - (time.value - item.at) * speed - SHAPE / 2 }] }));
  return <Animated.View style={[styles.shape, style]}>
    <Svg width={SHAPE} height={SHAPE}>
      {item.anomaly && spotted
        ? <Circle cx={SHAPE / 2} cy={SHAPE / 2} r={SHAPE / 2 - 1} stroke={color} strokeWidth={1.4} fill={tint(color, 0.25)} />
        : item.anomaly
        ? <Polygon points={hexagonPoints(SHAPE / 2, SHAPE / 2 - 0.8)} stroke={SPACE_CADET.white} strokeOpacity={0.85} strokeWidth={1.1} fill="none" />
        : <Circle cx={SHAPE / 2} cy={SHAPE / 2} r={SHAPE / 2 - 1} stroke={SPACE_CADET.white} strokeOpacity={0.85} strokeWidth={1.1} fill="none" />}
    </Svg>
  </Animated.View>;
}

export function AnomalyModule({ rects, runtime, color, spec = anomalySpec }) {
  const { laneCount } = spec.options;
  const context = { durationMs: runtime.durationMs };
  const lanes = useMemo(() => buildContent(spec, runtime.seed, context), [runtime.seed, runtime.durationMs, spec]); // eslint-disable-line react-hooks/exhaustive-deps
  const time = useSharedValue(0);
  const [windowStart, setWindowStart] = useState(0);
  // Anomalies tapped, and anomalies that left their lane untouched (counted once as missed).
  const handled = useRef(new Set());
  const expired = useRef(new Set());
  // Spotted anomalies turn back into (tinted) circles, so it is obvious they no longer need a tap.
  const [spotted, setSpotted] = useState(() => new Set());
  const stats = useRef(emptyStats(spec));
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";
  const block = rects.panel;
  const trackWidth = block.width - 28;
  const laneGap = 8;
  const lanesTop = 34;
  const trackHeight = Math.min(26, (block.height - lanesTop - 14 - laneGap * (laneCount - 1)) / laneCount);
  const anomalies = useMemo(() => anomaliesOf(lanes), [lanes]);

  // An anomaly that left its lane without a tap is a miss, counted the moment it leaves.
  function countMisses(now) {
    anomalies.forEach((anomaly) => {
      if (handled.current.has(anomaly.key) || expired.current.has(anomaly.key) || anomaly.at + anomaly.cross >= now) return;
      expired.current.add(anomaly.key);
      stats.current.missed += 1;
    });
  }

  // Misses are counted by the refresh timer below (a few times a second), so the stats are always up to date.
  useEffect(() => runtime.register(() => moduleResult(spec, stats.current, context)), []); // eslint-disable-line react-hooks/exhaustive-deps

  // The clock runs as one linear animation to the end of the mission (perfectly smooth, UI thread); a pause
  // cancels it and a resume restarts it from the mission clock. Which shapes are mounted is refreshed a few times
  // a second, with enough margin that a shape is always mounted before it enters and after it leaves.
  useEffect(() => {
    const now = runtime.elapsed() / 1000;
    if (!running) { cancelAnimation(time); if (runtime.status !== "idle") time.value = now; return undefined; }
    time.value = now;
    time.value = withTiming(runtime.durationMs / 1000, { duration: Math.max(0, runtime.durationMs - runtime.elapsed()), easing: Easing.linear });
    setWindowStart(now);
    const timer = setInterval(() => { const at = runtime.elapsed() / 1000; countMisses(at); setWindowStart(at); }, WINDOW_REFRESH_MS);
    return () => clearInterval(timer);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  function tap() {
    if (!running) return;
    const now = runtime.elapsed() / 1000;
    const onScreen = anomalies.find((anomaly) => !handled.current.has(anomaly.key) && now >= anomaly.at && now <= anomaly.at + anomaly.cross);
    if (!onScreen) {
      stats.current.falseAlarms += 1;
      feedback.flash(false);
      void triggerErrorHaptic();
      return;
    }
    handled.current.add(onScreen.key);
    setSpotted(new Set(handled.current));
    stats.current.spotted.push({ delay: now - onScreen.at, cross: onScreen.cross });
    feedback.flash(true);
    void triggerSuccessHaptic();
  }

  return <ModuleBlock rect={block} color={color} flash={feedback.style}>
    <Pressable disabled={!running} onPress={tap} style={({ pressed }) => [styles.surface, pressed && { backgroundColor: tint(color, 0.07) }]}>
      <BlockKicker color={color} style={styles.kicker}>SCAN</BlockKicker>
      <View style={[styles.lanes, { top: lanesTop, gap: laneGap }]}>
        {lanes.map((lane, index) => {
          const speed = trackWidth / lane.cross;
          const mounted = lane.items.filter((item) => item.at >= windowStart - lane.cross - 1.5 && item.at <= windowStart + 1.5);
          return <View key={index} style={[styles.track, { width: trackWidth, height: trackHeight, borderRadius: trackHeight / 2 }]}>
            {mounted.map((item) => <Shape key={item.key} item={item} speed={speed} width={trackWidth} time={time} spotted={spotted.has(item.key)} color={color} />)}
          </View>;
        })}
      </View>
    </Pressable>
  </ModuleBlock>;
}

export const anomalyModule = { ...anomalySpec, Component: AnomalyModule };
export const anomalyLiteModule = { ...anomalyLiteSpec, Component: (props) => <AnomalyModule {...props} spec={anomalyLiteSpec} /> };

const styles = StyleSheet.create({
  surface: { flex: 1 },
  kicker: { position: "absolute", top: 12, left: 14 },
  lanes: { position: "absolute", left: 14, right: 14, bottom: 14, justifyContent: "center" },
  track: { backgroundColor: "rgba(255,255,255,0.035)", overflow: "hidden", justifyContent: "center" },
  shape: { position: "absolute", left: 0, width: SHAPE, height: SHAPE },
});
