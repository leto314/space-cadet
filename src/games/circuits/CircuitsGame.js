import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Animated, { FadeIn, interpolateColor, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";

import { BulbIcon } from "../../components/AppIcons";
import { ChoiceButton, ChoiceRow, GameSetupShell, PickerSetting, PressScaleButton, SettingCard } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { randomSeed } from "../../utils/random";
import { buildDailySession, buildSession, bulbsOf, circuitEntry, dailyResult, DAILY_CIRCUITS, evaluate, flipBudget, gateSetFor, range, sameBits } from "./logic";

const ACCENT = SPACE_CADET.logic;
const SUCCESS = "#34D399";
const ERROR = SPACE_CADET.attention;
const LIT_BG = "#0C2626";
const WIRE_DIM = "rgba(255,255,255,0.16)";
const JUNCTION_DIM = "rgba(255,255,255,0.34)";
const WIRE_MS = 260;
const NODE_LEAD_MS = 70;
const STEP_MS = WIRE_MS + NODE_LEAD_MS;
const GATE_W = 64;
const GATE_H = 32;
const PIN_OFFSET = 14;
const SWITCH_W = 52;
const SWITCH_H = 30;
const BULB_SIZE = 42;
const MODES = [{ value: "gate", label: "GATE" }, { value: "inputs", label: "INPUTS" }, { value: "outputs", label: "OUTPUTS" }, { value: "mixed", label: "MIXED" }];
const MODE_HINTS = {
  gate: "One gate is missing. Choose the one that makes the circuit work.",
  inputs: "Find the switch combination that lights the right bulbs.",
  outputs: "Work out which bulbs light up before the current flows.",
  mixed: "A random mode for every circuit.",
};
const READY_COPY = {
  gate: { title: "Find the missing gate", text: "One gate is hidden. Pick the one that gives every bulb its ON or OFF target." },
  inputs: { title: "Set the switches", text: "Flip the switches until every bulb matches its ON or OFF target, in as few flips as you can." },
  outputs: { title: "Predict the bulbs", text: "The switches are set. Tap the bulbs you expect to light, then validate to send the current." },
  mixed: { title: "Trace the current", text: "Each circuit asks you to find the missing gate, set the switches, or predict the bulbs." },
};
const GATE_MEANINGS = { AND: "both inputs on", OR: "at least one input on", NOT: "inverts its input", XOR: "exactly one input on", NAND: "not both inputs on", NOR: "neither input on", XNOR: "both inputs the same" };

// ---- Layout (pure, but about pixels: it stays with the screen) -------------------------------------------
// Spreads nodes toward their preferred x while keeping a minimum gap and staying inside [lo, hi].
function spreadPositions(targets, minGap, lo, hi) {
  const count = targets.length;
  const order = targets.map((x, index) => ({ x: Math.min(hi, Math.max(lo, x)), index })).sort((a, b) => a.x - b.x || a.index - b.index);
  if ((count - 1) * minGap > hi - lo) order.forEach((entry, rank) => { entry.x = count === 1 ? (lo + hi) / 2 : lo + (rank * (hi - lo)) / (count - 1); });
  else {
    for (let rank = 1; rank < count; rank += 1) order[rank].x = Math.max(order[rank].x, order[rank - 1].x + minGap);
    if (order[count - 1].x > hi) {
      order[count - 1].x = hi;
      for (let rank = count - 2; rank >= 0; rank -= 1) order[rank].x = Math.min(order[rank].x, order[rank + 1].x - minGap);
    }
  }
  const result = [];
  order.forEach(({ x, index }) => { result[index] = x; });
  return result;
}

function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

// Counts crossings between lane-routed wires for a given lane order (y grows downwards, lane 0 sits lowest).
function laneCrossings(wires, laneY) {
  let score = 0;
  wires.forEach((a, i) => wires.forEach((b, j) => {
    if (i === j) return;
    const low = Math.min(a.fromX, a.toX);
    const high = Math.max(a.fromX, a.toX);
    if (b.source !== a.source && b.fromX > low && b.fromX < high && laneY[i] > laneY[j]) score += 1;
    if (b.toX > low && b.toX < high && laneY[i] < laneY[j]) score += 1;
    if (Math.abs(a.toX - b.fromX) < 3 && laneY[i] > laneY[j]) score += 10;
  }));
  return score;
}

// Geometry in pixels for a measured board: switches on the bottom row, gate layers above, bulbs on top.
// Each gate sits above its sources where possible, so most wires are straight. A source beside a gate enters it
// from the side (one bend); only the remaining wires take the up-across-up route, on lanes ordered to minimise
// crossings. Junction dots mark where one output splits towards several gates.
function layoutCircuit(circuit, width, height) {
  const rowCount = circuit.layers.length + 2;
  const top = 60;
  const bottom = 24;
  const rowY = (row) => height - bottom - SWITCH_H / 2 - row * ((height - top - bottom - SWITCH_H / 2) / (rowCount - 1));
  const switchW = Math.min(SWITCH_W, Math.floor(width / circuit.inputCount) - 12);
  const switches = range(0, circuit.inputCount - 1).map((index) => ({ x: (width * (index + 0.5)) / circuit.inputCount, y: rowY(0) }));
  const gates = [];
  circuit.layers.forEach((layer, layerIndex) => {
    const below = layerIndex === 0 ? switches : gates[layerIndex - 1];
    const preferred = layer.map((gate) => gate.sources.reduce((sum, source) => sum + below[source].x, 0) / gate.sources.length);
    const xs = spreadPositions(preferred, GATE_W + 16, GATE_W / 2 + 2, width - GATE_W / 2 - 2);
    gates.push(xs.map((x) => ({ x, y: rowY(layerIndex + 1) })));
  });
  const lastRow = circuit.layers.length;
  const bulbs = gates.at(-1).map(({ x }) => ({ x, y: rowY(lastRow + 1) }));
  const nodeTop = (row, index) => (row === 0 ? switches[index].y - SWITCH_H / 2 : gates[row - 1][index].y - GATE_H / 2);

  const wires = [];
  const junctions = [];
  circuit.layers.forEach((layer, layerIndex) => {
    const below = layerIndex === 0 ? switches : gates[layerIndex - 1];
    const rowGates = gates[layerIndex];
    const routed = [];
    const laneWires = [];
    const sideSegments = [];
    const insideOtherGate = (x, gateIndex) => rowGates.some((other, otherIndex) => otherIndex !== gateIndex && Math.abs(other.x - x) < GATE_W / 2 + 6);
    layer.forEach((gate, gateIndex) => {
      const target = rowGates[gateIndex];
      const left = target.x - GATE_W / 2;
      const right = target.x + GATE_W / 2;
      const gateBottom = target.y + GATE_H / 2;
      const usedPins = [];
      const sources = gate.sources.map((source) => ({ source, x: below[source].x })).sort((a, b) => a.x - b.x);
      const zone = (x) => (x < left + 10 ? "left" : x > right - 10 ? "right" : "under");
      const plans = sources.map((entry) => ({ ...entry, zone: zone(entry.x) }));
      if (plans.length === 2 && plans[0].zone === "under" && plans[1].zone === "under" && plans[1].x - plans[0].x < 14) plans.forEach((plan) => { plan.zone = "lane"; });
      if (plans.length === 2 && plans[0].zone === "left" && plans[1].zone === "left") plans[1].zone = "lane";
      if (plans.length === 2 && plans[0].zone === "right" && plans[1].zone === "right") plans[0].zone = "lane";
      plans.forEach((plan, pinIndex) => {
        const base = { key: `w${layerIndex}-${gateIndex}-${pinIndex}`, row: layerIndex, source: plan.source, fromX: plan.x, fromY: nodeTop(layerIndex, plan.source) };
        if (plan.zone === "under") {
          usedPins.push(plan.x);
          routed.push({ ...base, d: `M${plan.x.toFixed(1)} ${base.fromY.toFixed(1)} V${gateBottom.toFixed(1)}`, length: base.fromY - gateBottom + 1, bendY: gateBottom });
          return;
        }
        if (plan.zone === "left" || plan.zone === "right") {
          const edgeX = plan.zone === "left" ? left : right;
          const low = Math.min(plan.x, edgeX);
          const high = Math.max(plan.x, edgeX);
          const blocked = insideOtherGate(plan.x, gateIndex)
            || rowGates.some((other, otherIndex) => otherIndex !== gateIndex && other.x + GATE_W / 2 > low && other.x - GATE_W / 2 < high)
            || sideSegments.some((segment) => segment.high > low - 6 && segment.low < high + 6);
          if (!blocked) {
            sideSegments.push({ low, high });
            routed.push({ ...base, d: `M${plan.x.toFixed(1)} ${base.fromY.toFixed(1)} V${target.y.toFixed(1)} H${edgeX.toFixed(1)}`, length: base.fromY - target.y + high - low + 1, bendY: target.y });
            return;
          }
        }
        // Up-across-up into the bottom of the gate: pick a free pin on the source's side, away from any other
        // source's vertical so two different wires never run along the same line.
        const preferred = plans.length === 1 ? [0, -10, 10] : pinIndex === 0 ? [-PIN_OFFSET, -24, 0, PIN_OFFSET] : [PIN_OFFSET, 24, 0, -PIN_OFFSET];
        const toX = preferred.map((offset) => target.x + offset).find((x) => usedPins.every((used) => Math.abs(used - x) > 9) && below.every((node, index) => index === plan.source || Math.abs(node.x - x) > 4)) ?? target.x + preferred[0];
        usedPins.push(toX);
        laneWires.push({ ...base, toX, toY: gateBottom });
      });
    });

    if (laneWires.length) {
      const lower = laneWires[0].fromY - 12;
      const upper = laneWires[0].toY + 12;
      const slots = laneWires.map((_, rank) => lower - ((rank + 1) * (lower - upper)) / (laneWires.length + 1));
      const orders = laneWires.length <= 6 ? permutations(range(0, laneWires.length - 1)) : [range(0, laneWires.length - 1)];
      let best = null;
      orders.forEach((order) => {
        const laneY = [];
        order.forEach((wireIndex, rank) => { laneY[wireIndex] = slots[rank]; });
        const score = laneCrossings(laneWires, laneY);
        if (!best || score < best.score) best = { score, laneY };
      });
      laneWires.forEach((wire, wireIndex) => {
        const laneY = best.laneY[wireIndex];
        if (Math.abs(wire.toX - wire.fromX) < 1) {
          routed.push({ ...wire, d: `M${wire.fromX.toFixed(1)} ${wire.fromY.toFixed(1)} V${wire.toY.toFixed(1)}`, length: wire.fromY - wire.toY + 1, bendY: wire.toY });
          return;
        }
        routed.push({ ...wire, d: `M${wire.fromX.toFixed(1)} ${wire.fromY.toFixed(1)} V${laneY.toFixed(1)} H${wire.toX.toFixed(1)} V${wire.toY.toFixed(1)}`, length: wire.fromY - laneY + Math.abs(wire.toX - wire.fromX) + laneY - wire.toY + 1, bendY: laneY });
      });
    }

    // Wires from one source share its vertical until each turns off; every turn below the highest is a split.
    const bySource = new Map();
    routed.forEach((wire) => bySource.set(wire.source, [...(bySource.get(wire.source) ?? []), wire]));
    bySource.forEach((group, source) => {
      if (group.length < 2) return;
      const highest = Math.min(...group.map((wire) => wire.bendY));
      new Set(group.map((wire) => Math.round(wire.bendY))).forEach((bendY) => {
        if (bendY > highest + 1) junctions.push({ key: `j${layerIndex}-${source}-${bendY}`, row: layerIndex, source, x: below[source].x, y: bendY, share: (group[0].fromY - bendY) / (group[0].fromY - highest) });
      });
    });
    wires.push(...routed);
  });
  bulbs.forEach((bulb, index) => {
    const fromY = gates.at(-1)[index].y - GATE_H / 2;
    const toY = bulb.y + BULB_SIZE / 2;
    wires.push({ key: `b${index}`, row: lastRow, source: index, d: `M${bulb.x.toFixed(1)} ${fromY.toFixed(1)} V${toY.toFixed(1)}`, length: fromY - toY + 1 });
  });
  return { switches, switchW, gates, bulbs, wires, junctions };
}
// ---------------------------------------------------------------------------------------------------------

function blockedRows(circuit) {
  const rows = [Array(circuit.inputCount).fill(false)];
  circuit.layers.forEach((layer, layerIndex) => rows.push(layer.map((gate, gateIndex) => (circuit.missing?.layer === layerIndex && circuit.missing?.index === gateIndex) || gate.sources.some((source) => rows[layerIndex][source]))));
  return rows;
}

function useLit(on, delay) {
  const lit = useSharedValue(on ? 1 : 0);
  useEffect(() => { lit.value = withDelay(Math.max(0, delay), withTiming(on ? 1 : 0, { duration: on ? 220 : 160 })); }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  return lit;
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// The lit copy of a wire is dashed to its own length; sliding the dash offset from `length` to 0 "fills" the wire
// from its source end, which reads as current flowing into the next block. A wide black halo underneath cuts a
// small gap into any wire it crosses, so crossings read as bridges rather than connections.
function Wire({ d, length, on, delay }) {
  const offset = useSharedValue(length);
  useEffect(() => { offset.value = withDelay(Math.max(0, delay), withTiming(on ? 0 : length, { duration: on ? WIRE_MS : 160 })); }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  const glowProps = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));
  const coreProps = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));
  return <>
    <Path d={d} stroke={SPACE_CADET.black} strokeWidth={8} fill="none" strokeLinejoin="round" />
    <Path d={d} stroke={WIRE_DIM} strokeWidth={1.5} fill="none" strokeLinejoin="round" />
    <AnimatedPath d={d} stroke={ACCENT} strokeOpacity={0.2} strokeWidth={6} fill="none" strokeLinejoin="round" strokeDasharray={`${length} ${length}`} animatedProps={glowProps} />
    <AnimatedPath d={d} stroke={ACCENT} strokeWidth={2} fill="none" strokeLinejoin="round" strokeDasharray={`${length} ${length}`} animatedProps={coreProps} />
  </>;
}

function Junction({ x, y, on, delay }) {
  const lit = useLit(on, delay);
  const litProps = useAnimatedProps(() => ({ opacity: lit.value }));
  return <>
    <Circle cx={x} cy={y} r={3.4} fill={JUNCTION_DIM} />
    <AnimatedCircle cx={x} cy={y} r={3.8} fill={ACCENT} animatedProps={litProps} />
  </>;
}

function GateNode({ x, y, label, on, delay, missing, state }) {
  const lit = useLit(on, delay);
  const fillStyle = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(lit.value, [0, 1], [SPACE_CADET.surface1, LIT_BG]), shadowOpacity: lit.value * 0.42 }));
  const borderStyle = useAnimatedStyle(() => ({ borderColor: interpolateColor(lit.value, [0, 1], [SPACE_CADET.borderDefault, ACCENT]) }));
  // The empty slot and the verdict colours own the border, so the animated border is left out for them.
  const staticBorder = missing && !label ? styles.gateMissing : state === "wrong" ? styles.gateWrong : state === "correct" ? styles.gateCorrect : null;
  return <Animated.View style={[styles.gate, { left: x - GATE_W / 2, top: y - GATE_H / 2 }, staticBorder && missing && !label ? null : fillStyle, staticBorder ?? borderStyle]}>
    <Text style={[styles.gateLabel, missing && !label && styles.gateMissingLabel]}>{label ?? "?"}</Text>
  </Animated.View>;
}

function BulbNode({ x, y, on, delay, caption, captionColor, onPress }) {
  const lit = useLit(on, delay);
  const shellStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(lit.value, [0, 1], [SPACE_CADET.borderDefault, ACCENT]),
    backgroundColor: interpolateColor(lit.value, [0, 1], [SPACE_CADET.surface1, LIT_BG]),
    shadowOpacity: lit.value * 0.5,
  }));
  const glowIconStyle = useAnimatedStyle(() => ({ opacity: lit.value }));
  return <Pressable disabled={!onPress} onPress={onPress} hitSlop={10} style={[styles.bulbWrap, { left: x - 32, top: y - BULB_SIZE / 2 - 22 }]}>
    <Text style={[styles.bulbCaption, { color: captionColor }]}>{caption}</Text>
    <Animated.View style={[styles.bulb, shellStyle]}>
      <BulbIcon color={SPACE_CADET.textTertiary} size={20} />
      <Animated.View style={[styles.bulbIconLit, glowIconStyle]}><BulbIcon color={ACCENT} size={20} /></Animated.View>
    </Animated.View>
  </Pressable>;
}

function SwitchNode({ x, y, width, on, onPress }) {
  const lit = useLit(on, 0);
  const trackStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(lit.value, [0, 1], [SPACE_CADET.borderDefault, ACCENT]),
    backgroundColor: interpolateColor(lit.value, [0, 1], [SPACE_CADET.surface1, LIT_BG]),
    shadowOpacity: lit.value * 0.42,
  }));
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: lit.value * (width - SWITCH_H) }],
    backgroundColor: interpolateColor(lit.value, [0, 1], [SPACE_CADET.textTertiary, ACCENT]),
  }));
  return <Pressable disabled={!onPress} onPress={onPress} hitSlop={8} style={{ position: "absolute", left: x - width / 2, top: y - SWITCH_H / 2 }}>
    <Animated.View style={[styles.switchTrack, { width }, trackStyle]}><Animated.View style={[styles.switchKnob, knobStyle]} /></Animated.View>
  </Pressable>;
}

function CircuitBoard({ circuit, width, height, values, visible, wireVisible, base, chosenType, feedback, predictions, onToggleSwitch, onToggleBulb, switchValues }) {
  const geometry = useMemo(() => layoutCircuit(circuit, width, height), [circuit, width, height]);
  const lastRow = circuit.layers.length;
  const nodeDelay = (row) => (row - base) * STEP_MS;
  const isMissing = (layerIndex, gateIndex) => circuit.missing?.layer === layerIndex && circuit.missing?.index === gateIndex;
  const flowing = (row, source) => wireVisible(row, source) && values[row][source] === 1;
  return <View style={{ width, height }}>
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      {geometry.wires.map((wire) => <Wire key={wire.key} d={wire.d} length={wire.length} on={flowing(wire.row, wire.source)} delay={nodeDelay(wire.row) + NODE_LEAD_MS} />)}
      {geometry.junctions.map((junction) => <Junction key={junction.key} x={junction.x} y={junction.y} on={flowing(junction.row, junction.source)} delay={nodeDelay(junction.row) + NODE_LEAD_MS + WIRE_MS * junction.share * 0.5} />)}
    </Svg>
    {geometry.gates.map((layer, layerIndex) => layer.map((point, gateIndex) => {
      const missing = isMissing(layerIndex, gateIndex);
      const label = missing ? chosenType : circuit.layers[layerIndex][gateIndex].type;
      const state = missing && feedback ? (chosenType === circuit.answerType ? "correct" : "wrong") : null;
      return <GateNode key={`g${layerIndex}-${gateIndex}`} x={point.x} y={point.y} label={label} missing={missing} state={state} on={visible(layerIndex + 1, gateIndex) && values[layerIndex + 1][gateIndex] === 1} delay={nodeDelay(layerIndex + 1)} />;
    }))}
    {geometry.bulbs.map((point, bulbIndex) => {
      const target = circuit.target[bulbIndex] === 1;
      const predicting = circuit.mode === "outputs";
      const expected = predicting ? predictions[bulbIndex] === 1 : target;
      let captionColor = expected ? ACCENT : SPACE_CADET.textTertiary;
      if (feedback && predicting) captionColor = predictions[bulbIndex] === circuit.target[bulbIndex] ? SUCCESS : ERROR;
      return <BulbNode key={`b${bulbIndex}`} x={point.x} y={point.y} on={visible(lastRow, bulbIndex) && values[lastRow][bulbIndex] === 1} delay={nodeDelay(lastRow + 1)} caption={expected ? "ON" : "OFF"} captionColor={captionColor} onPress={onToggleBulb ? () => onToggleBulb(bulbIndex) : null} />;
    })}
    {geometry.switches.map((point, switchIndex) => <SwitchNode key={`s${switchIndex}`} x={point.x} y={point.y} width={geometry.switchW} on={switchValues[switchIndex] === 1} onPress={onToggleSwitch ? () => onToggleSwitch(switchIndex) : null} />)}
  </View>;
}

function formatSeconds(ms) { return (ms / 1000).toFixed(1); }

// `daily` ({ seed, onFinish, onExit }) turns this into the daily training version: no preflight, the day's six
// circuits (DAILY_CIRCUITS), each worth 0–100 points, then onFinish({ score, metrics, trials }).
export function CircuitsGame({ onExit, daily = null }) {
  const [mode, setMode] = useState("outputs");
  const [circuitCount, setCircuitCount] = useState(5);
  const [withXor, setWithXor] = useState(false);
  const [withNegated, setWithNegated] = useState(false);
  const [phase, setPhase] = useState(daily ? "ready" : "preflight");
  const [index, setIndex] = useState(0);
  const [switchValues, setSwitchValues] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [chosenType, setChosenType] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [base, setBase] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [flips, setFlips] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [results, setResults] = useState([]);
  const [board, setBoard] = useState(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const phaseRef = useRef(daily ? "ready" : "preflight");
  const lockedRef = useRef(false);
  const settingsRef = useRef(daily ? { mode: "daily", circuitCount: DAILY_CIRCUITS.length, gateSet: gateSetFor({ withXor: true, withNegated: true }) } : null);
  const circuitsRef = useRef([]);
  const resultsRef = useRef([]);
  const clockBase = useRef(0);
  const clockStartedAt = useRef(0);
  const circuitStartedAt = useRef(0);
  const intervalRef = useRef(null);
  const timeouts = useRef([]);
  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({ onPrepareReturn: clearTimers, onReturnComplete: resetToPreflight });

  useEffect(() => () => clearTimers(), []);
  function clearTimers() { clearInterval(intervalRef.current); intervalRef.current = null; timeouts.current.forEach(clearTimeout); timeouts.current = []; }
  function goTo(nextPhase) { phaseRef.current = nextPhase; setPhase(nextPhase); }
  // The session clock only runs while a circuit is being worked on; it pauses on the verdict screen.
  function startClock() {
    clockStartedAt.current = Date.now();
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => setElapsed(clockBase.current + Date.now() - clockStartedAt.current), 100);
  }
  function pauseClock() {
    if (!intervalRef.current) return;
    clockBase.current += Date.now() - clockStartedAt.current;
    clearInterval(intervalRef.current); intervalRef.current = null;
    setElapsed(clockBase.current);
  }
  function resetToPreflight() { clearTimers(); circuitsRef.current = []; setResults([]); goTo("preflight"); }
  function resetToReady() { clearTimers(); resultsRef.current = []; clockBase.current = 0; setResults([]); setIndex(0); setElapsed(0); goTo("ready"); }
  function prepareRun() { settingsRef.current = { mode, circuitCount, gateSet: gateSetFor({ withXor, withNegated }), withXor, withNegated }; startMission(resetToReady); }

  function showCircuit(nextIndex) {
    const circuit = circuitsRef.current[nextIndex];
    lockedRef.current = false;
    setIndex(nextIndex); setChosenType(null); setFeedback(null); setFlips(0); setBase(0);
    setSwitchValues(circuit.mode === "inputs" ? Array(circuit.inputCount).fill(0) : circuit.inputs);
    setPredictions(Array(circuit.target.length).fill(0));
    setRevealed(circuit.mode === "gate");
    circuitStartedAt.current = Date.now();
    startClock();
    goTo("playing");
  }
  function beginRun() {
    void triggerSelectionHaptic();
    circuitsRef.current = daily ? buildDailySession(daily.seed) : buildSession(settingsRef.current, randomSeed());
    clockBase.current = 0;
    showCircuit(0);
  }
  // Records the answer immediately (time stops here), then shows the verdict once the current reaches the bulbs.
  function settle(fromRow, correct, extra = {}) {
    lockedRef.current = true;
    pauseClock();
    const circuit = circuitsRef.current[index];
    resultsRef.current = [...resultsRef.current, circuitEntry(circuit, { correct, timeMs: Date.now() - circuitStartedAt.current, ...extra })];
    const flowMs = (circuit.layers.length + 1 - fromRow) * STEP_MS + 160;
    timeouts.current.push(setTimeout(() => {
      setResults(resultsRef.current);
      setFeedback(correct ? "correct" : "wrong");
      void (correct ? triggerSuccessHaptic() : triggerErrorHaptic());
    }, flowMs));
  }
  function chooseGate(type) {
    if (lockedRef.current) return;
    const circuit = circuitsRef.current[index];
    void triggerSelectionHaptic();
    setChosenType(type); setBase(circuit.missing.layer + 1);
    settle(circuit.missing.layer + 1, type === circuit.answerType);
  }
  function toggleSwitch(switchIndex) {
    if (lockedRef.current) return;
    const circuit = circuitsRef.current[index];
    void triggerSelectionHaptic();
    const next = switchValues.map((value, position) => (position === switchIndex ? 1 - value : value));
    const nextFlips = flips + 1;
    setSwitchValues(next); setFlips(nextFlips); setRevealed(true); setBase(0);
    if (sameBits(bulbsOf(circuit, next), circuit.target)) settle(0, true, { flips: nextFlips });
    else if (daily && nextFlips >= flipBudget(circuit).cap) settle(0, false, { flips: nextFlips });
  }
  function toggleBulb(bulbIndex) {
    if (lockedRef.current) return;
    void triggerSelectionHaptic();
    setPredictions((current) => current.map((value, position) => (position === bulbIndex ? 1 - value : value)));
  }
  function validatePrediction() {
    if (lockedRef.current) return;
    const circuit = circuitsRef.current[index];
    setRevealed(true); setBase(0);
    settle(0, sameBits(predictions, circuit.target));
  }
  function nextCircuit() {
    if (index + 1 < circuitsRef.current.length) showCircuit(index + 1);
    else if (daily) finishDaily(); else goTo("summary");
  }
  function finishDaily() { daily.onFinish(dailyResult(resultsRef.current)); }

  const gateHint = [...gateSetFor({ withXor, withNegated })].join(" · ");
  const preflight = <GameSetupShell title="Circuits" categoryKey="logic" onExit={onExit} onStart={prepareRun} rules="Tests logical reasoning. Current flows up from the switches, through the logic gates, to the bulbs. AND passes current when both inputs are on, OR when at least one is, NOT inverts its input and XOR passes when exactly one input is on. NAND, NOR and XNOR are the inverted versions of AND, OR and XOR.Easy: AND, OR and NOT, predicting the bulbs.Medium: Add XOR, or find the missing gate.Hard: All seven gates in mixed modes.">
    <SettingCard label="Mode" hint={MODE_HINTS[mode]}>
      <ChoiceRow>{MODES.map((option) => <ChoiceButton key={option.value} compact label={option.label} selected={mode === option.value} accent={ACCENT} onPress={() => setMode(option.value)} />)}</ChoiceRow>
    </SettingCard>
    <PickerSetting label="Circuits" hint="Circuits in the session" options={[3, 5, 8].map((value) => ({ value, label: String(value) }))} value={circuitCount} onChange={setCircuitCount} />
    <SettingCard label="Gates" hint={gateHint}>
      <ChoiceRow>
        <ChoiceButton compact label="+ XOR" selected={withXor} accent={ACCENT} onPress={() => setWithXor((current) => !current)} />
        <ChoiceButton compact label="+ NAND · NOR" selected={withNegated} accent={ACCENT} onPress={() => setWithNegated((current) => !current)} />
      </ChoiceRow>
    </SettingCard>
  </GameSetupShell>;

  const settings = settingsRef.current ?? { mode, circuitCount, gateSet: gateSetFor({ withXor, withNegated }) };
  const circuit = circuitsRef.current[index];
  const values = useMemo(() => (circuit ? evaluate(circuit, switchValues.length === circuit.inputCount ? switchValues : circuit.inputs, chosenType && circuit.missing ? { ...circuit.missing, type: chosenType } : null) : null), [circuit, switchValues, chosenType]);
  const blocked = useMemo(() => (circuit ? blockedRows(circuit) : null), [circuit]);
  const visible = (row, nodeIndex) => {
    if (row === 0) return true;
    if (circuit.mode === "gate") return chosenType ? true : !blocked[row][nodeIndex];
    return revealed;
  };
  // Switches always show their position, but in the predict/set modes no current leaves them until the circuit is
  // run (validate, or the first flip).
  const wireVisible = (row, nodeIndex) => (row === 0 ? circuit.mode === "gate" || revealed : visible(row, nodeIndex));
  const correctCount = results.filter((entry) => entry.correct).length;
  const flipResults = results.filter((entry) => entry.mode === "inputs");
  const lastResult = results.at(-1);
  const readyCopy = daily ? { title: "Trace the current", text: "Predict the bulbs, find the missing gate, then set the switches: six circuits, more gates as you go." } : READY_COPY[settings.mode];
  const verdict = feedback === "correct" ? (circuit?.mode === "inputs" ? "CIRCUIT CLOSED" : "CORRECT") : circuit?.mode === "inputs" ? "OUT OF FLIPS" : "NOT QUITE";
  const verdictDetail = !feedback || !circuit ? null
    : circuit.mode === "gate" ? (feedback === "correct" ? `${circuit.answerType} closes the circuit` : `The missing gate was ${circuit.answerType}`)
      : circuit.mode === "inputs" ? `${lastResult?.flips} flips · minimum ${circuit.minFlips}`
        : feedback === "correct" ? "Every bulb predicted" : "Some bulbs were wrong";
  const budget = circuit?.mode === "inputs" && daily ? flipBudget(circuit) : null;

  return <View style={styles.container}>
    {phase === "preflight" || isReturning ? <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflight}</Animated.View> : null}
    {phase !== "preflight" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, !daily && missionStyle]}>
      <View style={styles.header}>
        <Pressable onPress={daily ? daily.onExit : returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable>
        <Pressable onPress={() => setLegendOpen(true)} hitSlop={8} accessibilityLabel="What each gate does" style={({ pressed }) => [styles.infoButton, pressed && styles.pressed]}><Text style={styles.infoText}>i</Text></Pressable>
      </View>

      {phase === "ready" ? <Pressable onPress={beginRun} style={styles.readyScreen}>
        <Text style={styles.kicker}>{daily ? "DAILY TRAINING" : "LOGIC"}</Text>
        <Text style={styles.readyTitle}>{readyCopy.title}</Text>
        <Text style={styles.readyText}>{readyCopy.text}</Text>
        <View style={styles.cueCard}>
          <Text style={styles.cueLabel}>{settings.circuitCount} CIRCUITS · CURRENT FLOWS UPWARDS</Text>
          {settings.gateSet.map((gate) => <View key={gate} style={styles.legendRow}><Text style={styles.legendGate}>{gate}</Text><Text style={styles.legendText}>{GATE_MEANINGS[gate]}</Text></View>)}
        </View>
        <PulsingPrompt color={ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt>
      </Pressable> : null}

      {phase === "playing" && circuit ? <Animated.View key={index} entering={FadeIn.duration(180)} style={styles.playScreen}>
        <View style={styles.statusRow}>
          <View style={styles.statusColumn}><Text style={styles.statusLabel}>CIRCUIT</Text><Text style={styles.statusValue}>{index + 1}<Text style={styles.statusTotal}> / {circuitsRef.current.length}</Text></Text></View>
          <View style={styles.stageTag}>{daily ? <><Text style={styles.statusLabel}>{circuit.label}</Text><Text style={styles.stageGates}>{circuit.gateSet.join(" · ")}</Text></> : null}</View>
          <View style={[styles.statusColumn, styles.statusRight]}>{budget ? <><Text style={styles.statusLabel}>FLIPS</Text><Text style={styles.statusValue}>{flips}<Text style={styles.statusTotal}> / {budget.cap}</Text></Text></> : daily ? null : <><Text style={styles.statusLabel}>TIME</Text><Text style={styles.statusValue}>{formatSeconds(elapsed)}</Text></>}</View>
        </View>
        <View style={styles.boardArea} onLayout={(event) => setBoard(event.nativeEvent.layout)}>
          {board ? <CircuitBoard circuit={circuit} width={board.width} height={board.height} values={values} visible={visible} wireVisible={wireVisible} base={base} chosenType={chosenType} feedback={feedback} predictions={predictions} switchValues={switchValues}
            onToggleSwitch={circuit.mode === "inputs" && !feedback ? toggleSwitch : null} onToggleBulb={circuit.mode === "outputs" && !revealed ? toggleBulb : null} /> : null}
        </View>
        <View style={styles.controls}>
          {feedback ? <>
            <Text style={[styles.verdict, { color: feedback === "correct" ? SUCCESS : ERROR }]}>{verdict}<Text style={styles.verdictDetail}>  ·  {verdictDetail}</Text></Text>
            <PressScaleButton onPress={nextCircuit}>{index + 1 < circuitsRef.current.length ? "Next circuit" : "See results"}</PressScaleButton>
          </>
            : circuit.mode === "gate" ? <View style={styles.optionRow}>{circuit.options.map((type) => <Pressable key={type} disabled={Boolean(chosenType)} onPress={() => chooseGate(type)} style={({ pressed }) => [styles.gateOption, chosenType === type && styles.gateOptionChosen, pressed && styles.pressed]}><Text style={[styles.gateOptionText, chosenType === type && { color: ACCENT }]}>{type}</Text></Pressable>)}</View>
              : circuit.mode === "outputs" ? <PressScaleButton onPress={validatePrediction}>{revealed ? "Checking…" : "Validate"}</PressScaleButton>
                : <Text style={styles.flipCount}>{budget ? `${flips} ${flips === 1 ? "FLIP" : "FLIPS"} · FULL POINTS WITHIN ${budget.par}` : `${flips} ${flips === 1 ? "FLIP" : "FLIPS"}`}</Text>}
        </View>
      </Animated.View> : null}

      {phase === "summary" ? <Animated.View entering={FadeIn.duration(180)} style={styles.summaryScreen}>
        <Text style={styles.kicker}>SESSION ENDED</Text>
        <Text style={styles.summaryTitle}>Circuits traced</Text>
        <Text style={styles.summaryScore}>{correctCount}<Text style={styles.summaryScoreTotal}> / {results.length}</Text></Text>
        <Text style={styles.summaryCaption}>circuits solved</Text>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>{MODES.find((option) => option.value === settings.mode)?.label} · {settings.gateSet.length} GATES</Text>
          <Text style={styles.statLine}>Accuracy <Text style={styles.statStrong}>{results.length ? Math.round((correctCount / results.length) * 100) : 0}%</Text></Text>
          <Text style={styles.statLine}>Average per circuit <Text style={styles.statStrong}>{results.length ? formatSeconds(results.reduce((sum, entry) => sum + entry.timeMs, 0) / results.length) : "0.0"} s</Text></Text>
          {flipResults.length ? <Text style={styles.statLine}>Extra switch flips <Text style={styles.statStrong}>{flipResults.reduce((sum, entry) => sum + entry.flips - entry.minFlips, 0)}</Text></Text> : null}
        </View>
        <View style={styles.actions}>
          <TouchableOpacity activeOpacity={0.88} onPress={resetToReady} style={styles.primaryButton}><Text style={styles.primaryText}>Play again</Text></TouchableOpacity>
          <TouchableOpacity activeOpacity={0.88} onPress={returnToPreflight} style={styles.secondaryButton}><Text style={styles.secondaryText}>Change settings</Text></TouchableOpacity>
        </View>
      </Animated.View> : null}

      {legendOpen ? <Pressable onPress={() => setLegendOpen(false)} style={styles.legendBackdrop}>
        <Animated.View entering={FadeIn.duration(140)} style={styles.legendCard}>
          <Text style={styles.cueLabel}>THE GATES · CURRENT FLOWS UPWARDS</Text>
          {(daily ? gateSetFor({ withXor: true, withNegated: true }) : settings.gateSet).map((gate) => <View key={gate} style={styles.legendRow}><Text style={styles.legendGate}>{gate}</Text><Text style={styles.legendText}>{GATE_MEANINGS[gate]}</Text></View>)}
          <Text style={styles.legendClose}>TAP ANYWHERE TO CLOSE</Text>
        </Animated.View>
      </Pressable> : null}
    </Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SPACE_CADET.black }, preflightLayer: { ...StyleSheet.absoluteFill, zIndex: 1 }, missionLayer: { flex: 1, backgroundColor: SPACE_CADET.black, zIndex: 2 },
  header: { height: 64, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  infoButton: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center", marginRight: 7 }, infoText: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 15, lineHeight: 18 },
  legendBackdrop: { ...StyleSheet.absoluteFill, zIndex: 10, backgroundColor: "rgba(0,0,0,0.82)", alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }, legendCard: { width: "100%", borderRadius: 22, paddingVertical: 20, paddingHorizontal: 22, backgroundColor: SPACE_CADET.surface1, gap: 9 }, legendClose: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.5, textAlign: "center", marginTop: 10 }, backArrow: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 }, pressed: { transform: [{ scale: 0.97 }] },
  kicker: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.9, textAlign: "center" },
  readyScreen: { flex: 1, alignItems: "center", paddingHorizontal: 28, paddingTop: 40 }, readyTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 30, marginTop: 9, textAlign: "center" }, readyText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 21, maxWidth: 310, textAlign: "center", marginTop: 12 },
  cueCard: { width: "100%", borderRadius: 22, paddingVertical: 20, paddingHorizontal: 22, backgroundColor: SPACE_CADET.surface1, marginTop: 36, gap: 9 }, cueLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6, textAlign: "center", marginBottom: 6 },
  legendRow: { flexDirection: "row", alignItems: "baseline" }, legendGate: { width: 64, color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 11, letterSpacing: 1.3 }, legendText: { flex: 1, color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13 },
  beginPrompt: { marginTop: 40, textAlign: "center" },
  playScreen: { flex: 1, paddingHorizontal: 20, paddingBottom: 40 }, statusRow: { flexDirection: "row", alignItems: "flex-start", marginTop: 16 }, statusColumn: { width: 84 }, statusRight: { alignItems: "flex-end" }, stageTag: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 2 }, stageGates: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.3, marginTop: 6 }, statusLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.5 }, statusValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 28, marginTop: 3 }, statusTotal: { color: SPACE_CADET.textTertiary, fontSize: 18 },
  boardArea: { flex: 1, marginTop: 12 },
  gate: { position: "absolute", width: GATE_W, height: GATE_H, borderRadius: 11, borderWidth: 1, alignItems: "center", justifyContent: "center", shadowColor: ACCENT, shadowRadius: 18, shadowOffset: { width: 0, height: 0 } },
  gateMissing: { borderStyle: "dashed", borderColor: ACCENT, backgroundColor: SPACE_CADET.black }, gateWrong: { borderColor: ERROR }, gateCorrect: { borderColor: SUCCESS },
  gateLabel: { color: SPACE_CADET.white, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.3 }, gateMissingLabel: { color: ACCENT, fontFamily: "Gontserrat-Light", fontSize: 18, letterSpacing: 0 },
  bulbWrap: { position: "absolute", width: 64, alignItems: "center" }, bulbCaption: { fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.5, height: 16, marginBottom: 6 },
  bulb: { width: BULB_SIZE, height: BULB_SIZE, borderRadius: BULB_SIZE / 2, borderWidth: 1, alignItems: "center", justifyContent: "center", shadowColor: ACCENT, shadowRadius: 22, shadowOffset: { width: 0, height: 0 } }, bulbIconLit: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  switchTrack: { height: SWITCH_H, borderRadius: SWITCH_H / 2, borderWidth: 1, padding: 4, justifyContent: "center", shadowColor: ACCENT, shadowRadius: 16, shadowOffset: { width: 0, height: 0 } }, switchKnob: { width: SWITCH_H - 10, height: SWITCH_H - 10, borderRadius: (SWITCH_H - 10) / 2 },
  controls: { height: 92, justifyContent: "flex-end", marginTop: 8 },
  verdict: { fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6, textAlign: "center", marginBottom: 14 }, verdictDetail: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13, letterSpacing: 0 },
  optionRow: { flexDirection: "row", gap: 8 }, gateOption: { flex: 1, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.surface1, borderWidth: 1, borderColor: SPACE_CADET.borderSubtle }, gateOptionChosen: { borderColor: ACCENT, backgroundColor: LIT_BG }, gateOptionText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-SemiBold", fontSize: 12, letterSpacing: 1.4 },
  flipCount: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6, textAlign: "center", marginBottom: 18 },
  summaryScreen: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 58, paddingBottom: 48 }, summaryTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 31, marginTop: 8 }, summaryScore: { color: ACCENT, fontFamily: "Garet-Book", fontSize: 82, lineHeight: 94, marginTop: 18 }, summaryScoreTotal: { color: SPACE_CADET.textTertiary, fontSize: 36 }, summaryCaption: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 16, textAlign: "center", marginTop: -2 },
  statCard: { width: "100%", backgroundColor: SPACE_CADET.surface1, borderRadius: 22, padding: 18, gap: 10, marginTop: 30 }, statLabel: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6, marginBottom: 4 }, statLine: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13 }, statStrong: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 15 },
  actions: { width: "100%", gap: 12, marginTop: "auto" }, primaryButton: { minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.white }, primaryText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 16 }, secondaryButton: { minHeight: 52, borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" }, secondaryText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 },
});
