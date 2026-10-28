import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import Svg, { Circle, Path, Polygon, Polyline } from "react-native-svg";

import { NetView } from "../../../games/cube-nets/CubeNetsGame";
import { GLYPHS } from "../../../games/cube-nets/logic";
import { SPACE_CADET } from "../../../theme/spaceCadet";
import { triggerErrorHaptic, triggerImpactHaptic, triggerSuccessHaptic } from "../../../utils/haptics";
import { BlockKicker, LED_IDLE, ModuleBlock, tint, useFeedbackFlash } from "../../kit";
import { BLANK_MS, buildContent, CANDIDATE_MS, emptyStats, INNER_SCALE, matchCount, moduleResult, oppositeFaceSpec, REFERENCE_MS, rotate, rotationMatchSpec } from "./logic";

// ---- Rotation match --------------------------------------------------------------------------------------
function FigureArt({ figure, angle, size, color }) {
  const center = size / 2;
  const radius = size * 0.44;
  const place = (point, scale = 1) => { const [x, y] = rotate([point[0] * scale, point[1] * scale], angle); return [center + x * radius, center + y * radius]; };
  const inner = INNER_SCALE[figure.outline];
  const corners = figure.outline === "square" ? [[-0.72, -0.72], [0.72, -0.72], [0.72, 0.72], [-0.72, 0.72]] : [[0, -1], [0.866, 0.5], [-0.866, 0.5]];
  const text = (points) => points.map((point) => point.map((value) => value.toFixed(1)).join(",")).join(" ");
  const [dotX, dotY] = place(figure.dot, inner);
  return <Svg width={size} height={size}>
    {figure.outline === "circle" ? <Circle cx={center} cy={center} r={radius * 0.98} stroke={SPACE_CADET.textTertiary} strokeWidth={1.2} fill="none" /> : <Polygon points={text(corners.map((corner) => place(corner)))} stroke={SPACE_CADET.textTertiary} strokeWidth={1.2} strokeLinejoin="round" fill="none" />}
    <Polyline points={text(figure.line.map((point) => place(point, inner)))} stroke={SPACE_CADET.white} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <Circle cx={dotX} cy={dotY} r={3.6} fill={color} />
  </Svg>;
}

export function RotationMatchModule({ rects, runtime, color }) {
  const context = { durationMs: runtime.durationMs };
  const rounds = useMemo(() => buildContent(rotationMatchSpec, runtime.seed, context), [runtime.seed, runtime.durationMs]); // eslint-disable-line react-hooks/exhaustive-deps
  // shown: null | { kind: "reference" | "candidate", figure, angle, verdict }
  const [shown, setShown] = useState(null);
  const state = useRef({ next: 0, round: null, stage: -2, answered: false });
  const stats = useRef({ ...emptyStats(rotationMatchSpec), matches: matchCount(rounds) });
  const bar = useSharedValue(0);
  const blink = useSharedValue(0);
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";

  useEffect(() => runtime.register(() => moduleResult(rotationMatchSpec, stats.current, context)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function judge(candidate, tapped) {
    const correct = tapped === candidate.match;
    stats.current.total += 1;
    if (tapped && candidate.match) stats.current.caught += 1;
    if (tapped && !candidate.match) stats.current.falseTaps += 1;
    // Correctly ignoring a different figure stays silent; everything else gets feedback.
    if (tapped || !correct) { feedback.flash(correct); void (correct ? triggerSuccessHaptic() : triggerErrorHaptic()); }
    return correct;
  }

  useEffect(() => {
    if (!running) return undefined;
    const live = state.current;
    const timer = setInterval(() => {
      const now = runtime.elapsed();
      if (!live.round) {
        if (live.next >= rounds.length || rounds[live.next].at > now) return;
        live.round = { ...rounds[live.next], at: now };
        live.next += 1;
        live.stage = -2;
      }
      const round = live.round;
      const time = now - round.at;
      // Stage -1 is the reference; stage k ≥ 0 is candidate k, followed by a short blank.
      const stage = time < REFERENCE_MS ? -1 : Math.floor((time - REFERENCE_MS) / (CANDIDATE_MS + BLANK_MS));
      const into = stage < 0 ? time : time - REFERENCE_MS - stage * (CANDIDATE_MS + BLANK_MS);
      const blank = stage >= 0 && into >= CANDIDATE_MS;
      const previous = live.stage;
      const previousCandidate = previous >= 0 && previous % 1 === 0 ? round.candidates[previous] : null;
      const key = blank ? stage + 0.5 : stage;
      if (key !== previous) {
        if (previousCandidate && !live.answered) judge(previousCandidate, false);
        live.stage = key;
        live.answered = false;
        if (stage >= round.candidates.length) { live.round = null; setShown(null); bar.value = 0; return; }
        if (blank) setShown(null);
        else if (stage < 0) {
          setShown({ kind: "reference", figure: round.figure, angle: 0, verdict: null });
          blink.value = withSequence(withTiming(1, { duration: 80 }), withTiming(0, { duration: 900 }));
          void triggerImpactHaptic();
        } else setShown({ kind: "candidate", figure: round.candidates[stage].figure, angle: round.candidates[stage].angle, verdict: null });
      }
      bar.value = withTiming(blank ? 0 : 1 - into / (stage < 0 ? REFERENCE_MS : CANDIDATE_MS), { duration: 60, easing: Easing.linear });
    }, 50);
    return () => clearInterval(timer);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  function tap() {
    const live = state.current;
    if (!running || !live.round || live.stage < 0 || live.stage % 1 !== 0 || live.answered) return;
    live.answered = true;
    const correct = judge(live.round.candidates[live.stage], true);
    setShown((current) => (current ? { ...current, verdict: correct } : current));
  }

  const block = rects.panel;
  const size = Math.min(block.width - 24, block.height - 52);
  const barStyle = useAnimatedStyle(() => ({ width: `${bar.value * 100}%` }));
  const ledStyle = useAnimatedStyle(() => ({ backgroundColor: blink.value > 0.05 ? color : LED_IDLE, opacity: 0.35 + blink.value * 0.65 }));
  const label = !shown ? (state.current.round ? "" : "STAND BY") : shown.kind === "reference" ? "MEMORIZE" : shown.verdict === null ? "SAME? TAP" : shown.verdict ? "RIGHT" : "WRONG";

  return <ModuleBlock rect={block} color={color} led={ledStyle} flash={feedback.style}>
    <Pressable onPress={tap} disabled={!running} style={styles.fill}>
      <View style={styles.header}><BlockKicker color={color}>MATCH</BlockKicker><Text style={styles.hint}>{label}</Text></View>
      <View style={styles.center}>{shown ? <FigureArt figure={shown.figure} angle={shown.angle} size={size} color={color} /> : null}</View>
      <Animated.View style={[styles.countdown, { backgroundColor: shown?.kind === "reference" ? SPACE_CADET.textTertiary : color }, barStyle]} />
    </Pressable>
  </ModuleBlock>;
}

export const rotationMatchModule = { ...rotationMatchSpec, Component: RotationMatchModule };

// ---- Opposite face ---------------------------------------------------------------------------------------
const OPPOSITE_PAUSE_MS = 1300;

function GlyphIcon({ glyph, turn, size }) {
  const angle = (turn * Math.PI) / 2;
  const a = Math.cos(angle); const b = Math.sin(angle);
  return <Svg width={size} height={size} viewBox="0 0 10 10"><Path d={GLYPHS[glyph]} stroke={SPACE_CADET.white} strokeWidth={0.8} strokeLinecap="round" strokeLinejoin="round" fill="none" transform={`matrix(${a} ${b} ${-b} ${a} ${5 - 5 * (a - b)} ${5 - 5 * (b + a)})`} /></Svg>;
}

export function OppositeFaceModule({ rects, runtime, color }) {
  const context = { durationMs: runtime.durationMs };
  const puzzles = useMemo(() => buildContent(oppositeFaceSpec, runtime.seed, context), [runtime.seed, runtime.durationMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState(null);
  const stats = useRef(emptyStats(oppositeFaceSpec));
  const puzzle = puzzles[Math.min(index, puzzles.length - 1)];
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";

  useEffect(() => runtime.register(() => moduleResult(oppositeFaceSpec, stats.current, context)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function answer(value) {
    if (!running || picked !== null) return;
    const correct = value === puzzle.answer;
    stats.current[correct ? "right" : "wrong"] += 1;
    setPicked(value);
    feedback.flash(correct);
    void (correct ? triggerSuccessHaptic() : triggerErrorHaptic());
    setTimeout(() => { setPicked(null); setIndex(index + 1); }, OPPOSITE_PAUSE_MS);
  }

  const block = rects.net;
  return <>
    <ModuleBlock rect={block} color={color} flash={feedback.style}>
      <View style={styles.header}><BlockKicker color={color}>OPPOSITE</BlockKicker><Text style={styles.hint}>{puzzle.kind === "turn" ? "TURN?" : "FACE?"}</Text></View>
      <View style={styles.center}><NetView net={puzzle.net} maxWidth={block.width - 24} maxHeight={block.height - 48} maxCell={34} highlight={puzzle.asked} highlightColor={color} /></View>
    </ModuleBlock>
    <ModuleBlock rect={rects.answers} color={color} style={styles.answers}>
      {puzzle.options.map((option) => {
        const verdict = picked === null ? null : option.value === puzzle.answer ? "right" : option.value === picked ? "wrong" : null;
        return <Pressable key={option.value} disabled={!running || picked !== null} onPress={() => answer(option.value)} style={({ pressed }) => [styles.answerKey, pressed && { backgroundColor: tint(color, 0.2) }, verdict === "right" && styles.answerRight, verdict === "wrong" && styles.answerWrong]}>
          <GlyphIcon glyph={option.glyph} turn={option.turn} size={26} />
        </Pressable>;
      })}
    </ModuleBlock>
  </>;
}

export const oppositeFaceModule = { ...oppositeFaceSpec, Component: OppositeFaceModule };

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 12, paddingRight: 30 },
  hint: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 6 },
  countdown: { position: "absolute", left: 0, bottom: 0, height: 2, opacity: 0.9 },
  answers: { flexDirection: "row", padding: 8, gap: 8 },
  answerKey: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: SPACE_CADET.borderSubtle, backgroundColor: SPACE_CADET.black, alignItems: "center", justifyContent: "center" },
  answerRight: { borderColor: "#34D399", backgroundColor: "rgba(52,211,153,0.16)" },
  answerWrong: { borderColor: SPACE_CADET.attention, backgroundColor: "rgba(216,30,91,0.16)" },
});
