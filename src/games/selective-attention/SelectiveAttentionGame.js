import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import Animated, { FadeIn } from "react-native-reanimated";

import { GameSetupShell, PickerSetting } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { ensureAudioReady } from "../../utils/audio";
import { endVoiceSession, say, startVoiceSession, stopSpeaking } from "../../utils/voice";
import { triggerSelectionHaptic } from "../../utils/haptics";
import { createRandom, deriveSeed, randomTools } from "../../utils/random";

const ACCENT = SPACE_CADET.attention;
const COLORS = [
  { key: "blue", label: "BLUE", hex: "#4C8DFF", soft: "#10203F" },
  { key: "purple", label: "PURPLE", hex: "#C46BFF", soft: "#28123A" },
  { key: "red", label: "RED", hex: "#D81E5B", soft: "#35101F" },
  { key: "yellow", label: "YELLOW", hex: "#FFCF3D", soft: "#352A08" },
  { key: "green", label: "GREEN", hex: "#34D399", soft: "#0C2B23" },
  { key: "orange", label: "ORANGE", hex: "#FF741A", soft: "#3A1608" },
];

const difficultyOptions = [
  { key: "easy", label: "EASY", allowedTargets: ["word", "color"], preannounce: true, useAudio: false },
  { key: "medium", label: "MEDIUM", allowedTargets: ["word", "color", "audio"], preannounce: true, useAudio: true },
  { key: "hard", label: "HARD", allowedTargets: ["word", "color", "audio"], preannounce: false, useAudio: true },
];
const levelOf = (key) => difficultyOptions.find((option) => option.key === key);

// Timing: the cue card before the word (easy, medium), the stand-by before the word (hard), how long a word stays
// up (no answer by then is a miss), and the pauses after an answer.
const CUE_MS = 1450;
const STANDBY_MS = 1050;
const LIMIT_MS = 6000;
const AFTER_ANSWER_MS = 460;
const AFTER_MISS_MS = 700;

// Points of a trial (0–100) from the response time of a right answer: 100 at or under `fast`, then a gentle
// curve (power 1.5) down to 0 at the 6-second limit (a wrong answer, or none, is 0). This is a decision, not a
// reflex, and `fast` depends on the level: with the cue known in advance a word is read quickly, with a spoken
// colour in play there is more to sort out, and in hard the cue itself must be read first.
//   easy (fast 600)    800 → 95 · 1000 → 89 · 1500 → 77 · 2000 → 65 · 3000 → 44 · 4000 → 25
//   hard (fast 900)    1000 → 97 · 1500 → 83 · 1900 → 72 · 2500 → 57 · 3000 → 49 · 4000 → 25
// When the cue is the spoken colour, the player has to hear the word before answering: the time until the voice
// starts, plus the word itself, is taken off the response time (see AUDIO_WORD_MS).
const FAST_MS = { easy: 600, medium: 700, hard: 900 };
const AUDIO_WORD_MS = 350;         // about how long a colour name takes to say
const AUDIO_FALLBACK_MS = 600;     // allowance when the voice never reports when it started
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export function trialPoints(level, reactionMs) {
  if (reactionMs === null || reactionMs >= LIMIT_MS) return 0;
  const share = clamp((LIMIT_MS - reactionMs) / (LIMIT_MS - FAST_MS[level]), 0, 1);
  return clamp(Math.round(100 * share ** 1.5), 0, 100);
}

// Daily training: ten trials for everyone, 2 easy, 2 medium (the spoken cue comes in), 6 hard.
export const DAILY_LEVELS = ["easy", "easy", "medium", "medium", "hard", "hard", "hard", "hard", "hard", "hard"];

export function buildTrials(levels, seed) {
  const rnd = randomTools(createRandom(seed));
  return levels.map((level) => {
    const option = levelOf(level);
    return { level, targetType: rnd.item(option.allowedTargets), writtenColor: rnd.item(COLORS), inkColor: rnd.item(COLORS), spokenColor: option.useAudio ? rnd.item(COLORS) : null };
  });
}

function targetFor(trial) { return trial.targetType === "word" ? trial.writtenColor : trial.targetType === "color" ? trial.inkColor : trial.spokenColor; }
function targetLabel(type) { return type === "word" ? "WORD" : type === "color" ? "INK COLOUR" : "AUDIO"; }

function summarise(results) {
  const right = results.filter((entry) => entry.correct);
  const times = right.map((entry) => entry.reactionMs);
  const points = results.reduce((sum, entry) => sum + entry.points, 0);
  return {
    trials: results.length, correct: right.length, errors: results.filter((entry) => !entry.correct && entry.reactionMs !== null).length, tooSlow: results.filter((entry) => entry.reactionMs === null).length,
    score: results.length ? clamp(Math.round((points / results.length) * 10), 0, 1000) : 0,
    accuracy: results.length ? Math.round((right.length / results.length) * 100) : 0,
    average: times.length ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length) : null, best: times.length ? Math.min(...times) : null,
  };
}

function TaskIcon({ type, color = SPACE_CADET.white, size = 32 }) {
  if (type === "audio") return <Svg width={size} height={size} viewBox="0 0 32 32"><Path d="M7 18H12L18 23V9L12 14H7Z" fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" /><Path d="M22 12c2 1.5 3 2.7 3 4s-1 2.5-3 4m2.8-10.5c3 2.2 4.2 4.4 4.2 6.5s-1.2 4.3-4.2 6.5" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" /></Svg>;
  if (type === "color") return <Svg width={size} height={size} viewBox="0 0 32 32"><Path d="M3 16c3.5-6.5 8-10 13-10s9.5 3.5 13 10c-3.5 6.5-8 10-13 10S6.5 22.5 3 16Z" fill="none" stroke={color} strokeWidth="2" /><Circle cx="16" cy="16" r="4" fill="none" stroke={color} strokeWidth="2" /></Svg>;
  return <Svg width={size} height={size} viewBox="0 0 32 32"><Rect x="6" y="6" width="20" height="20" rx="4" fill="none" stroke={color} strokeWidth="2" /><Line x1="10" y1="12" x2="22" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" /><Line x1="10" y1="17" x2="22" y2="17" stroke={color} strokeWidth="2" strokeLinecap="round" /><Line x1="10" y1="22" x2="18" y2="22" stroke={color} strokeWidth="2" strokeLinecap="round" /></Svg>;
}

// `daily` ({ seed, onFinish, onExit }) turns this into the daily training version: no preflight, the day's ten
// trials (DAILY_LEVELS), then onFinish({ score, metrics, trials }).
export function SelectiveAttentionGame({ onExit, daily = null }) {
  const [difficulty, setDifficulty] = useState(difficultyOptions[0]);
  const [roundCount, setRoundCount] = useState(6);
  const [phase, setPhase] = useState(daily ? "ready" : "preflight");
  const [trialIndex, setTrialIndex] = useState(0);
  const [trial, setTrial] = useState(null);
  const [lastPoints, setLastPoints] = useState(0);
  const [summary, setSummary] = useState(null);
  const timeouts = useRef([]);
  const trialsRef = useRef([]);
  const resultRef = useRef([]);
  const startedAt = useRef(null);
  const speechStartedAt = useRef(null);
  const audioReadyRef = useRef(false);

  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({
    onPrepareReturn: clearTimers,
    onReturnComplete: () => resetToPreflight(),
  });

  useEffect(() => () => { clearTimers(); endVoiceSession(); }, []);

  function clearTimers() { timeouts.current.forEach(clearTimeout); timeouts.current = []; }
  function later(callback, delay) { timeouts.current.push(setTimeout(callback, delay)); }
  function resetToPreflight() {
    clearTimers();
    stopSpeaking();
    trialsRef.current = [];
    resultRef.current = [];
    startedAt.current = null;
    setTrial(null); setTrialIndex(0); setSummary(null); setPhase("preflight");
  }
  function resetToReady() {
    clearTimers(); stopSpeaking(); resultRef.current = []; setSummary(null); setTrial(null); setTrialIndex(0); setPhase("ready");
    void ensureAudioReady().then(() => {
      audioReadyRef.current = true;
      if (daily || difficulty.useAudio) void startVoiceSession();
    });
  }
  // The daily version starts on the ready screen: warm the audio up there too.
  useEffect(() => { if (daily) resetToReady(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function showTrial(index, prepared = trialsRef.current) {
    if (index >= prepared.length) { finishRun(); return; }
    const nextTrial = prepared[index];
    setTrialIndex(index); setTrial(nextTrial); setPhase("instruction");
    later(() => revealTrial(nextTrial), levelOf(nextTrial.level).preannounce ? CUE_MS : STANDBY_MS);
  }
  function revealTrial(nextTrial) {
    setPhase("stimulus"); startedAt.current = Date.now(); speechStartedAt.current = null;
    if (nextTrial.spokenColor) {
      const announce = () => { say(nextTrial.spokenColor.label.toLowerCase(), { language: "en-US", rate: 0.92, pitch: 1, onStart: () => { speechStartedAt.current = Date.now(); } }); };
      if (audioReadyRef.current) later(announce, 50);
      else void ensureAudioReady().then(() => { audioReadyRef.current = true; later(announce, 50); });
    }
    later(() => { if (startedAt.current) record(nextTrial, false, null); }, LIMIT_MS);
  }
  function beginRun() {
    const levels = daily ? DAILY_LEVELS : Array.from({ length: roundCount }, () => difficulty.key);
    const prepared = buildTrials(levels, daily ? deriveSeed(daily.seed, "trials") : Math.floor(Math.random() * 4294967296));
    trialsRef.current = prepared; resultRef.current = []; setTrialIndex(0); setTrial(null);
    showTrial(0, prepared);
  }
  function record(current, correct, reactionMs) {
    clearTimers();
    const points = correct ? trialPoints(current.level, reactionMs) : 0;
    resultRef.current = [...resultRef.current, { level: current.level, targetType: current.targetType, correct, reactionMs, points }];
    startedAt.current = null;
    setLastPoints(points);
    setPhase(reactionMs === null ? "slow" : correct ? "correct" : "incorrect");
    later(() => showTrial(trialIndex + 1), reactionMs === null ? AFTER_MISS_MS : AFTER_ANSWER_MS);
  }
  function finishRun() {
    clearTimers(); stopSpeaking();
    const results = resultRef.current;
    const outcome = summarise(results);
    setTrial(null);
    if (daily) {
      const pointsIn = (level) => results.filter((entry) => entry.level === level).reduce((sum, entry) => sum + entry.points, 0);
      daily.onFinish({
        score: outcome.score,
        metrics: { correct: outcome.correct, trials: outcome.trials, errors: outcome.errors, tooSlow: outcome.tooSlow, meanRtMs: outcome.average, bestRtMs: outcome.best, easyPoints: pointsIn("easy"), mediumPoints: pointsIn("medium"), hardPoints: pointsIn("hard") },
        trials: results.map((entry) => ({ ok: entry.correct ? 1 : 0, rt: entry.reactionMs, pts: entry.points, level: entry.level, cue: entry.targetType })),
      });
      return;
    }
    setSummary(outcome); setPhase("summary");
  }
  // The response time; for a spoken cue, counted from the end of the word rather than from the word on screen.
  function responseTime() {
    const elapsed = Date.now() - startedAt.current;
    if (trial.targetType !== "audio") return elapsed;
    const allowance = speechStartedAt.current ? speechStartedAt.current - startedAt.current + AUDIO_WORD_MS : AUDIO_FALLBACK_MS;
    return Math.max(0, elapsed - allowance);
  }
  function handleChoice(color) {
    if (phase !== "stimulus" || !trial || !startedAt.current) return;
    void triggerSelectionHaptic();
    record(trial, targetFor(trial).key === color.key, responseTime());
  }

  const preflight = <GameSetupShell title="Selective Attention" categoryKey="attention" onExit={onExit} onStart={() => startMission(resetToReady)} rules="Tests focus under conflicting cues. Match the requested word, ink colour, or spoken colour. A right answer scores up to 100 points, fewer the slower the response (for a spoken cue, the time to hear the word is not counted); a wrong answer, or none within 6 seconds, scores 0.Easy: The cue is shown before each word.Medium: Audio is added to the possible cues.Hard: The cue is revealed with the word.">
    <PickerSetting label="Difficulty" options={difficultyOptions.map((option) => ({ value: option, label: option.label }))} value={difficulty} onChange={setDifficulty} />
    <PickerSetting label="Trials" options={[3, 6, 10].map((value) => ({ value, label: String(value) }))} value={roundCount} onChange={setRoundCount} />
  </GameSetupShell>;

  const level = trial ? levelOf(trial.level) : difficulty;
  const instructionType = trial?.targetType;
  const isReady = phase === "ready";
  const feedback = phase === "correct" ? `${lastPoints} / 100` : phase === "incorrect" ? "Not quite" : phase === "slow" ? "Too slow" : null;
  const totalTrials = daily ? DAILY_LEVELS.length : roundCount;

  return <View style={styles.container}>
    {phase === "preflight" || isReturning ? <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflight}</Animated.View> : null}
    {phase !== "preflight" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, !daily && missionStyle]}>
      <View style={styles.header}><Pressable onPress={daily ? daily.onExit : returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>
      {phase !== "summary" ? <Animated.View entering={FadeIn.duration(180)} style={styles.playArea}>
        <Pressable disabled={!isReady} onPress={beginRun} style={styles.readyTapArea}>
          <View pointerEvents={isReady ? "none" : "auto"} style={styles.content}>
            <Text style={styles.kicker}>{isReady ? (daily ? "DAILY TRAINING" : "ATTENTION") : `TRIAL ${trialIndex + 1} / ${totalTrials}${daily ? ` · ${level.label}` : ""}`}</Text>
            <Text style={styles.title}>{isReady ? "Ready to filter?" : feedback ?? (phase === "instruction" && !level.preannounce ? "Stand by" : "Match the cue")}</Text>
            {isReady ? <Text style={styles.helper}>{daily ? "Ten trials: two easy, two medium with a spoken cue, six hard where the cue comes with the word. Select the matching colour." : "Ignore conflicting information and select the matching colour."}</Text> : null}
            {isReady ? <View style={styles.sample}><TaskIcon type="color" color={SPACE_CADET.white} size={28} /><Text style={[styles.sampleWord, { color: COLORS[0].hex }]}>GREEN</Text></View> : null}
            {phase === "instruction" && level.preannounce && instructionType ? <View style={styles.cueCard}><TaskIcon type={instructionType} color={SPACE_CADET.white} /><Text style={styles.cueLabel}>MATCH THE {targetLabel(instructionType)}</Text></View> : null}
            {phase === "instruction" && !level.preannounce ? <Text style={styles.helper}>The cue appears with the word.</Text> : null}
            {isReady ? <PulsingPrompt color={ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt> : null}
            {(phase === "stimulus" || feedback) && trial ? <>
              <View style={styles.stimulus}><View style={styles.stimulusCue}><TaskIcon type={trial.targetType} color={SPACE_CADET.white} size={28} /></View><Text style={[styles.word, { color: trial.inkColor.hex }]}>{trial.writtenColor.label}</Text></View>
              <View style={styles.answerGrid}>{COLORS.map((color) => <Pressable key={color.key} onPressIn={() => handleChoice(color)} style={({ pressed }) => [styles.answer, { borderColor: color.hex, backgroundColor: color.soft, shadowColor: color.hex }, pressed && styles.pressed]} />)}</View>
            </> : null}
          </View>
        </Pressable>
      </Animated.View> : null}
      {phase === "summary" && summary ? <Animated.View entering={FadeIn.duration(180)} style={styles.summaryPanel}><Text style={styles.kicker}>SESSION ENDED</Text><Text style={styles.summaryTitle}>{summary.score} / 1000</Text><Text style={styles.summaryCaption}>{summary.correct} of {summary.trials} correct</Text><View style={styles.statsCard}><Text style={styles.statLine}>Average response <Text style={styles.statValue}>{summary.average !== null ? `${summary.average} ms` : "—"}</Text></Text><Text style={styles.statLine}>Best response <Text style={styles.statValue}>{summary.best !== null ? `${summary.best} ms` : "—"}</Text></Text><Text style={styles.statLine}>Errors <Text style={styles.statValue}>{summary.errors}</Text></Text><Text style={styles.statLine}>Too slow <Text style={styles.statValue}>{summary.tooSlow}</Text></Text></View><View style={styles.actions}><TouchableOpacity activeOpacity={0.88} onPress={resetToReady} style={styles.primaryButton}><Text style={styles.primaryText}>Play again</Text></TouchableOpacity><TouchableOpacity activeOpacity={0.88} onPress={returnToPreflight} style={styles.secondaryButton}><Text style={styles.secondaryText}>Change settings</Text></TouchableOpacity></View></Animated.View> : null}
    </Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SPACE_CADET.black }, preflightLayer: { ...StyleSheet.absoluteFill, zIndex: 1 }, missionLayer: { flex: 1, backgroundColor: SPACE_CADET.black, zIndex: 2 },
  header: { height: 64, paddingHorizontal: 20, justifyContent: "center" }, backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, backArrow: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 }, pressed: { transform: [{ scale: 0.97 }] },
  playArea: { flex: 1 }, readyTapArea: { flex: 1 }, content: { flex: 1, alignItems: "center", paddingHorizontal: 28, paddingTop: 54 }, kicker: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.9, textAlign: "center", minHeight: 16 }, title: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 30, lineHeight: 37, marginTop: 8, textAlign: "center", minHeight: 43 }, helper: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 21, maxWidth: 300, textAlign: "center", marginTop: 10 }, beginPrompt: { marginTop: 30, minHeight: 22, textAlign: "center" },
  sample: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 30 }, sampleWord: { fontFamily: "Gontserrat-SemiBold", fontSize: 34, letterSpacing: 1.4 },
  cueCard: { width: "100%", maxWidth: 290, minHeight: 130, borderRadius: 26, backgroundColor: SPACE_CADET.surface1, borderWidth: 1, borderColor: "rgba(216,30,91,0.30)", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 48 }, cueLabel: { color: SPACE_CADET.white, fontFamily: "Gontserrat-SemiBold", fontSize: 12, letterSpacing: 1.4 },
  stimulus: { alignItems: "center", justifyContent: "center", minHeight: 154, marginTop: 24 }, stimulusCue: { marginBottom: 14 }, word: { fontFamily: "Gontserrat-SemiBold", fontSize: 39, letterSpacing: 1.4, textAlign: "center" }, answerGrid: { width: "100%", flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10, marginTop: 18 }, answer: { width: "31.5%", minHeight: 58, borderWidth: 1, borderRadius: 16 },
  summaryPanel: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20, paddingBottom: 28 }, summaryTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 33, marginTop: 8 }, summaryCaption: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 18, marginTop: 8 }, statsCard: { width: "100%", backgroundColor: SPACE_CADET.surface1, borderRadius: 22, padding: 20, gap: 12, marginTop: 34 }, statLine: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14 }, statValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 17 }, actions: { width: "100%", gap: 12, paddingTop: 22 }, primaryButton: { minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.white }, primaryText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 16 }, secondaryButton: { minHeight: 52, borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" }, secondaryText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 },
});
