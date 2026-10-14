import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";

import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { createRandom, randomTools } from "../../utils/random";
import { BlockKicker, LED_IDLE, ModuleBlock, tint, useFeedbackFlash } from "../kit";

const LETTERS = "ABCDEFGHI";

function Grid({ cells, renderCell, gap = 6 }) {
  return <View style={[styles.grid, { gap }]}>
    {[0, 1, 2].map((row) => <View key={row} style={[styles.gridRow, { gap }]}>{[0, 1, 2].map((column) => renderCell(cells[row * 3 + column], row * 3 + column))}</View>)}
  </View>;
}

// ---- Mini Visual Scan ------------------------------------------------------------------------------------
// Each completed grid unlocks a harder order; after the last level the cycle keeps its hardest steps.
const SCAN_LEVELS = [
  { characters: "numbers", reverse: false }, { characters: "numbers", reverse: true },
  { characters: "letters", reverse: false }, { characters: "letters", reverse: true },
  { characters: "mixed", reverse: false }, { characters: "mixed", reverse: true },
];
const SCAN_SECONDS_PER_GRID = 26;

function buildScanRound(level, rnd) {
  const orient = (values) => (level.reverse ? [...values].reverse() : values);
  let sequence;
  if (level.characters === "mixed") {
    const numbersFirst = rnd.chance(0.5);
    const lead = orient(numbersFirst ? ["1", "2", "3", "4", "5"] : LETTERS.slice(0, 5).split(""));
    const follow = orient(numbersFirst ? LETTERS.slice(0, 4).split("") : ["1", "2", "3", "4"]);
    sequence = lead.flatMap((value, index) => (index < follow.length ? [value, follow[index]] : [value]));
  } else sequence = orient(level.characters === "letters" ? LETTERS.split("") : ["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  return { sequence, cells: rnd.shuffle(sequence) };
}
const scanHint = (round) => `${round.sequence[0]} → ${round.sequence[1]} → ${round.sequence[2]} …`;

export function MiniScanModule({ rects, runtime, color }) {
  const rnd = useMemo(() => randomTools(createRandom(runtime.seed)), [runtime.seed]);
  const [level, setLevel] = useState(0);
  const [round, setRound] = useState(() => buildScanRound(SCAN_LEVELS[0], rnd));
  const [progress, setProgress] = useState(0);
  const stats = useRef({ grids: 0, errors: 0 });
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";

  useEffect(() => runtime.register(() => {
    const target = runtime.durationMs / 1000 / SCAN_SECONDS_PER_GRID;
    return { performance: Math.max(0, Math.min(1, stats.current.grids / target) - 0.03 * stats.current.errors), detail: `${stats.current.grids} grids cleared${stats.current.errors ? ` · ${stats.current.errors} wrong taps` : ""}` };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  function tap(index) {
    if (!running) return;
    const rank = round.sequence.indexOf(round.cells[index]);
    if (rank < progress) return;
    if (rank !== progress) { stats.current.errors += 1; feedback.flash(false); void triggerErrorHaptic(); return; }
    if (progress + 1 < round.sequence.length) { setProgress(progress + 1); void triggerSelectionHaptic(); return; }
    stats.current.grids += 1;
    feedback.flash(true);
    void triggerSuccessHaptic();
    const nextLevel = Math.min(level + 1, SCAN_LEVELS.length - 1);
    setLevel(nextLevel);
    setRound(buildScanRound(SCAN_LEVELS[nextLevel], rnd));
    setProgress(0);
  }

  return <ModuleBlock rect={rects.grid} color={color} flash={feedback.style}>
    <View style={styles.header}><BlockKicker color={color}>SCAN</BlockKicker><Text style={styles.hint}>{scanHint(round)}</Text></View>
    <Grid cells={round.cells} renderCell={(label, index) => {
      const done = round.sequence.indexOf(label) < progress;
      return <Pressable key={index} disabled={!running || done} onPress={() => tap(index)} style={({ pressed }) => [styles.cell, done && styles.cellDone, pressed && { backgroundColor: tint(color, 0.18) }]}>
        <Text style={[styles.cellText, done && styles.cellTextDone]}>{label}</Text>
      </Pressable>;
    }} />
  </ModuleBlock>;
}

export const miniScanModule = {
  id: "mini-scan",
  title: "Sequence scan",
  competence: "attention",
  secondary: [],
  task: "opportunistic",
  voice: false,
  load: 2,
  rule: "Tap the nine cells in the order shown at the top. Each cleared grid brings a harder order: reversed, letters, then numbers and letters alternating. Clear as many as you can.",
  recap: "clear the scan grids",
  blocks: [{ key: "grid", role: "display", h: 2, w: 2 }],
  Component: MiniScanModule,
};

// ---- Mini Visual Memory ----------------------------------------------------------------------------------
const FLASH_MS = 3600;
const BLANK_MS = 900;
const RECALL_MS = 17000;

function buildMemorySchedule(seed, durationMs) {
  const rnd = randomTools(createRandom(seed));
  const rounds = [];
  for (let at = rnd.int(5000, 8000); at < durationMs - RECALL_MS - 3000; at += rnd.int(24000, 32000)) rounds.push({ at, order: rnd.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]) });
  return rounds;
}

export function MiniMemoryModule({ rects, runtime, color }) {
  const rounds = useMemo(() => buildMemorySchedule(runtime.seed, runtime.durationMs), [runtime.seed, runtime.durationMs]);
  const [phase, setPhase] = useState("idle");
  const [lit, setLit] = useState([]);
  const [picked, setPicked] = useState([]);
  const [missed, setMissed] = useState([]);
  const state = useRef({ next: 0, size: 3, round: null });
  const scores = useRef([]);
  const blink = useSharedValue(0);
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";

  useEffect(() => runtime.register(() => {
    const count = scores.current.length;
    const mean = count ? scores.current.reduce((sum, value) => sum + value, 0) / count : 0;
    return { performance: mean, detail: `${scores.current.filter((value) => value === 1).length}/${count} patterns recalled · up to ${state.current.size} cells` };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  function finish(score) {
    const current = state.current;
    scores.current.push(score);
    current.size = score === 1 ? Math.min(6, current.size + 1) : Math.max(3, current.size - 1);
    current.round = null;
    feedback.flash(score === 1);
    void (score === 1 ? triggerSuccessHaptic() : triggerErrorHaptic());
    setPhase("result");
    setTimeout(() => { setPhase("idle"); setPicked([]); setMissed([]); setLit([]); }, 1200);
  }

  useEffect(() => {
    if (!running) return undefined;
    const current = state.current;
    const timer = setInterval(() => {
      const now = runtime.elapsed();
      const round = current.round;
      if (round) {
        const age = now - round.at;
        if (round.phase === "flash" && age > FLASH_MS) { round.phase = "blank"; setPhase("blank"); }
        else if (round.phase === "blank" && age > FLASH_MS + BLANK_MS) { round.phase = "recall"; setPhase("recall"); }
        else if (round.phase === "recall" && age > FLASH_MS + BLANK_MS + RECALL_MS) { setMissed(round.targets.filter((cell) => !round.picked.includes(cell))); finish(round.picked.length / round.targets.length); }
        return;
      }
      if (current.next < rounds.length && now >= rounds[current.next].at) {
        const targets = rounds[current.next].order.slice(0, current.size);
        current.round = { at: now, phase: "flash", targets, picked: [] };
        current.next += 1;
        setLit(targets); setPicked([]); setMissed([]); setPhase("flash");
        blink.value = withSequence(withTiming(1, { duration: 80 }), withTiming(0, { duration: 900 }));
        void triggerSelectionHaptic();
      }
    }, 50);
    return () => clearInterval(timer);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  function tap(cell) {
    const round = state.current.round;
    if (!running || !round || round.phase !== "recall" || round.picked.includes(cell)) return;
    if (!round.targets.includes(cell)) { setMissed(round.targets.filter((target) => !round.picked.includes(target))); finish(round.picked.length / round.targets.length); return; }
    round.picked.push(cell);
    setPicked([...round.picked]);
    if (round.picked.length === round.targets.length) finish(1);
    else void triggerSelectionHaptic();
  }

  const ledStyle = useAnimatedStyle(() => ({ backgroundColor: blink.value > 0.05 ? color : LED_IDLE, opacity: 0.35 + blink.value * 0.65 }));
  const label = { idle: "STAND BY", flash: "MEMORIZE", blank: "HOLD IT", recall: "RECALL", result: "" }[phase];

  return <ModuleBlock rect={rects.grid} color={color} led={ledStyle} flash={feedback.style}>
    <View style={styles.header}><BlockKicker color={color}>MEMORY</BlockKicker><Text style={styles.hint}>{label}</Text></View>
    <Grid cells={[0, 1, 2, 3, 4, 5, 6, 7, 8]} renderCell={(cell) => {
      const on = (phase === "flash" && lit.includes(cell)) || picked.includes(cell);
      const miss = missed.includes(cell);
      return <Pressable key={cell} disabled={phase !== "recall"} onPress={() => tap(cell)} style={[styles.cell, on && { backgroundColor: tint(color, 0.28), borderColor: color, shadowColor: color, shadowOpacity: 0.45, shadowRadius: 10 }, miss && { borderColor: color, borderStyle: "dashed" }]} />;
    }} />
  </ModuleBlock>;
}

export const miniMemoryModule = {
  id: "mini-memory",
  title: "Pattern memory",
  competence: "memory",
  secondary: [],
  task: "event",
  voice: false,
  load: 2,
  rule: "From time to time a few cells light up briefly (the light blinks and the phone vibrates). Remember them, then tap the same cells when RECALL appears. The pattern grows after a success and shrinks after a miss.",
  recap: "recall the flashed patterns",
  blocks: [{ key: "grid", role: "display", h: 2, w: 2 }],
  Component: MiniMemoryModule,
};

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 12, paddingRight: 30 },
  hint: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.1 },
  grid: { flex: 1, padding: 10, paddingTop: 8 },
  gridRow: { flex: 1, flexDirection: "row" },
  cell: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: SPACE_CADET.borderSubtle, backgroundColor: SPACE_CADET.black, alignItems: "center", justifyContent: "center", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0 },
  cellDone: { backgroundColor: "transparent", borderColor: "transparent" },
  cellText: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 17 },
  cellTextDone: { color: SPACE_CADET.textTertiary, opacity: 0.4 },
});
