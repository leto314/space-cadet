import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";

import { SPACE_CADET } from "../../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../../utils/haptics";
import { BlockKicker, LED_IDLE, ModuleBlock, tint, useFeedbackFlash } from "../../kit";
import { BLANK_MS, buildContent, emptyStats, FLASH_MS, MEMORY_MAX_SIZE, MEMORY_MIN_SIZE, miniMemorySpec, miniScanSpec, moduleResult, RECALL_MS, scanHint } from "./logic";

function Grid({ cells, renderCell, gap = 6 }) {
  return <View style={[styles.grid, { gap }]}>
    {[0, 1, 2].map((row) => <View key={row} style={[styles.gridRow, { gap }]}>{[0, 1, 2].map((column) => renderCell(cells[row * 3 + column], row * 3 + column))}</View>)}
  </View>;
}

// ---- Sequence scan ---------------------------------------------------------------------------------------
export function MiniScanModule({ rects, runtime, color }) {
  const context = { durationMs: runtime.durationMs };
  const grids = useMemo(() => buildContent(miniScanSpec, runtime.seed, context), [runtime.seed, runtime.durationMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const stats = useRef(emptyStats(miniScanSpec));
  const round = grids[Math.min(index, grids.length - 1)];
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";

  useEffect(() => runtime.register(() => moduleResult(miniScanSpec, stats.current, context)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function tap(index) {
    if (!running) return;
    const rank = round.sequence.indexOf(round.cells[index]);
    if (rank < progress) return;
    if (rank !== progress) { stats.current.errors += 1; feedback.flash(false); void triggerErrorHaptic(); return; }
    if (progress + 1 < round.sequence.length) { setProgress(progress + 1); void triggerSelectionHaptic(); return; }
    stats.current.grids += 1;
    feedback.flash(true);
    void triggerSuccessHaptic();
    setIndex(index + 1);
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

export const miniScanModule = { ...miniScanSpec, Component: MiniScanModule };

// ---- Pattern memory --------------------------------------------------------------------------------------
export function MiniMemoryModule({ rects, runtime, color }) {
  const context = { durationMs: runtime.durationMs };
  const rounds = useMemo(() => buildContent(miniMemorySpec, runtime.seed, context), [runtime.seed, runtime.durationMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [phase, setPhase] = useState("idle");
  const [lit, setLit] = useState([]);
  const [picked, setPicked] = useState([]);
  const [missed, setMissed] = useState([]);
  const state = useRef({ next: 0, round: null });
  const stats = useRef(emptyStats(miniMemorySpec));
  const blink = useSharedValue(0);
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";

  useEffect(() => runtime.register(() => moduleResult(miniMemorySpec, stats.current, context)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function finish(score) {
    const current = state.current;
    stats.current.scores.push(score);
    stats.current.size = score === 1 ? Math.min(MEMORY_MAX_SIZE, stats.current.size + 1) : Math.max(MEMORY_MIN_SIZE, stats.current.size - 1);
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
        const targets = rounds[current.next].order.slice(0, stats.current.size);
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

export const miniMemoryModule = { ...miniMemorySpec, Component: MiniMemoryModule };

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
