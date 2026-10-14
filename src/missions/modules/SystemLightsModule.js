import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { createRandom, randomTools } from "../../utils/random";
import { BlockKicker, ModuleBlock, tint, useFeedbackFlash } from "../kit";

const RESPONSE_WINDOW_MS = 6000;
const AUTO_RESET_MS = 8000;
const FALSE_ALARM_COST = 0.08;
const NORMALLY_ON = [true, true, false, false];

// Faults are scheduled from the seed: when they happen and which light fails.
function buildFaults(seed, durationMs) {
  const rnd = randomTools(createRandom(seed));
  const faults = [];
  for (let at = rnd.int(5000, 8000); at < durationMs - 4000; at += rnd.int(6000, 12000)) faults.push({ at, light: rnd.int(0, 3) });
  return faults;
}

export function SystemLightsModule({ rects, runtime, color }) {
  const faults = useMemo(() => buildFaults(runtime.seed, runtime.durationMs), [runtime.seed, runtime.durationMs]);
  const [abnormal, setAbnormal] = useState([null, null, null, null]);
  const abnormalRef = useRef(abnormal);
  const outcomes = useRef([]);
  const falseAlarms = useRef(0);
  const nextFault = useRef(0);
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";
  const litStyle = { backgroundColor: tint(color, 0.22), borderColor: color, shadowColor: color, shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 6 };

  function update(next) { abnormalRef.current = next; setAbnormal(next); }

  useEffect(() => runtime.register(() => {
    const scores = outcomes.current.map((outcome) => (outcome.hit ? 1 - 0.6 * (outcome.reactionMs / RESPONSE_WINDOW_MS) : 0));
    const caught = outcomes.current.filter((outcome) => outcome.hit);
    const mean = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 1;
    const average = caught.length ? caught.reduce((sum, outcome) => sum + outcome.reactionMs, 0) / caught.length / 1000 : null;
    return {
      performance: Math.max(0, Math.min(1, mean - FALSE_ALARM_COST * falseAlarms.current)),
      detail: `${caught.length}/${outcomes.current.length} faults caught${average !== null ? ` · ${average.toFixed(1)} s avg` : ""}${falseAlarms.current ? ` · ${falseAlarms.current} false` : ""}`,
    };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => {
      const now = runtime.elapsed();
      let state = abnormalRef.current;
      // Unanswered faults count as missed after the window and clear themselves a little later.
      state.forEach((fault, light) => {
        if (!fault) return;
        if (!fault.scored && now - fault.at > RESPONSE_WINDOW_MS) { fault.scored = true; outcomes.current.push({ hit: false }); }
        if (now - fault.at > AUTO_RESET_MS) state = state.map((entry, index) => (index === light ? null : entry));
      });
      while (nextFault.current < faults.length && faults[nextFault.current].at <= now) {
        const fault = faults[nextFault.current];
        const free = [0, 1, 2, 3].filter((light) => !state[light]);
        if (free.length) {
          const light = free.includes(fault.light) ? fault.light : free[fault.light % free.length];
          state = state.map((entry, index) => (index === light ? { at: now, scored: false } : entry));
        }
        nextFault.current += 1;
      }
      if (state !== abnormalRef.current) update(state);
    }, 100);
    return () => clearInterval(timer);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  function tap(light) {
    if (!running) return;
    const fault = abnormalRef.current[light];
    if (!fault) {
      falseAlarms.current += 1;
      feedback.flash(false);
      void triggerErrorHaptic();
      return;
    }
    if (!fault.scored) outcomes.current.push({ hit: true, reactionMs: runtime.elapsed() - fault.at });
    update(abnormalRef.current.map((entry, index) => (index === light ? null : entry)));
    feedback.flash(true);
    void triggerSuccessHaptic();
  }

  return <ModuleBlock rect={rects.panel} color={color} flash={feedback.style}>
    <BlockKicker color={color} style={styles.kicker}>SYSTEMS</BlockKicker>
    <View style={styles.grid}>
      {[0, 1].map((row) => <View key={row} style={styles.row}>
        {[0, 1].map((column) => {
          const light = row * 2 + column;
          const on = NORMALLY_ON[light] !== Boolean(abnormal[light]);
          return <Pressable key={light} disabled={!running} onPress={() => tap(light)} style={({ pressed }) => [styles.light, on && litStyle, pressed && styles.pressed]} />;
        })}
      </View>)}
    </View>
  </ModuleBlock>;
}

export const systemLightsModule = {
  id: "system-lights",
  title: "System lights",
  competence: "attention",
  secondary: [],
  task: "event",
  voice: false,
  load: 2,
  rule: "The top lights must stay on and the bottom lights must stay off. As soon as one changes, tap it to reset it. Tapping a normal light counts as an error.",
  recap: "watch the system lights",
  blocks: [{ key: "panel", role: "display", h: 2, w: 2 }],
  Component: SystemLightsModule,
};

const styles = StyleSheet.create({
  kicker: { position: "absolute", top: 12, left: 14 },
  grid: { flex: 1, paddingHorizontal: 14, paddingTop: 34, paddingBottom: 14, gap: 10 },
  row: { flex: 1, flexDirection: "row", gap: 10 },
  light: { flex: 1, borderRadius: 14, borderWidth: 1, borderColor: SPACE_CADET.borderSubtle, backgroundColor: SPACE_CADET.black },
  pressed: { transform: [{ scale: 0.95 }] },
});
