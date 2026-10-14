import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import Svg, { Circle, Line } from "react-native-svg";

import { SPACE_CADET } from "../../theme/spaceCadet";
import { createRandom, randomTools } from "../../utils/random";
import { BlockKicker, ERROR, LED_IDLE, ModuleBlock, SUCCESS, tint } from "../kit";

const STEP_S = 1 / 30;
const LOCK_RADIUS = 0.2;
const GLIDE_SPEED = 0.2;
const KNOB = 38;
// The crosshair is heavy: its speed only catches up with the stick over ~0.7 s, and it keeps coasting after release.
const INERTIA_S = 0.7;
// The knob springs back to centre with a small overshoot.
const KNOB_RETURN = { stiffness: 420, damping: 24, mass: 1 };

// The target never stands perfectly still: a slow seeded drift (two gentle waves per axis) runs all the time, and
// every 4–8 s it also glides to a new spot, starting gently and taking its time over the last stretch. Everything
// comes from the seed. Units: the scope has a radius of 1.
function buildPath(seed, durationMs) {
  const rnd = randomTools(createRandom(seed));
  const point = () => { const angle = rnd.float(0, Math.PI * 2); const distance = rnd.float(0.15, 0.6); return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance }; };
  const wave = (amplitude) => ({ amplitude, speed: (Math.PI * 2) / rnd.float(9, 18), phase: rnd.float(0, Math.PI * 2) });
  const drift = { x: [wave(0.07), wave(0.035)], y: [wave(0.07), wave(0.035)] };
  let at = 0;
  let from = point();
  const moves = [];
  while (at < durationMs / 1000 + 10) {
    at += rnd.float(4, 8);
    let to;
    do to = point(); while (Math.hypot(to.x - from.x, to.y - from.y) < 0.3);
    const duration = Math.min(4.5, Math.max(2.2, Math.hypot(to.x - from.x, to.y - from.y) / GLIDE_SPEED));
    moves.push({ start: at, end: at + duration, from, to });
    at += duration;
    from = to;
  }
  return { origin: moves[0].from, moves, drift };
}
// Eases in softly and spends longer easing out: the progress is skewed so the midpoint comes at ~42% of the glide.
function glideEase(progress) { return (1 - Math.cos(Math.PI * progress ** 0.8)) / 2; }
function targetAt(path, time) {
  let base = path.origin;
  for (const move of path.moves) {
    if (time < move.start) break;
    if (time >= move.end) { base = move.to; continue; }
    const eased = glideEase((time - move.start) / (move.end - move.start));
    base = { x: move.from.x + (move.to.x - move.from.x) * eased, y: move.from.y + (move.to.y - move.from.y) * eased };
    break;
  }
  const sway = (waves) => waves.reduce((sum, w) => sum + w.amplitude * Math.sin(w.speed * time + w.phase), 0);
  return { x: base.x + sway(path.drift.x), y: base.y + sway(path.drift.y) };
}

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

export function TrackingModule({ rects, runtime, color, maxSpeed = 0.55, compact = false }) {
  const path = useMemo(() => buildPath(runtime.seed, runtime.durationMs), [runtime.seed, runtime.durationMs]);
  const knobX = useSharedValue(0);
  const knobY = useSharedValue(0);
  const target = useSharedValue(targetAt(path, 0));
  const reticle = useSharedValue({ x: 0, y: 0 });
  const sim = useRef({ steps: 0, x: 0, y: 0, vx: 0, vy: 0 });
  const stats = useRef({ locked: 0, samples: 0, distance: 0 });
  const running = runtime.status === "running";
  const scope = rects.scope;
  const radius = Math.min(scope.width, scope.height) / 2 - 16;
  const center = { x: scope.width / 2, y: scope.height / 2 + 6 };

  useEffect(() => runtime.register(() => {
    const { locked, samples, distance } = stats.current;
    const share = samples ? locked / samples : 0;
    return { performance: share, detail: `On target ${Math.round(share * 100)}% of the time${samples ? ` · ${Math.round((distance / samples) * 100)}% avg offset` : ""}` };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fixed-step simulation on the mission clock (so it freezes during a pause); the joystick is read from its
  // shared values, and only shared values are written, so nothing re-renders while tracking.
  useEffect(() => {
    if (!running) { knobX.value = 0; knobY.value = 0; return undefined; }
    const state = sim.current;
    const timer = setInterval(() => {
      const now = runtime.elapsed() / 1000;
      const due = Math.floor(now / STEP_S);
      const stickX = knobX.value;
      const stickY = -knobY.value;
      const pull = STEP_S / INERTIA_S;
      while (state.steps < due) {
        // The velocity chases the speed the stick asks for; at the rim the crosshair stops dead on that axis.
        state.vx += (stickX * maxSpeed - state.vx) * pull;
        state.vy += (stickY * maxSpeed - state.vy) * pull;
        state.x += state.vx * STEP_S;
        state.y += state.vy * STEP_S;
        if (Math.abs(state.x) > 1) { state.x = Math.sign(state.x); state.vx = 0; }
        if (Math.abs(state.y) > 1) { state.y = Math.sign(state.y); state.vy = 0; }
        const aim = targetAt(path, state.steps * STEP_S);
        const distance = Math.hypot(state.x - aim.x, state.y - aim.y);
        stats.current.samples += 1;
        stats.current.distance += Math.min(1, distance);
        if (distance <= LOCK_RADIUS) stats.current.locked += 1;
        state.steps += 1;
      }
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

const trackingBase = {
  competence: "multitasking",
  secondary: ["spatial"],
  task: "continuous",
  voice: false,
  rule: "A target drifts slowly on the scope and every few seconds glides to a new spot. Your crosshair is heavy: it takes a moment to get going and keeps coasting when you let go. Keep it inside the target circle. The light turns green while you are on target.",
  recap: "keep the target in your crosshair",
  Component: TrackingModule,
};

export const trackingModule = {
  ...trackingBase,
  id: "tracking",
  title: "Target tracking",
  load: 4,
  blocks: [{ key: "scope", role: "display", h: 4, w: 4 }, { key: "stick", role: "control", h: 2, w: 2, use: "frequent" }],
};

export const trackingMiniModule = {
  ...trackingBase,
  id: "tracking-mini",
  title: "Target tracking (compact)",
  load: 3,
  Component: (props) => <TrackingModule {...props} maxSpeed={0.33} compact />,
  blocks: [{ key: "scope", role: "display", h: 2, w: 2 }, { key: "stick", role: "control", h: 2, w: 2, use: "frequent" }],
};

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
