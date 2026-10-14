import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import { CARD_GLOWS, GlowCard } from "../components/GlowCard";
import { CATEGORY_COLORS, SPACE_CADET } from "../theme/spaceCadet";

const CARD_WIDTH = 320;
const CARD_GAP = 16;
const CARD_INTERVAL = CARD_WIDTH + CARD_GAP;
const REPLAY_MS = 5000;
const GIF_LOAD_TIMEOUT_MS = 6000;
const EMOJI_SIZE = 68;
const EMOJI_LEFT = 26;
const EMOJI_BOTTOM = 24 + EMOJI_SIZE; // original top(24) + size, kept fixed so bigger emojis grow upward, away from the title

const trainingCards = [
  {
    title: "Daily Training", subtitle: "Complete today's set of all 6 competencies", glow: CARD_GLOWS.training,
    gif: require("../assets/gifs/Brain.gif"), still: require("../assets/gifs/Brain.png"), loopMs: 1120, loops: 2, training: true,
  },
  {
    title: "Daily Missions", subtitle: "Test your skills under real conditions", glow: CARD_GLOWS.missions,
    gif: require("../assets/gifs/Rocket.gif"), still: require("../assets/gifs/Rocket.png"), loopMs: 2920, loops: 1, missions: true,
  },
  {
    title: "Full Clearance", subtitle: "Unlimited, customisable training", glow: CARD_GLOWS.clearance,
    gif: require("../assets/gifs/Astronaut.gif"), still: require("../assets/gifs/Astronaut.png"), loopMs: 2880, loops: 1, clearance: true,
  },
];

// Placeholder values until real scores and statistics exist. The week is built from the streak, so the two always
// tell the same story: the last `streakDays` days (today included) were played, the day before them was not.
const CADET_SCORE = "178,214";
const TODAY_ORDER = ["spatial", "attention", "memory", "mentalMath", "logic", "multitasking"];
const PLACEHOLDER = { doneToday: ["spatial", "attention", "memory"], streakDays: 4, rankingTop: 18, dayPoints: [2140, 3120, 1980, 2760, 1840, 2450, 2210] };
const WEEK_DAYS = ["M", "T", "W", "T", "F", "S", "S"];
const BAR_MAX_HEIGHT = 84;

function placeholderWeek() {
  const today = (new Date().getDay() + 6) % 7;
  const streakStart = today - PLACEHOLDER.streakDays + 1;
  return WEEK_DAYS.map((label, index) => {
    const played = index <= today && index !== streakStart - 1;
    return { label, today: index === today, future: index > today, points: played ? PLACEHOLDER.dayPoints[index] : 0 };
  });
}

// One line: what is done today (one dot per competence), the current streak, the ranking.
function TodayStrip() {
  return <View style={styles.strip}>
    <View style={styles.stripCell}>
      <Text style={styles.stripLabel}>TODAY</Text>
      <View style={styles.dots}>{TODAY_ORDER.map((key) => {
        const done = PLACEHOLDER.doneToday.includes(key);
        return <View key={key} style={[styles.dot, { borderColor: CATEGORY_COLORS[key] }, done ? { backgroundColor: CATEGORY_COLORS[key], shadowColor: CATEGORY_COLORS[key], shadowOpacity: 0.65, shadowRadius: 6 } : styles.dotPending]} />;
      })}</View>
    </View>
    <View style={styles.stripDivider} />
    <View style={styles.stripCell}>
      <Text style={styles.stripLabel}>STREAK</Text>
      <Text style={styles.stripValue}>{PLACEHOLDER.streakDays} days</Text>
    </View>
    <View style={styles.stripDivider} />
    <View style={styles.stripCell}>
      <Text style={styles.stripLabel}>RANKING</Text>
      <Text style={styles.stripValue}>Top {PLACEHOLDER.rankingTop}%</Text>
    </View>
  </View>;
}

// The week so far: one bar per day, as tall as the points earned; a small dash for a day without training.
function WeekChart() {
  const week = placeholderWeek();
  const best = Math.max(...week.map((day) => day.points), 1);
  const total = week.reduce((sum, day) => sum + day.points, 0);
  return <View style={styles.week}>
    <View style={styles.weekTop}>
      <Text style={styles.stripLabel}>THIS WEEK</Text>
      <Text style={styles.weekTotal}>{total.toLocaleString("en-US")} <Text style={styles.weekUnit}>points</Text></Text>
    </View>
    <View style={styles.bars}>
      {week.map((day, index) => <View key={index} style={styles.barColumn}>
        <View style={styles.barTrack}>
          {day.points
            ? <View style={[styles.bar, { height: Math.max(10, (day.points / best) * BAR_MAX_HEIGHT) }, day.today && styles.barToday]} />
            : <View style={[styles.barEmpty, day.future && styles.barFuture]} />}
        </View>
        <Text style={[styles.barLabel, day.today && styles.barLabelToday]}>{day.label}</Text>
      </View>)}
    </View>
  </View>;
}

// The still (first frame) is always mounted. While the card is the centred one, the animated version is mounted
// on top and plays `loops` times, then again every REPLAY_MS (remounting is what restarts a GIF from its first
// frame). The still is hidden only while the GIF is actually on screen; if it never loads we give up quietly.
function CardEmoji({ card, active }) {
  const [run, setRun] = useState(0);
  const [gifLoaded, setGifLoaded] = useState(false);
  const size = card.emojiSize ?? EMOJI_SIZE;
  // Bigger emojis keep their bottom-left corner anchored (not their top-left), so growing `size` extends
  // upward/rightward into the card's empty space instead of drifting down into the title text.
  const imageStyle = { position: "absolute", width: size, height: size, top: EMOJI_BOTTOM - size, left: EMOJI_LEFT };

  useEffect(() => {
    setGifLoaded(false);
    if (!active) { setRun(0); return undefined; }
    let count = 1;
    setRun(count);
    const replay = setInterval(() => { count += 1; setGifLoaded(false); setRun(count); }, REPLAY_MS);
    return () => clearInterval(replay);
  }, [active]);

  useEffect(() => {
    if (!run) return undefined;
    const timer = setTimeout(() => { setRun(0); setGifLoaded(false); }, gifLoaded ? card.loopMs * card.loops : GIF_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [run, gifLoaded, card.loopMs, card.loops]);

  return <View style={styles.trainingEmoji}>
    <Image source={card.still} style={[imageStyle, run > 0 && gifLoaded && styles.emojiHidden]} />
    {run > 0 ? <Image key={run} source={card.gif} onLoad={() => setGifLoaded(true)} style={imageStyle} /> : null}
  </View>;
}

function TrainingCard({ card, onPress, index, scrollX, active }) {
  const position = index * CARD_INTERVAL;
  const frameStyle = useAnimatedStyle(() => {
    const range = [position - CARD_INTERVAL, position, position + CARD_INTERVAL];
    return { transform: [{ scale: interpolate(scrollX.value, range, [0.94, 1, 0.94], Extrapolation.CLAMP) }] };
  });
  return <Animated.View style={[styles.trainingCardFrame, frameStyle]}>
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.trainingPressable, pressed && styles.pressed]}>
      <GlowCard width={CARD_WIDTH} glow={card.glow} animate={active} style={styles.trainingCard}>
        <CardEmoji card={card} active={active} />
        <View style={styles.trainingText}>
          <Text style={styles.trainingTitle}>{card.title}</Text>
          <Text style={styles.trainingSubtitle}>{card.subtitle}</Text>
        </View>
      </GlowCard>
    </Pressable>
  </Animated.View>;
}

export function HomeScreen({ onOpenTraining, onOpenClearance, onOpenMissions }) {
  const trainingScrollX = useSharedValue(0);
  const [activeCard, setActiveCard] = useState(0);
  const onTrainingScroll = useAnimatedScrollHandler({
    onScroll: (event) => { trainingScrollX.value = event.contentOffset.x; },
  });
  // The centred card changes as soon as the scroll passes the halfway point, not once the scroll has settled.
  useAnimatedReaction(() => Math.max(0, Math.min(trainingCards.length - 1, Math.round(trainingScrollX.value / CARD_INTERVAL))), (index, previous) => { if (index !== previous) runOnJS(setActiveCard)(index); });
  // Warm the image cache so the animated icons start without a loading gap (matters mostly in development,
  // where assets come from the dev server).
  useEffect(() => { trainingCards.forEach((card) => { const uri = Image.resolveAssetSource?.(card.gif)?.uri; if (uri) void Image.prefetch(uri).catch(() => {}); }); }, []);

  return <View style={styles.container}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.scoreLabel}>CADET SCORE</Text>
      <Text numberOfLines={1} style={styles.score}>{CADET_SCORE}</Text>

      <Animated.ScrollView horizontal showsHorizontalScrollIndicator={false} directionalLockEnabled decelerationRate="fast" disableIntervalMomentum snapToInterval={CARD_INTERVAL} snapToAlignment="start" style={styles.trainingScroll} contentContainerStyle={styles.trainingRow} scrollEventThrottle={16} onScroll={onTrainingScroll}>
        {trainingCards.map((card, index) => <TrainingCard key={card.title} card={card} index={index} scrollX={trainingScrollX} active={index === activeCard} onPress={card.training ? onOpenTraining : card.clearance ? onOpenClearance : card.missions ? onOpenMissions : undefined} />)}
      </Animated.ScrollView>

      <TodayStrip />
      <WeekChart />
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SPACE_CADET.black },
  content: { paddingTop: 50, paddingBottom: 160 },
  scoreLabel: { paddingHorizontal: 26, color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 12, letterSpacing: 2.1, marginBottom: 0 },
  // lineHeight is Nunito's natural line box (ascent 1.011em + descent 0.353em) so iOS never clips the digits.
  score: { paddingHorizontal: 24, color: SPACE_CADET.white, fontFamily: "Nunito-ExtraLight", fontSize: 80, lineHeight: 108, letterSpacing: -2 },
  trainingScroll: { marginTop: 36 },
  trainingRow: { paddingLeft: 20, paddingRight: 20 },
  trainingCardFrame: { width: CARD_WIDTH, marginRight: CARD_GAP },
  trainingPressable: {},
  trainingCard: {},
  trainingEmoji: { ...StyleSheet.absoluteFill },
  emojiHidden: { opacity: 0 },
  trainingText: { position: "absolute", left: 28, right: 28, bottom: 26 },
  trainingTitle: { color: SPACE_CADET.white, fontFamily: "Nunito-Light", fontSize: 30 },
  trainingSubtitle: { color: "rgba(255,255,255,0.62)", fontFamily: "Nunito-Light", fontSize: 16, marginTop: 4 },
  strip: { flexDirection: "row", alignItems: "stretch", paddingHorizontal: 24, marginTop: 44 },
  stripCell: { flex: 1 },
  stripDivider: { width: StyleSheet.hairlineWidth, backgroundColor: SPACE_CADET.borderDefault, marginHorizontal: 16 },
  stripLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 10, letterSpacing: 1.8 },
  stripValue: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 19, marginTop: 9 },
  dots: { flexDirection: "row", gap: 6, marginTop: 15, marginBottom: 5 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0 },
  dotPending: { opacity: 0.45 },
  week: { paddingHorizontal: 24, marginTop: 40 },
  weekTop: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  weekTotal: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 15 },
  weekUnit: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13 },
  bars: { flexDirection: "row", justifyContent: "space-between", marginTop: 22 },
  barColumn: { flex: 1, alignItems: "center" },
  barTrack: { height: BAR_MAX_HEIGHT, justifyContent: "flex-end", alignItems: "center" },
  bar: { width: 7, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.34)" },
  barToday: { backgroundColor: SPACE_CADET.white, shadowColor: SPACE_CADET.white, shadowOpacity: 0.7, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  barEmpty: { width: 9, height: 2, borderRadius: 1, backgroundColor: "rgba(255,255,255,0.3)" },
  barFuture: { backgroundColor: "rgba(255,255,255,0.12)" },
  barLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 10, letterSpacing: 1, marginTop: 12 },
  barLabelToday: { color: SPACE_CADET.white, fontFamily: "Gontserrat-SemiBold" },
  pressed: { transform: [{ scale: 0.97 }] },
});
