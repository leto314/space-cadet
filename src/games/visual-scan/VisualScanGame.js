import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import Animated, { FadeIn, interpolateColor, useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";

import { ChoiceButton, ChoiceRow, GameSetupShell, PickerSetting, SettingCard } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { createRandom, deriveSeed, randomTools } from "../../utils/random";

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

// `random` is injectable: the daily version passes a seeded generator instead of Math.random.
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


// Points of a grid (0–100): a time share, minus error penalties. The time share is 100 at or under `fast` and
// 0 at `slow`, both per cell and scaled by what makes a grid slower to read (letters, mixing, reverse order, a
// wider 5 × 5), with a gentle curve in between. Each error then costs a fixed amount that grows with the
// error's rank, and small grids forgive less: one error in a 3 × 3 already costs a medium penalty.
//   3 × 3  10, 20, 30, 40…      4 × 4  5, 10, 20, 30…      5 × 5  5, 10, 10, 20, 30…
const CELL_FAST_MS = 350;
const CELL_SLOW_MS = 1500;
const CHARACTER_FACTOR = { numbers: 1, letters: 1.15, mixed: 1.35 };
const DIRECTION_FACTOR = { forward: 1, reverse: 1.2 };
const GRID_FACTOR = { 3: 0.95, 4: 1, 5: 1.1 };
const ERROR_PENALTIES = { 3: [10, 20], 4: [5, 10, 20], 5: [5, 10, 10, 20] };
const PENALTY_STEP = 10;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export function gridPoints({ gridSize, direction, characters }, timeMs, errors) {
  const cells = gridSize * gridSize;
  const factor = CHARACTER_FACTOR[characters] * DIRECTION_FACTOR[direction] * GRID_FACTOR[gridSize];
  const fast = cells * CELL_FAST_MS * factor;
  const slow = cells * CELL_SLOW_MS * factor;
  const share = clamp((slow - timeMs) / (slow - fast), 0, 1);
  const table = ERROR_PENALTIES[gridSize];
  let penalty = 0;
  for (let rank = 0; rank < errors; rank += 1) penalty += rank < table.length ? table[rank] : table.at(-1) + PENALTY_STEP * (rank - table.length + 1);
  return clamp(Math.round(100 * share ** 1.2 - penalty), 0, 100);
}

// Daily training: three grids for everyone, 3 × 3, 4 × 4, 5 × 5. Each gets a different character set and its own
// direction, drawn from the seed. The score is the three grids' points scaled to 1000 (300 → 1000).
export const DAILY_GRIDS = [3, 4, 5];
export function buildDailyRounds(seed) {
  const rnd = randomTools(createRandom(seed));
  const characters = rnd.shuffle(CHARACTER_SETS.map((option) => option.value));
  return DAILY_GRIDS.map((gridSize, index) => {
    const settings = { gridSize, direction: rnd.chance(0.5) ? "reverse" : "forward", characters: characters[index] };
    return { settings, round: buildRound(settings, rnd.random) };
  });
}

// The ready screen's illustration: a small scrambled grid, the same every time.
const SAMPLE_CELLS = ["4", "1", "7", "2", "9", "5", "8", "3", "6"];
function SampleGrid() {
  return <View style={styles.sampleGrid}>{SAMPLE_CELLS.map((label, index) => <View key={index} style={styles.sampleCell}><Text style={styles.sampleText}>{label}</Text></View>)}</View>;
}


// `daily` ({ seed, onFinish, onExit }) turns this into the daily training version: no preflight, the day's three
// grids (DAILY_GRIDS), each with its own ready screen, then onFinish({ score, metrics, trials }).
export function VisualScanGame({ onExit, daily = null }) {
  const [gridSize, setGridSize] = useState(3);
  const [direction, setDirection] = useState("forward");
  const [characters, setCharacters] = useState("numbers");
  const dailyRoundsRef = useRef(daily ? buildDailyRounds(deriveSeed(daily.seed, "grids")) : null);
  const [phase, setPhase] = useState(daily ? "ready" : "preflight");
  const [round, setRound] = useState(daily ? dailyRoundsRef.current[0].round : null);
  const [roundId, setRoundId] = useState(0);
  const [roundIndex, setRoundIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [errors, setErrors] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [errorFlash, setErrorFlash] = useState({ index: -1, tick: 0 });
  const [result, setResult] = useState(null);
  const [results, setResults] = useState([]);
  const phaseRef = useRef(daily ? "ready" : "preflight");
  const settingsRef = useRef(daily ? dailyRoundsRef.current[0].settings : null);
  const roundRef = useRef(round);
  const progressRef = useRef(0);
  const errorsRef = useRef(0);
  const tapsRef = useRef(0);
  const resultsRef = useRef([]);
  const startedAt = useRef(0);
  const intervalRef = useRef(null);
  const timeouts = useRef([]);
  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({ onPrepareReturn: clearTimers, onReturnComplete: resetToPreflight });

  useEffect(() => () => clearTimers(), []);
  function clearTimers() { clearInterval(intervalRef.current); intervalRef.current = null; timeouts.current.forEach(clearTimeout); timeouts.current = []; }
  function goTo(nextPhase) { phaseRef.current = nextPhase; setPhase(nextPhase); }
  function resetToPreflight() { clearTimers(); setRound(null); setResult(null); goTo("preflight"); }
  function prepareRound(settings, nextRound) {
    settingsRef.current = settings;
    roundRef.current = nextRound;
    progressRef.current = 0; errorsRef.current = 0; tapsRef.current = 0;
    setRound(nextRound); setRoundId((value) => value + 1); setProgress(0); setErrors(0); setElapsed(0); setErrorFlash({ index: -1, tick: 0 }); setResult(null);
    goTo("ready");
  }
  function resetToReady() {
    clearTimers();
    const settings = settingsRef.current ?? { gridSize, direction, characters };
    prepareRound(settings, buildRound(settings, createRandom(Math.floor(Math.random() * 4294967296))));
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
    const settings = settingsRef.current;
    const count = roundRef.current.sequence.length;
    const entry = { ...settings, timeMs, errors: errorsRef.current, perCellMs: Math.round(timeMs / count), accuracy: Math.round((count / tapsRef.current) * 100), points: gridPoints(settings, timeMs, errorsRef.current) };
    resultsRef.current = [...resultsRef.current, entry];
    setResult(entry); setResults(resultsRef.current);
    timeouts.current.push(setTimeout(() => {
      if (!daily) { goTo("summary"); return; }
      if (roundIndex + 1 < dailyRoundsRef.current.length) { const next = dailyRoundsRef.current[roundIndex + 1]; setRoundIndex(roundIndex + 1); prepareRound(next.settings, next.round); return; }
      finishDaily();
    }, FINISH_DELAY_MS));
  }
  function finishDaily() {
    const entries = resultsRef.current;
    const points = entries.reduce((sum, entry) => sum + entry.points, 0);
    daily.onFinish({
      score: clamp(Math.round(points * (1000 / (entries.length * 100))), 0, 1000),
      metrics: { grids: entries.length, totalMs: entries.reduce((sum, entry) => sum + entry.timeMs, 0), errors: entries.reduce((sum, entry) => sum + entry.errors, 0), ...Object.fromEntries(entries.map((entry) => [`grid${entry.gridSize}Points`, entry.points])) },
      trials: entries.map((entry) => ({ ok: entry.errors ? 0 : 1, ms: entry.timeMs, pts: entry.points, errors: entry.errors, grid: entry.gridSize, direction: entry.direction, characters: entry.characters })),
    });
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
  const describe = (settings) => `${settings.gridSize} × ${settings.gridSize} · ${settings.direction === "reverse" ? "REVERSE" : "FORWARD"} · ${CHARACTER_SETS.find((option) => option.value === settings.characters)?.label}`;
  const settingsSummary = describe(activeSettings);
  const previous = daily && phase === "ready" ? results.at(-1) : null;

  const preflight = <GameSetupShell title="Visual Scan" categoryKey="attention" onExit={onExit} onStart={prepareRun} rules="Tests visual scanning speed and sustained focus. Tap every character on the grid in order, as fast as you can. Each validated cell locks, and every wrong tap counts as an error. A grid scores up to 100 points, fewer the longer it takes, and each error costs a little more than the one before (a small grid forgives less).Easy: A 3 × 3 grid in forward order.Medium: A 4 × 4 grid, or reverse order.Hard: A 5 × 5 grid alternating numbers and letters.">
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
    {phase !== "preflight" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, !daily && missionStyle]}>
      <View style={styles.header}><Pressable onPress={daily ? daily.onExit : returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>

      {phase === "ready" && round ? <Pressable onPress={beginRun} style={styles.readyScreen}>
        <Text style={styles.kicker}>{daily ? `DAILY TRAINING · GRID ${roundIndex + 1} / ${DAILY_GRIDS.length}` : "ATTENTION"}</Text>
        <Text style={styles.readyTitle}>{daily ? `${activeSettings.gridSize} × ${activeSettings.gridSize}, ${activeSettings.direction === "reverse" ? "descending" : "ascending"}` : "Ready to scan?"}</Text>
        <Text style={styles.readyText}>{cueText(round, activeSettings.direction)}</Text>
        <SampleGrid />
        <View style={styles.cueCard}>
          <Text style={styles.cueLabel}>{cueLabel(round, activeSettings.direction)}</Text>
          <SequencePreview sequence={round.sequence} />
        </View>
        {previous ? <Text style={styles.previousText}>Grid {roundIndex} · {formatSeconds(previous.timeMs)} s · {previous.errors} {previous.errors === 1 ? "error" : "errors"} · {previous.points} / 100</Text> : null}
        <PulsingPrompt color={ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt>
      </Pressable> : null}

      {playing && round ? <Animated.View entering={FadeIn.duration(160)} style={styles.playScreen}>
        <View style={styles.statusRow}>
          <View><Text style={styles.statusLabel}>TIME</Text><Text style={styles.statusValue}>{formatSeconds(elapsed)}</Text></View>
          <View style={styles.statusRight}><Text style={styles.statusLabel}>FOUND</Text><Text style={styles.statusValue}>{progress}<Text style={styles.statusTotal}> / {round.sequence.length}</Text></Text></View>
        </View>
        <Text style={styles.ruleKicker}>{daily ? `GRID ${roundIndex + 1} / ${DAILY_GRIDS.length} · ` : ""}{cueLabel(round, activeSettings.direction)}</Text>
        <View style={styles.gridArea}>
          <ScanGrid key={roundId} round={round} gridSize={activeSettings.gridSize} progress={progress} errorFlash={errorFlash} onTap={handleTap} />
        </View>
        <Text style={styles.errorLine}>{phase === "complete" && result ? `${result.points} / 100` : errors ? `${errors} ${errors === 1 ? "error" : "errors"}` : " "}</Text>
      </Animated.View> : null}

      {phase === "summary" && result ? <Animated.View entering={FadeIn.duration(180)} style={styles.summaryScreen}>
        <Text style={styles.kicker}>SESSION ENDED</Text>
        <Text style={styles.summaryTitle}>Scan complete</Text>
        <Text style={styles.summaryScore}>{result.points * 10}</Text>
        <Text style={styles.summaryCaption}>/ 1000 · {formatSeconds(result.timeMs)} seconds</Text>
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
  sampleGrid: { width: 118, flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 26 }, sampleCell: { width: 36, height: 36, borderRadius: 9, backgroundColor: SPACE_CADET.surface1, borderWidth: 1, borderColor: SPACE_CADET.borderSubtle, alignItems: "center", justifyContent: "center" }, sampleText: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 14 },
  cueCard: { width: "100%", maxWidth: 300, borderRadius: 22, paddingVertical: 18, paddingHorizontal: 20, alignItems: "center", backgroundColor: SPACE_CADET.surface1, marginTop: 26 }, previousText: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 12, marginTop: 14 }, cueLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6 }, previewRow: { flexDirection: "row", alignItems: "center", marginTop: 16 }, previewToken: { flexDirection: "row", alignItems: "center" }, previewValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 29 }, previewArrow: { marginHorizontal: 11 }, previewEllipsis: { color: ACCENT, fontFamily: "Garet-Book", fontSize: 22, marginLeft: 10 },
  beginPrompt: { marginTop: 30, textAlign: "center" },
  playScreen: { flex: 1, paddingHorizontal: 20, paddingBottom: 56 }, statusRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 16 }, statusRight: { alignItems: "flex-end" }, statusLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.5 }, statusValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 28, marginTop: 3 }, statusTotal: { color: SPACE_CADET.textTertiary, fontSize: 18 },
  ruleKicker: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.7, textAlign: "center", marginTop: 34 },
  gridArea: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 12 }, grid: { flexDirection: "row", flexWrap: "wrap" }, cell: { flex: 1, borderWidth: 1, alignItems: "center", justifyContent: "center" }, cellText: { color: SPACE_CADET.white, fontFamily: "Garet-Book" },
  errorLine: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 12, textAlign: "center", minHeight: 18 },
  summaryScreen: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 58, paddingBottom: 48 }, summaryTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 31, marginTop: 8 }, summaryScore: { color: ACCENT, fontFamily: "Garet-Book", fontSize: 82, lineHeight: 94, marginTop: 18 }, summaryCaption: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 16, textAlign: "center", marginTop: -2 },
  statCard: { width: "100%", backgroundColor: SPACE_CADET.surface1, borderRadius: 22, padding: 18, gap: 10, marginTop: 30 }, statLabel: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6, marginBottom: 4 }, statLine: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13 }, statStrong: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 15 },
  actions: { width: "100%", gap: 12, marginTop: "auto" }, primaryButton: { minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.white }, primaryText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 16 }, secondaryButton: { minHeight: 52, borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" }, secondaryText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 },
});
