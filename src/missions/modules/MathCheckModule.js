import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { createRandom, randomTools } from "../../utils/random";
import { BlockKicker, ModuleBlock, tint, useFeedbackFlash } from "../kit";

const ANSWER_WINDOW_MS = 10000;

// Half the equations are right; wrong ones are off by a plausible slip (±1, ±2 or ±10), never absurd.
function buildEquations(seed) {
  const rnd = randomTools(createRandom(seed));
  return Array.from({ length: 200 }, () => {
    const operator = rnd.item(["+", "+", "−", "×"]);
    let a; let b; let result;
    if (operator === "+") { a = rnd.int(12, 89); b = rnd.int(5, 49); result = a + b; }
    else if (operator === "−") { a = rnd.int(24, 99); b = rnd.int(5, a - 8); result = a - b; }
    else { a = rnd.int(3, 12); b = rnd.int(3, 9); result = a * b; }
    const correct = rnd.chance(0.5);
    const shown = correct ? result : result + rnd.item([-10, -2, -1, 1, 2, 10].filter((offset) => result + offset > 0));
    return { expression: `${a} ${operator} ${b}`, result: `= ${shown}`, correct };
  });
}

// One tap target: tap the block when the calculation is right. A calculation left alone for 10 s counts as
// judged wrong, and the next one appears. Scoring rewards catching right ones without tapping wrong ones.
export function MathCheckModule({ rects, runtime, color }) {
  const equations = useMemo(() => buildEquations(runtime.seed), [runtime.seed]);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const shownAt = useRef(null);
  const tally = useRef({ hits: 0, misses: 0, falseAlarms: 0, rejections: 0 });
  const countdown = useSharedValue(1);
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";
  const block = rects.display;
  const fontSize = Math.min(30, Math.floor(block.width / 5.6));
  const equation = equations[index % equations.length];

  useEffect(() => runtime.register(() => {
    const { hits, misses, falseAlarms, rejections } = tally.current;
    const hitRate = hits + misses ? hits / (hits + misses) : 0;
    const falseRate = falseAlarms + rejections ? falseAlarms / (falseAlarms + rejections) : 0;
    return { performance: hitRate * (1 - falseRate), detail: `${hits}/${hits + misses} right ones caught${falseAlarms ? ` · ${falseAlarms} wrong taps` : ""}` };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  function show(nextIndex) {
    indexRef.current = nextIndex;
    setIndex(nextIndex);
    shownAt.current = runtime.elapsed();
    countdown.value = 1;
    countdown.value = withTiming(0, { duration: ANSWER_WINDOW_MS, easing: Easing.linear });
  }

  // On a pause the countdown freezes; on resume it carries on from where it stopped.
  useEffect(() => {
    if (!running) { cancelAnimation(countdown); return undefined; }
    if (shownAt.current === null) show(indexRef.current);
    else countdown.value = withTiming(0, { duration: Math.max(0, ANSWER_WINDOW_MS - (runtime.elapsed() - shownAt.current)), easing: Easing.linear });
    const timer = setInterval(() => {
      if (runtime.elapsed() - shownAt.current < ANSWER_WINDOW_MS) return;
      if (equations[indexRef.current % equations.length].correct) tally.current.misses += 1;
      else tally.current.rejections += 1;
      show(indexRef.current + 1);
    }, 100);
    return () => clearInterval(timer);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  function tap() {
    if (!running) return;
    const right = equations[indexRef.current % equations.length].correct;
    if (right) tally.current.hits += 1;
    else tally.current.falseAlarms += 1;
    feedback.flash(right);
    void (right ? triggerSuccessHaptic() : triggerErrorHaptic());
    show(indexRef.current + 1);
  }

  const barStyle = useAnimatedStyle(() => ({ width: `${countdown.value * 100}%` }));

  return <ModuleBlock rect={block} color={color} flash={feedback.style}>
    <Pressable disabled={!running} onPress={tap} style={({ pressed }) => [styles.surface, pressed && { backgroundColor: tint(color, 0.12) }]}>
      <BlockKicker color={color} style={styles.kicker}>CHECK</BlockKicker>
      <View style={styles.equation}>
        <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.expression, { fontSize }, !running && styles.idle]}>{equation.expression}</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.result, { fontSize: fontSize * 0.86 }, !running && styles.idle]}>{equation.result}</Text>
      </View>
      <View style={styles.track}><Animated.View style={[styles.bar, { backgroundColor: color }, barStyle]} /></View>
    </Pressable>
  </ModuleBlock>;
}

export const mathCheckModule = {
  id: "math-check",
  title: "Calculation check",
  competence: "mentalMath",
  secondary: [],
  task: "opportunistic",
  voice: false,
  load: 1,
  rule: "Tap the calculation when it is right. Leave the wrong ones alone: after 10 seconds, the next calculation appears. Tapping a wrong one counts as an error.",
  recap: "catch the right calculations",
  blocks: [{ key: "display", role: "display", h: 2, w: 2 }],
  Component: MathCheckModule,
};

const styles = StyleSheet.create({
  surface: { flex: 1 },
  kicker: { position: "absolute", top: 12, left: 14 },
  equation: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, paddingTop: 12 },
  expression: { color: SPACE_CADET.white, fontFamily: "Garet-Book" },
  result: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", marginTop: 2 },
  idle: { color: SPACE_CADET.textTertiary },
  track: { height: 2, marginHorizontal: 14, marginBottom: 14, borderRadius: 1, backgroundColor: SPACE_CADET.borderSubtle, overflow: "hidden" },
  bar: { height: 2, borderRadius: 1 },
});
