import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";

import { ChoiceButton, ChoiceRow, GameSetupShell, PickerSetting, SettingCard } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { randomSeed } from "../../utils/random";
import { applyAction, buildDailySession, buildSession, dailyResult, DAILY_PANELS, describeAction, maskToLights, moveBudget, panelEntry, shortAction, SWITCH_LABELS, wiringVisible } from "./logic";

const ACCENT = SPACE_CADET.logic;
const LIGHT_ON_BG = "#0C2626";
const SOLVED_DELAY_MS = 900;
const FAILED_DELAY_MS = 1700;

function formatSeconds(ms) { return (ms / 1000).toFixed(1); }

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

// `daily` ({ seed, onFinish, onExit }) turns this into the daily training version: no preflight, the day's five
// panels (DAILY_PANELS), each worth 0–100 points against its move budget, then onFinish({ score, metrics, trials }).
export function SwitchboardGame({ onExit, daily = null }) {
  const [lightCount, setLightCount] = useState(4);
  const [switchCount, setSwitchCount] = useState(4);
  const [showWiring, setShowWiring] = useState(false);
  const [phase, setPhase] = useState(daily ? "ready" : "preflight");
  // The daily panels are built up front: the ready screen shows the first target.
  const [panels, setPanels] = useState(() => (daily ? buildDailySession(daily.seed) : []));
  const [index, setIndex] = useState(0);
  const [state, setState] = useState(0);
  const [moves, setMoves] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [entries, setEntries] = useState([]);
  const phaseRef = useRef(daily ? "ready" : "preflight");
  const settingsRef = useRef(null);
  const panelsRef = useRef(panels);
  const indexRef = useRef(0);
  const entriesRef = useRef([]);
  const stateRef = useRef(0);
  const movesRef = useRef(0);
  const resetsRef = useRef(0);
  const startedAt = useRef(0);
  const intervalRef = useRef(null);
  const timeouts = useRef([]);
  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({ onPrepareReturn: clearTimers, onReturnComplete: resetToPreflight });
  const panel = panels[index] ?? null;
  const metrics = useLightMetrics(panel?.lightCount ?? lightCount);

  useEffect(() => () => clearTimers(), []);
  function clearTimers() { clearInterval(intervalRef.current); intervalRef.current = null; timeouts.current.forEach(clearTimeout); timeouts.current = []; }
  function goTo(nextPhase) { phaseRef.current = nextPhase; setPhase(nextPhase); }
  function setPanelState(mask) { stateRef.current = mask; setState(mask); }
  function resetToPreflight() { clearTimers(); panelsRef.current = []; setPanels([]); entriesRef.current = []; setEntries([]); goTo("preflight"); }
  function resetToReady() {
    clearTimers();
    panelsRef.current = daily ? buildDailySession(daily.seed) : buildSession(settingsRef.current, randomSeed());
    entriesRef.current = []; indexRef.current = 0; movesRef.current = 0; resetsRef.current = 0;
    setPanels(panelsRef.current); setEntries([]); setIndex(0); setPanelState(0); setMoves(0); setElapsed(0);
    goTo("ready");
  }
  function prepareRun() { settingsRef.current = { lightCount, switchCount, showWiring }; startMission(resetToReady); }
  function startPanel(nextIndex) {
    indexRef.current = nextIndex; movesRef.current = 0; resetsRef.current = 0;
    setIndex(nextIndex); setPanelState(0); setMoves(0); setElapsed(0);
    startedAt.current = Date.now();
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => setElapsed(Date.now() - startedAt.current), 100);
    goTo("playing");
  }
  function beginRun() {
    void triggerSelectionHaptic();
    startPanel(0);
  }
  // Records the panel (solved, or out of moves), shows the verdict briefly, then moves on or finishes.
  function endPanel(solved) {
    const timeMs = Date.now() - startedAt.current;
    clearTimers();
    setElapsed(timeMs);
    goTo(solved ? "solved" : "failed");
    void (solved ? triggerSuccessHaptic() : triggerErrorHaptic());
    entriesRef.current = [...entriesRef.current, panelEntry(panelsRef.current[indexRef.current], { solved, moves: movesRef.current, resets: resetsRef.current, timeMs })];
    setEntries(entriesRef.current);
    timeouts.current.push(setTimeout(() => {
      if (indexRef.current + 1 < panelsRef.current.length) startPanel(indexRef.current + 1);
      else if (daily) finishDaily(); else goTo("summary");
    }, solved ? SOLVED_DELAY_MS : FAILED_DELAY_MS));
  }
  function finishDaily() { daily.onFinish(dailyResult(entriesRef.current)); }
  function pressSwitch(switchIndex) {
    if (phaseRef.current !== "playing") return;
    const current = panelsRef.current[indexRef.current];
    const next = applyAction(stateRef.current, current.switches[switchIndex], current.lightCount);
    movesRef.current += 1;
    setMoves(movesRef.current);
    setPanelState(next);
    if (next === current.target) endPanel(true);
    else if (daily && movesRef.current >= moveBudget(current).cap) endPanel(false);
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

  const playing = ["playing", "solved", "failed"].includes(phase);
  const solved = phase === "solved";
  const failed = phase === "failed";
  const wideSwitches = panel?.switches.length === 4;
  const budget = panel ? moveBudget(panel) : null;
  // In the daily version a hidden wiring is revealed after `revealAt` moves; Full Clearance keeps it hidden.
  const revealed = Boolean(daily && panel && !panel.showWiring && wiringVisible(panel, moves));
  const result = entries[0] ?? null;

  return <View style={styles.container}>
    {phase === "preflight" || isReturning ? <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflight}</Animated.View> : null}
    {phase !== "preflight" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, !daily && missionStyle]}>
      <View style={styles.header}><Pressable onPress={daily ? daily.onExit : returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>

      {phase === "ready" ? <Pressable onPress={beginRun} style={styles.readyScreen}>
        <Text style={styles.kicker}>{daily ? "DAILY TRAINING" : "LOGIC"}</Text>
        <Text style={styles.readyTitle}>Ready to decode?</Text>
        <Text style={styles.readyText}>{daily ? `${DAILY_PANELS.length} panels, harder as you go: the wiring is shown on the first two, hidden after (and revealed once you have pressed twice the shortest route). Each panel has a move budget; resets are free.` : "Each switch is wired differently. Work out what it does, then light the panel to match the target."}</Text>
        <View style={styles.cueCard}>
          <Text style={styles.cueLabel}>{daily ? "FIRST TARGET" : "TARGET"}</Text>
          {panel ? <LightRow lights={maskToLights(panel.target, panel.lightCount)} metrics={metrics} variant="target" compact /> : null}
        </View>
        <PulsingPrompt color={ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt>
      </Pressable> : null}

      {playing && panel ? <Animated.View key={index} entering={FadeIn.duration(160)} style={styles.playScreen}>
        <View style={styles.statusRow}>
          <View><Text style={styles.statusLabel}>{daily ? "PANEL" : "TIME"}</Text><Text style={styles.statusValue}>{daily ? <>{index + 1}<Text style={styles.statusTotal}> / {panels.length}</Text></> : formatSeconds(elapsed)}</Text></View>
          <View style={styles.statusRight}><Text style={styles.statusLabel}>MOVES</Text><Text style={styles.statusValue}>{moves}{daily ? <Text style={styles.statusTotal}> / {budget.cap}</Text> : null}</Text></View>
        </View>

        <View style={styles.board}>
          {daily ? <Text style={[styles.levelTag, revealed && styles.levelTagRevealed]}>{revealed ? "WIRING REVEALED" : panel.label}{!panel.showWiring && !revealed ? ` · REVEALED AFTER ${budget.revealAt} MOVES` : ""} · BUDGET {budget.par}</Text> : null}
          <Text style={styles.rowLabel}>TARGET</Text>
          <LightRow lights={maskToLights(panel.target, panel.lightCount)} metrics={metrics} variant="target" />
          <Text style={[styles.rowLabel, styles.panelLabel, solved && styles.rowLabelSolved, failed && styles.rowLabelFailed]}>{solved ? "ALIGNED" : failed ? "OUT OF MOVES" : "PANEL"}</Text>
          <LightRow lights={maskToLights(state, panel.lightCount)} metrics={metrics} />
        </View>

        <View style={styles.switchGrid}>
          {panel.switches.map((action, switchIndex) => <SwitchButton key={switchIndex} label={SWITCH_LABELS[switchIndex]} action={panel.showWiring || revealed ? action : null} wide={wideSwitches} disabled={solved || failed} onPress={() => pressSwitch(switchIndex)} />)}
        </View>
        <Pressable onPress={resetPanel} disabled={solved || failed || state === 0} hitSlop={10} style={({ pressed }) => [styles.resetButton, pressed && styles.pressed]}>
          <Text style={[styles.resetText, (solved || failed || state === 0) && styles.resetTextDisabled]}>RESET PANEL</Text>
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
          {panel.switches.map((action, switchIndex) => <Text key={switchIndex} style={styles.wiringLine}><Text style={styles.wiringKey}>{SWITCH_LABELS[switchIndex]}  </Text>{describeAction(action)}</Text>)}
          <Text style={styles.solutionLine}>Shortest route  <Text style={styles.statStrong}>{panel.solution.map((switchIndex) => SWITCH_LABELS[switchIndex]).join(" → ")}</Text></Text>
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
  playScreen: { flex: 1, paddingHorizontal: 20, paddingBottom: 48 }, statusRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 16 }, statusRight: { alignItems: "flex-end" }, statusLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.5 }, statusValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 28, marginTop: 3 }, statusTotal: { color: SPACE_CADET.textTertiary, fontSize: 18 },
  board: { flex: 1, alignItems: "center", justifyContent: "center" }, levelTag: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.6, marginBottom: 22 }, levelTagRevealed: { color: ACCENT }, rowLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.6, marginBottom: 14 }, panelLabel: { marginTop: 40 }, rowLabelSolved: { color: ACCENT }, rowLabelFailed: { color: SPACE_CADET.attention },
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
