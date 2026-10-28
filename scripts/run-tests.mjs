#!/usr/bin/env node
// Runs a folder of logic tests (scripts/games/*.test.mjs or scripts/missions/*.test.mjs) with the plain-text
// reporter. Compact by default: one line per test, PASS or FAIL, and the list of failing tests; --details adds the
// failure message under each failing test.
//
//   node scripts/run-tests.mjs games                  the games (Full Clearance / Daily Training)
//   node scripts/run-tests.mjs missions               the daily missions (board, generator, modules, wiring)
//   node scripts/run-tests.mjs missions --details     with the failure messages
//   node scripts/run-tests.mjs missions --only=layout one file only (its name without .test.mjs)
//   node scripts/run-tests.mjs --help
//
// (npm run test:games / npm run test:missions do the same; add "-- --details" to pass an option through.)
// Plain Node, nothing to install.

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const ARGS = process.argv.slice(2);
const SUITES = {
  games: "Correctness of the games' logic (src/games/<game>/logic.js): the daily version is the same for everyone,\nits content is valid, its score stays between 0 and 1000 and moves the right way.",
  missions: "Correctness of the logic behind a daily mission: the board (layout.js), the mission of the day\n(generator.js + the spec catalogue), each module's own logic (content from the seed, spec, scoring),\nand the lines wiring the React screens to that logic.",
};
const OPTIONS = [
  ["--details", "print the failure message under each failing test"],
  ["--only=<file>", "run one file only, by its name without .test.mjs (e.g. --only=layout)"],
  ["--no-color", "plain text output"],
  ["--help", "show this help"],
];
const suite = ARGS.find((arg) => !arg.startsWith("--"));
const only = ARGS.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);
const unknown = ARGS.filter((arg) => arg !== suite && !["--details", "--no-color", "--help"].includes(arg) && !arg.startsWith("--only="));
if (unknown.length) console.error(`Unknown option: ${unknown.join(" ")}\n`);
if (suite && !SUITES[suite]) console.error(`Unknown suite "${suite}": expected ${Object.keys(SUITES).join(" or ")}\n`);
if (unknown.length || !suite || !SUITES[suite] || ARGS.includes("--help")) {
  console.log("Usage: node scripts/run-tests.mjs <games | missions> [options]\n");
  for (const [flag, text] of OPTIONS) console.log(`  ${flag.padEnd(16)} ${text}`);
  process.exit(unknown.length || (suite && !SUITES[suite]) ? 2 : 0);
}

const folder = join(HERE, suite);
const available = existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith(".test.mjs")).sort() : [];
const files = available.filter((name) => !only || name === `${only}.test.mjs`);
if (!files.length) { console.error(`No test file matches --only=${only}. Available: ${available.map((name) => name.replace(".test.mjs", "")).join(", ")}`); process.exit(2); }
const DETAILS = ARGS.includes("--details");

console.log(`SPACE CADET - ${suite.toUpperCase()} LOGIC TESTS`);
console.log("");
console.log(SUITES[suite]);
console.log(`Scope: ${files.map((name) => name.replace(".test.mjs", "")).join(", ")}.  Output: ${DETAILS ? "with details" : "compact (one line per test)"}.`);
console.log("");

const child = spawn(process.execPath, ["--no-warnings", "--test", "--test-concurrency=1", `--test-reporter=${pathToFileURL(join(HERE, "test-reporter.mjs")).href}`, ...files.map((name) => join(folder, name))], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, TESTS_DETAILS: DETAILS ? "1" : "0", TESTS_NO_COLOR: ARGS.includes("--no-color") ? "1" : "0", TESTS_SUITE: suite },
});
child.on("exit", (code) => process.exit(code ?? 1));
