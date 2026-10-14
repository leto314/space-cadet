import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { GameSetupShell, PickerSetting } from "../components/GameSetupShell";
import { sessionRecord } from "../stats/records";
import { applyDailyGame, competenceStates, saveSession, sessionsOf } from "../stats/storage";
import { CATEGORY_COLORS, SPACE_CADET } from "../theme/spaceCadet";
import { useTrustedDay } from "../utils/useTrustedDay";
import { DAILY_GAMES, dailyGameSeed, LEVELS } from "./registry";

const HISTORY_LENGTH = 14;

// TEST SCREEN for the daily training: a daily game's preflight (past daily results, level choice), the game on
// today's seed, then what it did to the competence score. Every play is recorded; only the first one of the day
// counts toward the radar and the cadet score.
export function DailyGameScreen({ gameKey, onExit }) {
  const game = DAILY_GAMES[gameKey];
  const accent = CATEGORY_COLORS[game.competence];
  const { day, clockState, retry } = useTrustedDay();
  // Games without levels set their own progression; they count like the standard level.
  const [level, setLevel] = useState("standard");
  const [phase, setPhase] = useState("setup");
  const [history, setHistory] = useState([]);
  const [competence, setCompetence] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [startedAt, setStartedAt] = useState(0);

  async function refresh() {
    setHistory((await sessionsOf(gameKey, "daily")).slice(-HISTORY_LENGTH).map((session) => session.score));
    setCompetence((await competenceStates())[game.competence]);
  }
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function start() { setStartedAt(Date.now()); setOutcome(null); setPhase("playing"); }

  async function finish({ score, metrics, trials }) {
    const before = competence;
    const record = sessionRecord({ source: "daily", dayKey: day.key, gameKey, competence: game.competence, tier: level, seed: dailyGameSeed(gameKey, day.key, level), settings: { level }, startedAt, endedAt: Date.now(), score, metrics, trials });
    await saveSession(record);
    const point = await applyDailyGame({ dayKey: day.key, competence: game.competence, score, tier: level });
    setOutcome({ score, metrics, counted: Boolean(point), before: before?.score ?? null, after: point ? point.score : before?.score ?? null });
    setPhase("summary");
    void refresh();
  }

  if (!day) return <View style={styles.center}>
    {clockState === "syncing" ? <ActivityIndicator color={SPACE_CADET.textSecondary} /> : <>
      <Text style={styles.stateText}>The daily training is the same for every cadet. Connect to the internet to receive today's.</Text>
      <TouchableOpacity activeOpacity={0.88} onPress={retry} style={styles.secondaryButton}><Text style={styles.secondaryText}>Try again</Text></TouchableOpacity>
      <TouchableOpacity activeOpacity={0.88} onPress={onExit} style={styles.secondaryButton}><Text style={styles.secondaryText}>Back</Text></TouchableOpacity>
    </>}
  </View>;

  if (phase === "playing") return <game.Component key={startedAt} level={level} seed={dailyGameSeed(gameKey, day.key, level)} onFinish={finish} onExit={() => setPhase("setup")} />;

  if (phase === "summary" && outcome) {
    const change = outcome.counted && outcome.before !== null ? Math.round(outcome.after - outcome.before) : null;
    return <Animated.View entering={FadeIn.duration(200)} style={styles.summary}>
      <Text style={[styles.kicker, { color: accent }]}>DAILY TRAINING{game.levels ? ` · ${level.toUpperCase()}` : ""}</Text>
      <Text style={styles.summaryTitle}>{game.title}</Text>
      <Text style={[styles.score, { color: accent }]}>{outcome.score}<Text style={styles.scoreTotal}> / 1000</Text></Text>
      <View style={styles.card}>
        <Text style={styles.cardLabel}>COMPETENCE</Text>
        {outcome.counted
          ? <Text style={styles.cardLine}>{outcome.before === null ? <>First result: <Text style={styles.cardStrong}>{Math.round(outcome.after)}</Text></> : <>Score <Text style={styles.cardStrong}>{Math.round(outcome.before)} → {Math.round(outcome.after)}</Text>  ({change >= 0 ? "+" : ""}{change})</>}</Text>
          : <Text style={styles.cardLine}>Already counted today: this play is recorded, but only the first one of the day moves the score.</Text>}
        {Object.entries(outcome.metrics).map(([key, value]) => <Text key={key} style={styles.metric}>{key} <Text style={styles.cardStrong}>{String(value)}</Text></Text>)}
      </View>
      <View style={styles.actions}>
        <TouchableOpacity activeOpacity={0.88} onPress={() => setPhase("setup")} style={styles.primaryButton}><Text style={styles.primaryText}>Done</Text></TouchableOpacity>
      </View>
    </Animated.View>;
  }

  return <GameSetupShell title={game.title} categoryKey={game.competence} onExit={onExit} onStart={start} rules={game.rules} history={history} historyCaption={history.length ? `Last ${history.length} daily results${competence?.score != null ? ` · competence ${Math.round(competence.score)}` : ""}` : "Your daily results will appear here."} settingsLabel={`TODAY · ${day.key}${clockState === "unverified" ? " · DEVICE CLOCK" : ""}`} startLabel="Start daily game">
    {game.levels
      ? <PickerSetting label="Level" hint={game.levels[level]} options={LEVELS.map((entry) => ({ value: entry.key, label: entry.label }))} value={level} onChange={setLevel} />
      : <View><Text style={styles.fixedLabel}>Progression</Text><Text style={styles.fixedText}>{game.progression}</Text></View>}
  </GameSetupShell>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 14, backgroundColor: SPACE_CADET.black },
  fixedLabel: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 16 }, fixedText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13, lineHeight: 19, marginTop: 10 },
  stateText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 21, textAlign: "center" },
  summary: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 70, paddingBottom: 48, backgroundColor: SPACE_CADET.black },
  kicker: { fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.9 },
  summaryTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 31, marginTop: 8 },
  score: { fontFamily: "Garet-Book", fontSize: 76, lineHeight: 90, marginTop: 18 }, scoreTotal: { color: SPACE_CADET.textTertiary, fontSize: 28 },
  card: { width: "100%", backgroundColor: SPACE_CADET.surface1, borderRadius: 22, padding: 18, gap: 9, marginTop: 28 },
  cardLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6, marginBottom: 2 },
  cardLine: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13, lineHeight: 19 },
  cardStrong: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 15 },
  metric: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 12 },
  actions: { width: "100%", marginTop: "auto" },
  primaryButton: { minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.white }, primaryText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 16 },
  secondaryButton: { minHeight: 48, alignSelf: "stretch", borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" }, secondaryText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 },
});
