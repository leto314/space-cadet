import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { clamp, Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { PressScaleButton } from "../components/GameSetupShell";
import { CATEGORY_COLORS, getCategoryLabel, SPACE_CADET } from "../theme/spaceCadet";
import { triggerSelectionHaptic } from "../utils/haptics";
import { deriveSeed, missionDay } from "../utils/random";
import { syncTrustedTime, trustedNow } from "../utils/trustedTime";
import { competenceShares, missionForDay } from "./generator";
import { formatClock } from "./kit";
import { CompetenceLine } from "./MissionModeScreen";
import { MissionScreen } from "./MissionScreen";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Two lengths of the same mission (see FORMATS in generator.js: the duration depends on the number of systems
// and changes a little from day to day).
const FORMATS = [{ key: "short", label: "SHORT" }, { key: "regular", label: "REGULAR" }];

// The Daily Missions card opens this sheet, like Full Clearance: a short summary that slides up from the bottom
// (day, competence line, length, start) and can be pulled up to full screen, where the same content gets more
// room and the list of today's systems appears.
export function DailyMissionSheet({ onClose }) {
  const { height } = useWindowDimensions();
  const collapsedOffset = Math.round(height * 0.42);
  const [day, setDay] = useState(null);
  const [clockState, setClockState] = useState("syncing");
  const [format, setFormat] = useState("short");
  const [flight, setFlight] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const sheetY = useSharedValue(height);
  const dragOrigin = useSharedValue(collapsedOffset);
  // The mission of the day, with its memory of the days before it (rebuilt, not stored: the same on every phone).
  const mission = useMemo(() => (day ? missionForDay(day.key) : null), [day]);

  useEffect(() => { sheetY.value = withTiming(collapsedOffset, { duration: 360, easing: Easing.out(Easing.cubic) }); }, [collapsedOffset, sheetY]);
  useEffect(() => { void resolveDay(); }, []);

  // The mission of the day is chosen from server time (midnight in France for everyone), never from the phone's
  // clock. Development builds fall back to the device clock so the web preview works offline.
  async function resolveDay() {
    setClockState("syncing");
    if (await syncTrustedTime()) { setDay(missionDay(trustedNow())); setClockState("verified"); return; }
    if (__DEV__) { setDay(missionDay(Date.now())); setClockState("unverified"); return; }
    setClockState("offline");
  }
  function closeSheet() {
    sheetY.value = withTiming(height, { duration: 260, easing: Easing.in(Easing.cubic) }, (finished) => { if (finished) runOnJS(onClose)(); });
  }
  function choose(key) { void triggerSelectionHaptic(); setFormat(key); }
  function start() {
    setFlight({
      key: Date.now(),
      moduleIds: mission.moduleIds,
      durationMs: mission.durations[format],
      seed: deriveSeed(mission.seed, format),
      kicker: "DAILY MISSION",
      label: `${MONTHS[day.month].slice(0, 3).toUpperCase()} ${day.day}`,
      progressive: true,
      source: "daily",
      dayKey: day.key,
      format,
    });
  }

  // Drag anywhere on the sheet: up to open it fully, down to bring it back or to dismiss it.
  const pan = Gesture.Pan().activeOffsetY([-8, 8]).onBegin(() => { dragOrigin.value = sheetY.value; }).onUpdate((event) => { sheetY.value = clamp(dragOrigin.value + event.translationY, 0, height); }).onEnd((event) => {
    if (sheetY.value > collapsedOffset * 1.25 || (event.velocityY > 900 && sheetY.value > collapsedOffset * 0.88)) {
      sheetY.value = withTiming(height, { duration: 250, easing: Easing.in(Easing.cubic) }, (finished) => { if (finished) runOnJS(onClose)(); });
      return;
    }
    const expand = event.velocityY < -500 || (event.velocityY < 500 && sheetY.value < collapsedOffset * 0.6);
    sheetY.value = withTiming(expand ? 0 : collapsedOffset, { duration: 300, easing: Easing.out(Easing.cubic) });
    runOnJS(setExpanded)(expand);
  });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: interpolate(sheetY.value, [0, collapsedOffset, height], [0.72, 0.48, 0]) }));
  const handleStyle = useAnimatedStyle(() => ({ opacity: interpolate(sheetY.value, [0, collapsedOffset * 0.55, collapsedOffset], [0, 0, 1]) }));
  // Open = 1, collapsed = 0: spacing grows and the systems list fades in as the sheet opens.
  const breatheStyle = useAnimatedStyle(() => ({ height: interpolate(sheetY.value, [0, collapsedOffset], [30, 0], "clamp") }));
  const topStyle = useAnimatedStyle(() => ({ height: interpolate(sheetY.value, [0, collapsedOffset], [44, 0], "clamp") }));
  const systemsStyle = useAnimatedStyle(() => ({ opacity: interpolate(sheetY.value, [0, collapsedOffset * 0.5], [1, 0], "clamp") }));
  // The start button stays at the bottom of the screen whatever the sheet's position.
  const backStyle = useAnimatedStyle(() => ({ opacity: interpolate(sheetY.value, [0, collapsedOffset * 0.4], [1, 0], "clamp") }));
  const footerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.min(sheetY.value, collapsedOffset) }] }));

  return <View style={styles.overlay}>
    <Animated.View pointerEvents="none" style={[styles.backdrop, backdropStyle]} />
    <Pressable onPress={closeSheet} style={styles.outsideTap} />
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.sheet, sheetStyle]}>
        <Animated.View style={[styles.handleWrap, handleStyle]}><View style={styles.sheetHandle} /></Animated.View>
        <Animated.View style={topStyle} />
        <Animated.View pointerEvents={expanded ? "auto" : "none"} style={[styles.backWrap, backStyle]}><Pressable onPress={closeSheet} hitSlop={12} style={styles.backButton}><Text style={styles.backArrow}>←</Text></Pressable></Animated.View>
        <View style={styles.body}>
          <Text style={styles.kicker}>DAILY MISSION</Text>
          <Text style={styles.title}>{day ? `${MONTHS[day.month]} ${day.day}` : " "}</Text>

          {!mission ? <View style={styles.centerState}>
            {clockState === "syncing" ? <ActivityIndicator color={SPACE_CADET.textSecondary} /> : <>
              <Text style={styles.stateText}>The daily mission starts at the same time for every cadet. Connect to the internet to receive today's mission.</Text>
              <Pressable onPress={resolveDay} hitSlop={10}><Text style={styles.retry}>Try again</Text></Pressable>
            </>}
          </View> : <>
            <Animated.View style={breatheStyle} />
            <View style={styles.lineTop}>
              <Text style={styles.label}>{mission.moduleIds.length} SYSTEMS{clockState === "unverified" ? " · UNVERIFIED CLOCK" : ""}</Text>
              <Text style={styles.label}>ONE BY ONE</Text>
            </View>
            <CompetenceLine moduleIds={mission.moduleIds} legend={false} />
            <Animated.View style={breatheStyle} />
            <View style={styles.formats}>
              {FORMATS.map((entry) => {
                const selected = format === entry.key;
                return <Pressable key={entry.key} onPress={() => choose(entry.key)} style={[styles.format, selected && styles.formatSelected]}>
                  <Text style={[styles.formatLabel, selected && styles.formatLabelSelected]}>{entry.label}</Text>
                  <Text style={[styles.formatValue, !selected && styles.formatValueDim]}>{formatClock(mission.durations[entry.key])}</Text>
                </Pressable>;
              })}
            </View>
            <Animated.View style={breatheStyle} />
            {/* Opened fully, the sheet names the competences behind the line; the systems themselves stay a surprise. */}
            <Animated.View style={systemsStyle}>
              <Text style={styles.label}>TODAY'S FOCUS</Text>
              {competenceShares(mission.moduleIds).map(({ competence, share }) => <View key={competence} style={styles.system}>
                <View style={[styles.systemDot, { backgroundColor: CATEGORY_COLORS[competence] }]} />
                <Text style={styles.systemText}>{getCategoryLabel(competence)}</Text>
                <Text style={styles.systemShare}>{Math.round(share * 100)}%</Text>
              </View>)}
            </Animated.View>
          </>}
        </View>
        {mission ? <Animated.View style={[styles.footer, footerStyle]}><PressScaleButton onPress={start}>Start mission</PressScaleButton></Animated.View> : null}
      </Animated.View>
    </GestureDetector>
    {flight ? <View style={styles.flight}><MissionScreen key={flight.key} mission={flight} onClose={() => setFlight(null)} /></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, bottom: -34, zIndex: 20 }, backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "#000" }, outsideTap: { ...StyleSheet.absoluteFill },
  sheet: { ...StyleSheet.absoluteFill, backgroundColor: SPACE_CADET.black, borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: "hidden" },
  handleWrap: { height: 32, paddingTop: 11, alignItems: "center" }, sheetHandle: { width: 38, height: 4, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.54)" },
  body: { paddingHorizontal: 20 },
  backWrap: { position: "absolute", left: 12, top: 22 }, backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, backArrow: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 },
  kicker: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 10, letterSpacing: 2.1 }, title: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 30, marginTop: 3, marginBottom: 20 },
  centerState: { minHeight: 170, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }, stateText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13, lineHeight: 19, textAlign: "center" }, retry: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15, marginTop: 18 },
  lineTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }, label: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.4 },
  formats: { flexDirection: "row", gap: 10, marginTop: 22 },
  format: { flex: 1, borderRadius: 18, borderWidth: 1, borderColor: SPACE_CADET.borderSubtle, paddingVertical: 14, paddingHorizontal: 16 }, formatSelected: { borderColor: SPACE_CADET.white, backgroundColor: "rgba(255,255,255,0.07)" },
  formatLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.5 }, formatLabelSelected: { color: SPACE_CADET.textSecondary }, formatValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 26, marginTop: 4 }, formatValueDim: { color: SPACE_CADET.textTertiary },
  system: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 }, systemDot: { width: 7, height: 7, borderRadius: 4 }, systemText: { flex: 1, color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 }, systemShare: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 15 },
  footer: { position: "absolute", right: 0, left: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 68, backgroundColor: SPACE_CADET.black },
  flight: { position: "absolute", top: 0, right: 0, left: 0, bottom: 34, zIndex: 40, backgroundColor: SPACE_CADET.black },
});
