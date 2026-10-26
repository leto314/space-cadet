import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import Animated, { FadeIn } from "react-native-reanimated";

import { GameSetupShell, PickerSetting } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerSelectionHaptic } from "../../utils/haptics";
import { createRandom, deriveSeed, randomTools } from "../../utils/random";

const SIGNAL_GREEN = "#34D399";
const SIGNAL_RED = SPACE_CADET.attention;
const difficultyOptions = [
  { key: "easy", label: "EASY", panelCount: 1, helper: "Tap the green signal as fast as you can." },
  { key: "medium", label: "MEDIUM", panelCount: 1, helper: "Tap green. Ignore red." },
  { key: "hard", label: "HARD", panelCount: 4, helper: "Tap green. It may appear beside a red decoy." },
];
const levelOf = (key) => difficultyOptions.find((option) => option.key === key);

// Timing: the wait before a signal, how long a green stays up (a tap after that is a miss), how long a red-only
// signal stays up, and the pauses after a response.
const WAIT_MIN_MS = 1000;
const WAIT_MAX_MS = 5000;
const GREEN_LIMIT_MS = 2000;
const RED_VISIBLE_MS = 1600;
const AFTER_HIT_MS = 620;
const AFTER_FAULT_MS = 760;

// Points of a round (0–100) from the reaction time: 100 at or under `fast` (never more, however quick the
// tap), then a cubic fall to 0 at the 2-second limit. The cube keeps the curve steep where real reactions sit (roughly 250–700 ms) and leaves only
// crumbs for a distracted 1–2 s. Hard has four panels (choice, not simple reaction), so its "fast" is later.
//   easy/medium  250 ms → 100 · 400 → 76 · 550 → 57 · 850 → 28 · 1200 → 10
//   hard         350 ms → 100 · 500 → 75 · 700 → 49 · 1000 → 22
const FAST_MS = { easy: 250, medium: 250, hard: 350 };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export function roundPoints(level, reactionMs) {
  if (reactionMs === null || reactionMs >= GREEN_LIMIT_MS) return 0;
  const share = clamp((GREEN_LIMIT_MS - reactionMs) / (GREEN_LIMIT_MS - FAST_MS[level]), 0, 1);
  return clamp(Math.round(100 * share ** 3), 0, 100);
}

// Daily training: ten rounds for everyone, 2 easy, 3 medium, 5 hard; the score is the sum of the ten rounds.
export const DAILY_LEVELS = ["easy", "easy", "medium", "medium", "medium", "hard", "hard", "hard", "hard", "hard"];

// A round: an optional red-only signal to ignore (medium and hard, half the time), then the green target.
// Hard has four panels, and the green may come with a red decoy. Every wait and slot is drawn from the seed.
export function buildRounds(levels, seed) {
  const rnd = randomTools(createRandom(seed));
  const empty = (count) => Array.from({ length: count }, () => null);
  return levels.map((level) => {
    const { panelCount } = levelOf(level);
    const cues = [];
    if (level !== "easy" && rnd.chance(0.5)) {
      const panels = empty(panelCount);
      panels[rnd.int(0, panelCount - 1)] = "red";
      cues.push({ panels, targetSlot: null, waitMs: rnd.int(WAIT_MIN_MS, WAIT_MAX_MS) });
    }
    const panels = empty(panelCount);
    const targetSlot = rnd.int(0, panelCount - 1);
    panels[targetSlot] = "green";
    if (level === "hard" && rnd.chance(0.6)) panels[rnd.item(panels.map((_, index) => index).filter((index) => index !== targetSlot))] = "red";
    cues.push({ panels, targetSlot, waitMs: rnd.int(WAIT_MIN_MS, WAIT_MAX_MS) });
    return { level, panelCount, cues };
  });
}

function summarise(results) {
  const times = results.map((result) => result.reactionMs).filter((value) => value !== null);
  const points = results.reduce((sum, result) => sum + result.points, 0);
  return {
    rounds: results.length,
    score: clamp(points, 0, results.length * 100),
    maxScore: results.length * 100,
    average: times.length ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length) : null,
    best: times.length ? Math.min(...times) : null,
    hits: results.filter((result) => result.reactionMs !== null).length,
    misses: results.filter((result) => result.fault === "miss").length,
    wrongTaps: results.filter((result) => result.fault === "red" || result.fault === "panel").length,
    falseStarts: results.filter((result) => result.fault === "early").length,
  };
}

function getPanelColor(signal) {
  return signal === "green" ? SIGNAL_GREEN : signal === "red" ? SIGNAL_RED : null;
}

// `daily` ({ seed, onFinish, onExit }) turns this into the daily training version: no preflight, the day's ten
// rounds (DAILY_LEVELS), then onFinish({ score, metrics, trials }).
export function ReactionTimeGame({ onExit, daily = null }) {
  const [selectedDifficulty, setSelectedDifficulty] = useState(difficultyOptions[0]);
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
    const levels = daily ? DAILY_LEVELS : Array.from({ length: roundCount }, () => selectedDifficulty.key);
    const seed = daily ? deriveSeed(daily.seed, "rounds") : Math.floor(Math.random() * 4294967296);
    roundsRef.current = buildRounds(levels, seed);
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
    if (daily) {
      const pointsIn = (level) => results.filter((result) => result.level === level).reduce((sum, result) => sum + result.points, 0);
      daily.onFinish({
        score: outcome.score,
        metrics: { meanRtMs: outcome.average, bestRtMs: outcome.best, hits: outcome.hits, rounds: outcome.rounds, misses: outcome.misses, wrongTaps: outcome.wrongTaps, falseStarts: outcome.falseStarts, easyPoints: pointsIn("easy"), mediumPoints: pointsIn("medium"), hardPoints: pointsIn("hard") },
        trials: results.map((result) => ({ ok: result.fault ? 0 : 1, rt: result.reactionMs, pts: result.points, level: result.level, fault: result.fault })),
      });
      return;
    }
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
      <PickerSetting label="Difficulty" options={difficultyOptions.map((option) => ({ value: option, label: option.label }))} value={selectedDifficulty} onChange={setSelectedDifficulty} />
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
