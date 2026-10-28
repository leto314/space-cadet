import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import Svg, { Circle, Line } from "react-native-svg";

import { SPACE_CADET } from "../../../theme/spaceCadet";
import { BlockKicker, ERROR, LED_IDLE, ModuleBlock, SUCCESS, tint } from "../../kit";
import { advance, buildContent, emptyStats, initialState, LOCK_RADIUS, moduleResult, STEP_S, targetAt, trackingMiniSpec, trackingSpec } from "./logic";

const KNOB = 38;
// The knob springs back to centre with a small overshoot.
const KNOB_RETURN = { stiffness: 420, damping: 24, mass: 1 };

function Joystick({ rect, color, knobX, knobY, enabled }) {
  const radius = Math.min(rect.width, rect.height) / 2 - 18;
  const gesture = useMemo(() => {
    const move = (x, y) => {
      "worklet";
      let dx = x - rect.width / 2;
      let dy = y - rect.height / 2;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length > radius) { dx = (dx / length) * radius; dy = (dy / length) * radius; }
      knobX.value = dx / radius;
      knobY.value = dy / radius;
    };
    return Gesture.Pan().enabled(enabled).minDistance(0)
      .onBegin((event) => { move(event.x, event.y); })
      .onUpdate((event) => { move(event.x, event.y); })
      .onFinalize(() => { knobX.value = withSpring(0, KNOB_RETURN); knobY.value = withSpring(0, KNOB_RETURN); });
  }, [enabled, rect.width, rect.height]); // eslint-disable-line react-hooks/exhaustive-deps
  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: knobX.value * radius }, { translateY: knobY.value * radius }] }));
  return <GestureDetector gesture={gesture}>
    <View style={styles.joystickArea}>
      <View style={[styles.joystickBase, { width: radius * 2, height: radius * 2, borderRadius: radius, borderColor: tint(color, 0.35) }]} />
      <Animated.View style={[styles.knob, { backgroundColor: tint(color, 0.35), borderColor: color, shadowColor: color }, knobStyle]} />
    </View>
  </GestureDetector>;
}

export function TrackingModule({ rects, runtime, color, spec = trackingSpec }) {
  const { maxSpeed, compact } = spec.options;
  const context = { durationMs: runtime.durationMs };
  const path = useMemo(() => buildContent(spec, runtime.seed, context), [runtime.seed, runtime.durationMs, spec]); // eslint-disable-line react-hooks/exhaustive-deps
  const knobX = useSharedValue(0);
  const knobY = useSharedValue(0);
  const target = useSharedValue(targetAt(path, 0));
  const reticle = useSharedValue({ x: 0, y: 0 });
  const sim = useRef(initialState());
  const stats = useRef(emptyStats(spec));
  const running = runtime.status === "running";
  const scope = rects.scope;
  const radius = Math.min(scope.width, scope.height) / 2 - 16;
  const center = { x: scope.width / 2, y: scope.height / 2 + 6 };

  useEffect(() => runtime.register(() => moduleResult(spec, stats.current, context)), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fixed-step simulation on the mission clock (so it freezes during a pause); the joystick is read from its
  // shared values, and only shared values are written, so nothing re-renders while tracking.
  useEffect(() => {
    if (!running) { knobX.value = 0; knobY.value = 0; return undefined; }
    const state = sim.current;
    const timer = setInterval(() => {
      const now = runtime.elapsed() / 1000;
      const due = Math.floor(now / STEP_S);
      const stick = { x: knobX.value, y: -knobY.value };
      while (state.steps < due) advance(state, path, stick, maxSpeed, stats.current);
      // Drawn from the current clock on every tick, even when no simulation step was due.
      target.value = targetAt(path, now);
      reticle.value = { x: state.x, y: state.y };
    }, 33);
    return () => clearInterval(timer);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  const targetStyle = useAnimatedStyle(() => ({ transform: [{ translateX: target.value.x * radius }, { translateY: -target.value.y * radius }] }));
  const reticleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: reticle.value.x * radius }, { translateY: -reticle.value.y * radius }] }));
  const ledStyle = useAnimatedStyle(() => {
    if (!running) return { backgroundColor: LED_IDLE };
    const locked = Math.hypot(reticle.value.x - target.value.x, reticle.value.y - target.value.y) <= LOCK_RADIUS;
    return { backgroundColor: locked ? SUCCESS : ERROR };
  });
  const lockSize = LOCK_RADIUS * radius * 2;
  // The crosshair stays clearly smaller than the target circle, even on the compact scope.
  const reticleSize = compact ? Math.max(10, Math.round(lockSize * 0.5)) : 22;

  return <>
    <ModuleBlock rect={scope} color={color} led={ledStyle}>
      <BlockKicker color={color} style={styles.kicker}>TRACK</BlockKicker>
      <Svg width={scope.width} height={scope.height} style={StyleSheet.absoluteFill}>
        <Circle cx={center.x} cy={center.y} r={radius} stroke={SPACE_CADET.borderDefault} fill="none" />
        <Circle cx={center.x} cy={center.y} r={radius / 2} stroke={SPACE_CADET.borderSubtle} fill="none" />
        <Line x1={center.x - radius} y1={center.y} x2={center.x + radius} y2={center.y} stroke={SPACE_CADET.borderSubtle} />
        <Line x1={center.x} y1={center.y - radius} x2={center.x} y2={center.y + radius} stroke={SPACE_CADET.borderSubtle} />
      </Svg>
      <Animated.View style={[styles.marker, { left: center.x - lockSize / 2, top: center.y - lockSize / 2, width: lockSize, height: lockSize, borderRadius: lockSize / 2, borderColor: color, backgroundColor: tint(color, 0.12) }, targetStyle]} />
      <Animated.View style={[styles.reticle, { left: center.x - reticleSize / 2, top: center.y - reticleSize / 2, width: reticleSize, height: reticleSize }, reticleStyle]}>
        <View style={[styles.reticleH, { width: reticleSize }]} /><View style={[styles.reticleV, { height: reticleSize }]} />
      </Animated.View>
    </ModuleBlock>
    <ModuleBlock rect={rects.stick} color={color}>
      <Joystick rect={rects.stick} color={color} knobX={knobX} knobY={knobY} enabled={running} />
    </ModuleBlock>
  </>;
}

export const trackingModule = { ...trackingSpec, Component: TrackingModule };
export const trackingMiniModule = { ...trackingMiniSpec, Component: (props) => <TrackingModule {...props} spec={trackingMiniSpec} /> };

const styles = StyleSheet.create({
  kicker: { position: "absolute", top: 12, left: 14 },
  marker: { position: "absolute", borderWidth: 1.5 },
  reticle: { position: "absolute", width: 22, height: 22, alignItems: "center", justifyContent: "center" },
  reticleH: { position: "absolute", width: 22, height: 1.5, backgroundColor: SPACE_CADET.white },
  reticleV: { position: "absolute", width: 1.5, height: 22, backgroundColor: SPACE_CADET.white },
  joystickArea: { flex: 1, alignItems: "center", justifyContent: "center" },
  joystickBase: { position: "absolute", borderWidth: 1 },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2, borderWidth: 1.5, shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
});
