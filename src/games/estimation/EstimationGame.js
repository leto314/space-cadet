import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import Svg, { Circle, Line } from "react-native-svg";
import { ChoiceButton, ChoiceRow, GameSetupShell, SettingCard, TapePicker } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { createRandom, deriveSeed, randomTools } from "../../utils/random";

const ACCENT = SPACE_CADET.mentalMath;
const SUCCESS = "#34D399";
const ERROR = SPACE_CADET.attention;
const TYPES = [
  { value: "all", label: "ALL" }, { value: "multiply", label: "PRODUCT" }, { value: "divide", label: "QUOTIENT" }, { value: "percent", label: "PERCENTAGE" },
  { value: "sum", label: "SUM" }, { value: "compare", label: "COMPARE" }, { value: "increase", label: "CHANGE" }, { value: "missing", label: "MISSING" },
  { value: "points", label: "DOT COUNT" }, { value: "angle", label: "ANGLES" },
];
export const EXERCISE_TYPES = TYPES.filter((item) => item.value !== "all").map((item) => item.value);
// Problems draw from `rng`, which buildProblem points at an injected generator (seeded in missions and in the daily).
let rng = Math.random;
const randomInt = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
const randomItem = (items) => items[Math.floor(rng() * items.length)];
const formatTime = (value) => Math.floor(value / 60) + ":" + String(value % 60).padStart(2, "0");
const formatNumber = (value) => Math.round(value).toLocaleString("en-US");
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Timing: how long the dots stay on screen before they are hidden, the limit to answer one estimate (whatever
// is typed is then submitted), and the pause showing the target and the points.
const LOOK_MS = 4000;
const ANSWER_LIMIT_MS = 15000;
const FEEDBACK_MS = 1100;

// Points of an estimate (0–100) from its relative error: 100 within the `full` band, then falling evenly to 0
// at the `zero` band, both set per type (counting dots or reading an angle is harder to nail than 20 % of 300).
// Compare questions are right or wrong. No time weighting: the limit above is the only clock.
//   dots, 15 blue: 13–17 → 100 · 12 or 18 → 80 · 19 → 53 · 10 → 27 · 8 or 22 → 0
export const TOLERANCES = {
  multiply: { full: 0.04, zero: 0.28 }, divide: { full: 0.04, zero: 0.28 }, percent: { full: 0.03, zero: 0.25 }, sum: { full: 0.03, zero: 0.2 },
  increase: { full: 0.08, zero: 0.4 }, missing: { full: 0.05, zero: 0.3 }, points: { full: 0.15, zero: 0.4 }, angle: { full: 0.06, zero: 0.3 },
};
export function estimatePoints(problem, answer) {
  if (answer === null || answer === undefined || Number.isNaN(answer)) return 0;
  if (problem.type === "compare") return answer === problem.target ? 100 : 0;
  const { full, zero } = TOLERANCES[problem.type];
  const error = Math.abs(answer - problem.target) / Math.max(1, Math.abs(problem.target));
  return clamp(Math.round(100 * clamp(1 - (error - full) / (zero - full), 0, 1)), 0, 100);
}

// Daily training: twelve estimates for everyone, every type once plus three more, in a seeded order.
export const DAILY_COUNT = 12;
export function buildDailyProblems(seed) {
  const rnd = randomTools(createRandom(seed));
  const types = rnd.shuffle([...EXERCISE_TYPES, ...Array.from({ length: DAILY_COUNT - EXERCISE_TYPES.length }, () => rnd.item(EXERCISE_TYPES))]);
  return types.map((type, index) => buildProblem([type], createRandom(deriveSeed(seed, `estimate-${index}`))));
}

function buildPoints() {
  const count = randomInt(18, 48);
  const blueOnly = rng() < 0.45;
  const points = Array.from({ length: count }, () => ({ x: randomInt(8, 92), y: randomInt(9, 91), blue: rng() < 0.36 }));
  return { type: "points", title: "DOT COUNT", prompt: blueOnly ? "How many blue dots?" : "How many dots?", target: blueOnly ? points.filter((point) => point.blue).length : count, step: 1, tolerance: 0.35, points };
}

function buildAngle() {
  const interior = rng() < 0.5;
  const angle = randomItem([25, 35, 45, 55, 65, 75, 90, 105, 120, 135]);
  return { type: "angle", title: "ANGLES", prompt: "Estimate the " + (interior ? "interior" : "exterior") + " angle.", target: interior ? angle : 180 - angle, step: 1, tolerance: 0.2, angle };
}

export function buildProblem(types, random = Math.random) {
  rng = random;
  try { return buildProblemOf(randomItem(types)); } finally { rng = Math.random; }
}
function buildProblemOf(type) {
  if (type === "points") return buildPoints();
  if (type === "angle") return buildAngle();
  if (type === "multiply") { const a = randomInt(28, 94); const b = randomInt(19, 58); return { type, title: "PRODUCT", prompt: a + " × " + b + " ≈ ?", target: a * b, step: 10, tolerance: 0.28 }; }
  if (type === "divide") { const divisor = randomInt(13, 36); const quotient = randomInt(18, 58); const dividend = divisor * quotient + randomItem([-2, -1, 0, 1, 2]); return { type, title: "QUOTIENT", prompt: dividend + " ÷ " + divisor + " ≈ ?", target: dividend / divisor, step: 1, tolerance: 0.28 }; }
  if (type === "percent") { const percent = randomItem([8, 10, 12, 15, 18, 20, 25, 30]); const total = randomInt(14, 48) * 10; return { type, title: "PERCENTAGE", prompt: percent + "% of " + total + " ≈ ?", target: percent * total / 100, step: 1, tolerance: 0.25 }; }
  if (type === "sum") { const a = randomInt(95, 298); const b = randomInt(180, 549); const c = randomInt(45, 180); return { type, title: "SUM", prompt: a + " + " + b + " + " + c + " ≈ ?", target: a + b + c, step: 5, tolerance: 0.2 }; }
  if (type === "compare") { const a = [randomInt(22, 72), randomInt(14, 54)]; const b = [randomInt(22, 72), randomInt(14, 54)]; if (Math.abs(a[0] * a[1] - b[0] * b[1]) < 120) b[0] += 11; return { type, title: "COMPARE", prompt: "Which product is larger?", target: a[0] * a[1] > b[0] * b[1] ? -1 : 1, compareLabels: [a[0] + " × " + a[1], b[0] + " × " + b[1]] }; }
  if (type === "increase") { const start = randomInt(12, 28) * 100; const rate = randomItem([8, 10, 12, 15, 18, 20, 25]); return { type, title: "PERCENT CHANGE", prompt: formatNumber(start) + " → " + formatNumber(Math.round(start * (1 + rate / 100))) + " ≈ + ?%", target: rate, step: 1, tolerance: 0.3 }; }
  const multiplier = randomInt(24, 68); const target = randomInt(13, 42) * 100;
  return { type: "missing", title: "MISSING VALUE", prompt: multiplier + " × ? ≈ " + formatNumber(target), target: target / multiplier, step: 1, tolerance: 0.3 };
}

export function acceptedRange(problem) {
  if (!problem || problem.type === "compare") return null;
  const minimum = problem.type === "points" ? 1 : problem.type === "angle" ? 8 : problem.step;
  const delta = Math.max(minimum, Math.round((Math.abs(problem.target) * 0.15) / problem.step) * problem.step);
  const lower = Math.max(0, Math.round((problem.target - delta) / problem.step) * problem.step);
  const upper = Math.round((problem.target + delta) / problem.step) * problem.step;
  return { lower, upper, delta };
}

function DotBoard({ points, compact = false }) {
  return <View style={[styles.dotBoard, compact && styles.dotBoardCompact]}>{points.map((point, index) => <View key={index} style={[styles.dot, compact && styles.dotCompact, { left: point.x + "%", top: point.y + "%", backgroundColor: point.blue ? SPACE_CADET.spatial : SPACE_CADET.white }]} />)}</View>;
}

function AngleDiagram({ angle, compact = false }) {
  const center = compact ? 62 : 86; const length = compact ? 47 : 67; const base = compact ? 91 : 118; const width = compact ? 124 : 172; const height = compact ? 116 : 152; const radians = angle * Math.PI / 180;
  return <View style={[styles.angleBoard, compact && styles.angleBoardCompact]}><Svg width={width} height={height} viewBox={"0 0 " + width + " " + height}><Line x1={center} y1={base} x2={center} y2={base - length} stroke={SPACE_CADET.white} strokeWidth={compact ? 3 : 4} strokeLinecap="round" /><Line x1={center} y1={base} x2={center + Math.sin(radians) * length} y2={base - Math.cos(radians) * length} stroke={SPACE_CADET.white} strokeWidth={compact ? 3 : 4} strokeLinecap="round" /><Circle cx={center} cy={base} r={compact ? 3 : 5} fill={ACCENT} /></Svg></View>;
}

function ReadyPreview({ problem }) {
  if (!problem) return null;
  if (problem.type === "points") return <DotBoard points={problem.points} compact />;
  if (problem.type === "angle") return <AngleDiagram angle={problem.angle} compact />;
  return <Text style={styles.readyExpression}>{problem.prompt.replace(" ≈ ?", "")}</Text>;
}


function NumberPad({ onDigit, onDelete, onSubmit, disabled }) {
  return <View style={styles.keypad}>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((number) => <TouchableOpacity key={number} activeOpacity={0.82} disabled={disabled} onPressIn={() => onDigit(String(number))} style={styles.key}><Text style={styles.keyText}>{number}</Text></TouchableOpacity>)}<TouchableOpacity activeOpacity={0.82} disabled={disabled} onPressIn={onDelete} style={styles.key}><Text style={styles.keyAction}>DELETE</Text></TouchableOpacity><TouchableOpacity activeOpacity={0.82} disabled={disabled} onPressIn={() => onDigit("0")} style={styles.key}><Text style={styles.keyText}>0</Text></TouchableOpacity><TouchableOpacity activeOpacity={0.82} disabled={disabled} onPressIn={onSubmit} style={[styles.key, styles.submitKey]}><Text style={styles.submitKeyText}>ENTER</Text></TouchableOpacity></View>;
}

// `daily` ({ seed, onFinish, onExit }) turns this into the daily training version: no preflight, the day's twelve
// estimates, then onFinish({ score, metrics, trials }).
export function EstimationGame({ onExit, daily = null }) {
  const [duration, setDuration] = useState(1);
  const [selectedTypes, setSelectedTypes] = useState(["all"]);
  const [phase, setPhase] = useState(daily ? "ready" : "preflight");
  const [remaining, setRemaining] = useState(60);
  const [answerLeft, setAnswerLeft] = useState(ANSWER_LIMIT_MS / 1000);
  const [problem, setProblem] = useState(null);
  const [problemIndex, setProblemIndex] = useState(0);
  const [stage, setStage] = useState("answer");
  const [readyProblem, setReadyProblem] = useState(() => daily ? buildDailyProblems(deriveSeed(daily.seed, "estimates"))[0] : null);
  const [typed, setTyped] = useState("");
  const [outcome, setOutcome] = useState(null);
  const [summary, setSummary] = useState(null);
  const timers = useRef([]); const intervalRef = useRef(null); const answerIntervalRef = useRef(null); const activeRef = useRef(false); const pausedRef = useRef(false); const lockedRef = useRef(false); const typedRef = useRef(""); const problemRef = useRef(null); const problemIndexRef = useRef(0); const startedAt = useRef(0); const configRef = useRef([]); const rndRef = useRef(null); const dailyRef = useRef([]); const resultsRef = useRef([]); const finishedRef = useRef(false);
  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({ onPrepareReturn: clearTimers, onReturnComplete: resetToPreflight });
  useEffect(() => () => clearTimers(), []);
  function clearTimers() { clearInterval(intervalRef.current); intervalRef.current = null; clearInterval(answerIntervalRef.current); answerIntervalRef.current = null; timers.current.forEach(clearTimeout); timers.current = []; activeRef.current = false; pausedRef.current = false; }
  function queue(callback, delay) { timers.current.push(setTimeout(callback, delay)); }
  function typesForSession() { return configRef.current.includes("all") ? EXERCISE_TYPES : configRef.current; }
  function resetToPreflight() { clearTimers(); setPhase("preflight"); setProblem(null); setOutcome(null); setSummary(null); }
  function resetToReady() { clearTimers(); setOutcome(null); setSummary(null); setProblem(null); rndRef.current = randomTools(createRandom(Math.floor(Math.random() * 4294967296))); setReadyProblem(buildProblem(selectedTypes.includes("all") ? EXERCISE_TYPES : selectedTypes, rndRef.current.random)); setPhase("ready"); }
  function setInput(value) { typedRef.current = value; setTyped(value); }
  function showProblem(index) {
    let next;
    if (daily) { next = dailyRef.current[index]; if (!next) { finishGame(); return; } }
    else next = buildProblem(typesForSession(), rndRef.current.random);
    problemRef.current = next; problemIndexRef.current = index; setProblem(next); setProblemIndex(index); setInput(""); setOutcome(null); lockedRef.current = false;
    clearInterval(answerIntervalRef.current); answerIntervalRef.current = null;
    if (next.type === "points") { setStage("look"); pausedRef.current = true; queue(() => openAnswer(next), LOOK_MS); }
    else openAnswer(next);
  }
  function openAnswer(current) {
    if (problemRef.current !== current) return;
    setStage("answer"); pausedRef.current = false; startedAt.current = Date.now(); setAnswerLeft(ANSWER_LIMIT_MS / 1000);
    answerIntervalRef.current = setInterval(() => {
      const left = ANSWER_LIMIT_MS - (Date.now() - startedAt.current);
      setAnswerLeft(Math.max(0, Math.ceil(left / 1000)));
      if (left <= 0) submit(typedRef.current === "" ? null : Number(typedRef.current));
    }, 250);
  }
  function finishGame() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    clearTimers();
    const entries = resultsRef.current;
    const points = entries.reduce((sum, entry) => sum + entry.pts, 0);
    const outcomeSummary = { estimates: entries.length, score: entries.length ? clamp(Math.round((points / entries.length) * 10), 0, 1000) : 0, meanPoints: entries.length ? Math.round(points / entries.length) : 0, close: entries.filter((entry) => entry.pts >= 80).length, meanMs: entries.length ? Math.round(entries.reduce((sum, entry) => sum + entry.ms, 0) / entries.length) : null };
    if (daily) { daily.onFinish({ score: clamp(Math.round(points * (1000 / (DAILY_COUNT * 100))), 0, 1000), metrics: { estimates: entries.length, close: outcomeSummary.close, meanPoints: outcomeSummary.meanPoints, meanMs: outcomeSummary.meanMs, unanswered: entries.filter((entry) => entry.answer === null).length }, trials: entries }); return; }
    setSummary(outcomeSummary); setPhase("summary");
  }
  function startGame() {
    clearTimers(); finishedRef.current = false; resultsRef.current = []; activeRef.current = true;
    if (daily) dailyRef.current = buildDailyProblems(deriveSeed(daily.seed, "estimates"));
    else { setRemaining(duration * 60); intervalRef.current = setInterval(() => setRemaining((current) => { if (pausedRef.current) return current; if (current <= 1) { finishGame(); return 0; } return current - 1; }), 1000); }
    setPhase("playing"); showProblem(0);
  }
  function submit(answer) {
    const current = problemRef.current;
    if (!activeRef.current || !current || lockedRef.current || finishedRef.current) return;
    lockedRef.current = true;
    clearInterval(answerIntervalRef.current); answerIntervalRef.current = null;
    const pts = estimatePoints(current, answer);
    pausedRef.current = true;
    resultsRef.current = [...resultsRef.current, { type: current.type, answer, target: current.target, pts, ms: Date.now() - startedAt.current }];
    setOutcome({ pts, answer });
    void (pts >= 50 ? triggerSuccessHaptic() : triggerErrorHaptic());
    queue(() => showProblem(problemIndexRef.current + 1), FEEDBACK_MS);
  }
  function digit(value) { if (lockedRef.current) return; void triggerSelectionHaptic(); setInput(`${typedRef.current}${value}`.slice(0, 6)); }
  function erase() { if (lockedRef.current) return; void triggerSelectionHaptic(); setInput(typedRef.current.slice(0, -1)); }
  function enter() { if (typedRef.current === "") return; submit(Number(typedRef.current)); }
  function toggleType(value) { void triggerSelectionHaptic(); if (value === "all") { setSelectedTypes(["all"]); return; } setSelectedTypes((current) => { const values = current.includes("all") ? [] : current; const next = values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; if (!next.length) return current; return next.length === EXERCISE_TYPES.length ? ["all"] : next; }); }

  const typeButton = (item) => <ChoiceButton key={item.value} label={item.label} compact selected={selectedTypes.includes(item.value)} accent={ACCENT} onPress={() => toggleType(item.value)} />;
  const preflight = <GameSetupShell title="Estimation" categoryKey="mentalMath" onExit={onExit} onStart={() => { configRef.current = selectedTypes; startMission(resetToReady); }} rules="Tests fast numerical and visual estimation. Type your estimate and enter it: the closer, the more points, up to 100 per estimate (full points within a small band, then falling evenly to 0 at a band set per type). Dots are shown for four seconds, then hidden. Fifteen seconds per estimate. Select one or more exercise types to focus your training."><SettingCard label="Duration" hint="In minutes"><TapePicker options={[1, 2, 3, 4, 5].map((value) => ({ value, label: String(value) }))} value={duration} onChange={setDuration} /></SettingCard><SettingCard label="Estimation types" hint="Select one or more types."><View style={styles.typeRows}><ChoiceRow>{TYPES.slice(0, 4).map(typeButton)}</ChoiceRow><ChoiceRow>{TYPES.slice(4, 8).map(typeButton)}</ChoiceRow><ChoiceRow>{TYPES.slice(8).map(typeButton)}<View style={styles.typeSpacer} /><View style={styles.typeSpacer} /></ChoiceRow></View></SettingCard></GameSetupShell>;

  const unit = problem?.type === "increase" ? "%" : problem?.type === "angle" ? "°" : "";
  const feedbackColor = outcome ? (outcome.pts >= 50 ? SUCCESS : ERROR) : null;
  return <View style={styles.container}>
    {phase === "preflight" || isReturning ? <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflight}</Animated.View> : null}
    {phase !== "preflight" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, !daily && missionStyle]}>
      <View style={styles.header}><Pressable onPress={daily ? daily.onExit : returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>
      {phase === "ready" ? <Pressable style={styles.readyScreen} onPress={startGame}><Text style={styles.kicker}>{daily ? "DAILY TRAINING" : "ESTIMATION"}</Text><Text style={styles.readyTitle}>Trust your first read.</Text><Text style={styles.readyText}>{daily ? `${DAILY_COUNT} estimates of every kind, up to 100 points each: the closer, the more. Fifteen seconds per estimate.` : "Make a close estimate: the closer, the more points."}</Text><PulsingPrompt color={ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt><View style={styles.readyPreview}><ReadyPreview problem={readyProblem} /></View></Pressable> : null}
      {phase === "playing" && problem ? <Animated.View key={problemIndex} entering={FadeIn.duration(160)} style={styles.playScreen}>
        <View style={styles.statusRow}><View><Text style={styles.statusLabel}>{daily ? "ESTIMATE" : "TIME LEFT"}</Text><Text style={styles.statusValue}>{daily ? <>{problemIndex + 1}<Text style={styles.statusTotal}> / {DAILY_COUNT}</Text></> : formatTime(remaining)}</Text></View><View style={styles.scoreBlock}><Text style={styles.statusLabel}>{stage === "look" ? "MEMORISE" : "ANSWER IN"}</Text><Text style={styles.statusValue}>{stage === "look" ? " " : `${answerLeft} s`}</Text></View></View>
        <View style={styles.problemArea}>
          <Text style={styles.problemKicker}>{problem.title}</Text>
          <Text style={styles.problemText}>{stage === "look" ? "Look carefully…" : problem.prompt}</Text>
          {problem.type === "points" && stage === "look" ? <DotBoard points={problem.points} /> : null}
          {problem.type === "angle" ? <AngleDiagram angle={problem.angle} /> : null}
          {problem.type === "compare" ? <View style={styles.compareRow}>{problem.compareLabels.map((label, index) => <Text key={label} style={[styles.compareValue, outcome && (problem.target === (index === 0 ? -1 : 1) ? { color: SUCCESS } : outcome.answer === (index === 0 ? -1 : 1) ? { color: ERROR } : null)]}>{index === 0 ? "← " : ""}{label}{index === 1 ? " →" : ""}</Text>)}</View> : null}
          {problem.type !== "compare" && stage === "answer" ? <View style={[styles.answerDisplay, outcome && { borderBottomColor: feedbackColor }]}><Text style={[styles.answerText, outcome && { color: feedbackColor }]}>{typed === "" ? " " : formatNumber(Number(typed))}</Text>{unit && typed !== "" ? <Text style={[styles.answerUnit, outcome && { color: feedbackColor }]}>{unit}</Text> : null}</View> : null}
          {outcome ? <Animated.View entering={FadeIn.duration(120)} style={styles.rangeReadout}><Text style={styles.rangeLabel}>{problem.type === "compare" ? `ANSWER · ${problem.target === -1 ? "LEFT" : "RIGHT"}` : `TARGET · ${formatNumber(problem.target)}${unit}`}</Text><Text style={[styles.rangeValue, { color: feedbackColor }]}>{outcome.pts} points</Text></Animated.View> : null}
        </View>
        {problem.type === "compare" ? <View style={styles.compareButtons}>{problem.compareLabels.map((label, index) => { const value = index === 0 ? -1 : 1; return <TouchableOpacity key={label} activeOpacity={0.85} disabled={Boolean(outcome)} onPress={() => submit(value)} style={[styles.compareButton, outcome && (problem.target === value ? styles.compareRight : outcome.answer === value ? styles.compareWrong : null)]}><Text style={styles.compareButtonText}>{index === 0 ? "LEFT" : "RIGHT"}</Text></TouchableOpacity>; })}</View>
          : <NumberPad disabled={stage !== "answer" || Boolean(outcome)} onDigit={digit} onDelete={erase} onSubmit={enter} />}
      </Animated.View> : null}
      {phase === "summary" && summary ? <Animated.View entering={FadeIn.duration(180)} style={styles.summaryScreen}><Text style={styles.kicker}>SESSION ENDED</Text><Text style={styles.summaryTitle}>Training complete</Text><View style={styles.scoreSummaryRow}><Text style={styles.scoreNumber}>{summary.score}</Text><Text style={styles.scoreUnit}>/ 1000</Text></View><View style={styles.resultCard}><Text style={styles.resultLine}>Estimates submitted <Text style={styles.resultValue}>{summary.estimates}</Text></Text><Text style={styles.resultLine}>Average per estimate <Text style={styles.resultValue}>{summary.meanPoints} / 100</Text></Text><Text style={styles.resultLine}>Close estimates (80+) <Text style={styles.resultValue}>{summary.close}</Text></Text><Text style={styles.resultLine}>Average time <Text style={styles.resultValue}>{summary.meanMs !== null ? `${(summary.meanMs / 1000).toFixed(1)} s` : "—"}</Text></Text></View><View style={styles.actions}><TouchableOpacity activeOpacity={0.88} onPress={resetToReady} style={styles.primaryButton}><Text style={styles.primaryText}>Play again</Text></TouchableOpacity><TouchableOpacity activeOpacity={0.88} onPress={returnToPreflight} style={styles.secondaryButton}><Text style={styles.secondaryText}>Change settings</Text></TouchableOpacity></View></Animated.View> : null}
    </Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container:{flex:1,backgroundColor:SPACE_CADET.black},preflightLayer:{...StyleSheet.absoluteFill,zIndex:1},missionLayer:{flex:1,backgroundColor:SPACE_CADET.black,zIndex:2},header:{height:64,paddingHorizontal:20,justifyContent:"center"},backButton:{width:44,height:44,justifyContent:"center",alignItems:"center"},backArrow:{color:SPACE_CADET.white,fontFamily:"Gontserrat-Light",fontSize:32,lineHeight:36},pressed:{transform:[{scale:0.97}]},
  typeRows:{gap:8},typeSpacer:{flex:1},kicker:{color:ACCENT,fontFamily:"Gontserrat-SemiBold",fontSize:10,letterSpacing:1.9,textAlign:"center"},readyScreen:{flex:1,alignItems:"center",paddingHorizontal:28,paddingTop:64},readyTitle:{color:SPACE_CADET.white,fontFamily:"Gontserrat-Light",fontSize:31,marginTop:9,textAlign:"center"},readyText:{color:SPACE_CADET.textSecondary,fontFamily:"Gontserrat-Regular",fontSize:14,lineHeight:21,maxWidth:296,textAlign:"center",marginTop:12},beginPrompt:{marginTop:43,textAlign:"center"},readyPreview:{width:230,height:178,marginTop:20,borderRadius:22,backgroundColor:SPACE_CADET.surface1,alignItems:"center",justifyContent:"center",overflow:"hidden"},readyExpression:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:25,textAlign:"center",paddingHorizontal:20},
  playScreen:{flex:1,paddingHorizontal:20,paddingBottom:24},statusRow:{flexDirection:"row",justifyContent:"space-between",marginTop:16},scoreBlock:{alignItems:"flex-end"},statusLabel:{color:SPACE_CADET.textTertiary,fontFamily:"Gontserrat-SemiBold",fontSize:9,letterSpacing:1.5},statusValue:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:28,marginTop:3},problemArea:{flex:1,alignItems:"center",justifyContent:"center",paddingBottom:16},problemKicker:{color:ACCENT,fontFamily:"Gontserrat-SemiBold",fontSize:10,letterSpacing:1.7,marginBottom:17},problemText:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:34,lineHeight:43,textAlign:"center",maxWidth:"100%"},answerDisplay:{minWidth:180,height:63,borderBottomWidth:1.5,borderBottomColor:SPACE_CADET.borderDefault,justifyContent:"center",alignItems:"center",flexDirection:"row",marginTop:24},answerSuccess:{borderBottomColor:SUCCESS},answerError:{borderBottomColor:ERROR},answerText:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:37,lineHeight:42,textAlign:"center"},answerUnit:{color:ACCENT,fontFamily:"Garet-Book",fontSize:26,marginLeft:5},answerTextSuccess:{color:SUCCESS,textShadowColor:SUCCESS,textShadowRadius:14,textShadowOffset:{width:0,height:0}},answerTextError:{color:ERROR,textShadowColor:ERROR,textShadowRadius:14,textShadowOffset:{width:0,height:0}},rangeReadout:{alignItems:"center",marginTop:18,minHeight:43},rangeLabel:{color:ACCENT,fontFamily:"Gontserrat-SemiBold",fontSize:9,letterSpacing:1.55},rangeValue:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:20,lineHeight:26,marginTop:2},
  dotBoard:{width:244,height:244,marginTop:21,borderRadius:22,backgroundColor:SPACE_CADET.surface1,position:"relative",overflow:"hidden"},dotBoardCompact:{width:162,height:124,marginTop:0,borderRadius:0,backgroundColor:"transparent"},dot:{position:"absolute",width:7,height:7,marginLeft:-3.5,marginTop:-3.5,borderRadius:4,opacity:0.86},dotCompact:{width:5,height:5,marginLeft:-2.5,marginTop:-2.5},angleBoard:{marginTop:13,height:152,justifyContent:"center",alignItems:"center"},angleBoardCompact:{height:124,marginTop:0},compareRow:{flexDirection:"row",gap:24,marginTop:30},compareValue:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:19,textAlign:"center"},
  keypad:{flexDirection:"row",flexWrap:"wrap",gap:9},key:{width:"31.3%",height:57,borderRadius:17,alignItems:"center",justifyContent:"center",backgroundColor:SPACE_CADET.surface1},keyText:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:24},keyAction:{color:SPACE_CADET.textSecondary,fontFamily:"Gontserrat-SemiBold",fontSize:9,letterSpacing:0.8},submitKey:{backgroundColor:SPACE_CADET.white},submitKeyText:{color:SPACE_CADET.black,fontFamily:"Gontserrat-SemiBold",fontSize:10,letterSpacing:1.1},compareButtons:{flexDirection:"row",gap:12,paddingBottom:8},compareButton:{flex:1,height:72,borderRadius:20,alignItems:"center",justifyContent:"center",backgroundColor:SPACE_CADET.surface1,borderWidth:1,borderColor:SPACE_CADET.borderSubtle},compareButtonText:{color:SPACE_CADET.white,fontFamily:"Gontserrat-SemiBold",fontSize:12,letterSpacing:1.6},compareRight:{borderColor:SUCCESS,backgroundColor:"#0C2B23"},compareWrong:{borderColor:ERROR,backgroundColor:"#3D101D"},statusTotal:{color:SPACE_CADET.textTertiary,fontSize:18},
  summaryScreen:{flex:1,alignItems:"center",paddingHorizontal:20,paddingTop:70,paddingBottom:28},summaryTitle:{color:SPACE_CADET.white,fontFamily:"Gontserrat-Light",fontSize:31,marginTop:8},scoreSummaryRow:{flexDirection:"row",alignItems:"center",gap:10,marginTop:31,marginBottom:26},scoreNumber:{color:ACCENT,fontFamily:"Garet-Book",fontSize:53},scoreUnit:{color:SPACE_CADET.textSecondary,fontFamily:"Gontserrat-SemiBold",fontSize:11,letterSpacing:1.7},resultCard:{width:"100%",backgroundColor:SPACE_CADET.surface1,borderRadius:22,padding:19},resultLine:{color:SPACE_CADET.textSecondary,fontFamily:"Gontserrat-Regular",fontSize:13,lineHeight:25},resultValue:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:15},actions:{width:"100%",gap:12,marginTop:"auto"},primaryButton:{minHeight:54,borderRadius:999,alignItems:"center",justifyContent:"center",backgroundColor:SPACE_CADET.white},primaryText:{color:SPACE_CADET.black,fontFamily:"Gontserrat-Regular",fontSize:16,lineHeight:20,transform:[{translateY:2}]},secondaryButton:{minHeight:52,borderRadius:999,borderWidth:1,borderColor:SPACE_CADET.borderDefault,alignItems:"center",justifyContent:"center"},secondaryText:{color:SPACE_CADET.white,fontFamily:"Gontserrat-Regular",fontSize:15,lineHeight:19,transform:[{translateY:2}]},
});
