import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

import { AngleFigure } from "../../../games/estimation/AngleFigure";
import { SPACE_CADET } from "../../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../../utils/haptics";
import { BlockKicker, ERROR, ModuleBlock, SUCCESS, tint, useFeedbackFlash } from "../../kit";
import { buildContent, emptyStats, estimationSpec, judge, moduleResult, RESULT_MS, WINDOW_MS } from "./logic";

const TICK_MS = 50;
const VALUE_WIDTH = 96;
const KNOB = 26;
const KNOB_RETURN = { stiffness: 420, damping: 26, mass: 1 };
// A "compare" answer is registered once the slider is pushed past this share of its travel.
const COMPARE_THRESHOLD = 0.28;
const DEAD_ZONE = 0.06;
// Speed in steps per second: a light push always creeps (~2.5 steps/s, for single-unit corrections), and the curve
// is cubic so the top speed only comes near the end of the travel. The top speed depends on the kind of answer
// (a dot count needs far fewer steps than a product), so that a full push crosses a typical range in ~1.5 s.
const CREEP_RATE = 2.5;
const TYPICAL_STEPS = { points: 24, angle: 90, divide: 40, percent: 50, increase: 20, missing: 50, sum: 140, multiply: 300 };

const format = (value) => Math.round(value).toLocaleString("en-US");

function Dots({ points }) {
  return <View style={styles.dotBoard}>{points.map((point, index) => <View key={index} style={[styles.dot, { left: `${point.x}%`, top: `${point.y}%`, backgroundColor: point.blue ? SPACE_CADET.spatial : SPACE_CADET.white }]} />)}</View>;
}

// Spring-loaded like the Full Clearance slider: the further it is pushed, the faster the value runs; it springs
// back to the middle on release. For "compare" it just picks a side.
function RateSlider({ width, color, deflection, held, enabled, onTouch }) {
  const half = (width - KNOB) / 2;
  const gesture = useMemo(() => Gesture.Pan().enabled(enabled).minDistance(0)
    .onBegin(() => { held.value = 1; runOnJS(onTouch)(); })
    .onUpdate((event) => { deflection.value = Math.max(-1, Math.min(1, event.translationX / half)); })
    // Once released, the knob's spring (and its small overshoot) is only visual: the value stops at once.
    .onFinalize(() => { held.value = 0; deflection.value = withSpring(0, KNOB_RETURN); }), [enabled, half]); // eslint-disable-line react-hooks/exhaustive-deps
  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: deflection.value * half }] }));
  const fillStyle = useAnimatedStyle(() => ({ left: KNOB / 2 + half + Math.min(0, deflection.value) * half, width: Math.abs(deflection.value) * half }));
  return <GestureDetector gesture={gesture}>
    <View style={styles.slider}>
      <View style={[styles.track, { left: KNOB / 2, right: KNOB / 2 }]} />
      <Animated.View style={[styles.fill, { backgroundColor: color }, fillStyle]} />
      <View style={[styles.centerTick, { left: width / 2 - 0.5 }]} />
      <Text style={[styles.sliderHint, { left: 0 }]}>−</Text>
      <Text style={[styles.sliderHint, { right: 0 }]}>+</Text>
      <Animated.View style={[styles.knob, { left: half, borderColor: enabled ? color : SPACE_CADET.borderDefault, backgroundColor: enabled ? color : SPACE_CADET.black }, knobStyle]} />
    </View>
  </GestureDetector>;
}

export function EstimationModule({ rects, runtime, color }) {
  const context = { durationMs: runtime.durationMs };
  const problems = useMemo(() => buildContent(estimationSpec, runtime.seed, context), [runtime.seed, runtime.durationMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [current, setCurrent] = useState(null);
  const [value, setValue] = useState(null);
  const [result, setResult] = useState(null);
  const deflection = useSharedValue(0);
  const held = useSharedValue(0);
  const countdown = useSharedValue(0);
  // `raw` keeps the unrounded value, so slow pushes add up instead of being rounded away every tick.
  const state = useRef({ next: 0, problem: null, value: null, raw: 0, resultUntil: 0 });
  const stats = useRef({ ...emptyStats(estimationSpec), planned: problems.length });
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";

  useEffect(() => runtime.register(() => moduleResult(estimationSpec, stats.current, context)), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Nothing counts until the slider is touched: only then does the answer appear (starting from 0).
  function touch() {
    const live = state.current;
    if (!live.problem || live.value !== null) return;
    live.value = 0;
    live.raw = 0;
    setValue(0);
    void triggerSelectionHaptic();
  }

  // Locks automatically when the bar runs out, whatever the slider shows.
  function lock() {
    const live = state.current;
    const problem = live.problem;
    const answer = live.value;
    const { correct, precision, range } = judge(problem, answer);
    stats.current.scores.push({ correct, precision });
    live.problem = null;
    live.resultUntil = runtime.elapsed() + RESULT_MS;
    cancelAnimation(deflection);
    deflection.value = withSpring(0, KNOB_RETURN);
    setResult({ answer, correct, range });
    feedback.flash(correct);
    void (correct ? triggerSuccessHaptic() : triggerErrorHaptic());
  }

  useEffect(() => {
    if (!running) return undefined;
    const live = state.current;
    const timer = setInterval(() => {
      const now = runtime.elapsed();
      const problem = live.problem;
      if (problem && live.value !== null) {
        const push = held.value ? deflection.value : 0;
        if (problem.type === "compare") {
          if (Math.abs(push) > COMPARE_THRESHOLD && live.value !== Math.sign(push)) { live.value = Math.sign(push); setValue(live.value); void triggerSelectionHaptic(); }
        } else if (Math.abs(push) >= DEAD_ZONE) {
          const strength = (Math.abs(push) - DEAD_ZONE) / (1 - DEAD_ZONE);
          const topRate = Math.max(CREEP_RATE * 4, TYPICAL_STEPS[problem.type] / 1.5);
          const stepsPerSecond = CREEP_RATE + (topRate - CREEP_RATE) * strength ** 3;
          live.raw = Math.max(0, Math.min(99999, live.raw + Math.sign(push) * problem.step * stepsPerSecond * (TICK_MS / 1000)));
          const rounded = Math.round(live.raw / problem.step) * problem.step;
          if (rounded !== live.value) { live.value = rounded; setValue(rounded); }
        }
      }
      if (problem && now - problem.shownAt > WINDOW_MS) lock();
      if (live.resultUntil && now > live.resultUntil) { live.resultUntil = 0; setResult(null); setCurrent(null); setValue(null); }
      if (live.problem || live.resultUntil || live.next >= problems.length || problems[live.next].at > now) return;
      const next = { ...problems[live.next], shownAt: now };
      live.next += 1;
      live.problem = next;
      live.value = null;
      countdown.value = 1;
      countdown.value = withTiming(0, { duration: WINDOW_MS, easing: Easing.linear });
      setCurrent(next);
      setValue(null);
      void triggerSelectionHaptic();
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  // The countdown bar follows the mission clock: it freezes during a pause and resumes where it stopped.
  useEffect(() => {
    const live = state.current;
    if (!live.problem) return;
    if (!running) { cancelAnimation(countdown); return; }
    const left = Math.max(0, WINDOW_MS - (runtime.elapsed() - live.problem.shownAt));
    countdown.value = withTiming(0, { duration: left, easing: Easing.linear });
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  const barStyle = useAnimatedStyle(() => ({ width: `${countdown.value * 100}%` }));
  const active = running && current !== null && result === null;
  const card = rects.card;
  const controls = rects.slider;
  const verdictColor = result ? (result.correct ? SUCCESS : ERROR) : color;
  const compare = current?.type === "compare";
  const shownValue = value === null ? "—" : compare ? (value < 0 ? "◀ LEFT" : value > 0 ? "RIGHT ▶" : "—") : format(value);

  let body = <Text style={styles.idle}>STAND BY</Text>;
  if (current) {
    if (current.type === "points") body = <><Dots points={current.points} /><Text style={styles.question}>{current.prompt}</Text></>;
    else if (current.type === "angle") body = <><AngleFigure angle={current.angle} rotation={current.rotation} size={Math.min(card.width - 40, card.height - 90)} stroke={3} /><Text style={styles.question}>{current.prompt}</Text></>;
    else if (compare) body = <><Text style={styles.question}>{current.prompt}</Text><View style={styles.compareRow}>
      {current.compareLabels.map((label, index) => {
        const side = index === 0 ? -1 : 1;
        const chosen = value === side;
        const truth = result && current.target === side;
        return <Text key={label} style={[styles.compareLabel, chosen && { color }, truth && { color: SUCCESS }]} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>;
      })}
    </View></>;
    else body = <Text style={styles.prompt} numberOfLines={2} adjustsFontSizeToFit>{current.prompt}</Text>;
  }

  return <>
    <ModuleBlock rect={card} color={color} flash={feedback.style}>
      <View style={styles.header}><BlockKicker color={color}>ESTIMATE</BlockKicker><Text style={styles.title}>{current ? current.title : ""}</Text></View>
      {/* The correction gets its own line under the header, so it never covers the exercise. */}
      {result && !compare ? <Text style={[styles.truth, { color: verdictColor }]}>{format(current.target)} · OK {format(result.range.lower)}–{format(result.range.upper)}</Text> : null}
      <View style={styles.body}>{body}</View>
      <Animated.View style={[styles.countdown, { backgroundColor: color }, barStyle]} />
    </ModuleBlock>
    <ModuleBlock rect={controls} color={color} style={styles.controls}>
      <RateSlider width={controls.width - 2 - 16 - 10 - 12 - VALUE_WIDTH} color={color} deflection={deflection} held={held} enabled={active} onTouch={touch} />
      <View style={[styles.valueBox, { borderColor: result ? verdictColor : value !== null ? tint(color, 0.6) : SPACE_CADET.borderSubtle }]}>
        <Text style={[styles.value, { color: result ? verdictColor : value === null ? SPACE_CADET.textTertiary : SPACE_CADET.white }, compare && styles.valueWord]} numberOfLines={1} adjustsFontSizeToFit>{shownValue}</Text>
      </View>
    </ModuleBlock>
  </>;
}

export const estimationModule = { ...estimationSpec, Component: EstimationModule };

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 12 },
  title: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 8, letterSpacing: 1.2 },
  body: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, paddingBottom: 8, gap: 6 },
  idle: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.6 },
  prompt: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 22, textAlign: "center" },
  question: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 11, textAlign: "center" },
  compareRow: { alignSelf: "stretch", flexDirection: "row", justifyContent: "space-between", gap: 10, marginTop: 6 },
  compareLabel: { flex: 1, color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 17, textAlign: "center" },
  dotBoard: { alignSelf: "stretch", flex: 1, marginHorizontal: 4 },
  dot: { position: "absolute", width: 5, height: 5, borderRadius: 3, marginLeft: -2.5, marginTop: -2.5 },
  truth: { paddingHorizontal: 14, marginTop: 6, textAlign: "center", fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 0.8 },
  countdown: { position: "absolute", left: 0, bottom: 0, height: 2, opacity: 0.8 },
  controls: { flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 10, gap: 12 },
  slider: { flex: 1, alignSelf: "stretch", justifyContent: "center" },
  track: { position: "absolute", top: "50%", height: 1.5, marginTop: -0.75, backgroundColor: SPACE_CADET.borderDefault },
  fill: { position: "absolute", top: "50%", height: 2, marginTop: -1 },
  centerTick: { position: "absolute", top: "50%", width: 1, height: 12, marginTop: -6, backgroundColor: SPACE_CADET.borderDefault },
  sliderHint: { position: "absolute", top: 6, color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 11 },
  knob: { position: "absolute", top: "50%", marginTop: -KNOB / 2, width: KNOB, height: KNOB, borderRadius: KNOB / 2, borderWidth: 1.5 },
  valueBox: { width: VALUE_WIDTH, alignSelf: "stretch", marginVertical: 10, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  value: { fontFamily: "Garet-Book", fontSize: 22 },
  valueWord: { fontFamily: "Gontserrat-SemiBold", fontSize: 11, letterSpacing: 1 },
});
