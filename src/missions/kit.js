import { StyleSheet, Text } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import Animated, { interpolateColor, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { SPACE_CADET } from "../theme/spaceCadet";
import { BLOCK_RADIUS } from "./layout";

export const SUCCESS = "#34D399";
export const ERROR = SPACE_CADET.attention;

// Hex colour → rgba string, for tinted surfaces and borders derived from a competence colour.
export function tint(hex, alpha) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

// Every block of a module shares its competence colour as a hairline border. A block may carry a status light
// in its top-right corner (e.g. green while the aircraft is inside its band).
export function ModuleBlock({ rect, color, flash = null, led = null, style, children }) {
  return <Animated.View style={[styles.block, { left: rect.x, top: rect.y, width: rect.width, height: rect.height, borderColor: tint(color, 0.38) }, flash, style]}>
    {children}
    {led ? <Animated.View style={[styles.led, led]} /> : null}
  </Animated.View>;
}

export const LED_IDLE = "rgba(255,255,255,0.14)";

export function BlockKicker({ color, children, style }) {
  return <Text style={[styles.kicker, { color }, style]}>{children}</Text>;
}

// A brief border flash (green/red) on a block, for answer feedback.
export function useFeedbackFlash(color) {
  const level = useSharedValue(0);
  const tone = useSharedValue(0);
  const base = tint(color, 0.38);
  const style = useAnimatedStyle(() => ({ borderColor: interpolateColor(level.value, [0, 1], [base, tone.value === 1 ? SUCCESS : ERROR]) }));
  function flash(success) {
    tone.value = success ? 1 : 0;
    level.value = 1;
    level.value = withTiming(0, { duration: 520 });
  }
  return { style, flash };
}

// Press-and-hold that works everywhere (react-native-web never fires onPressIn in this app): a zero-distance pan
// reports the start and the end of the touch.
export function holdGesture(onChange, pressed) {
  return Gesture.Pan()
    .minDistance(0)
    .onBegin(() => { pressed.value = 1; runOnJS(onChange)(true); })
    .onFinalize(() => { pressed.value = 0; runOnJS(onChange)(false); });
}

export function formatClock(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  block: { position: "absolute", borderRadius: BLOCK_RADIUS, borderWidth: 1, backgroundColor: SPACE_CADET.surface1, overflow: "hidden" },
  led: { position: "absolute", top: 14, right: 14, width: 7, height: 7, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.14)" },
  kicker: { fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.5 },
});
