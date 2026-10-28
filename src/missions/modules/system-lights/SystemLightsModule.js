import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { SPACE_CADET } from "../../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSuccessHaptic } from "../../../utils/haptics";
import { BlockKicker, ModuleBlock, tint, useFeedbackFlash } from "../../kit";
import { AUTO_RESET_MS, buildContent, emptyStats, moduleResult, NORMALLY_ON, RESPONSE_WINDOW_MS, systemLightsSpec } from "./logic";

export function SystemLightsModule({ rects, runtime, color }) {
  const context = { durationMs: runtime.durationMs };
  const faults = useMemo(() => buildContent(systemLightsSpec, runtime.seed, context), [runtime.seed, runtime.durationMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [abnormal, setAbnormal] = useState([null, null, null, null]);
  const abnormalRef = useRef(abnormal);
  const stats = useRef(emptyStats(systemLightsSpec));
  const nextFault = useRef(0);
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";
  const litStyle = { backgroundColor: tint(color, 0.22), borderColor: color, shadowColor: color, shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 6 };

  function update(next) { abnormalRef.current = next; setAbnormal(next); }

  useEffect(() => runtime.register(() => moduleResult(systemLightsSpec, stats.current, context)), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => {
      const now = runtime.elapsed();
      let state = abnormalRef.current;
      // Unanswered faults count as missed after the window and clear themselves a little later.
      state.forEach((fault, light) => {
        if (!fault) return;
        if (!fault.scored && now - fault.at > RESPONSE_WINDOW_MS) { fault.scored = true; stats.current.outcomes.push({ hit: false }); }
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
      stats.current.falseAlarms += 1;
      feedback.flash(false);
      void triggerErrorHaptic();
      return;
    }
    if (!fault.scored) stats.current.outcomes.push({ hit: true, reactionMs: runtime.elapsed() - fault.at });
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

export const systemLightsModule = { ...systemLightsSpec, Component: SystemLightsModule };

const styles = StyleSheet.create({
  kicker: { position: "absolute", top: 12, left: 14 },
  grid: { flex: 1, paddingHorizontal: 14, paddingTop: 34, paddingBottom: 14, gap: 10 },
  row: { flex: 1, flexDirection: "row", gap: 10 },
  light: { flex: 1, borderRadius: 14, borderWidth: 1, borderColor: SPACE_CADET.borderSubtle, backgroundColor: SPACE_CADET.black },
  pressed: { transform: [{ scale: 0.95 }] },
});
