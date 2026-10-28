import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { SPACE_CADET } from "../../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../../utils/haptics";
import { BlockKicker, ModuleBlock, SUCCESS, tint, useFeedbackFlash } from "../../kit";
import { buildContent, codesSpec, codesVoiceSpec, emptyStats, MESSAGE_MS, moduleResult, QUERY_MS, spell } from "./logic";

// `listen`: the audio variant, where messages are only heard (every one of them, mine or not), never shown.
export function CodesModule({ rects, runtime, color, spec = codesSpec }) {
  const { listen } = spec.options;
  const context = { durationMs: runtime.durationMs };
  const script = useMemo(() => buildContent(spec, runtime.seed, context), [runtime.seed, runtime.durationMs, spec]); // eslint-disable-line react-hooks/exhaustive-deps
  const [message, setMessage] = useState(null);
  const [query, setQuery] = useState(null);
  const [answered, setAnswered] = useState(null);
  const cursor = useRef({ next: 0, messageUntil: 0, query: null, spoken: null });
  const stats = useRef(emptyStats(spec));
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";

  useEffect(() => runtime.register(() => moduleResult(spec, stats.current, context)), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running) return undefined;
    const state = cursor.current;
    // Back from a pause: a message that was being read out is read again (the voice was cut).
    if (listen && state.spoken && state.messageUntil > runtime.elapsed()) { state.messageUntil = runtime.elapsed() + MESSAGE_MS; runtime.speak(state.spoken); }
    const timer = setInterval(() => {
      const now = runtime.elapsed();
      if (state.query && now - state.query.at > QUERY_MS) { stats.current.outcomes.push(false); state.query = null; setQuery(null); feedback.flash(false); }
      if (state.messageUntil && now > state.messageUntil) { state.messageUntil = 0; setMessage(null); }
      if (state.query || state.next >= script.events.length || script.events[state.next].at > now) return;
      const event = script.events[state.next];
      state.next += 1;
      if (event.type === "query") {
        state.query = { ...event, at: now };
        setMessage(null); setAnswered(null); setQuery(event);
        void triggerSelectionHaptic();
      } else {
        state.messageUntil = now + MESSAGE_MS;
        setMessage(event);
        if (listen) { state.spoken = `${event.to.toLowerCase()}, ${event.mine && state.next === 1 ? "your code is" : "new code"}: ${spell(event.code)}.`; runtime.speak(state.spoken); }
      }
    }, 100);
    return () => clearInterval(timer);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  function answer(option) {
    const state = cursor.current;
    if (!running || !state.query) return;
    const correct = option === state.query.answer;
    stats.current.outcomes.push(correct);
    state.query = null;
    setAnswered({ option, correct });
    feedback.flash(correct);
    void (correct ? triggerSuccessHaptic() : triggerErrorHaptic());
    setTimeout(() => { setQuery(null); setAnswered(null); }, 900);
  }

  return <ModuleBlock rect={rects.strip} color={color} flash={feedback.style} style={styles.block}>
    {query ? <>
      <View style={styles.label}><BlockKicker color={color}>ENTER</BlockKicker><BlockKicker color={color}>YOUR CODE</BlockKicker></View>
      <View style={styles.options}>
        {query.options.map((option) => {
          const state = answered && (option === query.answer ? "right" : option === answered.option ? "wrong" : null);
          return <Pressable key={option} disabled={!running || Boolean(answered)} onPress={() => answer(option)} style={({ pressed }) => [styles.option, pressed && { backgroundColor: tint(color, 0.16) }, state === "right" && { borderColor: SUCCESS }, state === "wrong" && { borderColor: SPACE_CADET.attention }]}>
            <Text style={styles.optionText}>{option}</Text>
          </Pressable>;
        })}
      </View>
    </> : <>
      <View style={styles.label}>
        <BlockKicker color={color}>CODES</BlockKicker>
        <Text style={styles.identity}>YOU: {script.me}</Text>
      </View>
      {message && listen ? <Text style={[styles.idle, { color }]}>TRANSMISSION</Text> : message ? <View style={styles.message}>
        <Text style={[styles.to, message.to === script.me && { color }]}>TO {message.to}</Text>
        <Text style={styles.code}>{message.code}</Text>
      </View> : <Text style={styles.idle}>{running ? "LISTENING" : "—"}</Text>}
    </>}
  </ModuleBlock>;
}

export const codesModule = { ...codesSpec, Component: CodesModule };
export const codesVoiceModule = { ...codesVoiceSpec, Component: (props) => <CodesModule {...props} spec={codesVoiceSpec} /> };

const styles = StyleSheet.create({
  block: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16 },
  label: { width: 78, gap: 5 },
  identity: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.2 },
  message: { flex: 1, flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingLeft: 8 },
  to: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.3 },
  code: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 26, letterSpacing: 3 },
  idle: { flex: 1, textAlign: "right", color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.6 },
  options: { flex: 1, flexDirection: "row", gap: 6 },
  option: { flex: 1, height: 40, borderRadius: 12, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" },
  optionText: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 14, letterSpacing: 1 },
});
