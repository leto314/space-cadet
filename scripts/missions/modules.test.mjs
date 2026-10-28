// Mission modules (src/missions/modules/<module>/logic.js): correctness of every module's own logic — what it
// shows (built from the mission's seed) and what it scores.
//   npm run test:missions --
//
// The contract each module's logic.js must honour (the screen keeps only React):
//   export const <name>Spec = { id, title, competence, secondary, task, voice, load, family?, rule, recap, blocks }
//   export function buildContent(spec, seed, context)   everything the module shows, drawn from the seed
//   export function emptyStats(spec)                    the stats a module starts the flight with
//   export function idleStats(spec, content, context)   the stats of a flight where nobody touched the module
//   export function moduleResult(spec, stats, context)  { performance: 0-1, detail: "what happened" }
// `context` is what the mission tells the module: { durationMs }. Variants of one system (anomaly / anomaly-lite)
// share a folder and a logic file, and differ by their spec.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { GRID_COLS, GRID_ROWS, planLayout } from "../../src/missions/layout.js";
import { assertExports, assertPerformance, fuzzStats, loadPure, same, SEEDS } from "./helpers.mjs";

const COMPETENCES = ["spatial", "attention", "memory", "mentalMath", "logic", "multitasking"];
const TASKS = ["continuous", "event", "opportunistic"];
const ROLES = ["display", "control"];
const BLOCK_SIZES = ["4x4", "4x2", "2x4", "2x2", "4x1", "1x4", "2x1", "1x2", "1x1"];
const CONTEXT = { durationMs: 180000 };
const EXPORTS = ["buildContent", "emptyStats", "idleStats", "moduleResult"];
// A module must demand play: left alone for the whole flight, it may not earn more than this share on average
// over the test seeds (and never more than half on any one of them).
const IDLE_CEILING = 0.3;
const IDLE_WORST = 0.5;
const DURATIONS = [120000, 180000, 420000];

// The 25 modules of src/missions/modules/index.js: where each one's logic belongs, and the spec it exports.
// Modules sharing a folder are variants of the same system.
const MODULES = [
  { id: "altitude", folder: "altitude", screen: "AltitudeModule.js", spec: "altitudeSpec" },
  { id: "math-check", folder: "math-check", screen: "MathCheckModule.js", spec: "mathCheckSpec" },
  { id: "system-lights", folder: "system-lights", screen: "SystemLightsModule.js", spec: "systemLightsSpec" },
  { id: "radio", folder: "radio", screen: "RadioModule.js", spec: "radioSpec" },
  { id: "radio-callsign", folder: "radio", screen: "RadioModule.js", spec: "radioCallsignSpec" },
  { id: "heading", folder: "heading", screen: "HeadingModule.js", spec: "headingSpec" },
  { id: "logic-gates", folder: "logic-gates", screen: "LogicGatesModule.js", spec: "logicGatesSpec" },
  { id: "codes", folder: "codes", screen: "CodesModule.js", spec: "codesSpec" },
  { id: "codes-voice", folder: "codes", screen: "CodesModule.js", spec: "codesVoiceSpec" },
  { id: "anomaly", folder: "anomaly", screen: "AnomalyModule.js", spec: "anomalySpec" },
  { id: "anomaly-lite", folder: "anomaly", screen: "AnomalyModule.js", spec: "anomalyLiteSpec" },
  { id: "tanks", folder: "tanks", screen: "TanksModule.js", spec: "tanksSpec" },
  { id: "tracking", folder: "tracking", screen: "TrackingModule.js", spec: "trackingSpec" },
  { id: "tracking-mini", folder: "tracking", screen: "TrackingModule.js", spec: "trackingMiniSpec" },
  { id: "cube", folder: "cube", screen: "CubeModule.js", spec: "cubeSpec" },
  { id: "running-total", folder: "running-total", screen: "RunningTotalModule.js", spec: "runningTotalSpec" },
  { id: "mini-scan", folder: "grids", screen: "GridModules.js", spec: "miniScanSpec" },
  { id: "mini-memory", folder: "grids", screen: "GridModules.js", spec: "miniMemorySpec" },
  { id: "mini-switchboard", folder: "logic-puzzles", screen: "LogicPuzzleModules.js", spec: "miniSwitchboardSpec" },
  { id: "mini-landing", folder: "logic-puzzles", screen: "LogicPuzzleModules.js", spec: "miniLandingSpec" },
  { id: "mini-landing-split", folder: "logic-puzzles", screen: "LogicPuzzleModules.js", spec: "miniLandingSplitSpec" },
  { id: "estimation", folder: "estimation", screen: "EstimationModule.js", spec: "estimationSpec" },
  { id: "airways", folder: "airways", screen: "AirwaysModule.js", spec: "airwaysSpec" },
  { id: "rotation-match", folder: "spatial", screen: "SpatialModules.js", spec: "rotationMatchSpec" },
  { id: "opposite-face", folder: "spatial", screen: "SpatialModules.js", spec: "oppositeFaceSpec" },
];

const path = (entry) => `src/missions/modules/${entry.folder}/logic.js`;
async function load(entry) {
  const logic = await loadPure(path(entry));
  assertExports(logic, [entry.spec, ...EXPORTS], path(entry));
  return { logic, spec: logic[entry.spec] };
}

for (const entry of MODULES) describe(`${entry.id} - module logic`, () => {
  test("its logic.js loads in plain Node and exports its spec, its content, its stats, its idle flight and its result", async () => {
    const { spec } = await load(entry);
    assert.equal(spec.id, entry.id, `the spec of ${entry.spec} says "${spec.id}"`);
    assert.equal(spec.Component, undefined, "the spec must not carry a React component: that belongs to the screen");
  });

  test("its spec is valid: competence, task, load, texts and blocks the board can place", async () => {
    const { spec } = await load(entry);
    assert.ok(COMPETENCES.includes(spec.competence), `competence "${spec.competence}"`);
    assert.ok(Array.isArray(spec.secondary), "secondary must be a list");
    for (const key of spec.secondary) {
      assert.ok(COMPETENCES.includes(key), `secondary competence "${key}"`);
      assert.notEqual(key, spec.competence, "a secondary competence repeats the main one");
    }
    assert.ok(TASKS.includes(spec.task), `task "${spec.task}"`);
    assert.equal(typeof spec.voice, "boolean", "voice must be a boolean");
    assert.ok(Number.isFinite(spec.load) && spec.load > 0 && spec.load <= 5, `load ${spec.load}`);
    assert.ok(typeof spec.title === "string" && spec.title.length >= 3, "title missing");
    assert.ok(typeof spec.rule === "string" && spec.rule.length >= 40, "the briefing rule is missing or too short");
    assert.ok(typeof spec.recap === "string" && /^[a-z]/.test(spec.recap), `recap "${spec.recap}" should read as a lowercase verb phrase ("solve the logic panels")`);
    assert.ok(Array.isArray(spec.blocks) && spec.blocks.length >= 1, "a module needs at least one block");
    for (const block of spec.blocks) {
      assert.ok(typeof block.key === "string" && block.key, "a block has no key");
      assert.ok(ROLES.includes(block.role), `block "${block.key}": role "${block.role}"`);
      assert.ok(BLOCK_SIZES.includes(`${block.h}x${block.w}`), `block "${block.key}": ${block.h} x ${block.w} is not in the board's catalogue`);
      if (block.role === "display") assert.ok(["slow", "normal", "fast", undefined].includes(block.refresh), `block "${block.key}": refresh "${block.refresh}"`);
      else assert.ok(["frequent", "normal", "rare", undefined].includes(block.use), `block "${block.key}": use "${block.use}"`);
    }
    assert.equal(new Set(spec.blocks.map((block) => block.key)).size, spec.blocks.length, "two blocks share a key");
    assert.ok(spec.blocks.reduce((sum, block) => sum + block.h * block.w, 0) <= GRID_COLS * GRID_ROWS, "the module asks for more than the whole board");
    assert.ok(planLayout([spec]), "the module's own blocks do not fit on the board");
  });

  test("the same mission seed gives the same content, different seeds give different content", async () => {
    const { logic, spec } = await load(entry);
    for (const seed of SEEDS) {
      const first = logic.buildContent(spec, seed, CONTEXT);
      assert.ok(first !== undefined, "buildContent returned nothing");
      for (let run = 0; run < 3; run += 1) assert.ok(same(first, logic.buildContent(spec, seed, CONTEXT)), `seed ${seed}: run ${run + 2} differs from run 1`);
    }
    const runs = SEEDS.map((seed) => logic.buildContent(spec, seed, CONTEXT));
    const identical = runs.filter((content, index) => index > 0 && same(content, runs[0])).length;
    assert.equal(identical, 0, `${identical + 1} of ${SEEDS.length} seeds give the same content`);
  });

  test("the performance never leaves 0-1 whatever happened", async () => {
    const { logic, spec } = await load(entry);
    assertPerformance(logic.moduleResult(spec, logic.emptyStats(spec), CONTEXT), `${entry.id} before take-off`);
    for (const seed of SEEDS) {
      const stats = fuzzStats(logic.emptyStats(spec), seed);
      assertPerformance(logic.moduleResult(spec, stats, CONTEXT), `${entry.id} fuzz ${seed}: ${JSON.stringify(stats)}`);
    }
    for (const durationMs of [60000, 120000, 420000]) assertPerformance(logic.moduleResult(spec, logic.emptyStats(spec), { durationMs }), `${entry.id} at ${durationMs} ms`);
  });

  test("the module demands play: a flight nobody touched scores little, whatever the length", async () => {
    const { logic, spec } = await load(entry);
    for (const durationMs of DURATIONS) {
      const context = { durationMs };
      const performances = SEEDS.map((seed) => {
        const content = logic.buildContent(spec, seed, context);
        const result = logic.moduleResult(spec, logic.idleStats(spec, content, context), context);
        assertPerformance(result, `${entry.id} idle, seed ${seed}, ${durationMs} ms`);
        return result.performance;
      });
      const mean = performances.reduce((sum, value) => sum + value, 0) / performances.length;
      assert.ok(mean <= IDLE_CEILING, `${durationMs / 1000} s: left alone, the module still earns ${Math.round(mean * 100)}% on average (ceiling ${IDLE_CEILING * 100}%)`);
      assert.ok(Math.max(...performances) <= IDLE_WORST, `${durationMs / 1000} s: left alone, the module earns ${Math.round(Math.max(...performances) * 100)}% on seed ${SEEDS[performances.indexOf(Math.max(...performances))]}`);
    }
  });

  test("the debrief line says what happened", async () => {
    const { logic, spec } = await load(entry);
    const { detail } = logic.moduleResult(spec, logic.emptyStats(spec), CONTEXT);
    assert.equal(typeof detail, "string", "detail is not a string");
    assert.ok(detail.length > 0, "detail is empty");
  });
});

describe("Mission modules - the catalogue", () => {
  test("every module of index.js has a spec in the catalogue, and the catalogue has nothing else", async () => {
    const specs = (await loadPure("src/missions/modules/specs.js")).SPECS;
    const expected = MODULES.map((module) => module.id).sort();
    assert.deepEqual(Object.keys(specs).sort(), expected, "the catalogue and the module list disagree");
    for (const [id, spec] of Object.entries(specs)) assert.equal(spec.id, id, `the catalogue files ${spec.id} under ${id}`);
  });

  test("variants of one system share a family: a family has at least two members, all in the same folder", async () => {
    const specs = (await loadPure("src/missions/modules/specs.js")).SPECS;
    const folderOf = Object.fromEntries(MODULES.map((entry) => [entry.id, entry.folder]));
    const families = {};
    for (const [id, spec] of Object.entries(specs)) if (spec.family) families[spec.family] = [...(families[spec.family] ?? []), id];
    assert.ok(Object.keys(families).length >= 1, "no module declares a family, so variants cannot be kept apart by the generator");
    for (const [family, ids] of Object.entries(families)) {
      assert.ok(ids.length >= 2, `family "${family}" has a single member (${ids[0]}): a family is for variants`);
      assert.equal(new Set(ids.map((id) => folderOf[id])).size, 1, `family "${family}": ${ids.join(", ")} are not in the same folder`);
    }
    const loads = Object.values(specs).map((spec) => spec.load);
    assert.ok(Math.min(...loads) >= 1 && Math.max(...loads) <= 5, "a module's load should stay between 1 and 5");
  });
});
