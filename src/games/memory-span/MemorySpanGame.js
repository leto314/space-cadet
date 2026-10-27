import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import Animated, { FadeIn } from "react-native-reanimated";

import { GameSetupShell, PickerSetting } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { ensureAudioReady } from "../../utils/audio";
import { endVoiceSession, speak, startVoiceSession, stopSpeaking } from "../../utils/voice";
import { triggerSelectionHaptic } from "../../utils/haptics";
import { randomSeed } from "../../utils/random";
import { buildDailyLadder, buildRound, computeResult, DAILY_LADDER, DIFFICULTY_OPTIONS, dailyResult, directionLabel, sequencePoints } from "./logic";

const MEMORY_ACCENT = SPACE_CADET.memory;
const SUCCESS_COLOR = "#34D399";
const ERROR_COLOR = SPACE_CADET.attention;
const numericKeyboardRows = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]];
const alphaKeyboardRows = [["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"], ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"], ["A", "S", "D", "F", "G", "H", "J", "K", "L"], ["Z", "X", "C", "V", "B", "N", "M"]];

function KeyButton({ label, onPress, wide = false, disabled = false }) {
  return <Pressable disabled={disabled} onPress={() => { void triggerSelectionHaptic(); onPress?.(); }} style={({ pressed }) => [styles.key, wide && styles.keyWide, disabled && styles.keyDisabled, pressed && styles.pressed]}><Text style={[styles.keyText, wide && styles.keyTextWide]}>{label}</Text></Pressable>;
}

function NumericKeyboard({ onKeyPress, onDelete, onSubmit, canSubmit }) {
  return <View style={styles.keyboard}>{numericKeyboardRows.map((row) => <View key={row.join("")} style={styles.numericRow}>{row.map((key) => <KeyButton key={key} label={key} onPress={() => onKeyPress(key)} />)}</View>)}<View style={styles.numericRow}><KeyButton label="DELETE" wide onPress={onDelete} /><KeyButton label="0" onPress={() => onKeyPress("0")} /><KeyButton label="SUBMIT" wide onPress={onSubmit} disabled={!canSubmit} /></View></View>;
}

function AlphaKeyboard({ onKeyPress, onDelete, onSubmit, canSubmit }) {
  return <View style={styles.alphaKeyboard}>{alphaKeyboardRows.map((row) => <View key={row.join("")} style={styles.alphaRow}>{row.map((key) => <KeyButton key={key} label={key} onPress={() => onKeyPress(key)} />)}</View>)}<View style={styles.alphaActions}><KeyButton label="DELETE" wide onPress={onDelete} /><KeyButton label="SUBMIT" wide onPress={onSubmit} disabled={!canSubmit} /></View></View>;
}

// `daily` ({ seed, onFinish, onExit }) turns this into the daily training version: no preflight, the day's ladder
// of nine sequences (DAILY_LADDER), then onFinish({ score, metrics, trials }).
export function MemorySpanGame({ onExit, daily = null }) {
  const [selectedDifficulty, setSelectedDifficulty] = useState(DIFFICULTY_OPTIONS[0]);
  const [sequenceLength, setSequenceLength] = useState(5);
  const [phase, setPhase] = useState(daily ? "ready" : "difficulty");
  const [round, setRound] = useState(null);
  const [roundIndex, setRoundIndex] = useState(0);
  const [displaySymbol, setDisplaySymbol] = useState("");
  const [displayIndex, setDisplayIndex] = useState(0);
  const [enteredValue, setEnteredValue] = useState("");
  const [result, setResult] = useState(null);

  const timeouts = useRef([]);
  const phaseRef = useRef(daily ? "ready" : "difficulty");
  const ladderRef = useRef(daily ? buildDailyLadder(daily.seed) : []);
  const resultsRef = useRef([]);
  const recallStartedAt = useRef(0);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { if (daily) setRound(ladderRef.current[0]); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { timeouts.current.forEach(clearTimeout); endVoiceSession(); }, []);

  const config = round?.config ?? selectedDifficulty;
  const length = round?.length ?? sequenceLength;
  const direction = round?.direction ?? "forward";
  const sequence = round?.sequence ?? [];
  const totalRounds = daily ? DAILY_LADDER.length : 1;

  function clearAllTimeouts() { timeouts.current.forEach(clearTimeout); timeouts.current = []; }
  function resetRun(nextDifficulty = selectedDifficulty, nextLength = sequenceLength) {
    clearAllTimeouts(); stopSpeaking();
    setSelectedDifficulty(nextDifficulty ?? selectedDifficulty);
    setSequenceLength(nextLength);
    setPhase(nextDifficulty ? "ready" : "difficulty");
    setRound(nextDifficulty ? buildRound({ difficulty: (nextDifficulty ?? selectedDifficulty).key, length: nextLength }, randomSeed()) : null);
    setDisplaySymbol(""); setDisplayIndex(0); setEnteredValue(""); setResult(null);
  }

  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({
    onPrepareReturn: () => { clearAllTimeouts(); stopSpeaking(); },
    onReturnComplete: () => resetRun(null, sequenceLength),
  });

  async function speakItem(items, index) {
    if (index >= items.length) { setDisplaySymbol(""); recallStartedAt.current = Date.now(); setPhase("recall"); return; }
    const item = items[index];
    setDisplayIndex(index + 1);
    setDisplaySymbol(config.showCharacters ? item.symbol : "");
    await ensureAudioReady();
    speak(item.spoken, { language: "en-US", rate: config.allowLetters ? 0.88 : 0.84, pitch: 1, onDone: () => {
      timeouts.current.push(setTimeout(() => { if (phaseRef.current === "playing") speakItem(items, index + 1); }, config.allowLetters ? 260 : 340));
    }});
  }

  async function startSequence() {
    clearAllTimeouts(); stopSpeaking();
    const current = round ?? buildRound({ difficulty: selectedDifficulty.key, length: sequenceLength }, randomSeed());
    setRound(current); setDisplaySymbol(""); setDisplayIndex(0); setEnteredValue(""); setResult(null); setPhase("playing");
    await ensureAudioReady();
    requestAnimationFrame(() => {
      if (phaseRef.current !== "playing") return;
      let hasStarted = false;
      const beginFirstItem = () => {
        if (hasStarted) return;
        hasStarted = true;
        if (phaseRef.current === "playing") speakItem(current.sequence, 0);
      };
      void startVoiceSession().then(beginFirstItem, beginFirstItem);
      timeouts.current.push(setTimeout(beginFirstItem, 220));
    });
  }

  function appendCharacter(character) { if (phase === "recall" && enteredValue.length < sequence.length) setEnteredValue((value) => `${value}${character}`); }
  function removeCharacter() { if (phase === "recall") setEnteredValue((value) => value.slice(0, -1)); }
  function submitAnswer() {
    if (phase !== "recall") return;
    const outcome = computeResult(sequence, enteredValue, direction);
    if (daily) resultsRef.current = [...resultsRef.current, { ...outcome, length: round.length, difficulty: round.difficulty, ms: Date.now() - recallStartedAt.current }];
    setResult(outcome); setPhase("result");
  }
  function nextSequence() {
    void triggerSelectionHaptic();
    const next = roundIndex + 1;
    if (next >= ladderRef.current.length) { endVoiceSession(); daily.onFinish(dailyResult(resultsRef.current)); return; }
    clearAllTimeouts(); stopSpeaking();
    setRoundIndex(next); setRound(ladderRef.current[next]); setDisplaySymbol(""); setDisplayIndex(0); setEnteredValue(""); setResult(null); setPhase("ready");
  }

  const readyHelper = daily
    ? `${config.showCharacters ? "Digits on screen and spoken" : "Letters and digits, spoken only"} · ${length} characters · ${config.revealDirectionEarly ? `recall ${directionLabel(direction).toLowerCase()}` : "direction revealed at recall"}`
    : config.revealDirectionEarly ? `Recall the sequence ${directionLabel(direction).toLowerCase()}.` : "The recall direction will be revealed at the end.";
  const preflightScreen = <GameSetupShell title="Memory Sequences" categoryKey="memory" onExit={onExit} onStart={() => startMission(() => resetRun(selectedDifficulty, sequenceLength))} rules="Tests immediate sequence recall. Memorize the sequence, then enter it in the requested order. Easy: visible digits and direction shown early. Medium: visible digits with a direction revealed only at recall. Hard: audio-only NATO-style letters and digits."><PickerSetting label="Difficulty" options={DIFFICULTY_OPTIONS.map((option) => ({ value: option, label: option.label }))} value={selectedDifficulty} onChange={setSelectedDifficulty} /><PickerSetting label="Sequence length" options={Array.from({ length: 9 }, (_, index) => ({ value: index + 2, label: String(index + 2) }))} value={sequenceLength} onChange={setSequenceLength} /></GameSetupShell>;
  return <View style={styles.container}>
    {phase === "difficulty" || isReturning ? <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflightScreen}</Animated.View> : null}
    {phase !== "difficulty" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionScreen, !daily && missionStyle]}>
      <View style={styles.headerRow}><Pressable onPress={daily ? daily.onExit : returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>
      {phase === "ready" ? <Pressable onPress={startSequence} style={styles.readyPanel}><Text style={styles.kicker}>{daily ? `DAILY TRAINING · SEQUENCE ${roundIndex + 1} / ${totalRounds}` : "MEMORY"}</Text><Text style={styles.title}>Ready to memorize?</Text><Text style={styles.helper}>{readyHelper}</Text><PulsingPrompt color={MEMORY_ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt></Pressable> : null}
      {phase === "playing" ? <Animated.View entering={FadeIn.duration(160)} style={styles.playPanel}><Text style={styles.kicker}>{config.showCharacters ? `MEMORIZE ${displayIndex} / ${length}` : `LISTEN ${displayIndex} / ${length}`}</Text><Text style={styles.title}>{config.showCharacters ? "Hold the sequence" : "Listen closely"}</Text><View style={[styles.symbolCard, { borderColor: `${MEMORY_ACCENT}90` }]}><Text style={[styles.symbol, !displaySymbol && styles.symbolPlaceholder]}>{displaySymbol}</Text></View></Animated.View> : null}
      {phase === "recall" ? <Animated.View entering={FadeIn.duration(180)} style={styles.recallPanel}><Text style={styles.kicker}>RECALL · {directionLabel(direction)}{daily ? ` · ${roundIndex + 1} / ${totalRounds}` : ""}</Text><Text style={styles.title}>Enter the sequence</Text><View style={styles.answerScreen}><Text style={[styles.answerValue, !enteredValue && styles.answerDirectionPlaceholder]}>{enteredValue.split("").join(" ") || (direction === "reverse" ? "←" : "→")}</Text><Text style={styles.answerMeta}>{enteredValue.length} / {sequence.length}</Text></View>{config.allowLetters ? <AlphaKeyboard onKeyPress={appendCharacter} onDelete={removeCharacter} onSubmit={submitAnswer} canSubmit={enteredValue.length > 0} /> : <NumericKeyboard onKeyPress={appendCharacter} onDelete={removeCharacter} onSubmit={submitAnswer} canSubmit={enteredValue.length > 0} />}</Animated.View> : null}
      {phase === "result" && result ? <Animated.View entering={FadeIn.duration(180)} style={styles.resultPanel}><Text style={styles.kicker}>{daily ? `SEQUENCE ${roundIndex + 1} / ${totalRounds} · ${Math.round(sequencePoints(result))} POINTS` : "SESSION ENDED"}</Text><Text style={styles.title}>{result.accuracy}% accuracy</Text><Text style={styles.helper}>{result.wrongDirection ? "Wrong direction." : `${result.correctPositions} of ${result.total} positions correct.`}</Text><View style={styles.resultCard}><Text style={styles.resultLabel}>EXPECTED</Text><Text style={styles.resultValue}>{result.targetDisplay}</Text><Text style={styles.resultLabel}>YOUR RESPONSE</Text><View style={styles.responseSequence}>{result.enteredSymbols.length ? result.enteredSymbols.map((symbol, index) => <Text key={`${symbol}-${index}`} style={[styles.responseSymbol, { color: symbol === result.targetSymbols[index] ? SUCCESS_COLOR : ERROR_COLOR }]}>{symbol}</Text>) : <Text style={styles.resultValue}>—</Text>}</View></View><View style={styles.footerActions}>{daily
        ? <TouchableOpacity activeOpacity={0.9} onPress={nextSequence} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{roundIndex + 1 >= totalRounds ? "View results" : "Next sequence"}</Text></TouchableOpacity>
        : <><TouchableOpacity activeOpacity={0.9} onPress={() => resetRun(selectedDifficulty, sequenceLength)} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Play again</Text></TouchableOpacity><TouchableOpacity activeOpacity={0.9} onPress={returnToPreflight} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Change settings</Text></TouchableOpacity></>}</View></Animated.View> : null}
    </Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SPACE_CADET.black }, missionScreen: { flex: 1, backgroundColor: SPACE_CADET.black, zIndex: 2 }, preflightLayer: { ...StyleSheet.absoluteFill, zIndex: 1 },
  headerRow: { height: 64, paddingHorizontal: 20, justifyContent: "center" }, backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, backArrow: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 }, pressed: { transform: [{ scale: 0.97 }] },
  readyPanel: { flex: 1, alignItems: "center", paddingHorizontal: 24, paddingTop: 126 }, playPanel: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 116 }, recallPanel: { flex: 1, paddingHorizontal: 20, paddingTop: 66 }, resultPanel: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 88 },
  kicker: { color: MEMORY_ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.8, textAlign: "center", minHeight: 16 }, title: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 29, lineHeight: 36, textAlign: "center", marginTop: 8 }, helper: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 22, textAlign: "center", marginTop: 12, maxWidth: 310 }, beginPrompt: { color: MEMORY_ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 12, letterSpacing: 1.8, marginTop: 48 },
  symbolCard: { width: 206, height: 206, borderRadius: 32, borderWidth: 1, backgroundColor: SPACE_CADET.surface1, alignItems: "center", justifyContent: "center", marginTop: 48, shadowColor: MEMORY_ACCENT, shadowOpacity: 0.22, shadowRadius: 24, shadowOffset: { width: 0, height: 0 } }, symbol: { color: MEMORY_ACCENT, fontFamily: "Garet-Book", fontSize: 78 }, symbolPlaceholder: { color: SPACE_CADET.textTertiary },
  answerScreen: { minHeight: 92, width: "100%", borderRadius: 22, backgroundColor: SPACE_CADET.surface1, alignItems: "center", justifyContent: "center", marginTop: 30, marginBottom: 18, paddingHorizontal: 52 }, answerValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 30, letterSpacing: 2, textAlign: "center" }, answerDirectionPlaceholder: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Light", opacity: 0.55 }, answerMeta: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 12, marginTop: 7 },
  keyboard: { gap: 10 }, numericRow: { flexDirection: "row", gap: 10 }, key: { flex: 1, height: 58, borderRadius: 16, backgroundColor: SPACE_CADET.surface2, alignItems: "center", justifyContent: "center" }, keyWide: { flex: 1.35 }, keyDisabled: { opacity: 0.35 }, keyText: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 24 }, keyTextWide: { fontFamily: "Gontserrat-Regular", fontSize: 11, letterSpacing: 0.8 },
  alphaKeyboard: { gap: 7, marginTop: 0 }, alphaRow: { flexDirection: "row", justifyContent: "center", gap: 5 }, alphaRowText: {}, alphaKeyboardKey: {}, alphaActions: { flexDirection: "row", justifyContent: "center", gap: 10, marginTop: 4 },
  resultCard: { width: "100%", backgroundColor: SPACE_CADET.surface1, borderRadius: 22, padding: 20, marginTop: 32 }, resultLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.4, marginBottom: 6 }, resultValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 23, letterSpacing: 1.4, marginBottom: 20 }, responseSequence: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginBottom: 4 }, responseSymbol: { fontFamily: "Garet-Book", fontSize: 23, letterSpacing: 1.2 }, footerActions: { width: "100%", gap: 12, paddingTop: 22 }, primaryButton: { minHeight: 54, borderRadius: 999, backgroundColor: SPACE_CADET.white, alignItems: "center", justifyContent: "center" }, primaryButtonText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 16 }, secondaryButton: { minHeight: 52, borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" }, secondaryButtonText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 },
});
