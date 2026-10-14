import Slider from "@react-native-community/slider";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { triggerSelectionHaptic } from "../../utils/haptics";
import { ChoiceButton, ChoiceRow, GameSetupShell, PickerSetting, SettingCard } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { SPACE_CADET } from "../../theme/spaceCadet";

const THEME_LIGHT = SPACE_CADET.black;
const THEME_DARK = SPACE_CADET.white;
const THEME_MUTED = SPACE_CADET.textSecondary;
const THEME_ACCENT = SPACE_CADET.mentalMath;
const SUCCESS = "#34D399";
const ERROR = SPACE_CADET.attention;

const operationLevels = [
  { value: 1, label: "+", operations: ["+"] },
  { value: 2, label: "+ et -", operations: ["+", "-"] },
  { value: 3, label: "+, - et x", operations: ["+", "-", "x"] },
  { value: 4, label: "+, -, x et /", operations: ["+", "-", "x", "/"] },
];

const easyMultipliers = [2, 2, 3, 4, 4, 5, 5, 6, 8, 9, 10, 10, 12, 15, 20, 25];

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function chooseOperation(operations, history) {
  if (operations.length === 1) {
    return operations[0];
  }

  const previous = history[history.length - 1];
  const candidates = operations.filter((operation) => operation !== previous);
  const usable = candidates.length > 0 ? candidates : operations;
  const counts = history.slice(-8).reduce((total, operation) => {
    total[operation] = (total[operation] ?? 0) + 1;
    return total;
  }, {});
  const lowestCount = Math.min(...usable.map((operation) => counts[operation] ?? 0));

  return randomItem(usable.filter((operation) => (counts[operation] ?? 0) === lowestCount));
}

function buildSequence({ operations, operationCount }) {
  let total = operations.includes("x") ? randomInt(6, 20) : randomInt(25, 99);
  const start = total;
  const steps = [];
  const history = [];

  for (let index = 0; index < operationCount; index += 1) {
    const operation = chooseOperation(operations, history);
    let shownOperation = operation;
    let operand;

    if (operation === "+") {
      operand = total < 100 ? randomInt(4, 59) : randomInt(10, 99);
      total += operand;
    }

    if (operation === "-") {
      operand = total > 20 ? randomInt(2, Math.max(2, Math.min(total - 1, 59))) : randomInt(1, Math.max(1, total - 1));
      total -= operand;
    }

    if (operation === "x") {
      operand = randomItem(easyMultipliers);

      if (total * operand > 9999) {
        operand = randomItem([2, 2, 3, 4, 5, 10]);
      }

      total *= operand;
    }

    if (operation === "/") {
      const divisors = easyMultipliers.filter((divisor) => divisor > 1 && total % divisor === 0);

      if (divisors.length === 0) {
        shownOperation = "+";
        operand = randomInt(4, 39);
        total += operand;
      } else {
        operand = randomItem(divisors);
        total /= operand;
      }
    }

    steps.push({ operation: shownOperation, operand });
    history.push(shownOperation);
  }

  return { start, steps, answer: total };
}

function NumberPad({ onDigit, onDelete, onSubmit, disabled }) {
  return (
    <View style={styles.keypad}>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((number) => (
        <TouchableOpacity key={number} activeOpacity={0.85} disabled={disabled} onPress={() => onDigit(String(number))} style={styles.key}>
          <Text style={styles.keyText}>{number}</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity activeOpacity={0.85} disabled={disabled} onPress={onDelete} style={styles.key}>
          <Text style={styles.keyAction}>DELETE</Text>
      </TouchableOpacity>
      <TouchableOpacity activeOpacity={0.85} disabled={disabled} onPress={() => onDigit("0")} style={styles.key}>
        <Text style={styles.keyText}>0</Text>
      </TouchableOpacity>
      <TouchableOpacity activeOpacity={0.85} disabled={disabled} onPress={onSubmit} style={[styles.key, styles.submitKey]}>
        <Text style={styles.submitKeyText}>ENTER</Text>
      </TouchableOpacity>
    </View>
  );
}

export function ContinuousTotalGame({ onExit }) {
  const [operationLevel, setOperationLevel] = useState(2);
  const [selectedOperations, setSelectedOperations] = useState(["+", "-"]);
  const [intervalSeconds, setIntervalSeconds] = useState(2);
  const [operationCount, setOperationCount] = useState(8);
  const [phase, setPhase] = useState("setup");
  const [sequence, setSequence] = useState(null);
  const [stepIndex, setStepIndex] = useState(-1);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [resultCorrect, setResultCorrect] = useState(null);

  const timeoutsRef = useRef([]);

  useEffect(() => () => clearTimers(), []);

  function clearTimers() {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  }

  function queue(callback, delay) {
    const timeoutId = setTimeout(callback, delay);
    timeoutsRef.current.push(timeoutId);
  }

  function showStep(nextIndex, activeSequence) {
    setStepIndex(nextIndex);

    queue(() => {
      if (nextIndex + 1 < activeSequence.steps.length) {
        showStep(nextIndex + 1, activeSequence);
      } else {
        setPhase("answer");
      }
    }, intervalSeconds * 1000);
  }

  function prepareRun() {
    clearTimers();
    setSequence(buildSequence({ operations: selectedOperations, operationCount }));
    setAnswer("");
    setFeedback(null);
    setResultCorrect(null);
    setPhase("ready");
  }

  function startGame(useReadySequence = false) {
    const nextSequence = useReadySequence && sequence ? sequence : buildSequence({ operations: selectedOperations, operationCount });

    clearTimers();
    setSequence(nextSequence);
    setStepIndex(-1);
    setAnswer("");
    setFeedback(null);
    setResultCorrect(null);
    setPhase("prepare");

    queue(() => {
      setPhase("sequence");
      showStep(0, nextSequence);
    }, 900);
  }

  function toggleOperation(operation) {
    setSelectedOperations((current) => {
      if (current.includes(operation)) return current.length === 1 ? current : current.filter((item) => item !== operation);
      return [...current, operation];
    });
  }

  function handleDigit(value) {
    void triggerSelectionHaptic();
    setAnswer((current) => `${current}${value}`.slice(0, 7));
  }

  function handleDelete() {
    void triggerSelectionHaptic();
    setAnswer((current) => current.slice(0, -1));
  }

  async function submitAnswer() {
    if (!sequence || answer.length === 0 || feedback) {
      return;
    }

    const correct = Number(answer) === sequence.answer;

    await triggerSelectionHaptic();
    setResultCorrect(correct);
    setFeedback(correct ? "success" : "error");
    queue(() => {
      setFeedback(null);
      setPhase("result");
    }, 260);
  }

  function resetToSetup() {
    clearTimers();
    setPhase("setup");
    setFeedback(null);
  }

  const operationLabel = operationLevels.find((item) => item.value === operationLevel).label;
  const visibleValue = sequence
    ? stepIndex === -1
      ? String(sequence.start)
      : `${sequence.steps[stepIndex].operation} ${sequence.steps[stepIndex].operand}`
    : "";

  if (phase === "setup") {
    return (
      <GameSetupShell title="Running Total" categoryKey="mentalMath" onExit={onExit} onStart={prepareRun} rules="Tests mental updating and sustained focus. Keep a running total as each operation appears. Choose any operation mix; shorter intervals make the sequence harder.Easy: Use a slower pace and a short series.Medium: Increase the pace or series length.Hard: Use both a fast pace and a long series.">
        <PickerSetting label="Pace" hint="Time between operations" options={[{ value: 3, label: "SLOW" }, { value: 2, label: "MEDIUM" }, { value: 1, label: "FAST" }]} value={intervalSeconds} onChange={setIntervalSeconds} />
        <SettingCard label="Operations"><ChoiceRow>{["+", "−", "×", "÷"].map((label, index) => { const operation = ["+", "-", "x", "/"][index]; return <ChoiceButton key={operation} label={label} selected={selectedOperations.includes(operation)} onPress={() => toggleOperation(operation)} accent={SPACE_CADET.mentalMath} />; })}</ChoiceRow></SettingCard>
        <PickerSetting label="Series length" options={[5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((value) => ({ value, label: String(value) }))} value={operationCount} onChange={setOperationCount} />
      </GameSetupShell>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity activeOpacity={0.85} onPress={resetToSetup} style={styles.backButton}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
      </View>

      {phase === "setup" ? (
        <View style={styles.setupPanel}>
          <Text style={styles.sectionTitle}>Suis le total</Text>
          <Text style={styles.sectionSubtitle}>Retiens le nombre de depart, puis applique chaque operation mentalement.</Text>

          <View style={styles.settingCard}>
            <Text style={styles.settingLabel}>Operations</Text>
            <Text style={styles.settingValue}>{operationLabel}</Text>
            <Slider minimumValue={1} maximumValue={4} step={1} value={operationLevel} minimumTrackTintColor={THEME_DARK} maximumTrackTintColor="#D7CEC0" thumbTintColor={THEME_ACCENT} onValueChange={setOperationLevel} />
            <View style={styles.sliderExtremes}><Text style={styles.sliderText}>+</Text><Text style={styles.sliderText}>+ - x /</Text></View>
          </View>

          <View style={styles.settingCard}>
            <Text style={styles.settingLabel}>Temps entre deux operations</Text>
            <Text style={styles.settingValue}>{intervalSeconds} s</Text>
            <Slider minimumValue={1} maximumValue={5} step={1} value={intervalSeconds} minimumTrackTintColor={THEME_DARK} maximumTrackTintColor="#D7CEC0" thumbTintColor={THEME_ACCENT} onValueChange={setIntervalSeconds} />
            <View style={styles.sliderExtremes}><Text style={styles.sliderText}>1 s</Text><Text style={styles.sliderText}>5 s</Text></View>
          </View>

          <View style={styles.settingCard}>
            <Text style={styles.settingLabel}>Nombre total d'operations</Text>
            <Text style={styles.settingValue}>{operationCount}</Text>
            <Slider minimumValue={5} maximumValue={15} step={1} value={operationCount} minimumTrackTintColor={THEME_DARK} maximumTrackTintColor="#D7CEC0" thumbTintColor={THEME_ACCENT} onValueChange={setOperationCount} />
            <View style={styles.sliderExtremes}><Text style={styles.sliderText}>5</Text><Text style={styles.sliderText}>15</Text></View>
          </View>

          <TouchableOpacity activeOpacity={0.9} onPress={startGame} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Valider et commencer</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {phase === "ready" && sequence ? (
        <TouchableOpacity activeOpacity={0.95} onPress={() => startGame(true)} style={styles.readyPanel}>
          <Text style={styles.progressText}>RUNNING TOTAL</Text>
          <Text style={styles.prepareText}>Starting value</Text>
          <Text style={styles.sequenceValue}>{sequence.start}</Text>
          <PulsingPrompt color={THEME_ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt>
        </TouchableOpacity>
      ) : null}

      {phase === "prepare" ? (
        <View style={styles.centerPanel}>
          <Text style={styles.prepareText}>Focus</Text>
          <Text style={styles.prepareHint}>The starting value is coming up.</Text>
        </View>
      ) : null}

      {phase === "sequence" && sequence ? (
        <View style={styles.sequencePanel}>
          <Text style={styles.progressText}>{stepIndex === -1 ? "STARTING VALUE" : `OPERATION ${stepIndex + 1} / ${sequence.steps.length}`}</Text>
          <Text adjustsFontSizeToFit numberOfLines={1} style={styles.sequenceValue}>{visibleValue}</Text>
        </View>
      ) : null}

      {phase === "answer" ? (
        <View style={styles.answerPanel}>
          <View style={styles.answerPrompt}>
            <Text style={styles.answerKicker}>RUNNING TOTAL</Text>
            <Text style={styles.sectionTitle}>What is the final total?</Text>
            <View style={[styles.answerBox, feedback === "success" && styles.answerSuccess, feedback === "error" && styles.answerError]}><Text style={[styles.answerText, feedback === "success" && styles.answerTextSuccess, feedback === "error" && styles.answerTextError]}>{answer || " "}</Text></View>
          </View>
          <NumberPad disabled={Boolean(feedback)} onDigit={handleDigit} onDelete={handleDelete} onSubmit={submitAnswer} />
        </View>
      ) : null}

      {phase === "result" && sequence ? (
        <View style={styles.resultPanel}>
          <Text style={[styles.resultTitle, resultCorrect ? styles.resultCorrect : styles.resultWrong]}>{resultCorrect ? "Correct" : "Not quite"}</Text>
          <Text style={styles.resultLine}>Your answer  <Text style={styles.resultValue}>{answer}</Text></Text>
          <Text style={styles.resultLine}>Final total  <Text style={styles.resultValue}>{sequence.answer}</Text></Text>
          <TouchableOpacity activeOpacity={0.9} onPress={startGame} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Play again</Text></TouchableOpacity>
          <TouchableOpacity activeOpacity={0.9} onPress={resetToSetup} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Change settings</Text></TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 12, backgroundColor: SPACE_CADET.black },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  backButtonText: { color: THEME_DARK, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 },
  setupPanel: { flex: 1, justifyContent: "center" },
  centerPanel: { flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 150 },
  readyPanel: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingBottom: 150 },
  sectionTitle: { color: THEME_DARK, fontFamily: "Gontserrat-Light", fontSize: 29, textAlign: "center", marginBottom: 10 },
  sectionSubtitle: { color: "#5B6573", fontSize: 16, lineHeight: 23, textAlign: "center", marginBottom: 22 },
  settingCard: { backgroundColor: "#FFFFFF", borderRadius: 22, paddingHorizontal: 18, paddingVertical: 15, marginBottom: 14 },
  settingLabel: { color: THEME_DARK, fontSize: 15, fontWeight: "700", marginBottom: 4 },
  settingValue: { color: THEME_ACCENT, fontSize: 25, fontWeight: "700", marginBottom: 5 },
  sliderExtremes: { flexDirection: "row", justifyContent: "space-between", marginTop: -4 },
  sliderText: { color: THEME_MUTED, fontSize: 12 },
  primaryButton: { width: "100%", marginTop: "auto", minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: THEME_DARK },
  primaryButtonText: { color: THEME_LIGHT, fontFamily: "Gontserrat-Regular", fontSize: 16 },
  secondaryButton: { width: "100%", marginTop: 12, minHeight: 52, borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: SPACE_CADET.borderDefault },
  secondaryButtonText: { color: THEME_DARK, fontFamily: "Gontserrat-Regular", fontSize: 15 },
  prepareText: { color: THEME_DARK, fontFamily: "Gontserrat-Light", fontSize: 38, textAlign: "center" },
  prepareHint: { color: THEME_MUTED, fontFamily: "Gontserrat-Regular", fontSize: 16, textAlign: "center", marginTop: 12 },
  sequencePanel: { flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 150 },
  progressText: { color: THEME_ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, textTransform: "uppercase", letterSpacing: 1.7, marginBottom: 20, textAlign: "center" },
  sequenceValue: { color: THEME_DARK, fontFamily: "Garet-Book", fontSize: 62, textAlign: "center", width: "100%" },
  sequenceHint: { color: THEME_MUTED, fontSize: 16, marginTop: 24 },
  answerPanel: { flex: 1, position: "relative", overflow: "hidden" },
  answerPrompt: { flex: 1, justifyContent: "center", alignItems: "center" },
  answerBox: { minWidth: 170, borderBottomWidth: 1.25, borderBottomColor: THEME_DARK, marginTop: 20, paddingHorizontal: 12, paddingBottom: 7 },
  answerSuccess: { borderBottomColor: SUCCESS },
  answerError: { borderBottomColor: ERROR },
  answerText: { color: THEME_DARK, fontFamily: "Garet-Book", fontSize: 34, textAlign: "center", minHeight: 42 },
  answerTextSuccess: { color: SUCCESS },
  answerTextError: { color: ERROR },
  keypad: { flexDirection: "row", flexWrap: "wrap", gap: 9, paddingBottom: 30 },
  key: { width: "31.3%", height: 58, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.surface1 },
  keyText: { color: THEME_DARK, fontFamily: "Garet-Book", fontSize: 24 },
  keyAction: { color: THEME_DARK, fontSize: 13, fontWeight: "700" },
  submitKey: { backgroundColor: THEME_DARK },
  submitKeyText: { color: THEME_LIGHT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1 },
  feedbackOverlay: { ...StyleSheet.absoluteFill, opacity: 0 },
  feedbackSuccess: { backgroundColor: SUCCESS, opacity: 0.25 },
  feedbackError: { backgroundColor: ERROR, opacity: 0.2 },
  beginPrompt: { marginTop: 44, textAlign: "center" },
  resultTitle: { fontFamily: "Gontserrat-Light", fontSize: 38, textAlign: "center", marginBottom: 20 },
  resultCorrect: { color: SUCCESS },
  resultWrong: { color: ERROR },
  resultLine: { color: THEME_MUTED, fontFamily: "Gontserrat-Regular", fontSize: 15, lineHeight: 28, textAlign: "center" },
  resultValue: { color: THEME_DARK, fontFamily: "Garet-Book", fontSize: 17 },
  answerKicker: { color: THEME_ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.7, marginBottom: 13 },
  resultPanel: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 96, paddingBottom: 28 },
});
