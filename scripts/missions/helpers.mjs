// Shared helpers for the mission logic tests (scripts/missions/*.test.mjs). Plain Node, no package to install.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { createRandom, randomTools } from "../../src/utils/random.js";

// The seeds, the deep comparison and the fuzzer are the same as the game tests'.
export { SEEDS, same, fuzz } from "../games/helpers.mjs";

const root = (path) => new URL(`../../${path}`, import.meta.url);

export const sourceOf = (path) => readFileSync(root(path), "utf8");
export const fileExists = (path) => existsSync(root(path));

// Loads a pure file (a module's logic.js, the generator, the spec catalogue). Fails the test with a readable
// message when the file is missing or cannot be loaded without React — which is the state of a module that has
// not been split yet.
export async function loadPure(path) {
  if (!fileExists(path)) assert.fail(`${path} does not exist: the logic has not been separated yet`);
  try { return await import(root(path).href); }
  catch (error) { assert.fail(`${path} does not load in plain Node (${String(error.message).split("\n")[0]})`); }
}

// Checks that a pure file exports everything the contract asks for, and says which names are missing.
export function assertExports(logic, names, label) {
  const missing = names.filter((name) => logic[name] === undefined);
  assert.equal(missing.length, 0, `${label} does not export ${missing.join(", ")}`);
}

// A copy of a stats object with every number replaced by a random one: used to check that a module's
// performance stays inside 0-1 whatever happened during the flight (including impossible combinations).
export function fuzzStats(stats, seed, range = [0, 400]) {
  const rnd = randomTools(createRandom(seed));
  const walk = (value) => {
    if (typeof value === "number") return rnd.int(range[0], range[1]);
    if (typeof value === "boolean") return rnd.chance(0.5);
    if (Array.isArray(value)) return Array.from({ length: rnd.int(0, 6) }, () => walk(value[0] ?? 0));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, walk(entry)]));
    return value;
  };
  return walk(stats);
}

// Every performance a module reports must be a number between 0 and 1 (the mission turns it into points).
export function assertPerformance(result, label) {
  assert.ok(result && typeof result === "object", `${label}: moduleResult did not return an object`);
  assert.equal(typeof result.performance, "number", `${label}: performance is not a number`);
  assert.ok(Number.isFinite(result.performance), `${label}: performance is ${result.performance}`);
  assert.ok(result.performance >= 0 && result.performance <= 1, `${label}: performance ${result.performance} is out of 0-1`);
}
