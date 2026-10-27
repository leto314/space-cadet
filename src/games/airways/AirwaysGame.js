import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import Svg, { Line, Polygon } from "react-native-svg";

import { GameSetupShell, PickerSetting } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { randomSeed } from "../../utils/random";
import { advance, BOARD_ROWS, buildDailySession, buildSession, COLUMNS, dailyResult, findIncident, isNecessaryAction, LANES_PER_GROUP, MAX_BLUE_IN_ZONE, MAX_IN_ZONE, RISK_ZONES, sectorLoad, sessionSummary, stepDelay } from "./logic";

const ACCENT = SPACE_CADET.multitasking;
const BLUE = SPACE_CADET.spatial;
const VIOLET = SPACE_CADET.mentalMath;
const ERROR = SPACE_CADET.attention;
const CLEAN_STATS = { rerouted: 0, laneActions: 0, bulkActions: 0, extraActions: 0, incidents: 0 };
const OPENING_MS = 700;
const INCIDENT_PAUSE_MS = 1500;

function formatTime(seconds) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }

function Plane({ plane, index, compact = false }) {
  const size = compact ? 12 : 16;
  const color = plane.color === "blue" ? BLUE : VIOLET;
  const points = plane.direction === "up" ? "8,1.5 14.5,14.5 1.5,14.5" : "1.5,1.5 14.5,1.5 8,14.5";
  return <View pointerEvents="none" style={[styles.plane, { width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, left: `${((index + 0.5) / LANES_PER_GROUP) * 100}%`, top: `${((plane.row + 0.5) / BOARD_ROWS) * 100}%` }]}><Svg width={size} height={size} viewBox="0 0 16 16"><Polygon points={points} fill={color} stroke={SPACE_CADET.black} strokeWidth="1" /></Svg></View>;
}

function CloseIcon({ color }) {
  return <Svg width="16" height="16" viewBox="0 0 16 16"><Line x1="3.3" y1="3.3" x2="12.7" y2="12.7" stroke={color} strokeWidth="1.25" strokeLinecap="round" /><Line x1="12.7" y1="3.3" x2="3.3" y2="12.7" stroke={color} strokeWidth="1.25" strokeLinecap="round" /></Svg>;
}

function RiskCells({ group, incident }) {
  const cells = [];
  for (const zone of RISK_ZONES[group]) for (let row = zone.top; row < zone.top + zone.rows; row += 1) for (let column = zone.left; column < zone.left + zone.columns; column += 1) cells.push({ row, column });
  return <>{cells.map(({ row, column }) => <View key={`${row}-${column}`} pointerEvents="none" style={[styles.riskCell, incident && styles.riskIncident, { top: `${(row / BOARD_ROWS) * 100}%`, left: `${(column / LANES_PER_GROUP) * 100}%`, width: `${100 / LANES_PER_GROUP}%`, height: `${100 / BOARD_ROWS}%` }]} />)}{incident ? <IncidentOutline group={group} /> : null}</>;
}

function GroupBoard({ group, planes, onClearLane, incident, compact = false }) {
  const lanes = COLUMNS.filter((column) => column.group === group);
  return <View style={[styles.groupWrap, compact && styles.compactGroupWrap]}><View style={[styles.groupBoard, compact && styles.compactBoard]}><RiskCells group={group} incident={incident} />{Array.from({ length: BOARD_ROWS + 1 }, (_, index) => <View key={`row-${index}`} pointerEvents="none" style={[styles.horizontalGuide, { top: `${(index / BOARD_ROWS) * 100}%` }]} />)}{lanes.map((lane, index) => <View key={lane.id} pointerEvents="none" style={[styles.verticalGuide, { left: `${(index / LANES_PER_GROUP) * 100}%` }]} />)}<View pointerEvents="none" style={styles.lastVerticalGuide} />{lanes.flatMap((lane, index) => planes.filter((plane) => plane.columnId === lane.id).map((plane) => <Plane key={plane.id} plane={plane} index={index} compact={compact} />))}</View></View>;
}

function LaneControls({ group, onClearLane }) {
  const lanes = COLUMNS.filter((column) => column.group === group);
  return <View style={styles.laneControlGroup}>{lanes.map((lane) => { const canClear = group === "left" ? lane.color === "blue" : lane.color === "violet"; return canClear ? <TouchableOpacity key={lane.id} activeOpacity={0.82} onPress={() => onClearLane(lane.id)} style={[styles.laneButton, lane.color === "blue" ? styles.blueLane : styles.violetLane]}><CloseIcon color={lane.color === "blue" ? BLUE : VIOLET} /></TouchableOpacity> : <View key={lane.id} style={styles.laneButtonSpacer} />; })}</View>;
}

function IncidentOutline({ group }) {
  return <>{RISK_ZONES[group].map((rectangle, index) => <View key={index} pointerEvents="none" style={[styles.incidentOutline, { top: `${(rectangle.top / BOARD_ROWS) * 100}%`, left: `${(rectangle.left / LANES_PER_GROUP) * 100}%`, width: `${(rectangle.columns / LANES_PER_GROUP) * 100}%`, height: `${(rectangle.rows / BOARD_ROWS) * 100}%` }]} />)}</>;
}

function PreviewAircraft({ color, downward = false, style }) {
  const points = downward ? "1.5,1.5 14.5,1.5 8,14.5" : "8,1.5 14.5,14.5 1.5,14.5";
  return <View style={[styles.previewAircraft, style]}><Svg width="16" height="16" viewBox="0 0 16 16"><Polygon points={points} fill={color} stroke={SPACE_CADET.black} strokeWidth="1" /></Svg></View>;
}

function AirwaysPreview() {
  const columns = 6;
  const rows = 5;
  return <View style={styles.previewFrame}><View style={styles.previewGrid}><View style={styles.previewRiskZone} />{Array.from({ length: columns + 1 }, (_, index) => <View key={`preview-column-${index}`} style={[styles.previewVerticalGuide, { left: `${(index / columns) * 100}%` }]} />)}{Array.from({ length: rows + 1 }, (_, index) => <View key={`preview-row-${index}`} style={[styles.previewHorizontalGuide, { top: `${(index / rows) * 100}%` }]} />)}<PreviewAircraft color={BLUE} style={{ left: "8.33%", top: "70%" }} /><PreviewAircraft color={BLUE} style={{ left: "58.33%", top: "90%" }} /><PreviewAircraft color={VIOLET} downward style={{ left: "25%", top: "10%" }} /><PreviewAircraft color={VIOLET} downward style={{ left: "75%", top: "30%" }} /><PreviewAircraft color={VIOLET} downward style={{ left: "41.67%", top: "50%" }} /></View></View>;
}

// `daily` ({ seed, onFinish, onExit }) turns this into the daily training version: no preflight, 90 seconds of
// traffic speeding up every 30 (an overload empties the sector and costs points instead of ending the session),
// then onFinish({ score, metrics, trials }).
export function AirwaysGame({ onExit, daily = null }) {
  const [durationMinutes, setDurationMinutes] = useState(1); const [speed, setSpeed] = useState(2); const [phase, setPhase] = useState(daily ? "ready" : "preflight"); const [remainingSeconds, setRemainingSeconds] = useState(60); const [planes, setPlanes] = useState([]); const [stats, setStats] = useState(CLEAN_STATS); const [incidentGroup, setIncidentGroup] = useState(null); const [stage, setStage] = useState(null);
  const timersRef = useRef([]); const intervalsRef = useRef([]); const activeRef = useRef(false); const planesRef = useRef([]); const statsRef = useRef(stats); const sessionRef = useRef(null); const elapsedRef = useRef(0); const stageRef = useRef(null);
  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({ onPrepareReturn: clearTimers, onReturnComplete: resetToPreflight });

  useEffect(() => () => clearTimers(), []);
  function clearTimers() { timersRef.current.forEach(clearTimeout); intervalsRef.current.forEach(clearInterval); timersRef.current = []; intervalsRef.current = []; activeRef.current = false; }
  function queue(callback, delay) { timersRef.current.push(setTimeout(callback, delay)); }
  function renderPlanes() { setPlanes([...planesRef.current]); }
  function updateStats(update) { statsRef.current = { ...statsRef.current, ...update(statsRef.current) }; setStats(statsRef.current); }
  function resetToPreflight() { clearTimers(); setPlanes([]); setIncidentGroup(null); setPhase("preflight"); }
  function resetToReady() { clearTimers(); setPlanes([]); setIncidentGroup(null); setPhase("ready"); }
  function prepareRun() { void triggerSelectionHaptic(); startMission(resetToReady); }
  function finishGame() {
    clearTimers();
    if (daily) { daily.onFinish(dailyResult(statsRef.current)); return; }
    setPhase("summary");
  }
  function applyStage(next) { stageRef.current = next; setStage(next); }
  // Full Clearance: an overload ends the session. Daily: the sector is emptied and the traffic resumes.
  function handleIncident(incident) {
    updateStats((current) => ({ ...current, incidents: current.incidents + 1 }));
    void triggerErrorHaptic();
    activeRef.current = false; setIncidentGroup(incident); setPhase("incident");
    if (!daily) { intervalsRef.current.forEach(clearInterval); intervalsRef.current = []; return; }
    queue(() => { planesRef.current = planesRef.current.filter((plane) => plane.group !== incident.group); renderPlanes(); setIncidentGroup(null); setPhase("playing"); activeRef.current = true; }, INCIDENT_PAUSE_MS);
  }
  function tick() {
    if (activeRef.current) {
      const next = advance(planesRef.current);
      next.push(...sessionRef.current.spawn(next));
      planesRef.current = next; renderPlanes();
      const incident = findIncident(next);
      if (incident) handleIncident(incident);
    }
    queue(tick, stepDelay(stageRef.current.speed));
  }
  function startGame() {
    clearTimers();
    const session = daily ? buildDailySession(daily.seed) : buildSession({ speed, durationMinutes }, randomSeed());
    sessionRef.current = session; elapsedRef.current = 0; applyStage(session.stageAt(0));
    planesRef.current = []; statsRef.current = CLEAN_STATS; setPlanes([]); setStats(CLEAN_STATS); setIncidentGroup(null); setRemainingSeconds(session.totalSeconds); activeRef.current = true; setPhase("playing"); void triggerSelectionHaptic();
    queue(() => { planesRef.current = session.opening(); renderPlanes(); }, OPENING_MS);
    queue(tick, stepDelay(session.stageAt(0).speed));
    intervalsRef.current.push(setInterval(() => {
      if (!activeRef.current) return;
      elapsedRef.current += 1;
      const next = session.stageAt(elapsedRef.current);
      if (!next) { setRemainingSeconds(0); finishGame(); return; }
      if (next.index !== stageRef.current.index) { applyStage(next); void triggerSelectionHaptic(); }
      setRemainingSeconds(session.totalSeconds - elapsedRef.current);
    }, 1000));
  }
  function clearLane(laneId) { if (!activeRef.current) return; const removedPlanes = planesRef.current.filter((plane) => plane.columnId === laneId); const necessary = isNecessaryAction(planesRef.current, removedPlanes); planesRef.current = planesRef.current.filter((plane) => plane.columnId !== laneId); renderPlanes(); updateStats((current) => ({ ...current, rerouted: current.rerouted + removedPlanes.length, laneActions: current.laneActions + 1, extraActions: current.extraActions + Number(!necessary) })); void triggerSelectionHaptic(); }
  function clearColor(color) { if (!activeRef.current) return; const removedPlanes = planesRef.current.filter((plane) => plane.color === color); const necessary = isNecessaryAction(planesRef.current, removedPlanes); planesRef.current = planesRef.current.filter((plane) => plane.color !== color); renderPlanes(); updateStats((current) => ({ ...current, rerouted: current.rerouted + removedPlanes.length, bulkActions: current.bulkActions + 1, extraActions: current.extraActions + Number(!necessary) })); void triggerSuccessHaptic(); }

  const leftLoad = sectorLoad(planes, "left"); const rightLoad = sectorLoad(planes, "right"); const summary = useMemo(() => sessionSummary(stats), [stats]);
  const preflight = <GameSetupShell title="Airways" categoryKey="multitasking" onExit={onExit} onStart={prepareRun} rules="Tests real-time traffic management. Keep aircraft from saturating the shaded sectors while using as few reroutes as possible. A sector may hold at most four aircraft, including no more than two blue aircraft.Easy: Slow traffic flow.Medium: Standard traffic flow.Hard: Fast traffic flow."><PickerSetting label="Duration" hint="In minutes" options={[1, 2, 3].map((value) => ({ value, label: String(value) }))} value={durationMinutes} onChange={setDurationMinutes} /><PickerSetting label="Traffic pace" options={[{ value: 1, label: "SLOW" }, { value: 2, label: "MEDIUM" }, { value: 3, label: "FAST" }]} value={speed} onChange={setSpeed} /></GameSetupShell>;
  const isIncident = phase === "incident";
  const incidentDetail = incidentGroup?.reason === "blue" ? `${incidentGroup.value} BLUE AIRCRAFT · LIMIT ${incidentGroup.limit}` : `${incidentGroup?.value ?? 0} AIRCRAFT · LIMIT ${incidentGroup?.limit ?? MAX_IN_ZONE}`;
  const content = phase === "ready" ? <Pressable onPress={startGame} style={styles.readyScreen}><Text style={styles.kicker}>{daily ? "DAILY TRAINING" : "AIRWAYS"}</Text><Text style={styles.readyTitle}>Keep the sectors clear.</Text><Text style={styles.readyText}>{daily ? "Ninety seconds, the traffic speeding up every thirty. Reroute before a shaded zone is saturated: an overload empties the sector and costs points." : "Reroute traffic before the shaded zones become saturated."}</Text><PulsingPrompt color={ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt><AirwaysPreview /></Pressable> : (phase === "playing" || phase === "incident") ? <Animated.View entering={FadeIn.duration(150)} style={styles.playScreen}>{isIncident ? <View style={styles.incidentBoardHeader}><Text style={styles.kicker}>SECTOR OVERLOAD</Text><Text style={styles.incidentReason}>{incidentDetail}</Text></View> : <><View style={styles.statusRow}><Text style={styles.statusText}>TIME {formatTime(remainingSeconds)}{daily && stage ? ` · ${stage.label}` : ""}</Text><Text style={styles.statusText}>REROUTED {stats.rerouted}</Text></View><View style={styles.sectorRow}><Text style={styles.sectorText}>LEFT {leftLoad.total}/{MAX_IN_ZONE} · <Text style={styles.blueCounter}>{leftLoad.blue}/{MAX_BLUE_IN_ZONE} BLUE</Text></Text><Text style={styles.sectorText}>RIGHT {rightLoad.total}/{MAX_IN_ZONE} · <Text style={styles.blueCounter}>{rightLoad.blue}/{MAX_BLUE_IN_ZONE} BLUE</Text></Text></View></>}<View style={styles.airwayFrame}><View style={styles.groupsRow}><GroupBoard group="left" planes={planes} incident={isIncident && incidentGroup?.group === "left"} /><GroupBoard group="right" planes={planes} incident={isIncident && incidentGroup?.group === "right"} /></View></View>{isIncident && !daily ? <TouchableOpacity activeOpacity={0.88} onPress={() => setPhase("summary")} style={styles.incidentResultsButton}><Text style={styles.primaryText}>View results</Text></TouchableOpacity> : <><View style={styles.laneControls}><LaneControls group="left" onClearLane={clearLane} /><LaneControls group="right" onClearLane={clearLane} /></View><View style={styles.bulkRow}><TouchableOpacity activeOpacity={0.86} onPress={() => clearColor("blue")} style={[styles.bulkButton, styles.blueBulk]} /><TouchableOpacity activeOpacity={0.86} onPress={() => clearColor("violet")} style={[styles.bulkButton, styles.violetBulk]} /></View></>}</Animated.View> : phase === "summary" ? <Animated.View entering={FadeIn.duration(180)} style={styles.summaryScreen}><Text style={styles.kicker}>SESSION ENDED</Text><Text style={styles.summaryTitle}>{stats.incidents ? "Traffic incident" : "Sector control complete"}</Text><Text style={styles.score}>{summary.efficiency}%</Text><Text style={styles.scoreCaption}>traffic efficiency</Text><View style={styles.statCard}><Text style={styles.statLabel}>SESSION DATA</Text><Text style={styles.statLine}>Aircraft rerouted <Text style={styles.statStrong}>{stats.rerouted}</Text></Text><Text style={styles.statLine}>Lane clearances <Text style={styles.statStrong}>{stats.laneActions}</Text></Text><Text style={styles.statLine}>Color clearances <Text style={styles.statStrong}>{stats.bulkActions}</Text></Text></View><View style={styles.actions}><TouchableOpacity activeOpacity={0.88} onPress={resetToReady} style={styles.primaryButton}><Text style={styles.primaryText}>Play again</Text></TouchableOpacity><TouchableOpacity activeOpacity={0.88} onPress={returnToPreflight} style={styles.secondaryButton}><Text style={styles.secondaryText}>Change settings</Text></TouchableOpacity></View></Animated.View> : null;

  return <View style={styles.container}>{phase === "preflight" || isReturning ? <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflight}</Animated.View> : null}{phase !== "preflight" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, !daily && missionStyle]}><View style={styles.header}><Pressable onPress={daily ? daily.onExit : returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>{content}</Animated.View> : null}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SPACE_CADET.black }, preflightLayer: { ...StyleSheet.absoluteFill, zIndex: 1 }, missionLayer: { flex: 1, backgroundColor: SPACE_CADET.black, zIndex: 2 }, header: { height: 64, paddingHorizontal: 20, justifyContent: "center" }, backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, backArrow: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 }, pressed: { transform: [{ scale: 0.97 }] }, kicker: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.9, textAlign: "center" },
  readyScreen: { flex: 1, alignItems: "center", paddingHorizontal: 26, paddingTop: 44 }, readyTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 31, marginTop: 9, textAlign: "center" }, readyText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 21, maxWidth: 290, marginTop: 12, textAlign: "center" }, beginPrompt: { marginTop: 27 }, previewFrame: { width: "100%", height: 228, marginTop: 24, borderRadius: 20, overflow: "hidden", backgroundColor: SPACE_CADET.surface1, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, padding: 13 }, previewBoards: { flex: 1, flexDirection: "row", gap: 10 }, legend: { height: 25, flexDirection: "row", justifyContent: "center", alignItems: "flex-end", gap: 18 }, legendItem: { flexDirection: "row", alignItems: "center", gap: 6 }, legendDot: { width: 6, height: 6, borderRadius: 3 }, legendText: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 8, letterSpacing: 1.05 },
  playScreen: { flex: 1, paddingHorizontal: 20, paddingBottom: 20 }, statusRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 18 }, statusText: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.35 }, sectorRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 10, marginBottom: 12 }, sectorText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-SemiBold", fontSize: 8, letterSpacing: 0.6 }, blueCounter: { color: BLUE }, airwayFrame: { flex: 1, minHeight: 405, borderRadius: 20, overflow: "hidden", backgroundColor: SPACE_CADET.surface1, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, padding: 11 }, groupsRow: { flex: 1, flexDirection: "row", gap: 10 }, groupWrap: { flex: 1 }, groupBoard: { flex: 1, position: "relative", overflow: "hidden", borderRadius: 12, backgroundColor: "#0A0A0C" }, compactBoard: { borderRadius: 10 }, riskZone: { position: "absolute", backgroundColor: "rgba(255,255,255,0.055)" }, riskIncident: { backgroundColor: "rgba(216,30,91,0.23)" }, leftRisk: { left: 0, width: "100%", top: `${(10 / BOARD_ROWS) * 100}%`, height: `${(4 / BOARD_ROWS) * 100}%` }, rightUpperRisk: { left: 0, width: "60%", top: `${(8 / BOARD_ROWS) * 100}%`, height: `${(3 / BOARD_ROWS) * 100}%` }, rightLowerRisk: { right: 0, width: "60%", top: `${(11 / BOARD_ROWS) * 100}%`, height: `${(4 / BOARD_ROWS) * 100}%` }, verticalGuide: { position: "absolute", top: 0, bottom: 0, borderLeftWidth: StyleSheet.hairlineWidth, borderStyle: "dotted", borderColor: "rgba(255,255,255,0.17)" }, lastVerticalGuide: { position: "absolute", right: 0, top: 0, bottom: 0, borderRightWidth: StyleSheet.hairlineWidth, borderStyle: "dotted", borderColor: "rgba(255,255,255,0.17)" }, horizontalGuide: { position: "absolute", left: 0, right: 0, borderTopWidth: StyleSheet.hairlineWidth, borderStyle: "dotted", borderColor: "rgba(255,255,255,0.11)" }, plane: { position: "absolute", alignItems: "center", justifyContent: "center" }, laneButtons: { flexDirection: "row", gap: 4, marginTop: 7 }, laneButton: { flex: 1, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" }, laneButtonSpacer: { flex: 1, height: 30 }, blueLane: { backgroundColor: "rgba(76,141,255,0.17)", borderWidth: 1, borderColor: "rgba(76,141,255,0.72)" }, violetLane: { backgroundColor: "rgba(196,107,255,0.17)", borderWidth: 1, borderColor: "rgba(196,107,255,0.72)" }, laneButtonText: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 19, lineHeight: 21 }, bulkRow: { flexDirection: "row", gap: 10, marginTop: 14 }, bulkButton: { flex: 1, height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }, blueBulk: { backgroundColor: "rgba(76,141,255,0.13)", borderWidth: 1, borderColor: "rgba(76,141,255,0.55)" }, violetBulk: { backgroundColor: "rgba(196,107,255,0.13)", borderWidth: 1, borderColor: "rgba(196,107,255,0.55)" }, bulkDot: { width: 7, height: 7, borderRadius: 4 }, bulkText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.05 },
  incidentScreen: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 96, paddingBottom: 28 }, incidentTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 31, marginTop: 8 }, incidentText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 15, lineHeight: 23, textAlign: "center", maxWidth: 284, marginTop: 15 }, incidentCard: { width: "100%", borderRadius: 20, backgroundColor: SPACE_CADET.surface1, padding: 18, marginTop: 31 }, incidentCardLabel: { color: ERROR, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.45 }, incidentCardText: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 16, lineHeight: 23, marginTop: 9 },
  summaryScreen: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 58, paddingBottom: 28 }, summaryTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 30, marginTop: 8 }, score: { color: ACCENT, fontFamily: "Garet-Book", fontSize: 76, lineHeight: 88, marginTop: 18 }, scoreCaption: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 16, marginTop: -4 }, statCard: { width: "100%", backgroundColor: SPACE_CADET.surface1, borderRadius: 22, padding: 18, marginTop: 30 }, statLabel: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6, marginBottom: 10 }, statLine: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13, lineHeight: 22 }, statStrong: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 15 }, actions: { width: "100%", gap: 12, marginTop: "auto" }, primaryButton: { width: "100%", minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.white }, primaryText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 16 }, secondaryButton: { width: "100%", minHeight: 52, borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" }, secondaryText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 },
  riskCell: { position: "absolute", backgroundColor: "rgba(255,255,255,0.055)" },
  verticalGuide: { position: "absolute", top: 0, bottom: 0, borderLeftWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  lastVerticalGuide: { position: "absolute", right: 0, top: 0, bottom: 0, borderRightWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  horizontalGuide: { position: "absolute", left: 0, right: 0, borderTopWidth: 1, borderStyle: "dotted", borderColor: "rgba(255,255,255,0.12)" },
  bulkButton: { flex: 1, height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  airwayFrame: { flex: 1, minHeight: 390, borderRadius: 14, overflow: "hidden", backgroundColor: SPACE_CADET.surface1, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, padding: 0 },
  groupsRow: { flex: 1, flexDirection: "row", gap: 0 }, groupBoard: { flex: 1, position: "relative", overflow: "hidden", borderRadius: 0, backgroundColor: "#0A0A0C", borderBottomWidth: 1, borderStyle: "dotted", borderColor: "rgba(255,255,255,0.12)" },
  horizontalGuide: { position: "absolute", left: 0, right: 0, borderTopWidth: 1, borderStyle: "dotted", borderColor: "rgba(255,255,255,0.12)" },
  airwayFrame: { flex: 1, minHeight: 390, borderRadius: 22, overflow: "hidden", backgroundColor: SPACE_CADET.surface1, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, padding: 0 },
  groupsRow: { flex: 1, flexDirection: "row", gap: 0 }, groupBoard: { flex: 1, position: "relative", overflow: "hidden", borderRadius: 0, backgroundColor: "#0A0A0C", borderBottomWidth: 1, borderStyle: "dotted", borderColor: "rgba(255,255,255,0.12)" },
  riskIncident: { backgroundColor: "rgba(216,30,91,0.30)", borderWidth: 1, borderColor: "rgba(216,30,91,0.72)", shadowColor: ERROR, shadowOpacity: 0.22, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } },
  laneControls: { flexDirection: "row", marginTop: 8 }, laneControlGroup: { flex: 1, flexDirection: "row" }, laneButton: { flex: 1, height: 42, alignItems: "center", justifyContent: "center" }, laneButtonSpacer: { flex: 1, height: 42 },
  blueBulk: { backgroundColor: "rgba(76,141,255,0.13)", borderWidth: 1, borderColor: "rgba(76,141,255,0.70)" }, violetBulk: { backgroundColor: "rgba(196,107,255,0.13)", borderWidth: 1, borderColor: "rgba(196,107,255,0.70)" }, bulkDot: { display: "none" }, bulkText: { display: "none" }, bulkRow: { flexDirection: "row", gap: 10, marginTop: 13, marginBottom: 14 },
  incidentBoardHeader: { height: 58, alignItems: "center", justifyContent: "center" }, incidentReason: { color: SPACE_CADET.white, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.35, marginTop: 8 }, incidentResultsButton: { marginTop: 18, width: "100%", height: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.white },
  laneButton: { flex: 1, height: 42, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  riskIncident: { backgroundColor: "rgba(104,16,39,0.58)" }, incidentOutline: { position: "absolute", zIndex: 2, borderWidth: 1.5, borderColor: ERROR, shadowColor: ERROR, shadowOpacity: 0.42, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  previewFrame: { width: "100%", height: 174, marginTop: 24, borderRadius: 20, overflow: "hidden", backgroundColor: SPACE_CADET.surface1, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, padding: 15 }, previewGrid: { flex: 1, position: "relative", overflow: "hidden", borderRadius: 10, backgroundColor: "#0A0A0C" }, previewRiskZone: { position: "absolute", left: 0, right: 0, top: "40%", height: "40%", backgroundColor: "rgba(255,255,255,0.07)" }, previewVerticalGuide: { position: "absolute", top: 0, bottom: 0, borderLeftWidth: 1, borderColor: "rgba(255,255,255,0.18)" }, previewHorizontalGuide: { position: "absolute", left: 0, right: 0, borderTopWidth: 1, borderStyle: "dotted", borderColor: "rgba(255,255,255,0.12)" }, previewAircraft: { position: "absolute", width: 16, height: 16, marginLeft: -8, marginTop: -8, alignItems: "center", justifyContent: "center" }, previewBluePlane: { left: "15%", top: "70%" }, previewVioletPlane: { left: "73%", top: "20%" },
});
