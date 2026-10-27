import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import Svg, { Circle, Path, Polygon, Polyline } from "react-native-svg";

import { NetView } from "../../games/cube-nets/CubeNetsGame";
import { GLYPHS, oppositeAppearance, oppositeCells, randomShape } from "../../games/cube-nets/logic";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerImpactHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { createRandom, randomTools } from "../../utils/random";
import { BlockKicker, LED_IDLE, ModuleBlock, tint, useFeedbackFlash } from "../kit";

// ---- Rotation match --------------------------------------------------------------------------------------
// A figure is shown for 10 s, then up to three figures follow for 5 s each, every one turned by a random angle.
// Tap when it is the memorised figure (just turned); leave it when it is a different one.
const REFERENCE_MS = 10000;
const CANDIDATE_MS = 5000;
const BLANK_MS = 600;
const OUTLINES = ["circle", "square", "triangle"];
const INNER_SCALE = { circle: 1.15, square: 1, triangle: 0.68 };
const LATTICE = [-0.5, -0.25, 0, 0.25, 0.5].flatMap((x) => [-0.5, -0.25, 0, 0.25, 0.5].map((y) => [x, y])).filter(([x, y]) => Math.hypot(x, y) <= 0.62);

const rotate = ([x, y], degrees) => { const r = (degrees * Math.PI) / 180; return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)]; };
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.07;
const mirrored = (figure) => ({ ...figure, line: figure.line.map(([x, y]) => [-x, y]), dot: [-figure.dot[0], figure.dot[1]] });
// True when `a`, turned by some angle, lands exactly on `b` (the line may be read from either end).
function sameUpToRotation(a, b) {
  const step = a.outline === "circle" ? 1 : a.outline === "square" ? 90 : 120;
  for (let angle = 0; angle < 360; angle += step) {
    const line = a.line.map((point) => rotate(point, angle));
    const dot = rotate(a.dot, angle);
    if (!near(dot, b.dot)) continue;
    if (line.every((point, index) => near(point, b.line[index])) || line.every((point, index) => near(point, b.line[b.line.length - 1 - index]))) return true;
  }
  return false;
}
function randomFigure(rnd) {
  for (;;) {
    const points = rnd.shuffle(LATTICE).slice(0, 5);
    const line = points.slice(0, 4);
    const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(turn(line[0], line[1], line[2])) < 0.03 || Math.abs(turn(line[1], line[2], line[3])) < 0.03) continue;
    const figure = { outline: rnd.item(OUTLINES), line, dot: points[4] };
    // Its mirror image must be a genuinely different figure.
    if (!sameUpToRotation(mirrored(figure), figure)) return figure;
  }
}
// A look-alike: usually the mirror image, sometimes the same drawing with its dot or one line end moved.
function lookAlike(figure, rnd) {
  for (;;) {
    let variant;
    if (rnd.chance(0.6)) variant = mirrored(figure);
    else {
      const free = LATTICE.filter((point) => !near(point, figure.dot) && !figure.line.some((used) => near(used, point)));
      const spot = rnd.item(free);
      variant = rnd.chance(0.5) ? { ...figure, dot: spot } : { ...figure, line: [...figure.line.slice(0, 3), spot] };
    }
    if (!sameUpToRotation(variant, figure)) return variant;
  }
}
function buildRotationRounds(seed, durationMs) {
  const rnd = randomTools(createRandom(seed));
  const rounds = [];
  let at = rnd.int(3000, 5000);
  for (;;) {
    const count = rnd.int(2, 3);
    const length = REFERENCE_MS + count * (CANDIDATE_MS + BLANK_MS);
    if (at + length > durationMs - 1000) break;
    const figure = randomFigure(rnd);
    const candidates = Array.from({ length: count }, () => {
      const match = rnd.chance(0.5);
      return { match, angle: rnd.int(2, 22) * 15, figure: match ? figure : lookAlike(figure, rnd) };
    });
    rounds.push({ at, figure, candidates });
    at += length + rnd.int(5000, 9000);
  }
  return rounds;
}

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
  const rounds = useMemo(() => buildRotationRounds(runtime.seed, runtime.durationMs), [runtime.seed, runtime.durationMs]);
  // shown: null | { kind: "reference" | "candidate", figure, angle, verdict }
  const [shown, setShown] = useState(null);
  const state = useRef({ next: 0, round: null, stage: -2, answered: false });
  const stats = useRef({ right: 0, total: 0 });
  const bar = useSharedValue(0);
  const blink = useSharedValue(0);
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";

  useEffect(() => runtime.register(() => {
    const total = rounds.reduce((sum, round) => sum + round.candidates.length, 0) || 1;
    return { performance: stats.current.right / total, detail: `${stats.current.right}/${stats.current.total} figures judged right` };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  function judge(candidate, tapped) {
    const correct = tapped === candidate.match;
    stats.current.total += 1;
    if (correct) stats.current.right += 1;
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

export const rotationMatchModule = {
  id: "rotation-match",
  title: "Rotation match",
  competence: "spatial",
  secondary: ["memory"],
  task: "event",
  voice: false,
  load: 2,
  rule: "A figure appears for 10 seconds (the light blinks and the phone vibrates): memorise it. Then up to three figures follow, 5 seconds each, all turned by some angle. Tap the block if it is the memorised figure, simply turned. Do nothing if it is a different one, such as its mirror image.",
  recap: "tap when the turned figure is the same",
  blocks: [{ key: "panel", role: "display", h: 2, w: 2 }],
  Component: RotationMatchModule,
};

// ---- Opposite face ---------------------------------------------------------------------------------------
// A small cube net with one face highlighted. Two kinds of question:
// - "face": which face ends up opposite it once the cube is folded? (all characters upright, three choices)
// - "turn": the characters are turned on the net. Hold the cube with the highlighted face upright in front of
//   you, turn it around sideways: how does the opposite character look? (the right character, four orientations)
// The first puzzles are all "face"; after that the "turn" kind comes up more often than not.
const OPPOSITE_SECONDS = 15;
const OPPOSITE_PAUSE_MS = 1300;
const FACE_ONLY_PUZZLES = 3;
const TURN_SHARE = 0.6;

function buildOpposite(rnd, kind) {
  const cells = randomShape(rnd.random);
  const glyphs = rnd.shuffle(Object.keys(GLYPHS)).slice(0, 6);
  const asked = rnd.int(0, 5);
  if (kind === "turn") {
    const net = { cells, faces: glyphs.map((glyph) => ({ glyph, turn: rnd.int(0, 3) })) };
    const { cell, turn } = oppositeAppearance(net, asked);
    return { kind, net, asked, answer: turn, options: rnd.shuffle([0, 1, 2, 3]).map((value) => ({ value, glyph: glyphs[cell], turn: value })) };
  }
  const answer = oppositeCells(cells)[asked];
  const others = rnd.shuffle([0, 1, 2, 3, 4, 5].filter((index) => index !== asked && index !== answer)).slice(0, 2);
  return { kind, net: { cells, faces: glyphs.map((glyph) => ({ glyph, turn: 0 })) }, asked, answer, options: rnd.shuffle([answer, ...others]).map((value) => ({ value, glyph: glyphs[value], turn: 0 })) };
}
function GlyphIcon({ glyph, turn, size }) {
  const angle = (turn * Math.PI) / 2;
  const a = Math.cos(angle); const b = Math.sin(angle);
  return <Svg width={size} height={size} viewBox="0 0 10 10"><Path d={GLYPHS[glyph]} stroke={SPACE_CADET.white} strokeWidth={0.8} strokeLinecap="round" strokeLinejoin="round" fill="none" transform={`matrix(${a} ${b} ${-b} ${a} ${5 - 5 * (a - b)} ${5 - 5 * (b + a)})`} /></Svg>;
}

export function OppositeFaceModule({ rects, runtime, color }) {
  const rnd = useMemo(() => randomTools(createRandom(runtime.seed)), [runtime.seed]);
  const count = useRef(0);
  const nextPuzzle = () => { count.current += 1; return buildOpposite(rnd, count.current > FACE_ONLY_PUZZLES && rnd.chance(TURN_SHARE) ? "turn" : "face"); };
  const [puzzle, setPuzzle] = useState(nextPuzzle);
  const [picked, setPicked] = useState(null);
  const stats = useRef({ right: 0, wrong: 0 });
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";

  useEffect(() => runtime.register(() => {
    const target = runtime.durationMs / 1000 / OPPOSITE_SECONDS;
    const { right, wrong } = stats.current;
    return { performance: Math.max(0, Math.min(1, (right - wrong * 0.5) / target)), detail: `${right} right${wrong ? ` · ${wrong} wrong` : ""}` };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  function answer(value) {
    if (!running || picked !== null) return;
    const correct = value === puzzle.answer;
    stats.current[correct ? "right" : "wrong"] += 1;
    setPicked(value);
    feedback.flash(correct);
    void (correct ? triggerSuccessHaptic() : triggerErrorHaptic());
    setTimeout(() => { setPicked(null); setPuzzle(nextPuzzle()); }, OPPOSITE_PAUSE_MS);
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

export const oppositeFaceModule = {
  id: "opposite-face",
  title: "Opposite face",
  competence: "spatial",
  secondary: [],
  task: "opportunistic",
  voice: false,
  load: 2,
  rule: "A cube is shown unfolded with one face highlighted. FACE? Tap the face that ends up opposite it. TURN? The characters are turned: hold the cube with the highlighted character upright in front of you, turn the cube around sideways, and tap how the opposite character then looks. Wrong answers cost points.",
  recap: "find the opposite face",
  blocks: [{ key: "net", role: "display", h: 2, w: 2 }, { key: "answers", role: "control", h: 1, w: 4 }],
  Component: OppositeFaceModule,
};

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
