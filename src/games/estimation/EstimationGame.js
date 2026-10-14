import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import Svg, { Circle, Line } from "react-native-svg";
import { ChoiceButton, ChoiceRow, GameSetupShell, SettingCard, TapePicker } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";

const ACCENT = SPACE_CADET.mentalMath;
const SUCCESS = "#34D399";
const ERROR = SPACE_CADET.attention;
const TYPES = [
  { value: "all", label: "ALL" }, { value: "multiply", label: "PRODUCT" }, { value: "divide", label: "QUOTIENT" }, { value: "percent", label: "PERCENTAGE" },
  { value: "sum", label: "SUM" }, { value: "compare", label: "COMPARE" }, { value: "increase", label: "CHANGE" }, { value: "missing", label: "MISSING" },
  { value: "points", label: "DOT COUNT" }, { value: "angle", label: "ANGLES" },
];
export const EXERCISE_TYPES = TYPES.filter((item) => item.value !== "all").map((item) => item.value);
// Problems draw from `rng`, which buildProblem points at an injected generator (seeded in missions).
let rng = Math.random;
const randomInt = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
const randomItem = (items) => items[Math.floor(rng() * items.length)];
const formatTime = (value) => Math.floor(value / 60) + ":" + String(value % 60).padStart(2, "0");
const formatNumber = (value) => Math.round(value).toLocaleString("en-US");

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

export function EstimationGame({ onExit }) {
  const [duration, setDuration] = useState(1);
  const [selectedTypes, setSelectedTypes] = useState(["all"]);
  const [phase, setPhase] = useState("preflight");
  const [remaining, setRemaining] = useState(60);
  const [problem, setProblem] = useState(null);
  const [readyProblem, setReadyProblem] = useState(null);
  const [answer, setAnswer] = useState(0);
  const [joystick, setJoystick] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [range, setRange] = useState(null);
  const [results, setResults] = useState([]);
  const timers = useRef([]); const intervalRef = useRef(null); const activeRef = useRef(false); const pausedRef = useRef(false); const lockedRef = useRef(false); const answerRef = useRef(0); const joystickRef = useRef(0); const problemRef = useRef(null); const startedAt = useRef(0); const configRef = useRef([]); const submitRef = useRef(null);
  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({ onPrepareReturn: clearTimers, onReturnComplete: resetToPreflight });
  useEffect(() => () => clearTimers(), []);
  function clearTimers() { clearInterval(intervalRef.current); intervalRef.current = null; timers.current.forEach(clearTimeout); timers.current = []; activeRef.current = false; pausedRef.current = false; }
  function queue(callback, delay) { timers.current.push(setTimeout(callback, delay)); }
  function typesForSession() { return configRef.current.includes("all") ? EXERCISE_TYPES : configRef.current; }
  function resetToPreflight() { clearTimers(); setPhase("preflight"); setProblem(null); setFeedback(null); setRange(null); setAnswer(0); }
  function resetToReady() { clearTimers(); setFeedback(null); setRange(null); setProblem(null); setAnswer(0); setReadyProblem(buildProblem(selectedTypes.includes("all") ? EXERCISE_TYPES : selectedTypes)); setPhase("ready"); }
  function showProblem() { const next = buildProblem(typesForSession()); problemRef.current = next; setProblem(next); setAnswer(0); answerRef.current = 0; setJoystick(0); joystickRef.current = 0; setFeedback(null); setRange(null); pausedRef.current = false; lockedRef.current = false; startedAt.current = Date.now(); }
  function finishGame() { clearTimers(); setPhase("summary"); }
  function startGame() {
    clearTimers(); activeRef.current = true; setResults([]); setRemaining(duration * 60); setPhase("playing"); showProblem();
    intervalRef.current = setInterval(() => setRemaining((current) => { if (pausedRef.current) return current; if (current <= 1) { finishGame(); return 0; } return current - 1; }), 1000);
    const adjustmentInterval = setInterval(() => {
      const activeProblem = problemRef.current;
      if (!activeRef.current || !activeProblem || activeProblem.type === "compare" || lockedRef.current) return;
      const strength = Math.abs(joystickRef.current);
      if (strength < 0.04) return;
      const delta = Math.sign(joystickRef.current) * activeProblem.step * (0.055 + strength ** 2.5 * 7.6);
      const next = Math.max(-99999, Math.min(99999, Math.round((answerRef.current + delta) / activeProblem.step) * activeProblem.step));
      answerRef.current = next; setAnswer(next);
    }, 55);
    timers.current.push(adjustmentInterval);
  }
  function submit(finalAnswer = answerRef.current) {
    const activeProblem = problemRef.current;
    if (!activeRef.current || !activeProblem || lockedRef.current || phase !== "playing") return;
    lockedRef.current = true;
    const responseTime = Date.now() - startedAt.current;
    const accepted = acceptedRange(activeProblem);
    const correct = activeProblem.type === "compare" ? finalAnswer === activeProblem.target : finalAnswer >= accepted.lower && finalAnswer <= accepted.upper;
    const precision = activeProblem.type === "compare" ? (correct ? 1 : 0) : Math.max(0, 1 - Math.abs(finalAnswer - activeProblem.target) / (Math.max(1, Math.abs(activeProblem.target)) * 0.3));
    pausedRef.current = true;
    setRange(accepted); setFeedback(correct ? "success" : "error");
    if (correct) void triggerSuccessHaptic(); else void triggerErrorHaptic();
    setResults((current) => [...current, { precision, responseTime }]);
    queue(showProblem, 1000);
  }
  submitRef.current = submit;
  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => activeRef.current && !lockedRef.current, onMoveShouldSetPanResponder: () => activeRef.current && !lockedRef.current,
    onPanResponderGrant: () => void triggerSelectionHaptic(),
    onPanResponderMove: (_, gesture) => { const target = Math.max(-1, Math.min(1, gesture.dx / 145)); joystickRef.current = target; setJoystick((current) => current + (target - current) * 0.34); },
    onPanResponderRelease: () => { const current = problemRef.current; const released = joystickRef.current; joystickRef.current = 0; setJoystick(0); if (current?.type === "compare" && Math.abs(released) > 0.28) submitRef.current?.(released < 0 ? -1 : 1); },
    onPanResponderTerminate: () => { joystickRef.current = 0; setJoystick(0); },
  })).current;
  function toggleType(value) { void triggerSelectionHaptic(); if (value === "all") { setSelectedTypes(["all"]); return; } setSelectedTypes((current) => { const values = current.includes("all") ? [] : current; const next = values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; if (!next.length) return current; return next.length === EXERCISE_TYPES.length ? ["all"] : next; }); }
  const summary = useMemo(() => { const accuracy = results.length ? Math.round(results.reduce((sum, item) => sum + item.precision, 0) * 100 / results.length) : 0; const average = results.length ? Math.round(results.reduce((sum, item) => sum + item.responseTime, 0) / results.length) : null; const score = Math.round(results.reduce((sum, item) => sum + item.precision * (1.2 - Math.min(item.responseTime, 12000) / 60000), 0) * 100); return { accuracy, average, score }; }, [results]);
  const knobStyle = { transform: [{ translateX: joystick * 108 }] };
  const fillStyle = joystick >= 0 ? { left: "50%", width: joystick * 50 + "%" } : { left: 50 + joystick * 50 + "%", width: Math.abs(joystick) * 50 + "%" };
  const typeButton = (item) => <ChoiceButton key={item.value} label={item.label} compact selected={selectedTypes.includes(item.value)} accent={ACCENT} onPress={() => toggleType(item.value)} />;
  const preflight = <GameSetupShell title="Estimation" categoryKey="mentalMath" onExit={onExit} onStart={() => { configRef.current = selectedTypes; startMission(resetToReady); }} rules="Tests fast numerical and visual estimation. Adjust your estimate with the precision control, then submit it. Answers within the accepted range count as correct. Select one or more exercise types to focus your training."><SettingCard label="Duration" hint="In minutes"><TapePicker options={[1, 2, 3, 4, 5].map((value) => ({ value, label: String(value) }))} value={duration} onChange={setDuration} /></SettingCard><SettingCard label="Estimation types" hint="Select one or more types."><View style={styles.typeRows}><ChoiceRow>{TYPES.slice(0, 4).map(typeButton)}</ChoiceRow><ChoiceRow>{TYPES.slice(4, 8).map(typeButton)}</ChoiceRow><ChoiceRow>{TYPES.slice(8).map(typeButton)}<View style={styles.typeSpacer} /><View style={styles.typeSpacer} /></ChoiceRow></View></SettingCard></GameSetupShell>;
  return <View style={styles.container}>
    {phase === "preflight" || isReturning ? <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflight}</Animated.View> : null}
    {phase !== "preflight" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, missionStyle]}>
      <View style={styles.header}><Pressable onPress={returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>
      {phase === "ready" ? <Pressable style={styles.readyScreen} onPress={startGame}><Text style={styles.kicker}>ESTIMATION</Text><Text style={styles.readyTitle}>Trust your first read.</Text><Text style={styles.readyText}>Make a close estimate. Precision and pace both count.</Text><PulsingPrompt color={ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt><View style={styles.readyPreview}><ReadyPreview problem={readyProblem} /></View></Pressable> : null}
      {phase === "playing" && problem ? <Animated.View entering={FadeIn.duration(160)} style={styles.playScreen}>
        <View style={styles.statusRow}><View><Text style={styles.statusLabel}>TIME LEFT</Text><Text style={styles.statusValue}>{formatTime(remaining)}</Text></View><View style={styles.scoreBlock}><Text style={styles.statusLabel}>ESTIMATES</Text><Text style={styles.statusValue}>{results.length}</Text></View></View>
        <View style={styles.problemArea}><Text style={styles.problemKicker}>{problem.title}</Text><Text style={styles.problemText}>{problem.prompt}</Text>{problem.type === "points" ? <DotBoard points={problem.points} /> : null}{problem.type === "angle" ? <AngleDiagram angle={problem.angle} /> : null}{problem.type === "compare" ? <View style={styles.compareRow}>{problem.compareLabels.map((label, index) => <Text key={label} style={styles.compareValue}>{index === 0 ? "←" : "→"} {label}</Text>)}</View> : <View style={[styles.answerDisplay, feedback === "success" && styles.answerSuccess, feedback === "error" && styles.answerError]}><Text style={[styles.answerText, feedback === "success" && styles.answerTextSuccess, feedback === "error" && styles.answerTextError]}>{formatNumber(answer)}</Text>{problem.type === "increase" ? <Text style={[styles.answerUnit, feedback === "success" && styles.answerTextSuccess, feedback === "error" && styles.answerTextError]}>%</Text> : null}</View>}{range ? <Animated.View entering={FadeIn.duration(120)} style={styles.rangeReadout}><Text style={styles.rangeLabel}>ACCEPTED RANGE</Text><Text style={styles.rangeValue}>{formatNumber(range.lower)} — {formatNumber(range.upper)}</Text></Animated.View> : null}</View>
        <View style={styles.controlSection}><Text style={styles.controlHint}>{problem.type === "compare" ? "Drag left or right, then release" : "Hold and drag to adjust"}</Text><View style={styles.track} {...panResponder.panHandlers}><View style={[styles.trackFill, fillStyle]} /><Text style={styles.trackSideLeft}>{problem.type === "compare" ? "LEFT" : "−"}</Text><Text style={styles.trackSideRight}>{problem.type === "compare" ? "RIGHT" : "+"}</Text><View style={styles.trackCenter} /><View style={[styles.trackKnob, knobStyle]} /></View>{problem.type !== "compare" ? <TouchableOpacity disabled={Boolean(feedback)} activeOpacity={0.86} onPress={() => submit()} style={[styles.submitButton, feedback && styles.disabledButton]}><Text style={styles.submitText}>SUBMIT ESTIMATE</Text></TouchableOpacity> : null}</View>
      </Animated.View> : null}
      {phase === "summary" ? <Animated.View entering={FadeIn.duration(180)} style={styles.summaryScreen}><Text style={styles.kicker}>SESSION ENDED</Text><Text style={styles.summaryTitle}>Training complete</Text><View style={styles.scoreSummaryRow}><Text style={styles.scoreNumber}>{summary.score}</Text><Text style={styles.scoreUnit}>POINTS</Text></View><View style={styles.resultCard}><Text style={styles.resultLine}>Estimates submitted <Text style={styles.resultValue}>{results.length}</Text></Text><Text style={styles.resultLine}>Average accuracy <Text style={styles.resultValue}>{summary.accuracy}%</Text></Text><Text style={styles.resultLine}>Average response <Text style={styles.resultValue}>{summary.average !== null ? summary.average + " ms" : "—"}</Text></Text></View><View style={styles.actions}><TouchableOpacity activeOpacity={0.88} onPress={startGame} style={styles.primaryButton}><Text style={styles.primaryText}>Play again</Text></TouchableOpacity><TouchableOpacity activeOpacity={0.88} onPress={returnToPreflight} style={styles.secondaryButton}><Text style={styles.secondaryText}>Change settings</Text></TouchableOpacity></View></Animated.View> : null}
    </Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container:{flex:1,backgroundColor:SPACE_CADET.black},preflightLayer:{...StyleSheet.absoluteFill,zIndex:1},missionLayer:{flex:1,backgroundColor:SPACE_CADET.black,zIndex:2},header:{height:64,paddingHorizontal:20,justifyContent:"center"},backButton:{width:44,height:44,justifyContent:"center",alignItems:"center"},backArrow:{color:SPACE_CADET.white,fontFamily:"Gontserrat-Light",fontSize:32,lineHeight:36},pressed:{transform:[{scale:0.97}]},
  typeRows:{gap:8},typeSpacer:{flex:1},kicker:{color:ACCENT,fontFamily:"Gontserrat-SemiBold",fontSize:10,letterSpacing:1.9,textAlign:"center"},readyScreen:{flex:1,alignItems:"center",paddingHorizontal:28,paddingTop:80},readyTitle:{color:SPACE_CADET.white,fontFamily:"Gontserrat-Light",fontSize:31,marginTop:9,textAlign:"center"},readyText:{color:SPACE_CADET.textSecondary,fontFamily:"Gontserrat-Regular",fontSize:14,lineHeight:21,maxWidth:296,textAlign:"center",marginTop:12},beginPrompt:{marginTop:43,textAlign:"center"},readyPreview:{width:230,height:178,marginTop:20,borderRadius:22,backgroundColor:SPACE_CADET.surface1,alignItems:"center",justifyContent:"center",overflow:"hidden"},readyExpression:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:25,textAlign:"center",paddingHorizontal:20},
  playScreen:{flex:1,paddingHorizontal:20,paddingBottom:24},statusRow:{flexDirection:"row",justifyContent:"space-between",marginTop:16},scoreBlock:{alignItems:"flex-end"},statusLabel:{color:SPACE_CADET.textTertiary,fontFamily:"Gontserrat-SemiBold",fontSize:9,letterSpacing:1.5},statusValue:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:28,marginTop:3},problemArea:{flex:1,alignItems:"center",justifyContent:"center",paddingBottom:16},problemKicker:{color:ACCENT,fontFamily:"Gontserrat-SemiBold",fontSize:10,letterSpacing:1.7,marginBottom:17},problemText:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:34,lineHeight:43,textAlign:"center",maxWidth:"100%"},answerDisplay:{minWidth:180,height:63,borderBottomWidth:1.5,borderBottomColor:SPACE_CADET.borderDefault,justifyContent:"center",alignItems:"center",flexDirection:"row",marginTop:24},answerSuccess:{borderBottomColor:SUCCESS},answerError:{borderBottomColor:ERROR},answerText:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:37,lineHeight:42,textAlign:"center"},answerUnit:{color:ACCENT,fontFamily:"Garet-Book",fontSize:26,marginLeft:5},answerTextSuccess:{color:SUCCESS,textShadowColor:SUCCESS,textShadowRadius:14,textShadowOffset:{width:0,height:0}},answerTextError:{color:ERROR,textShadowColor:ERROR,textShadowRadius:14,textShadowOffset:{width:0,height:0}},rangeReadout:{alignItems:"center",marginTop:18,minHeight:43},rangeLabel:{color:ACCENT,fontFamily:"Gontserrat-SemiBold",fontSize:9,letterSpacing:1.55},rangeValue:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:20,lineHeight:26,marginTop:2},
  dotBoard:{width:244,height:244,marginTop:21,borderRadius:22,backgroundColor:SPACE_CADET.surface1,position:"relative",overflow:"hidden"},dotBoardCompact:{width:162,height:124,marginTop:0,borderRadius:0,backgroundColor:"transparent"},dot:{position:"absolute",width:7,height:7,marginLeft:-3.5,marginTop:-3.5,borderRadius:4,opacity:0.86},dotCompact:{width:5,height:5,marginLeft:-2.5,marginTop:-2.5},angleBoard:{marginTop:13,height:152,justifyContent:"center",alignItems:"center"},angleBoardCompact:{height:124,marginTop:0},compareRow:{flexDirection:"row",gap:24,marginTop:30},compareValue:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:19,textAlign:"center"},
  controlSection:{width:"100%"},controlHint:{color:SPACE_CADET.textSecondary,fontFamily:"Gontserrat-Regular",fontSize:12,textAlign:"center",marginBottom:13},track:{height:68,borderRadius:34,backgroundColor:SPACE_CADET.surface1,borderWidth:1,borderColor:SPACE_CADET.borderSubtle,justifyContent:"center",alignItems:"center",overflow:"hidden"},trackFill:{position:"absolute",height:"100%",backgroundColor:"#C46BFF30"},trackSideLeft:{position:"absolute",left:20,color:SPACE_CADET.textTertiary,fontFamily:"Gontserrat-SemiBold",fontSize:12,letterSpacing:1},trackSideRight:{position:"absolute",right:20,color:SPACE_CADET.textTertiary,fontFamily:"Gontserrat-SemiBold",fontSize:12,letterSpacing:1},trackCenter:{width:1,height:25,backgroundColor:"#C46BFF90"},trackKnob:{position:"absolute",width:52,height:52,borderRadius:26,backgroundColor:ACCENT,shadowColor:ACCENT,shadowOpacity:0.5,shadowRadius:11,shadowOffset:{width:0,height:0},elevation:4},submitButton:{height:52,borderRadius:999,backgroundColor:SPACE_CADET.white,alignItems:"center",justifyContent:"center",marginTop:12},disabledButton:{opacity:0.6},submitText:{color:SPACE_CADET.black,fontFamily:"Gontserrat-SemiBold",fontSize:11,letterSpacing:1.1},
  summaryScreen:{flex:1,alignItems:"center",paddingHorizontal:20,paddingTop:70,paddingBottom:28},summaryTitle:{color:SPACE_CADET.white,fontFamily:"Gontserrat-Light",fontSize:31,marginTop:8},scoreSummaryRow:{flexDirection:"row",alignItems:"center",gap:10,marginTop:31,marginBottom:26},scoreNumber:{color:ACCENT,fontFamily:"Garet-Book",fontSize:53},scoreUnit:{color:SPACE_CADET.textSecondary,fontFamily:"Gontserrat-SemiBold",fontSize:11,letterSpacing:1.7},resultCard:{width:"100%",backgroundColor:SPACE_CADET.surface1,borderRadius:22,padding:19},resultLine:{color:SPACE_CADET.textSecondary,fontFamily:"Gontserrat-Regular",fontSize:13,lineHeight:25},resultValue:{color:SPACE_CADET.white,fontFamily:"Garet-Book",fontSize:15},actions:{width:"100%",gap:12,marginTop:"auto"},primaryButton:{minHeight:54,borderRadius:999,alignItems:"center",justifyContent:"center",backgroundColor:SPACE_CADET.white},primaryText:{color:SPACE_CADET.black,fontFamily:"Gontserrat-Regular",fontSize:16,lineHeight:20,transform:[{translateY:2}]},secondaryButton:{minHeight:52,borderRadius:999,borderWidth:1,borderColor:SPACE_CADET.borderDefault,alignItems:"center",justifyContent:"center"},secondaryText:{color:SPACE_CADET.white,fontFamily:"Gontserrat-Regular",fontSize:15,lineHeight:19,transform:[{translateY:2}]},
});
