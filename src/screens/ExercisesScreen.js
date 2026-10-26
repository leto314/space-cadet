import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { clamp, Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { useEffect, useMemo, useState } from "react";

import { AirwaysGame } from "../games/airways/AirwaysGame";
import { CircuitsGame } from "../games/circuits/CircuitsGame";
import { ContinuousTotalGame } from "../games/continuous-total/ContinuousTotalGame";
import { EstimationGame } from "../games/estimation/EstimationGame";
import { LandingOrderGame } from "../games/landing-order/LandingOrderGame";
import { MentalMathGame } from "../games/mental-math/MentalMathGame";
import { MemorySpanGame } from "../games/memory-span/MemorySpanGame";
import { MultitaskingGame } from "../games/multitasking/MultitaskingGame";
import { CubeNetsGame } from "../games/cube-nets/CubeNetsGame";
import { NBackGame } from "../games/n-back/NBackGame";
import { PatternMatrixGame } from "../games/pattern-matrix/PatternMatrixGame";
import { ReactionTimeGame } from "../games/reaction-time/ReactionTimeGame";
import { SelectiveAttentionGame } from "../games/selective-attention/SelectiveAttentionGame";
import { SpatialBeaconGame } from "../games/spatial-beacon/SpatialBeaconGame";
import { SpatialOrientationGame } from "../games/spatial-orientation/SpatialOrientationGame";
import { SwitchboardGame } from "../games/switchboard/SwitchboardGame";
import { SymbolRadarGame } from "../games/symbol-radar/SymbolRadarGame";
import { TurnCountGame } from "../games/turn-count/TurnCountGame";
import { VisualGridMemoryGame } from "../games/visual-grid-memory/VisualGridMemoryGame";
import { VisualScanGame } from "../games/visual-scan/VisualScanGame";
import { EXERCISES } from "../data/exercises";
import { LinearGradient } from "expo-linear-gradient";
import { MissionModeScreen, RAINBOW } from "../missions/MissionModeScreen";
import { DailyGameScreen } from "../daily/DailyGameScreen";
import { DAILY_GAMES } from "../daily/registry";
import { CATEGORY_COLORS, getCategoryLabel, SPACE_CADET } from "../theme/spaceCadet";

const games = {
  "spatial-orientation": SpatialOrientationGame, "reaction-time": ReactionTimeGame, "memory-span": MemorySpanGame, "selective-attention": SelectiveAttentionGame,
  "n-back": NBackGame, "spatial-beacon": SpatialBeaconGame, "mental-math": MentalMathGame, "continuous-total": ContinuousTotalGame,
  "visual-grid-memory": VisualGridMemoryGame, "turn-count": TurnCountGame, multitasking: MultitaskingGame, "symbol-radar": SymbolRadarGame, airways: AirwaysGame, estimation: EstimationGame, "visual-scan": VisualScanGame, switchboard: SwitchboardGame, "landing-order": LandingOrderGame, "pattern-matrix": PatternMatrixGame, circuits: CircuitsGame, "cube-nets": CubeNetsGame, "mission-mode": MissionModeScreen,
};

const CATEGORY_KEYS = Object.keys(CATEGORY_COLORS);

function HueDot() {
  return <Svg width="14" height="14" viewBox="0 0 28 28"><Path d="M14 14 14 0A14 14 0 0 1 26.1 7Z" fill="#FF314A" /><Path d="M14 14 26.1 7A14 14 0 0 1 26.1 21Z" fill="#FFE81F" /><Path d="M14 14 26.1 21A14 14 0 0 1 7 26.1Z" fill="#50F052" /><Path d="M14 14 7 26.1A14 14 0 0 1 1.9 7Z" fill="#22D5FF" /><Path d="M14 14 1.9 7A14 14 0 0 1 14 0Z" fill="#B546FF" /></Svg>;
}

function BackArrow() {
  return <Svg width="24" height="24" viewBox="0 0 24 24"><Path d="M19 12H5m7-7-7 7 7 7" stroke={SPACE_CADET.white} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

function FilterButton({ label, color, selected, isAll, onPress }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.filterButton, selected && (isAll ? styles.filterButtonAllActive : { borderColor: color, backgroundColor: `${color}22` }), pressed && styles.pressed]}>
    {isAll ? <HueDot /> : <View style={[styles.filterDot, { backgroundColor: color }]} />}
    <Text style={[styles.filterLabel, selected && { color: SPACE_CADET.white }]}>{label}</Text>
  </Pressable>;
}

// TEST LIST for the daily training: every game that already has a daily version.
function DailyGrid({ categories, onSelect }) {
  const keys = Object.keys(DAILY_GAMES).filter((key) => !categories.length || categories.includes(DAILY_GAMES[key].competence));
  if (!keys.length) return <Text style={styles.emptyText}>No daily version in this category yet.</Text>;
  return <View style={styles.grid}>{keys.map((key) => {
    const exercise = EXERCISES.find((entry) => entry.key === key);
    const game = DAILY_GAMES[key];
    return <Pressable key={key} onPress={() => onSelect(key)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={[styles.badge, { backgroundColor: CATEGORY_COLORS[game.competence] }]}><Text style={styles.badgeText}>{exercise?.badge ?? "··"}</Text></View>
      <Text style={[styles.category, { color: CATEGORY_COLORS[game.competence] }]}>{getCategoryLabel(game.competence)}</Text>
      <Text style={styles.cardTitle}>{game.title}</Text>
      <Text style={styles.cardDescription}>{game.summary}</Text>
    </Pressable>;
  })}</View>;
}

// mode "clearance": Full Clearance (every game, free settings, Mission Mode). mode "daily": the daily training.
export function ExercisesScreen({ initialGameKey, onClose, mode = "clearance" }) {
  const daily = mode === "daily";
  const { height, width } = useWindowDimensions();
  const collapsedOffset = Math.round(height * 0.40);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedGame, setSelectedGame] = useState(initialGameKey ?? null);
  const sheetY = useSharedValue(height);
  const dragOrigin = useSharedValue(collapsedOffset);
  const gameX = useSharedValue(width);
  const Game = selectedGame ? (selectedGame.startsWith("daily:") ? DailyGameScreen : games[selectedGame]) : null;

  useEffect(() => {
    sheetY.value = withTiming(collapsedOffset, { duration: 360, easing: Easing.out(Easing.cubic) });
  }, [collapsedOffset, sheetY]);
  useEffect(() => {
    if (!selectedGame) return;
    gameX.value = width;
    gameX.value = withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) });
  }, [gameX, selectedGame, width]);

  const filteredExercises = useMemo(() => selectedCategories.length ? EXERCISES.filter((exercise) => selectedCategories.includes(exercise.category)) : EXERCISES, [selectedCategories]);

  function closeSheet() {
    sheetY.value = withTiming(height, { duration: 260, easing: Easing.in(Easing.cubic) }, (finished) => { if (finished) runOnJS(onClose)(); });
  }
  function closeGame() {
    gameX.value = withTiming(width, { duration: 260, easing: Easing.out(Easing.cubic) }, (finished) => { if (finished) runOnJS(setSelectedGame)(null); });
  }
  function toggleCategory(category) {
    setSelectedCategories((current) => current.includes(category) ? current.filter((entry) => entry !== category) : [...current, category]);
  }

  const pan = Gesture.Pan().enabled(!isExpanded).onBegin(() => { dragOrigin.value = sheetY.value; }).onUpdate((event) => { sheetY.value = clamp(dragOrigin.value + event.translationY, 0, height); }).onEnd((event) => {
    if (event.velocityY > 900 && sheetY.value > collapsedOffset * 0.88) {
      sheetY.value = withTiming(height, { duration: 250, easing: Easing.in(Easing.cubic) }, (finished) => { if (finished) runOnJS(onClose)(); });
      return;
    }
    const shouldExpand = event.velocityY < -500 || sheetY.value < collapsedOffset * 0.66;
    sheetY.value = withTiming(shouldExpand ? 0 : collapsedOffset, { duration: 300, easing: Easing.out(Easing.cubic) });
    runOnJS(setIsExpanded)(shouldExpand);
  });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: interpolate(sheetY.value, [0, collapsedOffset, height], [0.72, 0.48, 0]) }));
  const headerStyle = useAnimatedStyle(() => {
    const progress = 1 - clamp(sheetY.value / collapsedOffset, 0, 1);
    return { transform: [{ translateX: interpolate(progress, [0, 1], [0, Math.max(0, width / 2 - 70)]) }] };
  });
  const expandedContentStyle = useAnimatedStyle(() => ({ opacity: interpolate(sheetY.value, [0, collapsedOffset], [1, 0.72]), transform: [{ translateY: interpolate(sheetY.value, [0, collapsedOffset], [0, 8]) }] }));
  const handleStyle = useAnimatedStyle(() => ({ opacity: interpolate(sheetY.value, [0, collapsedOffset * 0.55, collapsedOffset], [0, 0, 1]) }));
  const fullBackStyle = useAnimatedStyle(() => ({ opacity: interpolate(sheetY.value, [0, collapsedOffset * 0.55, collapsedOffset], [1, 0, 0]) }));
  const gameStyle = useAnimatedStyle(() => ({ transform: [{ translateX: gameX.value }], opacity: interpolate(gameX.value, [0, width], [1, 0.96]) }));

  return <View style={styles.overlay}>
    <Animated.View pointerEvents="none" style={[styles.backdrop, backdropStyle]} />
    <Pressable onPress={() => { if (!isExpanded) closeSheet(); }} style={styles.outsideTap} />
    <Animated.View style={[styles.sheet, sheetStyle]}>
      <GestureDetector gesture={pan}><View style={styles.dragZone}><Animated.View style={[styles.handleWrap, handleStyle]}><View style={styles.sheetHandle} /></Animated.View><Animated.View style={[styles.header, headerStyle]}><Text style={styles.kicker}>{daily ? "DAILY TRAINING" : "FULL CLEARANCE"}</Text><Text style={styles.title}>{daily ? "Today" : "Exercises"}</Text></Animated.View><Animated.View pointerEvents={isExpanded ? "auto" : "none"} style={[styles.fullBackWrap, fullBackStyle]}><Pressable onPress={closeSheet} hitSlop={12} style={({ pressed }) => [styles.fullBackButton, pressed && styles.pressed]}><BackArrow /></Pressable></Animated.View></View></GestureDetector>
      <Animated.View style={[styles.expandedContent, expandedContentStyle]}>
        <Text style={styles.subtitle}>{daily ? "Test screen: the daily versions built so far." : "Choose a session and train at your own pace."}</Text>
        <View style={styles.filters}>
          <FilterButton label="All" isAll selected={!selectedCategories.length} onPress={() => setSelectedCategories([])} />
          {CATEGORY_KEYS.map((category) => <FilterButton key={category} label={getCategoryLabel(category)} color={CATEGORY_COLORS[category]} selected={selectedCategories.includes(category)} onPress={() => toggleCategory(category)} />)}
        </View>
        <ScrollView style={styles.exerciseScroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>{filteredExercises.length === 0 ? <Text style={styles.emptyText}>No exercises in this category yet.</Text> : null}{daily ? <DailyGrid categories={selectedCategories} onSelect={(key) => setSelectedGame(`daily:${key}`)} /> : <><Pressable onPress={() => setSelectedGame("mission-mode")} style={({ pressed }) => [styles.missionWrap, pressed && styles.pressed]}><LinearGradient colors={RAINBOW} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.missionBorder}><View style={styles.missionInner}><Text style={styles.missionKicker}>ALL SIX COMPETENCES</Text><Text style={styles.missionTitle}>Mission Mode</Text><Text style={styles.missionText}>Several systems at once. Fly a generated mission or compose your own.</Text></View></LinearGradient></Pressable><View style={styles.grid}>{filteredExercises.map((exercise) => <Pressable key={exercise.key} onPress={() => setSelectedGame(exercise.key)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}><View style={[styles.badge, { backgroundColor: CATEGORY_COLORS[exercise.category] }]}><Text style={styles.badgeText}>{exercise.badge}</Text></View><Text style={[styles.category, { color: CATEGORY_COLORS[exercise.category] }]}>{getCategoryLabel(exercise.category)}</Text><Text style={styles.cardTitle}>{exercise.title}</Text><Text style={styles.cardDescription}>{exercise.description}</Text></Pressable>)}</View></>}</ScrollView>
      </Animated.View>
    </Animated.View>
    {Game ? <Animated.View style={[styles.gameOverlay, gameStyle]}><Game onExit={closeGame} gameKey={selectedGame.startsWith("daily:") ? selectedGame.slice(6) : undefined} /></Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, bottom: -34, zIndex: 20 }, backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "#000" }, outsideTap: { ...StyleSheet.absoluteFill },
  sheet: { ...StyleSheet.absoluteFill, backgroundColor: SPACE_CADET.black, borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: "hidden" },
  dragZone: { paddingTop: 10, paddingHorizontal: 20, paddingBottom: 13 }, handleWrap: { height: 22, alignItems: "center" }, sheetHandle: { width: 38, height: 4, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.54)", marginTop: 1 }, header: { alignSelf: "flex-start" }, kicker: { alignSelf: "center", color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 10, letterSpacing: 2.1 }, title: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 30, marginTop: 3 }, fullBackWrap: { position: "absolute", left: 12, top: 26 }, fullBackButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  expandedContent: { flex: 1 }, subtitle: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 20, paddingHorizontal: 20, marginTop: 2, marginBottom: 16 }, filters: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, paddingHorizontal: 8, marginBottom: 18 }, filterButton: { minHeight: 36, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.018)" }, filterButtonAllActive: { borderColor: SPACE_CADET.white, backgroundColor: "rgba(255,255,255,0.07)" }, filterDot: { width: 8, height: 8, borderRadius: 4 }, filterLabel: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 11 },
  exerciseScroll: { flex: 1 }, emptyText: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 13, textAlign: "center", marginTop: 48 }, content: { paddingHorizontal: 20, paddingBottom: 4 }, grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, card: { width: "48.3%", minHeight: 174, padding: 15, borderRadius: 18, backgroundColor: SPACE_CADET.surface2, borderWidth: 1, borderColor: SPACE_CADET.borderSubtle }, badge: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", marginBottom: 11 }, badgeText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-SemiBold", fontSize: 10 }, category: { fontFamily: "Gontserrat-Regular", fontSize: 9, letterSpacing: 1.1, textTransform: "uppercase", marginBottom: 5 }, cardTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15, lineHeight: 19 }, cardDescription: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 11, lineHeight: 15, marginTop: 6 }, pressed: { transform: [{ scale: 0.97 }] },
  missionWrap: { marginBottom: 12 }, missionBorder: { borderRadius: 18, padding: 1.5 }, missionInner: { borderRadius: 16.5, backgroundColor: SPACE_CADET.black, paddingVertical: 16, paddingHorizontal: 16 }, missionKicker: { color: SPACE_CADET.white, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.8 }, missionTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 22, marginTop: 4 }, missionText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 12, lineHeight: 17, marginTop: 5 },
  gameOverlay: { ...StyleSheet.absoluteFill, zIndex: 40, backgroundColor: SPACE_CADET.black },
});
