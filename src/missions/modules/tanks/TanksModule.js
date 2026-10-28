import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Path, Text as SvgText } from "react-native-svg";

import { SPACE_CADET } from "../../../theme/spaceCadet";
import { triggerSelectionHaptic } from "../../../utils/haptics";
import { BlockKicker, ERROR, ModuleBlock, tint } from "../../kit";
import { advance, BAND_HALF, buildContent, emptyStats, initialState, moduleResult, STEP_S, tanksSpec } from "./logic";

const AnimatedPath = Animated.createAnimatedComponent(Path);

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
  const context = { durationMs: runtime.durationMs };
  const plan = useMemo(() => buildContent(tanksSpec, runtime.seed, context), [runtime.seed, runtime.durationMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const levels = [useSharedValue(plan.start[0]), useSharedValue(plan.start[1]), useSharedValue(plan.start[2])];
  const lows = [useSharedValue(plan.fixed[0] - BAND_HALF[0]), useSharedValue(plan.fixed[1] - BAND_HALF[1]), useSharedValue(plan.start[2] - BAND_HALF[2])];
  const highs = [useSharedValue(plan.fixed[0] + BAND_HALF[0]), useSharedValue(plan.fixed[1] + BAND_HALF[1]), useSharedValue(plan.start[2] + BAND_HALF[2])];
  const flow = useSharedValue(0);
  const [open, setOpen] = useState([false, false, false, false]);
  const openRef = useRef(open);
  const stats = useRef(emptyStats(tanksSpec));
  // Simulation state lives in a ref so a pause resumes exactly where it stopped.
  const sim = useRef(initialState(plan));
  const running = runtime.status === "running";
  const display = rects.display;

  useEffect(() => runtime.register(() => moduleResult(tanksSpec, stats.current, context)), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running) { cancelAnimation(flow); return undefined; }
    flow.value = 0;
    flow.value = withRepeat(withTiming(-20, { duration: 900, easing: Easing.linear }), -1);
    const state = sim.current;
    const timer = setInterval(() => {
      const due = Math.floor(runtime.elapsed() / 1000 / STEP_S);
      while (state.steps < due) advance(state, plan, openRef.current, stats.current);
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

export const tanksModule = { ...tanksSpec, Component: TanksModule };

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
