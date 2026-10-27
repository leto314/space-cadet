import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import Svg, { Circle, Line, Polygon } from "react-native-svg";

import { GameSetupShell, PickerSetting } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { randomSeed } from "../../utils/random";
import { anomalyPoints, buildDailySchedule, buildSession, COLUMN_COUNT, dailyResult, MISS_COST, sessionSummary, TRACK_COUNT } from "./logic";

const ACCENT = SPACE_CADET.attention;
const SUCCESS = "#34D399";
const RADAR_WIDTH = 320;
const RADAR_HEIGHT = 560;
function formatTime(ms) { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
const PACE_LABELS = { 1: "SLOW", 2: "MEDIUM", 3: "FAST" };

function SignalGlyph({ symbol, color = "rgba(255,255,255,0.68)" }) {
  return <Svg width="25" height="25" viewBox="0 0 24 24">{symbol === "circle" ? <Circle cx="12" cy="12" r="6.5" fill="none" stroke={color} strokeWidth="1.65" /> : <Polygon points="12,4.35 17.4,6.6 19.65,12 17.4,17.4 12,19.65 6.6,17.4 4.35,12 6.6,6.6" fill="none" stroke={color} strokeWidth="1.9" strokeLinejoin="round" />}</Svg>;
}

function RadarGuides() {
  const guideColor = "rgba(255,255,255,0.12)";
  return <Svg pointerEvents="none" width={RADAR_WIDTH} height={RADAR_HEIGHT} style={styles.guideOverlay}>{Array.from({ length: COLUMN_COUNT + 1 }, (_, index) => { const x = (index / COLUMN_COUNT) * RADAR_WIDTH; return <Line key={`column-guide-${index}`} x1={x} y1="0" x2={x} y2={RADAR_HEIGHT} stroke={guideColor} strokeWidth="0.55" strokeDasharray="1.5 5" />; })}{Array.from({ length: TRACK_COUNT + 1 }, (_, index) => { const y = (index / TRACK_COUNT) * RADAR_HEIGHT; return <Line key={`row-guide-${index}`} x1="0" y1={y} x2={RADAR_WIDTH} y2={y} stroke={guideColor} strokeWidth="1" strokeDasharray="3.5 3.5" />; })}</Svg>;
}

function PreviewGuides() {
  const guideColor = "rgba(255,255,255,0.12)";
  const previewWidth = 300;
  const previewHeight = 224;
  const previewRows = 4;
  const previewColumns = 8;
  return <Svg pointerEvents="none" width={previewWidth} height={previewHeight} style={styles.guideOverlay}>{Array.from({ length: previewColumns + 1 }, (_, index) => { const x = (index / previewColumns) * previewWidth; return <Line key={`preview-column-${index}`} x1={x} y1="0" x2={x} y2={previewHeight} stroke={guideColor} strokeWidth="0.55" strokeDasharray="1.5 5" />; })}{Array.from({ length: previewRows + 1 }, (_, index) => { const y = (index / previewRows) * previewHeight; return <Line key={`preview-row-${index}`} x1="0" y1={y} x2={previewWidth} y2={y} stroke={guideColor} strokeWidth="1" strokeDasharray="3.5 3.5" />; })}</Svg>;
}

function RadarDisplay({ targets, feedback, onPress }) {
  return (
    <View style={styles.radarShell}>
      <View style={styles.radar}>
        <RadarGuides />
        {Array.from({ length: COLUMN_COUNT + 1 }, (_, index) => (
          <View key={`column-${index}`} pointerEvents="none" style={[styles.verticalGuide, { left: `${(index / COLUMN_COUNT) * 100}%` }]} />
        ))}
        {Array.from({ length: TRACK_COUNT + 1 }, (_, index) => (
          <View key={`row-${index}`} pointerEvents="none" style={[styles.horizontalGuide, { top: `${(index / TRACK_COUNT) * 100}%` }]} />
        ))}
        {Array.from({ length: TRACK_COUNT }, (_, track) => {
          const rowTargets = targets.filter((target) => target.track === track);
          const rowFeedback = feedback?.track === track ? feedback.type : null;
          return (
            <TouchableOpacity
              key={track}
              activeOpacity={0.86}
              onPress={() => onPress(track)}
              style={[
                styles.trackTouch,
                { top: `${(track / TRACK_COUNT) * 100}%`, height: `${100 / TRACK_COUNT}%` },
                rowFeedback === "success" && styles.trackSuccess,
                rowFeedback === "error" && styles.trackError,
                rowFeedback === "missed" && styles.trackMissed,
              ]}
            >
              {rowTargets.map((target) => (
                <View key={target.id} pointerEvents="none" style={[styles.symbol, { left: `${((target.column + 0.5) / COLUMN_COUNT) * 100}%` }]}>
                  <SignalGlyph symbol={target.symbol} />
                </View>
              ))}
            </TouchableOpacity>
          );
        })}
      </View>
      {Array.from({ length: TRACK_COUNT }, (_, track) => (
        <View key={track} pointerEvents="none" style={[styles.trackPointer, { top: `${((track + 0.5) / TRACK_COUNT) * 100}%` }]} />
      ))}
    </View>
  );
}

function RadarPreview() {
  const previewRows = [
    ["circle", "circle", "circle", "circle"],
    ["circle", "circle", "octagon", "circle"],
    ["circle", "circle", "circle", "circle"],
    ["circle", "circle", "circle", "circle"],
  ];

  return <View style={styles.previewRadar}><PreviewGuides /><View style={styles.previewLines}>{previewRows.map((symbols, rowIndex) => <View key={rowIndex} style={styles.previewLine}>{symbols.map((symbol, index) => <View key={index} style={[styles.previewSymbol, { left: `${6.25 + index * 25}%` }, symbol === "octagon" && styles.previewAnomaly]}><SignalGlyph symbol={symbol} color={symbol === "octagon" ? ACCENT : undefined} /></View>)}</View>)}</View></View>;
}


// `daily` ({ seed, onFinish, onExit }) turns this into the daily training version: no preflight, the day's
// 90-second stream (DAILY_PHASES), then onFinish({ score, metrics, trials }).
export function SymbolRadarGame({ onExit, daily = null }) {
  const [durationMinutes, setDurationMinutes] = useState(1); const [speed, setSpeed] = useState(2); const [phase, setPhase] = useState(daily ? "ready" : "preflight"); const [remainingMs, setRemainingMs] = useState(0); const [pace, setPace] = useState(2); const [targets, setTargets] = useState([]); const [feedback, setFeedback] = useState(null); const [stats, setStats] = useState({ hits: 0, missed: 0, falseAlarms: 0 }); const [summary, setSummary] = useState(null);
  const timersRef = useRef([]); const intervalsRef = useRef([]); const activeRef = useRef(false); const targetsRef = useRef([]); const statsRef = useRef(stats); const scheduleRef = useRef(null); const outcomesRef = useRef([]); const startedAtRef = useRef(0);
  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({ onPrepareReturn: clearTimers, onReturnComplete: resetToPreflight });

  useEffect(() => () => clearTimers(), []);
  function clearTimers() { timersRef.current.forEach(clearTimeout); intervalsRef.current.forEach(clearInterval); timersRef.current = []; intervalsRef.current = []; activeRef.current = false; }
  function queue(callback, delay) { timersRef.current.push(setTimeout(callback, delay)); }
  function updateStats(update) { statsRef.current = { ...statsRef.current, ...update(statsRef.current) }; setStats(statsRef.current); }
  function renderTargets() { setTargets([...targetsRef.current]); }
  function resetToPreflight() { clearTimers(); setTargets([]); setFeedback(null); setSummary(null); setPhase("preflight"); }
  function resetToReady() { clearTimers(); setTargets([]); setFeedback(null); setSummary(null); setPhase("ready"); }
  function prepareRun() { void triggerSelectionHaptic(); startMission(resetToReady); }
  function startGame() {
    clearTimers();
    const clean = { hits: 0, missed: 0, falseAlarms: 0 };
    setStats(clean); statsRef.current = clean; setFeedback(null); targetsRef.current = []; setTargets([]); outcomesRef.current = [];
    const schedule = daily ? buildDailySchedule(daily.seed) : buildSession({ speed, durationMinutes }, randomSeed());
    scheduleRef.current = schedule;
    setRemainingMs(schedule.totalMs); setPace(schedule.ticks[0].speed);
    activeRef.current = true; setPhase("playing"); void triggerSelectionHaptic();
    startedAtRef.current = Date.now();
    intervalsRef.current.push(setInterval(() => setRemainingMs(schedule.totalMs - (Date.now() - startedAtRef.current)), 250));
    runTick(0);
  }
  function runTick(index) {
    const schedule = scheduleRef.current;
    const tick = schedule.ticks[index];
    queue(() => {
      if (tick.move) {
        const exiting = targetsRef.current.filter((target) => target.column >= COLUMN_COUNT - 1);
        exiting.filter((target) => target.isAnomaly && !target.hit).forEach((target) => {
          outcomesRef.current.push({ points: -MISS_COST, outcome: "missed", reactionMs: null, speed: tick.speed });
          updateStats((current) => ({ ...current, missed: current.missed + 1 }));
          setFeedback({ type: "missed", track: target.track }); void triggerErrorHaptic(); queue(() => setFeedback(null), 420);
        });
        targetsRef.current = targetsRef.current.filter((target) => !exiting.includes(target)).map((target) => ({ ...target, column: target.column + 1 }));
      }
      const now = Date.now();
      schedule.spawns[index].forEach((entry, position) => targetsRef.current.push({ id: `${index}-${position}`, track: entry.track, column: 0, symbol: entry.isAnomaly ? "octagon" : "circle", isAnomaly: entry.isAnomaly, spawnedAt: now, hit: false }));
      setPace(tick.speed);
      renderTargets();
      if (index + 1 < schedule.ticks.length) runTick(index + 1); else finishGame();
    }, tick.delayMs);
  }
  function finishGame() {
    clearTimers(); targetsRef.current = []; setTargets([]);
    const outcomes = outcomesRef.current; const { falseAlarms } = statsRef.current; const anomalies = scheduleRef.current.anomalies;
    if (daily) { daily.onFinish(dailyResult(outcomes, falseAlarms, anomalies)); return; }
    const result = sessionSummary(outcomes, falseAlarms, anomalies);
    setSummary(result); setPhase("summary");
  }
  function pressTrack(track) {
    if (!activeRef.current) return;
    const anomaly = targetsRef.current.find((target) => target.track === track && target.isAnomaly && !target.hit);
    if (anomaly) {
      anomaly.hit = true;
      const points = anomalyPoints(anomaly.column);
      const late = points < 1;
      outcomesRef.current.push({ points, outcome: late ? "late" : "fast", reactionMs: Date.now() - anomaly.spawnedAt, speed: pace });
      updateStats((current) => ({ ...current, hits: current.hits + 1 }));
      setFeedback({ type: "success", track, points });
      void triggerSuccessHaptic();
      queue(() => { targetsRef.current = targetsRef.current.filter((target) => target.track !== track); renderTargets(); }, 280);
      queue(() => setFeedback(null), 780);
      return;
    }
    updateStats((current) => ({ ...current, falseAlarms: current.falseAlarms + 1 }));
    setFeedback({ type: "error", track });
    void triggerErrorHaptic();
    queue(() => setFeedback(null), 820);
  }
  const preflight = <GameSetupShell title="Anomaly Detection" categoryKey="attention" onExit={onExit} onStart={prepareRun} rules="Tests sustained visual attention. Monitor the moving signal lines and tap only when a line contains an octagon. An anomaly earns 1 point if caught in the first quarter of the screen, then 0.75, 0.5 and 0.25 by quarter, and costs 1 point if missed; each false alarm (a tap on a line without octagon) costs half a point. The score is the share of points earned, out of 1000.Easy: Signals move slowly.Medium: Signals update at a normal pace.Hard: Signals move quickly."><PickerSetting label="Duration" hint="In minutes" options={[1, 2, 3].map((value) => ({ value, label: String(value) }))} value={durationMinutes} onChange={setDurationMinutes} /><PickerSetting label="Signal pace" options={[{ value: 1, label: "SLOW" }, { value: 2, label: "MEDIUM" }, { value: 3, label: "FAST" }]} value={speed} onChange={setSpeed} /></GameSetupShell>;

  return <View style={styles.container}>{phase === "preflight" || isReturning ? <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflight}</Animated.View> : null}{phase !== "preflight" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, !daily && missionStyle]}><View style={styles.header}><Pressable onPress={daily ? daily.onExit : returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>{phase === "ready" ? <Pressable onPress={startGame} style={styles.readyScreen}><Text style={styles.kicker}>{daily ? "DAILY TRAINING" : "ANOMALY DETECTION"}</Text><Text style={styles.readyTitle}>Find the outlier.</Text><Text style={styles.readyText}>{daily ? "90 seconds, the signals speeding up every 30. Tap a line only when it contains an octagon: the sooner, the more points." : "Tap the signal line only when it contains an octagon"}</Text><PulsingPrompt color={ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt><RadarPreview /></Pressable> : null}{phase === "playing" ? <Animated.View entering={FadeIn.duration(150)} style={styles.playScreen}><View style={styles.statusRow}><Text style={styles.statusText}>TIME {formatTime(remainingMs)}</Text><Text style={styles.statusText}>PACE {PACE_LABELS[pace]}</Text><Text style={styles.statusText}>DETECTED {stats.hits}</Text></View><Text style={styles.instruction}>Tap the line with the octagon</Text><RadarDisplay targets={targets} feedback={feedback} onPress={pressTrack} /><Text style={[styles.feedbackText, feedback?.type === "success" && styles.feedbackSuccess, feedback?.type === "error" && styles.feedbackError]}>{feedback?.type === "success" ? `ANOMALY DETECTED · ${feedback.points === 1 ? "+1" : `+${feedback.points}`}` : feedback?.type === "error" ? "FALSE ALARM" : feedback?.type === "missed" ? "ANOMALY MISSED" : ""}</Text></Animated.View> : null}{phase === "summary" && summary ? <Animated.View entering={FadeIn.duration(180)} style={styles.summaryScreen}><Text style={styles.kicker}>SESSION ENDED</Text><Text style={styles.summaryTitle}>Scan complete</Text><Text style={styles.score}>{summary.score}</Text><Text style={styles.scoreCaption}>/ 1000</Text><View style={styles.statCard}><Text style={styles.statLabel}>SESSION DATA</Text><Text style={styles.statLine}>Anomalies detected <Text style={styles.statStrong}>{summary.fast + summary.late} / {summary.anomalies}</Text></Text><Text style={styles.statLine}>Full points · partial <Text style={styles.statStrong}>{summary.fast} · {summary.late}</Text></Text><Text style={styles.statLine}>Anomalies missed <Text style={styles.statStrong}>{summary.missed}</Text></Text><Text style={styles.statLine}>False alarms <Text style={styles.statStrong}>{summary.falseAlarms}</Text></Text><Text style={styles.statLine}>Average detection <Text style={styles.statStrong}>{summary.meanReactionMs !== null ? `${summary.meanReactionMs} ms` : "—"}</Text></Text></View><View style={styles.actions}><TouchableOpacity activeOpacity={0.88} onPress={resetToReady} style={styles.primaryButton}><Text style={styles.primaryText}>Play again</Text></TouchableOpacity><TouchableOpacity activeOpacity={0.88} onPress={returnToPreflight} style={styles.secondaryButton}><Text style={styles.secondaryText}>Change settings</Text></TouchableOpacity></View></Animated.View> : null}</Animated.View> : null}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SPACE_CADET.black }, preflightLayer: { ...StyleSheet.absoluteFill, zIndex: 1 }, missionLayer: { flex: 1, backgroundColor: SPACE_CADET.black, zIndex: 2 }, header: { height: 64, paddingHorizontal: 20, justifyContent: "center" }, backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, backArrow: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 }, pressed: { transform: [{ scale: 0.97 }] }, kicker: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.9, textAlign: "center" },
  readyScreen: { flex: 1, alignItems: "center", paddingHorizontal: 28, paddingTop: 45 }, readyTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 31, textAlign: "center", marginTop: 9 }, readyText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 21, textAlign: "center", maxWidth: 290, marginTop: 12 }, beginPrompt: { marginTop: 27 }, previewRadar: { width: 300, height: 224, borderRadius: 18, overflow: "hidden", backgroundColor: SPACE_CADET.surface1, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, marginTop: 25 }, previewGrid: { display: "none" }, previewLines: { ...StyleSheet.absoluteFill }, previewLine: { flex: 1, position: "relative" }, previewSymbol: { position: "absolute", top: "50%", width: 25, height: 25, marginLeft: -12.5, marginTop: -12.5, alignItems: "center", justifyContent: "center" }, previewAnomaly: { shadowColor: ACCENT, shadowOpacity: 0.48, shadowRadius: 13, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  playScreen: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingBottom: 20 }, statusRow: { width: "100%", flexDirection: "row", justifyContent: "space-between", marginTop: 18 }, statusText: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.35 }, instruction: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 24, marginTop: 14, marginBottom: 20 }, radarShell: { width: RADAR_WIDTH + 16, height: RADAR_HEIGHT, position: "relative", paddingLeft: 16 }, radar: { width: RADAR_WIDTH, height: RADAR_HEIGHT, backgroundColor: SPACE_CADET.surface1, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, borderRadius: 18, overflow: "hidden", position: "relative" }, guideOverlay: { position: "absolute", top: 0, left: 0 }, verticalGuide: { display: "none" }, horizontalGuide: { display: "none" }, trackTouch: { position: "absolute", right: 0, left: 0, justifyContent: "center" }, trackSuccess: { backgroundColor: "rgba(52,211,153,0.13)", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "rgba(52,211,153,0.72)", transform: [{ translateY: 1 }] }, trackError: { backgroundColor: "rgba(216,30,91,0.15)", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "rgba(216,30,91,0.72)", transform: [{ translateY: 1 }] }, trackMissed: { backgroundColor: "rgba(216,30,91,0.12)", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "rgba(216,30,91,0.64)", transform: [{ translateY: 1 }] }, trackPointer: { position: "absolute", left: 2, width: 0, height: 0, marginTop: -4, borderTopWidth: 4, borderBottomWidth: 4, borderLeftWidth: 7, borderTopColor: "transparent", borderBottomColor: "transparent", borderLeftColor: SPACE_CADET.textTertiary }, symbol: { position: "absolute", top: "50%", width: 25, height: 25, marginLeft: -12.5, marginTop: -12.5, alignItems: "center", justifyContent: "center" }, feedbackText: { minHeight: 18, marginTop: 13, color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.4 }, feedbackSuccess: { color: SUCCESS }, feedbackError: { color: ACCENT },
  summaryScreen: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 58, paddingBottom: 28 }, summaryTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 31, marginTop: 8 }, score: { color: ACCENT, fontFamily: "Garet-Book", fontSize: 76, lineHeight: 88, marginTop: 18 }, scoreCaption: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 16, marginTop: -4 }, statCard: { width: "100%", backgroundColor: SPACE_CADET.surface1, borderRadius: 22, padding: 18, marginTop: 30 }, statLabel: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6, marginBottom: 10 }, statLine: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13, lineHeight: 22 }, statStrong: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 15 }, actions: { width: "100%", gap: 12, marginTop: "auto" }, primaryButton: { width: "100%", minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.white }, primaryText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 16 }, secondaryButton: { width: "100%", minHeight: 52, borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" }, secondaryText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 },
});
