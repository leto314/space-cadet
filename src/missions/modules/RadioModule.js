import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";

import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { createRandom, randomTools } from "../../utils/random";
import { BlockKicker, LED_IDLE, ModuleBlock, SUCCESS, tint, useFeedbackFlash } from "../kit";

// VHF band excerpt, in 0.5 steps: 118.0 → 127.5 (20 positions, wide enough apart to set precisely by thumb).
const FREQUENCIES = Array.from({ length: 20 }, (_, index) => 118 + index * 0.5);
const RESPONSE_WINDOW_MS = 16000;
const DECOY_COST = 0.15;
const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const NAMES = ["ALPHA", "BRAVO", "DELTA", "ECHO", "FOXTROT", "KILO", "LIMA", "OSCAR", "SIERRA", "TANGO"];
const THUMB = 22;

const formatFrequency = (value) => value.toFixed(1);
const spellDigits = (text) => text.split("").map((char) => (char === "." ? "point" : DIGIT_WORDS[Number(char)])).join(" ");
// "121.5" → "one two one point five": digit by digit, the way controllers read frequencies.
const spellFrequency = (value) => spellDigits(formatFrequency(value));
const spellCallsign = ({ name, number }) => `${name.charAt(0)}${name.slice(1).toLowerCase()} ${spellDigits(number)}`;
const showCallsign = ({ name, number }) => `${name} ${number}`;

// Single channel: every call is for the player. Callsign mode: the player has a callsign and two channels; calls
// also go to look-alike callsigns (same name, digits swapped or another name) and must be ignored.
function buildCalls(seed, durationMs, channels, callsigns) {
  const rnd = randomTools(createRandom(seed));
  const starts = Array.from({ length: channels }, () => rnd.int(2, 17));
  const me = { name: rnd.item(NAMES), number: String(rnd.int(12, 98)) };
  if (me.number[0] === me.number[1]) me.number = `${me.number[0]}${(Number(me.number[1]) + 3) % 10}`;
  const others = [
    { name: me.name, number: `${me.number[1]}${me.number[0]}` },
    { name: rnd.item(NAMES.filter((name) => name !== me.name)), number: me.number },
    { name: me.name, number: String((Number(me.number) + rnd.item([1, 10])) % 100).padStart(2, "0") },
  ];
  const calls = [];
  const previous = [...starts];
  const gaps = callsigns ? [15000, 22000] : [24000, 34000];
  for (let at = rnd.int(7000, 10000); at < durationMs - 10000; at += rnd.int(gaps[0], gaps[1])) {
    const channel = rnd.int(0, channels - 1);
    let target;
    do target = rnd.int(0, FREQUENCIES.length - 1); while (Math.abs(target - previous[channel]) < 2);
    const mine = !callsigns || rnd.chance(0.5);
    const to = mine ? me : rnd.item(others);
    if (mine) previous[channel] = target;
    const address = callsigns ? `${spellCallsign(to)}, set com ${channel + 1} to` : "Radio. Set frequency";
    calls.push({ at, channel, target, mine, message: `${address} ${spellFrequency(FREQUENCIES[target])}.` });
  }
  return { starts, calls, me };
}

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

export function RadioModule({ rects, runtime, color, channels = 1, callsigns = false }) {
  const plan = useMemo(() => buildCalls(runtime.seed, runtime.durationMs, channels, callsigns), [runtime.seed, runtime.durationMs, channels, callsigns]);
  const [tuned, setTuned] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const pulse = useSharedValue(1);
  const pending = useRef(null);
  const decoys = useRef([]);
  const outcomes = useRef([]);
  const obeyedDecoys = useRef(0);
  const nextCall = useRef(0);
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";

  useEffect(() => runtime.register(() => {
    const scores = outcomes.current.map((outcome) => (outcome.hit ? Math.max(0.4, 1 - Math.max(0, outcome.reactionMs - 4000) / 12000 * 0.6) : 0));
    const hits = outcomes.current.filter((outcome) => outcome.hit);
    const average = hits.length ? hits.reduce((sum, outcome) => sum + outcome.reactionMs, 0) / hits.length / 1000 : null;
    const mean = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 1;
    return {
      performance: Math.max(0, mean - DECOY_COST * obeyedDecoys.current),
      detail: `${hits.length}/${outcomes.current.length} calls tuned${average !== null ? ` · ${average.toFixed(1)} s avg` : ""}${obeyedDecoys.current ? ` · ${obeyedDecoys.current} wrong callsign` : ""}`,
    };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running) return undefined;
    // Back from a pause: the voice was cut, so a call still waiting for an answer is read again.
    if (pending.current) runtime.speak(pending.current.message);
    const timer = setInterval(() => {
      const now = runtime.elapsed();
      if (pending.current && now - pending.current.at > RESPONSE_WINDOW_MS) { outcomes.current.push({ hit: false }); pending.current = null; setWaiting(false); }
      decoys.current = decoys.current.filter((decoy) => now - decoy.at <= RESPONSE_WINDOW_MS);
      if (nextCall.current < plan.calls.length && plan.calls[nextCall.current].at <= now) {
        const call = plan.calls[nextCall.current];
        runtime.speak(call.message);
        if (call.mine) {
          if (pending.current) outcomes.current.push({ hit: false });
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
      outcomes.current.push({ hit: true, reactionMs: runtime.elapsed() - call.at });
      pending.current = null;
      setTuned(true);
      setWaiting(false);
      feedback.flash(true);
      void triggerSuccessHaptic();
      return;
    }
    const decoy = decoys.current.find((entry) => entry.channel === channel && entry.target === index);
    if (decoy) { obeyedDecoys.current += 1; decoys.current = decoys.current.filter((entry) => entry !== decoy); feedback.flash(false); }
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

export const radioModule = {
  id: "radio",
  title: "Radio calls",
  competence: "memory",
  secondary: ["attention"],
  task: "event",
  voice: true,
  load: 3,
  rule: "Listen for radio calls. When a frequency is announced, slide the tuner to it and release. The frequency is only said once.",
  recap: "follow the radio calls",
  blocks: [{ key: "tuner", role: "control", h: 1, w: 4 }],
  Component: RadioModule,
};

// The MATB-style version: your own callsign, two channels, and calls for other aircraft to ignore.
export const radioCallsignModule = {
  id: "radio-callsign",
  title: "Radio traffic",
  competence: "memory",
  secondary: ["attention"],
  task: "event",
  voice: true,
  load: 4,
  rule: "You have a callsign and two radios. Calls are addressed to several aircraft, some with callsigns close to yours. Only when a call is for you, set the named radio (COM 1 or COM 2) to the frequency and release. Following someone else's call counts as an error.",
  recap: "answer your radio calls only",
  blocks: [{ key: "tuner", role: "control", h: 2, w: 4 }],
  Component: (props) => <RadioModule {...props} channels={2} callsigns />,
};

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
