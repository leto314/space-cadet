# Mission logic tests

Tests of the **correctness** of everything behind a daily mission: the board (`src/missions/layout.js`), the
mission of the day (`src/missions/generator.js` + the spec catalogue), each module's own logic
(`src/missions/modules/<module>/logic.js`) and the few lines wiring the React screens to that logic. They are the
mission counterpart of [`../games/README.md`](../games/README.md), and they complement
[`../check-module-separation.md`](../check-module-separation.md), which checks the *structure* (logic and screens
in separate files) but says nothing about what the logic does.

> **State today: all 186 tests pass.** The modules and the mission core are split and loadable in plain Node,
> and the generator rotates the systems over the days (see "How the mission of the day is chosen" at the end).

## How to run

From the project folder, Node 20 or newer, nothing to install:

```bash
npm run test:missions                       # every test on one line, PASS or FAIL (compact, the default)
npm run test:missions -- --details          # same, plus the failure message under each failing test
npm run test:missions -- --only=generator   # one file only: layout, generator, modules or wiring
npm run test:missions -- --no-color
npm run test:missions -- --help
```

(`node scripts/run-tests.mjs missions [options]` is the same command without npm; the runner and the reporter
are shared with `npm run test:games`.)

Compact output lists every test under its suite, then the failing tests, the verdict, and the options:

```
Mission board - placement
  [PASS] the board is the documented 4 x 8 grid of half-block cells
  [PASS] blocks never overlap and never leave the grid
  ...
altitude - module logic
  [FAIL] its logic.js loads in plain Node and exports its spec, its content, its stats and its result
  ...
FAILED TESTS:
  altitude - module logic
    - its logic.js loads in plain Node and exports its spec, its content, its stats and its result  (scripts/missions/modules.test.mjs:58)

RESULT: 155 tests, 12 passed, 143 failed  ->  FAIL

Options: npm run test:missions -- --details   (why each failing test fails)
```

`--details` adds the failure message under each failing test, e.g. `src/missions/modules/altitude/logic.js does
not exist: the logic has not been separated yet`. The exit code is 1 when anything fails.

## The contract a module's logic must honour

Every module's `logic.js` honours this contract (the file list lives in the `MODULES` table at the top of
`modules.test.mjs`, like the `GAMES` list of the game tests):

```js
// src/missions/modules/<module>/logic.js
export const <name>Spec = { id, title, competence, secondary, task, voice, load, family?, rule, recap, blocks };
export function buildContent(spec, seed, context);     // everything the module shows, drawn from the seed
export function emptyStats(spec);                      // the stats a module starts the flight with
export function idleStats(spec, content, context);     // the stats of a flight where nobody touched the module
export function moduleResult(spec, stats, context);    // { performance: 0-1, detail: "what happened" }
```

`idleStats` is how a module proves it **demands play**: the logic simulates its own flight with no input (the
altitude drifting on the gusts, the tanks draining, the traffic breaching the zones, every call missed…) and the
test requires that such a flight earns little. It is the counterpart of "perfect play scores 1".

`context` is what the mission tells the module: `{ durationMs }` (how much flight it has). `spec` is passed to
every function so that two variants of one system (`anomaly` / `anomaly-lite`, `tracking` / `tracking-mini`) can
share a folder and a logic file and differ only by their spec. The screen keeps React only:

```js
export const altitudeModule = { ...altitudeSpec, Component: AltitudeModule };
```

## What is checked

### `layout.test.mjs` — the board

| Theme | What is checked |
|---|---|
| **The grid** | the board is 4 × 8 half-block cells; every block size of the catalogue (2×2 down to ½×½) fits on its own |
| **Placement** | on four hand-made sets: no two blocks overlap, nothing leaves the grid, every block of every module is placed |
| **Determinism** | the same modules always give the same board, run after run |
| **Compactness** | a light mission uses as few rows as possible (two 1 × 1 widgets → 2 rows) |
| **Hierarchy** | displays sit above the controls; the most used control reaches the bottom **and** the right edge (where the thumb is) |
| **Half-width rule** | a block one widget wide never straddles the middle of the board |
| **Refusal** | a set filling the board exactly is still placed; one cell too many is refused (`null`), not squeezed in |
| **Geometry** | the cell size comes from the full grid (a block keeps its size whatever the mission), a shorter board sits at the bottom, the board fits the screen on three phone sizes, rectangles never overlap in pixels, a 1 × 1 widget is two cells plus the gap |


### `generator.test.mjs` — the mission of the day

| Theme | What is checked |
|---|---|
| **Same day → same mission** | 8 seeds, 3 runs each; and `missionForDay` twice for three days |
| **Different days differ** | 30 days: never twice the same mission in a row, at least 25 different sets |
| **The cockpit rules** | over 120 days: `missionProblem` is `null`, 3 to 5 modules, no duplicate, load within `MISSION_LIMITS.maxLoad`, at most one talking module, at most two continuous ones, and `planLayout` accepts the blocks |
| **Variety and fill** | as many competences as modules (at least 3); over a year, the rows a mission uses are at least 90 % filled on average |
| **All three sizes** | missions of 3, 4 and 5 systems each happen at least half as often as their `SIZE_WEIGHTS` say |
| **Briefing order** | continuous → events → "when you have time", and the generated order already is the briefing order |
| **Memory of the days before** | the anchor day and the first day of each block start afresh; ten days in, ten days are remembered, each exactly the mission that day really got; the last day of a block remembers the whole block |
| **Streaks** | over a year, no module flies more than `ROTATION.maxStreak` days in a row, and never more than `maxThirdDayModules` modules together on their third day |
| **Competences come back** | over a year, no competence is absent more than `competenceGapDays + 1` days in a row |
| **Nobody forgotten** | over a year: every module flies at least six times, none in more than 40 % of the missions |
| **The rotation rules** | `rotationProblem` refuses a fourth day in a row, two systems repeating together for a third day, and a mission that leaves out a competence that is due; accepts one system on its third day, a mission that brings the competence back, and anything on the first day |
| **What it refuses** | an empty mission, the same module twice, two variants of one family, one talking module too many, one continuous module too many, a load over the budget, more cells than the board — each built from the catalogue, not hard-coded |
| **Competence shares** | they add up to 1, are sorted, cover every primary competence played; a single module's first share is its own competence, with one entry per secondary |
| **Length of the flight** | both formats stay in their range, the regular one at most six minutes; more systems never get a shorter flight; five systems get a longer short flight than three on average; durations are round multiples of 5 s |
| **The archive** | an archive mission comes from a seed (same seed → same mission), stays inside `ARCHIVE_RANGE`, is never in the future, and really is that day's mission |

### `modules.test.mjs` — each of the 25 modules

Six tests per module, plus two on the catalogue:

| Theme | What is checked |
|---|---|
| **The logic loads** | `logic.js` exists, loads in plain Node, exports its spec, `buildContent`, `emptyStats`, `idleStats`, `moduleResult`; the spec's `id` matches and carries no `Component` |
| **The spec is valid** | competence and secondary among the six (and different), task among the three, `voice` boolean, load 1–5, a title, a briefing `rule` of at least 40 characters, a `recap` reading as a lowercase verb phrase, blocks with unique keys, valid roles, sizes from the catalogue, sane `refresh` / `use` hints, and placeable by `planLayout` on their own (a module may take as much of the board as it was designed to) |
| **Same seed → same content** | 8 seeds, 3 runs each, and the 8 seeds give 8 different contents |
| **Bounds** | the performance stays in 0–1 before take-off, for 8 fuzzed stat sets (including impossible ones) and for three mission lengths |
| **It demands play** | a flight where nobody touched the module (`idleStats`, simulated by the logic itself) earns at most 30 % on average over the 8 seeds, and never more than 50 % on one of them, for 2-, 3- and 7-minute flights |
| **The debrief line** | `detail` is a non-empty string |
| **The catalogue** | `specs.js` lists exactly the 25 modules, each filed under its own id; variants of one system share a `family`; every load is 1–5 |


### `wiring.test.mjs` — the React files, read as text

| Theme | What is checked |
|---|---|
| **Module screens** | each screen lives in its module's folder, imports `./logic`, and declares `export const xModule = { ...xSpec, Component: … }` |
| **No logic left** | each screen builds its content with `buildContent(...)`, reports `runtime.register(() => moduleResult(...))`, and never calls `Math.random` |
| **Registry** | `modules/index.js` registers every module and imports from every folder; `modules/specs.js` exports every spec |
| **The flight** | `MissionScreen` derives each module's seed from the mission's, tells a late-arriving module how much flight is left, and lets it register its result |
| **The debrief** | the score comes from a pure `missionScore(...)` (not an average computed in the screen) and the flight is recorded with `saveMission(missionRecord(...))` — STATS.md §6–7 |
| **Both entrances** | the daily sheet and Mission Mode both mount `<MissionScreen>`, read their mission from `./generator`, and draw no random numbers of their own |


## What is **not** covered

| Gap | Why it matters | What would cover it |
|---|---|---|
| Anything on screen | timers, gestures, the joystick, the voice, what is drawn | a real flight on a phone |
| The progressive arrival of the systems | `MissionScreen` introduces modules one by one (10 s apart, sooner after a touch, everything in by 40 % of the flight): pure-ish logic still living in the screen | extracting it next to the generator, then testing it |
| The mission score itself | the formula does not exist yet (`score.js`); the tests only require it to exist and be used | a `score.test.mjs` once STATS.md §6 is settled: share per module, tolerance, floor for finishing |
| Whether a module is **fun or fair** | a module can be deterministic, well scored and still unreadable at 3 cm | playtesting |
| Load and difficulty calibration | `load`, `TARGET_LOAD` and the per-module targets (e.g. "a panel every 22 s") are guesses | playtesting, then pinning the values in tests |
| The voice budget in practice | one talking module is allowed, but two modules may still speak through `runtime.speak` | a rule on `speak` usage, or a manual check |
| Statistics | a flown mission is now recorded (`saveMission`), but nothing feeds the Cadet Score yet (`applyDailyMission` is not called) and nothing tests `stats/` | tests on `stats/` once the Cadet Score is wired |

## Try it: two ways to make a test fail on purpose

No knowledge of the code is needed: open the file, change the one thing described, run the command, read the
result, then put the file back as it was.

**1. A module that asks too much of the player.**

1. Open `src/missions/modules/system-lights/logic.js` and find `load: 2,` (in `systemLightsSpec`, near the top).
2. Change it to `load: 9,`.
3. Run `npm run test:missions`.
4. Under `system-lights - module logic`, the test `its spec is valid: competence, task, load, texts and blocks
   the board can place` turns to `[FAIL]`; `npm run test:missions -- --details` shows the reason, `load 9`: a
   load must stay between 1 and 5, since the whole mission's budget is 11. (The generator's rules test may fail
   too: a 9-load system no longer leaves room for a mission around it.)
5. Undo the change.

**2. A module that shows the same thing every day.**

1. Open `src/missions/modules/heading/logic.js` and find, inside `buildContent`, the line
   `const rnd = randomTools(createRandom(seed));`
2. Change `seed` to `1`: `const rnd = randomTools(createRandom(1));`
3. Run `npm run test:missions -- --only=modules`.
4. Under `heading - module logic`, the test `the same mission seed gives the same content, different seeds give
   different content` turns to `[FAIL]` (`--details`: `8 of 8 seeds give the same content`). The orders would
   be identical every day, for every mission. Note that the "same seed → same content" half still passes:
   being predictable is not the same as being varied, which is why both are tested.
5. Undo the change.

## How the mission of the day is chosen

`src/missions/generator.js`, in plain words:

1. **Memory.** Days come in blocks of 28 from the anchor day (2026‑10‑04). A day remembers the missions of the
   days of its block before it — regenerated on the spot, not stored, so every phone computes the same thing.
   The first day of a block starts afresh (a longer memory would need the previous block's own memory, and so on
   without end; a stored history can replace this later).
2. **Hard rules.** A module that flew 3 days in a row rests; at most one module may be on its third day in a row
   (one system repeating is fine, the same pair three days running is not); a competence absent for 2 days is
   required today, so every competence comes back within 3 days.
3. **Need.** Each module has a natural period (4 days for a small one, up to 10 for the biggest, from its size;
   a spec may set its own `period`). Its need is the days it has waited over that period; a module well past its
   period (need ≥ 1.5) is "overdue" and gets planted on the board first, one per attempt in turn.
4. **Size first.** The day draws 3, 4 or 5 systems (`SIZE_WEIGHTS`: 15 / 35 / 50 %), so small missions where one
   big system takes the board really happen.
5. **Fill.** Each attempt adds modules one by one — the competences that are due first, then a competence not yet
   on board, then whatever fits — favouring the modules that have waited longest; then the blocks must really fit
   on the board. The best of 24 attempts wins: few holes in the rows used, a good share of the screen, different
   competences, modules that have waited (on average, so three due systems can beat five fresh ones).
6. **Length.** Short: 90 s + 18 s per system (120–180 s); Regular: 200 s + 30 s per system (300–360 s); ±15 s
   from day to day.

Over a simulated year: missions of 3 / 4 / 5 systems on 14 / 40 / 46 % of the days; every competence present
66–85 % of the days and never absent more than 3 days; every module flies between 28 and 89 times, the full-size
tracking about 45; the rows a mission uses are 97 % filled.
