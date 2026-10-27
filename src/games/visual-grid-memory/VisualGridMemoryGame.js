import { useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { ChoiceButton, ChoiceRow, GameSetupShell, PickerSetting, SettingCard } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { randomSeed } from "../../utils/random";
import { buildDailyLadders, buildRound, DAILY_START_TARGETS, dailyResult, DISTRACTION_BLANK_MS, DISTRACTION_FLASH_MS, maxTargetsForGrid } from "./logic";

const ACCENT = SPACE_CADET.memory;
const SUCCESS = "#34D399";
const ERROR = SPACE_CADET.attention;
const GRID_GAP = 8;
function RotationArrow({ clockwise }) {
  return <Image source={require("./arrow_rot.png")} resizeMode="contain" style={[styles.rotationIcon, !clockwise && styles.rotationIconReverse]} />;
}

function MemoryGrid({ size, activeCells = [], selectedCells = [], targets = [], ordered, rotation = 0, feedback, disabled, onSelect, preview = false, stageStyle }) {
  const { width } = useWindowDimensions();
  const gridWidth = Math.min(width - 72, size === 4 ? 292 : size === 5 ? 308 : 320);
  const cellSize = (gridWidth - GRID_GAP * (size - 1)) / size;
  return <View style={[styles.gridStage, stageStyle]}><View style={[styles.grid, { width: gridWidth, height: gridWidth, gap: GRID_GAP, transform: [{ rotate: `${rotation}deg` }] }]}>
    {Array.from({ length: size * size }, (_, index) => {
      const isActive = activeCells.includes(index);
      const isSelected = selectedCells.includes(index);
      const isWrong = feedback === "error" && isSelected && !targets.includes(index);
      const isCorrectReveal = feedback === "error" && targets.includes(index) && !isSelected;
      return <TouchableOpacity key={index} activeOpacity={0.84} disabled={disabled} onPress={() => onSelect?.(index)} style={[styles.gridCell, { width: cellSize, height: cellSize }, isActive && styles.activeCell, isSelected && styles.selectedCell, feedback === "success" && isSelected && styles.successCell, isWrong && styles.wrongCell, isCorrectReveal && styles.correctRevealCell, preview && isActive && styles.previewActiveCell]}>
        {ordered && isActive ? <Text style={styles.cellOrder}>{activeCells.indexOf(index) + 1}</Text> : null}
        {ordered && !isActive && isSelected ? <Text style={styles.cellOrder}>{selectedCells.indexOf(index) + 1}</Text> : null}
      </TouchableOpacity>;
    })}
  </View></View>;
}

// `daily` ({ seed, onFinish, onExit }) turns this into the daily training version: no preflight, the day's three
// ladders (a plain 4 x 4, then two harder ones drawn from the seed), each climbing from three cells until a
// mistake, then onFinish({ score, metrics, trials }).
export function VisualGridMemoryGame({ onExit, daily = null }) {
  const [gridSize, setGridSize] = useState(4);
  const [displaySeconds, setDisplaySeconds] = useState(3);
  const [rotateBeforeRecall, setRotateBeforeRecall] = useState(false);
  const [orderedRecall, setOrderedRecall] = useState(false);
  const [distraction, setDistraction] = useState(false);
  const [phase, setPhase] = useState(daily ? "ready" : "preflight");
  const [ladderIndex, setLadderIndex] = useState(0);
  const [roundTargets, setRoundTargets] = useState(daily ? DAILY_START_TARGETS : 1);
  const [targets, setTargets] = useState([]);
  const [decoyTargets, setDecoyTargets] = useState([]);
  const [selectedCells, setSelectedCells] = useState([]);
  const [displayRemaining, setDisplayRemaining] = useState(0);
  const [gridRotation, setGridRotation] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [highestSuccessful, setHighestSuccessful] = useState(0);
  const [readyPreviewCell, setReadyPreviewCell] = useState(5);
  const timeoutsRef = useRef([]);
  const intervalRef = useRef(null);
  const targetsRef = useRef([]);
  const laddersRef = useRef(daily ? buildDailyLadders(daily.seed) : []);
  const settingsRef = useRef(daily ? laddersRef.current[0] : null);
  const phaseRef = useRef(daily ? "ready" : "preflight");
  const spansRef = useRef([]);
  const rotationRef = useRef(0);
  const framesRef = useRef(null);
  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({ onPrepareReturn: clearTimers, onReturnComplete: resetToPreflight });

  const ladder = daily ? laddersRef.current[ladderIndex] : null;

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => () => clearTimers(), []);
  function clearTimers() { clearInterval(intervalRef.current); intervalRef.current = null; timeoutsRef.current.forEach(clearTimeout); timeoutsRef.current = []; }
  function queue(callback, delay) { const timeoutId = setTimeout(callback, delay); timeoutsRef.current.push(timeoutId); }
  function resetToPreflight() { clearTimers(); setTargets([]); setDecoyTargets([]); setSelectedCells([]); setFeedback(null); setGridRotation(0); setHighestSuccessful(0); setPhase("preflight"); }
  function resetToReady() { clearTimers(); setTargets([]); setDecoyTargets([]); setSelectedCells([]); setFeedback(null); setGridRotation(0); setHighestSuccessful(0); setReadyPreviewCell(buildRound({ gridSize, targetCount: 1, rotateBeforeRecall: false }, randomSeed()).targets[0]); setPhase("ready"); }
  function prepareRun() { void triggerSelectionHaptic(); startMission(resetToReady); }
  function beginAnswer() { clearInterval(intervalRef.current); intervalRef.current = null; setDisplayRemaining(0); setDecoyTargets([]); setGridRotation(rotationRef.current); setPhase("answer"); }
  function runDistraction() {
    const frames = framesRef.current;
    setPhase("distraction-blank");
    queue(() => { setPhase("distraction-flash"); setDecoyTargets(frames[0]); queue(() => { setDecoyTargets(frames[1]); queue(() => { setDecoyTargets(frames[2]); queue(beginAnswer, DISTRACTION_FLASH_MS); }, DISTRACTION_FLASH_MS); }, DISTRACTION_FLASH_MS); }, DISTRACTION_BLANK_MS);
  }
  function beginMemorize(targetCount) {
    const settings = settingsRef.current;
    const round = daily
      ? laddersRef.current[ladderIndex].rounds[targetCount - DAILY_START_TARGETS]
      : buildRound({ gridSize: settings.gridSize, targetCount, rotateBeforeRecall: settings.rotateBeforeRecall, distraction: settings.distraction }, randomSeed());
    clearTimers(); targetsRef.current = round.targets; rotationRef.current = round.rotation; framesRef.current = round.frames; setTargets(round.targets); setDecoyTargets([]); setSelectedCells([]); setRoundTargets(targetCount); setGridRotation(0); setFeedback(null); setDisplayRemaining(settings.displaySeconds); setPhase("memorize");
    intervalRef.current = setInterval(() => setDisplayRemaining((current) => Math.max(0, current - 1)), 1000);
    queue(() => settings.distraction ? runDistraction() : beginAnswer(), settings.displaySeconds * 1000);
  }
  function beginRun() {
    void triggerSelectionHaptic();
    settingsRef.current = daily ? laddersRef.current[ladderIndex] : { gridSize, displaySeconds, rotateBeforeRecall, orderedRecall, distraction };
    setHighestSuccessful(0);
    beginMemorize(daily ? DAILY_START_TARGETS : 1);
  }
  // End of a ladder (a mistake, or the longest pattern recalled): the next ladder, or the day's result.
  function endLadder(span) {
    clearTimers();
    if (!daily) { setPhase("summary"); return; }
    spansRef.current = [...spansRef.current, { ladder: laddersRef.current[ladderIndex], span }];
    if (ladderIndex + 1 < laddersRef.current.length) { setLadderIndex(ladderIndex + 1); settingsRef.current = laddersRef.current[ladderIndex + 1]; setTargets([]); setSelectedCells([]); setFeedback(null); setGridRotation(0); setHighestSuccessful(0); setPhase("ready"); return; }
    daily.onFinish(dailyResult(spansRef.current));
  }
  function markFailure(index) { void triggerErrorHaptic(); setSelectedCells((current) => [...current, index]); setFeedback("error"); queue(() => endLadder(highestSuccessful), 900); }
  function markSuccess() {
    void triggerSuccessHaptic(); setFeedback("success"); setHighestSuccessful(roundTargets);
    queue(() => {
      const maximum = daily ? DAILY_START_TARGETS + laddersRef.current[ladderIndex].rounds.length - 1 : maxTargetsForGrid(settingsRef.current.gridSize);
      if (roundTargets >= maximum) endLadder(roundTargets);
      else beginMemorize(roundTargets + 1);
    }, 560);
  }
  function handleAnswerSelection(index, earlyStart = false) {
    if (phaseRef.current === "memorize" && earlyStart) {
      const expectedFirst = settingsRef.current.orderedRecall ? targetsRef.current[0] : null;
      if (settingsRef.current.orderedRecall ? index !== expectedFirst : !targetsRef.current.includes(index)) return;
      clearTimers(); setSelectedCells([index]); setGridRotation(rotationRef.current); setPhase("answer");
      if (targetsRef.current.length === 1) markSuccess(); else void triggerSelectionHaptic();
      return;
    }
    if (phaseRef.current !== "answer" || feedback || selectedCells.includes(index)) return;
    const correct = settingsRef.current.orderedRecall ? targetsRef.current[selectedCells.length] === index : targetsRef.current.includes(index);
    if (!correct) { markFailure(index); return; }
    const nextSelected = [...selectedCells, index]; setSelectedCells(nextSelected);
    if (nextSelected.length === targetsRef.current.length) markSuccess(); else void triggerSelectionHaptic();
  }

  const maxTargets = maxTargetsForGrid(gridSize);
  const displayedTargets = phase === "memorize" ? targets : phase === "distraction-flash" ? decoyTargets : [];
  const earlyStart = phase === "memorize" && !settingsRef.current?.distraction;
  const phaseCopy = phase === "memorize" ? "Memorize the pattern." : phase === "distraction-blank" ? "Hold the pattern in mind." : phase === "distraction-flash" ? "Ignore the interference." : settingsRef.current?.orderedRecall ? "Recall the pattern in its original order." : "Recall every highlighted cell.";
  const preflight = <GameSetupShell title="Visual Memory" categoryKey="memory" onExit={onExit} onStart={prepareRun} rules="Tests visual working memory. Memorize the highlighted cells, then find them again on the empty grid. Add visual distractions for a harder challenge."><PickerSetting label="Grid size" hint={`Up to ${maxTargets} cells in a perfect run`} options={[4, 5, 6].map((value) => ({ value, label: `${value} × ${value}` }))} value={gridSize} onChange={setGridSize} /><PickerSetting label="Display time" hint="In seconds" options={[2, 3, 4, 5].map((value) => ({ value, label: String(value) }))} value={displaySeconds} onChange={setDisplaySeconds} /><SettingCard label="Modifiers"><ChoiceRow><ChoiceButton compact label="ROTATION" selected={rotateBeforeRecall} onPress={() => { void triggerSelectionHaptic(); setRotateBeforeRecall((current) => !current); }} accent={ACCENT} /><ChoiceButton compact label="ORDER" selected={orderedRecall} onPress={() => { void triggerSelectionHaptic(); setOrderedRecall((current) => !current); }} accent={ACCENT} /><ChoiceButton compact label="DISTRACTION" selected={distraction} onPress={() => { void triggerSelectionHaptic(); setDistraction((current) => !current); }} accent={ACCENT} /></ChoiceRow></SettingCard></GameSetupShell>;

  return <View style={styles.container}>
    {phase === "preflight" || isReturning ? <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflight}</Animated.View> : null}
    {phase !== "preflight" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, !daily && missionStyle]}>
      <View style={styles.header}><Pressable onPress={daily ? daily.onExit : returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>
      {phase === "ready" ? <Pressable onPress={beginRun} style={styles.readyScreen}><Text style={styles.kicker}>{daily ? `DAILY TRAINING · LADDER ${ladderIndex + 1} / ${laddersRef.current.length} · ${ladder.label}` : "VISUAL MEMORY"}</Text><Text style={styles.readyTitle}>Ready to map the pattern?</Text><Text style={styles.readyText}>{daily ? `${ladder.gridSize} × ${ladder.gridSize} grid, from ${DAILY_START_TARGETS} cells up: one more cell each time you get it right, until a mistake.${ladder.rotateBeforeRecall ? " The grid turns a quarter before recall." : ladder.orderedRecall ? " Recall the cells in their original order." : ladder.distraction ? " Decoy patterns flash before recall: ignore them." : ""}` : "The highlighted cells will disappear. Find them again from memory."}</Text><PulsingPrompt color={ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt><MemoryGrid size={daily ? ladder.gridSize : gridSize} activeCells={[readyPreviewCell]} preview disabled stageStyle={styles.fixedGridStage} /></Pressable> : null}
      {["memorize", "distraction-blank", "distraction-flash", "answer"].includes(phase) ? <Animated.View entering={FadeIn.duration(170)} style={styles.playScreen}><Text style={styles.phaseText}>{phaseCopy}</Text>{phase === "memorize" ? <Text style={styles.countdown}>{displayRemaining}</Text> : null}{daily ? <Text style={styles.rotationNote}>LADDER {ladderIndex + 1} / {laddersRef.current.length} · {roundTargets} CELLS</Text> : null}{phase === "answer" && gridRotation ? <View style={styles.rotationCue}><Text style={styles.rotationNote}>GRID ROTATED 90° {gridRotation === 90 ? "CLOCKWISE" : "COUNTERCLOCKWISE"}</Text><RotationArrow clockwise={gridRotation === 90} /></View> : null}<MemoryGrid size={settingsRef.current?.gridSize ?? gridSize} activeCells={displayedTargets} selectedCells={selectedCells} targets={targets} ordered={settingsRef.current?.orderedRecall} rotation={gridRotation} feedback={feedback} disabled={phase !== "answer" && !earlyStart} onSelect={(index) => handleAnswerSelection(index, earlyStart)} stageStyle={styles.fixedGridStage} /></Animated.View> : null}
      {phase === "summary" ? <Animated.View entering={FadeIn.duration(180)} style={styles.summaryScreen}><Text style={styles.kicker}>SESSION ENDED</Text><Text style={styles.summaryTitle}>Pattern complete</Text><Text style={styles.summaryScore}>{highestSuccessful}</Text><Text style={styles.summaryCaption}>cells recalled in your best round</Text><View style={styles.statCard}><Text style={styles.statLabel}>BEST ROUND</Text><Text style={styles.statValue}>{highestSuccessful} / {maxTargetsForGrid(settingsRef.current?.gridSize ?? gridSize)}</Text><Text style={styles.statLine}>Final round <Text style={styles.statStrong}>{roundTargets} cells</Text></Text></View><View style={styles.actions}><TouchableOpacity activeOpacity={0.88} onPress={resetToReady} style={styles.primaryButton}><Text style={styles.primaryText}>Play again</Text></TouchableOpacity><TouchableOpacity activeOpacity={0.88} onPress={returnToPreflight} style={styles.secondaryButton}><Text style={styles.secondaryText}>Change settings</Text></TouchableOpacity></View></Animated.View> : null}
    </Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SPACE_CADET.black }, preflightLayer: { ...StyleSheet.absoluteFill, zIndex: 1 }, missionLayer: { flex: 1, backgroundColor: SPACE_CADET.black, zIndex: 2 },
  header: { height: 64, paddingHorizontal: 20, justifyContent: "center" }, backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, backArrow: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 }, pressed: { transform: [{ scale: 0.97 }] },
  kicker: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.9, textAlign: "center" },
  readyScreen: { flex: 1, alignItems: "center", paddingHorizontal: 28, paddingTop: 38 }, readyTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 30, marginTop: 9, textAlign: "center" }, readyText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 21, maxWidth: 296, textAlign: "center", marginTop: 12 }, beginPrompt: { marginTop: 22, textAlign: "center" },
  playScreen: { flex: 1, alignItems: "center", paddingHorizontal: 28, paddingBottom: 28, paddingTop: 38 }, phaseText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 25, lineHeight: 32, textAlign: "center", minHeight: 32, paddingHorizontal: 8 }, countdown: { color: ACCENT, fontFamily: "Garet-Book", fontSize: 27, lineHeight: 32, marginTop: 4 }, rotationCue: { alignItems: "center", marginTop: 28 }, rotationNote: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.35 }, rotationIcon: { width: 58, height: 58, marginTop: 16, tintColor: ACCENT }, rotationIconReverse: { transform: [{ scaleX: -1 }] },
  gridStage: { flex: 1, alignItems: "center", justifyContent: "center", overflow: "visible" }, fixedGridStage: { position: "absolute", top: 210, right: 0, left: 0, flex: 0 }, grid: { flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", overflow: "visible" }, gridCell: { borderRadius: 14, backgroundColor: SPACE_CADET.surface1, borderWidth: 1, borderColor: "transparent", alignItems: "center", justifyContent: "center", zIndex: 1 }, activeCell: { backgroundColor: "#22330D", borderColor: ACCENT, shadowColor: ACCENT, shadowOpacity: 0.38, shadowRadius: 16, shadowOffset: { width: 0, height: 0 }, elevation: 8, zIndex: 2 }, previewActiveCell: { shadowOpacity: 0.25 }, selectedCell: { backgroundColor: "#263A0E", borderColor: ACCENT, zIndex: 2 }, successCell: { backgroundColor: "#12382B", borderColor: SUCCESS, shadowColor: SUCCESS, shadowOpacity: 0.35, shadowRadius: 15, shadowOffset: { width: 0, height: 0 }, elevation: 8 }, wrongCell: { backgroundColor: "#3D101D", borderColor: ERROR, shadowColor: ERROR, shadowOpacity: 0.35, shadowRadius: 15, shadowOffset: { width: 0, height: 0 }, elevation: 8 }, correctRevealCell: { backgroundColor: "#12382B", borderColor: SUCCESS }, cellOrder: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 18 },
  summaryScreen: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 58, paddingBottom: 28 }, summaryTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 31, marginTop: 8 }, summaryScore: { color: ACCENT, fontFamily: "Garet-Book", fontSize: 82, lineHeight: 94, marginTop: 18 }, summaryCaption: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 16, textAlign: "center", marginTop: -2 }, statCard: { width: "100%", backgroundColor: SPACE_CADET.surface1, borderRadius: 22, padding: 18, marginTop: 30 }, statLabel: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6 }, statValue: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 28, marginTop: 7, marginBottom: 10 }, statLine: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13 }, statStrong: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 15 }, actions: { width: "100%", gap: 12, marginTop: "auto" }, primaryButton: { minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.white }, primaryText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 16 }, secondaryButton: { minHeight: 52, borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" }, secondaryText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 },
});
