// The mission screens are React files, which plain Node cannot load. This reads them as text and checks the few
// lines that connect them to the logic: each module's screen mounting its spec and its logic, the catalogue and
// the registry listing every module, and the debrief turning the modules' performances into the mission's score
// (STATS.md §6) and recording the flight (STATS.md §7).
//   npm run test:missions --

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { fileExists, sourceOf } from "./helpers.mjs";

const MODULE_FILES = [
  { id: "altitude", folder: "altitude", screen: "AltitudeModule.js", declaration: "altitudeModule", spec: "altitudeSpec" },
  { id: "math-check", folder: "math-check", screen: "MathCheckModule.js", declaration: "mathCheckModule", spec: "mathCheckSpec" },
  { id: "system-lights", folder: "system-lights", screen: "SystemLightsModule.js", declaration: "systemLightsModule", spec: "systemLightsSpec" },
  { id: "radio", folder: "radio", screen: "RadioModule.js", declaration: "radioModule", spec: "radioSpec" },
  { id: "radio-callsign", folder: "radio", screen: "RadioModule.js", declaration: "radioCallsignModule", spec: "radioCallsignSpec" },
  { id: "heading", folder: "heading", screen: "HeadingModule.js", declaration: "headingModule", spec: "headingSpec" },
  { id: "logic-gates", folder: "logic-gates", screen: "LogicGatesModule.js", declaration: "logicGatesModule", spec: "logicGatesSpec" },
  { id: "codes", folder: "codes", screen: "CodesModule.js", declaration: "codesModule", spec: "codesSpec" },
  { id: "codes-voice", folder: "codes", screen: "CodesModule.js", declaration: "codesVoiceModule", spec: "codesVoiceSpec" },
  { id: "anomaly", folder: "anomaly", screen: "AnomalyModule.js", declaration: "anomalyModule", spec: "anomalySpec" },
  { id: "anomaly-lite", folder: "anomaly", screen: "AnomalyModule.js", declaration: "anomalyLiteModule", spec: "anomalyLiteSpec" },
  { id: "tanks", folder: "tanks", screen: "TanksModule.js", declaration: "tanksModule", spec: "tanksSpec" },
  { id: "tracking", folder: "tracking", screen: "TrackingModule.js", declaration: "trackingModule", spec: "trackingSpec" },
  { id: "tracking-mini", folder: "tracking", screen: "TrackingModule.js", declaration: "trackingMiniModule", spec: "trackingMiniSpec" },
  { id: "cube", folder: "cube", screen: "CubeModule.js", declaration: "cubeModule", spec: "cubeSpec" },
  { id: "running-total", folder: "running-total", screen: "RunningTotalModule.js", declaration: "runningTotalModule", spec: "runningTotalSpec" },
  { id: "mini-scan", folder: "grids", screen: "GridModules.js", declaration: "miniScanModule", spec: "miniScanSpec" },
  { id: "mini-memory", folder: "grids", screen: "GridModules.js", declaration: "miniMemoryModule", spec: "miniMemorySpec" },
  { id: "mini-switchboard", folder: "logic-puzzles", screen: "LogicPuzzleModules.js", declaration: "miniSwitchboardModule", spec: "miniSwitchboardSpec" },
  { id: "mini-landing", folder: "logic-puzzles", screen: "LogicPuzzleModules.js", declaration: "miniLandingModule", spec: "miniLandingSpec" },
  { id: "mini-landing-split", folder: "logic-puzzles", screen: "LogicPuzzleModules.js", declaration: "miniLandingSplitModule", spec: "miniLandingSplitSpec" },
  { id: "estimation", folder: "estimation", screen: "EstimationModule.js", declaration: "estimationModule", spec: "estimationSpec" },
  { id: "airways", folder: "airways", screen: "AirwaysModule.js", declaration: "airwaysModule", spec: "airwaysSpec" },
  { id: "rotation-match", folder: "spatial", screen: "SpatialModules.js", declaration: "rotationMatchModule", spec: "rotationMatchSpec" },
  { id: "opposite-face", folder: "spatial", screen: "SpatialModules.js", declaration: "oppositeFaceModule", spec: "oppositeFaceSpec" },
];

const screenPath = (entry) => `src/missions/modules/${entry.folder}/${entry.screen}`;

describe("Mission modules - wiring", () => {
  test("every module's screen lives in its folder, imports ./logic and declares { ...spec, Component }", () => {
    const broken = [];
    for (const entry of MODULE_FILES) {
      const path = screenPath(entry);
      if (!fileExists(path)) { broken.push(`${entry.id}: ${path} does not exist`); continue; }
      const source = sourceOf(path);
      if (!source.includes('from "./logic"')) broken.push(`${entry.id}: ${entry.screen} does not import ./logic`);
      if (!new RegExp(`export const ${entry.declaration} = \\{\\s*\\.\\.\\.${entry.spec},`).test(source)) broken.push(`${entry.id}: ${entry.screen} does not declare "export const ${entry.declaration} = { ...${entry.spec}, Component: ... }"`);
    }
    assert.equal(broken.length, 0, `${broken.length} module(s) are not wired to their logic:\n         ${broken.join("\n         ")}`);
  });

  test("every module's content and result come from the logic, not from the screen", () => {
    const broken = [];
    for (const path of [...new Set(MODULE_FILES.map(screenPath))]) {
      if (!fileExists(path)) { broken.push(`${path} does not exist`); continue; }
      const source = sourceOf(path);
      if (!/buildContent\(/.test(source)) broken.push(`${path} does not build its content with buildContent(...)`);
      if (!/runtime\.register\(\(\) => moduleResult\(/.test(source)) broken.push(`${path} does not report runtime.register(() => moduleResult(...))`);
      if (/Math\.random/.test(source)) broken.push(`${path} draws its own random numbers`);
    }
    assert.equal(broken.length, 0, `${broken.length} screen(s) still hold logic:\n         ${broken.join("\n         ")}`);
  });

  test("the registry lists every module, and the catalogue is built from the same specs", () => {
    const index = sourceOf("src/missions/modules/index.js");
    const missing = MODULE_FILES.filter((entry) => !new RegExp(`\\[${entry.declaration}\\.id\\]:\\s*${entry.declaration},`).test(index)).map((entry) => entry.id);
    assert.equal(missing.length, 0, `missing from MODULES in src/missions/modules/index.js: ${missing.join(", ")}`);
    for (const folder of [...new Set(MODULE_FILES.map((entry) => entry.folder))]) assert.ok(index.includes(`./${folder}/`), `src/missions/modules/index.js does not import anything from ./${folder}/`);
    assert.ok(fileExists("src/missions/modules/specs.js"), "src/missions/modules/specs.js is missing: the generator needs a catalogue it can read without React");
    const specs = sourceOf("src/missions/modules/specs.js");
    const unlisted = MODULE_FILES.filter((entry) => !specs.includes(entry.spec)).map((entry) => entry.id);
    assert.equal(unlisted.length, 0, `missing from SPECS in src/missions/modules/specs.js: ${unlisted.join(", ")}`);
  });
});

describe("Mission flight - wiring", () => {
  test("the mission screen gives each module its seed, its duration and the mission's status", () => {
    const source = sourceOf("src/missions/MissionScreen.js");
    assert.ok(source.includes("deriveSeed(seed, module.id)"), "each module should get its own stream, derived from the mission seed");
    assert.ok(/durationMs: durationMs - start/.test(source), "a module that comes in later should be told how much flight is left");
    assert.ok(source.includes("register:"), "the runtime should let a module report its result");
  });

  test("the debrief weights each module by its share of the 1000 points and records the flight (STATS.md §6-7)", () => {
    const source = sourceOf("src/missions/MissionScreen.js");
    assert.ok(/missionScore\(/.test(source), "the debrief should use the pure missionScore(...) of the mission logic, not an average computed in the screen");
    assert.ok(source.includes('from "./score"') || source.includes('from "./generator"'), "missionScore should come from the mission logic");
    assert.ok(/saveMission\(missionRecord\(/.test(source), "a flown mission should be recorded (stats/records.js + stats/storage.js)");
  });

  test("the daily mission and Mission Mode fly the same board from the same logic", () => {
    const daily = sourceOf("src/missions/DailyMissionSheet.js");
    const mode = sourceOf("src/missions/MissionModeScreen.js");
    for (const [label, source] of [["DailyMissionSheet.js", daily], ["MissionModeScreen.js", mode]]) {
      assert.ok(source.includes("<MissionScreen"), `${label} does not mount <MissionScreen>`);
      assert.ok(/from "\.\/generator"/.test(source), `${label} does not read the mission logic from ./generator`);
      assert.ok(!/Math\.random/.test(source), `${label} draws its own random numbers; a free session should take randomSeed() from utils/random`);
    }
    assert.ok(daily.includes("missionForDay("), "the daily mission should come from missionForDay(dayKey), which knows the days before it");
    assert.ok(mode.includes("archiveMission("), "Mission Mode should draw its archive mission from archiveMission(seed)");
  });
});
