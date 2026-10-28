import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { ChoiceButton, ChoiceRow, GameSetupShell, PickerSetting, PressScaleButton, SettingCard } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { randomSeed } from "../../utils/random";
import { buildDailySession, buildSession, dailyResult, DAILY_SCENARIOS, isNumericQuestion } from "./logic";

const ACCENT = SPACE_CADET.logic;
const SUCCESS = "#34D399";
const ERROR = SPACE_CADET.attention;
const CORRECT_PAUSE_MS = 1000;
const WRONG_PAUSE_MS = 2400;

function formatSeconds(ms) { return (ms / 1000).toFixed(1); }

function Sentence({ template, actors, names, style, nameStyle }) {
  return <Text style={style}>{template.split(/(\{[ABC]\})/).map((part, index) => {
    const slot = part.match(/^\{([ABC])\}$/)?.[1];
    return slot ? <Text key={index} style={nameStyle}>{names[actors[slot]]}</Text> : <Text key={index}>{part}</Text>;
  })}</Text>;
}

function ClueCard({ scenario, hidden }) {
  if (hidden) return <View style={[styles.clueCard, styles.clueCardHidden]}><Text style={styles.hiddenText}>Briefing hidden. Answer from memory.</Text></View>;
  return <View style={styles.clueCard}>
    {scenario.clues.map((clue, index) => <View key={clue.key} style={styles.clueRow}>
      <Text style={styles.clueIndex}>{String(index + 1).padStart(2, "0")}</Text>
      <Sentence template={clue.template} actors={clue.actors} names={scenario.names} style={styles.clueText} nameStyle={styles.clueName} />
    </View>)}
  </View>;
}

const ANSWER_GAP = 10;

function AnswerButton({ option, numeric, state, disabled, onPress, width }) {
  return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.answer, { width }, state === "correct" && styles.answerCorrect, state === "wrong" && styles.answerWrong, pressed && styles.answerPressed]}>
    <Text numberOfLines={1} adjustsFontSizeToFit style={[numeric ? styles.answerNumber : styles.answerText, state === "correct" && { color: SUCCESS }, state === "wrong" && { color: ERROR }]}>{option.label}</Text>
  </Pressable>;
}

// Options are laid out in rows of equal-width buttons: 2 or 4 options → 2 per row, otherwise 3 per row, with a
// shorter last row centred (5 → 3 + 2). Widths come from the measured container so rows never wrap unevenly.
function AnswerGrid({ options, renderOption }) {
  const [width, setWidth] = useState(0);
  const columns = options.length === 2 || options.length === 4 ? 2 : 3;
  const buttonWidth = width ? (width - ANSWER_GAP * (columns - 1)) / columns : 0;
  const rows = [];
  for (let start = 0; start < options.length; start += columns) rows.push(options.slice(start, start + columns));
  return <View style={styles.answerGrid} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    {buttonWidth ? rows.map((row, rowIndex) => <View key={rowIndex} style={styles.answerRow}>{row.map((option) => renderOption(option, buttonWidth))}</View>) : null}
  </View>;
}

// `daily` ({ seed, onFinish, onExit }) turns this into the daily training version: no preflight, the day's eight
// scenarios (DAILY_SCENARIOS), 125 points each, then onFinish({ score, metrics, trials }).
export function LandingOrderGame({ onExit, daily = null }) {
  const [aircraftCount, setAircraftCount] = useState(4);
  const [scenarioCount, setScenarioCount] = useState(5);
  const [memorise, setMemorise] = useState(false);
  const [phase, setPhase] = useState(daily ? "ready" : "preflight");
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [results, setResults] = useState([]);
  const phaseRef = useRef(daily ? "ready" : "preflight");
  const settingsRef = useRef(null);
  const scenariosRef = useRef([]);
  const resultsRef = useRef([]);
  const sessionStartedAt = useRef(0);
  const scenarioStartedAt = useRef(0);
  const intervalRef = useRef(null);
  const timeouts = useRef([]);
  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({ onPrepareReturn: clearTimers, onReturnComplete: resetToPreflight });

  useEffect(() => () => clearTimers(), []);
  function clearTimers() { clearInterval(intervalRef.current); intervalRef.current = null; timeouts.current.forEach(clearTimeout); timeouts.current = []; }
  function goTo(nextPhase) { phaseRef.current = nextPhase; setPhase(nextPhase); }
  function resetToPreflight() { clearTimers(); scenariosRef.current = []; setResults([]); goTo("preflight"); }
  function resetToReady() { clearTimers(); resultsRef.current = []; setResults([]); setIndex(0); setSelected(null); setElapsed(0); goTo("ready"); }
  function prepareRun() { settingsRef.current = { aircraftCount, scenarioCount, memorise }; startMission(resetToReady); }
  function showScenario(nextIndex) {
    setIndex(nextIndex); setSelected(null);
    scenarioStartedAt.current = Date.now();
    goTo(scenariosRef.current[nextIndex].memorise ? "briefing" : "question");
  }
  function beginRun() {
    void triggerSelectionHaptic();
    scenariosRef.current = daily ? buildDailySession(daily.seed) : buildSession(settingsRef.current, randomSeed());
    sessionStartedAt.current = Date.now();
    intervalRef.current = setInterval(() => setElapsed(Date.now() - sessionStartedAt.current), 100);
    showScenario(0);
  }
  function revealQuestion() { void triggerSelectionHaptic(); goTo("question"); }
  function answer(option) {
    if (phaseRef.current !== "question") return;
    const scenario = scenariosRef.current[index];
    const correct = option.value === scenario.answer;
    resultsRef.current = [...resultsRef.current, { correct, timeMs: Date.now() - scenarioStartedAt.current, clues: scenario.clues.length, questionType: scenario.question.type, aircraftCount: scenario.aircraftCount, memorise: scenario.memorise }];
    setResults(resultsRef.current); setSelected(option.value); goTo("feedback");
    void (correct ? triggerSuccessHaptic() : triggerErrorHaptic());
    timeouts.current.push(setTimeout(() => {
      if (index + 1 < scenariosRef.current.length) showScenario(index + 1);
      else { clearInterval(intervalRef.current); intervalRef.current = null; if (daily) finishDaily(); else goTo("summary"); }
    }, correct ? CORRECT_PAUSE_MS : WRONG_PAUSE_MS));
  }
  function finishDaily() { daily.onFinish(dailyResult(resultsRef.current)); }

  const preflight = <GameSetupShell title="Landing Order" categoryKey="logic" onExit={onExit} onStart={prepareRun} rules="Tests deductive reasoning. Each scenario gives a few clues about the order in which aircraft land, then asks a single question. Every clue is needed, and exactly one answer fits.Easy: 3 or 4 aircraft, briefing visible.Medium: 5 aircraft, briefing visible.Hard: 6 aircraft, or memorise the briefing before the question appears.">
    <PickerSetting label="Aircraft" hint="Aircraft in each approach sequence" options={[3, 4, 5, 6].map((value) => ({ value, label: String(value) }))} value={aircraftCount} onChange={setAircraftCount} />
    <PickerSetting label="Scenarios" hint="One question per scenario" options={[3, 5, 8].map((value) => ({ value, label: String(value) }))} value={scenarioCount} onChange={setScenarioCount} />
    <SettingCard label="Briefing" hint={memorise ? "The clues disappear before the question appears." : "The clues stay on screen with the question."}>
      <ChoiceRow>
        <ChoiceButton compact label="VISIBLE" selected={!memorise} accent={ACCENT} onPress={() => setMemorise(false)} />
        <ChoiceButton compact label="MEMORISE" selected={memorise} accent={ACCENT} onPress={() => setMemorise(true)} />
      </ChoiceRow>
    </SettingCard>
  </GameSetupShell>;

  const scenario = scenariosRef.current[index];
  const settings = settingsRef.current ?? { aircraftCount, scenarioCount, memorise };
  const inScenario = ["briefing", "question", "feedback"].includes(phase) && scenario;
  const lastResult = results.at(-1);
  const correctCount = results.filter((entry) => entry.correct).length;
  const numericOptions = scenario && isNumericQuestion(scenario.question);
  const correctTimes = results.filter((entry) => entry.correct).map((entry) => entry.timeMs);

  return <View style={styles.container}>
    {phase === "preflight" || isReturning ? <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflight}</Animated.View> : null}
    {phase !== "preflight" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, !daily && missionStyle]}>
      <View style={styles.header}><Pressable onPress={daily ? daily.onExit : returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>

      {phase === "ready" ? <Pressable onPress={beginRun} style={styles.readyScreen}>
        <Text style={styles.kicker}>{daily ? "DAILY TRAINING" : "LOGIC"}</Text>
        <Text style={styles.readyTitle}>Ready to sequence?</Text>
        <Text style={styles.readyText}>Read the approach briefing and deduce the landing order. Exactly one answer fits.</Text>
        <View style={styles.cueCard}>
          <Text style={styles.cueLabel}>{daily ? `${DAILY_SCENARIOS.length} SCENARIOS · 3 TO 6 AIRCRAFT` : `${settings.aircraftCount} AIRCRAFT · ${settings.scenarioCount} SCENARIOS`}</Text>
          <Text style={styles.cueText}>{daily ? "More aircraft as you go. The briefing stays on screen for the first six, then must be memorised before the question appears." : settings.memorise ? "Memorise the briefing. It disappears before the question." : "The briefing stays on screen with the question."}</Text>
        </View>
        <PulsingPrompt color={ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt>
      </Pressable> : null}

      {inScenario ? <Animated.View key={index} entering={FadeIn.duration(180)} style={styles.playScreen}>
        <View style={styles.statusRow}>
          <View><Text style={styles.statusLabel}>SCENARIO</Text><Text style={styles.statusValue}>{index + 1}<Text style={styles.statusTotal}> / {scenariosRef.current.length}</Text></Text></View>
          <View style={styles.statusRight}><Text style={styles.statusLabel}>{daily ? "AIRCRAFT" : "TIME"}</Text><Text style={styles.statusValue}>{daily ? <>{scenario.aircraftCount}{scenario.memorise ? <Text style={styles.statusTotal}> · MEMORISE</Text> : null}</> : formatSeconds(elapsed)}</Text></View>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionLabel}>{phase === "briefing" ? "MEMORISE THE BRIEFING" : "APPROACH BRIEFING"}</Text>
          <ClueCard scenario={scenario} hidden={phase === "question" && scenario.memorise} />
          {phase !== "briefing" ? <>
            <Text style={[styles.sectionLabel, styles.questionLabel, phase === "feedback" && { color: lastResult?.correct ? SUCCESS : ERROR }]}>{phase === "feedback" ? (lastResult?.correct ? "CORRECT" : "NOT QUITE") : "QUESTION"}</Text>
            <Sentence template={scenario.question.template} actors={scenario.question.actors} names={scenario.names} style={styles.questionText} nameStyle={styles.questionName} />
            <AnswerGrid options={scenario.question.options} renderOption={(option, width) => {
              const state = phase !== "feedback" ? null : option.value === scenario.answer ? "correct" : option.value === selected ? "wrong" : null;
              return <AnswerButton key={option.value} option={option} numeric={numericOptions} width={width} state={state} disabled={phase !== "question"} onPress={() => answer(option)} />;
            }} />
          </> : null}
        </ScrollView>
        {phase === "briefing" ? <PressScaleButton onPress={revealQuestion}>I'm ready</PressScaleButton> : null}
      </Animated.View> : null}

      {phase === "summary" ? <Animated.View entering={FadeIn.duration(180)} style={styles.summaryScreen}>
        <Text style={styles.kicker}>SESSION ENDED</Text>
        <Text style={styles.summaryTitle}>Sequence cleared</Text>
        <Text style={styles.summaryScore}>{correctCount}<Text style={styles.summaryScoreTotal}> / {results.length}</Text></Text>
        <Text style={styles.summaryCaption}>correct answers</Text>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>{settings.aircraftCount} AIRCRAFT · {settings.memorise ? "MEMORISE" : "VISIBLE"}</Text>
          <Text style={styles.statLine}>Accuracy <Text style={styles.statStrong}>{results.length ? Math.round((correctCount / results.length) * 100) : 0}%</Text></Text>
          <Text style={styles.statLine}>Average per scenario <Text style={styles.statStrong}>{results.length ? formatSeconds(results.reduce((sum, entry) => sum + entry.timeMs, 0) / results.length) : "0.0"} s</Text></Text>
          <Text style={styles.statLine}>Fastest correct <Text style={styles.statStrong}>{correctTimes.length ? `${formatSeconds(Math.min(...correctTimes))} s` : "—"}</Text></Text>
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
  scroll: { flex: 1, marginTop: 22 }, scrollContent: { paddingBottom: 20 },
  sectionLabel: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.7, marginBottom: 12 }, questionLabel: { marginTop: 30 },
  clueCard: { backgroundColor: SPACE_CADET.surface1, borderRadius: 22, paddingVertical: 18, paddingHorizontal: 18, gap: 14 }, clueCardHidden: { minHeight: 96, alignItems: "center", justifyContent: "center" }, hiddenText: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 13 },
  clueRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 }, clueIndex: { color: SPACE_CADET.textTertiary, fontFamily: "Garet-Book", fontSize: 12, lineHeight: 23, width: 18 }, clueText: { flex: 1, color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 15, lineHeight: 23 }, clueName: { color: SPACE_CADET.white },
  questionText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Light", fontSize: 22, lineHeight: 30 }, questionName: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular" },
  answerGrid: { gap: ANSWER_GAP, marginTop: 20 }, answerRow: { flexDirection: "row", justifyContent: "center", gap: ANSWER_GAP },
  answer: { height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, backgroundColor: SPACE_CADET.surface1, borderWidth: 1, borderColor: SPACE_CADET.borderSubtle }, answerPressed: { backgroundColor: SPACE_CADET.surface3, transform: [{ scale: 0.97 }] },
  answerCorrect: { backgroundColor: "#0C2B23", borderColor: SUCCESS }, answerWrong: { backgroundColor: "#3D101D", borderColor: ERROR },
  answerText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 }, answerNumber: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 20 },
  summaryScreen: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 58, paddingBottom: 48 }, summaryTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 31, marginTop: 8 }, summaryScore: { color: ACCENT, fontFamily: "Garet-Book", fontSize: 82, lineHeight: 94, marginTop: 18 }, summaryScoreTotal: { color: SPACE_CADET.textTertiary, fontSize: 36 }, summaryCaption: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 16, textAlign: "center", marginTop: -2 },
  statCard: { width: "100%", backgroundColor: SPACE_CADET.surface1, borderRadius: 22, padding: 18, gap: 10, marginTop: 30 }, statLabel: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6, marginBottom: 4 }, statLine: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13 }, statStrong: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 15 },
  actions: { width: "100%", gap: 12, marginTop: "auto" }, primaryButton: { minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.white }, primaryText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 16 }, secondaryButton: { minHeight: 52, borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" }, secondaryText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 },
});
