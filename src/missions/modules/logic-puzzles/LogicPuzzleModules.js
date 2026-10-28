import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { SPACE_CADET } from "../../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../../utils/haptics";
import { BlockKicker, ModuleBlock, tint, useFeedbackFlash } from "../../kit";
import { applyAction, buildContent, emptyStats, miniLandingSpec, miniLandingSplitSpec, miniSwitchboardSpec, moduleResult, switchLabel } from "./logic";

// ---- Switch panel ----------------------------------------------------------------------------------------
function Lights({ mask, count, size, color, dim = false }) {
  return <View style={styles.lights}>
    {Array.from({ length: count }, (_, index) => {
      const on = ((mask >> index) & 1) === 1;
      return <View key={index} style={[styles.light, { width: size, height: size, borderRadius: size / 2 }, on && { backgroundColor: dim ? tint(color, 0.35) : color, borderColor: color, shadowColor: color, shadowOpacity: dim ? 0 : 0.6 }]} />;
    })}
  </View>;
}

export function MiniSwitchboardModule({ rects, runtime, color }) {
  const context = { durationMs: runtime.durationMs };
  const panels = useMemo(() => buildContent(miniSwitchboardSpec, runtime.seed, context), [runtime.seed, runtime.durationMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [index, setIndex] = useState(0);
  const [mask, setMask] = useState(0);
  const presses = useRef(0);
  const stats = useRef(emptyStats(miniSwitchboardSpec));
  const panel = panels[Math.min(index, panels.length - 1)];
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";

  useEffect(() => runtime.register(() => moduleResult(miniSwitchboardSpec, stats.current, context)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function press(action) {
    if (!running) return;
    const next = applyAction(mask, action, panel.lightCount);
    presses.current += 1;
    if (next !== panel.target) { setMask(next); void triggerSelectionHaptic(); return; }
    stats.current.panels += 1;
    stats.current.extra += Math.max(0, presses.current - panel.optimal);
    presses.current = 0;
    feedback.flash(true);
    void triggerSuccessHaptic();
    setMask(0);
    setIndex(index + 1);
  }
  function reset() {
    if (!running || mask === 0) return;
    setMask(0);
    void triggerSelectionHaptic();
  }

  const lightsRect = rects.lights;
  const size = Math.min(34, (lightsRect.width - 40) / panel.lightCount - 10);
  return <>
    <ModuleBlock rect={lightsRect} color={color} flash={feedback.style}>
      <View style={styles.header}>
        <BlockKicker color={color}>SWITCHES</BlockKicker>
        <Pressable hitSlop={10} onPress={reset} disabled={!running}><Text style={[styles.reset, mask !== 0 && { color: SPACE_CADET.textSecondary }]}>RESET</Text></Pressable>
      </View>
      <View style={styles.panelBody}>
        <Text style={styles.rowLabel}>TARGET</Text>
        <Lights mask={panel.target} count={panel.lightCount} size={size * 0.55} color={color} dim />
        <Lights mask={mask} count={panel.lightCount} size={size} color={color} />
        <View style={styles.numbers}>{Array.from({ length: panel.lightCount }, (_, index) => <Text key={index} style={[styles.number, { width: size }]}>{index + 1}</Text>)}</View>
      </View>
    </ModuleBlock>
    <ModuleBlock rect={rects.switches} color={color} style={styles.switchBlock}>
      {panel.switches.map((action, index) => <Pressable key={`${panel.target}-${index}`} disabled={!running} onPress={() => press(action)} style={({ pressed }) => [styles.switchKey, pressed && { backgroundColor: tint(color, 0.2), borderColor: color }]}>
        <Text style={styles.switchText} numberOfLines={1} adjustsFontSizeToFit>{switchLabel(action)}</Text>
      </Pressable>)}
    </ModuleBlock>
  </>;
}

export const miniSwitchboardModule = { ...miniSwitchboardSpec, Component: MiniSwitchboardModule };

// ---- Landing order ---------------------------------------------------------------------------------------
const LANDING_PAUSE_MS = 1300;

function Sentence({ template, actors, names, color, small = false }) {
  return <Text style={[styles.clue, small && styles.clueSmall]}>{template.split(/(\{[ABC]\})/).map((part, index) => {
    const slot = part.match(/^\{([ABC])\}$/)?.[1];
    return slot ? <Text key={index} style={[styles.clueName, { color }]}>{names[actors[slot]]}</Text> : <Text key={index}>{part}</Text>;
  })}</Text>;
}

// Two layouts: "wide" is one full-width block with the answers stacked on the right; "split" puts the clues in a
// square block and the answers on a strip.
export function MiniLandingModule({ rects, runtime, color, spec = miniLandingSpec }) {
  const { layout } = spec.options;
  const context = { durationMs: runtime.durationMs };
  const scenarios = useMemo(() => buildContent(spec, runtime.seed, context), [runtime.seed, runtime.durationMs, spec]); // eslint-disable-line react-hooks/exhaustive-deps
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState(null);
  const stats = useRef(emptyStats(spec));
  const scenario = scenarios[Math.min(index, scenarios.length - 1)];
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";

  useEffect(() => runtime.register(() => moduleResult(spec, stats.current, context)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function answer(value) {
    if (!running || picked !== null) return;
    const correct = value === scenario.answer;
    stats.current[correct ? "right" : "wrong"] += 1;
    setPicked(value);
    feedback.flash(correct);
    void (correct ? triggerSuccessHaptic() : triggerErrorHaptic());
    setTimeout(() => { setPicked(null); setIndex(index + 1); }, LANDING_PAUSE_MS);
  }

  const { question } = scenario;
  const wide = layout === "wide";
  const clues = <>
    <BlockKicker color={color}>LANDING ORDER</BlockKicker>
    <View style={[styles.clueList, !wide && styles.clueListSplit]}>
      {scenario.clues.map((clue) => <Sentence key={clue.key} template={clue.template} actors={clue.actors} names={scenario.names} color={SPACE_CADET.white} small={!wide} />)}
    </View>
    <Sentence template={question.template} actors={question.actors} names={scenario.names} color={color} small={!wide} />
  </>;
  const answers = question.options.map((option) => {
    const state = picked === null ? null : option.value === scenario.answer ? "right" : option.value === picked ? "wrong" : null;
    return <Pressable key={option.value} disabled={!running || picked !== null} onPress={() => answer(option.value)} style={({ pressed }) => [styles.answerKey, pressed && { backgroundColor: tint(color, 0.2) }, state === "right" && styles.answerRight, state === "wrong" && styles.answerWrong]}>
      <Text style={styles.answerText} numberOfLines={1} adjustsFontSizeToFit>{option.label}</Text>
    </Pressable>;
  });
  if (wide) return <ModuleBlock rect={rects.board} color={color} flash={feedback.style} style={styles.wideBlock}>
    <View style={styles.wideClues}>{clues}</View>
    <View style={styles.wideAnswers}>{answers}</View>
  </ModuleBlock>;
  return <>
    <ModuleBlock rect={rects.clues} color={color} flash={feedback.style} style={styles.clueBlock}>{clues}</ModuleBlock>
    <ModuleBlock rect={rects.answers} color={color} style={styles.answerBlock}>{answers}</ModuleBlock>
  </>;
}

export const miniLandingModule = { ...miniLandingSpec, Component: MiniLandingModule };
export const miniLandingSplitModule = { ...miniLandingSplitSpec, Component: (props) => <MiniLandingModule {...props} spec={miniLandingSplitSpec} /> };

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 12 },
  reset: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.2 },
  panelBody: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingBottom: 6 },
  rowLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 8, letterSpacing: 1.4 },
  lights: { flexDirection: "row", gap: 10 },
  light: { borderWidth: 1, borderColor: SPACE_CADET.borderDefault, backgroundColor: SPACE_CADET.black, shadowOffset: { width: 0, height: 0 }, shadowRadius: 8, shadowOpacity: 0 },
  numbers: { flexDirection: "row", gap: 10, marginTop: -4 },
  number: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, textAlign: "center" },
  switchBlock: { padding: 10, gap: 8 },
  switchKey: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: SPACE_CADET.borderSubtle, backgroundColor: SPACE_CADET.black, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  switchText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1 },
  clueBlock: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, justifyContent: "space-between" },
  clueList: { gap: 3 },
  clueListSplit: { gap: 4 },
  clueSmall: { fontSize: 11, lineHeight: 14 },
  wideBlock: { flexDirection: "row", padding: 8, gap: 8 },
  wideClues: { flex: 1, paddingHorizontal: 8, paddingVertical: 4, justifyContent: "space-between" },
  wideAnswers: { width: 108, gap: 8 },
  clue: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 12, lineHeight: 16 },
  clueName: { fontFamily: "Gontserrat-SemiBold" },
  answerBlock: { flexDirection: "row", padding: 8, gap: 8 },
  answerKey: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: SPACE_CADET.borderSubtle, backgroundColor: SPACE_CADET.black, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  answerRight: { borderColor: "#34D399", backgroundColor: "rgba(52,211,153,0.16)" },
  answerWrong: { borderColor: SPACE_CADET.attention, backgroundColor: "rgba(216,30,91,0.16)" },
  answerText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-SemiBold", fontSize: 12 },
});
