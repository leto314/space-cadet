import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { createRandom, randomTools } from "../../utils/random";
import { BlockKicker, ModuleBlock, SUCCESS, tint, useFeedbackFlash } from "../kit";

const SWITCHES = ["A", "B", "C"];
const NEXT_PANEL_MS = 1500;
const SECONDS_PER_PANEL_TARGET = 22;

// Small boolean expressions over three switches, written the way they read.
const EXPRESSIONS = [];
[[0, 1], [0, 2], [1, 2]].forEach(([a, b]) => {
  const [x, y] = [SWITCHES[a], SWITCHES[b]];
  EXPRESSIONS.push(
    { text: `${x} AND ${y}`, test: (s) => s[a] && s[b] },
    { text: `${x} OR ${y}`, test: (s) => s[a] || s[b] },
    { text: `${x} XOR ${y}`, test: (s) => s[a] !== s[b] },
    { text: `${x} AND NOT ${y}`, test: (s) => s[a] && !s[b] },
    { text: `NOT ${x} AND ${y}`, test: (s) => !s[a] && s[b] },
  );
});
SWITCHES.forEach((name, index) => EXPRESSIONS.push({ text: `NOT ${name}`, test: (s) => !s[index] }));

const ALL_STATES = Array.from({ length: 8 }, (_, mask) => [0, 1, 2].map((index) => Boolean((mask >> index) & 1)));
const outputs = (panel, switches) => panel.map((expression) => Boolean(expression.test(switches)));
const same = (a, b) => a.every((value, index) => value === b[index]);

// A panel is three bulbs with a target each; exactly one switch setting lights them all correctly, and it is never
// the setting the switches are already in.
function buildPanel(rnd, current) {
  for (;;) {
    const panel = rnd.shuffle(EXPRESSIONS).slice(0, 3);
    const solution = rnd.item(ALL_STATES);
    const target = outputs(panel, solution);
    if (ALL_STATES.filter((state) => same(outputs(panel, state), target)).length !== 1) continue;
    if (same(outputs(panel, current), target)) continue;
    return { panel, target };
  }
}

export function LogicGatesModule({ rects, runtime, color }) {
  const rnd = useMemo(() => randomTools(createRandom(runtime.seed)), [runtime.seed]);
  const [switches, setSwitches] = useState([false, false, false]);
  const [puzzle, setPuzzle] = useState(() => buildPanel(rnd, [false, false, false]));
  const [solved, setSolved] = useState(false);
  const stats = useRef({ solved: 0, flips: 0 });
  const timeouts = useRef([]);
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";
  const lit = outputs(puzzle.panel, switches);

  useEffect(() => () => timeouts.current.forEach(clearTimeout), []);
  useEffect(() => runtime.register(() => {
    const target = runtime.durationMs / 1000 / SECONDS_PER_PANEL_TARGET;
    return { performance: Math.min(1, stats.current.solved / target), detail: `${stats.current.solved} panels solved · ${stats.current.flips} flips` };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  function flip(index) {
    if (!running || solved) return;
    void triggerSelectionHaptic();
    const next = switches.map((value, position) => (position === index ? !value : value));
    stats.current.flips += 1;
    setSwitches(next);
    if (same(outputs(puzzle.panel, next), puzzle.target)) {
      stats.current.solved += 1;
      setSolved(true);
      feedback.flash(true);
      void triggerSuccessHaptic();
      timeouts.current.push(setTimeout(() => { setPuzzle(buildPanel(rnd, next)); setSolved(false); }, NEXT_PANEL_MS));
    }
  }

  return <>
    <ModuleBlock rect={rects.bulbs} color={color} flash={feedback.style} style={styles.bulbBlock}>
      {puzzle.panel.map((expression, index) => {
        const on = lit[index];
        const wanted = puzzle.target[index];
        return <View key={`${expression.text}-${index}`} style={styles.bulbCell}>
          <View style={styles.bulbRow}>
            <View style={[styles.bulb, on && { backgroundColor: tint(color, 0.3), borderColor: color, shadowColor: color, shadowOpacity: 0.6 }]} />
            <Text style={[styles.target, { color: solved ? SUCCESS : wanted ? color : SPACE_CADET.textTertiary }]}>{wanted ? "ON" : "OFF"}</Text>
          </View>
          <Text numberOfLines={1} adjustsFontSizeToFit style={styles.expression}>{expression.text}</Text>
        </View>;
      })}
    </ModuleBlock>
    <ModuleBlock rect={rects.switches} color={color} style={styles.switchBlock}>
      {SWITCHES.map((name, index) => <Pressable key={name} disabled={!running} onPress={() => flip(index)} style={styles.switchCell}>
        <BlockKicker color={SPACE_CADET.textSecondary}>{name}</BlockKicker>
        <View style={[styles.track, switches[index] && { borderColor: color, backgroundColor: tint(color, 0.18) }]}>
          <View style={[styles.knob, switches[index] ? { backgroundColor: color, alignSelf: "flex-end" } : null]} />
        </View>
      </Pressable>)}
    </ModuleBlock>
  </>;
}

export const logicGatesModule = {
  id: "logic-gates",
  title: "Logic panel",
  competence: "logic",
  secondary: [],
  task: "opportunistic",
  voice: false,
  load: 2,
  rule: "Each bulb follows its formula of the switches A, B and C. Set the switches so every bulb matches its ON or OFF target. A new panel arrives as soon as one is solved.",
  recap: "solve the logic panels",
  blocks: [{ key: "bulbs", role: "display", h: 1, w: 4, refresh: "slow" }, { key: "switches", role: "control", h: 2, w: 1 }],
  Component: LogicGatesModule,
};

const styles = StyleSheet.create({
  bulbBlock: { flexDirection: "row", paddingHorizontal: 8 },
  bulbCell: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 4 },
  bulbRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  bulb: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, backgroundColor: SPACE_CADET.black, shadowRadius: 10, shadowOpacity: 0, shadowOffset: { width: 0, height: 0 } },
  target: { fontFamily: "Gontserrat-SemiBold", fontSize: 8, letterSpacing: 1.2 },
  expression: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 11, marginTop: 7 },
  switchBlock: { paddingVertical: 8 },
  switchCell: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  track: { width: 30, height: 18, borderRadius: 9, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, padding: 2, justifyContent: "center" },
  knob: { width: 12, height: 12, borderRadius: 6, backgroundColor: SPACE_CADET.textTertiary },
});
