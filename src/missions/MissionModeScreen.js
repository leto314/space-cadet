import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { PickerSetting, PressScaleButton } from "../components/GameSetupShell";
import { CATEGORY_COLORS, CATEGORY_CONFIG, getCategoryLabel, SPACE_CADET } from "../theme/spaceCadet";
import { triggerSelectionHaptic } from "../utils/haptics";
import { randomSeed } from "../utils/random";
import { archiveMission, briefingOrder, competenceShares, missionProblem } from "./generator";
import { MissionScreen } from "./MissionScreen";
import { MODULES, TASK_LABELS } from "./modules";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MINUTES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const RAINBOW = Object.keys(CATEGORY_CONFIG).map((key) => CATEGORY_COLORS[key]);
const half = (cells) => (cells === 1 ? "½" : String(cells / 2));
const sameSet = (a, b) => a.length === b.length && a.every((id) => b.includes(id));

// A thin line split between the competences a mission trains, each segment as wide as its share.
export function CompetenceLine({ moduleIds, legend = true }) {
  const shares = competenceShares(moduleIds);
  return <View>
    <View style={styles.line}>{shares.map(({ competence, share }) => <View key={competence} style={{ flex: share, backgroundColor: CATEGORY_COLORS[competence] }} />)}</View>
    {legend ? <View style={styles.legend}>{shares.map(({ competence, share }) => <View key={competence} style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: CATEGORY_COLORS[competence] }]} />
      <Text style={styles.legendText}>{getCategoryLabel(competence)} {Math.round(share * 100)}%</Text>
    </View>)}</View> : null}
  </View>;
}

// Full Clearance → Mission Mode: fly an archive mission (generated like a daily one, from a past date) or compose
// one by hand from every module.
export function MissionModeScreen({ onExit }) {
  const [minutes, setMinutes] = useState(3);
  const [progressive, setProgressive] = useState(true);
  const [selection, setSelection] = useState([]);
  const [generated, setGenerated] = useState(null);
  const [flight, setFlight] = useState(null);
  const problem = missionProblem(selection);
  const isGenerated = generated && sameSet(generated.moduleIds, selection);
  const groups = useMemo(() => Object.keys(CATEGORY_CONFIG).map((competence) => ({ competence, modules: Object.values(MODULES).filter((module) => module.competence === competence) })), []);

  function generate() {
    void triggerSelectionHaptic();
    const mission = archiveMission(randomSeed());
    setGenerated(mission);
    setSelection(mission.moduleIds);
  }
  function toggle(id) {
    void triggerSelectionHaptic();
    setSelection((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  }
  function start() {
    if (problem) return;
    void triggerSelectionHaptic();
    setFlight({
      key: Date.now(),
      moduleIds: briefingOrder(selection),
      durationMs: minutes * 60000,
      seed: isGenerated ? generated.seed : randomSeed(),
      kicker: "MISSION MODE",
      progressive,
      source: "mode",
      label: isGenerated ? `${MONTHS[generated.day.month]} ${generated.day.day}, ${generated.day.year}` : "CUSTOM",
    });
  }

  return <View style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable onPress={onExit} style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable>
        <View style={styles.titleWrap}>
          <Text style={styles.kicker}>FULL CLEARANCE</Text>
          <Text style={styles.title}>Mission Mode</Text>
        </View>
        <View style={styles.headerButton} />
      </View>
      <Text style={styles.intro}>Several systems at once, like a daily mission. Fly a mission from the archive, or compose your own below.</Text>

      <PickerSetting label="Duration" hint="Minutes of flight" options={MINUTES.map((value) => ({ value, label: String(value) }))} value={minutes} onChange={setMinutes} />

      <View style={styles.setting}><PickerSetting label="Systems" hint={progressive ? "They come in one at a time during the first part of the flight" : "Everything is live from the first second"} options={[{ value: true, label: "ONE BY ONE" }, { value: false, label: "ALL AT ONCE" }]} value={progressive} onChange={setProgressive} /></View>

      <View style={styles.generateWrap}><PressScaleButton variant="secondary" onPress={generate}>{generated ? "Generate another mission" : "Generate mission"}</PressScaleButton></View>

      {selection.length ? <Animated.View key={isGenerated ? generated.seed : "custom"} entering={FadeIn.duration(260)} style={styles.summary}>
        <View style={styles.summaryTop}>
          <Text style={styles.summaryLabel}>{isGenerated ? `ARCHIVE MISSION · ${MONTHS[generated.day.month]} ${generated.day.day}, ${generated.day.year}` : "CUSTOM MISSION"}</Text>
          <Text style={styles.summaryLabel}>{selection.length} {selection.length === 1 ? "SYSTEM" : "SYSTEMS"}</Text>
        </View>
        <CompetenceLine moduleIds={selection} />
      </Animated.View> : null}

      <Text style={styles.sectionKicker}>MODULES</Text>
      {groups.map(({ competence, modules }) => <View key={competence} style={styles.group}>
        <View style={styles.groupHeader}><View style={[styles.legendDot, { backgroundColor: CATEGORY_COLORS[competence] }]} /><Text style={[styles.groupTitle, { color: CATEGORY_COLORS[competence] }]}>{getCategoryLabel(competence).toUpperCase()}</Text></View>
        {modules.map((module) => {
          const selected = selection.includes(module.id);
          const color = CATEGORY_COLORS[competence];
          return <Pressable key={module.id} onPress={() => toggle(module.id)} style={[styles.row, selected && { borderColor: color, backgroundColor: SPACE_CADET.surface1 }]}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{module.title}{module.voice ? <Text style={styles.voice}>  · VOICE</Text> : null}</Text>
              <Text style={styles.rowMeta}>{TASK_LABELS[module.task].toLowerCase()} · {module.blocks.map((block) => `${half(block.h)}×${half(block.w)}`).join(" + ")}</Text>
            </View>
            <View style={[styles.check, selected && { backgroundColor: color, borderColor: color }]} />
          </Pressable>;
        })}
      </View>)}
    </ScrollView>

    <View style={styles.footer}>
      {selection.length && problem ? <Text style={styles.problem}>{problem}</Text> : null}
      <View style={problem ? styles.disabled : null} pointerEvents={problem ? "none" : "auto"}><PressScaleButton onPress={start}>{selection.length ? `Start mission · ${minutes} min` : "Generate or pick modules"}</PressScaleButton></View>
    </View>

    {/* The Full Clearance overlay extends 34 px below the screen; the mission board must stop above that. */}
    {flight ? <View style={styles.flight}><MissionScreen key={flight.key} mission={flight} onClose={() => setFlight(null)} /></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SPACE_CADET.black }, content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 150 },
  header: { minHeight: 60, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }, headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, backArrow: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 }, pressed: { transform: [{ scale: 0.97 }] },
  titleWrap: { flex: 1, alignItems: "center" }, kicker: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.8, marginBottom: 3 }, setting: { marginTop: 28 }, title: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 29, lineHeight: 35 },
  intro: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13, lineHeight: 19, textAlign: "center", marginBottom: 26, paddingHorizontal: 10 },
  generateWrap: { marginTop: 28 },
  summary: { marginTop: 22 }, summaryTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }, summaryLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.4 },
  line: { height: 3, borderRadius: 2, flexDirection: "row", overflow: "hidden", gap: 2 },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 6, marginTop: 10 }, legendItem: { flexDirection: "row", alignItems: "center", gap: 6 }, legendDot: { width: 7, height: 7, borderRadius: 4 }, legendText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 11 },
  sectionKicker: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 10, letterSpacing: 1.8, marginTop: 34, marginBottom: 4 },
  group: { marginTop: 16 }, groupHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }, groupTitle: { fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: SPACE_CADET.borderSubtle, marginBottom: 8 }, rowText: { flex: 1 }, rowTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 }, voice: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.2 }, rowMeta: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-Regular", fontSize: 11, marginTop: 4 },
  check: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: SPACE_CADET.borderDefault },
  footer: { position: "absolute", right: 0, bottom: 0, left: 0, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 34, backgroundColor: SPACE_CADET.black, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,0.06)" },
  flight: { position: "absolute", top: 0, right: 0, left: 0, bottom: 34, backgroundColor: SPACE_CADET.black },
  problem: { color: SPACE_CADET.attention, fontFamily: "Gontserrat-Regular", fontSize: 12, textAlign: "center", marginBottom: 10 }, disabled: { opacity: 0.35 },
});
