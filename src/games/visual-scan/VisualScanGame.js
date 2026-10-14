import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import Animated, { FadeIn, interpolateColor, useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";

import { ChoiceButton, ChoiceRow, GameSetupShell, PickerSetting, SettingCard } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";

const ACCENT = SPACE_CADET.attention;
const ACCENT_CLEAR = "rgba(216,30,91,0)";
const ERROR_SOFT = "#3D101D";
const DONE_BG = "#050506";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIRECTIONS = [{ value: "forward", label: "FORWARD" }, { value: "reverse", label: "REVERSE" }];
const CHARACTER_SETS = [{ value: "numbers", label: "NUMBERS" }, { value: "letters", label: "LETTERS" }, { value: "mixed", label: "BOTH" }];
const FINISH_DELAY_MS = 520;
// Taps register on touch-down on device (every ms counts here), but react-native-web never fires onPressIn inside this app's gesture root, so web falls back to onPress.
const TAP_EVENT = Platform.OS === "web" ? "onPress" : "onPressIn";

function shuffle(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}
function numbersUpTo(count) { return Array.from({ length: count }, (_, index) => String(index + 1)); }
function lettersUpTo(count) { return LETTERS.slice(0, count).split(""); }
function formatSeconds(ms) { return (ms / 1000).toFixed(1); }

// `random` is injectable so the daily challenge can later pass a seeded generator instead of Math.random.
// In "mixed" mode the starting type gets the extra character on odd grids, and both halves run in the chosen
// direction before being interleaved: forward 1 A 2 B 3…, reverse 5 D 4 C 3… (always opening with `startsWith`).
function buildRound({ gridSize, direction, characters }, random = Math.random) {
  const count = gridSize * gridSize;
  const orient = (values) => direction === "reverse" ? [...values].reverse() : values;
  let sequence;
  let startsWith = null;
  if (characters === "mixed") {
    startsWith = random() < 0.5 ? "number" : "letter";
    const leadCount = Math.ceil(count / 2);
    const lead = orient(startsWith === "number" ? numbersUpTo(leadCount) : lettersUpTo(leadCount));
    const follow = orient(startsWith === "number" ? lettersUpTo(count - leadCount) : numbersUpTo(count - leadCount));
    sequence = lead.flatMap((value, index) => index < follow.length ? [value, follow[index]] : [value]);
  } else sequence = orient(characters === "letters" ? lettersUpTo(count) : numbersUpTo(count));
  const cells = shuffle(sequence, random);
  return { sequence, cells, ranks: cells.map((label) => sequence.indexOf(label)), startsWith };
}

function cueLabel(round, direction) {
  if (round.startsWith) return `START WITH A ${round.startsWith.toUpperCase()}`;
  return direction === "reverse" ? "DESCENDING ORDER" : "ASCENDING ORDER";
}
function cueText(round, direction) {
  if (round.startsWith) return `Alternate numbers and letters in ${direction === "reverse" ? "descending" : "ascending"} order.`;
  return `Tap every cell in order, from ${round.sequence[0]} to ${round.sequence.at(-1)}.`;
}

function SequencePreview({ sequence }) {
  const tokens = sequence.slice(0, 4);
  return <View style={styles.previewRow}>
    {tokens.map((token, index) => <View key={`${token}-${index}`} style={styles.previewToken}>
      <Text style={styles.previewValue}>{token}</Text>
      {index < tokens.length - 1 ? <Svg width="18" height="10" viewBox="0 0 18 10" style={styles.previewArrow}><Path d="M1 5h15M12 1l4 4-4 4" stroke={ACCENT} strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg> : <Text style={styles.previewEllipsis}>…</Text>}
    </View>)}
  </View>;
}

function ScanCell({ label, size, radius, fontSize, done, errorTick, onPress }) {
  const doneProgress = useSharedValue(done ? 1 : 0);
  const flash = useSharedValue(0);
  const error = useSharedValue(0);
  const shake = useSharedValue(0);

  useEffect(() => {
    if (!done) return;
    doneProgress.value = withTiming(1, { duration: 280 });
    flash.value = withSequence(withTiming(1, { duration: 60 }), withTiming(0, { duration: 420 }));
  }, [done, doneProgress, flash]);
  useEffect(() => {
    if (!errorTick) return;
    error.value = withSequence(withTiming(1, { duration: 60 }), withTiming(0, { duration: 480 }));
    shake.value = withSequence(withTiming(-5, { duration: 45 }), withTiming(5, { duration: 70 }), withTiming(-3, { duration: 60 }), withTiming(0, { duration: 50 }));
  }, [errorTick, error, shake]);

  const cellStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(error.value, [0, 1], [interpolateColor(doneProgress.value, [0, 1], [SPACE_CADET.surface1, DONE_BG]), ERROR_SOFT]),
    borderColor: interpolateColor(Math.max(flash.value, error.value), [0, 1], [ACCENT_CLEAR, ACCENT]),
    transform: [{ translateX: shake.value }, { scale: 1 + flash.value * 0.04 }],
  }));
  const textStyle = useAnimatedStyle(() => ({ opacity: 1 - doneProgress.value * 0.84 }));

  return <Pressable disabled={done} {...{ [TAP_EVENT]: onPress }} style={{ width: size, height: size }}>
    <Animated.View style={[styles.cell, { borderRadius: radius }, cellStyle]}>
      <Animated.Text style={[styles.cellText, { fontSize }, textStyle]}>{label}</Animated.Text>
    </Animated.View>
  </Pressable>;
}

function ScanGrid({ round, gridSize, progress, errorFlash, onTap }) {
  const { width } = useWindowDimensions();
  const gap = gridSize === 5 ? 7 : 9;
  const gridWidth = Math.min(width - 40, 360);
  const cellSize = (gridWidth - gap * (gridSize - 1)) / gridSize;
  const radius = Math.max(12, Math.round(cellSize * 0.17));
  const fontSize = Math.round(cellSize * 0.36);
  return <View style={[styles.grid, { width: gridWidth, gap }]}>
    {round.cells.map((label, index) => <ScanCell key={index} label={label} size={cellSize} radius={radius} fontSize={fontSize} done={round.ranks[index] < progress} errorTick={errorFlash.index === index ? errorFlash.tick : 0} onPress={() => onTap(index)} />)}
  </View>;
}

export function VisualScanGame({ onExit }) {
  const [gridSize, setGridSize] = useState(3);
  const [direction, setDirection] = useState("forward");
  const [characters, setCharacters] = useState("numbers");
  const [phase, setPhase] = useState("preflight");
  const [round, setRound] = useState(null);
  const [roundId, setRoundId] = useState(0);
  const [progress, setProgress] = useState(0);
  const [errors, setErrors] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [errorFlash, setErrorFlash] = useState({ index: -1, tick: 0 });
  const [result, setResult] = useState(null);
  const phaseRef = useRef("preflight");
  const settingsRef = useRef(null);
  const roundRef = useRef(null);
  const progressRef = useRef(0);
  const errorsRef = useRef(0);
  const tapsRef = useRef(0);
  const startedAt = useRef(0);
  const intervalRef = useRef(null);
  const timeouts = useRef([]);
  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({ onPrepareReturn: clearTimers, onReturnComplete: resetToPreflight });

  useEffect(() => () => clearTimers(), []);
  function clearTimers() { clearInterval(intervalRef.current); intervalRef.current = null; timeouts.current.forEach(clearTimeout); timeouts.current = []; }
  function goTo(nextPhase) { phaseRef.current = nextPhase; setPhase(nextPhase); }
  function resetToPreflight() { clearTimers(); setRound(null); setResult(null); goTo("preflight"); }
  function resetToReady() {
    clearTimers();
    const settings = settingsRef.current ?? { gridSize, direction, characters };
    settingsRef.current = settings;
    const nextRound = buildRound(settings);
    roundRef.current = nextRound;
    progressRef.current = 0; errorsRef.current = 0; tapsRef.current = 0;
    setRound(nextRound); setRoundId((value) => value + 1); setProgress(0); setErrors(0); setElapsed(0); setErrorFlash({ index: -1, tick: 0 }); setResult(null);
    goTo("ready");
  }
  function prepareRun() { settingsRef.current = { gridSize, direction, characters }; startMission(resetToReady); }
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
    goTo("complete");
    void triggerSuccessHaptic();
    const count = roundRef.current.sequence.length;
    setResult({ timeMs, errors: errorsRef.current, perCellMs: Math.round(timeMs / count), accuracy: Math.round((count / tapsRef.current) * 100) });
    timeouts.current.push(setTimeout(() => goTo("summary"), FINISH_DELAY_MS));
  }
  function handleTap(index) {
    if (phaseRef.current !== "playing") return;
    const rank = roundRef.current.ranks[index];
    if (rank < progressRef.current) return;
    tapsRef.current += 1;
    if (rank !== progressRef.current) {
      errorsRef.current += 1;
      setErrors(errorsRef.current);
      setErrorFlash((current) => ({ index, tick: current.tick + 1 }));
      void triggerErrorHaptic();
      return;
    }
    progressRef.current += 1;
    setProgress(progressRef.current);
    if (progressRef.current === roundRef.current.sequence.length) finishRun();
    else void triggerSelectionHaptic();
  }

  const activeSettings = settingsRef.current ?? { gridSize, direction, characters };
  const cellCount = gridSize * gridSize;
  const settingsSummary = `${activeSettings.gridSize} × ${activeSettings.gridSize} · ${activeSettings.direction === "reverse" ? "REVERSE" : "FORWARD"} · ${CHARACTER_SETS.find((option) => option.value === activeSettings.characters)?.label}`;

  const preflight = <GameSetupShell title="Visual Scan" categoryKey="attention" onExit={onExit} onStart={prepareRun} rules="Tests visual scanning speed and sustained focus. Tap every character on the grid in order, as fast as you can. Each validated cell locks, and every wrong tap counts as an error.Easy: A 3 × 3 grid in forward order.Medium: A 4 × 4 grid, or reverse order.Hard: A 5 × 5 grid alternating numbers and letters.">
    <PickerSetting label="Grid size" hint={`${cellCount} cells to find`} options={[3, 4, 5].map((value) => ({ value, label: `${value} × ${value}` }))} value={gridSize} onChange={setGridSize} />
    <SettingCard label="Direction" hint={direction === "reverse" ? "Start from the highest value and count down." : "Start from 1 or A and count up."}>
      <ChoiceRow>{DIRECTIONS.map((option) => <ChoiceButton key={option.value} compact label={option.label} selected={direction === option.value} accent={ACCENT} onPress={() => setDirection(option.value)} />)}</ChoiceRow>
    </SettingCard>
    <SettingCard label="Characters" hint={characters === "mixed" ? "Half numbers, half letters. Alternate between them." : undefined}>
      <ChoiceRow>{CHARACTER_SETS.map((option) => <ChoiceButton key={option.value} compact label={option.label} selected={characters === option.value} accent={ACCENT} onPress={() => setCharacters(option.value)} />)}</ChoiceRow>
    </SettingCard>
  </GameSetupShell>;

  const playing = phase === "playing" || phase === "complete";

  return <View style={styles.container}>
    {phase === "preflight" || isReturning ? <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflight}</Animated.View> : null}
    {phase !== "preflight" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, missionStyle]}>
      <View style={styles.header}><Pressable onPress={returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>

      {phase === "ready" && round ? <Pressable onPress={beginRun} style={styles.readyScreen}>
        <Text style={styles.kicker}>ATTENTION</Text>
        <Text style={styles.readyTitle}>Ready to scan?</Text>
        <Text style={styles.readyText}>{cueText(round, activeSettings.direction)}</Text>
        <View style={styles.cueCard}>
          <Text style={styles.cueLabel}>{cueLabel(round, activeSettings.direction)}</Text>
          <SequencePreview sequence={round.sequence} />
        </View>
        <PulsingPrompt color={ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt>
      </Pressable> : null}

      {playing && round ? <Animated.View entering={FadeIn.duration(160)} style={styles.playScreen}>
        <View style={styles.statusRow}>
          <View><Text style={styles.statusLabel}>TIME</Text><Text style={styles.statusValue}>{formatSeconds(elapsed)}</Text></View>
          <View style={styles.statusRight}><Text style={styles.statusLabel}>FOUND</Text><Text style={styles.statusValue}>{progress}<Text style={styles.statusTotal}> / {round.sequence.length}</Text></Text></View>
        </View>
        <Text style={styles.ruleKicker}>{cueLabel(round, activeSettings.direction)}</Text>
        <View style={styles.gridArea}>
          <ScanGrid key={roundId} round={round} gridSize={activeSettings.gridSize} progress={progress} errorFlash={errorFlash} onTap={handleTap} />
        </View>
        <Text style={styles.errorLine}>{errors ? `${errors} ${errors === 1 ? "error" : "errors"}` : " "}</Text>
      </Animated.View> : null}

      {phase === "summary" && result ? <Animated.View entering={FadeIn.duration(180)} style={styles.summaryScreen}>
        <Text style={styles.kicker}>SESSION ENDED</Text>
        <Text style={styles.summaryTitle}>Scan complete</Text>
        <Text style={styles.summaryScore}>{formatSeconds(result.timeMs)}</Text>
        <Text style={styles.summaryCaption}>seconds</Text>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>{settingsSummary}</Text>
          <Text style={styles.statLine}>Errors <Text style={styles.statStrong}>{result.errors}</Text></Text>
          <Text style={styles.statLine}>Average per cell <Text style={styles.statStrong}>{result.perCellMs} ms</Text></Text>
          <Text style={styles.statLine}>Accuracy <Text style={styles.statStrong}>{result.accuracy}%</Text></Text>
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
  readyScreen: { flex: 1, alignItems: "center", paddingHorizontal: 28, paddingTop: 54 }, readyTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 30, marginTop: 9, textAlign: "center" }, readyText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 21, maxWidth: 296, textAlign: "center", marginTop: 12 },
  cueCard: { width: "100%", maxWidth: 300, borderRadius: 22, paddingVertical: 24, paddingHorizontal: 20, alignItems: "center", backgroundColor: SPACE_CADET.surface1, marginTop: 52 }, cueLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6 }, previewRow: { flexDirection: "row", alignItems: "center", marginTop: 16 }, previewToken: { flexDirection: "row", alignItems: "center" }, previewValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 29 }, previewArrow: { marginHorizontal: 11 }, previewEllipsis: { color: ACCENT, fontFamily: "Garet-Book", fontSize: 22, marginLeft: 10 },
  beginPrompt: { marginTop: 48, textAlign: "center" },
  playScreen: { flex: 1, paddingHorizontal: 20, paddingBottom: 56 }, statusRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 16 }, statusRight: { alignItems: "flex-end" }, statusLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.5 }, statusValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 28, marginTop: 3 }, statusTotal: { color: SPACE_CADET.textTertiary, fontSize: 18 },
  ruleKicker: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.7, textAlign: "center", marginTop: 34 },
  gridArea: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 12 }, grid: { flexDirection: "row", flexWrap: "wrap" }, cell: { flex: 1, borderWidth: 1, alignItems: "center", justifyContent: "center" }, cellText: { color: SPACE_CADET.white, fontFamily: "Garet-Book" },
  errorLine: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 12, textAlign: "center", minHeight: 18 },
  summaryScreen: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 58, paddingBottom: 48 }, summaryTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 31, marginTop: 8 }, summaryScore: { color: ACCENT, fontFamily: "Garet-Book", fontSize: 82, lineHeight: 94, marginTop: 18 }, summaryCaption: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 16, textAlign: "center", marginTop: -2 },
  statCard: { width: "100%", backgroundColor: SPACE_CADET.surface1, borderRadius: 22, padding: 18, gap: 10, marginTop: 30 }, statLabel: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6, marginBottom: 4 }, statLine: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13 }, statStrong: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 15 },
  actions: { width: "100%", gap: 12, marginTop: "auto" }, primaryButton: { minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.white }, primaryText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 16 }, secondaryButton: { minHeight: 52, borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" }, secondaryText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 },
});
