import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { createRandom, randomTools } from "../../utils/random";
import { BlockKicker, ModuleBlock, SUCCESS, useFeedbackFlash } from "../kit";

const OPERATION_MS = 2500;
const PROMPT_MS = 12000;
const RESULT_MS = 2500;
const PROMPT_POINTS = [0.38, 0.68, 0.94];

// The sequence of operations comes from the seed; the total stays between 0 and 199. Questions pause the stream.
function buildScript(seed, durationMs) {
  const rnd = randomTools(createRandom(seed));
  let total = rnd.int(20, 60);
  const events = [{ at: 1200, type: "start", value: total, total }];
  const prompts = PROMPT_POINTS.map((point) => Math.round(point * durationMs));
  for (let at = 6000; at < durationMs - 3000; at += rnd.int(6000, 9000)) {
    if (prompts.some((time) => at > time - OPERATION_MS && at < time + PROMPT_MS + RESULT_MS)) continue;
    const size = rnd.chance(0.2) ? rnd.int(10, 15) : rnd.int(1, 9);
    const sign = total - size < 0 ? 1 : total + size > 199 ? -1 : rnd.item([1, -1]);
    total += sign * size;
    events.push({ at, type: "operation", value: sign * size, total });
  }
  prompts.forEach((at) => events.push({ at, type: "prompt" }));
  events.sort((a, b) => a.at - b.at);
  let running = null;
  events.forEach((event) => { if (event.type === "prompt") event.total = running; else running = event.total; });
  return events;
}

// When the total is asked, the mission freezes and a full-screen keypad opens (runtime.ask).
export function RunningTotalModule({ rects, runtime, color }) {
  const script = useMemo(() => buildScript(runtime.seed, runtime.durationMs), [runtime.seed, runtime.durationMs]);
  const [shown, setShown] = useState(null);
  const [asking, setAsking] = useState(false);
  const [verdict, setVerdict] = useState(null);
  const cursor = useRef({ next: 0, shownUntil: 0, prompt: null });
  const outcomes = useRef([]);
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";

  useEffect(() => runtime.register(() => {
    const correct = outcomes.current.filter(Boolean).length;
    return { performance: correct / PROMPT_POINTS.length, detail: `${correct}/${PROMPT_POINTS.length} totals right` };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  function closePrompt(answer) {
    const state = cursor.current;
    const correct = answer !== null && answer === state.prompt.total;
    outcomes.current.push(correct);
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

export const runningTotalModule = {
  id: "running-total",
  title: "Running total",
  competence: "mentalMath",
  secondary: ["memory"],
  task: "event",
  voice: false,
  load: 2,
  rule: "A starting number, then additions and subtractions appear one at a time. Keep the running total in your head. Three times the mission pauses and asks for it: type it and confirm. The real total is shown after each answer.",
  recap: "keep the running total",
  blocks: [{ key: "strip", role: "display", h: 1, w: 4 }],
  Component: RunningTotalModule,
};

const styles = StyleSheet.create({
  strip: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  caption: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.2, marginTop: 5 },
  value: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 26 },
  idle: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.6 },
});
