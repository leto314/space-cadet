import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";

import { SPACE_CADET } from "../../../theme/spaceCadet";
import { triggerSelectionHaptic, triggerSuccessHaptic } from "../../../utils/haptics";
import { BlockKicker, LED_IDLE, ModuleBlock, SUCCESS, tint, useFeedbackFlash } from "../../kit";
import { buildContent, emptyStats, formatFrequency, FREQUENCIES, moduleResult, radioCallsignSpec, radioSpec, RESPONSE_WINDOW_MS, showCallsign } from "./logic";

const THUMB = 22;

// One channel row: frequency readout and a notched slider. Reports each notch and the release.
function Tuner({ label, labelColor, start, color, onSelect, onRelease, enabled }) {
  const [index, setIndex] = useState(start);
  const trackWidth = useSharedValue(0);
  const thumbIndex = useSharedValue(start);
  const lastIndex = useSharedValue(start);
  const maxIndex = FREQUENCIES.length - 1;
  function select(next) { setIndex(next); onSelect(next); }
  const gesture = useMemo(() => {
    const pick = (x) => {
      "worklet";
      if (!trackWidth.value) return;
      const next = Math.max(0, Math.min(maxIndex, Math.round((x - THUMB / 2) / (trackWidth.value - THUMB) * maxIndex)));
      thumbIndex.value = next;
      if (next !== lastIndex.value) { lastIndex.value = next; runOnJS(select)(next); }
    };
    return Gesture.Pan().enabled(enabled).minDistance(0)
      .onBegin((event) => { pick(event.x); })
      .onUpdate((event) => { pick(event.x); })
      .onFinalize(() => { runOnJS(onRelease)(lastIndex.value); });
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (thumbIndex.value / maxIndex) * Math.max(0, trackWidth.value - THUMB) }] }));
  const fillStyle = useAnimatedStyle(() => ({ width: THUMB / 2 + (thumbIndex.value / maxIndex) * Math.max(0, trackWidth.value - THUMB) }));
  return <View style={styles.tuner}>
    <View style={styles.readout}>
      <BlockKicker color={labelColor}>{label}</BlockKicker>
      <Text style={styles.frequency}>{formatFrequency(FREQUENCIES[index])}</Text>
    </View>
    <GestureDetector gesture={gesture}>
      <View style={styles.track} onLayout={(event) => { trackWidth.value = event.nativeEvent.layout.width; }}>
        <View style={styles.rail}>{FREQUENCIES.map((_, tick) => <View key={tick} style={[styles.tick, tick % 2 === 0 && styles.tickMajor]} />)}</View>
        <Animated.View style={[styles.fill, { backgroundColor: tint(color, 0.5) }, fillStyle]} />
        <Animated.View style={[styles.thumb, { backgroundColor: color, shadowColor: color }, thumbStyle]} />
      </View>
    </GestureDetector>
  </View>;
}

export function RadioModule({ rects, runtime, color, spec = radioSpec }) {
  const { channels, callsigns } = spec.options;
  const context = { durationMs: runtime.durationMs };
  const plan = useMemo(() => buildContent(spec, runtime.seed, context), [runtime.seed, runtime.durationMs, spec]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tuned, setTuned] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const pulse = useSharedValue(1);
  const pending = useRef(null);
  const decoys = useRef([]);
  const stats = useRef(emptyStats(spec));
  const nextCall = useRef(0);
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";

  useEffect(() => runtime.register(() => moduleResult(spec, stats.current, context)), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running) return undefined;
    // Back from a pause: the voice was cut, so a call still waiting for an answer is read again.
    if (pending.current) runtime.speak(pending.current.message);
    const timer = setInterval(() => {
      const now = runtime.elapsed();
      if (pending.current && now - pending.current.at > RESPONSE_WINDOW_MS) { stats.current.outcomes.push({ hit: false }); pending.current = null; setWaiting(false); }
      decoys.current = decoys.current.filter((decoy) => now - decoy.at <= RESPONSE_WINDOW_MS);
      if (nextCall.current < plan.calls.length && plan.calls[nextCall.current].at <= now) {
        const call = plan.calls[nextCall.current];
        runtime.speak(call.message);
        if (call.mine) {
          if (pending.current) stats.current.outcomes.push({ hit: false });
          pending.current = { ...call, at: now };
          setTuned(false);
          setWaiting(true);
        } else decoys.current.push({ ...call, at: now });
        nextCall.current += 1;
      }
    }, 200);
    return () => clearInterval(timer);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  // A call counts once the right channel is released on the announced frequency; releasing a channel on the
  // frequency given to another callsign counts against the player.
  function release(channel, index) {
    if (!running) return;
    const call = pending.current;
    if (call && call.channel === channel && call.target === index) {
      stats.current.outcomes.push({ hit: true, reactionMs: runtime.elapsed() - call.at });
      pending.current = null;
      setTuned(true);
      setWaiting(false);
      feedback.flash(true);
      void triggerSuccessHaptic();
      return;
    }
    const decoy = decoys.current.find((entry) => entry.channel === channel && entry.target === index);
    if (decoy) { stats.current.obeyedDecoys += 1; decoys.current = decoys.current.filter((entry) => entry !== decoy); feedback.flash(false); }
  }

  // Status light: in single-channel mode it pulses while a call waits for an answer (every call is the player's);
  // with callsigns it only confirms a success, otherwise it would give away which calls are the player's.
  const pulsing = waiting && !callsigns;
  useEffect(() => {
    if (pulsing) pulse.value = withRepeat(withSequence(withTiming(0.25, { duration: 520, easing: Easing.inOut(Easing.quad) }), withTiming(1, { duration: 520, easing: Easing.inOut(Easing.quad) })), -1);
    else { cancelAnimation(pulse); pulse.value = 1; }
  }, [pulsing]); // eslint-disable-line react-hooks/exhaustive-deps
  const ledColor = pulsing ? color : tuned ? SUCCESS : LED_IDLE;
  const ledStyle = useAnimatedStyle(() => ({ backgroundColor: ledColor, opacity: pulse.value }));

  const tuners = plan.starts.map((start, channel) => <Tuner key={channel} label={channels === 1 && tuned ? "SET" : `COM ${channel + 1}`} labelColor={channels === 1 && tuned ? SUCCESS : color} start={start} color={color} enabled={running}
    onSelect={() => { void triggerSelectionHaptic(); }} onRelease={(index) => release(channel, index)} />);

  if (channels === 1) return <ModuleBlock rect={rects.tuner} color={color} flash={feedback.style} led={ledStyle} style={styles.single}>{tuners}</ModuleBlock>;
  return <ModuleBlock rect={rects.tuner} color={color} flash={feedback.style} led={ledStyle} style={styles.double}>
    <View style={styles.header}><BlockKicker color={color}>RADIO</BlockKicker><Text style={styles.callsign}>YOU: {showCallsign(plan.me)}</Text></View>
    {tuners}
  </ModuleBlock>;
}

export const radioModule = { ...radioSpec, Component: RadioModule };
export const radioCallsignModule = { ...radioCallsignSpec, Component: (props) => <RadioModule {...props} spec={radioCallsignSpec} /> };

const styles = StyleSheet.create({
  single: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16 },
  double: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 2 },
  callsign: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.2 },
  tuner: { flex: 1, flexDirection: "row", alignItems: "center" },
  readout: { width: 84 },
  frequency: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 22, marginTop: 4 },
  track: { flex: 1, height: 44, justifyContent: "center", marginLeft: 8 },
  rail: { position: "absolute", left: THUMB / 2, right: THUMB / 2, height: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tick: { width: 1, height: 6, backgroundColor: SPACE_CADET.borderDefault },
  tickMajor: { height: 12 },
  fill: { position: "absolute", left: 0, height: 2, borderRadius: 1 },
  thumb: { position: "absolute", left: 0, width: THUMB, height: THUMB, borderRadius: THUMB / 2, shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
});
