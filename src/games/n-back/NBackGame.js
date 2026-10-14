import { createAudioPlayer } from "expo-audio";
import { Pressable, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import Animated, { FadeIn } from "react-native-reanimated";
import { useEffect, useMemo, useRef, useState } from "react";

import { GameSetupShell, PickerSetting } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { ensureAudioReady as ensureAppAudioReady } from "../../utils/audio";
import { endVoiceSession, say, startVoiceSession, stopSpeaking } from "../../utils/voice";
import { triggerSelectionHaptic } from "../../utils/haptics";

const TOTAL_TRIALS = 30;
const START_DELAY_MS = 1100;
const TRIAL_INTERVAL_MS = 1700;
const STIMULUS_VISIBLE_MS = 760;
const GRID_GAP = 10;
const ACCENT = SPACE_CADET.memory;
const DIGIT_WORDS = { 0: "zero", 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine" };
const LETTER_POOL = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "R"];
const ALPHANUMERIC_POOL = [..."0123456789", ...LETTER_POOL].map((symbol) => ({ symbol, spoken: DIGIT_WORDS[symbol] ?? symbol.toLowerCase() }));
const GRID_POSITIONS = Array.from({ length: 9 }, (_, index) => index);

const difficultyOptions = [
  { key: "easy", label: "EASY", recommendedN: 1, channels: ["audio"], showCharacter: true, showGrid: false, minimumTargets: 10, ready: "Listen to each character. Tap when it repeats N steps back." },
  { key: "medium", label: "MEDIUM", recommendedN: 2, channels: ["visual"], showCharacter: false, showGrid: true, minimumTargets: 10, ready: "Watch the lit square. Tap when its position repeats N steps back." },
  { key: "hard", label: "HARD", recommendedN: 2, channels: ["audio", "visual"], showCharacter: false, showGrid: true, minimumTargets: 12, ready: "Monitor both streams. Use the left control for audio and right for position." },
];

function randomItem(items) { return items[Math.floor(Math.random() * items.length)]; }
function shuffle(items) { const copy = [...items]; for (let index = copy.length - 1; index > 0; index -= 1) { const swap = Math.floor(Math.random() * (index + 1)); [copy[index], copy[swap]] = [copy[swap], copy[index]]; } return copy; }
function pickDifferent(pool, current) { return randomItem(pool.filter((item) => item !== current)); }
function buildSequence(pool, length, nValue, minimumTargets) {
  const targetIndices = new Set(shuffle(Array.from({ length: Math.max(0, length - nValue) }, (_, index) => index + nValue)).slice(0, minimumTargets + Math.floor(Math.random() * 3)));
  const sequence = [];
  for (let index = 0; index < length; index += 1) sequence.push(index < nValue ? randomItem(pool) : targetIndices.has(index) ? sequence[index - nValue] : pickDifferent(pool, sequence[index - nValue]));
  return sequence;
}
function countTargets(sequence, nValue) { return sequence.reduce((count, item, index) => count + Number(index >= nValue && item === sequence[index - nValue]), 0); }
function getChannelSummary({ hits, misses, falseAlarms, targets, reactionTimes, evaluatedTrials }) {
  const nonTargets = Math.max(evaluatedTrials - targets, 0);
  const correctRejections = Math.max(nonTargets - falseAlarms, 0);
  return { accuracy: evaluatedTrials ? Math.round(((hits + correctRejections) / evaluatedTrials) * 100) : 0, hits, misses, falseAlarms, targets, average: reactionTimes.length ? Math.round(reactionTimes.reduce((sum, value) => sum + value, 0) / reactionTimes.length) : null };
}

function ControlIcon({ type, size = 28, color = SPACE_CADET.black }) {
  if (type === "audio") return <Svg width={size} height={size} viewBox="0 0 32 32"><Path d="M7 18H12L18 23V9L12 14H7Z" fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" /><Path d="M22 12c2 1.5 3 2.7 3 4s-1 2.5-3 4" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" /></Svg>;
  return <Svg width={size} height={size} viewBox="0 0 32 32"><Path d="M3 16c3.5-6.5 8-10 13-10s9.5 3.5 13 10c-3.5 6.5-8 10-13 10S6.5 22.5 3 16Z" fill="none" stroke={color} strokeWidth="2.2" /><Circle cx="16" cy="16" r="4.2" fill="none" stroke={color} strokeWidth="2.2" /></Svg>;
}

function GridMatrix({ activeIndex, cellSize }) {
  return <View style={[styles.grid, { gap: GRID_GAP, width: cellSize * 3 + GRID_GAP * 2 }]}>{GRID_POSITIONS.map((index) => <View key={index} style={[styles.gridCell, { width: cellSize, height: cellSize }, activeIndex === index && styles.gridCellActive]} />)}</View>;
}

function SummaryCard({ label, result }) {
  if (!result) return null;
  return <View style={styles.summaryCard}><Text style={styles.summaryChannel}>{label}</Text><Text style={styles.summaryMetric}>{result.accuracy}% accuracy</Text><Text style={styles.summaryLine}>Matches <Text style={styles.summaryValue}>{result.hits} / {result.targets}</Text></Text><Text style={styles.summaryLine}>Misses <Text style={styles.summaryValue}>{result.misses}</Text></Text><Text style={styles.summaryLine}>False alarms <Text style={styles.summaryValue}>{result.falseAlarms}</Text></Text><Text style={styles.summaryLine}>Average response <Text style={styles.summaryValue}>{result.average !== null ? `${result.average} ms` : "—"}</Text></Text></View>;
}

export function NBackGame({ onExit }) {
  const { width } = useWindowDimensions();
  const matrixSize = Math.min(width - 82, 300);
  const cellSize = (matrixSize - GRID_GAP * 2) / 3;
  const [difficulty, setDifficulty] = useState(difficultyOptions[0]);
  const [nValue, setNValue] = useState(1);
  const [phase, setPhase] = useState("preflight");
  const [audioItem, setAudioItem] = useState(null);
  const [visualIndex, setVisualIndex] = useState(null);
  const [progress, setProgress] = useState(0);
  const [feedback, setFeedback] = useState({ audio: "idle", visual: "idle" });
  const [summary, setSummary] = useState({ audio: null, visual: null });
  const timers = useRef([]);
  const phaseRef = useRef("preflight");
  const audioSequence = useRef([]);
  const visualSequence = useRef([]);
  const trialIndex = useRef(-1);
  const trialStarted = useRef(0);
  const responses = useRef([]);
  const stats = useRef(null);
  const beep = useRef(null);
  const audioSetup = useRef(null);
  const beepWarmed = useRef(false);
  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({ onPrepareReturn: clearTimers, onReturnComplete: resetToPreflight });

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { void prepareAudio(); return () => { clearTimers(); endVoiceSession(); beep.current?.remove(); }; }, []);

  function clearTimers() { timers.current.forEach(clearTimeout); timers.current = []; }
  async function prepareAudio() {
    if (!audioSetup.current) audioSetup.current = (async () => {
      await ensureAppAudioReady();
      if (!beep.current) beep.current = createAudioPlayer(require("../../assets/sounds/nback-beep.wav"));
      if (!beepWarmed.current) {
        beep.current.volume = 0;
        beep.current.play();
        await new Promise((resolve) => setTimeout(resolve, 180));
        beep.current.pause();
        await beep.current.seekTo(0);
        beep.current.volume = 0.28;
        beepWarmed.current = true;
      }
    })().catch(() => { audioSetup.current = null; });
    await audioSetup.current;
  }
  function resetToPreflight() { clearTimers(); stopSpeaking(); setAudioItem(null); setVisualIndex(null); setProgress(0); setFeedback({ audio: "idle", visual: "idle" }); setSummary({ audio: null, visual: null }); setPhase("preflight"); }
  function resetToReady() {
    clearTimers(); stopSpeaking(); setAudioItem(null); setVisualIndex(null); setProgress(0); setFeedback({ audio: "idle", visual: "idle" }); setSummary({ audio: null, visual: null }); setPhase("ready");
    void prepareAudio();
  }
  function buildStats(nextAudio, nextVisual) {
    return { evaluated: TOTAL_TRIALS - nValue, audioTargets: difficulty.channels.includes("audio") ? countTargets(nextAudio, nValue) : 0, visualTargets: difficulty.channels.includes("visual") ? countTargets(nextVisual, nValue) : 0, audioHits: 0, audioMisses: 0, audioFalse: 0, visualHits: 0, visualMisses: 0, visualFalse: 0, audioTimes: [], visualTimes: [] };
  }
  async function beginRun() {
    await prepareAudio();
    if (difficulty.channels.includes("audio")) await startVoiceSession();
    const nextAudio = difficulty.channels.includes("audio") ? buildSequence(ALPHANUMERIC_POOL, TOTAL_TRIALS, nValue, difficulty.minimumTargets) : [];
    const nextVisual = difficulty.channels.includes("visual") ? buildSequence(GRID_POSITIONS, TOTAL_TRIALS, nValue, difficulty.minimumTargets) : [];
    audioSequence.current = nextAudio; visualSequence.current = nextVisual; stats.current = buildStats(nextAudio, nextVisual); responses.current = Array.from({ length: TOTAL_TRIALS }, () => ({ audio: false, visual: false })); trialIndex.current = -1; setProgress(0); setSummary({ audio: null, visual: null }); setPhase("playing");
    timers.current.push(setTimeout(() => scheduleTrial(0), START_DELAY_MS));
  }
  async function playBeep() { try { if (!beep.current) return; await beep.current.seekTo(0); beep.current.play(); } catch {} }
  function speak(item) { if (!item) return; say(item.spoken, { language: "en-US", rate: 0.92, pitch: 1 }); }
  function commitMisses(index) {
    if (index < nValue) return;
    const response = responses.current[index];
    if (difficulty.channels.includes("audio") && audioSequence.current[index] === audioSequence.current[index - nValue] && !response.audio) stats.current.audioMisses += 1;
    if (difficulty.channels.includes("visual") && visualSequence.current[index] === visualSequence.current[index - nValue] && !response.visual) stats.current.visualMisses += 1;
  }
  function scheduleTrial(index) {
    if (index >= TOTAL_TRIALS) { finishRun(); return; }
    trialIndex.current = index; trialStarted.current = Date.now(); responses.current[index] = { audio: false, visual: false }; setProgress(index + 1); setFeedback({ audio: "idle", visual: "idle" });
    const nextAudio = difficulty.channels.includes("audio") ? audioSequence.current[index] : null;
    const nextVisual = difficulty.channels.includes("visual") ? visualSequence.current[index] : null;
    setAudioItem(difficulty.showCharacter ? nextAudio : null); setVisualIndex(nextVisual);
    if (difficulty.channels.includes("audio")) speak(nextAudio);
    if (difficulty.channels.includes("visual")) void playBeep();
    timers.current.push(setTimeout(() => { if (phaseRef.current === "playing") { setAudioItem(null); setVisualIndex(null); } }, STIMULUS_VISIBLE_MS));
    timers.current.push(setTimeout(() => { if (phaseRef.current === "playing") { commitMisses(index); scheduleTrial(index + 1); } }, TRIAL_INTERVAL_MS));
  }
  function finishRun() {
    clearTimers(); stopSpeaking(); setAudioItem(null); setVisualIndex(null); setFeedback({ audio: "idle", visual: "idle" }); const current = stats.current;
    setSummary({
      audio: difficulty.channels.includes("audio") ? getChannelSummary({ hits: current.audioHits, misses: current.audioMisses, falseAlarms: current.audioFalse, targets: current.audioTargets, reactionTimes: current.audioTimes, evaluatedTrials: current.evaluated }) : null,
      visual: difficulty.channels.includes("visual") ? getChannelSummary({ hits: current.visualHits, misses: current.visualMisses, falseAlarms: current.visualFalse, targets: current.visualTargets, reactionTimes: current.visualTimes, evaluatedTrials: current.evaluated }) : null,
    }); setPhase("summary");
  }
  async function register(channel) {
    if (phase !== "playing" || trialIndex.current < 0) return;
    const index = trialIndex.current; const currentResponse = responses.current[index];
    if (currentResponse[channel]) return;
    currentResponse[channel] = true; await triggerSelectionHaptic();
    const target = index >= nValue && (channel === "audio" ? audioSequence.current[index] === audioSequence.current[index - nValue] : visualSequence.current[index] === visualSequence.current[index - nValue]);
    setFeedback((current) => ({ ...current, [channel]: target ? "correct" : "wrong" }));
    if (target) {
      if (channel === "audio") { stats.current.audioHits += 1; stats.current.audioTimes.push(Date.now() - trialStarted.current); }
      else { stats.current.visualHits += 1; stats.current.visualTimes.push(Date.now() - trialStarted.current); }
    } else if (channel === "audio") stats.current.audioFalse += 1;
    else stats.current.visualFalse += 1;
  }

  const preflight = <GameSetupShell title="N-back" categoryKey="memory" onExit={onExit} onStart={() => startMission(resetToReady)} rules="Tests working-memory updating. Mark a match when the current item repeats the item from N steps earlier.Easy: Listen for repeated characters.Medium: Watch for repeated grid positions.Hard: Monitor both channels at once."><PickerSetting label="Difficulty" options={difficultyOptions.map((option) => ({ value: option, label: option.label }))} value={difficulty} onChange={setDifficulty} /><PickerSetting label="N value" options={[1, 2, 3, 4, 5].map((value) => ({ value, label: String(value) }))} value={nValue} onChange={setNValue} /></GameSetupShell>;
  const activeChannels = difficulty.channels;

  return <View style={styles.container}>
    {phase === "preflight" || isReturning ? <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflight}</Animated.View> : null}
    {phase !== "preflight" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, missionStyle]}>
      <View style={styles.header}><Pressable onPress={returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>
      {phase === "ready" ? <Pressable onPress={beginRun} style={styles.readyScreen}><Text style={styles.kicker}>MEMORY</Text><Text style={styles.readyTitle}>Ready for {nValue}-back?</Text><Text style={styles.readyText}>{difficulty.ready}</Text>{difficulty.showGrid ? <View style={styles.readyGrid}><GridMatrix activeIndex={4} cellSize={cellSize * 0.62} /></View> : null}<PulsingPrompt color={ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt></Pressable> : null}
      {phase === "playing" ? <Animated.View entering={FadeIn.duration(160)} style={styles.playScreen}><Text style={styles.progress}>TRIAL {progress} / {TOTAL_TRIALS} · {nValue}-BACK</Text><View style={styles.stage}>{difficulty.showGrid ? <GridMatrix activeIndex={visualIndex} cellSize={cellSize} /> : null}{difficulty.showCharacter ? <Text style={styles.character}>{audioItem?.symbol ?? ""}</Text> : null}</View><View style={[styles.responseRow, activeChannels.length === 1 && styles.responseRowSingle]}>{activeChannels.map((channel) => <Pressable key={channel} onPressIn={() => register(channel)} style={({ pressed }) => [styles.responseButton, activeChannels.length === 1 && styles.responseButtonSingle, feedback[channel] === "correct" && styles.responseCorrect, feedback[channel] === "wrong" && styles.responseWrong, pressed && styles.pressed]}>{activeChannels.length === 2 ? <ControlIcon type={channel} /> : <Text style={styles.matchText}>MATCH</Text>}</Pressable>)}</View></Animated.View> : null}
      {phase === "summary" ? <Animated.View entering={FadeIn.duration(180)} style={styles.summaryScreen}><Text style={styles.kicker}>SESSION ENDED</Text><Text style={styles.summaryTitle}>{nValue}-back complete</Text><Text style={styles.summaryCaption}>{TOTAL_TRIALS} stimuli processed</Text><SummaryCard label="AUDIO" result={summary.audio} /><SummaryCard label="POSITION" result={summary.visual} /><View style={styles.actions}><TouchableOpacity activeOpacity={0.88} onPress={resetToReady} style={styles.primaryButton}><Text style={styles.primaryText}>Play again</Text></TouchableOpacity><TouchableOpacity activeOpacity={0.88} onPress={returnToPreflight} style={styles.secondaryButton}><Text style={styles.secondaryText}>Change settings</Text></TouchableOpacity></View></Animated.View> : null}
    </Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SPACE_CADET.black }, preflightLayer: { ...StyleSheet.absoluteFill, zIndex: 1 }, missionLayer: { flex: 1, backgroundColor: SPACE_CADET.black, zIndex: 2 },
  header: { height: 64, paddingHorizontal: 20, justifyContent: "center" }, backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, backArrow: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 }, pressed: { transform: [{ scale: 0.97 }] },
  kicker: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.9, textAlign: "center" },
  readyScreen: { flex: 1, alignItems: "center", paddingHorizontal: 28, paddingTop: 56 }, readyTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 31, marginTop: 9, textAlign: "center" }, readyText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 21, maxWidth: 302, textAlign: "center", marginTop: 12 }, readyGrid: { marginTop: 42, overflow: "visible" }, beginPrompt: { marginTop: 42, textAlign: "center" },
  playScreen: { flex: 1, alignItems: "center", paddingHorizontal: 28, paddingBottom: 28 }, progress: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.7, marginTop: 38 }, stage: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 310, overflow: "visible" }, character: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 130, lineHeight: 150 }, grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", overflow: "visible" }, gridCell: { borderRadius: 17, backgroundColor: SPACE_CADET.surface1, borderWidth: 1, borderColor: "transparent", zIndex: 1 }, gridCellActive: { backgroundColor: "#1E3210", borderColor: ACCENT, shadowColor: ACCENT, shadowOpacity: 0.38, shadowRadius: 18, shadowOffset: { width: 0, height: 0 }, elevation: 8, zIndex: 2 },
  responseRow: { width: "100%", flexDirection: "row", gap: 12 }, responseRowSingle: { justifyContent: "center" }, responseButton: { flex: 1, minHeight: 64, borderRadius: 19, backgroundColor: ACCENT, alignItems: "center", justifyContent: "center" }, responseButtonSingle: { maxWidth: 300 }, responseCorrect: { backgroundColor: "#34D399" }, responseWrong: { backgroundColor: SPACE_CADET.attention }, matchText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-SemiBold", fontSize: 12, letterSpacing: 1.5 },
  summaryScreen: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 58, paddingBottom: 28 }, summaryTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 31, marginTop: 8 }, summaryCaption: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 17, marginTop: 8, marginBottom: 26 }, summaryCard: { width: "100%", backgroundColor: SPACE_CADET.surface1, borderRadius: 22, padding: 18, marginBottom: 12 }, summaryChannel: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.7 }, summaryMetric: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 25, marginTop: 7, marginBottom: 12 }, summaryLine: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13, lineHeight: 20 }, summaryValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 15 }, actions: { width: "100%", gap: 12, marginTop: "auto" }, primaryButton: { minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.white }, primaryText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 16 }, secondaryButton: { minHeight: 52, borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" }, secondaryText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 },
});
