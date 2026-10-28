// Target tracking: the logic. Pure JavaScript (no React): the two specs (full scope, compact scope), the
// target's path drawn from the seed, the crosshair physics and the scoring.

import { createRandom, randomTools } from "../../../utils/random.js";

const base = {
  competence: "multitasking",
  secondary: ["spatial"],
  task: "continuous",
  voice: false,
  family: "tracking",
  rule: "A target drifts slowly on the scope and every few seconds glides to a new spot. Your crosshair is heavy: it takes a moment to get going and keeps coasting when you let go. Keep it inside the target circle. The light turns green while you are on target.",
  recap: "keep the target in your crosshair",
};

export const trackingSpec = {
  ...base,
  id: "tracking",
  title: "Target tracking",
  load: 4,
  blocks: [{ key: "scope", role: "display", h: 4, w: 4 }, { key: "stick", role: "control", h: 2, w: 2, use: "frequent" }],
  options: { maxSpeed: 0.55, compact: false },
};

export const trackingMiniSpec = {
  ...base,
  id: "tracking-mini",
  title: "Target tracking (compact)",
  load: 3,
  blocks: [{ key: "scope", role: "display", h: 2, w: 2 }, { key: "stick", role: "control", h: 2, w: 2, use: "frequent" }],
  options: { maxSpeed: 0.33, compact: true },
};

export const STEP_S = 1 / 30;
export const LOCK_RADIUS = 0.2;
const GLIDE_SPEED = 0.2;
// The crosshair is heavy: its speed only catches up with the stick over ~0.7 s, and it keeps coasting after release.
const INERTIA_S = 0.7;

// The target never stands perfectly still: a slow seeded drift (two gentle waves per axis) runs all the time, and
// every 4–8 s it also glides to a new spot, starting gently and taking its time over the last stretch. Everything
// comes from the seed. Units: the scope has a radius of 1.
export function buildContent(spec, seed, { durationMs }) {
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
export function targetAt(path, time) {
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

export function initialState() { return { steps: 0, x: 0, y: 0, vx: 0, vy: 0 }; }

// One fixed step of the crosshair: its velocity chases the speed the stick asks for (stick in -1..1 per axis);
// at the rim it stops dead on that axis. Then a sample of whether it sits inside the target circle.
export function advance(state, path, stick, maxSpeed, stats) {
  const pull = STEP_S / INERTIA_S;
  state.vx += (stick.x * maxSpeed - state.vx) * pull;
  state.vy += (stick.y * maxSpeed - state.vy) * pull;
  state.x += state.vx * STEP_S;
  state.y += state.vy * STEP_S;
  if (Math.abs(state.x) > 1) { state.x = Math.sign(state.x); state.vx = 0; }
  if (Math.abs(state.y) > 1) { state.y = Math.sign(state.y); state.vy = 0; }
  const aim = targetAt(path, state.steps * STEP_S);
  const distance = Math.hypot(state.x - aim.x, state.y - aim.y);
  stats.samples += 1;
  stats.distance += Math.min(1, distance);
  if (distance <= LOCK_RADIUS) stats.locked += 1;
  state.steps += 1;
}

export function emptyStats() { return { locked: 0, samples: 0, distance: 0 }; }

// The share of the flight spent on target.
export function moduleResult(spec, stats) {
  const { locked, samples, distance } = stats;
  const share = samples > 0 ? Math.max(0, Math.min(1, locked / samples)) : 0;
  return { performance: share, detail: `On target ${Math.round(share * 100)}% of the time${samples > 0 ? ` · ${Math.round(Math.min(1, distance / samples) * 100)}% avg offset` : ""}` };
}

// The flight nobody tracked: the stick centred, the crosshair never leaves the middle of the scope.
export function idleStats(spec, path, { durationMs }) {
  const state = initialState();
  const stats = emptyStats();
  const steps = Math.floor(durationMs / 1000 / STEP_S);
  while (state.steps < steps) advance(state, path, { x: 0, y: 0 }, spec.options.maxSpeed, stats);
  return stats;
}
