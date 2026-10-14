import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import Animated, { FadeIn } from "react-native-reanimated";

import { GameSetupShell, PickerSetting } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerSelectionHaptic } from "../../utils/haptics";

const SIGNAL_GREEN = "#34D399";
const SIGNAL_RED = SPACE_CADET.attention;
const difficultyOptions = [
  { key: "easy", label: "EASY", panelCount: 1, targetColor: "green" },
  { key: "medium", label: "MEDIUM", panelCount: 1, targetColor: "green" },
  { key: "hard", label: "HARD", panelCount: 4, targetColor: "green" },
];

const initialStats = {
  targetsShown: 0,
  hits: 0,
  greenShown: 0,
  redShown: 0,
  falseStarts: 0,
  wrongTaps: 0,
  misses: 0,
  reactionTimes: [],
};

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function randomDelay() {
  return 1000 + Math.floor(Math.random() * 4001);
}

function emptyPanels(count) {
  return Array.from({ length: count }, () => null);
}

function createTargetTrial(panelCount, targetColor, decoyColor = null) {
  const panels = emptyPanels(panelCount);
  const targetSlot = Math.floor(Math.random() * panelCount);
  panels[targetSlot] = targetColor;

  if (decoyColor && panelCount > 1) {
    const candidates = panels.map((_, index) => index).filter((index) => index !== targetSlot);
    panels[candidates[Math.floor(Math.random() * candidates.length)]] = decoyColor;
  }

  return { panels, targetSlot };
}

function createColorOnlyTrial(panelCount, color) {
  const panels = emptyPanels(panelCount);
  panels[Math.floor(Math.random() * panelCount)] = color;
  return { panels, targetSlot: null };
}

function buildCueSequence(difficulty, roundCount) {
  if (difficulty.key === "easy") {
    return Array.from({ length: roundCount }, () => createTargetTrial(1, "green"));
  }

  const targetCount = Math.max(1, Math.round(roundCount * 0.6));
  const distractorCount = roundCount - targetCount;

  if (difficulty.key === "medium") {
    return shuffle([
      ...Array.from({ length: targetCount }, () => createTargetTrial(1, "green")),
      ...Array.from({ length: distractorCount }, () => createColorOnlyTrial(1, "red")),
    ]);
  }

  return shuffle([
    ...Array.from({ length: targetCount }, () => createTargetTrial(4, "green", Math.random() > 0.4 ? "red" : null)),
    ...Array.from({ length: distractorCount }, () => createColorOnlyTrial(4, "red")),
  ]);
}

function getSummary(stats) {
  const average = stats.reactionTimes.length
    ? Math.round(stats.reactionTimes.reduce((sum, value) => sum + value, 0) / stats.reactionTimes.length)
    : null;

  return { ...stats, average, best: stats.reactionTimes.length ? Math.min(...stats.reactionTimes) : null };
}

function getPanelColor(signal) {
  return signal === "green" ? SIGNAL_GREEN : signal === "red" ? SIGNAL_RED : null;
}

export function ReactionTimeGame({ onExit }) {
  const [selectedDifficulty, setSelectedDifficulty] = useState(difficultyOptions[0]);
  const [roundCount, setRoundCount] = useState(10);
  const [phase, setPhase] = useState("difficulty");
  const [activeCue, setActiveCue] = useState(null);
  const [statusText, setStatusText] = useState("");
  const [stats, setStats] = useState(initialStats);
  const [summary, setSummary] = useState(null);

  const timeouts = useRef([]);
  const cueStartRef = useRef(null);
  const cueSequenceRef = useRef([]);
  const cueIndexRef = useRef(0);
  const statsRef = useRef(initialStats);
  const activeCueRef = useRef(null);

  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({
    onPrepareReturn: clearAllTimeouts,
    onReturnComplete: () => resetRun(null),
  });

  useEffect(() => () => timeouts.current.forEach(clearTimeout), []);

  function clearAllTimeouts() {
    timeouts.current.forEach(clearTimeout);
    timeouts.current = [];
  }

  function setCue(cue) {
    activeCueRef.current = cue;
    setActiveCue(cue);
  }

  function commitStats(updater) {
    const next = updater(statsRef.current);
    statsRef.current = next;
    setStats(next);
    return next;
  }

  function resetRun(nextDifficulty = selectedDifficulty) {
    clearAllTimeouts();
    setSelectedDifficulty(nextDifficulty ?? selectedDifficulty);
    setCue(null);
    setStatusText("");
    setSummary(null);
    cueStartRef.current = null;
    cueSequenceRef.current = [];
    cueIndexRef.current = 0;
    statsRef.current = initialStats;
    setStats(initialStats);
    setPhase(nextDifficulty ? "ready" : "difficulty");
  }

  function finishRun(finalStats = statsRef.current) {
    clearAllTimeouts();
    setCue(null);
    setSummary(getSummary(finalStats));
    setPhase("summary");
  }

  function scheduleNextCue(waitMs = randomDelay()) {
    if (cueIndexRef.current >= cueSequenceRef.current.length) {
      finishRun();
      return;
    }

    setCue(null);
    cueStartRef.current = null;
    setStatusText("WAIT FOR THE SIGNAL");
    setPhase("waiting");
    timeouts.current.push(setTimeout(showCue, waitMs));
  }

  function showCue() {
    const cue = cueSequenceRef.current[cueIndexRef.current];
    cueIndexRef.current += 1;
    setCue(cue);
    setPhase("active");

    const greenCount = cue.panels.filter((signal) => signal === "green").length;
    const redCount = cue.panels.filter((signal) => signal === "red").length;
    cueStartRef.current = cue.targetSlot === null ? null : Date.now();
    setStatusText(cue.targetSlot === null ? "IGNORE RED" : selectedDifficulty.targetColor === "green" ? "TAP GREEN" : "TAP RED");

    commitStats((current) => ({
      ...current,
      targetsShown: current.targetsShown + (cue.targetSlot === null ? 0 : 1),
      greenShown: current.greenShown + greenCount,
      redShown: current.redShown + redCount,
    }));

    timeouts.current.push(setTimeout(() => {
      const currentCue = activeCueRef.current;
      if (!currentCue) return;

      if (currentCue.targetSlot !== null) {
        const afterMiss = commitStats((current) => ({ ...current, misses: current.misses + 1 }));
        setCue(null);
        setStatusText("TOO SLOW");
        timeouts.current.push(setTimeout(() => {
          if (cueIndexRef.current >= cueSequenceRef.current.length) finishRun(afterMiss);
          else scheduleNextCue();
        }, 720));
        return;
      }

      scheduleNextCue(620);
    }, 1600));
  }

  function startRun() {
    clearAllTimeouts();
    const freshStats = { ...initialStats };
    statsRef.current = freshStats;
    setStats(freshStats);
    setSummary(null);
    cueSequenceRef.current = buildCueSequence(selectedDifficulty, roundCount);
    cueIndexRef.current = 0;
    setCue(null);
    setStatusText("WAIT FOR THE SIGNAL");
    setPhase("waiting");
    scheduleNextCue();
  }

  function advanceAfterResponse(delay = 620) {
    setCue(null);
    cueStartRef.current = null;
    timeouts.current.push(setTimeout(() => {
      if (cueIndexRef.current >= cueSequenceRef.current.length) finishRun();
      else scheduleNextCue();
    }, delay));
  }

  function handlePanelPress(slot) {
    void triggerSelectionHaptic();

    if (phase === "ready") {
      startRun();
      return;
    }

    if (phase === "waiting") {
      clearAllTimeouts();
      commitStats((current) => ({ ...current, falseStarts: current.falseStarts + 1 }));
      setStatusText("TOO EARLY");
      timeouts.current.push(setTimeout(() => scheduleNextCue(), 720));
      return;
    }

    if (phase !== "active") return;
    const cue = activeCueRef.current;
    if (!cue) return;

    clearAllTimeouts();
    if (cue.targetSlot === slot && cueStartRef.current) {
      const reaction = Date.now() - cueStartRef.current;
      commitStats((current) => ({ ...current, hits: current.hits + 1, reactionTimes: [...current.reactionTimes, reaction] }));
      setStatusText(`${reaction} MS`);
      advanceAfterResponse();
      return;
    }

    commitStats((current) => ({ ...current, wrongTaps: current.wrongTaps + 1 }));
    setStatusText(cue.targetSlot === null ? "IGNORE THAT SIGNAL" : "WRONG PANEL");
    advanceAfterResponse(760);
  }

  const preflightScreen = (
    <GameSetupShell
      title="Reaction Time"
      categoryKey="attention"
      onExit={onExit}
      onStart={() => startMission(() => resetRun(selectedDifficulty))}
      rules="Tests reaction speed and response inhibition. React only to the requested signal. Easy: tap the green signal. Medium: tap green and ignore red. Hard: tap the green signal in the correct panel; a red decoy may appear at the same time."
    >
      <PickerSetting label="Difficulty" options={difficultyOptions.map((option) => ({ value: option, label: option.label }))} value={selectedDifficulty} onChange={setSelectedDifficulty} />
      <PickerSetting label="Rounds" options={[1, 5, 10].map((value) => ({ value, label: String(value) }))} value={roundCount} onChange={setRoundCount} />
    </GameSetupShell>
  );

  const panelCount = selectedDifficulty.panelCount;
  const panels = activeCue?.panels ?? emptyPanels(panelCount);
  const isReady = phase === "ready";

  return (
    <View style={styles.container}>
      {phase === "difficulty" || isReturning ? (
        <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflightScreen}</Animated.View>
      ) : null}

      {phase !== "difficulty" ? (
      <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionScreen, missionStyle]}>
      <View style={styles.headerRow}>
        <Pressable onPress={returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable>
      </View>

      {phase !== "summary" ? (
        <Animated.View entering={FadeIn.duration(180)} style={styles.contentArea}>
        <Pressable disabled={!isReady} onPressIn={() => handlePanelPress(0)} style={styles.readyTouchTarget}>
        <View pointerEvents={isReady ? "none" : "auto"} style={styles.gamePanel}>
          <Text style={styles.kicker}>{isReady ? "ATTENTION" : `ROUND ${Math.min(cueIndexRef.current + (phase === "active" ? 0 : 1), roundCount)} / ${roundCount}`}</Text>
          <Text style={styles.title}>{isReady ? "Ready to react?" : statusText}</Text>
          <Text style={styles.helperText}>
            {isReady
              ? selectedDifficulty.key === "easy"
                ? "Tap the green signal as fast as you can."
                : selectedDifficulty.key === "medium"
                  ? "Tap green. Ignore red."
                  : "Tap green. It may appear beside a red decoy."
              : phase === "waiting" ? "Stay focused." : null}
          </Text>

          <PulsingPrompt color={SIGNAL_RED} style={[styles.beginPrompt, !isReady && styles.beginPromptPlaceholder]}>
            {isReady ? "TAP ANYWHERE TO BEGIN" : " "}
          </PulsingPrompt>

          <View style={[styles.panelGrid, panelCount === 4 && styles.panelGridHard]}>
            {panels.map((signal, index) => {
              const signalColor = getPanelColor(signal);
              const isActive = Boolean(signalColor);
              return (
                <Pressable
                  key={index}
                  onPressIn={() => handlePanelPress(index)}
                  style={[
                    styles.signalPanel,
                    panelCount === 4 && styles.signalPanelHard,
                    signal === "green" && styles.signalPanelGreen,
                    signal === "red" && styles.signalPanelRed,
                    isActive && [styles.signalPanelActive, { borderColor: signalColor, shadowColor: signalColor }],
                  ]}
                >
                </Pressable>
              );
            })}
          </View>
        </View>
        </Pressable>
        </Animated.View>
      ) : null}

      {phase === "summary" && summary ? (
        <Animated.View entering={FadeIn.duration(180)} style={styles.summaryPanel}>
          <Text style={styles.kicker}>MISSION COMPLETE</Text>
          <Text style={styles.title}>{summary.average !== null ? `${summary.average} ms average` : "No valid hits"}</Text>
          <Text style={styles.summaryCaption}>Best response {summary.best !== null ? `${summary.best} ms` : "—"}</Text>
          <View style={styles.statsCard}>
            <Text style={styles.statLine}>Correct hits <Text style={styles.statValue}>{summary.hits} / {summary.targetsShown}</Text></Text>
            <Text style={styles.statLine}>Missed targets <Text style={styles.statValue}>{summary.misses}</Text></Text>
            <Text style={styles.statLine}>Wrong responses <Text style={styles.statValue}>{summary.wrongTaps}</Text></Text>
            <Text style={styles.statLine}>False starts <Text style={styles.statValue}>{summary.falseStarts}</Text></Text>
          </View>
          <View style={styles.footerActions}>
            <TouchableOpacity activeOpacity={0.9} onPress={() => resetRun(selectedDifficulty)} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Play again</Text></TouchableOpacity>
            <TouchableOpacity activeOpacity={0.9} onPress={returnToPreflight} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Change settings</Text></TouchableOpacity>
          </View>
        </Animated.View>
      ) : null}
      </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SPACE_CADET.black },
  missionScreen: { flex: 1, backgroundColor: SPACE_CADET.black, zIndex: 2 },
  preflightLayer: { ...StyleSheet.absoluteFill, zIndex: 1 },
  headerRow: { height: 64, paddingHorizontal: 20, justifyContent: "center" },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  backArrow: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 },
  pressed: { transform: [{ scale: 0.97 }] },
  gamePanel: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 72 },
  readyTouchTarget: { flex: 1 },
  contentArea: { flex: 1 },
  kicker: { color: SIGNAL_RED, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.8, textAlign: "center", minHeight: 16 },
  title: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 29, lineHeight: 36, textAlign: "center", marginTop: 8, minHeight: 42 },
  helperText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 22, textAlign: "center", minHeight: 44, maxWidth: 300, marginTop: 8 },
  panelGrid: { width: 218, height: 218, marginTop: 24, alignItems: "center", justifyContent: "center" },
  panelGridHard: { width: 286, height: 286, flexDirection: "row", flexWrap: "wrap", gap: 12, alignContent: "center", justifyContent: "center", overflow: "visible" },
  signalPanel: { width: 218, height: 218, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.surface1, borderWidth: 1, borderColor: "transparent", shadowOpacity: 0, shadowRadius: 24, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
  signalPanelHard: { width: 137, height: 137, borderRadius: 24 },
  signalPanelGreen: { backgroundColor: "#10251F" },
  signalPanelRed: { backgroundColor: "#32111D" },
  signalPanelActive: { zIndex: 2, shadowOpacity: 0.42, shadowRadius: 24, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  beginPrompt: { color: SIGNAL_RED, fontFamily: "Gontserrat-SemiBold", fontSize: 12, height: 22, lineHeight: 16, letterSpacing: 1.8, marginTop: 16, textAlign: "center" },
  beginPromptPlaceholder: { opacity: 0 },
  summaryPanel: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingBottom: 28 },
  summaryCaption: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 18, marginTop: 8 },
  statsCard: { width: "100%", backgroundColor: SPACE_CADET.surface1, borderRadius: 22, padding: 20, marginTop: 34, gap: 12 },
  statLine: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14 },
  statValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 17 },
  footerActions: { width: "100%", gap: 12, paddingTop: 22 },
  primaryButton: { backgroundColor: SPACE_CADET.white, minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  primaryButtonText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 16 },
  secondaryButton: { minHeight: 52, borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 },
});
