import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import Animated, { FadeIn } from "react-native-reanimated";

import { GameSetupShell, PickerSetting } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerSelectionHaptic } from "../../utils/haptics";
import { randomSeed } from "../../utils/random";
import { AFTER_FAULT_MS, AFTER_HIT_MS, buildDailyRounds, buildSession, dailyResult, DAILY_LEVELS, DIFFICULTY_OPTIONS, GREEN_LIMIT_MS, levelOf, RED_VISIBLE_MS, roundPoints, summarise } from "./logic";

const SIGNAL_GREEN = "#34D399";
const SIGNAL_RED = SPACE_CADET.attention;
function getPanelColor(signal) {
  return signal === "green" ? SIGNAL_GREEN : signal === "red" ? SIGNAL_RED : null;
}

// `daily` ({ seed, onFinish, onExit }) turns this into the daily training version: no preflight, the day's ten
// rounds (DAILY_LEVELS), then onFinish({ score, metrics, trials }).
export function ReactionTimeGame({ onExit, daily = null }) {
  const [selectedDifficulty, setSelectedDifficulty] = useState(DIFFICULTY_OPTIONS[0]);
  const [roundCount, setRoundCount] = useState(10);
  const [phase, setPhase] = useState(daily ? "ready" : "difficulty");
  const [activeCue, setActiveCue] = useState(null);
  const [statusText, setStatusText] = useState("");
  const [detailText, setDetailText] = useState("");
  const [roundIndex, setRoundIndex] = useState(0);
  const [summary, setSummary] = useState(null);

  const timeouts = useRef([]);
  const roundsRef = useRef([]);
  const roundIndexRef = useRef(0);
  const cueIndexRef = useRef(0);
  const cueStartRef = useRef(null);
  const activeCueRef = useRef(null);
  // The current round's fault, if any: "early" (tap before the signal), "red" (tapped a red signal), "panel"
  // (wrong panel), "miss" (no tap within the limit). One fault is enough for the round to score 0.
  const faultRef = useRef(null);
  const resultsRef = useRef([]);

  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({
    onPrepareReturn: clearAllTimeouts,
    onReturnComplete: () => resetRun(null),
  });

  useEffect(() => () => timeouts.current.forEach(clearTimeout), []);

  function clearAllTimeouts() {
    timeouts.current.forEach(clearTimeout);
    timeouts.current = [];
  }
  function later(callback, delay) { timeouts.current.push(setTimeout(callback, delay)); }
  function setCue(cue) {
    activeCueRef.current = cue;
    setActiveCue(cue);
  }
  function currentRound() { return roundsRef.current[roundIndexRef.current]; }

  function resetRun(nextDifficulty = selectedDifficulty) {
    clearAllTimeouts();
    setSelectedDifficulty(nextDifficulty ?? selectedDifficulty);
    setCue(null);
    setStatusText("");
    setDetailText("");
    setSummary(null);
    cueStartRef.current = null;
    roundsRef.current = [];
    roundIndexRef.current = 0;
    cueIndexRef.current = 0;
    faultRef.current = null;
    resultsRef.current = [];
    setRoundIndex(0);
    setPhase(nextDifficulty ? "ready" : "difficulty");
  }

  function startRun() {
    clearAllTimeouts();
    roundsRef.current = daily ? buildDailyRounds(daily.seed) : buildSession({ level: selectedDifficulty.key, roundCount }, randomSeed());
    resultsRef.current = [];
    setSummary(null);
    startRound(0);
  }

  function startRound(index) {
    roundIndexRef.current = index;
    cueIndexRef.current = 0;
    faultRef.current = null;
    setRoundIndex(index);
    scheduleCue();
  }

  function scheduleCue() {
    const cue = currentRound().cues[cueIndexRef.current];
    setCue(null);
    cueStartRef.current = null;
    setStatusText("WAIT FOR THE SIGNAL");
    setDetailText("");
    setPhase("waiting");
    later(() => showCue(cue), cue.waitMs);
  }

  function showCue(cue) {
    setCue(cue);
    setPhase("active");
    cueStartRef.current = cue.targetSlot === null ? null : Date.now();
    setStatusText(cue.targetSlot === null ? "IGNORE RED" : "TAP GREEN");
    if (cue.targetSlot === null) {
      later(() => { if (activeCueRef.current === cue) nextCue(AFTER_HIT_MS); }, RED_VISIBLE_MS);
      return;
    }
    later(() => {
      if (activeCueRef.current !== cue) return;
      faultRef.current = "miss";
      setStatusText("TOO SLOW");
      endRound(null);
    }, GREEN_LIMIT_MS);
  }

  // After a red-only signal: on to the green of the same round.
  function nextCue(delay) {
    setCue(null);
    cueStartRef.current = null;
    cueIndexRef.current += 1;
    later(scheduleCue, delay);
  }

  function endRound(reactionMs) {
    const round = currentRound();
    const fault = faultRef.current;
    const points = fault ? 0 : roundPoints(round.level, reactionMs);
    resultsRef.current = [...resultsRef.current, { level: round.level, reactionMs, points, fault }];
    setCue(null);
    cueStartRef.current = null;
    if (reactionMs !== null) setDetailText(`${points} / 100`);
    later(() => {
      if (roundIndexRef.current + 1 < roundsRef.current.length) startRound(roundIndexRef.current + 1);
      else finishRun();
    }, reactionMs !== null && !fault ? AFTER_HIT_MS : AFTER_FAULT_MS);
  }

  function finishRun() {
    clearAllTimeouts();
    setCue(null);
    const results = resultsRef.current;
    const outcome = summarise(results);
    if (daily) { daily.onFinish(dailyResult(results)); return; }
    setSummary(outcome);
    setPhase("summary");
  }

  function handlePanelPress(slot) {
    void triggerSelectionHaptic();

    if (phase === "ready") {
      startRun();
      return;
    }

    // Too early: the round is lost, but the signal still comes (the wait restarts).
    if (phase === "waiting") {
      clearAllTimeouts();
      faultRef.current = faultRef.current ?? "early";
      setStatusText("TOO EARLY");
      setDetailText("0 / 100");
      later(scheduleCue, AFTER_FAULT_MS);
      return;
    }

    if (phase !== "active") return;
    const cue = activeCueRef.current;
    if (!cue) return;

    clearAllTimeouts();
    if (cue.targetSlot === slot && cueStartRef.current) {
      const reaction = Date.now() - cueStartRef.current;
      setStatusText(`${reaction} MS`);
      endRound(reaction);
      return;
    }

    if (cue.targetSlot === null) {
      faultRef.current = faultRef.current ?? "red";
      setStatusText("IGNORE THAT SIGNAL");
      setDetailText("0 / 100");
      nextCue(AFTER_FAULT_MS);
      return;
    }

    faultRef.current = faultRef.current ?? "panel";
    setStatusText("WRONG PANEL");
    setDetailText("0 / 100");
    endRound(null);
  }

  const preflightScreen = (
    <GameSetupShell
      title="Reaction Time"
      categoryKey="attention"
      onExit={onExit}
      onStart={() => startMission(() => resetRun(selectedDifficulty))}
      rules="Tests reaction speed and response inhibition. Each round lights one green signal: tap it as fast as you can. A round scores up to 100 points, fewer the slower the reaction, and 0 for a tap before the signal, on a red signal, on the wrong panel, or later than 2 seconds. Easy: green only. Medium: a red signal may come first, ignore it. Hard: four panels; the green may appear beside a red decoy."
    >
      <PickerSetting label="Difficulty" options={DIFFICULTY_OPTIONS.map((option) => ({ value: option, label: option.label }))} value={selectedDifficulty} onChange={setSelectedDifficulty} />
      <PickerSetting label="Rounds" options={[1, 5, 10].map((value) => ({ value, label: String(value) }))} value={roundCount} onChange={setRoundCount} />
    </GameSetupShell>
  );

  const isReady = phase === "ready";
  const round = roundsRef.current[roundIndex];
  const level = isReady ? (daily ? levelOf(DAILY_LEVELS[0]) : selectedDifficulty) : levelOf(round?.level ?? selectedDifficulty.key);
  const panelCount = level.panelCount;
  const panels = activeCue?.panels ?? Array.from({ length: panelCount }, () => null);
  const totalRounds = daily ? DAILY_LEVELS.length : roundCount;

  return (
    <View style={styles.container}>
      {phase === "difficulty" || isReturning ? (
        <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflightScreen}</Animated.View>
      ) : null}

      {phase !== "difficulty" ? (
      <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionScreen, !daily && missionStyle]}>
      <View style={styles.headerRow}>
        <Pressable onPress={daily ? daily.onExit : returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable>
      </View>

      {phase !== "summary" ? (
        <Animated.View entering={FadeIn.duration(180)} style={styles.contentArea}>
        <Pressable disabled={!isReady} onPressIn={() => handlePanelPress(0)} style={styles.readyTouchTarget}>
        <View pointerEvents={isReady ? "none" : "auto"} style={styles.gamePanel}>
          <Text style={styles.kicker}>{isReady ? (daily ? "DAILY TRAINING" : "ATTENTION") : `ROUND ${roundIndex + 1} / ${totalRounds}${daily ? ` · ${level.label}` : ""}`}</Text>
          <Text style={styles.title}>{isReady ? "Ready to react?" : statusText}</Text>
          <Text style={styles.helperText}>
            {isReady
              ? daily ? "Ten rounds: two easy, three medium, five hard. Tap green as fast as you can, never red." : level.helper
              : phase === "waiting" ? level.helper : detailText}
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
          <Text style={styles.summaryCaption}>Score {summary.score} / {summary.maxScore} · best {summary.best !== null ? `${summary.best} ms` : "—"}</Text>
          <View style={styles.statsCard}>
            <Text style={styles.statLine}>Correct hits <Text style={styles.statValue}>{summary.hits} / {summary.rounds}</Text></Text>
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
