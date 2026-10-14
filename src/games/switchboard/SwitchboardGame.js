import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";

import { ChoiceButton, ChoiceRow, GameSetupShell, PickerSetting, SettingCard } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";

const ACCENT = SPACE_CADET.logic;
const LIGHT_ON_BG = "#0C2626";
const SWITCH_LABELS = ["A", "B", "C", "D", "E"];
const MAX_TARGET_DEPTH = 5;
const GENERATION_ATTEMPTS = 80;
const SOLVED_DELAY_MS = 900;

function randomInt(min, max, random) { return Math.floor(random() * (max - min + 1)) + min; }
function pickDistinct(count, total, random) {
  const pool = Array.from({ length: total }, (_, index) => index);
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  return pool.slice(0, count);
}
function bit(mask, index) { return (mask >> index) & 1; }
function maskToLights(mask, count) { return Array.from({ length: count }, (_, index) => bit(mask, index) === 1); }
function formatSeconds(ms) { return (ms / 1000).toFixed(1); }

// Lights are a bitmask (bit i = light i). Every action is a pure mask -> mask function, so the whole puzzle
// can be solved exactly by BFS: with at most 6 lights there are only 64 states.
function applyAction(mask, action, count) {
  if (action.type === "toggle") return action.cells.reduce((next, index) => next ^ (1 << index), mask);
  if (action.type === "swap") {
    const [a, b] = action.cells;
    return bit(mask, a) === bit(mask, b) ? mask : mask ^ (1 << a) ^ (1 << b);
  }
  if (action.type === "shift") {
    let next = 0;
    for (let index = 0; index < count; index += 1) if (bit(mask, index)) next |= 1 << ((index + action.direction + count) % count);
    return next;
  }
  const [from, to] = action.cells;
  return bit(mask, from) ? mask | (1 << to) : mask & ~(1 << to);
}

function actionSignature(action) {
  if (action.type === "toggle") return `t:${[...action.cells].sort().join(",")}`;
  if (action.type === "swap") return `s:${[...action.cells].sort().join(",")}`;
  if (action.type === "shift") return `r:${action.direction}`;
  return `c:${action.cells.join(">")}`;
}

function randomAction(type, count, random) {
  if (type === "toggle") return { type, cells: pickDistinct(randomInt(1, Math.min(3, count - 1), random), count, random) };
  if (type === "shift") return { type, direction: random() < 0.5 ? -1 : 1 };
  return { type, cells: pickDistinct(2, count, random) };
}

// Everything starts dark, so a panel needs at least one toggle to light anything; the other switches draw from
// all four action types. Duplicate wirings are rejected so every switch does something distinct.
function buildSwitches(lightCount, switchCount, random) {
  const actions = [randomAction("toggle", lightCount, random)];
  const seen = new Set([actionSignature(actions[0])]);
  const types = ["toggle", "toggle", "swap", "shift", "copy"];
  while (actions.length < switchCount) {
    const candidate = randomAction(types[Math.floor(random() * types.length)], lightCount, random);
    const signature = actionSignature(candidate);
    if (seen.has(signature)) continue;
    seen.add(signature);
    actions.push(candidate);
  }
  return pickDistinct(actions.length, actions.length, random).map((index) => actions[index]);
}

function explore(actions, count) {
  const distance = new Map([[0, 0]]);
  const parent = new Map();
  const queue = [0];
  while (queue.length) {
    const mask = queue.shift();
    actions.forEach((action, actionIndex) => {
      const next = applyAction(mask, action, count);
      if (distance.has(next)) return;
      distance.set(next, distance.get(mask) + 1);
      parent.set(next, { from: mask, actionIndex });
      queue.push(next);
    });
  }
  return { distance, parent };
}

function shortestPath(parent, target) {
  const path = [];
  let cursor = target;
  while (parent.has(cursor)) { const step = parent.get(cursor); path.unshift(step.actionIndex); cursor = step.from; }
  return path;
}

// Picks a target that is deep enough to need thought (and, when possible, one that can't be reached with the
// toggle switches alone, so the swap/shift/copy switches actually matter). `random` is injectable for the
// seeded daily challenge.
export function buildPanel({ lightCount, switchCount }, random = Math.random) {
  const minDepth = lightCount <= 3 ? 2 : 3;
  let best = null;
  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    const switches = buildSwitches(lightCount, switchCount, random);
    const { distance, parent } = explore(switches, lightCount);
    const toggleOnly = explore(switches.filter((action) => action.type === "toggle"), lightCount).distance;
    const candidates = [...distance.entries()]
      .filter(([, depth]) => depth >= 2 && depth <= MAX_TARGET_DEPTH)
      .map(([mask, depth]) => ({ mask, depth, score: depth + (!toggleOnly.has(mask) || toggleOnly.get(mask) > depth ? 1.5 : 0) }))
      .sort((a, b) => b.score - a.score);
    if (!candidates.length) continue;
    const choice = candidates[Math.floor(random() * Math.min(3, candidates.length))];
    const panel = { lightCount, switches, target: choice.mask, optimal: choice.depth, solution: shortestPath(parent, choice.mask) };
    if (choice.depth >= minDepth) return panel;
    if (!best || choice.depth > best.optimal) best = panel;
  }
  return best;
}

function listLights(cells) {
  const labels = cells.map((index) => index + 1).sort((a, b) => a - b);
  return labels.length === 1 ? `light ${labels[0]}` : `lights ${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}
function describeAction(action) {
  if (action.type === "toggle") return `Toggles ${listLights(action.cells)}`;
  if (action.type === "swap") return `Swaps ${listLights(action.cells)}`;
  if (action.type === "shift") return `Shifts the row ${action.direction > 0 ? "right" : "left"}`;
  return `Copies light ${action.cells[0] + 1} onto light ${action.cells[1] + 1}`;
}

function shortAction(action) {
  const lights = (action.cells ?? []).map((index) => index + 1);
  if (action.type === "toggle") return `Toggle ${[...lights].sort((a, b) => a - b).join(" · ")}`;
  if (action.type === "swap") return `Swap ${lights[0]} and ${lights[1]}`;
  if (action.type === "shift") return `Shift ${action.direction > 0 ? "right" : "left"}`;
  return `Copy ${lights[0]} to ${lights[1]}`;
}

function useLightMetrics(count) {
  const { width } = useWindowDimensions();
  const gap = count >= 6 ? 8 : 10;
  const rowWidth = Math.min(width - 40, 360);
  const size = Math.min(72, Math.floor((rowWidth - gap * (count - 1)) / count));
  return { gap, size, radius: Math.round(size * 0.26) };
}

function PanelLight({ on, size, radius }) {
  const pulse = useSharedValue(1);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    pulse.value = withSequence(withTiming(1.07, { duration: 80 }), withTiming(1, { duration: 170 }));
  }, [on, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  return <Animated.View style={[styles.light, { width: size, height: size, borderRadius: radius }, on && styles.lightOn, pulseStyle]} />;
}

// The target row normally shares the panel's column widths so each target light sits right above its panel
// light; `compact` drops that alignment (for the narrower briefing card).
function LightRow({ lights, metrics, variant = "panel", compact = false }) {
  const small = variant === "target";
  const size = small ? Math.round(metrics.size * (compact ? 0.52 : 0.46)) : metrics.size;
  const radius = small ? Math.round(size * 0.3) : metrics.radius;
  const columnWidth = compact ? size : metrics.size;
  return <View style={[styles.lightRow, { gap: compact ? 14 : metrics.gap }]}>
    {lights.map((on, index) => <View key={index} style={{ width: columnWidth, alignItems: "center" }}>
      {small ? <View style={[styles.targetLight, { width: size, height: size, borderRadius: radius }, on && styles.targetLightOn]} /> : <PanelLight on={on} size={size} radius={radius} />}
    </View>)}
  </View>;
}

function SwitchButton({ label, action, onPress, disabled, wide }) {
  return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.switchButton, wide && styles.switchButtonWide, pressed && styles.switchPressed]}>
    <Text style={styles.switchKicker}>{action ? `SWITCH ${label}` : "SWITCH"}</Text>
    {action ? <Text numberOfLines={1} adjustsFontSizeToFit style={styles.switchAction}>{shortAction(action)}</Text> : <Text style={styles.switchLabel}>{label}</Text>}
  </Pressable>;
}

export function SwitchboardGame({ onExit }) {
  const [lightCount, setLightCount] = useState(4);
  const [switchCount, setSwitchCount] = useState(4);
  const [showWiring, setShowWiring] = useState(false);
  const [phase, setPhase] = useState("preflight");
  const [panel, setPanel] = useState(null);
  const [state, setState] = useState(0);
  const [moves, setMoves] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const phaseRef = useRef("preflight");
  const settingsRef = useRef(null);
  const panelRef = useRef(null);
  const stateRef = useRef(0);
  const movesRef = useRef(0);
  const resetsRef = useRef(0);
  const startedAt = useRef(0);
  const intervalRef = useRef(null);
  const timeouts = useRef([]);
  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({ onPrepareReturn: clearTimers, onReturnComplete: resetToPreflight });
  const activeLightCount = panel?.lightCount ?? lightCount;
  const metrics = useLightMetrics(activeLightCount);

  useEffect(() => () => clearTimers(), []);
  function clearTimers() { clearInterval(intervalRef.current); intervalRef.current = null; timeouts.current.forEach(clearTimeout); timeouts.current = []; }
  function goTo(nextPhase) { phaseRef.current = nextPhase; setPhase(nextPhase); }
  function setPanelState(mask) { stateRef.current = mask; setState(mask); }
  function resetToPreflight() { clearTimers(); setPanel(null); setResult(null); goTo("preflight"); }
  function resetToReady() {
    clearTimers();
    const nextPanel = buildPanel(settingsRef.current);
    panelRef.current = nextPanel;
    movesRef.current = 0; resetsRef.current = 0;
    setPanel(nextPanel); setPanelState(0); setMoves(0); setElapsed(0); setResult(null);
    goTo("ready");
  }
  function prepareRun() { settingsRef.current = { lightCount, switchCount, showWiring }; startMission(resetToReady); }
  function beginRun() {
    void triggerSelectionHaptic();
    startedAt.current = Date.now();
    intervalRef.current = setInterval(() => setElapsed(Date.now() - startedAt.current), 100);
    goTo("playing");
  }
  function finishRun() {
    const timeMs = Date.now() - startedAt.current;
    clearTimers();
    setElapsed(timeMs);
    goTo("solved");
    void triggerSuccessHaptic();
    setResult({ timeMs, moves: movesRef.current, optimal: panelRef.current.optimal, resets: resetsRef.current });
    timeouts.current.push(setTimeout(() => goTo("summary"), SOLVED_DELAY_MS));
  }
  function pressSwitch(index) {
    if (phaseRef.current !== "playing") return;
    const current = panelRef.current;
    const next = applyAction(stateRef.current, current.switches[index], current.lightCount);
    movesRef.current += 1;
    setMoves(movesRef.current);
    setPanelState(next);
    if (next === current.target) finishRun();
    else void triggerSelectionHaptic();
  }
  function resetPanel() {
    if (phaseRef.current !== "playing" || stateRef.current === 0) return;
    void triggerSelectionHaptic();
    resetsRef.current += 1;
    setPanelState(0);
  }

  const preflight = <GameSetupShell title="Switchboard" categoryKey="logic" onExit={onExit} onStart={prepareRun} rules="Tests rule discovery and planning. Each switch is secretly wired to the lights: it can toggle some of them, swap two lights, shift the whole row, or copy one light onto another. Work out what every switch does, then reproduce the target pattern. Clicks are unlimited, but fewer is better. Show the wiring to skip the discovery step and focus on planning.Easy: 3 or 4 lights, 3 switches, wiring shown.Medium: 5 lights and 4 switches, wiring hidden.Hard: 6 lights and 5 switches, wiring hidden.">
    <PickerSetting label="Lights" hint="Number of lights on the panel" options={[3, 4, 5, 6].map((value) => ({ value, label: String(value) }))} value={lightCount} onChange={setLightCount} />
    <PickerSetting label="Switches" hint="Each switch gets a random wiring" options={[3, 4, 5].map((value) => ({ value, label: String(value) }))} value={switchCount} onChange={setSwitchCount} />
    <SettingCard label="Wiring" hint={showWiring ? "Each switch shows what it does." : "Discover what each switch does yourself."}>
      <ChoiceRow>
        <ChoiceButton compact label="HIDDEN" selected={!showWiring} accent={ACCENT} onPress={() => setShowWiring(false)} />
        <ChoiceButton compact label="SHOWN" selected={showWiring} accent={ACCENT} onPress={() => setShowWiring(true)} />
      </ChoiceRow>
    </SettingCard>
  </GameSetupShell>;

  const playing = phase === "playing" || phase === "solved";
  const solved = phase === "solved";
  const wideSwitches = panel?.switches.length === 4;

  return <View style={styles.container}>
    {phase === "preflight" || isReturning ? <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflight}</Animated.View> : null}
    {phase !== "preflight" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, missionStyle]}>
      <View style={styles.header}><Pressable onPress={returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>

      {phase === "ready" && panel ? <Pressable onPress={beginRun} style={styles.readyScreen}>
        <Text style={styles.kicker}>LOGIC</Text>
        <Text style={styles.readyTitle}>Ready to decode?</Text>
        <Text style={styles.readyText}>Each switch is wired differently. Work out what it does, then light the panel to match the target.</Text>
        <View style={styles.cueCard}>
          <Text style={styles.cueLabel}>TARGET</Text>
          <LightRow lights={maskToLights(panel.target, panel.lightCount)} metrics={metrics} variant="target" compact />
        </View>
        <PulsingPrompt color={ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt>
      </Pressable> : null}

      {playing && panel ? <Animated.View entering={FadeIn.duration(160)} style={styles.playScreen}>
        <View style={styles.statusRow}>
          <View><Text style={styles.statusLabel}>TIME</Text><Text style={styles.statusValue}>{formatSeconds(elapsed)}</Text></View>
          <View style={styles.statusRight}><Text style={styles.statusLabel}>MOVES</Text><Text style={styles.statusValue}>{moves}</Text></View>
        </View>

        <View style={styles.board}>
          <Text style={styles.rowLabel}>TARGET</Text>
          <LightRow lights={maskToLights(panel.target, panel.lightCount)} metrics={metrics} variant="target" />
          <Text style={[styles.rowLabel, styles.panelLabel, solved && styles.rowLabelSolved]}>{solved ? "ALIGNED" : "PANEL"}</Text>
          <LightRow lights={maskToLights(state, panel.lightCount)} metrics={metrics} />
        </View>

        <View style={styles.switchGrid}>
          {panel.switches.map((action, index) => <SwitchButton key={index} label={SWITCH_LABELS[index]} action={settingsRef.current?.showWiring ? action : null} wide={wideSwitches} disabled={solved} onPress={() => pressSwitch(index)} />)}
        </View>
        <Pressable onPress={resetPanel} disabled={solved || state === 0} hitSlop={10} style={({ pressed }) => [styles.resetButton, pressed && styles.pressed]}>
          <Text style={[styles.resetText, (solved || state === 0) && styles.resetTextDisabled]}>RESET PANEL</Text>
        </Pressable>
      </Animated.View> : null}

      {phase === "summary" && result && panel ? <Animated.View entering={FadeIn.duration(180)} style={styles.summaryScreen}>
        <Text style={styles.kicker}>SESSION ENDED</Text>
        <Text style={styles.summaryTitle}>Panel aligned</Text>
        <Text style={styles.summaryScore}>{result.moves}</Text>
        <Text style={styles.summaryCaption}>{result.moves === 1 ? "move" : "moves"} · shortest possible {result.optimal}</Text>
        <View style={styles.statCard}>
          <Text style={styles.statLine}>Time <Text style={styles.statStrong}>{formatSeconds(result.timeMs)} s</Text></Text>
          <Text style={styles.statLine}>Extra moves <Text style={styles.statStrong}>{result.moves - result.optimal}</Text></Text>
          <Text style={styles.statLine}>Resets <Text style={styles.statStrong}>{result.resets}</Text></Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>WIRING</Text>
          {panel.switches.map((action, index) => <Text key={index} style={styles.wiringLine}><Text style={styles.wiringKey}>{SWITCH_LABELS[index]}  </Text>{describeAction(action)}</Text>)}
          <Text style={styles.solutionLine}>Shortest route  <Text style={styles.statStrong}>{panel.solution.map((index) => SWITCH_LABELS[index]).join(" → ")}</Text></Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity activeOpacity={0.88} onPress={resetToReady} style={styles.primaryButton}><Text style={styles.primaryText}>Play again</Text></TouchableOpacity>
          <TouchableOpacity activeOpacity={0.88} onPress={returnToPreflight} style={styles.secondaryButton}><Text style={styles.secondaryText}>Change settings</Text></TouchableOpacity>
        </View>
      </Animated.View> : null}
    </Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SPACE_CADET.black }, preflightLayer: { ...StyleSheet.absoluteFill, zIndex: 1 }, missionLayer: { flex: 1, backgroundColor: SPACE_CADET.black, zIndex: 2 },
  header: { height: 64, paddingHorizontal: 20, justifyContent: "center" }, backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, backArrow: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 }, pressed: { transform: [{ scale: 0.97 }] },
  kicker: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.9, textAlign: "center" },
  readyScreen: { flex: 1, alignItems: "center", paddingHorizontal: 28, paddingTop: 54 }, readyTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 30, marginTop: 9, textAlign: "center" }, readyText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 21, maxWidth: 300, textAlign: "center", marginTop: 12 },
  cueCard: { width: "100%", borderRadius: 22, paddingVertical: 24, alignItems: "center", backgroundColor: SPACE_CADET.surface1, marginTop: 52 }, cueLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6, marginBottom: 16 },
  beginPrompt: { marginTop: 48, textAlign: "center" },
  playScreen: { flex: 1, paddingHorizontal: 20, paddingBottom: 48 }, statusRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 16 }, statusRight: { alignItems: "flex-end" }, statusLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.5 }, statusValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 28, marginTop: 3 },
  board: { flex: 1, alignItems: "center", justifyContent: "center" }, rowLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.6, marginBottom: 14 }, panelLabel: { marginTop: 40 }, rowLabelSolved: { color: ACCENT },
  lightRow: { flexDirection: "row", justifyContent: "center", overflow: "visible" },
  light: { backgroundColor: SPACE_CADET.surface1, borderWidth: 1, borderColor: "transparent", shadowColor: ACCENT, shadowOpacity: 0, shadowRadius: 24, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
  lightOn: { zIndex: 2, backgroundColor: LIGHT_ON_BG, borderColor: ACCENT, shadowOpacity: 0.42, elevation: 8 },
  targetLight: { borderWidth: 1, borderColor: SPACE_CADET.borderDefault },
  targetLightOn: { backgroundColor: LIGHT_ON_BG, borderColor: ACCENT, shadowColor: ACCENT, shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
  switchGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10 },
  switchButton: { width: "31%", height: 74, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.surface1, borderWidth: 1, borderColor: SPACE_CADET.borderSubtle }, switchButtonWide: { width: "48%" }, switchPressed: { backgroundColor: SPACE_CADET.surface3, transform: [{ scale: 0.96 }] },
  switchKicker: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 8, letterSpacing: 1.4 }, switchLabel: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 24, marginTop: 4 }, switchAction: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 13, marginTop: 8, paddingHorizontal: 8 },
  resetButton: { alignSelf: "center", marginTop: 22, paddingVertical: 6, paddingHorizontal: 12 }, resetText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6 }, resetTextDisabled: { color: SPACE_CADET.textTertiary, opacity: 0.5 },
  summaryScreen: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 34, paddingBottom: 48 }, summaryTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 31, marginTop: 8 }, summaryScore: { color: ACCENT, fontFamily: "Garet-Book", fontSize: 72, lineHeight: 84, marginTop: 12 }, summaryCaption: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 15, textAlign: "center", marginTop: -2 },
  statCard: { width: "100%", backgroundColor: SPACE_CADET.surface1, borderRadius: 22, padding: 18, gap: 9, marginTop: 16 }, statLabel: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6, marginBottom: 2 }, statLine: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13 }, statStrong: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 15 },
  wiringLine: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13 }, wiringKey: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 14 }, solutionLine: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13, marginTop: 4 },
  actions: { width: "100%", gap: 12, marginTop: "auto" }, primaryButton: { minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.white }, primaryText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 16 }, secondaryButton: { minHeight: 52, borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" }, secondaryText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 },
});
