// The screens and the daily registry are React files, which plain Node cannot load. This reads them as text and
// checks the few lines that connect them to the logic: the registry entry, and the screen building its daily
// session from the day's seed and handing the logic's daily result to onFinish.
//   node --test "scripts/games/*.test.mjs"

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const registry = read("src/daily/registry.js");

const GAMES = [
  { key: "multitasking", title: "Target Drift", competence: "multitasking", screen: "src/games/multitasking/MultitaskingGame.js", component: "MultitaskingGame" },
  { key: "airways", title: "Airways", competence: "multitasking", screen: "src/games/airways/AirwaysGame.js", component: "AirwaysGame" },
  { key: "memory-span", title: "Memory Sequences", competence: "memory", screen: "src/games/memory-span/MemorySpanGame.js", component: "MemorySpanGame", builder: "buildDailyLadder(daily.seed)" },
  { key: "n-back", title: "N-back", competence: "memory", screen: "src/games/n-back/NBackGame.js", component: "NBackGame", builder: "buildDailyBlocks(daily.seed)" },
  { key: "visual-grid-memory", title: "Visual Memory", competence: "memory", screen: "src/games/visual-grid-memory/VisualGridMemoryGame.js", component: "VisualGridMemoryGame", builder: "buildDailyLadders(daily.seed)" },
];

for (const game of GAMES) describe(`${game.title} - wiring`, () => {
  const opening = `\n  ${game.key.includes("-") ? `"${game.key}"` : game.key}: {`;
  const start = registry.indexOf(opening);
  const entry = start === -1 ? "" : registry.slice(start, registry.indexOf("\n  },", start));

  test("is registered as a daily game of its competence, with its texts", () => {
    assert.ok(entry.length > 0, `no entry "${game.key}" in src/daily/registry.js`);
    assert.ok(entry.includes(`competence: "${game.competence}"`), `entry "${game.key}" is not under the ${game.competence} competence`);
    assert.ok(entry.includes(`title: "${game.title}"`), `entry "${game.key}" has the wrong title`);
    for (const field of ["summary", "progression", "rules"]) assert.ok(new RegExp(`${field}: "[^"]{20,}"`).test(entry), `entry "${game.key}": ${field} text missing or too short`);
    assert.ok(entry.includes(`<${game.component} daily={{ seed, onFinish, onExit }} />`), `entry "${game.key}" does not mount <${game.component}> with the daily props`);
  });

  test("the screen builds the day's session from the seed and reports the logic's daily result", () => {
    const screen = read(game.screen);
    assert.ok(screen.includes('from "./logic"'), `${game.screen} does not import ./logic`);
    const builder = game.builder ?? "buildDailySession(daily.seed)";
    assert.ok(screen.includes(builder), `${game.screen} does not build its daily content with ${builder}`);
    assert.ok(/daily\.onFinish\(dailyResult\(/.test(screen), `${game.screen} does not hand dailyResult(...) to daily.onFinish`);
    assert.ok(screen.includes("daily ? daily.onExit : returnToPreflight"), `${game.screen}: the back arrow does not leave the daily game through daily.onExit`);
  });
});
