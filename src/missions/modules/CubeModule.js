import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import Svg, { Polygon } from "react-native-svg";

import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerImpactHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { createRandom, randomTools } from "../../utils/random";
import { BlockKicker, LED_IDLE, ModuleBlock, tint, useFeedbackFlash } from "../kit";

const ROLL_MS = 650;
const WARNING_MS = 1500;
const MARK_VISIBLE_MS = 3000;
const ANSWER_LEAD_MS = 10000;
const FACES = [
  { key: "front", normal: [0, 0, 1], vertices: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { key: "back", normal: [0, 0, -1], vertices: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { key: "left", normal: [-1, 0, 0], vertices: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { key: "right", normal: [1, 0, 0], vertices: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { key: "top", normal: [0, 1, 0], vertices: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { key: "bottom", normal: [0, -1, 0], vertices: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
];
const ANSWERS = [["top", "TOP"], ["bottom", "BOTTOM"], ["left", "LEFT"], ["right", "RIGHT"], ["front", "FRONT"], ["back", "BACK"]];
const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

const multiply = (a, b) => a.map((row) => [0, 1, 2].map((column) => row.reduce((sum, value, k) => sum + value * b[k][column], 0)));
const apply = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
function rotation(axis, degrees) {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return axis === "x" ? [[1, 0, 0], [0, c, -s], [0, s, c]] : [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}
const snap = (m) => m.map((row) => row.map((value) => Math.round(value)));
// Seen straight from the front: at rest only the front face shows, the depth appears while it rolls.
const VIEW = IDENTITY;

// Where the marked face (initially facing the player) points now, in the player's frame.
function markedDirection(matrix) {
  const [x, y, z] = apply(matrix, [0, 0, 1]);
  if (Math.abs(x) > 0.5) return x > 0 ? "right" : "left";
  if (Math.abs(y) > 0.5) return y > 0 ? "top" : "bottom";
  return z > 0 ? "front" : "back";
}

function buildPlan(seed, durationMs) {
  const rnd = randomTools(createRandom(seed));
  const questions = durationMs >= 240000 ? [durationMs / 2, durationMs - ANSWER_LEAD_MS] : [durationMs - ANSWER_LEAD_MS];
  const rolls = [];
  for (let at = rnd.int(6000, 9000); at < durationMs - ANSWER_LEAD_MS - 2000; at += rnd.int(10000, 16000)) {
    if (questions.some((time) => at > time - 2000 && at < time + ANSWER_LEAD_MS)) continue;
    rolls.push({ at, axis: rnd.item(["x", "y"]), direction: rnd.item([1, -1]) });
  }
  return { rolls, questions };
}

function CubeView({ matrix, size, color, markVisible }) {
  const scale = size * 0.23;
  const center = size / 2;
  const faces = FACES.map((face) => {
    const model = multiply(VIEW, matrix);
    const points = face.vertices.map((vertex) => apply(model, vertex));
    const normal = apply(model, face.normal);
    const depth = points.reduce((sum, point) => sum + point[2], 0) / 4;
    const projected = points.map(([x, y, z]) => { const factor = 6 / (6 - z); return `${(center + x * scale * factor).toFixed(1)},${(center - y * scale * factor).toFixed(1)}`; }).join(" ");
    const light = Math.max(0, Math.min(1, 0.35 + normal[2] * 0.4 + normal[1] * 0.25));
    return { key: face.key, visible: normal[2] > 0.02, depth, projected, light };
  }).filter((face) => face.visible).sort((a, b) => a.depth - b.depth);
  return <Svg width={size} height={size}>
    {faces.map((face) => {
      const marked = markVisible && face.key === "front";
      return <Polygon key={face.key} points={face.projected} fill={marked ? tint(color, 0.55) : `rgba(255,255,255,${(0.03 + face.light * 0.07).toFixed(3)})`} stroke={color} strokeOpacity={0.8} strokeWidth={1.4} strokeLinejoin="round" />;
    })}
  </Svg>;
}

export function CubeModule({ rects, runtime, color }) {
  const plan = useMemo(() => buildPlan(runtime.seed, runtime.durationMs), [runtime.seed, runtime.durationMs]);
  const [matrix, setMatrix] = useState(IDENTITY);
  const [markVisible, setMarkVisible] = useState(true);
  const [question, setQuestion] = useState(null);
  const [answered, setAnswered] = useState(null);
  const state = useRef({ matrix: IDENTITY, nextRoll: 0, warned: -1, nextQuestion: 0, rolling: null, question: null });
  const outcomes = useRef([]);
  const blink = useSharedValue(0);
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";
  const block = rects.cube;
  const cubeSize = Math.min(block.width, block.height) - 34;

  useEffect(() => runtime.register(() => {
    const correct = outcomes.current.filter(Boolean).length;
    return { performance: correct / plan.questions.length, detail: `${correct}/${plan.questions.length} final positions right · ${plan.rolls.length} rolls` };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running) return undefined;
    const current = state.current;
    const timer = setInterval(() => {
      const now = runtime.elapsed();
      if (markVisible && now > MARK_VISIBLE_MS) setMarkVisible(false);
      if (current.rolling) {
        const progress = Math.min(1, (now - current.rolling.startedAt) / ROLL_MS);
        const eased = progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;
        const turn = rotation(current.rolling.axis, current.rolling.direction * 90 * eased);
        if (progress >= 1) { current.matrix = snap(multiply(rotation(current.rolling.axis, current.rolling.direction * 90), current.matrix)); current.rolling = null; setMatrix(current.matrix); }
        else setMatrix(multiply(turn, current.matrix));
        return;
      }
      if (current.question && now - current.question.at > ANSWER_LEAD_MS - 1000) { outcomes.current.push(false); current.question = null; setQuestion(null); }
      if (current.nextQuestion < plan.questions.length && now >= plan.questions[current.nextQuestion]) {
        current.question = { at: now, answer: markedDirection(current.matrix) };
        current.nextQuestion += 1;
        setAnswered(null);
        setQuestion(current.question);
        void triggerSelectionHaptic();
        return;
      }
      // Each roll is announced (light + vibration) a moment before it happens, so the player can look over in time.
      const roll = plan.rolls[current.nextRoll];
      if (!current.question && roll && current.warned !== current.nextRoll && now >= roll.at - WARNING_MS) {
        current.warned = current.nextRoll;
        blink.value = withSequence(withTiming(1, { duration: 80 }), withTiming(0.6, { duration: WARNING_MS - 80 }), withTiming(0, { duration: 400 }));
        void triggerImpactHaptic();
      }
      if (!current.question && roll && now >= roll.at) {
        current.rolling = { ...roll, startedAt: now };
        current.nextRoll += 1;
      }
    }, 16);
    return () => clearInterval(timer);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  function answer(key) {
    const current = state.current;
    if (!running || !current.question) return;
    const correct = key === current.question.answer;
    outcomes.current.push(correct);
    setAnswered({ key, correct, truth: current.question.answer });
    current.question = null;
    feedback.flash(correct);
    void (correct ? triggerSuccessHaptic() : triggerErrorHaptic());
    setTimeout(() => { setQuestion(null); setAnswered(null); }, 1100);
  }

  const ledStyle = useAnimatedStyle(() => ({ backgroundColor: blink.value > 0.05 ? color : LED_IDLE, opacity: 0.35 + blink.value * 0.65 }));

  return <ModuleBlock rect={block} color={color} led={ledStyle} flash={feedback.style}>
    <BlockKicker color={color} style={styles.kicker}>{question ? "WHERE IS IT?" : "CUBE"}</BlockKicker>
    {question ? <View style={styles.answers}>
      {[0, 1, 2].map((row) => <View key={row} style={styles.answerRow}>
        {ANSWERS.slice(row * 2, row * 2 + 2).map(([key, label]) => {
          const tone = answered && (key === answered.truth ? "right" : key === answered.key ? "wrong" : null);
          return <Pressable key={key} disabled={Boolean(answered)} onPress={() => answer(key)} style={({ pressed }) => [styles.answer, pressed && { backgroundColor: tint(color, 0.16) }, tone === "right" && styles.answerRight, tone === "wrong" && styles.answerWrong]}>
            <Text style={styles.answerText}>{label}</Text>
          </Pressable>;
        })}
      </View>)}
    </View> : <View style={styles.stage}><CubeView matrix={matrix} size={cubeSize} color={color} markVisible={markVisible} /></View>}
  </ModuleBlock>;
}

export const cubeModule = {
  id: "cube",
  title: "Cube tracking",
  competence: "spatial",
  secondary: ["memory"],
  task: "event",
  voice: false,
  load: 2,
  rule: "Remember the highlighted face: it becomes plain after a few seconds. Every now and then the cube rolls a quarter turn; the light and a vibration warn you just before. Keep track of where that face goes: near the end you will be asked where it is now.",
  recap: "track the cube's marked face",
  blocks: [{ key: "cube", role: "display", h: 2, w: 2 }],
  Component: CubeModule,
};

const styles = StyleSheet.create({
  kicker: { position: "absolute", top: 12, left: 14 },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 16 },
  answers: { flex: 1, paddingHorizontal: 10, paddingTop: 34, paddingBottom: 10, gap: 6 },
  answerRow: { flex: 1, flexDirection: "row", gap: 6 },
  answer: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" },
  answerRight: { borderColor: "#34D399" },
  answerWrong: { borderColor: SPACE_CADET.attention },
  answerText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.1 },
});
