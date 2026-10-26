import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { createRandom, deriveSeed, randomTools } from "../../utils/random";
import { ChoiceButton, ChoiceRow, GameSetupShell, PickerSetting, SettingCard } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";

const ACCENT = SPACE_CADET.mentalMath;
const SUCCESS = "#34D399";
const ERROR = SPACE_CADET.attention;
const OPERATION_LABELS = { "+": "+", "-": "−", x: "×", "/": "÷" };
const MULTIPLIERS = [2, 2, 3, 4, 4, 5, 5, 6, 8, 9, 10, 10, 12, 15, 20, 25];
const PACES = { 3: "SLOW", 2: "MEDIUM", 1: "FAST" };
const PREPARE_MS = 900;
const RESULT_MS = 1600;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Daily training: five series for everyone, longer and faster as they go. Each stage draws its length from its
// own range (so a day's ladder always ramps up), its operations from the seed, and is worth a fixed share of the
// 1000 points: 100 / 150 / 200 / 250 / 300, right or wrong.
export const DAILY_STAGES = [
  { pace: 3, operations: ["+", "-"], length: [5, 6], points: 100 },
  { pace: 3, operations: ["+", "-", "x", "/"], length: [6, 7], points: 150 },
  { pace: 2, operations: ["+", "-"], length: [7, 8], points: 200 },
  { pace: 2, operations: ["+", "-", "x", "/"], length: [8, 9], points: 250 },
  { pace: 1, operations: ["+", "-", "x", "/"], length: [9, 10], points: 300 },
];
// With all four signs allowed, the chance of a × or ÷ step eases slightly as the series gets longer: 40 % at
// five steps, 30 % at ten.
const productChance = (length) => 0.4 - 0.02 * (length - 5);

function chooseOperation(operations, history, rnd, length) {
  if (operations.length === 1) return operations[0];
  const previous = history.at(-1);
  const hasProducts = operations.includes("x") || operations.includes("/");
  let pool = operations;
  if (hasProducts && operations.length === 4) pool = rnd.chance(productChance(length)) ? ["x", "/"] : ["+", "-"];
  const candidates = pool.filter((operation) => operation !== previous);
  return rnd.item(candidates.length ? candidates : pool);
}

// One series: a starting value and a chain of operations, drawn from `rnd`.
export function buildSequence({ operations, operationCount }, rnd) {
  const hasProducts = operations.includes("x") || operations.includes("/");
  let total = hasProducts ? rnd.int(6, 20) : rnd.int(25, 99);
  const start = total;
  const steps = [];
  const history = [];
  for (let index = 0; index < operationCount; index += 1) {
    const operation = chooseOperation(operations, history, rnd, operationCount);
    let shown = operation;
    let operand;
    if (operation === "+") { operand = total < 100 ? rnd.int(4, 59) : rnd.int(10, 99); total += operand; }
    if (operation === "-") { operand = total > 20 ? rnd.int(2, Math.max(2, Math.min(total - 1, 59))) : rnd.int(1, Math.max(1, total - 1)); total -= operand; }
    if (operation === "x") { operand = rnd.item(MULTIPLIERS); if (total * operand > 9999) operand = rnd.item([2, 2, 3, 4, 5, 10]); total *= operand; }
    if (operation === "/") {
      const divisors = MULTIPLIERS.filter((divisor) => divisor > 1 && total % divisor === 0);
      if (!divisors.length) { shown = "+"; operand = rnd.int(4, 39); total += operand; }
      else { operand = rnd.item(divisors); total /= operand; }
    }
    steps.push({ operation: shown, operand });
    history.push(shown);
  }
  return { start, steps, answer: total };
}

// The day's five series.
export function buildDailySeries(seed) {
  const rnd = randomTools(createRandom(seed));
  return DAILY_STAGES.map((stage, index) => ({ stage: index, pace: stage.pace, points: stage.points, operations: stage.operations, ...buildSequence({ operations: stage.operations, operationCount: rnd.int(stage.length[0], stage.length[1]) }, rnd) }));
}

function NumberPad({ onDigit, onDelete, onSubmit, disabled }) {
  return (
    <View style={styles.keypad}>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((number) => (
        <TouchableOpacity key={number} activeOpacity={0.85} disabled={disabled} onPress={() => onDigit(String(number))} style={styles.key}>
          <Text style={styles.keyText}>{number}</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity activeOpacity={0.85} disabled={disabled} onPress={onDelete} style={styles.key}>
        <Text style={styles.keyAction}>DELETE</Text>
      </TouchableOpacity>
      <TouchableOpacity activeOpacity={0.85} disabled={disabled} onPress={() => onDigit("0")} style={styles.key}>
        <Text style={styles.keyText}>0</Text>
      </TouchableOpacity>
      <TouchableOpacity activeOpacity={0.85} disabled={disabled} onPress={onSubmit} style={[styles.key, styles.submitKey]}>
        <Text style={styles.submitKeyText}>ENTER</Text>
      </TouchableOpacity>
    </View>
  );
}

// `daily` ({ seed, onFinish, onExit }) turns this into the daily training version: no preflight, the day's five
// series (DAILY_STAGES), each with its own ready screen, then onFinish({ score, metrics, trials }).
export function ContinuousTotalGame({ onExit, daily = null }) {
  const [selectedOperations, setSelectedOperations] = useState(["+", "-"]);
  const [intervalSeconds, setIntervalSeconds] = useState(2);
  const [operationCount, setOperationCount] = useState(8);
  const dailySeriesRef = useRef(daily ? buildDailySeries(deriveSeed(daily.seed, "series")) : null);
  const [phase, setPhase] = useState(daily ? "ready" : "preflight");
  const [sequence, setSequence] = useState(daily ? dailySeriesRef.current[0] : null);
  const [seriesIndex, setSeriesIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(-1);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [resultCorrect, setResultCorrect] = useState(null);
  const [results, setResults] = useState([]);
  const timeoutsRef = useRef([]);
  const resultsRef = useRef([]);
  const answerStartedAt = useRef(0);
  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({ onPrepareReturn: clearTimers, onReturnComplete: resetToPreflight });

  useEffect(() => () => clearTimers(), []);
  function clearTimers() { timeoutsRef.current.forEach(clearTimeout); timeoutsRef.current = []; }
  function queue(callback, delay) { timeoutsRef.current.push(setTimeout(callback, delay)); }
  const paceOf = (series) => series.pace ?? intervalSeconds;

  function showStep(nextIndex, activeSequence) {
    setStepIndex(nextIndex);
    queue(() => {
      if (nextIndex + 1 < activeSequence.steps.length) showStep(nextIndex + 1, activeSequence);
      else { answerStartedAt.current = Date.now(); setPhase("answer"); }
    }, paceOf(activeSequence) * 1000);
  }
  function resetToPreflight() { clearTimers(); setSequence(null); setFeedback(null); setResultCorrect(null); setPhase("preflight"); }
  function resetToReady() {
    clearTimers();
    setSequence(buildSequence({ operations: selectedOperations, operationCount }, randomTools(createRandom(Math.floor(Math.random() * 4294967296)))));
    setAnswer(""); setFeedback(null); setResultCorrect(null); setPhase("ready");
  }
  function prepareRun() { void triggerSelectionHaptic(); startMission(resetToReady); }
  function startSeries() {
    void triggerSelectionHaptic();
    clearTimers();
    setStepIndex(-1); setAnswer(""); setFeedback(null); setResultCorrect(null); setPhase("prepare");
    queue(() => { setPhase("sequence"); showStep(0, sequence); }, PREPARE_MS);
  }
  function toggleOperation(operation) {
    setSelectedOperations((current) => {
      if (current.includes(operation)) return current.length === 1 ? current : current.filter((item) => item !== operation);
      return [...current, operation];
    });
  }
  function handleDigit(value) { void triggerSelectionHaptic(); setAnswer((current) => `${current}${value}`.slice(0, 7)); }
  function handleDelete() { void triggerSelectionHaptic(); setAnswer((current) => current.slice(0, -1)); }
  async function submitAnswer() {
    if (!sequence || answer.length === 0 || feedback) return;
    const correct = Number(answer) === sequence.answer;
    await triggerSelectionHaptic();
    void (correct ? triggerSuccessHaptic() : triggerErrorHaptic());
    resultsRef.current = [...resultsRef.current, { ok: correct ? 1 : 0, ms: Date.now() - answerStartedAt.current, answer: Number(answer), expected: sequence.answer, length: sequence.steps.length, pace: paceOf(sequence), pts: correct ? sequence.points ?? 0 : 0 }];
    setResults(resultsRef.current);
    setResultCorrect(correct);
    setFeedback(correct ? "success" : "error");
    queue(() => { setFeedback(null); setPhase("result"); if (daily) queue(advanceDaily, RESULT_MS); }, 260);
  }
  function advanceDaily() {
    const next = seriesIndex + 1;
    if (next < dailySeriesRef.current.length) { setSeriesIndex(next); setSequence(dailySeriesRef.current[next]); setAnswer(""); setResultCorrect(null); setPhase("ready"); return; }
    const entries = resultsRef.current;
    daily.onFinish({
      score: clamp(entries.reduce((sum, entry) => sum + entry.pts, 0), 0, 1000),
      metrics: { correct: entries.filter((entry) => entry.ok).length, series: entries.length, steps: entries.reduce((sum, entry) => sum + entry.length, 0), offByTen: entries.filter((entry) => !entry.ok && Math.abs(entry.answer - entry.expected) <= 10).length, meanAnswerMs: Math.round(entries.reduce((sum, entry) => sum + entry.ms, 0) / entries.length) },
      trials: entries,
    });
  }

  const visibleValue = sequence ? (stepIndex === -1 ? String(sequence.start) : `${OPERATION_LABELS[sequence.steps[stepIndex].operation]} ${sequence.steps[stepIndex].operand}`) : "";
  const stageLabel = sequence?.pace ? `${PACES[sequence.pace]} · ${sequence.operations.length === 2 ? "+ AND −" : "ALL SIGNS"} · ${sequence.steps.length} STEPS` : null;

  const preflight = <GameSetupShell title="Running Total" categoryKey="mentalMath" onExit={onExit} onStart={prepareRun} rules="Tests mental updating and sustained focus. Keep a running total as each operation appears, then enter the final total. Choose any operation mix; shorter intervals make the sequence harder.Easy: Use a slower pace and fewer operations.Medium: Mix operations at a medium pace.Hard: Use all four operations at a fast pace.">
    <PickerSetting label="Pace" hint="Time between operations" options={[{ value: 3, label: "SLOW" }, { value: 2, label: "MEDIUM" }, { value: 1, label: "FAST" }]} value={intervalSeconds} onChange={setIntervalSeconds} />
    <SettingCard label="Operations"><ChoiceRow>{["+", "-", "x", "/"].map((operation) => <ChoiceButton key={operation} label={OPERATION_LABELS[operation]} selected={selectedOperations.includes(operation)} onPress={() => toggleOperation(operation)} accent={ACCENT} />)}</ChoiceRow></SettingCard>
    <PickerSetting label="Series length" options={[5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((value) => ({ value, label: String(value) }))} value={operationCount} onChange={setOperationCount} />
  </GameSetupShell>;

  return <View style={styles.container}>
    {phase === "preflight" || isReturning ? <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflight}</Animated.View> : null}
    {phase !== "preflight" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, !daily && missionStyle]}>
      <View style={styles.header}><Pressable onPress={daily ? daily.onExit : returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>

      {phase === "ready" && sequence ? <Pressable onPress={startSeries} style={styles.readyScreen}>
        <Text style={styles.kicker}>{daily ? `DAILY TRAINING · SERIES ${seriesIndex + 1} / ${DAILY_STAGES.length}` : "RUNNING TOTAL"}</Text>
        <Text style={styles.readyTitle}>{daily && seriesIndex === 0 ? "Ready to keep count?" : "Starting value"}</Text>
        {daily && seriesIndex === 0 ? <Text style={styles.readyText}>Five series, longer and faster as they go. Keep the total in your head, then enter it. Worth 100 to 300 points each.</Text> : null}
        {daily ? <Text style={styles.stageText}>{stageLabel} · {sequence.points} POINTS</Text> : null}
        <Text style={styles.readyValue}>{sequence.start}</Text>
        <PulsingPrompt color={ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt>
      </Pressable> : null}

      {phase === "prepare" ? <View style={styles.centerPanel}><Text style={styles.prepareText}>Focus</Text><Text style={styles.prepareHint}>The starting value is coming up.</Text></View> : null}

      {phase === "sequence" && sequence ? <View style={styles.centerPanel}>
        <Text style={styles.progressText}>{stepIndex === -1 ? "STARTING VALUE" : `OPERATION ${stepIndex + 1} / ${sequence.steps.length}`}</Text>
        <Text adjustsFontSizeToFit numberOfLines={1} style={styles.sequenceValue}>{visibleValue}</Text>
      </View> : null}

      {phase === "answer" ? <Animated.View entering={FadeIn.duration(160)} style={styles.answerPanel}>
        <View style={styles.answerPrompt}>
          <Text style={styles.kicker}>{daily ? `SERIES ${seriesIndex + 1} / ${DAILY_STAGES.length}` : "RUNNING TOTAL"}</Text>
          <Text style={styles.answerTitle}>What is the final total?</Text>
          <View style={[styles.answerBox, feedback === "success" && styles.answerSuccess, feedback === "error" && styles.answerError]}><Text style={[styles.answerText, feedback === "success" && styles.answerTextSuccess, feedback === "error" && styles.answerTextError]}>{answer || " "}</Text></View>
        </View>
        <NumberPad disabled={Boolean(feedback)} onDigit={handleDigit} onDelete={handleDelete} onSubmit={submitAnswer} />
      </Animated.View> : null}

      {phase === "result" && sequence ? <Animated.View entering={FadeIn.duration(160)} style={styles.resultPanel}>
        <Text style={[styles.resultTitle, resultCorrect ? styles.resultCorrect : styles.resultWrong]}>{resultCorrect ? "Correct" : "Not quite"}</Text>
        <Text style={styles.resultLine}>Your answer  <Text style={styles.resultValue}>{answer}</Text></Text>
        <Text style={styles.resultLine}>Final total  <Text style={styles.resultValue}>{sequence.answer}</Text></Text>
        {daily ? <Text style={styles.resultLine}>Points  <Text style={styles.resultValue}>{resultCorrect ? sequence.points : 0} / {sequence.points}</Text></Text> : null}
        {daily ? <Text style={styles.totalLine}>{results.reduce((sum, entry) => sum + entry.pts, 0)} / 1000 so far</Text> : <View style={styles.actions}>
          <TouchableOpacity activeOpacity={0.9} onPress={resetToReady} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Play again</Text></TouchableOpacity>
          <TouchableOpacity activeOpacity={0.9} onPress={returnToPreflight} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Change settings</Text></TouchableOpacity>
        </View>}
      </Animated.View> : null}
    </Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SPACE_CADET.black }, preflightLayer: { ...StyleSheet.absoluteFill, zIndex: 1 }, missionLayer: { flex: 1, backgroundColor: SPACE_CADET.black, zIndex: 2 },
  header: { height: 64, paddingHorizontal: 20, justifyContent: "center" }, backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, backArrow: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 }, pressed: { transform: [{ scale: 0.97 }] },
  kicker: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.9, textAlign: "center" },
  readyScreen: { flex: 1, alignItems: "center", paddingHorizontal: 28, paddingTop: 64 }, readyTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 31, marginTop: 9, textAlign: "center" }, readyText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 21, maxWidth: 296, textAlign: "center", marginTop: 12 }, stageText: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6, marginTop: 26 }, readyValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 62, marginTop: 22 }, beginPrompt: { marginTop: 40, textAlign: "center" },
  centerPanel: { flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 150 }, prepareText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 38, textAlign: "center" }, prepareHint: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 16, textAlign: "center", marginTop: 12 },
  progressText: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.7, marginBottom: 20, textAlign: "center" }, sequenceValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 62, textAlign: "center", width: "100%" },
  answerPanel: { flex: 1, paddingHorizontal: 20 }, answerPrompt: { flex: 1, justifyContent: "center", alignItems: "center" }, answerTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 29, textAlign: "center", marginTop: 13 },
  answerBox: { minWidth: 170, borderBottomWidth: 1.25, borderBottomColor: SPACE_CADET.white, marginTop: 20, paddingHorizontal: 12, paddingBottom: 7 }, answerSuccess: { borderBottomColor: SUCCESS }, answerError: { borderBottomColor: ERROR }, answerText: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 34, textAlign: "center", minHeight: 42 }, answerTextSuccess: { color: SUCCESS }, answerTextError: { color: ERROR },
  keypad: { flexDirection: "row", flexWrap: "wrap", gap: 9, paddingBottom: 30 }, key: { width: "31.3%", height: 58, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.surface1 }, keyText: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 24 }, keyAction: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 0.8 }, submitKey: { backgroundColor: SPACE_CADET.white }, submitKeyText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1 },
  resultPanel: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 96, paddingBottom: 28 }, resultTitle: { fontFamily: "Gontserrat-Light", fontSize: 38, textAlign: "center", marginBottom: 20 }, resultCorrect: { color: SUCCESS }, resultWrong: { color: ERROR }, resultLine: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 15, lineHeight: 28, textAlign: "center" }, resultValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 17 }, totalLine: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 13, marginTop: 22 },
  actions: { width: "100%", gap: 12, marginTop: "auto" }, primaryButton: { width: "100%", minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.white }, primaryButtonText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 16 }, secondaryButton: { width: "100%", minHeight: 52, borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: SPACE_CADET.borderDefault }, secondaryButtonText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 },
});
