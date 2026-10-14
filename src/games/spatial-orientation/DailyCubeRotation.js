import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { PulsingPrompt } from "../../components/PulsingPrompt";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { createRandom, deriveSeed, randomTools } from "../../utils/random";
import { endVoiceSession, say, startVoiceSession, stopSpeaking } from "../../utils/voice";
import { CubeRenderer } from "./CubeRenderer";
import { buildRotationMatrix, CubeNetRenderer, easeInOut, getAnswerLabel, getTrackedFacePosition, getVoiceLabel, identityMatrix, multiplyMatrices, rotateOrientation, snapMatrix } from "./SpatialOrientationGame";

const ACCENT = SPACE_CADET.spatial;
const TURNS = 10;
const SETTLE_MS = 1500;
const UNFOLD_MS = 1800;
const REVEAL_MS = 2000;
const START_ORIENTATION = { front: "front", back: "back", left: "left", right: "right", top: "top", bottom: "bottom" };

// Five sets of growing difficulty, the same for everyone. "Hidden" turns are announced by the voice but the cube
// does not move: the player pictures them. (The cube's faces all look alike while it turns, so a skipped
// animation never shows a wrong state.)
//   set 1        slow, every turn shown
//   sets 2–3     quicker; one or two turns (never the first) only announced
//   sets 4–5     quicker; the first 3 or 4 turns are shown, then the cube stays still until the end of the set
const SLOW = { rotationMs: 950, pauseMs: 1250 };
const QUICK = { rotationMs: 800, pauseMs: 950 };
const hideSome = (rnd) => rnd.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, rnd.int(1, 2));
const hideTail = (rnd) => { const from = rnd.int(3, 4); return Array.from({ length: TURNS - from }, (_, index) => from + index); };
export const CUBE_SETS = [
  { ...SLOW, hidden: () => [] },
  { ...QUICK, hidden: hideSome },
  { ...QUICK, hidden: hideSome },
  { ...QUICK, hidden: hideTail },
  { ...QUICK, hidden: hideTail },
];
const SETS = CUBE_SETS.length;

// One set: ten turns (never a turn immediately undone by the next one) and which of them are hidden.
function buildSet(seed, index) {
  const rnd = randomTools(createRandom(deriveSeed(seed, `set-${index}`)));
  const turns = [];
  for (let turn = 0; turn < TURNS; turn += 1) {
    let next;
    do next = { axis: rnd.item(["x", "y", "z"]), direction: rnd.item([1, -1]) };
    while (turns.length && turns.at(-1).axis === next.axis && turns.at(-1).direction === -next.direction);
    turns.push(next);
  }
  const hidden = CUBE_SETS[index].hidden(rnd);
  return turns.map((turn, position) => ({ ...turn, hidden: hidden.includes(position) }));
}

// Daily training version of Cube Rotation: five sets of ten turns from the day's seed, then a score out of
// 1000 (200 per set found). Calls onFinish({ score, metrics, trials }).
export function DailyCubeRotation({ seed, onFinish, onExit }) {
  const [phase, setPhase] = useState("ready");
  const [setIndex, setSetIndex] = useState(0);
  const [turnIndex, setTurnIndex] = useState(0);
  const [hiddenNow, setHiddenNow] = useState(false);
  const [matrix, setMatrix] = useState(identityMatrix);
  const [unfold, setUnfold] = useState(0);
  const [result, setResult] = useState(null);
  const orientation = useRef(START_ORIENTATION);
  const matrixRef = useRef(identityMatrix);
  const timers = useRef([]);
  const frame = useRef(null);
  const answerStartedAt = useRef(0);
  const setIndexRef = useRef(0);
  const trials = useRef([]);
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; clearAll(); endVoiceSession(); }, []);

  function clearAll() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = null;
    stopSpeaking();
  }
  const later = (callback, delay) => { timers.current.push(setTimeout(() => { if (alive.current) callback(); }, delay)); };

  function animate(duration, onStep, onDone) {
    const startedAt = Date.now();
    const tick = () => {
      if (!alive.current) return;
      const progress = Math.min(1, (Date.now() - startedAt) / duration);
      onStep(easeInOut(progress));
      if (progress < 1) frame.current = requestAnimationFrame(tick);
      else { frame.current = null; onDone(); }
    };
    frame.current = requestAnimationFrame(tick);
  }

  async function begin() {
    void triggerSelectionHaptic();
    await startVoiceSession();
    startSet(0);
  }

  function startSet(index) {
    clearAll();
    orientation.current = START_ORIENTATION;
    matrixRef.current = identityMatrix;
    setMatrix(identityMatrix);
    setUnfold(0);
    setResult(null);
    setSetIndex(index);
    setIndexRef.current = index;
    setTurnIndex(0);
    setHiddenNow(false);
    setPhase("settling");
    const turns = buildSet(seed, index);
    later(() => { setPhase("running"); runTurn(turns, 0); }, SETTLE_MS);
  }

  function runTurn(turns, index) {
    if (index >= turns.length) {
      setPhase("unfolding");
      animate(UNFOLD_MS, setUnfold, () => { answerStartedAt.current = Date.now(); setPhase("answer"); });
      return;
    }
    const turn = turns[index];
    const config = CUBE_SETS[setIndexRef.current];
    setTurnIndex(index + 1);
    setHiddenNow(turn.hidden);
    void say(getVoiceLabel(turn), { language: "en-US", pitch: 1, rate: 0.92 });
    const settle = () => { orientation.current = rotateOrientation(orientation.current, turn.axis, turn.direction); };
    if (turn.hidden) {
      later(() => { settle(); runTurn(turns, index + 1); }, config.rotationMs + config.pauseMs);
      return;
    }
    const base = matrixRef.current;
    animate(config.rotationMs, (progress) => setMatrix(multiplyMatrices(buildRotationMatrix(turn.axis, turn.direction * 90 * progress), base)), () => {
      const final = snapMatrix(multiplyMatrices(buildRotationMatrix(turn.axis, turn.direction * 90), base));
      matrixRef.current = final;
      setMatrix(final);
      settle();
      later(() => runTurn(turns, index + 1), config.pauseMs);
    });
  }

  function answer(choice) {
    if (phase !== "answer") return;
    const expected = getTrackedFacePosition(orientation.current, "front");
    const ok = choice === expected;
    const hidden = buildSet(seed, setIndex).filter((turn) => turn.hidden).length;
    trials.current.push({ ok: ok ? 1 : 0, ms: Date.now() - answerStartedAt.current, answer: choice, expected, hidden });
    setResult({ selected: choice, correct: expected, isCorrect: ok });
    setPhase("reveal");
    void (ok ? triggerSuccessHaptic() : triggerErrorHaptic());
    later(() => {
      if (setIndex + 1 < SETS) { startSet(setIndex + 1); return; }
      const correct = trials.current.filter((trial) => trial.ok).length;
      const times = trials.current.map((trial) => trial.ms);
      endVoiceSession();
      onFinish({
        score: Math.round((correct / SETS) * 1000),
        metrics: { correct, sets: SETS, turnsPerSet: TURNS, meanAnswerMs: Math.round(times.reduce((sum, value) => sum + value, 0) / times.length), hiddenTurns: trials.current.reduce((sum, trial) => sum + trial.hidden, 0) },
        trials: trials.current,
      });
    }, REVEAL_MS);
  }

  const title = phase === "ready" ? "Ready to track the cube?" : phase === "settling" ? "Focus" : phase === "running" ? (hiddenNow ? "Picture the turn" : "Watch the turn") : phase === "unfolding" ? "Unfolding the cube" : phase === "answer" ? "Where is the marked face?" : result?.isCorrect ? "Correct" : "Not quite";
  const helper = phase === "ready" ? `${SETS} sets of ${TURNS} turns, harder as you go. Track the blue face.` : phase === "settling" ? "The marked face is the blue one." : phase === "running" && hiddenNow ? "The cube stays still: follow it in your head." : phase === "answer" ? "Tap the matching panel." : phase === "reveal" && result && !result.isCorrect ? `It was ${getAnswerLabel(result.correct)}.` : " ";
  const showCube = phase === "ready" || phase === "settling" || phase === "running";

  return <View style={styles.screen}>
    <View style={styles.header}>
      <Pressable onPress={onExit} hitSlop={10} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable>
      {phase !== "ready" ? <View style={styles.status}>
        <Text style={styles.statusText}>SET {setIndex + 1} / {SETS}</Text>
        <Text style={styles.statusText}>{phase === "running" ? `TURN ${turnIndex} / ${TURNS}` : " "}</Text>
      </View> : null}
    </View>
    <Pressable disabled={phase !== "ready"} onPress={begin} style={styles.body}>
      <Text style={styles.kicker}>DAILY TRAINING{phase !== "ready" ? ` · ${setIndex === 0 ? "SLOW" : setIndex < 3 ? "SOME TURNS HIDDEN" : "FINISH IN YOUR HEAD"}` : ""}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.helper}>{helper}</Text>
      <PulsingPrompt color={ACCENT} style={[styles.prompt, phase !== "ready" && styles.hiddenPrompt]}>{phase === "ready" ? "TAP ANYWHERE TO BEGIN" : " "}</PulsingPrompt>
      <View style={styles.stage}>
        {showCube
          ? <CubeRenderer matrix={matrix} pulseLevel={phase === "running" ? 0 : 0.6} highlightFace={phase === "running" ? null : "front"} accent={ACCENT} />
          : <CubeNetRenderer progress={unfold} onSelect={answer} disabled={phase !== "answer"} result={phase === "reveal" ? result : null} />}
      </View>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SPACE_CADET.black },
  header: { height: 64, paddingHorizontal: 20, flexDirection: "row", alignItems: "center" },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, backArrow: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 }, pressed: { transform: [{ scale: 0.97 }] },
  status: { flex: 1, alignItems: "flex-end" }, statusText: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6, lineHeight: 16 },
  body: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 40 },
  kicker: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.8, marginBottom: 10 },
  title: { minHeight: 34, textAlign: "center", fontFamily: "Gontserrat-Light", fontSize: 27, lineHeight: 34, color: SPACE_CADET.white },
  helper: { minHeight: 44, textAlign: "center", fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 22, color: SPACE_CADET.textSecondary, marginTop: 6, maxWidth: 300 },
  prompt: { fontSize: 12, height: 24, lineHeight: 16, textAlign: "center", letterSpacing: 1.8 }, hiddenPrompt: { opacity: 0 },
  stage: { width: "100%", minHeight: 360, alignItems: "center", justifyContent: "center", marginTop: -10 },
});
