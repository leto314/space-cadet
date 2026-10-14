import { Fragment, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import Svg, { Path, Polygon, Rect } from "react-native-svg";

import { GameSetupShell, PickerSetting } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { buildPuzzle, GLYPHS, levelForIndex, VIEW_SLOTS } from "./cubeNets";

const ACCENT = SPACE_CADET.spatial;
const SUCCESS = "#34D399";
const ERROR = SPACE_CADET.attention;
const INK = SPACE_CADET.white;
const CORRECT_PAUSE_MS = 1100;
const WRONG_PAUSE_MS = 2600;
const OPTION_GAP = 10;
const LEVEL_LABELS = { easy: "EASY", medium: "MEDIUM", hard: "HARD" };
const MODE_LABELS = { fold: "NET → CUBE", refold: "NET → NET", unfold: "CUBE → NET", mixed: "MIXED" };
const MODE_CYCLE = ["fold", "refold", "unfold"];
const QUESTIONS = { fold: "WHICH CUBE DOES THIS NET MAKE?", refold: "WHICH NET MAKES THE SAME CUBE?", unfold: "WHICH NET MAKES THIS CUBE?" };
const FACE_FILLS = ["#1D1D21", "#131316", "#0A0A0C"];
const GLYPH_STROKE = 0.8;

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const neg = (a) => [-a[0], -a[1], -a[2]];
function formatSeconds(ms) { return (ms / 1000).toFixed(1); }

// A flat net: one square per face, each glyph turned clockwise by its quarter turns. One cell can be highlighted.
export function NetView({ net, maxWidth, maxHeight, maxCell = 56, highlight = -1, highlightColor = ACCENT }) {
  const columns = Math.max(...net.cells.map((cell) => cell[0])) + 1;
  const rows = Math.max(...net.cells.map((cell) => cell[1])) + 1;
  const cell = Math.floor(Math.min(maxCell, (maxWidth - 2) / columns, (maxHeight - 2) / rows));
  const scale = (cell * 0.62) / 10;
  return <Svg width={columns * cell + 2} height={rows * cell + 2}>
    {net.cells.map(([x, y], index) => {
      const { glyph, turn } = net.faces[index];
      const angle = (turn * Math.PI) / 2;
      const a = scale * Math.cos(angle); const b = scale * Math.sin(angle);
      const centerX = 1 + x * cell + cell / 2; const centerY = 1 + y * cell + cell / 2;
      return <Fragment key={index}>
        <Rect x={1 + x * cell} y={1 + y * cell} width={cell} height={cell} fill={index === highlight ? highlightColor : SPACE_CADET.surface3} fillOpacity={index === highlight ? 0.3 : 1} stroke={SPACE_CADET.textTertiary} strokeWidth={1} />
        <Path d={GLYPHS[glyph]} stroke={INK} strokeWidth={GLYPH_STROKE} strokeLinecap="round" strokeLinejoin="round" fill="none" transform={`matrix(${a} ${b} ${-b} ${a} ${centerX - 5 * (a - b)} ${centerY - 5 * (b + a)})`} />
      </Fragment>;
    })}
  </Svg>;
}

// A cube seen from one corner (isometric): top, left and right faces, each glyph lying on its face.
export function CubeView({ view, size }) {
  const scale = size / 4.3;
  const linear = (v) => [(v[0] - v[2]) * 0.866 * scale, ((v[0] + v[2]) * 0.5 - v[1]) * scale];
  const project = (v) => { const [x, y] = linear(v); return [size / 2 + x, size / 2 + y]; };
  return <Svg width={size} height={size}>
    {VIEW_SLOTS.map((slot, index) => {
      const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([r, u]) => project(slot.n.map((value, axis) => value + r * slot.r[axis] + u * slot.u[axis])));
      const up = [slot.u, slot.r, neg(slot.u), neg(slot.r)][view[index].turn];
      const right = cross(up, slot.n);
      const margin = 0.68 / 5;
      const [a, b] = linear(right).map((value) => value * margin);
      const [c, d] = linear(neg(up)).map((value) => value * margin);
      const [centerX, centerY] = project(slot.n);
      return <Fragment key={index}>
        <Polygon points={corners.map((corner) => corner.map((value) => value.toFixed(1)).join(",")).join(" ")} fill={FACE_FILLS[index]} stroke={SPACE_CADET.textTertiary} strokeWidth={1} strokeLinejoin="round" />
        <Path d={GLYPHS[view[index].glyph]} stroke={INK} strokeWidth={GLYPH_STROKE} strokeLinecap="round" strokeLinejoin="round" fill="none" transform={`matrix(${a} ${b} ${c} ${d} ${centerX - 5 * (a + c)} ${centerY - 5 * (b + d)})`} />
      </Fragment>;
    })}
  </Svg>;
}

export function CubeNetsGame({ onExit }) {
  const [mode, setMode] = useState("fold");
  const [puzzleCount, setPuzzleCount] = useState(8);
  const [difficulty, setDifficulty] = useState("medium");
  const [phase, setPhase] = useState("preflight");
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [results, setResults] = useState([]);
  const phaseRef = useRef("preflight");
  const settingsRef = useRef(null);
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
  function prepareRun() { settingsRef.current = { mode, puzzleCount, difficulty }; startMission(resetToReady); }
  function showPuzzle(nextIndex) { setIndex(nextIndex); setSelected(null); puzzleStartedAt.current = Date.now(); goTo("question"); }
  function beginRun() {
    void triggerSelectionHaptic();
    const { mode: chosen, puzzleCount: total, difficulty: grade } = settingsRef.current;
    puzzlesRef.current = Array.from({ length: total }, (_, position) => buildPuzzle(chosen === "mixed" ? MODE_CYCLE[position % MODE_CYCLE.length] : chosen, levelForIndex(grade, position, total))).filter(Boolean);
    sessionStartedAt.current = Date.now();
    intervalRef.current = setInterval(() => setElapsed(Date.now() - sessionStartedAt.current), 100);
    showPuzzle(0);
  }
  function answer(optionIndex) {
    if (phaseRef.current !== "question") return;
    const puzzle = puzzlesRef.current[index];
    const correct = optionIndex === puzzle.answerIndex;
    resultsRef.current = [...resultsRef.current, { correct, timeMs: Date.now() - puzzleStartedAt.current, level: puzzle.level, mode: puzzle.mode }];
    setResults(resultsRef.current); setSelected(optionIndex); goTo("feedback");
    void (correct ? triggerSuccessHaptic() : triggerErrorHaptic());
    timeouts.current.push(setTimeout(() => {
      if (index + 1 < puzzlesRef.current.length) showPuzzle(index + 1);
      else { clearInterval(intervalRef.current); intervalRef.current = null; goTo("summary"); }
    }, correct ? CORRECT_PAUSE_MS : WRONG_PAUSE_MS));
  }

  const preflight = <GameSetupShell title="Cube Nets" categoryKey="spatial" onExit={onExit} onStart={prepareRun} rules="Tests mental folding. A cube is shown unfolded, seen from the outside, with a letter or digit on each face. The way each character is turned matters.Net → Cube: Pick the cube this net folds into.Net → Net: Pick the other net that folds into the same cube.Cube → Net: The same cube is shown from three corners. Pick the net that makes it.Easy: Wrong answers put opposite faces side by side.Medium: Some wrong answers have the right faces arranged the other way round.Hard: Some wrong answers differ only by one character turned. Progressive starts easy and ends hard.">
    <PickerSetting label="Mode" hint={mode === "mixed" ? "Alternates between all three" : mode === "fold" ? "Find the folded cube" : mode === "refold" ? "Find the matching net" : "One cube, three views: find its net"} options={["fold", "refold", "unfold", "mixed"].map((value) => ({ value, label: MODE_LABELS[value] }))} value={mode} onChange={setMode} />
    <PickerSetting label="Puzzles" hint="Number of puzzles in the session" options={[5, 8, 12].map((value) => ({ value, label: String(value) }))} value={puzzleCount} onChange={setPuzzleCount} />
    <PickerSetting label="Difficulty" hint={difficulty === "progressive" ? "Starts easy, ends hard" : undefined} options={["easy", "medium", "hard", "progressive"].map((value) => ({ value, label: value.toUpperCase() }))} value={difficulty} onChange={setDifficulty} />
  </GameSetupShell>;

  const settings = settingsRef.current ?? { mode, puzzleCount, difficulty };
  const puzzle = puzzlesRef.current[index];
  const inPuzzle = (phase === "question" || phase === "feedback") && puzzle;
  const lastResult = results.at(-1);
  const correctCount = results.filter((entry) => entry.correct).length;
  const correctTimes = results.filter((entry) => entry.correct).map((entry) => entry.timeMs);
  // Everything fits on one screen (down to an iPhone SE): the net on top, four options in a 2 × 2 grid below.
  const boardWidth = Math.min(width - 40, 340);
  const optionWidth = (boardWidth - OPTION_GAP) / 2;
  const optionHeight = Math.min(optionWidth, height * 0.19);
  const netHeight = Math.min(190, height * 0.23);
  const modeBreakdown = MODE_CYCLE.map((key) => ({ key, entries: results.filter((entry) => entry.mode === key) })).filter((group) => group.entries.length);

  return <View style={styles.container}>
    {phase === "preflight" || isReturning ? <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflight}</Animated.View> : null}
    {phase !== "preflight" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, missionStyle]}>
      <View style={styles.header}><Pressable onPress={returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>

      {phase === "ready" ? <Pressable onPress={beginRun} style={styles.readyScreen}>
        <Text style={styles.kicker}>SPATIAL ORIENTATION</Text>
        <Text style={styles.readyTitle}>Ready to fold the cube?</Text>
        <Text style={styles.readyText}>{settings.mode === "fold" ? "A net is shown from the outside. Pick the cube it folds into." : settings.mode === "refold" ? "A net is shown from the outside. Pick the other net that folds into the same cube." : settings.mode === "unfold" ? "One cube is shown from three different corners. Pick the net that folds into it." : "Net to cube, net to net, then cube to net: the three exercises alternate."}</Text>
        <View style={styles.cueCard}>
          <Text style={styles.cueLabel}>{settings.puzzleCount} PUZZLES · {MODE_LABELS[settings.mode]}</Text>
          <Text style={styles.cueText}>{settings.difficulty === "progressive" ? "Difficulty rises from easy to hard." : `${LEVEL_LABELS[settings.difficulty]} difficulty`}{"\n"}Mind how each character is turned.</Text>
        </View>
        <PulsingPrompt color={ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt>
      </Pressable> : null}

      {inPuzzle ? <Animated.View key={index} entering={FadeIn.duration(180)} style={styles.playScreen}>
        <View style={styles.statusRow}>
          <View><Text style={styles.statusLabel}>PUZZLE</Text><Text style={styles.statusValue}>{index + 1}<Text style={styles.statusTotal}> / {puzzlesRef.current.length}</Text></Text></View>
          <View style={styles.statusRight}><Text style={styles.statusLabel}>TIME</Text><Text style={styles.statusValue}>{formatSeconds(elapsed)}</Text></View>
        </View>
        <View style={styles.board}>
          {settings.difficulty === "progressive" ? <Text style={styles.levelTag}>{LEVEL_LABELS[puzzle.level]}</Text> : null}
          <View style={[styles.netArea, { height: netHeight }]}>{puzzle.views ? <View style={styles.viewRow}>{puzzle.views.map((view, viewIndex) => <CubeView key={viewIndex} view={view} size={Math.min(netHeight, boardWidth / 3)} />)}</View> : <NetView net={puzzle.net} maxWidth={boardWidth} maxHeight={netHeight} />}</View>
          <Text style={[styles.sectionLabel, phase === "feedback" && { color: lastResult?.correct ? SUCCESS : ERROR }]}>{phase === "feedback" ? (lastResult?.correct ? "CORRECT" : "NOT QUITE") : QUESTIONS[puzzle.mode]}</Text>
          <View style={[styles.optionGrid, { width: boardWidth, gap: OPTION_GAP }]}>
            {puzzle.options.map((option, optionIndex) => {
              const state = phase !== "feedback" ? null : optionIndex === puzzle.answerIndex ? "correct" : optionIndex === selected ? "wrong" : null;
              return <Pressable key={optionIndex} disabled={phase !== "question"} onPress={() => answer(optionIndex)} style={({ pressed }) => [styles.option, { width: optionWidth, height: optionHeight }, pressed && styles.optionPressed, state === "correct" && styles.optionCorrect, state === "wrong" && styles.optionWrong]}>
                {option.view ? <CubeView view={option.view} size={Math.min(optionWidth, optionHeight) - 10} /> : <NetView net={option.net} maxWidth={optionWidth - 22} maxHeight={optionHeight - 22} maxCell={40} />}
              </Pressable>;
            })}
          </View>
        </View>
      </Animated.View> : null}

      {phase === "summary" ? <Animated.View entering={FadeIn.duration(180)} style={styles.summaryScreen}>
        <Text style={styles.kicker}>SESSION ENDED</Text>
        <Text style={styles.summaryTitle}>Cubes folded</Text>
        <Text style={styles.summaryScore}>{correctCount}<Text style={styles.summaryScoreTotal}> / {results.length}</Text></Text>
        <Text style={styles.summaryCaption}>correct answers</Text>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>{MODE_LABELS[settings.mode]} · {settings.difficulty.toUpperCase()}</Text>
          <Text style={styles.statLine}>Accuracy <Text style={styles.statStrong}>{results.length ? Math.round((correctCount / results.length) * 100) : 0}%</Text></Text>
          <Text style={styles.statLine}>Average per puzzle <Text style={styles.statStrong}>{results.length ? formatSeconds(results.reduce((sum, entry) => sum + entry.timeMs, 0) / results.length) : "0.0"} s</Text></Text>
          <Text style={styles.statLine}>Fastest correct <Text style={styles.statStrong}>{correctTimes.length ? `${formatSeconds(Math.min(...correctTimes))} s` : "—"}</Text></Text>
          {modeBreakdown.length > 1 ? <Text style={styles.statLine}>By mode <Text style={styles.statStrong}>{modeBreakdown.map(({ key, entries }) => `${MODE_LABELS[key]} ${entries.filter((entry) => entry.correct).length}/${entries.length}`).join(" · ")}</Text></Text> : null}
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
  board: { flex: 1, alignItems: "center", justifyContent: "center" }, levelTag: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.6, marginBottom: 12 }, netArea: { justifyContent: "center" }, viewRow: { flexDirection: "row" },
  sectionLabel: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.7, marginTop: 22, marginBottom: 14, textAlign: "center" },
  optionGrid: { flexDirection: "row", flexWrap: "wrap" }, option: { borderRadius: 18, backgroundColor: SPACE_CADET.surface1, borderWidth: 1, borderColor: SPACE_CADET.borderSubtle, alignItems: "center", justifyContent: "center", overflow: "hidden" }, optionPressed: { borderColor: ACCENT, transform: [{ scale: 0.97 }] }, optionCorrect: { borderColor: SUCCESS, backgroundColor: "#0C2B23" }, optionWrong: { borderColor: ERROR, backgroundColor: "#3D101D" },
  summaryScreen: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 58, paddingBottom: 48 }, summaryTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 31, marginTop: 8 }, summaryScore: { color: ACCENT, fontFamily: "Garet-Book", fontSize: 82, lineHeight: 94, marginTop: 18 }, summaryScoreTotal: { color: SPACE_CADET.textTertiary, fontSize: 36 }, summaryCaption: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 16, textAlign: "center", marginTop: -2 },
  statCard: { width: "100%", backgroundColor: SPACE_CADET.surface1, borderRadius: 22, padding: 18, gap: 10, marginTop: 30 }, statLabel: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6, marginBottom: 4 }, statLine: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13 }, statStrong: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 15 },
  actions: { width: "100%", gap: 12, marginTop: "auto" }, primaryButton: { minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.white }, primaryText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 16 }, secondaryButton: { minHeight: 52, borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" }, secondaryText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 },
});
