#!/usr/bin/env node
// Checks that every game of the app is split in two files: its logic (pure JavaScript) and its screens (React).
//
//   node scripts/check-game-separation.mjs              games with a daily version, PASS / FAIL per game
//   node scripts/check-game-separation.mjs --all        every game, including those without a daily version
//   node scripts/check-game-separation.mjs --details    list what is wrong in each failing game (file, line)
//   node scripts/check-game-separation.mjs --help
//
// Plain Node, no package to install. Reads the source as text (plus one real `import()` of each logic file
// to prove it runs without React Native). Exit code 1 when a game that has a daily version fails.
//
// The rules (see "What is checked" in the report header):
//   1. Structure    src/games/<game>/logic.js exists, a game file imports it, and the daily registry (when the
//                   game has a daily version) points inside the game's folder.
//   2. Game files   every other .js file of the folder is a screen file: no Math.random / createRandom /
//                   randomTools (the screen only handles seeds, the logic turns them into generators), no
//                   DAILY_* constant declared, and only React components exported (PascalCase names).
//   3. Logic file   imports only ../../utils/random.js or another logic.js (with the .js extension, so Node can
//                   load it), never calls Math.random itself (generators receive their random source), and
//                   actually loads in Node.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.removeAllListeners("warning"); // Node's "module type not specified" notice is noise here.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GAMES_DIR = join(ROOT, "src", "games");
const ARGS = process.argv.slice(2);
const OPTIONS = [
  ["--all", "check every game, not only the games that already have a daily version"],
  ["--details", "list the issues of each failing game (file and line), instead of a single PASS / FAIL"],
  ["--no-color", "plain text output"],
  ["--help", "show this help"],
];
const unknown = ARGS.filter((arg) => !OPTIONS.some(([flag]) => flag === arg));
if (unknown.length) { console.error(`Unknown option: ${unknown.join(" ")}\n`); }
if (unknown.length || ARGS.includes("--help")) {
  console.log("Usage: node scripts/check-game-separation.mjs [options]\n");
  for (const [flag, text] of OPTIONS) console.log(`  ${flag.padEnd(12)} ${text}`);
  process.exit(unknown.length ? 2 : 0);
}
const SHOW_ALL = ARGS.includes("--all");
const DETAILS = ARGS.includes("--details");
const COLOR = process.stdout.isTTY && !ARGS.includes("--no-color");
const paint = (code, text) => (COLOR ? `\u001b[${code}m${text}\u001b[0m` : text);
const green = (text) => paint(32, text);
const red = (text) => paint(31, text);
const yellow = (text) => paint(33, text);
const dim = (text) => paint(2, text);
const bold = (text) => paint(1, text);

// ---------------------------------------------------------------------------------------------------------------
// What the app declares: the games (src/data/exercises.js), the competences (src/theme/spaceCadet.js) and the
// games that already have a daily version (src/daily/registry.js). Read as text: these files are tiny and
// regular, and the theme file imports nothing we could not load anyway.
// ---------------------------------------------------------------------------------------------------------------
const read = (path) => readFileSync(join(ROOT, path), "utf8");

function readCategories() {
  const source = read("src/theme/spaceCadet.js");
  const block = source.slice(source.indexOf("CATEGORY_CONFIG"), source.indexOf("};", source.indexOf("CATEGORY_CONFIG")));
  return [...block.matchAll(/^\s+(\w+):\s*\{\s*label:\s*"([^"]+)"/gm)].map(([, key, label]) => ({ key, label }));
}

function readExercises() {
  const source = read("src/data/exercises.js");
  return [...source.matchAll(/\{\s*key:\s*"([^"]+)",\s*title:\s*"([^"]+)",[^}]*?badge:\s*"([^"]+)",\s*category:\s*"([^"]+)"/g)]
    .map(([, key, title, badge, category]) => ({ key, title, badge, category }));
}

function readDailyRegistry() {
  const source = read("src/daily/registry.js");
  const block = source.slice(source.indexOf("DAILY_GAMES"));
  const keys = [...block.matchAll(/^ {2}"?([a-z][a-z-]*)"?:\s*\{$/gm)].map(([, key]) => key);
  return { source, keys: new Set(keys) };
}

// ---------------------------------------------------------------------------------------------------------------
// Source helpers
// ---------------------------------------------------------------------------------------------------------------
const lineOf = (source, index) => source.slice(0, index).split("\n").length;

// Every occurrence of a regex, as "line N" references, ignoring matches inside // comments.
function occurrences(source, pattern) {
  const lines = [];
  for (const match of source.matchAll(pattern)) {
    const line = lineOf(source, match.index);
    const text = source.split("\n")[line - 1];
    const column = match.index - source.lastIndexOf("\n", match.index - 1) - 1;
    const commentAt = text.indexOf("//");
    if (commentAt !== -1 && commentAt < column) continue;
    lines.push(line);
  }
  return [...new Set(lines)];
}

function importSpecifiers(source) {
  return [...source.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm), ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)]
    .map((match) => ({ specifier: match[1], line: lineOf(source, match.index) }));
}

function exportedNames(source) {
  const names = [];
  for (const match of source.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.push({ name: match[1], line: lineOf(source, match.index) });
  for (const match of source.matchAll(/^export\s+\{([^}]*)\}/gm)) {
    for (const part of match[1].split(",")) { const name = part.trim().split(/\s+as\s+/).pop(); if (name) names.push({ name, line: lineOf(source, match.index) }); }
  }
  for (const match of source.matchAll(/^export\s+default\b/gm)) names.push({ name: "default", line: lineOf(source, match.index) });
  return names;
}

const isComponentName = (name) => /^[A-Z][A-Za-z0-9]*$/.test(name);

// ---------------------------------------------------------------------------------------------------------------
// The checks. Each returns a list of issues (strings); an empty list means the check passed.
// ---------------------------------------------------------------------------------------------------------------
function checkStructure(game, folder, gameFiles, registry) {
  const issues = [];
  if (!existsSync(join(folder, "logic.js"))) issues.push("logic.js is missing: the game's logic has not been separated yet");
  if (!gameFiles.length) issues.push("no screen file found next to logic.js");
  const importsLogic = gameFiles.some(({ source }) => importSpecifiers(source).some(({ specifier }) => /^\.\/logic(\.js)?$/.test(specifier)));
  if (gameFiles.length && !importsLogic) issues.push("no screen file imports ./logic");
  if (game.daily && !registry.source.includes(`/games/${game.key}/`)) issues.push(`src/daily/registry.js does not import the daily component from src/games/${game.key}/`);
  return issues;
}

function checkGameFile(file) {
  const { name, source } = file;
  const issues = [];
  const at = (lines) => `line${lines.length > 1 ? "s" : ""} ${lines.join(", ")}`;
  const randomCalls = occurrences(source, /Math\.random\b/g);
  if (randomCalls.length) issues.push(`${name}: uses Math.random (${at(randomCalls)}); content must be drawn in logic.js from an explicit seed`);
  const generators = occurrences(source, /\b(createRandom|randomTools)\b/g);
  if (generators.length) issues.push(`${name}: uses createRandom / randomTools (${at(generators)}); the screen passes seeds, the logic builds the generators`);
  const dailyConstants = occurrences(source, /\b(?:const|let|var|function)\s+DAILY_[A-Z0-9_]+/g);
  if (dailyConstants.length) issues.push(`${name}: declares a DAILY_* constant (${at(dailyConstants)}); the daily progression belongs in logic.js`);
  const badExports = exportedNames(source).filter(({ name: exported }) => !isComponentName(exported));
  for (const { name: exported, line } of badExports) issues.push(`${name}: exports "${exported}" (line ${line}), which is not a React component; logic must be exported from logic.js`);
  return issues;
}

const ALLOWED_LOGIC_IMPORT = /^(?:\.\.\/\.\.\/utils\/random\.js|(?:\.\.\/[a-z-]+|\.)\/logic\.js)$/;

async function checkLogicFile(folder) {
  const path = join(folder, "logic.js");
  if (!existsSync(path)) return [];
  const source = readFileSync(path, "utf8");
  const issues = [];
  for (const { specifier, line } of importSpecifiers(source)) {
    if (ALLOWED_LOGIC_IMPORT.test(specifier)) continue;
    if (/^(?:\.\.\/\.\.\/utils\/random|(?:\.\.\/[a-z-]+|\.)\/logic)$/.test(specifier)) issues.push(`logic.js: import "${specifier}" (line ${line}) needs the .js extension so Node can load it`);
    else issues.push(`logic.js: imports "${specifier}" (line ${line}); only ../../utils/random.js or another game's logic.js are allowed`);
  }
  const randomCalls = occurrences(source, /Math\.random\b/g);
  if (randomCalls.length) issues.push(`logic.js: calls Math.random (line${randomCalls.length > 1 ? "s" : ""} ${randomCalls.join(", ")}); generators must receive their random source as a parameter`);
  if (/<[A-Z][A-Za-z]*[\s/>]/.test(source)) issues.push("logic.js: contains JSX; screens belong in the game file");
  if (!issues.length) {
    try { await import(pathToFileURL(path).href); }
    catch (error) { issues.push(`logic.js: does not load in Node (${String(error.message).split("\n")[0]})`); }
  }
  return issues;
}

async function checkGame(game, registry) {
  const folder = join(GAMES_DIR, game.key);
  if (!existsSync(folder)) return [`src/games/${game.key}/ does not exist`];
  const gameFiles = readdirSync(folder).filter((name) => name.endsWith(".js") && name !== "logic.js").map((name) => ({ name, source: readFileSync(join(folder, name), "utf8") }));
  return [...checkStructure(game, folder, gameFiles, registry), ...gameFiles.flatMap(checkGameFile), ...(await checkLogicFile(folder))];
}

// ---------------------------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------------------------
const categories = readCategories();
const exercises = readExercises();
const registry = readDailyRegistry();
const games = exercises.map((exercise) => ({ ...exercise, daily: registry.keys.has(exercise.key) }));

console.log(bold("SPACE CADET - GAME SEPARATION CHECK"));
console.log("");
console.log("Space Cadet is a cognitive training app: 20 games across 6 competences. Each game lives in src/games/<game>/");
console.log("and must be split in two files:");
console.log("  logic.js        pure JavaScript (content generation, scoring, daily progression), no React, no React Native");
console.log("  <Name>Game.js   the screens (React components), which import ./logic");
console.log("Checked: 1. logic.js exists and is imported   2. the screen files hold no logic (no Math.random, no random");
console.log("generators, no DAILY_* constants, only React components exported)   3. logic.js imports nothing but");
console.log("utils/random.js or other logic files, never calls Math.random, and loads in plain Node.");
console.log("");
console.log(`Scope: ${SHOW_ALL ? "all 20 games" : "games that already have a daily training version (src/daily/registry.js)"}.  Output: ${DETAILS ? "with details" : "compact"}.`);
console.log(dim("Options: --all (every game)   --details (what fails, file and line)   --help"));
console.log("");

const PASS = green("PASS");
const FAIL = red("FAIL");
const NOT_FINISHED = yellow("NOT FINISHED");
const NOT_IN_DAILY = yellow("NOT IN DAILY VERSION");
const pad = (text, width) => text + " ".repeat(Math.max(0, width - text.length));
const results = [];

for (const category of categories) {
  const entries = [];
  for (const game of games.filter((entry) => entry.category === category.key && (SHOW_ALL || entry.daily))) {
    const issues = await checkGame(game, registry);
    entries.push({ game, issues });
    results.push({ game, issues });
  }
  if (!entries.length) continue;
  const dailyFailing = entries.filter(({ game, issues }) => game.daily && issues.length).length;
  const unfinished = entries.filter(({ game, issues }) => !game.daily && issues.length).length;
  console.log(`${bold(pad(category.label.toUpperCase(), 48))} ${dailyFailing ? FAIL : unfinished ? NOT_FINISHED : PASS}`);
  for (const { game, issues } of entries) {
    const label = `  ${game.badge} ${pad(game.title, 24)}`;
    if (!issues.length) console.log(`${label} ${PASS}${game.daily ? "" : dim("  (split done, no daily version yet)")}`);
    else if (game.daily) console.log(`${label} ${FAIL}${DETAILS ? "" : dim(`  (${issues.length} issue${issues.length > 1 ? "s" : ""})`)}`);
    else console.log(`${label} ${NOT_IN_DAILY}${dim(`  (not split yet${DETAILS ? "" : `, ${issues.length} issue${issues.length > 1 ? "s" : ""}`})`)}`);
    if (issues.length && DETAILS) for (const issue of issues) console.log(dim(`       - ${issue}`));
  }
  console.log("");
}

const daily = results.filter(({ game }) => game.daily);
const dailyFailed = daily.filter(({ issues }) => issues.length);
const others = results.filter(({ game }) => !game.daily);
const othersDone = others.filter(({ issues }) => !issues.length);

console.log(bold("GENERAL"));
if (!dailyFailed.length) console.log(`  ${green("ALL FINISHED GAMES PASS THE TEST")}  (${daily.length}/${daily.length} games with a daily version are correctly split)`);
else console.log(`  ${red(`${dailyFailed.length} OF ${daily.length} FINISHED GAMES FAIL THE TEST`)}  (${dailyFailed.map(({ game }) => game.title).join(", ")})`);
if (SHOW_ALL) console.log(`  ${others.length - othersDone.length} game${others.length - othersDone.length === 1 ? "" : "s"} without a daily version still to split` + (othersDone.length ? `, ${othersDone.length} already split` : "") + ".");
else console.log(dim(`  ${games.length - daily.length} games have no daily version yet and were not checked (use --all).`));
if (dailyFailed.length && !DETAILS) console.log(dim("  Run with --details to see what fails in each game."));
process.exit(dailyFailed.length ? 1 : 0);
