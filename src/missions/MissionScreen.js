import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { BlurView } from "expo-blur";
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { PulsingPrompt } from "../components/PulsingPrompt";
import { CATEGORY_COLORS, getCategoryLabel, SPACE_CADET } from "../theme/spaceCadet";
import { triggerSelectionHaptic, triggerSuccessHaptic } from "../utils/haptics";
import { deriveSeed } from "../utils/random";
import { endVoiceSession, speak, startVoiceSession, stopSpeaking } from "../utils/voice";
import { BLOCK_GAP, boardMetrics, cellRect, planLayout } from "./layout";
import { formatClock } from "./kit";
import { MODULES, TASK_LABELS } from "./modules";

const PROMPT_AUTO_SKIP_MS = 30000;
// Progressive missions bring the systems in one at a time. The next one arrives 10 s after the previous one, or,
// after a "when you have time" module, as soon as the player has touched it (at least 3 s in, at most 15 s).
// Whatever happens, every system is in by 40% of the mission.
const INTRO_WAIT_MS = 10000;
const INTRO_TOUCH_MIN_MS = 3000;
const INTRO_TOUCH_CAP_MS = 15000;
const INTRO_SHARE = 0.4;
const PROMPT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "DEL", "0", ""];
// Rough height the briefing text needs: kicker, title and footer, plus the rule at ~44 characters per line.
const briefingHeight = (module) => 150 + Math.ceil(module.rule.length / 44) * 21;

function joinRecap(parts) {
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

// Fades a module in and out (briefing spotlight, dimmed board before launch) and only lets touches through live.
function ModuleLayer({ opacity, interactive, onTop, appear = false, onTouch, children }) {
  const value = useSharedValue(appear ? 0 : opacity);
  useEffect(() => { value.value = withTiming(opacity, { duration: 320 }); }, [opacity]); // eslint-disable-line react-hooks/exhaustive-deps
  const style = useAnimatedStyle(() => ({ opacity: value.value }));
  // The capture handler only notes that the module was touched; it never takes the touch away from its controls.
  return <Animated.View pointerEvents={interactive ? "box-none" : "none"} onStartShouldSetResponderCapture={() => { onTouch?.(); return false; }} style={[StyleSheet.absoluteFill, onTop && styles.onTop, style]}>{children}</Animated.View>;
}

// Flies one mission ({ moduleIds, durationMs, seed, kicker, label, progressive }): briefing module by module,
// launch, the flight itself (pause, keypad prompts, progressive arrival of the systems), then the debrief. Opened by
// the Daily Mission sheet and by Mission Mode.
export function MissionScreen({ onClose, mission }) {
  const durationMs = mission.durationMs;
  const modules = useMemo(() => mission.moduleIds.map((id) => MODULES[id]), [mission.moduleIds]);
  const layout = useMemo(() => planLayout(modules), [modules]);
  const [phase, setPhase] = useState("briefing");
  const [briefIndex, setBriefIndex] = useState(0);
  const [status, setStatus] = useState("idle");
  const [runId, setRunId] = useState(0);
  const [remaining, setRemaining] = useState(durationMs);
  const [results, setResults] = useState(null);
  const [area, setArea] = useState(null);
  // A module can briefly draw over the others.
  const [onTopModule, setOnTopModule] = useState(null);
  // A module can ask the player for a number on a full-screen keypad; the mission freezes meanwhile.
  const [prompt, setPrompt] = useState(null);
  const [promptEntry, setPromptEntry] = useState("");
  const promptRef = useRef(null);
  const registry = useRef({});
  const startedAt = useRef(0);
  const pausedAt = useRef(null);
  const pausedTotal = useRef(0);
  const statusRef = useRef("idle");
  const finished = useRef(false);
  const seed = mission.seed;
  const progressive = Boolean(mission.progressive);
  // Progressive missions: module id → mission time at which it came in. A module only exists on the board from
  // then on, with its own clock and the time that is left as its duration.
  const [activations, setActivations] = useState({});
  const activationsRef = useRef({});
  const touched = useRef({});

  useEffect(() => () => endVoiceSession(), []);
  useEffect(() => { statusRef.current = status; }, [status]);
  // Leaving the app mid-mission pauses it: the voice stops and the clock freezes until the player comes back.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => { if (state !== "active" && statusRef.current === "running") pause(); });
    return () => subscription.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Mission time excludes pauses, so every module's schedule simply resumes where it stopped.
  function elapsed() {
    return (pausedAt.current ?? Date.now()) - startedAt.current - pausedTotal.current;
  }
  const runtimes = useMemo(() => Object.fromEntries(modules.map((module) => { const start = activations[module.id] ?? 0; return [module.id, {
    seed: deriveSeed(seed, module.id),
    status,
    durationMs: durationMs - start,
    elapsed: () => elapsed() - start,
    register: (getResult) => { registry.current[module.id] = getResult; },
    speak: (text) => speak(text),
    setOnTop: (raised) => setOnTopModule((current) => (raised ? module.id : current === module.id ? null : current)),
    ask: (question) => askNumber({ ...question, color: CATEGORY_COLORS[module.competence] }),
  }]; })), [modules, seed, status, durationMs, activations]);

  function activate(id, at) {
    activationsRef.current = { ...activationsRef.current, [id]: at };
    setActivations(activationsRef.current);
  }
  function introduceNext() {
    const active = activationsRef.current;
    const pending = modules.filter((module) => active[module.id] === undefined);
    if (!pending.length) return;
    const last = modules[modules.length - pending.length - 1];
    const now = elapsed();
    const since = now - active[last.id];
    const waitsForTouch = last.task === "opportunistic";
    const cap = Math.min(waitsForTouch ? INTRO_TOUCH_CAP_MS : INTRO_WAIT_MS, (durationMs * INTRO_SHARE) / (modules.length - 1));
    if (since >= cap || (waitsForTouch && touched.current[last.id] && since >= Math.min(INTRO_TOUCH_MIN_MS, cap))) { activate(pending[0].id, now); void triggerSelectionHaptic(); }
  }

  useEffect(() => {
    if (status !== "running") return undefined;
    const timer = setInterval(() => {
      const left = durationMs - elapsed();
      setRemaining(Math.max(0, left));
      if (left <= 0) finish();
      else if (progressive) introduceNext();
    }, 250);
    return () => clearInterval(timer);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function launch() {
    void triggerSelectionHaptic();
    await startVoiceSession();
    finished.current = false;
    touched.current = {};
    if (progressive) { registry.current = {}; activationsRef.current = { [modules[0].id]: 0 }; setActivations(activationsRef.current); }
    startedAt.current = Date.now();
    pausedAt.current = null;
    pausedTotal.current = 0;
    statusRef.current = "running";
    setRemaining(durationMs);
    setStatus("running");
    setPhase("running");
  }
  function pause() {
    pausedAt.current = Date.now();
    statusRef.current = "paused";
    endVoiceSession();
    setStatus("paused");
    setPhase("paused");
  }
  async function resume() {
    void triggerSelectionHaptic();
    await startVoiceSession();
    pausedTotal.current += Date.now() - pausedAt.current;
    pausedAt.current = null;
    statusRef.current = "running";
    setStatus("running");
    setPhase("running");
  }
  // Freezes the mission (like a pause, but without the pause screen) and shows the keypad; resolves with the number
  // entered, or null when skipped.
  function askNumber(question) {
    return new Promise((resolve) => {
      if (statusRef.current !== "running") { resolve(null); return; }
      pausedAt.current = Date.now();
      statusRef.current = "paused";
      stopSpeaking();
      const entry = { ...question, resolve, timer: setTimeout(() => answerPrompt(null), PROMPT_AUTO_SKIP_MS) };
      promptRef.current = entry;
      setPromptEntry("");
      setPrompt(entry);
      setStatus("paused");
      setPhase("prompt");
    });
  }
  function answerPrompt(value) {
    const current = promptRef.current;
    if (!current) return;
    clearTimeout(current.timer);
    promptRef.current = null;
    pausedTotal.current += Date.now() - pausedAt.current;
    pausedAt.current = null;
    statusRef.current = "running";
    setPrompt(null);
    setStatus("running");
    setPhase("running");
    current.resolve(value);
  }
  function pressPromptKey(key) {
    if (!key) return;
    void triggerSelectionHaptic();
    if (key === "DEL") setPromptEntry((entry) => entry.slice(0, -1));
    else setPromptEntry((entry) => `${entry}${key}`.slice(0, 4));
  }

  function finish() {
    if (finished.current) return;
    finished.current = true;
    endVoiceSession();
    const flown = progressive ? modules.filter((module) => activationsRef.current[module.id] !== undefined) : modules;
    const perModule = flown.map((module) => ({ module, ...(registry.current[module.id]?.() ?? { performance: 0, detail: "" }) }));
    const score = Math.round((perModule.reduce((sum, entry) => sum + entry.performance, 0) / perModule.length) * 1000);
    setStatus("ended");
    setResults({ score, perModule });
    setPhase("results");
    void triggerSuccessHaptic();
  }
  function replay() {
    registry.current = {};
    activationsRef.current = {};
    setActivations({});
    setResults(null);
    setStatus("idle");
    setRemaining(durationMs);
    setRunId((current) => current + 1);
    setPhase("ready");
  }
  function exit() { endVoiceSession(); onClose(); }
  function nextBriefing() {
    void triggerSelectionHaptic();
    if (briefIndex + 1 < modules.length) setBriefIndex(briefIndex + 1);
    else setPhase("ready");
  }

  const metrics = area && layout ? boardMetrics(area.width, area.height, layout.rows) : null;
  const rectsFor = (module) => Object.fromEntries(module.blocks.map((block) => [block.key, cellRect(layout.placements[`${module.id}:${block.key}`], metrics.cell)]));
  const briefed = modules[briefIndex];

  // The briefing text goes in the tallest empty band of the screen around the module being explained, including
  // between its blocks (the other modules are hidden, so their space counts as empty).
  let briefingSlot = null;
  if (metrics && phase === "briefing") {
    const step = metrics.cell + BLOCK_GAP;
    const spans = briefed.blocks.map((block) => layout.placements[`${briefed.id}:${block.key}`])
      .map((cell) => [metrics.offsetY + cell.row * step, metrics.offsetY + (cell.row + cell.h) * step - BLOCK_GAP])
      .sort((a, b) => a[0] - b[0]);
    const bands = [];
    let cursor = 0;
    spans.forEach(([top, bottom]) => { if (top - cursor > 0) bands.push({ top: cursor, height: top - cursor - BLOCK_GAP }); cursor = Math.max(cursor, bottom + BLOCK_GAP); });
    bands.push({ top: cursor, height: area.height - cursor });
    briefingSlot = bands.reduce((best, band) => (band.height > best.height ? band : best), { top: 0, height: 0 });
    if (briefingSlot.height < briefingHeight(briefed)) {
      const roomy = bands.filter((band) => band.height >= briefingHeight(briefed)).sort((a, b) => b.height - a.height)[0];
      // No band is tall enough: the text goes in an opaque sheet at the bottom, the module stays fully visible.
      briefingSlot = roomy ?? { sheet: true };
    }
  }

  const inFlight = phase === "running" || phase === "paused" || phase === "prompt";
  const layerOpacity = (index) => (phase === "briefing" ? (index === briefIndex ? 1 : 0) : 1);

  return <Animated.View entering={FadeIn.duration(220)} style={styles.screen}>
    <View style={styles.header}>
      <Pressable onPress={exit} hitSlop={10} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable>
      <View style={styles.headerCenter}>
        <Text style={styles.headerKicker}>{mission.kicker ?? "MISSION"}</Text>
        {mission.label ? <Text style={styles.headerDate}>{mission.label}</Text> : null}
      </View>
      <View style={styles.headerRight}>{phase === "running" || phase === "paused" || phase === "prompt" ? <Text style={styles.clock}>{formatClock(remaining)}</Text> : null}</View>
    </View>

    {phase !== "results" ? <View style={styles.boardArea} onLayout={(event) => setArea(event.nativeEvent.layout)}>
      {metrics ? <View style={[styles.board, { left: metrics.offsetX, top: metrics.offsetY, width: metrics.boardWidth, height: metrics.boardHeight }]}>
        {modules.map((module, index) => (inFlight && progressive && activations[module.id] === undefined ? null : <ModuleLayer key={`${module.id}-${runId}-${seed}${inFlight && progressive ? `-in${activations[module.id]}` : ""}`} opacity={layerOpacity(index)} interactive={phase === "running"} onTop={onTopModule === module.id} appear={inFlight && progressive} onTouch={() => { touched.current[module.id] = true; }}>
          <module.Component rects={rectsFor(module)} board={{ width: metrics.boardWidth, height: metrics.boardHeight }} runtime={runtimes[module.id]} color={CATEGORY_COLORS[module.competence]} />
        </ModuleLayer>))}
      </View> : null}

      {briefingSlot ? <Animated.View key={briefIndex} entering={FadeIn.duration(260)} style={[styles.briefing, briefingSlot.sheet ? styles.briefingSheet : { top: briefingSlot.top, height: briefingSlot.height }]}>
        <Text style={styles.briefKicker}>
          {[briefed.competence, ...briefed.secondary].map((key, position) => <Text key={key} style={{ color: CATEGORY_COLORS[key] }}>{position ? "  ·  " : ""}{getCategoryLabel(key).toUpperCase()}</Text>)}
        </Text>
        <Text style={styles.briefTask}>{TASK_LABELS[briefed.task]}</Text>
        <Text style={styles.briefTitle}>{briefed.title}</Text>
        <Text style={styles.briefRule}>{briefed.rule}</Text>
        <View style={styles.briefFooter}>
          <Text style={styles.briefStep}>{briefIndex + 1} / {modules.length}</Text>
          <Pressable onPress={nextBriefing} style={({ pressed }) => [styles.nextButton, pressed && styles.pressed]}><Text style={styles.nextText}>Next</Text></Pressable>
        </View>
      </Animated.View> : null}

      {phase === "ready" && metrics ? <Pressable onPress={launch} style={StyleSheet.absoluteFill}>
        <Animated.View entering={FadeIn.duration(320)} style={StyleSheet.absoluteFill}>
          <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.readyShade} />
          <View style={styles.readyContent}>
            <Text style={styles.headerKicker}>{modules.length} SYSTEMS · {formatClock(durationMs)}</Text>
            <Text style={styles.readyTitle}>Ready for launch?</Text>
            <Text style={styles.readyText}>{joinRecap(modules.map((module) => module.recap))}{progressive ? " The systems come in one at a time." : ""}</Text>
            <PulsingPrompt style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt>
          </View>
        </Animated.View>
      </Pressable> : null}
      {phase === "prompt" && prompt ? <Animated.View entering={FadeIn.duration(200)} style={StyleSheet.absoluteFill}>
        <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.readyShade} />
        <View style={styles.promptContent}>
          <Text style={[styles.headerKicker, { color: prompt.color }]}>{prompt.kicker}</Text>
          <Text style={styles.readyTitle}>{prompt.title}</Text>
          <View style={[styles.promptField, { borderBottomColor: prompt.color }]}><Text style={styles.promptValue}>{promptEntry || " "}</Text></View>
          <View style={styles.promptKeys}>
            {[0, 1, 2, 3].map((row) => <View key={row} style={styles.promptRow}>
              {PROMPT_KEYS.slice(row * 3, row * 3 + 3).map((key, column) => <Pressable key={`${row}-${column}`} disabled={!key} onPress={() => pressPromptKey(key)} style={({ pressed }) => [styles.promptKey, !key && styles.promptKeyEmpty, pressed && styles.promptKeyPressed]}>
                <Text style={key.length > 1 ? styles.promptKeyWord : styles.promptKeyText}>{key}</Text>
              </Pressable>)}
            </View>)}
          </View>
          <View style={styles.promptActions}>
            <TouchableOpacity activeOpacity={0.88} onPress={() => answerPrompt(null)} style={[styles.secondaryButton, styles.promptAction]}><Text style={styles.secondaryText}>Skip</Text></TouchableOpacity>
            <TouchableOpacity activeOpacity={0.88} disabled={!promptEntry} onPress={() => answerPrompt(Number(promptEntry))} style={[styles.primaryButton, styles.promptAction, !promptEntry && styles.disabled]}><Text style={styles.primaryText}>Confirm</Text></TouchableOpacity>
          </View>
        </View>
      </Animated.View> : null}

      {phase === "paused" && metrics ? <Animated.View entering={FadeIn.duration(220)} style={StyleSheet.absoluteFill}>
        <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.readyShade} />
        <View style={styles.readyContent}>
          <Text style={styles.headerKicker}>{formatClock(remaining)} LEFT</Text>
          <Text style={styles.readyTitle}>Mission paused</Text>
          <Text style={styles.readyText}>The clock stopped when you left. Pick up exactly where you were.</Text>
          <View style={styles.pausedActions}>
            <TouchableOpacity activeOpacity={0.88} onPress={resume} style={styles.primaryButton}><Text style={styles.primaryText}>Resume</Text></TouchableOpacity>
            <TouchableOpacity activeOpacity={0.88} onPress={exit} style={styles.secondaryButton}><Text style={styles.secondaryText}>Abort mission</Text></TouchableOpacity>
          </View>
        </View>
      </Animated.View> : null}
    </View> : null}

    {phase === "results" && results ? <Animated.View entering={FadeIn.duration(220)} style={styles.results}>
      <ScrollView contentContainerStyle={styles.resultsContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.headerKicker}>MISSION COMPLETE</Text>
        <Text style={styles.resultsTitle}>Debrief</Text>
        <Text style={styles.score}>{results.score}<Text style={styles.scoreTotal}> / 1000</Text></Text>
        <View style={styles.resultCard}>
          {results.perModule.map(({ module, performance, detail }) => {
            const moduleColor = CATEGORY_COLORS[module.competence];
            return <View key={module.id}>
              <View style={styles.resultTop}>
                <View style={[styles.resultDot, { backgroundColor: moduleColor }]} />
                <Text style={styles.resultTitle}>{module.title}</Text>
                <Text style={styles.resultValue}>{Math.round(performance * 100)}%</Text>
              </View>
              <View style={styles.resultBar}><View style={[styles.resultFill, { width: `${Math.round(performance * 100)}%`, backgroundColor: moduleColor }]} /></View>
              <Text style={styles.resultDetail}>{detail}</Text>
            </View>;
          })}
        </View>
      </ScrollView>
      <View style={styles.actions}>
        <TouchableOpacity activeOpacity={0.88} onPress={replay} style={styles.primaryButton}><Text style={styles.primaryText}>Fly again</Text></TouchableOpacity>
        <TouchableOpacity activeOpacity={0.88} onPress={exit} style={styles.secondaryButton}><Text style={styles.secondaryText}>Change mission</Text></TouchableOpacity>
      </View>
    </Animated.View> : null}
  </Animated.View>;
}

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFill, zIndex: 30, backgroundColor: SPACE_CADET.black },
  header: { height: 64, paddingHorizontal: 20, flexDirection: "row", alignItems: "center" }, backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, backArrow: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 }, pressed: { transform: [{ scale: 0.97 }] },
  headerCenter: { flex: 1, alignItems: "center" }, headerKicker: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.8, textAlign: "center" }, headerDate: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 15, marginTop: 3 },
  headerRight: { width: 60, alignItems: "flex-end" }, clock: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 22 },
  boardArea: { flex: 1, marginHorizontal: 22, marginTop: 4, marginBottom: 30 }, board: { position: "absolute" },
  briefing: { position: "absolute", left: 0, right: 0, justifyContent: "center", paddingHorizontal: 6 }, briefingSheet: { bottom: 0, backgroundColor: "rgba(12,12,14,0.97)", borderRadius: 26, borderWidth: 1, borderColor: SPACE_CADET.borderSubtle, paddingHorizontal: 22, paddingVertical: 22 },
  briefKicker: { fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.7 }, briefTask: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.5, marginTop: 6 },
  briefTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 28, marginTop: 10 }, briefRule: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 21, marginTop: 10 },
  briefFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20 }, briefStep: { color: SPACE_CADET.textTertiary, fontFamily: "Garet-Book", fontSize: 15 },
  nextButton: { height: 42, paddingHorizontal: 26, borderRadius: 999, backgroundColor: SPACE_CADET.white, alignItems: "center", justifyContent: "center" }, nextText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 15 },
  pausedActions: { alignSelf: "stretch", gap: 12, marginTop: 34 },
  promptContent: { ...StyleSheet.absoluteFill, justifyContent: "center", paddingHorizontal: 8 },
  promptField: { alignSelf: "center", minWidth: 150, borderBottomWidth: 1.5, alignItems: "center", marginTop: 22, marginBottom: 26, paddingBottom: 6 },
  promptValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 44, lineHeight: 52 },
  promptKeys: { gap: 9 }, promptRow: { flexDirection: "row", gap: 9 },
  promptKey: { flex: 1, height: 56, alignItems: "center", justifyContent: "center" }, promptKeyEmpty: {}, promptKeyPressed: { opacity: 0.4, transform: [{ scale: 0.92 }] },
  promptKeyText: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 30 }, promptKeyWord: { color: SPACE_CADET.white, fontFamily: "Gontserrat-SemiBold", fontSize: 11, letterSpacing: 1.3 },
  promptActions: { flexDirection: "row", gap: 10, marginTop: 20 }, promptAction: { flex: 1 },
  readyShade: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.55)" }, readyContent: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  readyTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 30, marginTop: 10, textAlign: "center" }, readyText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 12, maxWidth: 300 }, beginPrompt: { marginTop: 30 },
  results: { flex: 1, paddingHorizontal: 20, paddingBottom: 36 }, resultsContent: { alignItems: "center", paddingTop: 28, paddingBottom: 20 },
  resultsTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 31, marginTop: 8 }, score: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 76, lineHeight: 90, marginTop: 14 }, scoreTotal: { color: SPACE_CADET.textTertiary, fontSize: 24 },
  resultCard: { width: "100%", backgroundColor: SPACE_CADET.surface1, borderRadius: 22, padding: 18, gap: 18, marginTop: 24 },
  resultTop: { flexDirection: "row", alignItems: "center" }, resultDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 }, resultTitle: { flex: 1, color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 }, resultValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 16 },
  resultBar: { height: 3, borderRadius: 2, backgroundColor: SPACE_CADET.surface3, marginTop: 10, overflow: "hidden" }, resultFill: { height: 3, borderRadius: 2 }, resultDetail: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 12, marginTop: 8 },
  actions: { gap: 12 }, disabled: { opacity: 0.35 }, onTop: { zIndex: 20, elevation: 20 },
  primaryButton: { minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.white }, primaryText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 16 }, secondaryButton: { minHeight: 52, borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" }, secondaryText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 },
});
