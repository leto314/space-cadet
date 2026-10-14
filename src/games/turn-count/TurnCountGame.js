import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import Svg, { Circle, Line, Path } from "react-native-svg";

import { GameSetupShell, PickerSetting } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { createRandom } from "../../utils/random";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";

const ACCENT = SPACE_CADET.spatial;
const SUCCESS = "#34D399";
const ERROR = SPACE_CADET.attention;
const CANVAS_WIDTH = 320;
const CANVAS_HEIGHT = 330;
const TURN_COUNT = 8;

// Routes draw from `rng`, pointed at a seeded generator for the daily version.
let rng = Math.random;
function randomInt(min, max) { return Math.floor(rng() * (max - min + 1)) + min; }
function normalizeAngle(angle) { return ((angle % 360) + 360) % 360; }
function getPoint(point, angle, length) { const radians = (angle * Math.PI) / 180; return { x: point.x + Math.cos(radians) * length, y: point.y + Math.sin(radians) * length }; }
function isOnCanvas(point) { const margin = 18; return point.x >= margin && point.x <= CANVAS_WIDTH - margin && point.y >= margin && point.y <= CANVAS_HEIGHT - margin; }
function segmentsCross(a, b, c, d) {
  const orientation = (first, second, third) => (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);
  const first = orientation(a, b, c); const second = orientation(a, b, d); const third = orientation(c, d, a); const fourth = orientation(c, d, b);
  return first * second < 0 && third * fourth < 0;
}
function hasCrossing(points) { for (let index = 0; index < points.length - 1; index += 1) for (let otherIndex = index + 2; otherIndex < points.length - 1; otherIndex += 1) if (segmentsCross(points[index], points[index + 1], points[otherIndex], points[otherIndex + 1])) return true; return false; }
function fitTrajectoryToCanvas(points) {
  const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const width = Math.max(1, maxX - minX); const height = Math.max(1, maxY - minY);
  const scale = Math.min((CANVAS_WIDTH - 36) / width, (CANVAS_HEIGHT - 36) / height);
  const offsetX = (CANVAS_WIDTH - width * scale) / 2 - minX * scale; const offsetY = (CANVAS_HEIGHT - height * scale) / 2 - minY * scale;
  return points.map((point) => ({ x: point.x * scale + offsetX, y: point.y * scale + offsetY }));
}
function buildTrajectory() {
  const requireCrossing = rng() < 0.65;
  for (let attempt = 0; attempt < 160; attempt += 1) {
    let heading = randomInt(0, 359); const points = [{ x: 0, y: 0 }]; const turns = [];
    points.push(getPoint(points[0], heading, randomInt(95, 150)));
    for (let turnIndex = 0; turnIndex < TURN_COUNT; turnIndex += 1) { const sign = rng() < 0.5 ? -1 : 1; heading = normalizeAngle(heading + sign * randomInt(15, 150)); points.push(getPoint(points[points.length - 1], heading, randomInt(85, 155))); turns.push(sign); }
    if (!requireCrossing || hasCrossing(points)) { const fitted = fitTrajectoryToCanvas(points); if (fitted.every(isOnCanvas)) return { points: fitted, turns }; }
  }
  return buildTrajectory();
}
function buildRound() { const direction = rng() < 0.5 ? "L" : "R"; const trajectory = buildTrajectory(); return { direction, trajectory, correctAnswer: trajectory.turns.filter((turn) => turn === (direction === "R" ? 1 : -1)).length }; }
// Daily training: five routes for everyone, one slow, two at medium pace, two fast (seconds between turns).
export const DAILY_PACES = [{ seconds: 2, label: "SLOW" }, { seconds: 1.5, label: "MEDIUM" }, { seconds: 1.5, label: "MEDIUM" }, { seconds: 0.9, label: "FAST" }, { seconds: 0.9, label: "FAST" }];
export function buildDailyRounds(seed) {
  rng = createRandom(seed);
  try { return DAILY_PACES.map((pace) => ({ ...buildRound(), pace })); } finally { rng = Math.random; }
}
function directionName(direction) { return direction === "R" ? "RIGHT" : "LEFT"; }

function Trajectory({ trajectory, visibleSegments, correction, direction, preview = false }) {
  const firstVisible = correction || preview ? 0 : Math.max(0, visibleSegments - 4);
  const segmentCount = correction || preview ? trajectory.points.length - 1 : Math.max(0, visibleSegments - firstVisible);
  const targetSign = direction === "R" ? 1 : -1;
  const finalPoint = trajectory.points[trajectory.points.length - 1]; const beforeFinal = trajectory.points[trajectory.points.length - 2];
  const length = Math.hypot(finalPoint.x - beforeFinal.x, finalPoint.y - beforeFinal.y); const unitX = (finalPoint.x - beforeFinal.x) / length; const unitY = (finalPoint.y - beforeFinal.y) / length;
  const arrowTip = { x: finalPoint.x + unitX * 9, y: finalPoint.y + unitY * 9 }; const base = { x: arrowTip.x - unitX * 12, y: arrowTip.y - unitY * 12 }; const left = { x: base.x + unitY * 6, y: base.y - unitX * 6 }; const right = { x: base.x - unitY * 6, y: base.y + unitX * 6 };
  return <Svg width={CANVAS_WIDTH} height={CANVAS_HEIGHT} viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}>
    {Array.from({ length: segmentCount }, (_, offset) => { const index = firstVisible + offset; return <Line key={index} x1={trajectory.points[index].x} y1={trajectory.points[index].y} x2={trajectory.points[index + 1].x} y2={trajectory.points[index + 1].y} stroke={correction ? SPACE_CADET.white : ACCENT} strokeOpacity="1" strokeWidth={correction ? 3 : 4} strokeLinecap="round" />; })}
    {correction ? <Circle cx={trajectory.points[0].x} cy={trajectory.points[0].y} r="7" fill={SPACE_CADET.white} /> : null}
    {correction ? trajectory.turns.map((turn, index) => turn === targetSign ? <Circle key={index} cx={trajectory.points[index + 1].x} cy={trajectory.points[index + 1].y} r="9" fill="none" stroke={SUCCESS} strokeWidth="2.5" /> : null) : null}
    {correction ? <Path d={`M${arrowTip.x} ${arrowTip.y} L${left.x} ${left.y} L${right.x} ${right.y} Z`} fill={SPACE_CADET.white} /> : null}
  </Svg>;
}

// `daily` ({ seed, onFinish, onExit }) turns this into the daily training version (no preflight, the day's five
// routes, 200 points per right answer, then onFinish({ score, metrics, trials })).
export function TurnCountGame({ onExit, daily = null }) {
  const [turnInterval, setTurnInterval] = useState(2);
  const [roundCount, setRoundCount] = useState(5);
  const [phase, setPhase] = useState(daily ? "ready" : "preflight");
  const [rounds, setRounds] = useState([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [visibleSegments, setVisibleSegments] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [results, setResults] = useState([]);
  const [readyTrajectory, setReadyTrajectory] = useState(() => buildTrajectory());
  const timeoutsRef = useRef([]); const responseStartedAtRef = useRef(0);
  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({ onPrepareReturn: clearTimers, onReturnComplete: resetToPreflight });
  const currentRound = rounds[roundIndex] ?? null;

  useEffect(() => () => clearTimers(), []);
  function clearTimers() { timeoutsRef.current.forEach(clearTimeout); timeoutsRef.current = []; }
  function queue(callback, delay) { const timeoutId = setTimeout(callback, delay); timeoutsRef.current.push(timeoutId); }
  function resetToPreflight() { clearTimers(); setRounds([]); setResults([]); setRoundIndex(0); setSelectedAnswer(null); setPhase("preflight"); }
  function resetToReady() { clearTimers(); setRounds([]); setResults([]); setRoundIndex(0); setSelectedAnswer(null); setReadyTrajectory(buildTrajectory()); setPhase("ready"); }
  function prepareRun() { void triggerSelectionHaptic(); startMission(resetToReady); }
  function startCurrentRound(index, availableRounds = rounds) {
    const interval = availableRounds[index].pace?.seconds ?? turnInterval;
    clearTimers(); setRoundIndex(index); setVisibleSegments(1); setSelectedAnswer(null); setPhase("brief");
    queue(() => { setPhase("drawing"); const reveal = (segmentCount) => { setVisibleSegments(segmentCount); if (segmentCount >= availableRounds[index].trajectory.points.length - 1) { queue(() => { setPhase("answer"); responseStartedAtRef.current = Date.now(); }, interval * 1000); return; } queue(() => reveal(segmentCount + 1), interval * 1000); }; queue(() => reveal(2), interval * 1000); }, 900);
  }
  function beginSession() { void triggerSelectionHaptic(); const nextRounds = daily ? buildDailyRounds(daily.seed) : Array.from({ length: roundCount }, buildRound); setRounds(nextRounds); setResults([]); startCurrentRound(0, nextRounds); }
  function handleAnswer(answer) {
    if (!currentRound || phase !== "answer" || selectedAnswer !== null) return;
    const correct = answer === currentRound.correctAnswer;
    setSelectedAnswer(answer); setResults((current) => [...current, { correct, answer, expected: currentRound.correctAnswer, responseTime: Date.now() - responseStartedAtRef.current, pace: currentRound.pace?.label ?? null }]); setPhase("correction");
    if (correct) void triggerSuccessHaptic(); else void triggerErrorHaptic();
  }
  function moveForward() { void triggerSelectionHaptic(); if (roundIndex + 1 >= rounds.length) { if (daily) finishDaily(); else setPhase("summary"); return; } startCurrentRound(roundIndex + 1); }
  function finishDaily() {
    const correct = results.filter((result) => result.correct).length;
    const times = results.map((result) => result.responseTime);
    daily.onFinish({
      score: Math.round((correct / rounds.length) * 1000),
      metrics: { correct, routes: rounds.length, turnsPerRoute: TURN_COUNT, meanAnswerMs: Math.round(times.reduce((sum, value) => sum + value, 0) / times.length), offByOne: results.filter((result) => Math.abs(result.answer - result.expected) === 1).length },
      trials: results.map((result) => ({ ok: result.correct ? 1 : 0, ms: result.responseTime, answer: result.answer, expected: result.expected, pace: result.pace })),
    });
  }
  const summary = useMemo(() => { const correct = results.filter((result) => result.correct); return { correctCount: correct.length, accuracy: results.length ? Math.round((correct.length / results.length) * 100) : 0 }; }, [results]);
  const preflight = <GameSetupShell title="Turn Count" categoryKey="spatial" onExit={onExit} onStart={prepareRun} rules="Tests route tracking and directional working memory. Follow the route and count only the turns in the requested direction. The four latest segments remain visible. Pace controls the time between turns."><PickerSetting label="Pace" hint="Seconds between turns" options={[{ value: 2, label: "SLOW" }, { value: 1.5, label: "MEDIUM" }, { value: 0.9, label: "FAST" }]} value={turnInterval} onChange={setTurnInterval} /><PickerSetting label="Trajectories" options={[3, 4, 5, 6, 7, 8, 9, 10].map((value) => ({ value, label: String(value) }))} value={roundCount} onChange={setRoundCount} /></GameSetupShell>;

  return <View style={styles.container}>
    {phase === "preflight" || isReturning ? <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflight}</Animated.View> : null}
    {phase !== "preflight" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, !daily && missionStyle]}>
      <View style={styles.header}><Pressable onPress={daily ? daily.onExit : returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>
      {phase === "ready" ? <Pressable onPress={beginSession} style={styles.readyScreen}><Text style={styles.kicker}>TURN COUNT</Text><Text style={styles.readyTitle}>Ready to trace a route?</Text><Text style={styles.readyText}>{daily ? "Five routes: one slow, two at medium pace, two fast. Count only the requested turns." : "Follow every change of direction. Count only the requested turns."}</Text><PulsingPrompt color={ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt><View style={styles.readyRoute}><Trajectory trajectory={readyTrajectory} visibleSegments={readyTrajectory.points.length - 1} direction="R" preview /></View></Pressable> : null}
      {currentRound && phase === "brief" ? <Animated.View entering={FadeIn.duration(180)} style={styles.briefScreen}><Text style={styles.kicker}>ROUTE {roundIndex + 1} / {rounds.length}{currentRound.pace ? ` · ${currentRound.pace.label}` : ""}</Text><Text style={styles.briefCaption}>COUNT ONLY</Text><Text style={styles.directionWord}>{directionName(currentRound.direction)}</Text><Text style={styles.briefText}>turns</Text></Animated.View> : null}
      {currentRound && ["drawing", "answer", "correction"].includes(phase) ? <Animated.View entering={FadeIn.duration(150)} style={styles.playScreen}><Text style={styles.progress}>ROUTE {roundIndex + 1} / {rounds.length}</Text><Text style={styles.instruction}>{phase === "drawing" ? "Follow the route" : phase === "answer" ? `How many ${directionName(currentRound.direction).toLowerCase()} turns?` : selectedAnswer === currentRound.correctAnswer ? "Correct" : "Not quite"}</Text><View style={styles.trajectoryStage}>{phase !== "answer" ? <Trajectory trajectory={currentRound.trajectory} visibleSegments={visibleSegments} correction={phase === "correction"} direction={currentRound.direction} /> : null}</View>{phase === "answer" ? <View style={styles.answerGrid}>{Array.from({ length: 9 }, (_, answer) => <TouchableOpacity key={answer} activeOpacity={0.84} onPress={() => handleAnswer(answer)} style={styles.answerButton}><Text style={styles.answerText}>{answer}</Text></TouchableOpacity>)}</View> : null}{phase === "correction" ? <View style={styles.correctionArea}><Text style={[styles.answerReveal, selectedAnswer === currentRound.correctAnswer ? styles.answerCorrect : styles.answerWrong]}>{selectedAnswer}</Text><Text style={styles.expectedText}>Correct answer: {currentRound.correctAnswer}</Text><TouchableOpacity activeOpacity={0.88} onPress={moveForward} style={styles.primaryButton}><Text style={styles.primaryText}>{roundIndex + 1 === rounds.length ? "View results" : "Next route"}</Text></TouchableOpacity></View> : null}</Animated.View> : null}
      {phase === "summary" ? <Animated.View entering={FadeIn.duration(180)} style={styles.summaryScreen}><Text style={styles.kicker}>SESSION ENDED</Text><Text style={styles.summaryTitle}>Route tracking complete</Text><Text style={styles.score}>{summary.accuracy}%</Text><Text style={styles.scoreCaption}>accuracy</Text><View style={styles.statCard}><Text style={styles.statLabel}>RESULTS</Text><Text style={styles.statLine}>Correct answers <Text style={styles.statStrong}>{summary.correctCount} / {results.length}</Text></Text></View><View style={styles.actions}><TouchableOpacity activeOpacity={0.88} onPress={resetToReady} style={styles.primaryButton}><Text style={styles.primaryText}>Play again</Text></TouchableOpacity><TouchableOpacity activeOpacity={0.88} onPress={returnToPreflight} style={styles.secondaryButton}><Text style={styles.secondaryText}>Change settings</Text></TouchableOpacity></View></Animated.View> : null}
    </Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SPACE_CADET.black }, preflightLayer: { ...StyleSheet.absoluteFill, zIndex: 1 }, missionLayer: { flex: 1, backgroundColor: SPACE_CADET.black, zIndex: 2 },
  header: { height: 64, paddingHorizontal: 20, justifyContent: "center" }, backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, backArrow: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 }, pressed: { transform: [{ scale: 0.97 }] }, kicker: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.9, textAlign: "center" },
  readyScreen: { flex: 1, alignItems: "center", paddingHorizontal: 28, paddingTop: 50 }, readyTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 30, textAlign: "center", marginTop: 9 }, readyText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 21, maxWidth: 285, textAlign: "center", marginTop: 12 }, beginPrompt: { marginTop: 25 }, readyRoute: { height: CANVAS_HEIGHT, marginTop: 8, overflow: "visible" },
  briefScreen: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 100 }, briefCaption: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, letterSpacing: 1.5, marginTop: 30 }, directionWord: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 63, letterSpacing: 1.3, marginTop: 8 }, briefText: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 12, letterSpacing: 2.1, textTransform: "uppercase", marginTop: 3 },
  playScreen: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingBottom: 26 }, progress: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.7, marginTop: 37 }, instruction: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 26, textAlign: "center", marginTop: 12, minHeight: 33 }, trajectoryStage: { flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" }, answerGrid: { width: "100%", flexDirection: "row", flexWrap: "wrap", gap: 9 }, answerButton: { width: "31.4%", height: 49, borderRadius: 15, backgroundColor: SPACE_CADET.surface1, alignItems: "center", justifyContent: "center" }, answerText: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 22 }, correctionArea: { width: "100%", alignItems: "center" }, answerReveal: { fontFamily: "Garet-Book", fontSize: 48, lineHeight: 55 }, answerCorrect: { color: SUCCESS }, answerWrong: { color: ERROR }, expectedText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, marginTop: 2, marginBottom: 16 },
  summaryScreen: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 58, paddingBottom: 28 }, summaryTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 30, textAlign: "center", marginTop: 8 }, score: { color: ACCENT, fontFamily: "Garet-Book", fontSize: 76, lineHeight: 88, marginTop: 18 }, scoreCaption: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 16, marginTop: -4 }, statCard: { width: "100%", backgroundColor: SPACE_CADET.surface1, borderRadius: 22, padding: 18, marginTop: 30 }, statLabel: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6, marginBottom: 10 }, statLine: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13, lineHeight: 22 }, statStrong: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 15 }, actions: { width: "100%", gap: 12, marginTop: "auto" }, primaryButton: { width: "100%", minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.white }, primaryText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 16 }, secondaryButton: { width: "100%", minHeight: 52, borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" }, secondaryText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 },
});
