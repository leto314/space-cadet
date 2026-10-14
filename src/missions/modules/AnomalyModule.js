import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle, Polygon } from "react-native-svg";

import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { createRandom, randomTools } from "../../utils/random";
import { BlockKicker, ModuleBlock, tint, useFeedbackFlash } from "../kit";

// Seconds a shape takes to cross its lane, per lane (lanes run at slightly different speeds).
const CROSS_S = [15, 13, 17];
const SHAPE = 11;
const WINDOW_REFRESH_MS = 400;
const FALSE_ALARM_COST = 0.08;

// Each lane is a stream of small circles entering from the right; a few are hexagons (the anomalies).
// `at` is when the shape enters the lane's right edge, in seconds from the start.
function buildLanes(seed, laneCount, durationMs) {
  const rnd = randomTools(createRandom(seed));
  const seconds = durationMs / 1000;
  const lanes = Array.from({ length: laneCount }, (_, lane) => {
    const items = [];
    for (let at = -CROSS_S[lane]; at < seconds + 2; at += rnd.float(2.2, 3.4)) items.push({ at, anomaly: false, key: `${lane}:${items.length}` });
    return { cross: CROSS_S[lane], items };
  });
  for (let at = rnd.float(6, 9); at < seconds - 4; at += rnd.float(10, 16)) {
    const lane = lanes[rnd.int(0, laneCount - 1)];
    const item = lane.items.find((entry) => entry.at >= at);
    if (item) item.anomaly = true;
  }
  return lanes;
}

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

export function AnomalyModule({ rects, runtime, color, laneCount }) {
  const lanes = useMemo(() => buildLanes(runtime.seed, laneCount, runtime.durationMs), [runtime.seed, laneCount, runtime.durationMs]);
  const time = useSharedValue(0);
  const [windowStart, setWindowStart] = useState(0);
  const handled = useRef(new Set());
  // Spotted anomalies turn back into (tinted) circles, so it is obvious they no longer need a tap.
  const [spotted, setSpotted] = useState(() => new Set());
  const outcomes = useRef([]);
  const falseAlarms = useRef(0);
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";
  const block = rects.panel;
  const trackWidth = block.width - 28;
  const laneGap = 8;
  const lanesTop = 34;
  const trackHeight = Math.min(26, (block.height - lanesTop - 14 - laneGap * (laneCount - 1)) / laneCount);
  const anomalies = useMemo(() => lanes.flatMap((lane) => lane.items.filter((item) => item.anomaly).map((item) => ({ ...item, cross: lane.cross }))), [lanes]);

  useEffect(() => runtime.register(() => {
    const now = runtime.elapsed() / 1000;
    const due = anomalies.filter((anomaly) => handled.current.has(anomaly.key) || anomaly.at + anomaly.cross < now);
    const scores = due.map((anomaly) => {
      const outcome = outcomes.current.find((entry) => entry.key === anomaly.key);
      return outcome ? 1 - 0.5 * (outcome.delay / anomaly.cross) : 0;
    });
    const mean = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 1;
    return { performance: Math.max(0, Math.min(1, mean - FALSE_ALARM_COST * falseAlarms.current)), detail: `${outcomes.current.length}/${scores.length} anomalies spotted${falseAlarms.current ? ` · ${falseAlarms.current} false` : ""}` };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // The clock runs as one linear animation to the end of the mission (perfectly smooth, UI thread); a pause
  // cancels it and a resume restarts it from the mission clock. Which shapes are mounted is refreshed a few times
  // a second, with enough margin that a shape is always mounted before it enters and after it leaves.
  useEffect(() => {
    const now = runtime.elapsed() / 1000;
    if (!running) { cancelAnimation(time); if (runtime.status !== "idle") time.value = now; return undefined; }
    time.value = now;
    time.value = withTiming(runtime.durationMs / 1000, { duration: Math.max(0, runtime.durationMs - runtime.elapsed()), easing: Easing.linear });
    setWindowStart(now);
    const timer = setInterval(() => setWindowStart(runtime.elapsed() / 1000), WINDOW_REFRESH_MS);
    return () => clearInterval(timer);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  function tap() {
    if (!running) return;
    const now = runtime.elapsed() / 1000;
    const onScreen = anomalies.find((anomaly) => !handled.current.has(anomaly.key) && now >= anomaly.at && now <= anomaly.at + anomaly.cross);
    if (!onScreen) {
      falseAlarms.current += 1;
      feedback.flash(false);
      void triggerErrorHaptic();
      return;
    }
    handled.current.add(onScreen.key);
    setSpotted(new Set(handled.current));
    outcomes.current.push({ key: onScreen.key, delay: now - onScreen.at });
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

const baseDefinition = {
  competence: "attention",
  secondary: [],
  task: "event",
  voice: false,
  recap: "spot the anomalies",
};

export const anomalyModule = {
  ...baseDefinition,
  id: "anomaly",
  title: "Anomaly scan",
  load: 2,
  rule: "Three signal lines scroll slowly past. Tap the block as soon as you see a hexagon among the circles. Tapping when there is none counts as an error.",
  blocks: [{ key: "panel", role: "display", h: 2, w: 2 }],
  Component: (props) => <AnomalyModule {...props} laneCount={3} />,
};

// Same task on a single line, for when there is only half a block of room (or less load to spend).
export const anomalyLiteModule = {
  ...baseDefinition,
  id: "anomaly-lite",
  title: "Anomaly line",
  load: 1,
  rule: "A signal line scrolls slowly past. Tap the block as soon as you see a hexagon among the circles. Tapping when there is none counts as an error.",
  blocks: [{ key: "panel", role: "display", h: 1, w: 2 }],
  Component: (props) => <AnomalyModule {...props} laneCount={1} />,
};

const styles = StyleSheet.create({
  surface: { flex: 1 },
  kicker: { position: "absolute", top: 12, left: 14 },
  lanes: { position: "absolute", left: 14, right: 14, bottom: 14, justifyContent: "center" },
  track: { backgroundColor: "rgba(255,255,255,0.035)", overflow: "hidden", justifyContent: "center" },
  shape: { position: "absolute", left: 0, width: SHAPE, height: SHAPE },
});
