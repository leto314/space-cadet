import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { SPACE_CADET } from "../../../theme/spaceCadet";
import { triggerSelectionHaptic, triggerSuccessHaptic } from "../../../utils/haptics";
import { BlockKicker, ModuleBlock, SUCCESS, tint, useFeedbackFlash } from "../../kit";
import { buildContent, emptyStats, logicGatesSpec, moduleResult, NEXT_PANEL_MS, outputs, same, SWITCHES } from "./logic";

export function LogicGatesModule({ rects, runtime, color }) {
  const context = { durationMs: runtime.durationMs };
  const panels = useMemo(() => buildContent(logicGatesSpec, runtime.seed, context), [runtime.seed, runtime.durationMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [switches, setSwitches] = useState([false, false, false]);
  const [index, setIndex] = useState(0);
  const [solved, setSolved] = useState(false);
  const stats = useRef(emptyStats(logicGatesSpec));
  const puzzle = panels[Math.min(index, panels.length - 1)];
  const timeouts = useRef([]);
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";
  const lit = outputs(puzzle.panel, switches);

  useEffect(() => () => timeouts.current.forEach(clearTimeout), []);
  useEffect(() => runtime.register(() => moduleResult(logicGatesSpec, stats.current, context)), []); // eslint-disable-line react-hooks/exhaustive-deps

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
      timeouts.current.push(setTimeout(() => { setIndex((current) => current + 1); setSolved(false); }, NEXT_PANEL_MS));
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

export const logicGatesModule = { ...logicGatesSpec, Component: LogicGatesModule };

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
