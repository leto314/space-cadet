import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { SPACE_CADET } from "../../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../../utils/haptics";
import { BlockKicker, ModuleBlock, SUCCESS, useFeedbackFlash } from "../../kit";
import { buildContent, emptyStats, moduleResult, OPERATION_MS, RESULT_MS, runningTotalSpec } from "./logic";

// When the total is asked, the mission freezes and a full-screen keypad opens (runtime.ask).
export function RunningTotalModule({ rects, runtime, color }) {
  const context = { durationMs: runtime.durationMs };
  const script = useMemo(() => buildContent(runningTotalSpec, runtime.seed, context), [runtime.seed, runtime.durationMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [shown, setShown] = useState(null);
  const [asking, setAsking] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const cursor = useRef({ next: 0, shownUntil: 0, prompt: null });
  const stats = useRef(emptyStats(runningTotalSpec));
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";

  useEffect(() => runtime.register(() => moduleResult(runningTotalSpec, stats.current, context)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function closePrompt(answer) {
    const state = cursor.current;
    const correct = answer !== null && answer === state.prompt.total;
    stats.current.outcomes.push(correct);
    setVerdict({ correct, total: state.prompt.total, skipped: answer === null });
    state.prompt = null;
    state.shownUntil = runtime.elapsed() + RESULT_MS;
    setAsking(false);
    feedback.flash(correct);
    void (correct ? triggerSuccessHaptic() : triggerErrorHaptic());
  }

  useEffect(() => {
    if (!running) return undefined;
    const state = cursor.current;
    const timer = setInterval(() => {
      const now = runtime.elapsed();
      if (state.shownUntil && now > state.shownUntil) { state.shownUntil = 0; setShown(null); setVerdict(null); }
      if (state.prompt || state.next >= script.length || script[state.next].at > now) return;
      const event = script[state.next];
      state.next += 1;
      if (event.type === "prompt") {
        state.prompt = { ...event, at: now };
        setShown(null); setVerdict(null); setAsking(true);
        void triggerSelectionHaptic();
        runtime.ask({ kicker: "MENTAL MATH", title: "Running total?" }).then(closePrompt);
      } else {
        state.shownUntil = now + OPERATION_MS;
        setShown(event);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  const strip = rects.strip;
  const content = verdict
    ? <Text style={[styles.value, { color: verdict.correct ? SUCCESS : SPACE_CADET.attention }]}>{verdict.correct ? "RIGHT" : `WAS ${verdict.total}`}</Text>
    : asking ? <Text style={[styles.value, { color }]}>?</Text>
      : shown ? <Text style={styles.value}>{shown.type === "start" ? `START ${shown.value}` : `${shown.value > 0 ? "+" : "−"} ${Math.abs(shown.value)}`}</Text>
        : <Text style={styles.idle}>{running ? "COUNTING" : "—"}</Text>;

  return <>
    <ModuleBlock rect={strip} color={color} flash={feedback.style} style={styles.strip}>
      <View><BlockKicker color={color}>TOTAL</BlockKicker><Text style={styles.caption}>{asking ? "ENTER IT" : "KEEP COUNT"}</Text></View>
      {content}
    </ModuleBlock>
  </>;
}

export const runningTotalModule = { ...runningTotalSpec, Component: RunningTotalModule };

const styles = StyleSheet.create({
  strip: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  caption: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.2, marginTop: 5 },
  value: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 26 },
  idle: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.6 },
});
