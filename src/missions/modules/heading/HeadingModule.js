import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";

import { SPACE_CADET } from "../../../theme/spaceCadet";
import { triggerSelectionHaptic, triggerSuccessHaptic } from "../../../utils/haptics";
import { BlockKicker, holdGesture, LED_IDLE, ModuleBlock, tint, useFeedbackFlash } from "../../kit";
import { buildContent, CARDINALS, emptyStats, gap, headingSpec, moduleResult, pad, resolveOrder, SETTLE_MS, TURN_RATE, WINDOW_MS, wrap } from "./logic";

function Chevron({ left }) {
  return <Svg width="26" height="26" viewBox="0 0 24 24"><Path d={left ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} stroke={SPACE_CADET.white} strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}

function TurnButton({ left, color, onHold }) {
  const pressed = useSharedValue(0);
  const pressedColor = tint(color, 0.2);
  const gesture = useMemo(() => holdGesture(onHold, pressed), []); // eslint-disable-line react-hooks/exhaustive-deps
  const style = useAnimatedStyle(() => ({ backgroundColor: pressed.value ? pressedColor : "transparent" }));
  return <GestureDetector gesture={gesture}><Animated.View style={[styles.turnZone, style]}><Chevron left={left} /></Animated.View></GestureDetector>;
}

function CompassRose({ size, color, beacon }) {
  const radius = size / 2 - 4;
  const center = size / 2;
  const point = (bearing, distance) => {
    const angle = ((bearing - 90) * Math.PI) / 180;
    return { x: center + distance * Math.cos(angle), y: center + distance * Math.sin(angle) };
  };
  const beaconPoint = beacon === null ? null : point(beacon, radius * 0.8);
  return <Svg width={size} height={size}>
    <Circle cx={center} cy={center} r={radius} stroke={SPACE_CADET.borderDefault} strokeWidth={1} fill="none" />
    {Array.from({ length: 36 }, (_, index) => {
      const major = index % 3 === 0;
      const outer = point(index * 10, radius);
      const inner = point(index * 10, radius - (major ? 8 : 4));
      return <Line key={index} x1={outer.x} y1={outer.y} x2={inner.x} y2={inner.y} stroke={SPACE_CADET.white} strokeOpacity={major ? 0.4 : 0.18} strokeWidth={1} />;
    })}
    {CARDINALS.map(([name, bearing]) => {
      const label = point(bearing, radius - 17);
      return <SvgText key={name} x={label.x} y={label.y + 4} fill={name === "NORTH" ? color : SPACE_CADET.textSecondary} fontSize="11" fontFamily="Gontserrat-SemiBold" textAnchor="middle">{name[0]}</SvgText>;
    })}
    {beaconPoint ? <>
      <Circle cx={beaconPoint.x} cy={beaconPoint.y} r={9} fill={tint(color, 0.18)} />
      <Circle cx={beaconPoint.x} cy={beaconPoint.y} r={4.5} fill={color} />
    </> : null}
  </Svg>;
}

export function HeadingModule({ rects, runtime, color }) {
  const context = { durationMs: runtime.durationMs };
  const orders = useMemo(() => buildContent(headingSpec, runtime.seed, context), [runtime.seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const [order, setOrder] = useState(null);
  const [beacon, setBeacon] = useState(orders[0].beacon);
  const heading = useSharedValue(0);
  const pulse = useSharedValue(1);
  const state = useRef({ heading: 0, turning: 0, lastTick: null, orderIndex: 0, active: null, onTargetSince: null, nextAt: 3000 });
  const stats = useRef(emptyStats(headingSpec));
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";
  const compass = rects.compass;
  const roseSize = Math.min(compass.width, compass.height) - 46;

  useEffect(() => runtime.register(() => moduleResult(headingSpec, stats.current, context)), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running) return undefined;
    const current = state.current;
    current.lastTick = runtime.elapsed();
    const timer = setInterval(() => {
      const now = runtime.elapsed();
      current.heading = wrap(current.heading + current.turning * TURN_RATE * (now - current.lastTick) / 1000);
      current.lastTick = now;
      heading.value = current.heading;
      if (!current.active && now >= current.nextAt && current.orderIndex < orders.length) {
        const resolved = resolveOrder(orders[current.orderIndex], current.heading);
        current.active = { ...resolved, issuedAt: now, moved: false, lastInput: now };
        setOrder(resolved);
        setBeacon(resolved.beacon);
        void triggerSelectionHaptic();
      }
      const active = current.active;
      if (!active) return;
      // No "on target" signal (it would let the player sweep until it lights up): the heading locks once the
      // player has turned and then left the controls alone for a moment, or when the order times out.
      if (current.turning) { active.moved = true; active.lastInput = now; }
      else if (active.moved && now - active.lastInput >= SETTLE_MS) settle(now);
      if (current.active && now - active.issuedAt > WINDOW_MS) settle(now);
    }, 33);
    return () => { clearInterval(timer); current.turning = 0; };
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  function settle(now) {
    const current = state.current;
    const error = gap(current.heading, current.active.target);
    stats.current.outcomes.push({ error, timeMs: now - current.active.issuedAt });
    current.nextAt = now + orders[current.orderIndex].pause;
    current.orderIndex += 1;
    current.active = null;
    setOrder(null);
    const good = error <= 10;
    feedback.flash(good);
    if (good) void triggerSuccessHaptic();
  }

  useEffect(() => {
    if (order) pulse.value = withRepeat(withSequence(withTiming(0.25, { duration: 520, easing: Easing.inOut(Easing.quad) }), withTiming(1, { duration: 520, easing: Easing.inOut(Easing.quad) })), -1);
    else { cancelAnimation(pulse); pulse.value = 1; }
  }, [order]); // eslint-disable-line react-hooks/exhaustive-deps
  const ledColor = order ? color : LED_IDLE;
  const ledStyle = useAnimatedStyle(() => ({ backgroundColor: ledColor, opacity: pulse.value }));
  const planeStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${heading.value}deg` }] }));
  const [readout, setReadout] = useState("000");
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setReadout(pad(state.current.heading)), 120);
    return () => clearInterval(timer);
  }, [running]);

  function turn(direction, active) {
    const current = state.current;
    current.heading = wrap(current.heading + current.turning * TURN_RATE * (runtime.elapsed() - (current.lastTick ?? runtime.elapsed())) / 1000);
    current.lastTick = runtime.elapsed();
    current.turning = active ? direction : current.turning === direction ? 0 : current.turning;
    if (active) void triggerSelectionHaptic();
  }

  return <>
    <ModuleBlock rect={compass} color={color} led={ledStyle} flash={feedback.style}>
      <View style={styles.header}><BlockKicker color={color}>HDG</BlockKicker><Text style={styles.readout}>{readout}°</Text></View>
      <View style={styles.roseWrap}>
        <CompassRose size={roseSize} color={color} beacon={beacon} />
        <Animated.View style={[styles.plane, planeStyle]}>
          <Svg width="30" height="30" viewBox="0 0 30 30"><Path d="M15 3 L20 25 L15 21 L10 25 Z" fill={SPACE_CADET.white} /></Svg>
        </Animated.View>
      </View>
    </ModuleBlock>
    <ModuleBlock rect={rects.control} color={color}>
      <View style={styles.orderArea}>
        <BlockKicker color={SPACE_CADET.textTertiary}>ORDER</BlockKicker>
        <Text numberOfLines={2} adjustsFontSizeToFit style={[styles.order, !order && styles.orderIdle]}>{order ? order.text : "STAND BY"}</Text>
      </View>
      <View style={[styles.divider, { backgroundColor: tint(color, 0.25) }]} />
      <View style={styles.turnRow}>
        <TurnButton left color={color} onHold={(active) => turn(-1, active)} />
        <View style={[styles.verticalDivider, { backgroundColor: tint(color, 0.25) }]} />
        <TurnButton left={false} color={color} onHold={(active) => turn(1, active)} />
      </View>
    </ModuleBlock>
  </>;
}

export const headingModule = { ...headingSpec, Component: HeadingModule };

const styles = StyleSheet.create({
  header: { position: "absolute", top: 12, left: 14, flexDirection: "row", alignItems: "center", gap: 8 },
  roseWrap: { flex: 1, alignItems: "center", justifyContent: "center", marginTop: 18 },
  plane: { position: "absolute", width: 30, height: 30 },
  readout: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 12 },
  orderArea: { flex: 1, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 },
  order: { color: SPACE_CADET.white, fontFamily: "Gontserrat-SemiBold", fontSize: 13, letterSpacing: 0.8, lineHeight: 18, marginTop: 6 },
  orderIdle: { color: SPACE_CADET.textTertiary },
  divider: { height: 1, marginHorizontal: 14 },
  turnRow: { flex: 1, flexDirection: "row" },
  turnZone: { flex: 1, alignItems: "center", justifyContent: "center" },
  verticalDivider: { width: 1, marginVertical: 12 },
});
