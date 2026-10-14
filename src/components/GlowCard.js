import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { BlurMask, Canvas, LinearGradient, Oval, RadialGradient, Rect, RoundedRect, vec } from "@shopify/react-native-skia";
import { BlurView } from "expo-blur";
import { cancelAnimation, Easing, interpolateColor, useDerivedValue, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

// Every number below is read directly off the "Test Cartes" Figma file (GlowLab plugin), not estimated:
// each blob's cx/cy/rx/ry come from its exact layer bounding box (get_metadata), and each color comes from
// the actual exported SVG's gradient stop (src/assets/cards/layers/<card>/<layer>.svg). The three cards
// share one geometry template — only per-layer colors differ — confirmed by diffing the exported SVGs.
// Card-local units are Figma's own (a 378x231 frame); GlowCard scales everything from `width`.
const FRAME_W = 378;
const FRAME_H = 231;
const CENTER = { x: FRAME_W / 2, y: FRAME_H / 2 };
const OUTER_RADIUS = 37;
const BLACK_TOP = { y: -23.1, h: 120.12 };
const LOOP_MS = 4500;
const HUE_SHIFT_DEG = 16;

// Rotates a hex color's hue by `degrees` (HSL), so a pink can drift toward violet/red instead of anywhere on the wheel.
// Accepts an optional trailing 2-digit alpha (e.g. "#3BDDFFE6"), which is carried through unchanged.
function rotateHue(hex, degrees) {
  const alpha = hex.length > 7 ? hex.slice(7) : "";
  const n = parseInt(hex.slice(1, 7), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  h = ((h + degrees / 360) % 1 + 1) % 1;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let rr, gg, bb;
  if (s === 0) { rr = gg = bb = l; } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    rr = hue2rgb(p, q, h + 1 / 3); gg = hue2rgb(p, q, h); bb = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${toHex(rr)}${toHex(gg)}${toHex(bb)}${alpha}`.toUpperCase();
}

// Each blob drifts outward along the line from the card's center through its own resting position (so it
// eases toward the nearest corner/edge) and back — never past that line, so it can never wander somewhere new.
function withMotion(blobs) {
  return blobs.map((blob) => {
    const dist = Math.hypot(blob.cx - CENTER.x, blob.cy - CENTER.y) || 1;
    return { ...blob, dirX: (blob.cx - CENTER.x) / dist, dirY: (blob.cy - CENTER.y) / dist, amplitude: Math.min(blob.rx, blob.ry) * 0.18 };
  });
}

// blend: "screen" layers brighten where they overlap (mix-blend-mode: screen in Figma); the rest ("srcOver",
// Skia's default) is a plain layer, painted in the same order Figma lists them. `phase` staggers each blob's
// position (and hue drift) in the shared loop so they don't all move in lockstep.
const BLOBS = withMotion([
  { key: "violetLowerHaze", cx: 264.597, cy: 231.0, rx: 455.694, ry: 139.24, blur: 8.25, blend: "screen", phase: 0 },
  { key: "magentaBloom", cx: 170.1, cy: 231.0, rx: 288.606, ry: 134.598, blur: 8.25, phase: 1 / 6 },
  { key: "violetRight", cx: 385.557, cy: 219.45, rx: 212.657, ry: 139.24, blur: 8.25, phase: 2 / 6 },
  { key: "coralLeft", cx: 0.002, cy: 244.86, rx: 189.872, ry: 106.75, blur: 8.25, blend: "screen", phase: 3 / 6 },
  { key: "pinkCore", cx: 189.002, cy: 244.8625, rx: 189.872, ry: 78.9025, blur: 8.25, blend: "screen", phase: 4 / 6 },
  { key: "paleCore", cx: 219.238, cy: 258.7246, rx: 151.898, ry: 51.0546, blur: 8.25, blend: "screen", phase: 5 / 6 },
]);

function withHueDrift(colors) {
  return Object.fromEntries(Object.entries(colors).map(([key, hex]) => [key, { a: hex, b: rotateHue(hex, HUE_SHIFT_DEG) }]));
}

function withGlow(glow) {
  return { ...glow, colors: withHueDrift(glow.colors) };
}

export const CARD_GLOWS = {
  training: withGlow({
    base: ["#1E0B1B", "#170D12"], blackTop: "#0B0910",
    colors: { violetLowerHaze: "#5A3BFF", magentaBloom: "#E0248A", violetRight: "#5A3BFF", coralLeft: "#FF5A3C", pinkCore: "#EE7DBA", paleCore: "#FFE9F4" },
  }),
  missions: withGlow({
    base: ["#0E1323", "#0E1516"], blackTop: "#0B0910",
    colors: { violetLowerHaze: "#3217CF", magentaBloom: "#2978E0", violetRight: "#3217CF", coralLeft: "#3DFF87", pinkCore: "#89ABE9", paleCore: "#FFE9F4" },
  }),
  // "new_bg" — the cooler blue/violet palette from Figma, on the same shared BLOBS template as the other two.
  clearance: withGlow({
    base: ["#150B23", "#170C1A"], blackTop: "#0B0910",
    colors: {
      violetLowerHaze: "#5CB8FFE6", magentaBloom: "#7C24E0", violetRight: "#5CB8FF",
      coralLeft: "#FF3CDE", pinkCore: "#B77DE9", paleCore: "#FFE9F4",
    },
  }),
};

function Blob({ blob, scale, color, clock }) {
  const cx0 = blob.cx * scale, cy0 = blob.cy * scale, rx = blob.rx * scale, ry = blob.ry * scale;
  const amplitude = blob.amplitude * scale;

  const rect = useDerivedValue(() => {
    const wobble = Math.sin((clock.value + blob.phase) * Math.PI * 2) * amplitude;
    return { x: cx0 + blob.dirX * wobble - rx, y: cy0 + blob.dirY * wobble - ry, width: rx * 2, height: ry * 2 };
  });
  const transform = useDerivedValue(() => {
    const wobble = Math.sin((clock.value + blob.phase) * Math.PI * 2) * amplitude;
    return [{ translateX: cx0 + blob.dirX * wobble }, { translateY: cy0 + blob.dirY * wobble }, { scaleX: rx }, { scaleY: ry }];
  });
  const colors = useDerivedValue(() => {
    const mix = (1 + Math.sin((clock.value + blob.phase) * Math.PI * 2)) / 2;
    return [interpolateColor(mix, [0, 1], [color.a, color.b], "HSV"), "transparent"];
  });

  return <Oval rect={rect} blendMode={blob.blend}>
    <RadialGradient c={vec(0, 0)} r={1} colors={colors} origin={vec(0, 0)} transform={transform} />
    <BlurMask blur={blob.blur * scale} style="normal" />
  </Oval>;
}

export function GlowCard({ width, glow, animate = true, style, children }) {
  const scale = width / FRAME_W;
  const height = Math.round(FRAME_H * scale);
  const radius = OUTER_RADIUS * scale;
  const blackTopBottom = (BLACK_TOP.y + BLACK_TOP.h) * scale;
  // The rim stroke + its blur need real clearance from the native view's own rounded clip, or the blur's outer
  // half gets clipped unevenly and the corners (where the clip curves tightest) look like they cut out.
  const rimInset = 3;

  const clock = useSharedValue(0);
  useEffect(() => {
    // Animating 6 blurred, screen-blended shapes per card is real GPU work — only the on-screen card should pay
    // for it. Restarting from `clock.value + 1` (a whole loop later) is a no-op on the sine math, so resuming
    // never jumps.
    if (animate) clock.value = withRepeat(withTiming(clock.value + 1, { duration: LOOP_MS, easing: Easing.linear }), -1, false);
    else cancelAnimation(clock);
  }, [animate, clock]);

  return <View style={[styles.card, { width, height, borderRadius: radius }, style]}>
    <Canvas style={StyleSheet.absoluteFill}>
      <Rect x={0} y={0} width={width} height={height}><LinearGradient start={vec(0, 0)} end={vec(0, height)} colors={glow.base} /></Rect>
      <Rect x={0} y={0} width={width} height={blackTopBottom}><LinearGradient start={vec(0, BLACK_TOP.y * scale)} end={vec(0, blackTopBottom)} colors={[glow.blackTop, "transparent"]} /></Rect>
      {BLOBS.map((blob) => <Blob key={blob.key} blob={blob} scale={scale} color={glow.colors[blob.key]} clock={clock} />)}
      <Rect x={0} y={0} width={width} height={height} color="rgba(0,0,0,0.16)" />
      <RoundedRect x={rimInset} y={rimInset} width={width - rimInset * 2} height={height - rimInset * 2} r={radius - rimInset} style="stroke" strokeWidth={1.5} color="rgba(255,255,255,0.18)"><BlurMask blur={1} style="solid" /></RoundedRect>
    </Canvas>
    {/* Figma's "au dessus" layer: a real backdrop blur over the glow, not just a tint, so the gradient reads as frosted glass. */}
    <BlurView pointerEvents="none" intensity={18} tint="dark" style={[styles.glass, { borderRadius: radius }]} />
    {children}
  </View>;
}

const styles = StyleSheet.create({
  card: { overflow: "hidden" },
  glass: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(255,255,255,0.02)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(150,150,150,0.3)" },
});
