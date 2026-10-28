import { Fragment, useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { SPACE_CADET } from "../../../theme/spaceCadet";
import { triggerSelectionHaptic } from "../../../utils/haptics";
import { BlockKicker, ERROR, holdGesture, LED_IDLE, ModuleBlock, SUCCESS, tint } from "../../kit";
import { advance, altitudeSpec, BAND_HALF, buildContent, emptyStats, initialState, moduleResult, STEP_S } from "./logic";

const TRACK_TOP = 40;
const TRACK_BOTTOM = 18;
const TICKS = 40;

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
  const context = { durationMs: runtime.durationMs };
  const plan = useMemo(() => buildContent(altitudeSpec, runtime.seed, context), [runtime.seed, runtime.durationMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const altitude = useSharedValue(plan.bands[0].center);
  const bandCenter = useSharedValue(plan.bands[0].center);
  const thrust = useRef({ up: false, down: false });
  const stats = useRef(emptyStats(altitudeSpec));
  // Simulation state lives in a ref so a pause (app sent to background) resumes exactly where it stopped.
  const sim = useRef(initialState(plan));
  const gauge = rects.gauge;
  const trackHeight = gauge.height - TRACK_TOP - TRACK_BOTTOM;
  const bandHeight = BAND_HALF * 2 * trackHeight;
  const running = runtime.status === "running";

  useEffect(() => runtime.register(() => moduleResult(altitudeSpec, stats.current, context)), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fixed-step simulation driven by the mission clock (which stops during a pause); only shared values change,
  // so nothing re-renders while flying.
  useEffect(() => {
    if (!running) return undefined;
    const state = sim.current;
    const timer = setInterval(() => {
      const due = Math.floor(runtime.elapsed() / 1000 / STEP_S);
      while (state.steps < due) advance(state, plan, thrust.current, stats.current);
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

export const altitudeModule = { ...altitudeSpec, Component: AltitudeModule };

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
