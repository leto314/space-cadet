// Shared helpers for the game logic tests (scripts/games/*.test.mjs). Plain Node, no package to install.

import assert from "node:assert/strict";
import { createRandom, randomTools } from "../../src/utils/random.js";

// Seeds used by every determinism test: a few small ones, a few large ones.
export const SEEDS = [1, 2, 7, 42, 1234, 123456, 987654321, 4294967295];

export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A daily score must be an integer from 0 to 1000.
export function assertScore(result, label = "score") {
  assert.ok(Number.isInteger(result.score), `${label}: score ${result.score} is not an integer`);
  assert.ok(result.score >= 0 && result.score <= 1000, `${label}: score ${result.score} is out of 0-1000`);
  assert.ok(result.metrics && typeof result.metrics === "object", `${label}: metrics missing`);
}

// A seeded fuzzer: `count` random objects whose fields are drawn in the given ranges, plus the corner cases
// (every field at its minimum, every field at its maximum). Ranges are [min, max] integers.
export function fuzz(ranges, count, seed = 99) {
  const rnd = randomTools(createRandom(seed));
  const entries = Object.entries(ranges);
  const cases = [Object.fromEntries(entries.map(([key, [min]]) => [key, min])), Object.fromEntries(entries.map(([key, [, max]]) => [key, max]))];
  for (let index = 0; index < count; index += 1) cases.push(Object.fromEntries(entries.map(([key, [min, max]]) => [key, rnd.int(min, max)])));
  return cases;
}
