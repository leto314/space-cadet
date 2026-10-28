#!/usr/bin/env node
// Checks that every mission module of the app is split in two files: its logic (pure JavaScript) and its screen
// (React), and that the mission core (generator, layout, spec catalogue) stays loadable without React.
//
//   node scripts/check-module-separation.mjs              modules + mission core, PASS / FAIL per module
//   node scripts/check-module-separation.mjs --all        also the shared mission screens (informational)
//   node scripts/check-module-separation.mjs --details    list what is wrong in each failing module (file, line)
//   node scripts/check-module-separation.mjs --help
//
// Plain Node, no package to install. Reads the source as text (plus one real `import()` of each logic file to
// prove it runs without React Native). Exit code 1 when a registered module or a mission core file fails.
//
// The rules (see "What is checked" in the report header):
//   1. Structure    the module lives in src/missions/modules/<folder>/ with a logic.js, a screen file imports
//                   ./logic, the module's declaration is the logic's spec plus its Component, and
//                   modules/index.js registers it.
//   2. Screen file  every other .js file of the folder: no Math.random / createRandom / randomTools (the screen
//                   receives runtime.seed, the logic turns it into a generator), and only React components
//                   (PascalCase) or module declarations (<name>Module) exported.
//   3. Logic file   imports only ../../../utils/random.js, another module's logic.js or a game's logic.js (with
//                   the .js extension), never calls Math.random, holds no JSX, and actually loads in Node.
//   4. Mission core src/missions/generator.js, layout.js and modules/specs.js follow the same rules as a logic
//                   file: no React (the catalogue they read is the pure specs), and they load in plain Node.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.removeAllListeners("warning"); // Node's "module type not specified" notice is noise here.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODULES_DIR = join(ROOT, "src", "missions", "modules");
const ARGS = process.argv.slice(2);
const OPTIONS = [
  ["--all", "also report the shared mission screens (MissionScreen, the sheets, kit): informational only"],
  ["--details", "list the issues of each failing module (file and line), instead of a single PASS / FAIL"],
  ["--no-color", "plain text output"],
  ["--help", "show this help"],
];
const unknown = ARGS.filter((arg) => !OPTIONS.some(([flag]) => flag === arg));
if (unknown.length) { console.error(`Unknown option: ${unknown.join(" ")}\n`); }
if (unknown.length || ARGS.includes("--help")) {
  console.log("Usage: node scripts/check-module-separation.mjs [options]\n");
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
// What the app declares: the competences (src/theme/spaceCadet.js) and the mission modules
// (src/missions/modules/index.js, plus each module's own declaration). Read as text.
// ---------------------------------------------------------------------------------------------------------------
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const exists = (path) => existsSync(join(ROOT, path));

function readCategories() {
  const source = read("src/theme/spaceCadet.js");
  const block = source.slice(source.indexOf("CATEGORY_CONFIG"), source.indexOf("};", source.indexOf("CATEGORY_CONFIG")));
  return [...block.matchAll(/^\s+(\w+):\s*\{\s*label:\s*"([^"]+)"/gm)].map(([, key, label]) => ({ key, label }));
}

// The object literal of `[export] const <name> = { ... };`, as text.
function declarationBlock(source, name) {
  const start = source.search(new RegExp(`^(?:export )?const ${name} = \\{`, "m"));
  if (start === -1) return "";
  // A one-line declaration ({ ...spec, Component }) ends on its own line; a multi-line one ends with "};".
  const lineEnd = source.indexOf("\n", start);
  const firstLine = source.slice(start, lineEnd === -1 ? undefined : lineEnd);
  if (/\};\s*$/.test(firstLine)) return firstLine;
  const end = source.indexOf("\n};", start);
  return end === -1 ? source.slice(start) : source.slice(start, end + 3);
}

// A field of a declaration, following what it spreads: the spec exported by the folder's logic.js (the target
// structure), or a local `...baseDefinition` (module variants before the split). `sources` lists the files to
// look in: the screen first, then the logic.
function inherited(sources, block, read, depth = 0) {
  const own = read(block);
  if (own || depth > 4) return own ?? null;
  for (const [, base] of block.matchAll(/\.\.\.(\w+)/g)) {
    for (const source of sources) {
      const baseBlock = declarationBlock(source, base);
      const value = baseBlock ? inherited(sources, baseBlock, read, depth + 1) : null;
      if (value) return value;
    }
  }
  return null;
}

function readModules() {
  const indexPath = "src/missions/modules/index.js";
  const source = read(indexPath);
  const imported = [...source.matchAll(/^import\s+\{([^}]+)\}\s+from\s+"\.\/([^"]+)";/gm)]
    .flatMap(([, names, specifier]) => names.split(",").map((name) => ({ declaration: name.trim(), specifier })));
  // Commented-out lines do not register anything.
  const active = source.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  const registered = new Set([...active.matchAll(/\[(\w+)\.id\]/g)].map(([, name]) => name));
  return {
    source,
    indexPath,
    modules: imported.map(({ declaration, specifier }) => {
      const file = `src/missions/modules/${specifier}.js`;
      const folder = specifier.includes("/") ? `src/missions/modules/${specifier.slice(0, specifier.lastIndexOf("/"))}` : null;
      const fileSource = exists(file) ? read(file) : null;
      const logicSource = folder && exists(`${folder}/logic.js`) ? read(`${folder}/logic.js`) : null;
      const sources = [fileSource, logicSource].filter(Boolean);
      const block = fileSource ? declarationBlock(fileSource, declaration) : "";
      const field = (name) => (fileSource ? inherited(sources, block, (text) => text.match(new RegExp(`\\b${name}:\\s*"([^"]*)"`))?.[1]) : null);
      const keys = block.includes("\n") ? [...block.matchAll(/^\s{2}([A-Za-z_$][\w$]*):/gm)].map(([, key]) => key) : [...block.matchAll(/[{,]\s*([A-Za-z_$][\w$]*):/g)].map(([, key]) => key);
      const spreads = [...block.matchAll(/\.\.\.(\w+)/g)].map(([, name]) => name);
      // A variant may inherit its Component from the base it spreads.
      const component = fileSource ? Boolean(inherited([fileSource], block, (text) => (text.includes("Component:") ? "yes" : null))) : false;
      return { declaration, specifier, file, folder, fileSource, block, keys, spreads, component, registered: registered.has(declaration), id: field("id") ?? declaration, title: field("title") ?? declaration, competence: field("competence") };
    }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Source helpers (same as the game check)
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
const isModuleDeclaration = (name) => /^[a-z][A-Za-z0-9]*Module$/.test(name);
const at = (lines) => `line${lines.length > 1 ? "s" : ""} ${lines.join(", ")}`;

// ---------------------------------------------------------------------------------------------------------------
// The checks. Each returns a list of issues (strings); an empty list means the check passed.
// ---------------------------------------------------------------------------------------------------------------
function checkStructure(module, registry, screenFiles) {
  const issues = [];
  if (!module.fileSource) { issues.push(`${module.file} does not exist, although src/missions/modules/index.js imports it`); return issues; }
  if (!module.folder) issues.push(`declared in ${module.file}: a module needs its own folder, src/missions/modules/<module>/logic.js + its screen`);
  else if (!exists(`${module.folder}/logic.js`)) issues.push(`${module.folder}/logic.js is missing: the module's logic has not been separated yet`);
  if (!module.block) issues.push(`${module.file} does not declare "export const ${module.declaration} = { ... }"`);
  if (!module.registered) issues.push(`src/missions/modules/index.js does not register ${module.declaration} in MODULES`);
  // The declaration is the logic's spec plus the screen's component: nothing else belongs in the screen file.
  if (module.block) {
    const extra = module.keys.filter((key) => key !== "Component");
    if (!module.spreads.length) issues.push(`${module.file}: the declaration of ${module.declaration} does not spread its spec from ./logic (expected { ...${module.declaration.replace(/Module$/, "")}Spec, Component })`);
    if (extra.length) issues.push(`${module.file}: the declaration of ${module.declaration} sets ${extra.map((key) => `"${key}"`).join(", ")} itself; those fields belong to the spec in logic.js`);
    if (!module.component) issues.push(`${module.file}: the declaration of ${module.declaration} has no Component`);
  }
  if (module.folder && screenFiles.length && !screenFiles.some(({ source }) => importSpecifiers(source).some(({ specifier }) => /^\.\/logic(\.js)?$/.test(specifier)))) {
    issues.push(`no screen file of ${module.folder}/ imports ./logic`);
  }
  return issues;
}

function checkScreenFile(file) {
  const { name, source } = file;
  const issues = [];
  const randomCalls = occurrences(source, /Math\.random\b/g);
  if (randomCalls.length) issues.push(`${name}: uses Math.random (${at(randomCalls)}); content must be drawn in logic.js from runtime.seed`);
  const generators = occurrences(source, /\b(createRandom|randomTools)\b/g);
  if (generators.length) issues.push(`${name}: uses createRandom / randomTools (${at(generators)}); the screen passes runtime.seed, the logic builds the generators`);
  const badExports = exportedNames(source).filter(({ name: exported }) => !isComponentName(exported) && !isModuleDeclaration(exported));
  for (const { name: exported, line } of badExports) issues.push(`${name}: exports "${exported}" (line ${line}), which is neither a React component nor a module declaration; logic must be exported from logic.js`);
  return issues;
}

const ALLOWED_LOGIC_IMPORT = /^(?:\.\.\/\.\.\/\.\.\/utils\/random\.js|(?:\.\.\/[a-z0-9-]+|\.)\/logic\.js|\.\.\/\.\.\/\.\.\/games\/[a-z0-9-]+\/logic\.js)$/;
const ALLOWED_CORE_IMPORT = /^(?:\.\.\/utils\/random\.js|\.\.\/\.\.\/utils\/random\.js|\.\/layout\.js|\.\/generator\.js|\.\/score\.js|\.\/modules\/specs\.js|\.\/[a-z0-9-]+\/logic\.js)$/;

// Shared by the module logic files and the mission core: purity, then a real load in Node.
async function checkPureFile(path, label, allowed, hint) {
  if (!exists(path)) return [`${label} is missing`];
  const source = read(path);
  const issues = [];
  for (const { specifier, line } of importSpecifiers(source)) {
    if (allowed.test(specifier)) continue;
    if (allowed.test(`${specifier}.js`)) issues.push(`${label}: import "${specifier}" (line ${line}) needs the .js extension so Node can load it`);
    else issues.push(`${label}: imports "${specifier}" (line ${line}); only ${hint} are allowed`);
  }
  const randomCalls = occurrences(source, /Math\.random\b/g);
  if (randomCalls.length) issues.push(`${label}: calls Math.random (${at(randomCalls)}); generators must receive their random source as a parameter (randomSeed() is the one place that draws)`);
  if (/<[A-Z][A-Za-z]*[\s/>]/.test(source)) issues.push(`${label}: contains JSX; screens belong in the module file`);
  if (!issues.length) {
    try { await import(pathToFileURL(join(ROOT, path)).href); }
    catch (error) { issues.push(`${label}: does not load in Node (${String(error.message).split("\n")[0]})`); }
  }
  return issues;
}

async function checkModule(module, registry) {
  const folderPath = module.folder ? join(ROOT, module.folder) : null;
  const screenFiles = folderPath && existsSync(folderPath) && statSync(folderPath).isDirectory()
    ? readdirSync(folderPath).filter((name) => name.endsWith(".js") && name !== "logic.js").map((name) => ({ name: `${module.folder}/${name}`, source: readFileSync(join(folderPath, name), "utf8") }))
    : module.fileSource ? [{ name: module.file, source: module.fileSource }] : [];
  const seen = new Set();
  const issues = [
    ...checkStructure(module, registry, screenFiles),
    ...screenFiles.flatMap(checkScreenFile),
    ...(module.folder && exists(`${module.folder}/logic.js`) ? await checkPureFile(`${module.folder}/logic.js`, `${module.folder}/logic.js`, ALLOWED_LOGIC_IMPORT, "../../../utils/random.js, another module's logic.js or a game's logic.js") : []),
  ];
  // Several modules can share one folder (variants of the same system): report each issue once per module.
  return issues.filter((issue) => !seen.has(issue) && seen.add(issue));
}

const CORE_FILES = [
  { path: "src/missions/generator.js", label: "generator.js", text: "which modules fly together" },
  { path: "src/missions/layout.js", label: "layout.js", text: "where their blocks go on the board" },
  { path: "src/missions/score.js", label: "score.js", text: "how the modules' performances become the mission's 0-1000" },
  { path: "src/missions/modules/specs.js", label: "modules/specs.js", text: "the pure catalogue of module specs" },
];
const SHARED_SCREENS = ["src/missions/MissionScreen.js", "src/missions/DailyMissionSheet.js", "src/missions/MissionModeScreen.js", "src/missions/kit.js"];

// ---------------------------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------------------------
const categories = readCategories();
const registry = readModules();

console.log(bold("SPACE CADET - MISSION MODULE SEPARATION CHECK"));
console.log("");
console.log("A daily mission runs several 'systems' (modules) at once on one board. Each module must live in its own");
console.log("folder src/missions/modules/<module>/ and be split in two files:");
console.log("  logic.js           pure JavaScript (content generation, scoring, the module's spec), no React");
console.log("  <Name>Module.js    the screen (React components) plus the declaration { ...spec, Component }");
console.log("Checked: 1. the folder, its logic.js and the declaration (spec + Component) registered in modules/index.js");
console.log("2. the screen files hold no logic (no Math.random, no random generators, only components and declarations");
console.log("exported)   3. logic.js imports nothing but utils/random.js or other logic files, never calls Math.random,");
console.log("and loads in plain Node   4. the mission core (generator, layout, the spec catalogue) loads in plain Node too.");
console.log("");
console.log(`Scope: ${registry.modules.length} registered modules and ${CORE_FILES.length} mission core files${SHOW_ALL ? ", plus the shared mission screens" : ""}.  Output: ${DETAILS ? "with details" : "compact"}.`);
console.log(dim("Options: --all (also the shared screens)   --details (what fails, file and line)   --help"));
console.log("");

const PASS = green("PASS");
const FAIL = red("FAIL");
const NOT_SPLIT = yellow("NOT SPLIT");
const pad = (text, width) => text + " ".repeat(Math.max(0, width - text.length));
const results = [];

for (const category of categories) {
  const entries = [];
  for (const module of registry.modules.filter((entry) => entry.competence === category.key)) {
    const issues = await checkModule(module, registry);
    entries.push({ module, issues });
    results.push({ module, issues });
  }
  if (!entries.length) continue;
  const failing = entries.filter(({ issues }) => issues.length).length;
  console.log(`${bold(pad(category.label.toUpperCase(), 48))} ${failing ? FAIL : PASS}`);
  for (const { module, issues } of entries) {
    const label = `  ${pad(module.id, 22)}`;
    const split = module.folder && exists(`${module.folder}/logic.js`);
    if (!issues.length) console.log(`${label} ${PASS}`);
    else console.log(`${label} ${split ? FAIL : NOT_SPLIT}${DETAILS ? "" : dim(`  (${issues.length} issue${issues.length > 1 ? "s" : ""})`)}`);
    if (issues.length && DETAILS) for (const issue of issues) console.log(dim(`       - ${issue}`));
  }
  console.log("");
}

const unknownCompetence = registry.modules.filter((module) => !categories.some((category) => category.key === module.competence));
if (unknownCompetence.length) {
  console.log(`${bold(pad("NO COMPETENCE READ FROM THE DECLARATION", 48))} ${FAIL}`);
  for (const module of unknownCompetence) { const issues = await checkModule(module, registry); results.push({ module, issues }); console.log(`  ${pad(module.id, 22)} ${FAIL}${DETAILS ? "" : dim(`  (${issues.length + 1} issues)`)}`); if (DETAILS) console.log(dim(`       - ${module.file}: no competence found in the declaration of ${module.declaration}`)); }
  console.log("");
}

const coreResults = [];
console.log(`${bold(pad("MISSION CORE", 48))} `.trimEnd());
for (const file of CORE_FILES) {
  const issues = await checkPureFile(file.path, file.label, ALLOWED_CORE_IMPORT, "../utils/random.js, ./layout.js, ./generator.js, ./score.js or ./modules/specs.js");
  coreResults.push({ file, issues });
  console.log(`  ${pad(file.label, 22)} ${issues.length ? FAIL : PASS}${issues.length && !DETAILS ? dim(`  (${issues.length} issue${issues.length > 1 ? "s" : ""})`) : ""}${issues.length ? "" : dim(`  (${file.text})`)}`);
  if (issues.length && DETAILS) for (const issue of issues) console.log(dim(`       - ${issue}`));
}
console.log("");

if (SHOW_ALL) {
  console.log(`${bold(pad("SHARED MISSION SCREENS", 48))} ${dim("informational")}`);
  for (const path of SHARED_SCREENS) {
    const source = exists(path) ? read(path) : "";
    const randomCalls = occurrences(source, /Math\.random\b/g);
    const generators = occurrences(source, /\b(createRandom|randomTools)\b/g);
    const notes = [...(randomCalls.length ? [`Math.random (${at(randomCalls)})`] : []), ...(generators.length ? [`createRandom / randomTools (${at(generators)})`] : [])];
    console.log(`  ${pad(path.replace("src/missions/", ""), 30)} ${notes.length ? yellow("DRAWS ITS OWN RANDOM") : PASS}${notes.length && DETAILS ? dim(`  - ${notes.join(", ")}`) : ""}`);
  }
  console.log("");
}

const failedModules = results.filter(({ issues }) => issues.length);
const splitModules = results.filter(({ module }) => module.folder && exists(`${module.folder}/logic.js`));
const failedCore = coreResults.filter(({ issues }) => issues.length);

console.log(bold("GENERAL"));
if (!failedModules.length) console.log(`  ${green("EVERY MODULE IS CORRECTLY SPLIT")}  (${results.length}/${results.length} registered modules)`);
else console.log(`  ${red(`${failedModules.length} OF ${results.length} MODULES FAIL THE TEST`)}  (${splitModules.length} of them have a logic.js; ${results.length - splitModules.length} are not split yet)`);
if (!failedCore.length) console.log(`  ${green("THE MISSION CORE LOADS IN PLAIN NODE")}  (${coreResults.length}/${coreResults.length} files)`);
else console.log(`  ${red(`${failedCore.length} OF ${coreResults.length} MISSION CORE FILES FAIL THE TEST`)}  (${failedCore.map(({ file }) => file.label).join(", ")})`);
if ((failedModules.length || failedCore.length) && !DETAILS) console.log(dim("  Run with --details to see what fails in each module."));
process.exit(failedModules.length || failedCore.length ? 1 : 0);
