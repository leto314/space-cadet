import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import Animated, { FadeIn } from "react-native-reanimated";

import { GameSetupShell, PickerSetting } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { ensureAudioReady } from "../../utils/audio";
import { endVoiceSession, say, startVoiceSession, stopSpeaking } from "../../utils/voice";
import { triggerSelectionHaptic } from "../../utils/haptics";

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

function randomItem(items) { return items[Math.floor(Math.random() * items.length)]; }
function average(values) { return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null; }
function targetFor(trial) { return trial.targetType === "word" ? trial.writtenColor : trial.targetType === "color" ? trial.inkColor : trial.spokenColor; }
function targetLabel(type) { return type === "word" ? "WORD" : type === "color" ? "INK COLOUR" : "AUDIO"; }

function buildTrials(count, difficulty) {
  return Array.from({ length: count }, () => ({
    targetType: randomItem(difficulty.allowedTargets),
    writtenColor: randomItem(COLORS),
    inkColor: randomItem(COLORS),
    spokenColor: difficulty.useAudio ? randomItem(COLORS) : null,
  }));
}

function TaskIcon({ type, color = SPACE_CADET.white, size = 32 }) {
  if (type === "audio") return <Svg width={size} height={size} viewBox="0 0 32 32"><Path d="M7 18H12L18 23V9L12 14H7Z" fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" /><Path d="M22 12c2 1.5 3 2.7 3 4s-1 2.5-3 4m2.8-10.5c3 2.2 4.2 4.4 4.2 6.5s-1.2 4.3-4.2 6.5" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" /></Svg>;
  if (type === "color") return <Svg width={size} height={size} viewBox="0 0 32 32"><Path d="M3 16c3.5-6.5 8-10 13-10s9.5 3.5 13 10c-3.5 6.5-8 10-13 10S6.5 22.5 3 16Z" fill="none" stroke={color} strokeWidth="2" /><Circle cx="16" cy="16" r="4" fill="none" stroke={color} strokeWidth="2" /></Svg>;
  return <Svg width={size} height={size} viewBox="0 0 32 32"><Rect x="6" y="6" width="20" height="20" rx="4" fill="none" stroke={color} strokeWidth="2" /><Line x1="10" y1="12" x2="22" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" /><Line x1="10" y1="17" x2="22" y2="17" stroke={color} strokeWidth="2" strokeLinecap="round" /><Line x1="10" y1="22" x2="18" y2="22" stroke={color} strokeWidth="2" strokeLinecap="round" /></Svg>;
}

export function SelectiveAttentionGame({ onExit }) {
  const [difficulty, setDifficulty] = useState(difficultyOptions[0]);
  const [roundCount, setRoundCount] = useState(6);
  const [phase, setPhase] = useState("preflight");
  const [trialIndex, setTrialIndex] = useState(0);
  const [trial, setTrial] = useState(null);
  const [results, setResults] = useState([]);
  const timeouts = useRef([]);
  const trialsRef = useRef([]);
  const resultRef = useRef([]);
  const startedAt = useRef(null);
  const audioReadyRef = useRef(false);
  const speechWarmedRef = useRef(false);

  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({
    onPrepareReturn: clearTimers,
    onReturnComplete: () => resetToPreflight(),
  });

  useEffect(() => () => { clearTimers(); endVoiceSession(); }, []);

  const summary = useMemo(() => {
    if (!results.length) return null;
    const correct = results.filter((entry) => entry.correct);
    const times = correct.map((entry) => entry.reactionMs);
    return { accuracy: Math.round((correct.length / results.length) * 100), correct: correct.length, errors: results.length - correct.length, average: average(times), best: times.length ? Math.min(...times) : null };
  }, [results]);

  function clearTimers() { timeouts.current.forEach(clearTimeout); timeouts.current = []; }
  function resetToPreflight() {
    clearTimers();
    stopSpeaking();
    trialsRef.current = [];
    resultRef.current = [];
    startedAt.current = null;
    setTrial(null); setTrialIndex(0); setResults([]); setPhase("preflight");
  }
  function resetToReady() {
    clearTimers(); stopSpeaking(); resultRef.current = []; setResults([]); setTrial(null); setTrialIndex(0); setPhase("ready");
    void ensureAudioReady().then(() => {
      audioReadyRef.current = true;
      if (difficulty.useAudio) void startVoiceSession().then(() => { speechWarmedRef.current = true; });
    });
  }
  function showTrial(index, prepared = trialsRef.current) {
    if (index >= prepared.length) { finishRun(resultRef.current); return; }
    const nextTrial = prepared[index];
    setTrialIndex(index); setTrial(nextTrial); setPhase("instruction");
    timeouts.current.push(setTimeout(() => revealTrial(nextTrial), difficulty.preannounce ? 1450 : 1050));
  }
  function revealTrial(nextTrial) {
    setPhase("stimulus"); startedAt.current = Date.now();
    if (difficulty.useAudio && nextTrial.spokenColor) {
      const announce = () => {
        say(nextTrial.spokenColor.label.toLowerCase(), { language: "en-US", rate: 0.92, pitch: 1 });
      };
      if (audioReadyRef.current) timeouts.current.push(setTimeout(announce, 50));
      else void ensureAudioReady().then(() => { audioReadyRef.current = true; timeouts.current.push(setTimeout(announce, 50)); });
    }
  }
  function beginRun() {
    const prepared = buildTrials(roundCount, difficulty);
    trialsRef.current = prepared; resultRef.current = []; setResults([]); setTrialIndex(0); setTrial(null);
    showTrial(0, prepared);
  }
  function finishRun(finalResults) { clearTimers(); stopSpeaking(); setResults(finalResults); setTrial(null); setPhase("summary"); }
  function handleChoice(color) {
    if (phase !== "stimulus" || !trial || !startedAt.current) return;
    void triggerSelectionHaptic();
    const correct = targetFor(trial).key === color.key;
    const nextResults = [...resultRef.current, { correct, reactionMs: Date.now() - startedAt.current }];
    resultRef.current = nextResults; setResults(nextResults); startedAt.current = null; setPhase(correct ? "correct" : "incorrect");
    timeouts.current.push(setTimeout(() => showTrial(trialIndex + 1), 460));
  }

  const preflight = <GameSetupShell title="Selective Attention" categoryKey="attention" onExit={onExit} onStart={() => startMission(resetToReady)} rules="Tests focus under conflicting cues. Match the requested word, ink colour, or spoken colour.Easy: The cue is shown before each word.Medium: Audio is added to the possible cues.Hard: The cue is revealed with the word.">
    <PickerSetting label="Difficulty" options={difficultyOptions.map((option) => ({ value: option, label: option.label }))} value={difficulty} onChange={setDifficulty} />
    <PickerSetting label="Trials" options={[3, 6, 10].map((value) => ({ value, label: String(value) }))} value={roundCount} onChange={setRoundCount} />
  </GameSetupShell>;

  const instructionType = trial?.targetType;
  const isReady = phase === "ready";
  const feedback = phase === "correct" ? "CORRECT" : phase === "incorrect" ? "NOT QUITE" : null;

  return <View style={styles.container}>
    {phase === "preflight" || isReturning ? <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflight}</Animated.View> : null}
    {phase !== "preflight" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, missionStyle]}>
      <View style={styles.header}><Pressable onPress={returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>
      {phase !== "summary" ? <Animated.View entering={FadeIn.duration(180)} style={styles.playArea}>
        <Pressable disabled={!isReady} onPress={beginRun} style={styles.readyTapArea}>
          <View pointerEvents={isReady ? "none" : "auto"} style={styles.content}>
            <Text style={styles.kicker}>{isReady ? "ATTENTION" : `TRIAL ${trialIndex + 1} / ${roundCount}`}</Text>
            <Text style={styles.title}>{isReady ? "Ready to filter?" : feedback ?? (phase === "instruction" && !difficulty.preannounce ? "Stand by" : "Match the cue")}</Text>
            {isReady ? <Text style={styles.helper}>Ignore conflicting information and select the matching colour.</Text> : null}
            {phase === "instruction" && difficulty.preannounce && instructionType ? <View style={styles.cueCard}><TaskIcon type={instructionType} color={SPACE_CADET.white} /><Text style={styles.cueLabel}>MATCH THE {targetLabel(instructionType)}</Text></View> : null}
            {phase === "instruction" && !difficulty.preannounce ? <Text style={styles.helper}>The cue appears with the word.</Text> : null}
            {isReady ? <PulsingPrompt color={ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt> : null}
            {(phase === "stimulus" || feedback) && trial ? <>
              <View style={styles.stimulus}><View style={styles.stimulusCue}><TaskIcon type={trial.targetType} color={SPACE_CADET.white} size={28} /></View><Text style={[styles.word, { color: trial.inkColor.hex }]}>{trial.writtenColor.label}</Text></View>
              <View style={styles.answerGrid}>{COLORS.map((color) => <Pressable key={color.key} onPressIn={() => handleChoice(color)} style={({ pressed }) => [styles.answer, { borderColor: color.hex, backgroundColor: color.soft, shadowColor: color.hex }, pressed && styles.pressed]} />)}</View>
            </> : null}
          </View>
        </Pressable>
      </Animated.View> : null}
      {phase === "summary" && summary ? <Animated.View entering={FadeIn.duration(180)} style={styles.summaryPanel}><Text style={styles.kicker}>SESSION ENDED</Text><Text style={styles.summaryTitle}>{summary.accuracy}% accuracy</Text><Text style={styles.summaryCaption}>{summary.correct} of {results.length} correct</Text><View style={styles.statsCard}><Text style={styles.statLine}>Average response <Text style={styles.statValue}>{summary.average !== null ? `${summary.average} ms` : "—"}</Text></Text><Text style={styles.statLine}>Best response <Text style={styles.statValue}>{summary.best !== null ? `${summary.best} ms` : "—"}</Text></Text><Text style={styles.statLine}>Errors <Text style={styles.statValue}>{summary.errors}</Text></Text></View><View style={styles.actions}><TouchableOpacity activeOpacity={0.88} onPress={resetToReady} style={styles.primaryButton}><Text style={styles.primaryText}>Play again</Text></TouchableOpacity><TouchableOpacity activeOpacity={0.88} onPress={returnToPreflight} style={styles.secondaryButton}><Text style={styles.secondaryText}>Change settings</Text></TouchableOpacity></View></Animated.View> : null}
    </Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SPACE_CADET.black }, preflightLayer: { ...StyleSheet.absoluteFill, zIndex: 1 }, missionLayer: { flex: 1, backgroundColor: SPACE_CADET.black, zIndex: 2 },
  header: { height: 64, paddingHorizontal: 20, justifyContent: "center" }, backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, backArrow: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 }, pressed: { transform: [{ scale: 0.97 }] },
  playArea: { flex: 1 }, readyTapArea: { flex: 1 }, content: { flex: 1, alignItems: "center", paddingHorizontal: 28, paddingTop: 54 }, kicker: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.9, textAlign: "center", minHeight: 16 }, title: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 30, lineHeight: 37, marginTop: 8, textAlign: "center", minHeight: 43 }, helper: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 21, maxWidth: 300, textAlign: "center", marginTop: 10 }, beginPrompt: { marginTop: 28, minHeight: 22, textAlign: "center" },
  cueCard: { width: "100%", maxWidth: 290, minHeight: 130, borderRadius: 26, backgroundColor: SPACE_CADET.surface1, borderWidth: 1, borderColor: "rgba(216,30,91,0.30)", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 48 }, cueLabel: { color: SPACE_CADET.white, fontFamily: "Gontserrat-SemiBold", fontSize: 12, letterSpacing: 1.4 },
  stimulus: { alignItems: "center", justifyContent: "center", minHeight: 154, marginTop: 24 }, stimulusCue: { marginBottom: 14 }, word: { fontFamily: "Gontserrat-SemiBold", fontSize: 39, letterSpacing: 1.4, textAlign: "center" }, answerGrid: { width: "100%", flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10, marginTop: 18 }, answer: { width: "31.5%", minHeight: 58, borderWidth: 1, borderRadius: 16 },
  summaryPanel: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20, paddingBottom: 28 }, summaryTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 33, marginTop: 8 }, summaryCaption: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 18, marginTop: 8 }, statsCard: { width: "100%", backgroundColor: SPACE_CADET.surface1, borderRadius: 22, padding: 20, gap: 12, marginTop: 34 }, statLine: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14 }, statValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 17 }, actions: { width: "100%", gap: 12, paddingTop: 22 }, primaryButton: { minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.white }, primaryText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 16 }, secondaryButton: { minHeight: 52, borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" }, secondaryText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 },
});
