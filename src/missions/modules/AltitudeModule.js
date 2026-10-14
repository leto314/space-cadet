import { Fragment, useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerSelectionHaptic } from "../../utils/haptics";
import { createRandom, randomTools } from "../../utils/random";
import { BlockKicker, ERROR, holdGesture, LED_IDLE, ModuleBlock, SUCCESS, tint } from "../kit";

const STEP_S = 1 / 30;
const BAND_HALF = 0.1;
const THRUST = 0.9;
const DAMPING = 1.6;
const BAND_MOVE_S = 1.4;
const TRACK_TOP = 40;
const TRACK_BOTTOM = 18;
const TICKS = 40;

// The whole flight is decided by the seed: gusts (drift changes) and the moments the target band moves.
function buildPlan(seed, durationMs) {
  const rnd = randomTools(createRandom(seed));
  const seconds = durationMs / 1000;
  const gusts = [];
  for (let at = 0; at < seconds + 5; at += rnd.float(1.8, 3.8)) gusts.push({ at, accel: (rnd.chance(0.5) ? 1 : -1) * rnd.float(0.03, 0.09) });
  const bands = [{ at: 0, center: rnd.float(0.42, 0.58) }];
  for (let at = rnd.float(22, 30); at < seconds - 8; at += rnd.float(22, 34)) {
    let center;
    do center = rnd.float(0.25, 0.75); while (Math.abs(center - bands.at(-1).center) < 0.2);
    bands.push({ at, center });
  }
  return { gusts, bands };
}

function Chevron({ up, color }) {
  return <Svg width="26" height="26" viewBox="0 0 24 24"><Path d={up ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

function HoldButton({ up, color, onHold }) {
  const pressed = useSharedValue(0);
  const pressedColor = tint(color, 0.2);
  const gesture = useMemo(() => holdGesture(onHold, pressed), []); // eslint-disable-line react-hooks/exhaustive-deps
  const style = useAnimatedStyle(() => ({ backgroundColor: pressed.value ? pressedColor : "transparent" }));
  return <GestureDetector gesture={gesture}>
    <Animated.View style={[styles.holdZone, style]}><Chevron up={up} color={SPACE_CADET.white} /></Animated.View>
  </GestureDetector>;
}

export function AltitudeModule({ rects, runtime, color }) {
  const plan = useMemo(() => buildPlan(runtime.seed, runtime.durationMs), [runtime.seed, runtime.durationMs]);
  const altitude = useSharedValue(plan.bands[0].center);
  const bandCenter = useSharedValue(plan.bands[0].center);
  const thrust = useRef({ up: false, down: false });
  const stats = useRef({ inBand: 0, samples: 0 });
  // Simulation state lives in a ref so a pause (app sent to background) resumes exactly where it stopped.
  const sim = useRef({ steps: 0, position: plan.bands[0].center, velocity: 0, accel: 0, gustIndex: 0, bandIndex: 0, bandFrom: plan.bands[0].center, center: plan.bands[0].center });
  const gauge = rects.gauge;
  const trackHeight = gauge.height - TRACK_TOP - TRACK_BOTTOM;
  const bandHeight = BAND_HALF * 2 * trackHeight;
  const running = runtime.status === "running";

  useEffect(() => runtime.register(() => {
    const share = stats.current.samples ? stats.current.inBand / stats.current.samples : 0;
    return { performance: share, detail: `In the band ${Math.round(share * 100)}% of the time` };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fixed-step simulation driven by the mission clock (which stops during a pause); only shared values change,
  // so nothing re-renders while flying.
  useEffect(() => {
    if (!running) return undefined;
    const state = sim.current;
    const timer = setInterval(() => {
      const due = Math.floor(runtime.elapsed() / 1000 / STEP_S);
      while (state.steps < due) {
        const time = state.steps * STEP_S;
        while (state.gustIndex + 1 < plan.gusts.length && plan.gusts[state.gustIndex + 1].at <= time) state.gustIndex += 1;
        if (state.bandIndex + 1 < plan.bands.length && plan.bands[state.bandIndex + 1].at <= time) { state.bandFrom = state.center; state.bandIndex += 1; }
        const band = plan.bands[state.bandIndex];
        const progress = state.bandIndex === 0 ? 1 : Math.min(1, (time - band.at) / BAND_MOVE_S);
        state.center = state.bandFrom + (band.center - state.bandFrom) * (progress * progress * (3 - 2 * progress));
        state.accel += (plan.gusts[state.gustIndex].accel - state.accel) * 0.05;
        const push = (thrust.current.up ? THRUST : 0) - (thrust.current.down ? THRUST : 0);
        state.velocity += (state.accel + push - state.velocity * DAMPING) * STEP_S;
        state.position += state.velocity * STEP_S;
        if (state.position < 0.02) { state.position = 0.02; state.velocity = Math.max(0, state.velocity); }
        if (state.position > 0.98) { state.position = 0.98; state.velocity = Math.min(0, state.velocity); }
        stats.current.samples += 1;
        if (Math.abs(state.position - state.center) <= BAND_HALF) stats.current.inBand += 1;
        state.steps += 1;
      }
      altitude.value = state.position;
      bandCenter.value = state.center;
    }, 33);
    return () => { clearInterval(timer); thrust.current = { up: false, down: false }; };
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  const bandStyle = useAnimatedStyle(() => ({ transform: [{ translateY: TRACK_TOP + (1 - bandCenter.value - BAND_HALF) * trackHeight }] }));
  const levelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: TRACK_TOP + (1 - altitude.value) * trackHeight - 1 }],
    backgroundColor: Math.abs(altitude.value - bandCenter.value) <= BAND_HALF ? color : SPACE_CADET.white,
  }));
  // Status light: green inside the band, red outside, idle before take-off.
  const ledStyle = useAnimatedStyle(() => ({ backgroundColor: !running ? LED_IDLE : Math.abs(altitude.value - bandCenter.value) <= BAND_HALF ? SUCCESS : ERROR }));

  function hold(direction, active) {
    thrust.current[direction] = active;
    if (active) void triggerSelectionHaptic();
  }

  return <>
    <ModuleBlock rect={gauge} color={color} led={ledStyle}>
      <BlockKicker color={color} style={styles.kicker}>ALT</BlockKicker>
      <Animated.View style={[styles.band, { height: bandHeight, backgroundColor: tint(color, 0.1), borderColor: tint(color, 0.55) }, bandStyle]} />
      {Array.from({ length: TICKS + 1 }, (_, index) => {
        const major = index % 10 === 0;
        const style = [styles.tick, { top: TRACK_TOP + (index / TICKS) * trackHeight, width: major ? 9 : 4, opacity: major ? 0.34 : 0.16 }];
        return <Fragment key={index}><View pointerEvents="none" style={[...style, styles.tickLeft]} /><View pointerEvents="none" style={[...style, styles.tickRight]} /></Fragment>;
      })}
      <Animated.View style={[styles.level, levelStyle]} />
    </ModuleBlock>
    <ModuleBlock rect={rects.control} color={color}>
      <HoldButton up color={color} onHold={(active) => hold("up", active)} />
      <View style={[styles.divider, { backgroundColor: tint(color, 0.25) }]} />
      <HoldButton up={false} color={color} onHold={(active) => hold("down", active)} />
    </ModuleBlock>
  </>;
}

export const altitudeModule = {
  id: "altitude",
  title: "Altitude hold",
  competence: "multitasking",
  secondary: ["attention"],
  task: "continuous",
  voice: false,
  load: 3,
  rule: "Your aircraft keeps drifting up and down. Hold the up or down arrows to keep it inside the band. The band moves from time to time.",
  recap: "hold your altitude",
  blocks: [{ key: "gauge", role: "display", h: 4, w: 1 }, { key: "control", role: "control", h: 2, w: 1, use: "frequent" }],
  Component: AltitudeModule,
};

const styles = StyleSheet.create({
  kicker: { position: "absolute", top: 13, left: 13 },
  band: { position: "absolute", top: 0, left: 0, right: 0, borderTopWidth: 1, borderBottomWidth: 1 },
  tick: { position: "absolute", height: StyleSheet.hairlineWidth, backgroundColor: SPACE_CADET.white },
  tickLeft: { left: 0 },
  tickRight: { right: 0 },
  level: { position: "absolute", top: 0, left: 10, right: 10, height: 2, borderRadius: 1 },
  holdZone: { flex: 1, alignItems: "center", justifyContent: "center" },
  divider: { height: 1, marginHorizontal: 14 },
});
