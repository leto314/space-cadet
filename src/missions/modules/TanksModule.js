import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Path, Text as SvgText } from "react-native-svg";

import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerSelectionHaptic } from "../../utils/haptics";
import { createRandom, randomTools } from "../../utils/random";
import { BlockKicker, ERROR, ModuleBlock, tint } from "../kit";

const STEP_S = 1 / 30;
const FLOW = 0.009;
const BAND_HALF = [0.08, 0.08, 0.1];
const BAND_MOVE_S = 2;
// Valves, as [from, to] tank indexes.
const VALVES = [[0, 1], [1, 0], [0, 2], [2, 1]];
const AnimatedPath = Animated.createAnimatedComponent(Path);

// A "glance at it now and then" task, tuned by simulation: a player checking every 20 s keeps ~65 % of the time
// in range, every 10 s ~80 %, every 3 s ~87 %. Tank 1 fills while tanks 2 and 3 drain very slowly, at rates that
// drift every 20–30 s but balance out on average; tank 3's band shifts every 60–80 s.
function buildPlan(seed, durationMs) {
  const rnd = randomTools(createRandom(seed));
  const seconds = durationMs / 1000;
  const phases = [];
  for (let at = 0; at < seconds; at += rnd.float(20, 30)) {
    const drainTwo = rnd.float(0.0015, 0.003);
    const drainThree = rnd.float(0.0006, 0.0015);
    phases.push({ at, drainTwo, drainThree, inflow: (drainTwo + drainThree) * rnd.float(0.8, 1.25) });
  }
  const bandThree = [{ at: 0, center: rnd.float(0.4, 0.6) }];
  for (let at = rnd.float(60, 80); at < seconds - 15; at += rnd.float(60, 80)) {
    let center;
    do center = rnd.float(0.3, 0.7); while (Math.abs(center - bandThree.at(-1).center) < 0.15 || Math.abs(center - bandThree.at(-1).center) > 0.25);
    bandThree.push({ at, center });
  }
  const one = rnd.float(0.55, 0.72);
  const two = rnd.float(0.45, 0.62);
  return { phases, bandThree, fixed: [one, two], start: [one, two, bandThree[0].center] };
}

function PipeNumber({ x, y, number, color }) {
  return <SvgText x={x} y={y} fill={color} fontSize="11" fontFamily="Garet-Book" textAnchor="middle">{number}</SvgText>;
}

function Arrow({ x, y, direction, color }) {
  const d = { right: `M${x - 5} ${y - 4} L${x} ${y} L${x - 5} ${y + 4}`, left: `M${x + 5} ${y - 4} L${x} ${y} L${x + 5} ${y + 4}`, down: `M${x - 4} ${y - 5} L${x} ${y} L${x + 4} ${y - 5}` }[direction];
  return <Path d={d} stroke={color} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
}

// A pipe is a dim line; when its valve is open a dashed copy in the module colour scrolls towards the destination.
function Pipe({ d, open, color, flow, arrow, label, number }) {
  const props = useAnimatedProps(() => ({ strokeDashoffset: flow.value }));
  return <>
    <PipeNumber {...label} number={number} color={open ? color : SPACE_CADET.textSecondary} />
    <Path d={d} stroke={SPACE_CADET.borderDefault} strokeWidth={2} fill="none" strokeLinejoin="round" />
    {open ? <AnimatedPath d={d} stroke={color} strokeWidth={2} fill="none" strokeDasharray="5 5" strokeLinejoin="round" animatedProps={props} /> : null}
    <Arrow {...arrow} color={open ? color : SPACE_CADET.textTertiary} />
  </>;
}

function Tank({ index, x, top, width, height, level, low, high, color, showNumber }) {
  const liquidStyle = useAnimatedStyle(() => ({ height: level.value * height }));
  const bandStyle = useAnimatedStyle(() => ({ top: (1 - high.value) * height, height: (high.value - low.value) * height }));
  const inside = tint(color, 0.5);
  const shellStyle = useAnimatedStyle(() => ({ borderColor: level.value >= low.value && level.value <= high.value ? inside : ERROR }));
  return <Animated.View style={[styles.tank, { left: x - width / 2, top, width, height }, shellStyle]}>
    <Animated.View style={[styles.band, bandStyle]} />
    <Animated.View style={[styles.liquid, { backgroundColor: tint(color, 0.32), borderTopColor: color }, liquidStyle]} />
    {showNumber ? <Text style={styles.tankLabel}>{index + 1}</Text> : null}
  </Animated.View>;
}

export function TanksModule({ rects, runtime, color }) {
  const plan = useMemo(() => buildPlan(runtime.seed, runtime.durationMs), [runtime.seed, runtime.durationMs]);
  const levels = [useSharedValue(plan.start[0]), useSharedValue(plan.start[1]), useSharedValue(plan.start[2])];
  const lows = [useSharedValue(plan.fixed[0] - BAND_HALF[0]), useSharedValue(plan.fixed[1] - BAND_HALF[1]), useSharedValue(plan.start[2] - BAND_HALF[2])];
  const highs = [useSharedValue(plan.fixed[0] + BAND_HALF[0]), useSharedValue(plan.fixed[1] + BAND_HALF[1]), useSharedValue(plan.start[2] + BAND_HALF[2])];
  const flow = useSharedValue(0);
  const [open, setOpen] = useState([false, false, false, false]);
  const openRef = useRef(open);
  const stats = useRef({ inBand: [0, 0, 0], samples: 0 });
  // Simulation state lives in a ref so a pause resumes exactly where it stopped.
  const sim = useRef({ steps: 0, levels: [...plan.start], phase: 0, shift: 0, bandFrom: plan.start[2], center: plan.start[2] });
  const running = runtime.status === "running";
  const display = rects.display;

  useEffect(() => runtime.register(() => {
    const { inBand, samples } = stats.current;
    const shares = inBand.map((count) => (samples ? count / samples : 0));
    return { performance: shares.reduce((sum, value) => sum + value, 0) / 3, detail: `In range ${shares.map((share) => `${Math.round(share * 100)}%`).join(" · ")}` };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running) { cancelAnimation(flow); return undefined; }
    flow.value = 0;
    flow.value = withRepeat(withTiming(-20, { duration: 900, easing: Easing.linear }), -1);
    const state = sim.current;
    const timer = setInterval(() => {
      const due = Math.floor(runtime.elapsed() / 1000 / STEP_S);
      while (state.steps < due) {
        const time = state.steps * STEP_S;
        while (state.phase + 1 < plan.phases.length && plan.phases[state.phase + 1].at <= time) state.phase += 1;
        if (state.shift + 1 < plan.bandThree.length && plan.bandThree[state.shift + 1].at <= time) { state.bandFrom = state.center; state.shift += 1; }
        const band = plan.bandThree[state.shift];
        const progress = state.shift === 0 ? 1 : Math.min(1, (time - band.at) / BAND_MOVE_S);
        state.center = state.bandFrom + (band.center - state.bandFrom) * progress;
        const { inflow, drainTwo, drainThree } = plan.phases[state.phase];
        const change = [inflow, -drainTwo, -drainThree];
        VALVES.forEach(([from, to], valve) => {
          if (openRef.current[valve] && state.levels[from] > 0 && state.levels[to] < 1) { change[from] -= FLOW; change[to] += FLOW; }
        });
        state.levels = state.levels.map((value, tank) => Math.min(1, Math.max(0, value + change[tank] * STEP_S)));
        const bands = [[plan.fixed[0] - BAND_HALF[0], plan.fixed[0] + BAND_HALF[0]], [plan.fixed[1] - BAND_HALF[1], plan.fixed[1] + BAND_HALF[1]], [state.center - BAND_HALF[2], state.center + BAND_HALF[2]]];
        state.levels.forEach((value, tank) => { if (value >= bands[tank][0] && value <= bands[tank][1]) stats.current.inBand[tank] += 1; });
        stats.current.samples += 1;
        state.steps += 1;
      }
      state.levels.forEach((value, tank) => { levels[tank].value = value; });
      lows[2].value = state.center - BAND_HALF[2];
      highs[2].value = state.center + BAND_HALF[2];
    }, 33);
    return () => clearInterval(timer);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(valve) {
    if (!running) return;
    void triggerSelectionHaptic();
    const next = openRef.current.map((value, index) => (index === valve ? !value : value));
    openRef.current = next;
    setOpen(next);
  }

  // Tanks 1-2-3 left to right; 1↔2 and 3→2 run between neighbours, 1→3 arches over tank 2.
  const tankWidth = Math.min(58, display.width * 0.16);
  const tankTop = 44;
  const tankHeight = display.height - tankTop - 16;
  const xs = [display.width * 0.22, display.width * 0.5, display.width * 0.78];
  const edge = (tank, side) => xs[tank] + (side === "right" ? tankWidth / 2 : -tankWidth / 2);
  const at = (share) => tankTop + tankHeight * share;
  // Each pipe carries the number of the button that opens it.
  const between = (a, b) => (edge(a, "right") + edge(b, "left")) / 2;
  const pipes = [
    { d: `M${edge(0, "right")} ${at(0.3)} H${edge(1, "left")}`, arrow: { x: edge(1, "left") - 2, y: at(0.3), direction: "right" }, label: { x: between(0, 1), y: at(0.3) - 6 } },
    { d: `M${edge(1, "left")} ${at(0.62)} H${edge(0, "right")}`, arrow: { x: edge(0, "right") + 2, y: at(0.62), direction: "left" }, label: { x: between(0, 1), y: at(0.62) - 6 } },
    { d: `M${xs[0]} ${tankTop} V28 H${xs[2]} V${tankTop}`, arrow: { x: xs[2], y: tankTop - 2, direction: "down" }, label: { x: xs[1], y: 23 } },
    { d: `M${edge(2, "left")} ${at(0.46)} H${edge(1, "right")}`, arrow: { x: edge(1, "right") + 2, y: at(0.46), direction: "left" }, label: { x: between(1, 2), y: at(0.46) - 6 } },
  ];
  const inlet = `M${edge(0, "left") - 18} ${at(0.14)} H${edge(0, "left")}`;
  const outlet = `M${edge(1, "right")} ${at(0.86)} H${edge(1, "right") + 18}`;
  const outletThree = `M${edge(2, "right")} ${at(0.86)} H${edge(2, "right") + 18}`;
  const alwaysProps = useAnimatedProps(() => ({ strokeDashoffset: flow.value }));
  const alwaysOutProps = useAnimatedProps(() => ({ strokeDashoffset: flow.value }));
  const alwaysOutThreeProps = useAnimatedProps(() => ({ strokeDashoffset: flow.value }));

  return <>
    <ModuleBlock rect={display} color={color}>
      <BlockKicker color={color} style={styles.kicker}>TANKS</BlockKicker>
      <Svg width={display.width} height={display.height} style={StyleSheet.absoluteFill}>
        {pipes.map((pipe, valve) => <Pipe key={valve} {...pipe} number={valve + 1} open={open[valve]} color={color} flow={flow} />)}
        <AnimatedPath d={inlet} stroke={tint(color, 0.55)} strokeWidth={2} strokeDasharray="3 4" fill="none" animatedProps={alwaysProps} />
        <AnimatedPath d={outlet} stroke={tint(color, 0.55)} strokeWidth={2} strokeDasharray="3 4" fill="none" animatedProps={alwaysOutProps} />
        <AnimatedPath d={outletThree} stroke={tint(color, 0.55)} strokeWidth={2} strokeDasharray="3 4" fill="none" animatedProps={alwaysOutThreeProps} />
      </Svg>
      {[0, 1, 2].map((tank) => <Tank key={tank} index={tank} x={xs[tank]} top={tankTop} width={tankWidth} height={tankHeight} level={levels[tank]} low={lows[tank]} high={highs[tank]} color={color} showNumber={runtime.status === "idle"} />)}
    </ModuleBlock>
    <ModuleBlock rect={rects.valves} color={color} style={styles.valveBlock}>
      {[0, 1].map((row) => <View key={row} style={styles.valveRow}>
        {[0, 1].map((column) => {
          const valve = row * 2 + column;
          return <Pressable key={valve} disabled={!running} onPress={() => toggle(valve)} style={({ pressed }) => [styles.valve, open[valve] && { borderColor: color, backgroundColor: tint(color, 0.16), shadowColor: color, shadowOpacity: 0.4 }, pressed && styles.pressed]}>
            <Text style={[styles.valveNumber, { color: open[valve] ? color : SPACE_CADET.textSecondary }]}>{valve + 1}</Text>
          </Pressable>;
        })}
      </View>)}
    </ModuleBlock>
  </>;
}

export const tanksModule = {
  id: "tanks",
  title: "Tank balance",
  competence: "multitasking",
  secondary: ["logic"],
  task: "continuous",
  voice: false,
  load: 3,
  rule: "Keep every tank inside its white band. Buttons 1 to 4 open and close the pipes with the same number. Tank 1 slowly fills up, tanks 2 and 3 slowly empty, and tank 3's band shifts now and then. A glance every now and then is enough.",
  recap: "balance the tanks",
  blocks: [{ key: "display", role: "display", h: 2, w: 4 }, { key: "valves", role: "control", h: 2, w: 2 }],
  Component: TanksModule,
};

const styles = StyleSheet.create({
  kicker: { position: "absolute", top: 12, left: 14 },
  tank: { position: "absolute", borderWidth: 1, borderRadius: 10, overflow: "hidden", backgroundColor: SPACE_CADET.black },
  // Target band in white, so its edges never get confused with the (coloured) liquid surface.
  band: { position: "absolute", left: 0, right: 0, zIndex: 2, borderTopWidth: 1, borderBottomWidth: 1, borderColor: "rgba(255,255,255,0.7)", backgroundColor: "rgba(255,255,255,0.06)" },
  liquid: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopWidth: 1.5 },
  tankLabel: { position: "absolute", bottom: 4, left: 0, right: 0, textAlign: "center", color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 12, opacity: 0.8 },
  valveBlock: { padding: 10, gap: 8 },
  valveRow: { flex: 1, flexDirection: "row", gap: 8 },
  valve: { flex: 1, borderRadius: 14, borderWidth: 1, borderColor: SPACE_CADET.borderSubtle, alignItems: "center", justifyContent: "center", shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0 },
  valveNumber: { fontFamily: "Garet-Book", fontSize: 20 },
  pressed: { transform: [{ scale: 0.96 }] },
});
