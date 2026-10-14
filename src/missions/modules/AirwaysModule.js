import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Line, Polygon } from "react-native-svg";

import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic } from "../../utils/haptics";
import { createRandom } from "../../utils/random";
import { BlockKicker, ERROR, LED_IDLE, ModuleBlock, tint } from "../kit";

const CROSS = 14;

// Four lanes, two per side: blue aircraft climb (bottom → top), violet ones descend. Everything advances one cell
// per step. Each side has a grey zone three cells tall: the left one near the middle, the right one higher.
const ROWS = 12;
const STEP_MS = 1600;
const LANES = [
  { side: 0, color: "blue" }, { side: 0, color: "violet" },
  { side: 1, color: "blue" }, { side: 1, color: "violet" },
];
const ZONES = [{ from: 5, to: 7 }, { from: 2, to: 4 }];
// Inside one zone: at most 2 aircraft, and at most 1 blue.
const ZONE_LIMIT = 2;
const BLUE_LIMIT = 1;
const LOOKAHEAD_STEPS = 2;
const COLORS = { blue: SPACE_CADET.spatial, violet: SPACE_CADET.mentalMath };

// ---- Pure simulation (also used to judge whether a clear was needed) --------------------------------------
const onBoard = (plane) => plane.row >= 0 && plane.row < ROWS;
function move(planes) {
  return planes.map((plane) => ({ ...plane, row: plane.row + (plane.color === "blue" ? -1 : 1), entering: false }));
}
function advance(planes) { return move(planes).filter(onBoard); }
function inZone(plane, zoneIndex) {
  const zone = ZONES[zoneIndex];
  return LANES[plane.lane].side === zoneIndex && plane.row >= zone.from && plane.row <= zone.to;
}
function zoneBreaches(planes) {
  return ZONES.map((_, index) => {
    const inside = planes.filter((plane) => inZone(plane, index));
    const blue = inside.filter((plane) => plane.color === "blue").length;
    return inside.length > ZONE_LIMIT || blue > BLUE_LIMIT;
  });
}
// A clear was needed if, without it (and without new arrivals), a zone would break the rules within the next two
// steps, and removing that colour prevents it.
function clearWasNeeded(planes, color) {
  let without = planes;
  let withClear = planes.filter((plane) => plane.color !== color);
  for (let step = 0; step < LOOKAHEAD_STEPS; step += 1) {
    without = advance(without);
    withClear = advance(withClear);
    const before = zoneBreaches(without);
    const after = zoneBreaches(withClear);
    if (before.some((breach, index) => breach && !after[index])) return true;
  }
  return false;
}
// New aircraft enter at the start of their lane; traffic gets a little denser as the mission goes on.
function spawn(planes, random, progress, nextId) {
  const chance = 0.15 + progress * 0.08;
  const arrivals = [];
  LANES.forEach((lane, index) => {
    if (arrivals.length < 2 && random() < chance) arrivals.push({ id: nextId + arrivals.length, lane: index, color: lane.color, row: lane.color === "blue" ? ROWS - 1 : 0, entering: true });
  });
  return [...planes, ...arrivals];
}
// ----------------------------------------------------------------------------------------------------------

// Aircraft slide from cell to cell. A new one slides in from the (hidden) cell just outside the board, and one that
// leaves slides out the same way before it is dropped.
function Aircraft({ plane, x, cell, size }) {
  const up = plane.color === "blue";
  const row = useSharedValue(plane.entering ? plane.row + (up ? 1 : -1) : plane.row);
  useEffect(() => { row.value = withTiming(plane.row, { duration: 320 }); }, [plane.row]); // eslint-disable-line react-hooks/exhaustive-deps
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: row.value * cell }] }));
  const points = up ? `${size / 2},0 ${size},${size} ${size / 2},${size * 0.72} 0,${size}` : `0,0 ${size / 2},${size * 0.28} ${size},0 ${size / 2},${size}`;
  return <Animated.View style={[styles.aircraft, { left: x - size / 2, top: (cell - size) / 2, width: size, height: size }, style]}>
    <Svg width={size} height={size}><Polygon points={points} fill={COLORS[plane.color]} /></Svg>
  </Animated.View>;
}

export function AirwaysModule({ rects, runtime, color }) {
  const [planes, setPlanes] = useState([]);
  const [alarm, setAlarm] = useState([false, false]);
  const sim = useRef({ steps: 0, planes: [], leaving: [], nextId: 1, random: createRandom(runtime.seed) });
  const stats = useRef({ incidents: 0, clears: 0, needless: 0 });
  const running = runtime.status === "running";

  useEffect(() => runtime.register(() => {
    const { incidents, clears, needless } = stats.current;
    // Left alone, the traffic breaches a zone about 4–5 times a minute: 3 breaches per minute already scores 0.
    const breachBudget = Math.max(1, (runtime.durationMs / 60000) * 3);
    return { performance: Math.max(0, 1 - incidents / breachBudget - needless * 0.04), detail: `${incidents} zone breach${incidents === 1 ? "" : "es"} · ${clears} clears${needless ? ` (${needless} not needed)` : ""}` };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running) return undefined;
    const state = sim.current;
    const timer = setInterval(() => {
      const due = Math.floor(runtime.elapsed() / STEP_MS);
      if (state.steps >= due) return;
      const breached = [false, false];
      while (state.steps < due) {
        state.steps += 1;
        const moved = move(state.planes);
        state.leaving = moved.filter((plane) => !onBoard(plane));
        let next = spawn(moved.filter(onBoard), state.random, Math.min(1, runtime.elapsed() / runtime.durationMs), state.nextId);
        state.nextId += 4;
        // A breach diverts every aircraft in that zone (and costs points), so the side starts clean again.
        zoneBreaches(next).forEach((breach, index) => {
          if (!breach) return;
          breached[index] = true;
          stats.current.incidents += 1;
          next = next.filter((plane) => !inZone(plane, index));
        });
        state.planes = next;
      }
      setPlanes([...state.planes, ...state.leaving]);
      if (breached.some(Boolean)) {
        setAlarm(breached);
        void triggerErrorHaptic();
        setTimeout(() => setAlarm([false, false]), 900);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  function clear(colorName) {
    if (!running) return;
    const state = sim.current;
    if (!clearWasNeeded(state.planes, colorName)) stats.current.needless += 1;
    stats.current.clears += 1;
    state.planes = state.planes.filter((plane) => plane.color !== colorName);
    state.leaving = state.leaving.filter((plane) => plane.color !== colorName);
    setPlanes([...state.planes, ...state.leaving]);
    void triggerSelectionHaptic();
  }

  // Each side is a two-lane column of square-ish cells, rounded only at its very top and bottom; the grey zone is
  // simply three rows of cells filled in. Aircraft are drawn inside their side, so they are clipped at its ends.
  const board = rects.board;
  const top = 34;
  const padding = 12;
  const sideGap = 14;
  const sideWidth = (board.width - padding * 2 - sideGap) / 2;
  // The 1px outline sits outside the cells.
  const lane = (sideWidth - 2) / 2;
  const cell = (board.height - top - padding - 2) / ROWS;
  const size = Math.min(lane, cell) * 0.58;
  // One status light per side: red on a breach, violet when its zone holds the most aircraft allowed, blue when it
  // already holds its one blue aircraft (violet wins when both are true, since then any arrival breaks the rules).
  const lights = ZONES.map((_, side) => {
    if (alarm[side]) return ERROR;
    const inside = planes.filter((plane) => inZone(plane, side));
    if (inside.length >= ZONE_LIMIT) return COLORS.violet;
    if (inside.filter((plane) => plane.color === "blue").length >= BLUE_LIMIT) return COLORS.blue;
    return LED_IDLE;
  });

  return <>
    <ModuleBlock rect={board} color={color}>
      <BlockKicker color={color} style={styles.kicker}>AIRWAYS</BlockKicker>
      <View style={styles.lights}>{lights.map((light, side) => <View key={side} style={[styles.light, { backgroundColor: light }, light !== LED_IDLE && { shadowColor: light, shadowOpacity: 0.8 }]} />)}</View>
      {ZONES.map((zone, side) => <View key={side} style={[styles.side, { left: padding + side * (sideWidth + sideGap), top, width: sideWidth, height: ROWS * cell + 2 }]}>
        <View style={[styles.zone, { top: zone.from * cell, height: (zone.to - zone.from + 1) * cell }, alarm[side] && { backgroundColor: tint(ERROR, 0.32) }]} />
        {Array.from({ length: ROWS - 1 }, (_, index) => <View key={index} style={[styles.rowLine, { top: (index + 1) * cell - 0.5 }]} />)}
        <View style={[styles.laneLine, { left: lane - 0.5 }]} />
        {planes.filter((plane) => LANES[plane.lane].side === side).map((plane) => <Aircraft key={plane.id} plane={plane} x={(plane.lane % 2) * lane + lane / 2} cell={cell} size={size} />)}
      </View>)}
    </ModuleBlock>
    <ModuleBlock rect={rects.controls} color={color} style={styles.controls}>
      {["blue", "violet"].map((name) => <Pressable key={name} disabled={!running} onPress={() => clear(name)} style={({ pressed }) => [styles.clearKey, { backgroundColor: COLORS[name] }, pressed && { opacity: 0.7, transform: [{ scale: 0.97 }] }]}>
        <Svg width={CROSS} height={CROSS}><Line x1={0} y1={0} x2={CROSS} y2={CROSS} stroke={SPACE_CADET.white} strokeWidth={1.4} strokeLinecap="round" /><Line x1={CROSS} y1={0} x2={0} y2={CROSS} stroke={SPACE_CADET.white} strokeWidth={1.4} strokeLinecap="round" /></Svg>
      </Pressable>)}
    </ModuleBlock>
  </>;
}

export const airwaysModule = {
  id: "airways",
  title: "Airways",
  competence: "multitasking",
  secondary: ["attention"],
  task: "event",
  voice: false,
  load: 3,
  rule: "Blue aircraft climb, violet ones descend, one cell at a time. Each side has a grey zone: it may never hold more than 2 aircraft, nor more than 1 blue. Each button clears every aircraft of its colour, on both sides. Clear only when a zone is about to break a rule.",
  recap: "keep the grey zones within limits",
  blocks: [{ key: "board", role: "display", h: 4, w: 2 }, { key: "controls", role: "control", h: 1, w: 2 }],
  Component: AirwaysModule,
};

const styles = StyleSheet.create({
  kicker: { position: "absolute", top: 12, left: 14 },
  side: { position: "absolute", borderRadius: 10, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, overflow: "hidden" },
  zone: { position: "absolute", left: 0, right: 0, backgroundColor: "rgba(255,255,255,0.13)" },
  rowLine: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: SPACE_CADET.borderSubtle },
  laneLine: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: SPACE_CADET.borderDefault },
  aircraft: { position: "absolute" },
  controls: { flexDirection: "row", padding: 8, gap: 8 },
  clearKey: { flex: 1, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  lights: { position: "absolute", top: 14, right: 14, flexDirection: "row", gap: 7 },
  light: { width: 7, height: 7, borderRadius: 4, shadowOffset: { width: 0, height: 0 }, shadowRadius: 6, shadowOpacity: 0 },
});
