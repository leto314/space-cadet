import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import Svg, { Circle, Defs, Path, Pattern, Polygon } from "react-native-svg";

import { ChoiceButton, ChoiceRow, GameSetupShell, PickerSetting, SettingCard } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { randomSeed } from "../../utils/random";
import { buildDailySession, buildSession, dailyResult, DAILY_MATRICES, FILLS, LAYOUTS, range, SHAPES, SIZE_SCALES } from "./logic";

const ACCENT = SPACE_CADET.logic;
const SUCCESS = "#34D399";
const ERROR = SPACE_CADET.attention;
const INK = SPACE_CADET.white;
const CORRECT_PAUSE_MS = 1100;
const WRONG_PAUSE_MS = 2400;
const MATRIX_GAP = 8;
const LEVEL_LABELS = { easy: "EASY", medium: "MEDIUM", hard: "HARD" };

let patternIdCounter = 0;
function usePatternId() {
  const ref = useRef(null);
  if (!ref.current) { patternIdCounter += 1; ref.current = `pm${patternIdCounter}`; }
  return ref.current;
}

function polygonPoints(sides, cx, cy, radius, startDegrees) {
  return range(0, sides - 1).map((index) => {
    const angle = ((startDegrees + (360 / sides) * index) * Math.PI) / 180;
    return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}

// Each shape is nudged so they read as the same visual size (a square's corners reach further than a circle).
function Entity({ shape, fill, cx, cy, radius, strokeWidth, patternId }) {
  const paint = FILLS[fill] === "outline" ? "none" : FILLS[fill] === "solid" ? INK : `url(#${patternId}-${FILLS[fill]})`;
  const common = { fill: paint, stroke: INK, strokeWidth, strokeLinejoin: "round" };
  const name = SHAPES[shape];
  if (name === "circle") return <Circle cx={cx} cy={cy} r={radius * 0.9} {...common} />;
  if (name === "triangle") return <Polygon points={polygonPoints(3, cx, cy + radius * 0.16, radius * 1.04, -90)} {...common} />;
  if (name === "square") return <Polygon points={polygonPoints(4, cx, cy, radius * 1.1, -45)} {...common} />;
  if (name === "pentagon") return <Polygon points={polygonPoints(5, cx, cy + radius * 0.05, radius, -90)} {...common} />;
  return <Polygon points={polygonPoints(6, cx, cy, radius, 0)} {...common} />;
}

function PanelArt({ panel, layoutKey, size }) {
  const patternId = usePatternId();
  const specs = LAYOUTS[layoutKey];
  return <Svg width={size} height={size} viewBox="0 0 100 100">
    <Defs>
      <Pattern id={`${patternId}-dots`} patternUnits="userSpaceOnUse" width="5" height="5"><Circle cx="2.5" cy="2.5" r="0.95" fill={INK} /></Pattern>
      <Pattern id={`${patternId}-hatch`} patternUnits="userSpaceOnUse" width="5" height="5"><Path d="M-1,1 l2,-2 M0,5 l5,-5 M4,6 l2,-2" stroke={INK} strokeWidth="0.9" /></Pattern>
      <Pattern id={`${patternId}-crosshatch`} patternUnits="userSpaceOnUse" width="5" height="5"><Path d="M-1,1 l2,-2 M0,5 l5,-5 M4,6 l2,-2 M-1,4 l2,2 M0,0 l5,5 M4,-1 l2,2" stroke={INK} strokeWidth="0.75" /></Pattern>
    </Defs>
    {panel.components.map((component, ci) => {
      const spec = specs[ci];
      const slots = spec.kind === "grid" ? range(0, spec.slots.length - 1).filter((slot) => component.mask & (1 << slot)) : [0];
      return slots.map((slot) => {
        const [cx, cy, half] = spec.slots[slot];
        return <Entity key={`${ci}-${slot}`} shape={component.shape} fill={component.fill} cx={cx} cy={cy} radius={half * SIZE_SCALES[component.size]} strokeWidth={half >= 30 ? 1.7 : 1.3} patternId={patternId} />;
      });
    })}
  </Svg>;
}

function MatrixBoard({ puzzle, size, reveal }) {
  const cell = (size - MATRIX_GAP * 2) / 3;
  return <View style={[styles.matrix, { width: size, height: size, gap: MATRIX_GAP }]}>
    {[...puzzle.panels, null].map((panel, index) => panel
      ? <View key={index} style={[styles.matrixCell, { width: cell, height: cell }]}><PanelArt panel={panel} layoutKey={puzzle.layoutKey} size={cell} /></View>
      : <View key={index} style={[styles.matrixCell, styles.missingCell, reveal && styles.missingRevealed, { width: cell, height: cell }]}>
        {reveal ? <PanelArt panel={puzzle.answer} layoutKey={puzzle.layoutKey} size={cell} /> : <Text style={styles.missingMark}>?</Text>}
      </View>)}
  </View>;
}

function formatSeconds(ms) { return (ms / 1000).toFixed(1); }

// `daily` ({ seed, onFinish, onExit }) turns this into the daily training version: no preflight, the day's eight
// matrices (DAILY_MATRICES), 125 points each, then onFinish({ score, metrics, trials }).
export function PatternMatrixGame({ onExit, daily = null }) {
  const [puzzleCount, setPuzzleCount] = useState(5);
  const [optionCount, setOptionCount] = useState(4);
  const [difficulty, setDifficulty] = useState("medium");
  const [phase, setPhase] = useState(daily ? "ready" : "preflight");
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [results, setResults] = useState([]);
  const phaseRef = useRef(daily ? "ready" : "preflight");
  const settingsRef = useRef(daily ? { puzzleCount: DAILY_MATRICES.length, optionCount: null, difficulty: "progressive" } : null);
  const puzzlesRef = useRef([]);
  const resultsRef = useRef([]);
  const sessionStartedAt = useRef(0);
  const puzzleStartedAt = useRef(0);
  const intervalRef = useRef(null);
  const timeouts = useRef([]);
  const { width, height } = useWindowDimensions();
  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({ onPrepareReturn: clearTimers, onReturnComplete: resetToPreflight });

  useEffect(() => () => clearTimers(), []);
  function clearTimers() { clearInterval(intervalRef.current); intervalRef.current = null; timeouts.current.forEach(clearTimeout); timeouts.current = []; }
  function goTo(nextPhase) { phaseRef.current = nextPhase; setPhase(nextPhase); }
  function resetToPreflight() { clearTimers(); puzzlesRef.current = []; setResults([]); goTo("preflight"); }
  function resetToReady() { clearTimers(); resultsRef.current = []; setResults([]); setIndex(0); setSelected(null); setElapsed(0); goTo("ready"); }
  function prepareRun() { settingsRef.current = { puzzleCount, optionCount, difficulty }; startMission(resetToReady); }
  function showPuzzle(nextIndex) { setIndex(nextIndex); setSelected(null); puzzleStartedAt.current = Date.now(); goTo("question"); }
  function beginRun() {
    void triggerSelectionHaptic();
    puzzlesRef.current = daily ? buildDailySession(daily.seed) : buildSession(settingsRef.current, randomSeed());
    sessionStartedAt.current = Date.now();
    intervalRef.current = setInterval(() => setElapsed(Date.now() - sessionStartedAt.current), 100);
    showPuzzle(0);
  }
  function answer(optionIndex) {
    if (phaseRef.current !== "question") return;
    const puzzle = puzzlesRef.current[index];
    const correct = optionIndex === puzzle.answerIndex;
    resultsRef.current = [...resultsRef.current, { correct, timeMs: Date.now() - puzzleStartedAt.current, level: puzzle.level, layout: puzzle.layoutKey, optionCount: puzzle.options.length }];
    setResults(resultsRef.current); setSelected(optionIndex); goTo("feedback");
    void (correct ? triggerSuccessHaptic() : triggerErrorHaptic());
    timeouts.current.push(setTimeout(() => {
      if (index + 1 < puzzlesRef.current.length) showPuzzle(index + 1);
      else { clearInterval(intervalRef.current); intervalRef.current = null; if (daily) finishDaily(); else goTo("summary"); }
    }, correct ? CORRECT_PAUSE_MS : WRONG_PAUSE_MS));
  }
  function finishDaily() { daily.onFinish(dailyResult(resultsRef.current)); }

  const preflight = <GameSetupShell title="Pattern Matrix" categoryKey="logic" onExit={onExit} onStart={prepareRun} rules="Tests abstract reasoning. Along each row of the matrix, shapes, sizes, fills, counts or positions change according to hidden rules. Work out the rules and pick the panel that completes the matrix.Easy: A single attribute changes along each row.Medium: Two rules at once, with split and nested layouts.Hard: Three rules at once, including additions and overlays. Progressive starts easy and ends hard.">
    <PickerSetting label="Matrices" hint="Number of matrices in the session" options={[3, 5, 8].map((value) => ({ value, label: String(value) }))} value={puzzleCount} onChange={setPuzzleCount} />
    <SettingCard label="Options" hint="Answer panels to choose from">
      <ChoiceRow>{[4, 6].map((value) => <ChoiceButton key={value} label={String(value)} selected={optionCount === value} accent={ACCENT} onPress={() => setOptionCount(value)} />)}</ChoiceRow>
    </SettingCard>
    <PickerSetting label="Difficulty" hint={difficulty === "progressive" ? "Starts easy, ends hard" : undefined} options={["easy", "medium", "hard", "progressive"].map((value) => ({ value, label: value.toUpperCase() }))} value={difficulty} onChange={setDifficulty} />
  </GameSetupShell>;

  const settings = settingsRef.current ?? { puzzleCount, optionCount, difficulty };
  const puzzle = puzzlesRef.current[index];
  const inPuzzle = (phase === "question" || phase === "feedback") && puzzle;
  const lastResult = results.at(-1);
  const correctCount = results.filter((entry) => entry.correct).length;
  const correctTimes = results.filter((entry) => entry.correct).map((entry) => entry.timeMs);
  const optionColumns = puzzle?.options.length === 6 ? 3 : 4;
  // Six options take two rows, so the matrix gives up some height to keep everything on screen (down to an iPhone SE).
  const matrixSize = Math.min(width - 40, 340, height * (optionColumns === 3 ? 0.37 : 0.42));
  const optionSize = (matrixSize - MATRIX_GAP * (optionColumns - 1)) / optionColumns;
  const levelBreakdown = ["easy", "medium", "hard"].map((level) => ({ level, entries: results.filter((entry) => entry.level === level) })).filter((group) => group.entries.length);

  return <View style={styles.container}>
    {phase === "preflight" || isReturning ? <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflight}</Animated.View> : null}
    {phase !== "preflight" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, !daily && missionStyle]}>
      <View style={styles.header}><Pressable onPress={daily ? daily.onExit : returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>

      {phase === "ready" ? <Pressable onPress={beginRun} style={styles.readyScreen}>
        <Text style={styles.kicker}>{daily ? "DAILY TRAINING" : "LOGIC"}</Text>
        <Text style={styles.readyTitle}>Ready to find the pattern?</Text>
        <Text style={styles.readyText}>Each row follows hidden rules. Pick the panel that completes the matrix.</Text>
        <View style={styles.cueCard}>
          <Text style={styles.cueLabel}>{settings.puzzleCount} MATRICES · {daily ? "4 THEN 6 OPTIONS" : `${settings.optionCount} OPTIONS`}</Text>
          <Text style={styles.cueText}>{daily ? "Three easy, three medium, then two hard matrices; the options grow from four to six." : settings.difficulty === "progressive" ? "Difficulty rises from easy to hard." : `${LEVEL_LABELS[settings.difficulty]} difficulty`}</Text>
        </View>
        <PulsingPrompt color={ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt>
      </Pressable> : null}

      {inPuzzle ? <Animated.View key={index} entering={FadeIn.duration(180)} style={styles.playScreen}>
        <View style={styles.statusRow}>
          <View><Text style={styles.statusLabel}>MATRIX</Text><Text style={styles.statusValue}>{index + 1}<Text style={styles.statusTotal}> / {puzzlesRef.current.length}</Text></Text></View>
          <View style={styles.statusRight}><Text style={styles.statusLabel}>TIME</Text><Text style={styles.statusValue}>{formatSeconds(elapsed)}</Text></View>
        </View>
        <View style={styles.board}>
          {settings.difficulty === "progressive" ? <Text style={styles.levelTag}>{LEVEL_LABELS[puzzle.level]}</Text> : null}
          <MatrixBoard puzzle={puzzle} size={matrixSize} reveal={phase === "feedback"} />
          <Text style={[styles.sectionLabel, phase === "feedback" && { color: lastResult?.correct ? SUCCESS : ERROR }]}>{phase === "feedback" ? (lastResult?.correct ? "CORRECT" : "NOT QUITE") : "SELECT THE MISSING PANEL"}</Text>
          <View style={[styles.optionGrid, { width: matrixSize, gap: MATRIX_GAP }]}>
            {puzzle.options.map((option, optionIndex) => {
              const state = phase !== "feedback" ? null : optionIndex === puzzle.answerIndex ? "correct" : optionIndex === selected ? "wrong" : null;
              return <Pressable key={optionIndex} disabled={phase !== "question"} onPress={() => answer(optionIndex)} style={({ pressed }) => [styles.option, { width: optionSize, height: optionSize }, pressed && styles.optionPressed, state === "correct" && styles.optionCorrect, state === "wrong" && styles.optionWrong]}>
                <PanelArt panel={option} layoutKey={puzzle.layoutKey} size={optionSize - 2} />
              </Pressable>;
            })}
          </View>
        </View>
      </Animated.View> : null}

      {phase === "summary" ? <Animated.View entering={FadeIn.duration(180)} style={styles.summaryScreen}>
        <Text style={styles.kicker}>SESSION ENDED</Text>
        <Text style={styles.summaryTitle}>Matrices complete</Text>
        <Text style={styles.summaryScore}>{correctCount}<Text style={styles.summaryScoreTotal}> / {results.length}</Text></Text>
        <Text style={styles.summaryCaption}>correct answers</Text>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>{settings.difficulty.toUpperCase()} · {settings.optionCount} OPTIONS</Text>
          <Text style={styles.statLine}>Accuracy <Text style={styles.statStrong}>{results.length ? Math.round((correctCount / results.length) * 100) : 0}%</Text></Text>
          <Text style={styles.statLine}>Average per matrix <Text style={styles.statStrong}>{results.length ? formatSeconds(results.reduce((sum, entry) => sum + entry.timeMs, 0) / results.length) : "0.0"} s</Text></Text>
          <Text style={styles.statLine}>Fastest correct <Text style={styles.statStrong}>{correctTimes.length ? `${formatSeconds(Math.min(...correctTimes))} s` : "—"}</Text></Text>
          {settings.difficulty === "progressive" ? <Text style={styles.statLine}>By level <Text style={styles.statStrong}>{levelBreakdown.map(({ level, entries }) => `${LEVEL_LABELS[level].charAt(0)}${LEVEL_LABELS[level].slice(1).toLowerCase()} ${entries.filter((entry) => entry.correct).length}/${entries.length}`).join(" · ")}</Text></Text> : null}
        </View>
        <View style={styles.actions}>
          <TouchableOpacity activeOpacity={0.88} onPress={resetToReady} style={styles.primaryButton}><Text style={styles.primaryText}>Play again</Text></TouchableOpacity>
          <TouchableOpacity activeOpacity={0.88} onPress={returnToPreflight} style={styles.secondaryButton}><Text style={styles.secondaryText}>Change settings</Text></TouchableOpacity>
        </View>
      </Animated.View> : null}
    </Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SPACE_CADET.black }, preflightLayer: { ...StyleSheet.absoluteFill, zIndex: 1 }, missionLayer: { flex: 1, backgroundColor: SPACE_CADET.black, zIndex: 2 },
  header: { height: 64, paddingHorizontal: 20, justifyContent: "center" }, backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, backArrow: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 }, pressed: { transform: [{ scale: 0.97 }] },
  kicker: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.9, textAlign: "center" },
  readyScreen: { flex: 1, alignItems: "center", paddingHorizontal: 28, paddingTop: 54 }, readyTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 30, marginTop: 9, textAlign: "center" }, readyText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 21, maxWidth: 300, textAlign: "center", marginTop: 12 },
  cueCard: { width: "100%", borderRadius: 22, paddingVertical: 22, paddingHorizontal: 22, alignItems: "center", backgroundColor: SPACE_CADET.surface1, marginTop: 52 }, cueLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6 }, cueText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 12 },
  beginPrompt: { marginTop: 48, textAlign: "center" },
  playScreen: { flex: 1, paddingHorizontal: 20, paddingBottom: 48 }, statusRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 16 }, statusRight: { alignItems: "flex-end" }, statusLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.5 }, statusValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 28, marginTop: 3 }, statusTotal: { color: SPACE_CADET.textTertiary, fontSize: 18 },
  board: { flex: 1, alignItems: "center", justifyContent: "center" }, levelTag: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.6, marginBottom: 12 },
  matrix: { flexDirection: "row", flexWrap: "wrap" }, matrixCell: { borderRadius: 14, backgroundColor: SPACE_CADET.surface1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  missingCell: { backgroundColor: "transparent", borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(94,235,235,0.55)" }, missingRevealed: { borderStyle: "solid", borderColor: ACCENT, backgroundColor: "#0C2626" }, missingMark: { color: ACCENT, fontFamily: "Gontserrat-Light", fontSize: 34 },
  sectionLabel: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.7, marginTop: 24, marginBottom: 14, textAlign: "center" },
  optionGrid: { flexDirection: "row", flexWrap: "wrap" }, option: { borderRadius: 14, backgroundColor: SPACE_CADET.surface1, borderWidth: 1, borderColor: SPACE_CADET.borderSubtle, alignItems: "center", justifyContent: "center", overflow: "hidden" }, optionPressed: { borderColor: ACCENT, transform: [{ scale: 0.97 }] }, optionCorrect: { borderColor: SUCCESS, backgroundColor: "#0C2B23" }, optionWrong: { borderColor: ERROR, backgroundColor: "#3D101D" },
  summaryScreen: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 58, paddingBottom: 48 }, summaryTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 31, marginTop: 8 }, summaryScore: { color: ACCENT, fontFamily: "Garet-Book", fontSize: 82, lineHeight: 94, marginTop: 18 }, summaryScoreTotal: { color: SPACE_CADET.textTertiary, fontSize: 36 }, summaryCaption: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 16, textAlign: "center", marginTop: -2 },
  statCard: { width: "100%", backgroundColor: SPACE_CADET.surface1, borderRadius: 22, padding: 18, gap: 10, marginTop: 30 }, statLabel: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6, marginBottom: 4 }, statLine: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13 }, statStrong: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 15 },
  actions: { width: "100%", gap: 12, marginTop: "auto" }, primaryButton: { minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.white }, primaryText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 16 }, secondaryButton: { minHeight: 52, borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" }, secondaryText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 },
});
